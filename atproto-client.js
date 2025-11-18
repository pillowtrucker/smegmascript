// AT Protocol client wrapper
// Handles authentication and posting to Bluesky

const { BskyAgent, RichText } = require('@atproto/api');

class AtProtoClient {
  constructor(config = {}) {
    this.service = config.service || 'https://bsky.social';
    this.identifier = config.identifier;
    this.password = config.password;
    this.agent = null;
    this.did = null;
  }

  async login() {
    if (this.agent) {
      return; // Already logged in
    }

    if (!this.identifier || !this.password) {
      throw new Error('Missing identifier or password for AT Protocol login');
    }

    this.agent = new BskyAgent({ service: this.service });

    try {
      await this.agent.login({
        identifier: this.identifier,
        password: this.password
      });

      this.did = this.agent.session?.did;
      console.log(`[AtProto] Logged in as ${this.identifier} (${this.did})`);
    } catch (error) {
      throw new Error(`Failed to login to AT Protocol: ${error.message}`);
    }
  }

  async postReply(text, parentPost) {
    if (!this.agent) {
      throw new Error('Not logged in to AT Protocol');
    }

    // Truncate text to 300 graphemes using RichText
    const rt = new RichText({ text });
    await rt.detectFacets(this.agent);

    // Get grapheme length
    const graphemeLength = rt.graphemeLength;
    let finalText = text;

    if (graphemeLength > 300) {
      // Truncate - simple approach: cut at character boundary near 300 graphemes
      // For more sophisticated truncation, we'd need grapheme-splitter library
      const estimatedChars = Math.floor((text.length * 300) / graphemeLength);
      finalText = text.substring(0, estimatedChars - 3) + '...';
    }

    // Build reply structure
    const replyRef = {
      root: {
        uri: parentPost.root?.uri || parentPost.uri,
        cid: parentPost.root?.cid || parentPost.cid
      },
      parent: {
        uri: parentPost.uri,
        cid: parentPost.cid
      }
    };

    try {
      const response = await this.agent.post({
        text: finalText,
        reply: replyRef,
        createdAt: new Date().toISOString()
      });

      return response;
    } catch (error) {
      throw new Error(`Failed to post reply: ${error.message}`);
    }
  }

  async getProfile() {
    if (!this.agent) {
      throw new Error('Not logged in to AT Protocol');
    }

    try {
      const profile = await this.agent.getProfile({ actor: this.did });
      return profile.data;
    } catch (error) {
      throw new Error(`Failed to get profile: ${error.message}`);
    }
  }

  isLoggedIn() {
    return this.agent !== null && this.did !== null;
  }

  getDid() {
    return this.did;
  }
}

module.exports = AtProtoClient;
