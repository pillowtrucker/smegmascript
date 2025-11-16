# smegmascript - Safe JavaScript Eval Bot

## Overview

smegmascript is a safe JavaScript evaluation bot designed for collaborative coding on AT Protocol (Bluesky). It provides sandboxed JavaScript execution with HTTP networking capabilities, inspired by the TCL eval bot features from GypsFulvus (Haskell IRC bot).

**Current Status:** ✅ STDIO interface operational | 🚧 AT Protocol integration planned

## Project Context

This repository is part of the larger **soyslopdrop** project ecosystem:
- **pillowtrucker/soyslopdrop**: NixOS flake providing reproducible Node.js 24 development environment
- **pillowtrucker/smegmascript** (this repo): Standalone JavaScript eval bot with STDIO and future AT Protocol interfaces
- **pillowtrucker/slopdrop**: Similar project in Rust and TCL

## Architecture

### Core Components

| File | Purpose |
|------|---------|
| `index.js` | STDIO REPL interface for interactive testing |
| `sandbox.js` | QuickJS WebAssembly sandbox wrapper with HTTP injection |
| `http-limiter.js` | Rate limiting and abuse prevention logic |
| `package.json` | Dependencies: `quickjs-emscripten`, `node-fetch` |

### Sandboxing Technology

**QuickJS (WebAssembly)** was chosen over alternatives like `isolated-vm` for these reasons:

- ✅ **True isolation**: Compiled to WebAssembly with no native Node.js access
- ✅ **Memory safety**: Configurable stack/heap limits prevent DoS
- ✅ **Stateful execution**: Persistent runtime context enables REPL-like interactions
- ✅ **Promise support**: Async/await works with proper job execution loops
- ⚠️ **Complexity**: Promise handling requires manual job queue management

### Security Features

```
┌─────────────────────────────────────┐
│     User Code (Untrusted)           │
├─────────────────────────────────────┤
│  QuickJS VM (WebAssembly Sandbox)   │
│  - No filesystem access             │
│  - No direct network access         │
│  - Memory/stack limits              │
│  - Execution timeout                │
├─────────────────────────────────────┤
│  Injected Globals (Controlled)      │
│  - console.log(...)                 │
│  - fetch(url) → HTTP GET            │
│  - post(url, body) → HTTP POST      │
├─────────────────────────────────────┤
│    HTTP Limiter (Rate Limiting)     │
│  - 5 requests per eval              │
│  - 25 requests per 60s window       │
│  - 150KB transfer limits            │
│  - 5s timeout per request           │
├─────────────────────────────────────┤
│   Node.js Runtime (Trusted)         │
└─────────────────────────────────────┘
```

## Rate Limits

Based on smeggdrop configuration:

| Limit | Value | Scope |
|-------|-------|-------|
| HTTP requests per eval | 5 | Per code execution |
| HTTP requests per window | 25 | Rolling 60s window |
| POST body size | 150KB | Per request |
| GET response size | 150KB | Per request |
| HTTP timeout | 5s | Per request |
| Execution timeout | 5s | Per eval |
| Memory limit | 128MB | Per execution context |

## Current Implementation

### STDIO Interface

The current implementation provides an interactive REPL for local development:

```bash
node index.js
```

**Example session:**
```javascript
> 2 + 2
=> 4

> const x = 10; x * 2
=> 20

> fetch('api.github.com/zen').then(r => r.body)
=> "Design for failure."

> console.log('Hello from QuickJS!')
Hello from QuickJS!

> quit
```

### Available Sandbox Globals

- `console.log(...args)` - Print output to console
- `fetch(url)` - HTTP GET request (returns `{status, statusText, headers, body}`)
- `post(url, body)` - HTTP POST request with form-encoded body

**Note:** URLs without protocols are automatically prefixed with `https://`

## Development Workflow

### Adding Dependencies

Since this project is designed to work with Nix (from soyslopdrop parent), **never run `npm install` directly**. Instead:

```bash
npm install --package-lock-only <package>
# Then exit and re-enter nix develop shell
```

For standalone development without Nix:
```bash
npm install
npm start
```

### Testing

Run the STDIO interface:
```bash
npm start
```

Or directly:
```bash
node index.js
```

## Next Phase: AT Protocol Integration

### Goal

Transform smegmascript from a STDIO tool into a Bluesky bot that responds to mentions with evaluated JavaScript code.

### Architecture for Scale

AT Protocol operates at massive scale (20M+ users on Bluesky). Our architecture must handle:

