# smegmascript

Safe JavaScript eval bot for collaborative coding on AT Protocol (Bluesky).

## Features

- **Safe sandboxed execution** using QuickJS (WebAssembly)
- **HTTP networking** with rate limiting (based on smeggdrop limits)
- **STDIO interface** for local development and testing
- **Memory and timeout limits** to prevent DoS

## Installation

Since this project uses Nix for dependency management:

1. Update `package-lock.json`:
   ```bash
   cd smegmascript
   npm install --package-lock-only
   ```

2. Re-enter the Nix dev shell to build node_modules:
   ```bash
   exit
   nix develop
   ```

## Usage

### STDIO REPL (Local Testing)

Run the interactive REPL:

```bash
node index.js
# or
npm start
```

### AT Protocol Bot (Bluesky)

Run the bot that listens for mentions on Bluesky:

1. Create a configuration file:
   ```bash
   cp config.example.json config.json
   ```

2. Edit `config.json` with your bot credentials:
   ```json
   {
     "identifier": "your-bot-handle.bsky.social",
     "password": "your-app-password",
     "service": "https://bsky.social"
   }
   ```

   To create an app password:
   - Go to Settings → App Passwords on Bluesky
   - Create a new app password
   - Use it in the config file

3. Run the bot:
   ```bash
   node bot.js
   # or
   npm run bot
   ```

The bot will listen for mentions and execute JavaScript code in replies.

## Example Sessions

### STDIO REPL

```
> 2 + 2
=> 4

> console.log('Hello, world!')
Hello, world!

> const x = 10; x * 2
=> 20

> fetch('https://api.github.com/zen').then(r => r.body)
[Returns GitHub zen quote]

> quit
```

### Bluesky Bot Usage

Mention the bot in a post with JavaScript code:

```
@bot.bsky.social 2 + 2
```

The bot will reply with:
```
=> 4
```

More complex example:
```
@bot.bsky.social fetch('api.github.com/zen').then(r => r.body)
```

Reply:
```
=> "Design for failure."
```

With console output:
```
@bot.bsky.social console.log('Hello'); 'World'
```

Reply:
```
Hello
=> World
```

## Available Globals in Sandbox

- `console.log(...args)` - Print output
- `fetch(url)` - HTTP GET request
- `post(url, body)` - HTTP POST request

## Rate Limits

Based on smeggdrop configuration:

- **5 HTTP requests** per eval
- **25 HTTP requests** per 60 seconds (rolling window)
- **150KB** max POST body size
- **150KB** max GET response size
- **5 seconds** timeout per HTTP request
- **5 seconds** execution timeout
- **128MB** memory limit per execution

## Security

- Uses QuickJS compiled to WebAssembly for true isolation
- No filesystem access
- No network access except HTTP via `fetch()` and `post()`
- Execution timeout prevents infinite loops
- Memory limits prevent DoS
- HTTP rate limiting prevents abuse

## Architecture

### STDIO Interface
- `index.js` - STDIO REPL interface
- `sandbox.js` - QuickJS sandbox wrapper
- `http-limiter.js` - HTTP rate limiting logic

### AT Protocol Bot
- `bot.js` - Main bot entry point
- `atproto-client.js` - AT Protocol authentication and posting
- `firehose.js` - Real-time event stream subscriber
- `bot-worker.js` - Mention processing and code execution
- `command-parser.js` - Extract code from mentions and format results
- `config.json` - Bot credentials (not committed to git)

### Bot Flow

```
Bluesky Post with @mention
         ↓
Firehose (Jetstream)
         ↓
Mention detected → bot-worker.js
         ↓
Extract code → command-parser.js
         ↓
Execute in sandbox → sandbox.js (QuickJS)
         ↓
Format result → command-parser.js
         ↓
Post reply → atproto-client.js
         ↓
Reply appears on Bluesky
```
