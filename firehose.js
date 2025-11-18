// AT Protocol Firehose subscriber
// Listens for mentions of the bot and emits events for processing

const { Jetstream } = require('@skyware/jetstream');
const EventEmitter = require('events');

class FirehoseSubscriber extends EventEmitter {
  constructor(config = {}) {
    super();
    this.botDid = config.botDid;
    this.botHandle = config.botHandle;
    this.jetstream = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) {
      console.log('[Firehose] Already running');
      return;
    }

    if (!this.botDid && !this.botHandle) {
      throw new Error('Bot DID or handle required for firehose filtering');
    }

    console.log('[Firehose] Starting subscriber...');
    console.log(`[Firehose] Watching for mentions of ${this.botHandle || this.botDid}`);

    this.jetstream = new Jetstream({
      wantedCollections: ['app.bsky.feed.post']
    });

    this.jetstream.on('open', () => {
      console.log('[Firehose] Connected to Jetstream');
      this.isRunning = true;
      this.emit('connected');
    });

    this.jetstream.on('close', () => {
      console.log('[Firehose] Disconnected from Jetstream');
      this.isRunning = false;
      this.emit('disconnected');
    });

    this.jetstream.on('error', (error) => {
      console.error('[Firehose] Error:', error.message);
      this.emit('error', error);
    });

    this.jetstream.on('commit', (event) => {
      try {
        this.handleCommit(event);
      } catch (error) {
        console.error('[Firehose] Error handling commit:', error);
      }
    });

    this.jetstream.start();
  }

  handleCommit(event) {
    // Only process post creations
    if (event.commit.operation !== 'create' ||
        event.commit.collection !== 'app.bsky.feed.post') {
      return;
    }

    const post = event.commit.record;
    const author = event.did;
    const uri = `at://${author}/app.bsky.feed.post/${event.commit.rkey}`;
    const cid = event.commit.cid;

    // Check if this post mentions the bot
    if (this.isMentioned(post)) {
      console.log(`[Firehose] Mention detected from ${author}`);

      // Emit event for processing
      this.emit('mention', {
        post: post,
        author: author,
        uri: uri,
        cid: cid,
        timestamp: new Date(post.createdAt || event.time_us / 1000)
      });
    }
  }

  isMentioned(post) {
    if (!post || !post.text) {
      return false;
    }

    // Check for @handle mention in text
    if (this.botHandle && post.text.includes(`@${this.botHandle}`)) {
      return true;
    }

    // Check facets for DID-based mentions
    if (this.botDid && post.facets) {
      for (const facet of post.facets) {
        if (facet.features) {
          for (const feature of facet.features) {
            if (feature.$type === 'app.bsky.richtext.facet#mention' &&
                feature.did === this.botDid) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('[Firehose] Stopping subscriber...');

    if (this.jetstream) {
      this.jetstream.close();
      this.jetstream = null;
    }

    this.isRunning = false;
    this.emit('stopped');
  }

  getStatus() {
    return {
      running: this.isRunning,
      botDid: this.botDid,
      botHandle: this.botHandle
    };
  }
}

module.exports = FirehoseSubscriber;
