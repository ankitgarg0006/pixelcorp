# Contributing to pixelcorp

Thanks for your interest in pixelcorp — your AI company as a cozy pixel office. Contributions of all kinds are welcome: bug fixes, new office props/activities, engine adapters, UI polish, and docs.

## Getting started

```bash
git clone https://github.com/ankitgarg0006/pixelcorp
cd pixelcorp
npm install
npm start          # serves the app at http://localhost:4310
```

Company data lives on your machine under `~/.pixelcorp/companies/<name>/`
(`company.json` = roster + settings, `messages.jsonl` = chat transcript,
`trace.jsonl` = raw engine trace for the Terminal tab). Delete a folder there — or
use the 🗑 on a company card — to remove one for good.

### Engines (no API key required)

By default employees run on the **Claude Code CLI** (`claude`) or **GitHub Copilot
CLI** (`copilot`) using your existing sign-in — no API key. Install/sign in once:

```bash
npm i -g @anthropic-ai/claude-code   # then run `claude` to sign in
npm i -g @github/copilot             # then run `copilot` to sign in
```

Anthropic / OpenAI-compatible API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) and
local **Ollama** also work — mix per employee in the Hire/Settings dialog.

## Project layout

```
server/
  index.js         HTTP + WebSocket server, REST routes, static assets
  orchestrator.js  the company brain: routes messages, runs delegation, persists
  providers.js     engine adapters (CLI / Anthropic / OpenAI-compatible) + CLI detect
  store.js         JSON-file persistence under ~/.pixelcorp
web/
  index.html       markup (office canvas, modals)
  app.js           pixel renderer + all client wiring (no framework)
  style.css        styles
bin/pixelcorp.js   entry point
```

## Conventions

- **Zero build.** No framework, no bundler, no TypeScript — plain ES-module
  JavaScript in the browser and Node. Keep it dependency-light.
- Match the surrounding code's style (compact, no semicolon-religion battles —
  follow the file you're editing).
- The pixel renderer is hand-authored in `web/app.js`. Office geometry, sprites,
  scenery, ambient roaming, and interactive props (`ACTIVITIES`) all live there.
- Chat is deliberately clean: tool calls / delegations are **ephemeral** (the
  work rail + Terminal tab), never written to the chat transcript. Don't leak raw
  prompts or tool I/O into the chat.

## Testing your change

There's no test runner yet; verify by driving the real app:

1. `npm start`, open `http://localhost:4310`, and exercise the flow you changed.
2. Check the browser console for errors.
3. For renderer/UI work, sanity-check both a small team and a large one (the office
   grows with headcount), and a narrow window (< 1000px) for the responsive layout.

## Submitting a PR

1. Fork and create a topic branch (`fix/…`, `feat/…`).
2. Keep PRs focused; describe what changed and how you verified it (a screenshot or
   short clip helps for UI changes).
3. Make sure `node --check` passes on any files you touched and there are no console
   errors in the app.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](./LICENSE).
