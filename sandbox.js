// Safe JavaScript sandbox using QuickJS (WebAssembly)
const { newQuickJSAsyncWASMModule } = require('quickjs-emscripten');
const fetch = require('node-fetch');
const HttpLimiter = require('./http-limiter');

class Sandbox {
  constructor(options = {}) {
    this.timeout = options.timeout || 5000; // 5 seconds default
    this.httpLimiter = new HttpLimiter(options.httpLimits || {});
    this.quickjs = null;
    this.runtime = null;
    this.vm = null;
    this.outputBuffer = [];
    this.currentChannel = 'default'; // Store current execution channel
  }

  async init() {
    if (!this.quickjs) {
      this.quickjs = await newQuickJSAsyncWASMModule();
      this.runtime = this.quickjs.newRuntime();
      this.runtime.setMaxStackSize(1024 * 1024); // 1MB stack
      this.vm = this.runtime.newContext();
      await this.setupGlobals();
    }
  }

  async setupGlobals() {
    const vm = this.vm;
    const runtime = this.runtime;
    const httpLimiter = this.httpLimiter;
    const outputBuffer = this.outputBuffer;

    // Inject console.log
    const logHandle = vm.newFunction('log', (...args) => {
      const nativeArgs = args.map(handle => vm.dump(handle));
      outputBuffer.push(nativeArgs.map(a => String(a)).join(' '));
    });
    const consoleHandle = vm.newObject();
    vm.setProp(consoleHandle, 'log', logHandle);
    vm.setProp(vm.global, 'console', consoleHandle);
    consoleHandle.dispose();
    logHandle.dispose();

    // Inject fetch function
    const self = this;
    const fetchHandle = vm.newFunction('_fetch', (urlHandle) => {
      const url = vm.getString(urlHandle);
      const channel = self.currentChannel;

      const promiseHandle = vm.newPromise();

      (async () => {
        try {
          httpLimiter.checkLimits(channel);
          httpLimiter.recordRequest(channel);

          const config = httpLimiter.getFetchConfig();
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), config.timeout);

          try {
            const response = await fetch(url, {
              signal: controller.signal,
              size: config.size
            });

            const text = await response.text();

            const result = {
              status: response.status,
              statusText: response.statusText,
              headers: Object.fromEntries(response.headers.entries()),
              body: text
            };

            const resultHandle = vm.newString(JSON.stringify(result));
            promiseHandle.resolve(resultHandle);
            resultHandle.dispose();
          } catch (fetchError) {
            const errorHandle = vm.newString(fetchError.message);
            promiseHandle.reject(errorHandle);
            errorHandle.dispose();
          } finally {
            clearTimeout(timeoutId);
          }
        } catch (error) {
          const errorHandle = vm.newString(error.message);
          promiseHandle.reject(errorHandle);
          errorHandle.dispose();
        }
      })();

      return promiseHandle.handle;
    });
    vm.setProp(vm.global, '_fetch', fetchHandle);
    fetchHandle.dispose();

    // Inject post function
    const postHandle = vm.newFunction('_post', (urlHandle, bodyHandle) => {
      const url = vm.getString(urlHandle);
      const body = vm.getString(bodyHandle);
      const channel = self.currentChannel;

      const promiseHandle = vm.newPromise();

      (async () => {
        try {
          httpLimiter.checkLimits(channel);
          httpLimiter.validatePostBody(body);
          httpLimiter.recordRequest(channel);

          const config = httpLimiter.getFetchConfig();
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), config.timeout);

          try {
            const response = await fetch(url, {
              method: 'POST',
              body: body,
              signal: controller.signal,
              size: config.size,
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            const text = await response.text();

            const result = {
              status: response.status,
              statusText: response.statusText,
              headers: Object.fromEntries(response.headers.entries()),
              body: text
            };

            const resultHandle = vm.newString(JSON.stringify(result));
            promiseHandle.resolve(resultHandle);
            resultHandle.dispose();
          } catch (fetchError) {
            const errorHandle = vm.newString(fetchError.message);
            promiseHandle.reject(errorHandle);
            errorHandle.dispose();
          } finally {
            clearTimeout(timeoutId);
          }
        } catch (error) {
          const errorHandle = vm.newString(error.message);
          promiseHandle.reject(errorHandle);
          errorHandle.dispose();
        }
      })();

      return promiseHandle.handle;
    });
    vm.setProp(vm.global, '_post', postHandle);
    postHandle.dispose();

    // Wrap fetch and post to parse JSON and add protocol if missing
    vm.evalCode(`
      globalThis.fetch = async function(url) {
        // Add https:// if no protocol specified
        if (!url.match(/^https?:\\/\\//)) {
          url = 'https://' + url;
        }
        const result = await _fetch(url);
        return JSON.parse(result);
      };
      globalThis.post = async function(url, body) {
        // Add https:// if no protocol specified
        if (!url.match(/^https?:\\/\\//)) {
          url = 'https://' + url;
        }
        const result = await _post(url, String(body));
        return JSON.parse(result);
      };
    `);
  }

  async execute(code, context = {}) {
    await this.init();
    this.currentChannel = context.channel || 'default'; // Set channel for HTTP rate limiting
    this.httpLimiter.startEval();
    this.outputBuffer = []; // Clear output buffer

    const vm = this.vm;
    const runtime = this.runtime;

    try {
      // Execute user code
      const resultHandle = vm.evalCode(code);

      // Wait for all async operations to complete
      const actualHandle = resultHandle.value || resultHandle;
      const startTime = Date.now();
      const maxWaitMs = this.timeout;

      // Check if this is a promise by checking the type
      const typename = vm.typeof(actualHandle);

      let isPromise = false;
      let promiseState = null;

      // Only check promise state if it's an object (promises are objects)
      if (typename === 'object') {
        try {
          promiseState = vm.getPromiseState(actualHandle);
          // promiseState is an object with a 'type' property
          isPromise = (promiseState && promiseState.type &&
                      (promiseState.type === 'pending' || promiseState.type === 'fulfilled' || promiseState.type === 'rejected'));
        } catch (e) {
          isPromise = false;
        }
      }

      if (isPromise && promiseState && promiseState.type === 'pending') {
        // For pending promises, keep checking state and running jobs until settled
        let iterations = 0;
        while (Date.now() - startTime < maxWaitMs) {
          // Execute any pending QuickJS jobs
          await runtime.executePendingJobs();

          // Wait for Node.js async operations
          await new Promise(resolve => setTimeout(resolve, 50));

          // Execute jobs again after waiting
          await runtime.executePendingJobs();

          // Check if promise has settled
          const currentState = vm.getPromiseState(actualHandle);

          if (currentState.type === 'fulfilled' || currentState.type === 'rejected') {
            promiseState = currentState;
            break;
          }

          iterations++;
          if (iterations > 20) {
            // Give up after 20 iterations (~1 second)
            break;
          }
        }
      } else {
        // Not a promise or already settled, just execute any pending jobs
        await runtime.executePendingJobs();
      }

      // Get the final result
      let finalResult;
      try {
        // Only use promise resolution for actual promises
        if (isPromise) {
          // Use the promiseState directly
          if (promiseState.type === 'rejected' && promiseState.error) {
            const error = vm.dump(promiseState.error);
            if (promiseState.error.alive) promiseState.error.dispose();
            finalResult = { type: 'rejected', error };
          } else if (promiseState.type === 'fulfilled' && promiseState.value) {
            finalResult = vm.dump(promiseState.value);
            if (promiseState.value.alive) promiseState.value.dispose();
          } else {
            finalResult = { type: promiseState.type };
          }
        } else {
          // Not a promise, just dump the value
          finalResult = vm.dump(actualHandle);
        }

        // Dispose the handle if it's still alive
        if (actualHandle && actualHandle.alive && typeof actualHandle.dispose === 'function') {
          actualHandle.dispose();
        }
      } catch (e) {
        console.error('Error getting result:', e.message);
        finalResult = undefined;
      }

      return {
        success: true,
        result: finalResult,
        output: this.outputBuffer.join('\n')
      };

    } catch (error) {
      return {
        success: false,
        error: error.message || String(error)
      };
    }
  }

  dispose() {
    if (this.vm) {
      this.vm.dispose();
      this.vm = null;
    }
    if (this.runtime) {
      this.runtime.dispose();
      this.runtime = null;
    }
  }
}

module.exports = Sandbox;
