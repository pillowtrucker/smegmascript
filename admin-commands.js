// Admin commands for bot management
// Allows authorized users to control the bot via mentions

class AdminCommands {
  constructor(config = {}) {
    this.adminDids = new Set(config.adminDids || []);
    this.botWorker = null;
    this.jobQueue = null;
  }

  /**
   * Set the bot worker instance
   */
  setWorker(worker) {
    this.botWorker = worker;
  }

  /**
   * Set the job queue instance
   */
  setQueue(queue) {
    this.jobQueue = queue;
  }

  /**
   * Check if a user is an admin
   */
  isAdmin(userDid) {
    return this.adminDids.has(userDid);
  }

  /**
   * Add an admin user
   */
  addAdmin(userDid) {
    this.adminDids.add(userDid);
    console.log(`[Admin] Added admin: ${userDid}`);
  }

  /**
   * Remove an admin user
   */
  removeAdmin(userDid) {
    this.adminDids.delete(userDid);
    console.log(`[Admin] Removed admin: ${userDid}`);
  }

  /**
   * Parse and execute admin command
   * Returns null if not an admin command, or response text
   */
  async executeCommand(mention, code) {
    const { author } = mention;

    // Check if user is admin
    if (!this.isAdmin(author)) {
      return null;
    }

    // Check if this is an admin command (starts with !)
    const trimmed = code.trim();
    if (!trimmed.startsWith('!')) {
      return null;
    }

    const parts = trimmed.substring(1).split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    console.log(`[Admin] ${author} executed: ${command} ${args.join(' ')}`);

    try {
      switch (command) {
        case 'stats':
          return await this.cmdStats();

        case 'ping':
          return this.cmdPing();

        case 'help':
          return this.cmdHelp();

        case 'reset':
          return this.cmdResetStats();

        case 'queue':
          return await this.cmdQueue(args[0]);

        case 'pause':
          return await this.cmdPause();

        case 'resume':
          return await this.cmdResume();

        default:
          return `Unknown admin command: !${command}\nUse !help for available commands.`;
      }
    } catch (error) {
      console.error(`[Admin] Command error:`, error);
      return `Error executing command: ${error.message}`;
    }
  }

  /**
   * !ping - Simple ping command
   */
  cmdPing() {
    return '🏓 Pong!';
  }

  /**
   * !help - List available admin commands
   */
  cmdHelp() {
    return `Admin Commands:
!ping - Test bot responsiveness
!stats - Show detailed statistics
!reset - Reset statistics counters
!queue - Show queue status (queue mode only)
!pause - Pause job processing (queue mode only)
!resume - Resume job processing (queue mode only)
!help - Show this help message`;
  }

  /**
   * !stats - Show detailed statistics
   */
  async cmdStats() {
    if (!this.botWorker) {
      return 'Worker not initialized';
    }

    const workerStats = this.botWorker.getStats();
    let response = `📊 Bot Statistics:
Processed: ${workerStats.processed}
Successful: ${workerStats.successful}
Failed: ${workerStats.failed}
Rate Limited: ${workerStats.rateLimited}
Uptime: ${Math.floor(workerStats.uptime / 1000)}s
Tracked Users: ${workerStats.trackedUsers}`;

    if (this.jobQueue) {
      try {
        const queueStats = await this.jobQueue.getStats();
        response += `\n\n📦 Queue:
Waiting: ${queueStats.waiting}
Active: ${queueStats.active}
Delayed: ${queueStats.delayed}
Completed: ${queueStats.completed}
Failed: ${queueStats.failed}`;
      } catch (error) {
        response += '\n\nQueue stats unavailable';
      }
    }

    return response;
  }

  /**
   * !reset - Reset statistics
   */
  cmdResetStats() {
    if (!this.botWorker) {
      return 'Worker not initialized';
    }

    this.botWorker.resetStats();
    return '✓ Statistics reset';
  }

  /**
   * !queue - Show queue status
   */
  async cmdQueue(action) {
    if (!this.jobQueue) {
      return 'Queue mode not enabled';
    }

    if (action === 'clean') {
      await this.jobQueue.clean();
      return '✓ Queue cleaned';
    }

    const stats = await this.jobQueue.getStats();
    return `Queue Status:
Waiting: ${stats.waiting}
Active: ${stats.active}
Delayed: ${stats.delayed}
Total: ${stats.total}`;
  }

  /**
   * !pause - Pause queue processing
   */
  async cmdPause() {
    if (!this.jobQueue) {
      return 'Queue mode not enabled';
    }

    await this.jobQueue.pause();
    return '⏸ Queue paused';
  }

  /**
   * !resume - Resume queue processing
   */
  async cmdResume() {
    if (!this.jobQueue) {
      return 'Queue mode not enabled';
    }

    await this.jobQueue.resume();
    return '▶ Queue resumed';
  }
}

module.exports = AdminCommands;
