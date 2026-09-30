# Messaging Agent POC

Bun/TypeScript proof of concept for an AI coding assistant on Telegram, WhatsApp, and LINE. It uses Markdown skills, OpenAI-compatible Responses API tool calling, read-only GitHub source tools, and optional local session memory.

## Channel recommendation

**Telegram is the recommended default for internal developer assistants.** Its Bot API has a straightforward webhook secret and normal `sendMessage` calls without an expiring reply token.

WhatsApp is also supported and is usually a better fit than LINE when the intended users already work in WhatsApp. It requires Meta Business onboarding and is still subject to WhatsApp's customer-service window, template, and pricing rules.

**LINE is not recommended for long-running agent tasks.** A LINE reply token is single-use and should be used within one minute. Production webhook ingress should target an acknowledgement within three seconds as an engineering target; that is not a documented LINE SLA, and this synchronous POC does not guarantee it. A slow model or tool run can outlive the useful reply-token window and require an asynchronous push message. LINE reply messages themselves do not consume the monthly message quota, but push-message fallbacks do. That combination makes LINE more restrictive and potentially more expensive for coding-agent workloads than Telegram, and often than WhatsApp.

## Run

```sh
cp .env.local.example .env.local
bun run dev
```

Configure at least one complete messaging provider block. Unused provider blocks must remain entirely blank.

Endpoints:

- `GET /health`
- `POST /telegram/webhook`
- `GET /whatsapp/webhook` for Meta's verification challenge
- `POST /whatsapp/webhook`
- `POST /line/webhook`

All inbound provider requests are authenticated before their JSON body is processed:

- Telegram checks `X-Telegram-Bot-Api-Secret-Token`.
- WhatsApp checks `X-Hub-Signature-256` against the exact raw body with the Meta App Secret.
- LINE checks `x-line-signature` against the exact raw body with HMAC-SHA256 and the channel secret.

## Telegram setup

Set these values in `.env.local`:

```dotenv
TELEGRAM_BOT_TOKEN=replace-with-botfather-token
TELEGRAM_WEBHOOK_SECRET=replace-with-a-random-secret
TELEGRAM_ALLOWED_USER_IDS=123456789
TELEGRAM_API_BASE_URL=https://api.telegram.org
```

Telegram access is deny-by-default. Send `/whoami` to the bot to see your own
Telegram user ID, then add that numeric ID to `TELEGRAM_ALLOWED_USER_IDS`.
Separate multiple IDs with commas. Unauthorized users receive only their own ID;
their messages never reach session memory, OpenAI, or GitHub.

Expose the server over HTTPS, then register the webhook. Telegram accepts only `A-Z`, `a-z`, `0-9`, `_`, and `-` in the webhook secret.

```sh
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://agent.example.com/telegram/webhook",
    "secret_token": "replace-with-the-same-webhook-secret",
    "allowed_updates": ["message"]
  }'
```

The Bot API token is part of Telegram's request URL. Avoid saving the expanded command in shell history or logs.

## WhatsApp setup

Create a Meta app with the WhatsApp product and configure:

```dotenv
WHATSAPP_ACCESS_TOKEN=replace-with-system-user-or-test-token
WHATSAPP_PHONE_NUMBER_ID=replace-with-phone-number-id
WHATSAPP_VERIFY_TOKEN=replace-with-your-own-random-verification-token
WHATSAPP_APP_SECRET=replace-with-meta-app-secret
WHATSAPP_API_BASE_URL=https://graph.facebook.com/v26.0
```

In the Meta App Dashboard, set the callback URL to `https://agent.example.com/whatsapp/webhook`, enter the same `WHATSAPP_VERIFY_TOKEN`, and subscribe the WhatsApp Business Account to the `messages` field. The GET verification request returns `hub.challenge`; POST deliveries are validated with the App Secret before processing.

`WHATSAPP_API_BASE_URL` is configurable because Graph API versions expire. Update it to a currently supported version when upgrading the deployment.

## LINE setup

```dotenv
LINE_CHANNEL_SECRET=replace-with-line-channel-secret
LINE_CHANNEL_ACCESS_TOKEN=replace-with-line-channel-access-token
LINE_API_BASE_URL=https://api.line.me
```

Set the Messaging API webhook URL to `https://agent.example.com/line/webhook`. The implementation uses the one-time reply token and does not automatically fall back to a quota-consuming push message.

## Cloudflare Worker deployment

The production Worker is configured in `wrangler.jsonc` with:

