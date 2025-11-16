#!/usr/bin/env node
// smegmascript bot - AT Protocol (Bluesky) integration
// Listens for mentions and evaluates JavaScript code

const AtProtoClient = require('./atproto-client');
const FirehoseSubscriber = require('./firehose');
const BotWorker = require('./bot-worker');
const JobQueue = require('./job-queue');
const AdminCommands = require('./admin-commands');
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
    service: process.env.BSKY_SERVICE || 'https://bsky.social',
    useQueue: process.env.USE_QUEUE === 'true',
    adminDids: process.env.ADMIN_DIDS ? process.env.ADMIN_DIDS.split(',') : [],
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10)
    }
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

    // Setup admin commands
    const adminCommands = new AdminCommands({
      adminDids: config.adminDids || []
    });

    if (adminCommands.adminDids.size > 0) {
      console.log(`Admin commands enabled for ${adminCommands.adminDids.size} user(s)\n`);
    }

    // Determine mode
    const useQueue = config.useQueue || false;
    console.log(`Mode: ${useQueue ? 'Queue (Production)' : 'Direct (Simple)'}\n`);

    let queue = null;
    let worker = null;

    if (useQueue) {
      // Queue mode - use BullMQ for production scale
      console.log('Initializing job queue...');
      queue = new JobQueue({
        redis: config.redis,
        queueName: 'smegmascript-eval',
        concurrency: 10
      });

      // Create worker for processing jobs
      worker = new BotWorker(client, {
        botHandle: profile.handle,
        botDid: client.getDid(),
        adminCommands: adminCommands,
        userCooldown: 5000,
        maxQueueSize: 1000,  // Higher limit in queue mode
        timeout: 5000,
        httpRequestsPerEval: 5,
        httpRequestInterval: 60,
        httpRequestLimit: 25,
        httpPostLimit: 150000,
        httpTransferLimit: 150000,
        httpTimeLimit: 5000
      });

      // Set queue reference for admin commands
      adminCommands.setWorker(worker);
      adminCommands.setQueue(queue);

      // Initialize queue with worker processor
      await queue.init((mention) => worker.processMention(mention));

      console.log('✓ Job queue initialized');
    } else {
      // Direct mode - process mentions immediately
      worker = new BotWorker(client, {
        botHandle: profile.handle,
        botDid: client.getDid(),
        adminCommands: adminCommands,
        userCooldown: 5000,
        maxQueueSize: 100,   // Lower limit in direct mode
        timeout: 5000,
        httpRequestsPerEval: 5,
        httpRequestInterval: 60,
        httpRequestLimit: 25,
        httpPostLimit: 150000,
        httpTransferLimit: 150000,
        httpTimeLimit: 5000
      });

      // Set worker reference for admin commands
      adminCommands.setWorker(worker);
    }

    // Create firehose subscriber
    const firehose = new FirehoseSubscriber({
      botDid: client.getDid(),
      botHandle: profile.handle
    });

    // Handle mentions
    firehose.on('mention', async (mention) => {
      if (useQueue) {
        // Add to queue
        await queue.addJob(mention);
      } else {
        // Process directly
        await worker.processMention(mention);
      }
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
    setInterval(async () => {
      const workerStats = worker.getStats();
      const stats = {
        processed: workerStats.processed,
        successful: workerStats.successful,
        failed: workerStats.failed,
        rateLimited: workerStats.rateLimited,
        uptime: `${Math.floor(workerStats.uptime / 1000)}s`
      };

      if (useQueue) {
        const queueStats = await queue.getStats();
        stats.queue = queueStats;
      } else {
        stats.queueSize = workerStats.queueSize;
      }

      console.log('[Stats]', stats);
    }, 60000);

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n\nShutting down gracefully...');

      firehose.stop();

      if (useQueue && queue) {
        console.log('Closing job queue...');
        await queue.close();
      }

      const stats = worker.getStats();
      console.log('\nFinal stats:', stats);

      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

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
