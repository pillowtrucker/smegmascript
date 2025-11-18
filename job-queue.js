// Job queue implementation using BullMQ and Redis
// Provides persistent, scalable job processing for production deployments

const { Queue, Worker, QueueScheduler } = require('bullmq');
const Redis = require('ioredis');

class JobQueue {
  constructor(config = {}) {
    this.redisConfig = config.redis || {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      maxRetriesPerRequest: null // Required for BullMQ
    };

    this.queueName = config.queueName || 'smegmascript-eval';
    this.concurrency = config.concurrency || 10;

    this.connection = null;
    this.queue = null;
    this.worker = null;
    this.scheduler = null;
  }

  /**
   * Initialize the queue and worker
   * @param {Function} processor - Async function to process jobs
   */
  async init(processor) {
    if (this.queue) {
      return; // Already initialized
    }

    try {
      // Create shared Redis connection
      this.connection = new Redis(this.redisConfig);

      // Test connection
      await this.connection.ping();
      console.log('[Queue] Connected to Redis');

      // Create queue
      this.queue = new Queue(this.queueName, {
        connection: this.connection
      });

      // Create scheduler (handles delayed jobs, rate limiting)
      this.scheduler = new QueueScheduler(this.queueName, {
        connection: this.connection
      });

      // Create worker
      this.worker = new Worker(
        this.queueName,
        async (job) => {
          console.log(`[Queue] Processing job ${job.id} from ${job.data.author}`);
          try {
            await processor(job.data);
            console.log(`[Queue] Completed job ${job.id}`);
          } catch (error) {
            console.error(`[Queue] Failed job ${job.id}:`, error.message);
            throw error; // Let BullMQ handle retries
          }
        },
        {
          connection: this.connection,
          concurrency: this.concurrency
        }
      );

      // Worker event handlers
      this.worker.on('completed', (job) => {
        console.log(`[Queue] Job ${job.id} completed successfully`);
      });

      this.worker.on('failed', (job, error) => {
        console.error(`[Queue] Job ${job?.id} failed:`, error.message);
      });

      this.worker.on('error', (error) => {
        console.error('[Queue] Worker error:', error.message);
      });

      console.log(`[Queue] Initialized with concurrency ${this.concurrency}`);
    } catch (error) {
      console.error('[Queue] Failed to initialize:', error.message);
      throw error;
    }
  }

  /**
   * Add a job to the queue
   * @param {object} data - Job data
   * @param {object} options - Job options (priority, delay, etc.)
   */
  async addJob(data, options = {}) {
    if (!this.queue) {
      throw new Error('Queue not initialized');
    }

    const defaultOptions = {
      attempts: 3, // Retry up to 3 times
      backoff: {
        type: 'exponential',
        delay: 2000 // Start with 2 second delay
      },
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 500      // Keep last 500 failed jobs
    };

    const jobOptions = { ...defaultOptions, ...options };

    const job = await this.queue.add('eval', data, jobOptions);
    console.log(`[Queue] Added job ${job.id} for ${data.author}`);
    return job;
  }

  /**
   * Get queue statistics
   */
  async getStats() {
    if (!this.queue) {
      return null;
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount()
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + delayed
    };
  }

  /**
   * Pause the queue (stop processing new jobs)
   */
  async pause() {
    if (this.queue) {
      await this.queue.pause();
      console.log('[Queue] Paused');
    }
  }

  /**
   * Resume the queue
   */
  async resume() {
    if (this.queue) {
      await this.queue.resume();
      console.log('[Queue] Resumed');
    }
  }

  /**
   * Clean up old jobs
   */
  async clean(grace = 3600000) {
    if (this.queue) {
      await this.queue.clean(grace, 1000, 'completed');
      await this.queue.clean(grace, 1000, 'failed');
      console.log('[Queue] Cleaned old jobs');
    }
  }

  /**
   * Gracefully close the queue and worker
   */
  async close() {
    console.log('[Queue] Closing...');

    if (this.worker) {
      await this.worker.close();
      this.worker = null;
      console.log('[Queue] Worker closed');
    }

    if (this.scheduler) {
      await this.scheduler.close();
      this.scheduler = null;
      console.log('[Queue] Scheduler closed');
    }

    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      console.log('[Queue] Queue closed');
    }

    if (this.connection) {
      await this.connection.quit();
      this.connection = null;
      console.log('[Queue] Redis connection closed');
    }
  }

  /**
   * Check if the queue is healthy (Redis connected)
   */
  async isHealthy() {
    if (!this.connection) {
      return false;
    }

    try {
      await this.connection.ping();
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = JobQueue;
