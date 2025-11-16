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

Run the STDIO REPL:

```bash
cd smegmascript
node index.js
```

Or use npm script:

```bash
npm start
```

## Example Session

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

- `index.js` - STDIO REPL interface
- `sandbox.js` - QuickJS sandbox wrapper
- `http-limiter.js` - HTTP rate limiting logic
- `package.json` - Dependencies and configuration
