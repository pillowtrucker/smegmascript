#!/usr/bin/env node
// smegmascript bot - AT Protocol (Bluesky) integration
// Listens for mentions and evaluates JavaScript code

const AtProtoClient = require('./atproto-client');
const FirehoseSubscriber = require('./firehose');
const BotWorker = require('./bot-worker');
const fs = require('fs');
const path = require('path');

// Load configuration
function loadConfig() {
  // Try to load from config.json
  const configPath = path.join(__dirname, 'config.json');

  if (fs.existsSync(configPath)) {
    try {
      const configData = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      console.error('Error loading config.json:', error.message);
      process.exit(1);
    }
  }

  // Fall back to environment variables
  return {
    identifier: process.env.BSKY_IDENTIFIER,
    password: process.env.BSKY_PASSWORD,
    service: process.env.BSKY_SERVICE || 'https://bsky.social'
  };
}

async function main() {
  console.log('=== smegmascript bot ===');
  console.log('AT Protocol JavaScript eval bot\n');

  const config = loadConfig();

  if (!config.identifier || !config.password) {
    console.error('Error: Missing credentials');
    console.error('Either create config.json or set BSKY_IDENTIFIER and BSKY_PASSWORD environment variables');
    console.error('\nExample config.json:');
    console.error(JSON.stringify({
      identifier: 'bot.bsky.social',
      password: 'your-app-password',
      service: 'https://bsky.social'
    }, null, 2));
    process.exit(1);
  }

  // Create AT Protocol client
  const client = new AtProtoClient(config);

  try {
    // Login
    console.log('Logging in to AT Protocol...');
    await client.login();

    const profile = await client.getProfile();
    console.log(`Logged in as @${profile.handle}`);
    console.log(`DID: ${client.getDid()}\n`);

    // Create worker
    const worker = new BotWorker(client, {
      botHandle: profile.handle,
      botDid: client.getDid(),
      userCooldown: 5000,      // 5 seconds between evals per user
      maxQueueSize: 100,       // Max 100 pending evaluations
      timeout: 5000,           // 5 second execution timeout
      httpRequestsPerEval: 5,
      httpRequestInterval: 60,
      httpRequestLimit: 25,
      httpPostLimit: 150000,
      httpTransferLimit: 150000,
      httpTimeLimit: 5000
    });

    // Create firehose subscriber
    const firehose = new FirehoseSubscriber({
      botDid: client.getDid(),
      botHandle: profile.handle
    });

    // Handle mentions
    firehose.on('mention', async (mention) => {
      await worker.processMention(mention);
    });

    // Handle firehose events
    firehose.on('connected', () => {
      console.log('✓ Connected to firehose');
      console.log('Listening for mentions...\n');
    });

    firehose.on('disconnected', () => {
      console.log('✗ Disconnected from firehose');
    });

    firehose.on('error', (error) => {
      console.error('Firehose error:', error.message);
    });

    // Start firehose
    firehose.start();

    // Stats logging every 60 seconds
    setInterval(() => {
      const stats = worker.getStats();
      console.log('[Stats]', {
        processed: stats.processed,
        successful: stats.successful,
        failed: stats.failed,
        rateLimited: stats.rateLimited,
        queueSize: stats.queueSize,
        uptime: `${Math.floor(stats.uptime / 1000)}s`
      });
    }, 60000);

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\nShutting down gracefully...');
      firehose.stop();

      const stats = worker.getStats();
      console.log('\nFinal stats:', stats);

      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n\nShutting down gracefully...');
      firehose.stop();
      process.exit(0);
    });

  } catch (error) {
    console.error('Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error.message);
  console.error(error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection:', reason);
});

// Run the bot
main();
