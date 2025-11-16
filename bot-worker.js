// Bot worker - processes mentions and executes code
// Integrates sandbox, command parser, and AT Protocol client

const Sandbox = require('./sandbox');
const CommandParser = require('./command-parser');

class BotWorker {
  constructor(atprotoClient, config = {}) {
    this.client = atprotoClient;
    this.parser = new CommandParser({
      botHandle: config.botHandle,
      botDid: config.botDid
    });
    this.adminCommands = config.adminCommands || null;

    // Per-user rate limiting
    this.userLimits = new Map();
    this.userCooldown = config.userCooldown || 5000; // 5 seconds between evals per user
    this.globalQueueSize = 0;
    this.maxQueueSize = config.maxQueueSize || 100;

    // Sandbox options
    this.sandboxOptions = {
      timeout: config.timeout || 5000,
      httpLimits: {
        requestsPerEval: config.httpRequestsPerEval || 5,
        requestInterval: config.httpRequestInterval || 60,
        requestLimit: config.httpRequestLimit || 25,
        postLimit: config.httpPostLimit || 150000,
        transferLimit: config.httpTransferLimit || 150000,
        timeLimit: config.httpTimeLimit || 5000
      }
    };

    // Stats
    this.stats = {
      processed: 0,
      successful: 0,
      failed: 0,
      rateLimited: 0,
      started: Date.now()
    };
  }

  /**
   * Process a mention event from the firehose
   */
  async processMention(mention) {
    const { post, author, uri, cid } = mention;

    // Check global queue size
    if (this.globalQueueSize >= this.maxQueueSize) {
      console.log(`[Worker] Queue full (${this.globalQueueSize}), skipping mention from ${author}`);
      this.stats.rateLimited++;
      return;
    }

    // Check per-user rate limiting
    if (!this.checkUserRateLimit(author)) {
      console.log(`[Worker] Rate limited user ${author}`);
      this.stats.rateLimited++;

      // Optionally post a rate limit message
      // await this.postRateLimitMessage(uri, cid, post);
      return;
    }

    this.globalQueueSize++;

    try {
      await this.executeAndReply(post, uri, cid, author);
      this.stats.processed++;
      this.stats.successful++;
    } catch (error) {
      console.error(`[Worker] Error processing mention:`, error.message);
      this.stats.processed++;
      this.stats.failed++;

      // Try to post error message
      try {
        await this.client.postReply(
          `Internal error: ${error.message}`,
          { uri, cid, root: post.reply?.root }
        );
      } catch (replyError) {
        console.error(`[Worker] Failed to post error reply:`, replyError.message);
      }
    } finally {
      this.globalQueueSize--;
      this.updateUserRateLimit(author);
    }
  }

  /**
   * Execute code and post reply
   */
  async executeAndReply(post, uri, cid, author) {
    // Extract code from post
    const { code, hasCode } = this.parser.extractCode(post);

    if (!hasCode) {
      console.log(`[Worker] No code found in mention from ${author}`);
      await this.client.postReply(
        'No code to evaluate. Mention me with JavaScript code to execute!',
        { uri, cid, root: post.reply?.root }
      );
      return;
    }

    // Check for admin commands first
    if (this.adminCommands) {
      const adminResponse = await this.adminCommands.executeCommand(
        { post, author, uri, cid },
        code
      );

      if (adminResponse !== null) {
        // This was an admin command
        console.log(`[Worker] Admin command from ${author}`);
        await this.client.postReply(adminResponse, {
          uri,
          cid,
          root: post.reply?.root
        });
        return;
      }
    }

    console.log(`[Worker] Executing code from ${author}: ${code.substring(0, 50)}...`);

    // Create sandbox and execute
    const sandbox = new Sandbox(this.sandboxOptions);

    try {
      const result = await sandbox.execute(code, {
        channel: author // Per-user HTTP rate limiting
      });

      // Format result
      let responseText = this.parser.formatResult(result);

      // Truncate to 300 graphemes
      responseText = this.parser.truncateText(responseText, 300);

      // Post reply
      await this.client.postReply(responseText, {
        uri,
        cid,
        root: post.reply?.root
      });

      console.log(`[Worker] Posted reply to ${author}`);
    } finally {
      sandbox.dispose();
    }
  }

  /**
   * Check if user is within rate limit
   */
  checkUserRateLimit(userDid) {
    const lastExec = this.userLimits.get(userDid);

    if (!lastExec) {
      return true; // First time user
    }

    const elapsed = Date.now() - lastExec;
    return elapsed >= this.userCooldown;
  }

  /**
   * Update user's last execution time
   */
  updateUserRateLimit(userDid) {
    this.userLimits.set(userDid, Date.now());

    // Clean up old entries (older than 1 hour)
    const cutoff = Date.now() - 3600000;
    for (const [did, timestamp] of this.userLimits.entries()) {
      if (timestamp < cutoff) {
        this.userLimits.delete(did);
      }
    }
  }

  /**
   * Get worker statistics
   */
  getStats() {
    const uptime = Date.now() - this.stats.started;
    return {
      ...this.stats,
      uptime: uptime,
      queueSize: this.globalQueueSize,
      trackedUsers: this.userLimits.size
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      processed: 0,
      successful: 0,
      failed: 0,
      rateLimited: 0,
      started: Date.now()
    };
  }
}

module.exports = BotWorker;