```
┌────────────────────────────────────────────────────┐
│           AT Protocol Firehose                     │
│         (All network events)                       │
└────────────────┬───────────────────────────────────┘
                 │
                 ├─► Filter: Mentions of bot account
                 │
┌────────────────▼───────────────────────────────────┐
│        Message Queue (Redis/BullMQ)                │
│    - Job persistence                               │
│    - Priority queue                                │
│    - Backpressure handling                         │
└────────────────┬───────────────────────────────────┘
                 │
                 ├─► Worker Pool (horizontal scaling)
                 │
┌────────────────▼───────────────────────────────────┐
│         Worker Instances                           │
│    - Per-user rate limiting                        │
│    - QuickJS sandbox per eval                      │
│    - Stateless design                              │
└────────────────┬───────────────────────────────────┘
                 │
                 ├─► Post reply via AT Protocol
                 │
┌────────────────▼───────────────────────────────────┐
│        Bluesky (AT Protocol)                       │
│    - 300 grapheme limit                            │
│    - Reply threading                               │
└────────────────────────────────────────────────────┘
```

### Implementation Steps

#### 1. Add AT Protocol Dependencies

```bash
npm install --package-lock-only @atproto/api
```

#### 2. Authentication Setup

AT Protocol supports two authentication methods:
- **App passwords**: Simple, suitable for bots
- **OAuth**: More complex, better for user-facing apps

```javascript
const { BskyAgent } = require('@atproto/api');

const agent = new BskyAgent({
  service: 'https://bsky.social'
});

await agent.login({
  identifier: 'bot.bsky.social',
  password: 'app-password-here'
});
```

#### 3. Firehose Subscription

Subscribe to real-time events and filter for mentions:

```javascript
const { Jetstream } = require('@skyware/jetstream');

const jetstream = new Jetstream({
  wantedCollections: ['app.bsky.feed.post']
});

jetstream.on('commit', (event) => {
  if (event.commit.operation === 'create' &&
      event.commit.collection === 'app.bsky.feed.post') {
    const post = event.commit.record;

    // Check if bot is mentioned
    if (post.facets?.some(f => f.features?.some(
      feat => feat.$type === 'app.bsky.richtext.facet#mention' &&
              feat.did === botDid
    ))) {
      // Queue evaluation job
      queue.add('eval', {
        post: post,
        author: event.did,
        uri: event.commit.rkey
      });
    }
  }
});

jetstream.start();
```

#### 4. Parse Commands and Execute

Extract code from mentions and execute:

```javascript
async function processEvalJob(job) {
  const { post, author, uri } = job.data;

  // Extract code (remove mention, get remaining text)
  const code = extractCode(post.text);

  // Execute in sandbox
  const sandbox = new Sandbox({
    timeout: 5000,
    httpLimits: {
      requestsPerEval: 5,
      requestInterval: 60,
      requestLimit: 25,
      postLimit: 150000,
      transferLimit: 150000,
      timeLimit: 5000
    }
  });

  const result = await sandbox.execute(code, {
    channel: author  // Per-user rate limiting
  });

  // Format response
  let response;
  if (result.success) {
    response = formatResult(result.result, result.output);
  } else {
    response = `Error: ${result.error}`;
  }

  // Truncate to 300 grapheme limit
  response = truncateGraphemes(response, 300);

  // Post reply
  await agent.post({
    text: response,
    reply: {
      root: { uri: post.reply?.root?.uri || uri, cid: post.reply?.root?.cid || cid },
      parent: { uri, cid }
    }
  });

  sandbox.dispose();
}
```

#### 5. Rate Limiting Strategy

**Per-user limits:**
- Prevent individual users from DoS
- Track by DID (decentralized identifier)
- Implement cooldowns and quotas

**Global limits:**
- Protect against network-wide spam
- Queue depth monitoring
- Graceful degradation under load

#### 6. Message Queue Integration

Use BullMQ for job management:

```javascript
const { Queue, Worker } = require('bullmq');

const evalQueue = new Queue('eval', {
  connection: redisConnection
});

const worker = new Worker('eval', async (job) => {
  await processEvalJob(job);
}, {
  connection: redisConnection,
  concurrency: 10  // Process 10 jobs concurrently
});
```

### AT Protocol Specifics

#### Post Formatting

- **Grapheme limit**: 300 graphemes (not characters)
- Use `graphemer` package for accurate counting
- Truncate results intelligently (preserve error messages)

