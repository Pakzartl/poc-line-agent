# LINE Agent POC

Bun/TypeScript proof of concept for a LINE AI coding assistant that uses Markdown skills, OpenAI-compatible Responses API tool calling, and read-only GitHub source tools.

## Run

```sh
cp .env.local.example .env.local
bun run dev
```

Endpoints:

- `GET /health`
- `POST /line/webhook`

LINE webhook requests are verified against `x-line-signature` before JSON parsing. The verifier uses the exact raw request body with HMAC-SHA256 and `LINE_CHANNEL_SECRET`.

## Local Sandbox

Run a full local loop without LINE, OpenAI, or GitHub credentials:

```sh
bun run sandbox
```

Run the same local UI with real OpenAI and GitHub credentials from `.env.local`:

```sh
bun run sandbox:live
```

Live mode still captures the final LINE reply locally because the simulated webhook uses a local reply token. It does not send the sandbox response to a real LINE chat.

Conversation memory is opt-in in the sandbox UI. When enabled, recent user and assistant messages are persisted under `.sessions/<hashed-session-id>/memory.json`; the session ID is hashed so the LINE user ID is not used as a directory name. Reset session clears that sandbox session's memory.

The sandbox starts the real LINE agent plus local mocks for the OpenAI Responses API, GitHub REST, and LINE reply API. Send a signed simulated LINE webhook through the sandbox endpoint:

Open the browser UI at [http://127.0.0.1:3101](http://127.0.0.1:3101), or send a request directly:

```sh
curl -s -X POST http://127.0.0.1:3101/sandbox/send \
  -H 'Content-Type: application/json' \
  -d '{"text":"why does login fail?"}'
```

Inspect captured traces:

```sh
curl -s http://127.0.0.1:3101/sandbox/traces
```

Run the same full loop as an automated E2E test:

```sh
bun run test:sandbox
```

Defaults:

- Real app: `http://127.0.0.1:3100`
- Sandbox UI, mocks, and LINE reply capture: `http://127.0.0.1:3101`
- Override with `PORT`, `SANDBOX_PORT`, or `LINE_CHANNEL_SECRET`.
- Both sandbox servers bind to `127.0.0.1` only.

## Required Environment

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_API_BASE_URL` defaults to `https://api.line.me`.
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL` defaults to `https://api.openai.com/v1`. For OpenRouter, use `https://openrouter.ai/api/v1` and an OpenRouter model slug.
- `OPENAI_MODEL` defaults to `gpt-5.4-mini`.
- `OPENAI_MAX_TOOL_ROUNDS` defaults to `6`.
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_TOKEN` with read-only repository contents/search access.
- `GITHUB_REF` defaults to `main`.
- `SESSION_MEMORY_DIR` defaults to `.sessions`.
- `SESSION_MEMORY_MAX_MESSAGES` defaults to `12` messages (six user/assistant turns).

## Skills

Skills live in `src/skills/*.md`. The backend selects one skill from the incoming question, loads the Markdown text as instructions, and injects it into the model instructions.

Included skills:

- `debugging.md`
- `code-review.md`
- `architecture.md`

## Tools

The model can request:

- `search_code(query)`
- `read_file(path)`
- `get_commit(sha)`

All GitHub requests are made by the backend. Tokens are never included in model input or LINE replies.

Responses are sent with `store: false`; only bounded tool output is returned to the model.