- Custom Domain: `https://agent.pakzartl.xyz`
- Worker name: `poc-line-agent`
- KV-backed session memory through the `SESSION_MEMORY` binding
- Workers logs and sampled traces enabled

Authenticate, generate binding types, validate the bundle, and deploy:

```sh
bunx wrangler login --use-keyring
bun run worker:types
bun run typecheck:worker
bun run worker:dry-run
bun run worker:deploy
```

Upload secrets with `wrangler secret put` or `wrangler secret bulk`; never add their values to `wrangler.jsonc`. The required production secrets are:

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_ALLOWED_USER_IDS`
- `OPENAI_API_KEY`
- `GITHUB_TOKEN`

After deployment, register `https://agent.pakzartl.xyz/telegram/webhook` with Telegram and `https://agent.pakzartl.xyz/line/webhook` with LINE. LINE also requires **Use webhook** to be enabled in the Messaging API channel settings.

## Local sandbox

Run a full local loop without LINE, OpenAI, or GitHub credentials:

```sh
bun run sandbox
```

Run the same local UI with real OpenAI and GitHub credentials from `.env.local`:

```sh
bun run sandbox:live
```

The browser sandbox currently simulates LINE ingress so it can exercise signature verification and reply-token behavior locally. Live mode still captures the final reply locally; it does not send a response to a real chat. The automated sandbox suite runs full webhook-to-reply loops for LINE, Telegram, and WhatsApp, while keeping every external service mocked.

Conversation memory is opt-in in the sandbox UI. When enabled, recent user and assistant messages are persisted under `.sessions/<hashed-session-id>/memory.json`. The provider-qualified session ID is hashed and is never used directly as a directory name. Reset session clears that sandbox session's memory.

Open [http://127.0.0.1:3101](http://127.0.0.1:3101), or send a request directly:

```sh
curl -s -X POST http://127.0.0.1:3101/sandbox/send \
  -H 'Content-Type: application/json' \
  -d '{"text":"why does login fail?"}'
```

Inspect captured traces:

```sh
curl -s http://127.0.0.1:3101/sandbox/traces
```

Run the automated full-loop test:

```sh
bun run test:sandbox
```

Defaults:

- Real app: `http://127.0.0.1:3100`
- Sandbox UI, mocks, and LINE reply capture: `http://127.0.0.1:3101`
- Override with `PORT`, `SANDBOX_PORT`, or `LINE_CHANNEL_SECRET`.
- Both sandbox servers bind to `127.0.0.1` only.

## Shared environment

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL` defaults to `https://api.openai.com/v1`. For OpenRouter, use `https://openrouter.ai/api/v1` and an OpenRouter model slug.
- `OPENAI_MODEL` defaults to `gpt-5.4-mini`.
- `OPENAI_MAX_TOOL_ROUNDS` defaults to `20`; the model stops earlier as soon as it can answer.
- `GITHUB_TOKEN` with read-only repository contents/search access.
- `TELEGRAM_ALLOWED_USER_IDS` is a comma-separated allowlist of numeric Telegram
  user IDs. An empty list denies all agent access except `/whoami`.
- `SESSION_MEMORY_DIR` defaults to `.sessions`.
- `SESSION_MEMORY_MAX_MESSAGES` defaults to `12` messages (six user/assistant turns).

## Skills

Skills live in `src/skills/*.md`. The backend selects one skill from the incoming question, loads the Markdown text as instructions, and injects it into the model instructions.

Included skills:

- `repo-overview.md`
- `find-code.md`
- `explain-code.md`
- `trace-feature.md`
- `recent-changes.md`
- `commit-review.md`
- `pr-review.md`
- `bug-investigator.md`
- `test-finder.md`
- `missing-tests.md`
- `dependency-check.md`
- `security-review.md`
- `config-explainer.md`
- `api-catalog.md`
- `database-map.md`
- `architecture-map.md`
- `onboarding-guide.md`
- `release-summary.md`
- `incident-triage.md`
- `repo-comparison.md`

## Tools

The model can request:

- `list_repositories()`
- `github_get(path)` for allowlisted GitHub REST GET endpoints
- `search_code(repository, query)`
- `read_file(repository, path)`
- `get_commit(repository, sha)`

All GitHub requests are made by the backend with HTTP `GET` only. External URLs,
redirects, and mutation tools are blocked. Tokens are never included in model
input or chat replies.

Responses are sent with `store: false`; only bounded tool output is returned to the model.