#### Reply Threading

Unlike IRC channels, AT Protocol uses reply chains:
- `root`: Original post that started the thread
- `parent`: Direct parent post being replied to
- Maintain thread context for multi-step interactions

#### Backpressure Handling

Critical at scale:
- Monitor queue depth
- Implement circuit breakers
- Return "busy" messages when overwhelmed
- Use priority queues for important users

## Troubleshooting

### QuickJS Promise Handling

Promises in QuickJS require manual job execution:

```javascript
// Execute pending jobs multiple times
await runtime.executePendingJobs();
await new Promise(resolve => setTimeout(resolve, 50));
await runtime.executePendingJobs();
```

See `sandbox.js:210-236` for full implementation.

### Memory Leaks

Always dispose QuickJS handles:

```javascript
const handle = vm.newString('test');
// ... use handle ...
handle.dispose();  // Critical!
```

### Rate Limit Testing

Test HTTP rate limits locally:

```javascript
> for(let i=0; i<6; i++) fetch('example.com')
Error: Too many HTTP requests in this eval (max 5 requests)
```

## Comparison with GypsFulvus

| Feature | GypsFulvus (IRC) | smegmascript (AT Proto) |
|---------|------------------|-------------------------|
| Language | Haskell | Node.js |
| Eval | TCL via pipe | JavaScript via QuickJS |
| Network | IRC protocol | AT Protocol (Firehose) |
| Channels | IRC channels | Reply threads |
| State | Per-channel state | Per-user state |
| Scale | ~100s users | ~millions potential |

## Related Projects

- **pillowtrucker/soyslopdrop**: Parent Nix flake with reproducible environment
- **pillowtrucker/slopdrop**: Rust/TCL implementation of similar concepts
- **GypsFulvus**: Original Haskell IRC bot inspiration

## License

AGPL-3.0 - See LICENSE file

## Contributing

1. Modify `package-lock.json` using `npm install --package-lock-only`
2. Test with STDIO interface: `node index.js`
3. Ensure no security vulnerabilities (no command injection, XSS, etc.)
4. Submit changes via pull request

## Critical Fixes Applied

### Per-User HTTP Rate Limiting Bug (Fixed)
**Issue:** The `sandbox.js` module hardcoded the channel to `'default'` in lines 46 and 100, breaking per-user HTTP rate limiting.

**Fix:** Modified `sandbox.js` to:
1. Store `currentChannel` in the Sandbox instance
2. Set `currentChannel` from the execution context in `execute()`
3. Use `self.currentChannel` in fetch/post closures instead of hardcoded `'default'`

**Impact:** HTTP requests are now properly rate-limited per user DID, preventing a single user from exhausting the shared rate limit pool.

**Testing:** Verified that `currentChannel` is correctly set from context parameter.

### Grapheme Counting (Improved)
**Issue:** Simple character-based truncation doesn't handle Unicode grapheme clusters correctly (emoji, combining characters).

**Fix:** Integrated `grapheme-splitter` library for accurate grapheme cluster counting.

**Impact:** Replies are correctly truncated to 300 graphemes as per AT Protocol specification, properly handling emoji and complex Unicode.

**Testing:** Verified with emoji strings (👍 x350) correctly truncating to exactly 300 graphemes.

## Implementation Status

### ✅ Completed Features

- [x] **AT Protocol firehose integration** - Using @skyware/jetstream for real-time event stream
- [x] **Redis-backed job queue** - BullMQ with Redis for production scalability
- [x] **Per-user rate limiting by DID** - 5-second cooldown per user with HTTP rate limits per channel
- [x] **Graceful shutdown with job completion** - SIGINT/SIGTERM handlers with queue draining
- [x] **Docker containerization** - Multi-stage Dockerfile with docker-compose.yml
- [x] **Admin commands for bot management** - !stats, !ping, !pause, !resume, !queue, etc.
- [x] **Proper grapheme counting** - Using grapheme-splitter for accurate 300-char limit
- [x] **Dual operation modes** - Direct mode (simple) and Queue mode (production)

### 🚧 Future Enhancements

- [ ] Persistent user state storage (database integration)
- [ ] Multi-worker horizontal scaling (requires orchestration)
- [ ] Metrics and monitoring (Prometheus/Grafana integration)
- [ ] Kubernetes deployment manifests
- [ ] Rate limit configuration per user/group
- [ ] Code execution history and analytics
- [ ] Web dashboard for bot monitoring
