#!/usr/bin/env node
// smegmascript - Safe JavaScript eval bot
// STDIO interface for collaborative coding

const readline = require('readline');
const Sandbox = require('./sandbox');

// Create sandbox instance
const sandbox = new Sandbox({
  timeout: 5000,        // 5 second timeout
  memoryLimit: 128,     // 128MB memory limit
  httpLimits: {
    requestsPerEval: 5,
    requestInterval: 60,
    requestLimit: 25,
    postLimit: 150000,
    transferLimit: 150000,
    timeLimit: 5000
  }
});

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> '
});

console.log('smegmascript - Safe JavaScript eval bot');
console.log('Type JavaScript code to execute, or "quit" to exit');
console.log('Available globals: console.log, fetch(url), post(url, body)');
console.log('');

rl.prompt();

rl.on('line', async (line) => {
  const input = line.trim();

  // Handle quit command
  if (input === 'quit' || input === 'exit') {
    console.log('Goodbye!');
    process.exit(0);
  }

  // Skip empty lines
  if (!input) {
    rl.prompt();
    return;
  }

  // Execute code in sandbox
  try {
    const result = await sandbox.execute(input, {
      channel: 'stdio'
    });

    if (result.success) {
      // Print captured console.log output
      if (result.output) {
        console.log(result.output);
      }

      // Print return value if it exists and is not undefined
      if (result.result !== undefined) {
        console.log('=>', typeof result.result === 'object' ? JSON.stringify(result.result, null, 2) : result.result);
      }
    } else {
      console.log('Error:', result.error);
    }
  } catch (error) {
    console.log('Fatal error:', error.message);
    console.error(error.stack);
  }

  rl.prompt();
});

rl.on('close', () => {
  console.log('\nGoodbye!');
  process.exit(0);
});

// Handle errors gracefully
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error.message);
  rl.prompt();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection:', reason);
  rl.prompt();
});
