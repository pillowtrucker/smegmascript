// HTTP rate limiter based on smeggdrop limits
// Tracks requests per eval and rolling window rate limiting

class HttpLimiter {
  constructor(options = {}) {
    // Configurable limits (defaults from smeggdrop)
    this.requestsPerEval = options.requestsPerEval || 5;
    this.requestInterval = options.requestInterval || 60; // seconds
    this.requestLimit = options.requestLimit || 25;
    this.postLimit = options.postLimit || 150000; // bytes
    this.transferLimit = options.transferLimit || 150000; // bytes
    this.timeLimit = options.timeLimit || 5000; // milliseconds

    // Track requests: { channel: [{ timestamp, evalId }] }
    this.requests = new Map();
    this.currentEvalId = 0;
  }

  // Start a new eval session
  startEval() {
    this.currentEvalId++;
    this.evalRequestCount = 0;
  }

  // Check if a request can be made
  checkLimits(channel = 'default') {
    const now = Date.now();
    const requests = this.requests.get(channel) || [];

    // Clean old requests outside the interval window
    const threshold = now - (this.requestInterval * 1000);
    const recentRequests = requests.filter(r => r.timestamp >= threshold);

    // Count requests in current eval
    const evalRequests = recentRequests.filter(r => r.evalId === this.currentEvalId);

    if (evalRequests.length >= this.requestsPerEval) {
      throw new Error(`Too many HTTP requests in this eval (max ${this.requestsPerEval} requests)`);
    }

    if (recentRequests.length >= this.requestLimit) {
      throw new Error(`Too many HTTP requests (max ${this.requestLimit} requests in ${this.requestInterval} seconds)`);
    }

    // Update requests list
    this.requests.set(channel, recentRequests);
  }

  // Record a request
  recordRequest(channel = 'default') {
    const now = Date.now();
    const requests = this.requests.get(channel) || [];

    requests.push({
      timestamp: now,
      evalId: this.currentEvalId
    });

    this.requests.set(channel, requests);
  }

  // Validate POST body size
  validatePostBody(body) {
    const size = Buffer.byteLength(body, 'utf8');
    if (size > this.postLimit) {
      throw new Error(`POST body exceeds ${this.postLimit} bytes`);
    }
  }

  // Get configuration for fetch
  getFetchConfig() {
    return {
      timeout: this.timeLimit,
      size: this.transferLimit
    };
  }
}

module.exports = HttpLimiter;
