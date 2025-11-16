// Command parser for extracting code from AT Protocol posts
// Handles mention removal and command extraction

const GraphemeSplitter = require('grapheme-splitter');

class CommandParser {
  constructor(config = {}) {
    this.botHandle = config.botHandle;
    this.botDid = config.botDid;
  }

  /**
   * Extract code from a post that mentions the bot
   * Removes the mention and returns the remaining text as code
   *
   * @param {object} post - The AT Protocol post record
   * @returns {object} - { code: string, hasCode: boolean }
   */
  extractCode(post) {
    if (!post || !post.text) {
      return { code: '', hasCode: false };
    }

    let text = post.text;

    // Remove @handle mentions
    if (this.botHandle) {
      text = text.replace(new RegExp(`@${this.botHandle}\\s*`, 'gi'), '');
    }

    // Remove facet-based mentions using byte positions
    if (post.facets && this.botDid) {
      // Sort facets by byte start position in reverse order
      // so we can remove them without affecting positions
      const mentionFacets = [];

      for (const facet of post.facets) {
        if (facet.features) {
          for (const feature of facet.features) {
            if (feature.$type === 'app.bsky.richtext.facet#mention' &&
                feature.did === this.botDid &&
                facet.index) {
              mentionFacets.push(facet.index);
            }
          }
        }
      }

      // Sort by start position (descending)
      mentionFacets.sort((a, b) => b.byteStart - a.byteStart);

      // Remove mentions by byte position
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      let bytes = encoder.encode(text);

      for (const index of mentionFacets) {
        const before = bytes.slice(0, index.byteStart);
        const after = bytes.slice(index.byteEnd);
        bytes = new Uint8Array([...before, ...after]);
      }

      text = decoder.decode(bytes);
    }

    // Trim whitespace
    text = text.trim();

    return {
      code: text,
      hasCode: text.length > 0
    };
  }

  /**
   * Format the result for posting
   * Handles both successful evaluations and errors
   *
   * @param {object} result - Sandbox execution result
   * @returns {string} - Formatted text for posting
   */
  formatResult(result) {
    if (!result.success) {
      return `Error: ${result.error}`;
    }

    let output = '';

    // Add console output if present
    if (result.output) {
      output += result.output;
    }

    // Add return value if present and not undefined
    if (result.result !== undefined) {
      if (output) {
        output += '\n';
      }

      // Format result based on type
      if (typeof result.result === 'object') {
        try {
          output += `=> ${JSON.stringify(result.result, null, 2)}`;
        } catch (e) {
          output += `=> [Object]`;
        }
      } else {
        output += `=> ${result.result}`;
      }
    }

    // If no output at all, indicate successful execution
    if (!output) {
      output = '✓ (no output)';
    }

    return output;
  }

  /**
   * Truncate text to fit within grapheme limit
   * Uses grapheme-splitter for accurate Unicode grapheme cluster counting
   *
   * @param {string} text - Text to truncate
   * @param {number} limit - Maximum graphemes
   * @returns {string} - Truncated text
   */
  truncateText(text, limit = 300) {
    const splitter = new GraphemeSplitter();
    const graphemes = splitter.splitGraphemes(text);

    if (graphemes.length <= limit) {
      return text;
    }

    // Truncate to limit - 3 graphemes and add ellipsis
    return graphemes.slice(0, limit - 3).join('') + '...';
  }
}

module.exports = CommandParser;
