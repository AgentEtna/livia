# Livia — AI Executive Assistant

Livia is a self-hosted, white-label AI executive assistant. She lives in a Gmail
inbox and handles scheduling, correspondence, research, and bookings on your
behalf — proposing meeting times, creating and rescheduling calendar invites,
drafting and sending replies, and keeping a lightweight CRM of the people you
deal with.

She is configured entirely through a web setup wizard — no code editing, and no
secrets are ever committed to the repo.

## How it works

A single Node.js / Express service (`server.js`) polls a dedicated Gmail inbox,
uses the Anthropic API to understand and draft messages, and acts through the
Gmail and Google Calendar APIs. A small web dashboard (`public/`) lets you
monitor activity and adjust settings. State is stored as JSON files on disk.

## Prerequisites

You'll need three things (the setup wizard links to each):

1. **A dedicated Gmail account for the assistant** — create a fresh one; this is
   the inbox Livia sends and receives from.
2. **An Anthropic API key** — from [console.anthropic.com](https://console.anthropic.com).
3. **A Google OAuth client** (type: Web application) from the
   [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   with the Gmail and Calendar APIs enabled and your redirect URI registered.

## Quick start

```bash
git clone <your-fork-url> livia
cd livia
npm install
npm start
```

On first run there's no configuration, so the app starts in **setup mode** and
prints a link. Open it (default `http://localhost:3000/setup`) and complete the
wizard:

1. **About you** — your name, brand, email address(es), phone.
2. **Your assistant** — its name and the dedicated Gmail address you created.
3. **AI & security** — your Anthropic API key and a dashboard password.
4. **Google** — your OAuth client ID/secret (the page shows the exact redirect
   URI to register).

Click **Save**, then **restart** the app so it picks up your Google credentials.
Return to `/setup`, click **Connect Gmail** and **Connect Calendar** to grant
access (tokens are saved automatically), then restart once more. Setup is
complete — the dashboard loads at `/` and Livia begins watching the inbox.

## Configuration

Everything the wizard collects is stored in `setup.json` on your own server
(git-ignored, never uploaded anywhere). If you prefer environment variables —
for example on a managed host — copy `.env.example` to `.env` and fill it in;
values in `setup.json` take precedence over environment variables.

## Deployment

Livia runs anywhere Node 18+ runs (Render, Railway, Fly, a VPS, …). For
persistent data across restarts, mount a writable disk at `/var/data` — the app
stores its JSON state and `setup.json` there when present, otherwise in the
working directory. Set `DASHBOARD_PASSWORD` and `ALLOWED_ORIGINS` in production.

## Security

Livia hardcodes no credentials; secrets live only in `setup.json` / `.env`,
both git-ignored. If a secret is ever exposed, rotate it at the provider — see
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).

## Connecting a simulator or harness (Agent Etna)

This agent exposes the same surface every Tabularum agent does, so a harness
needs no per-agent knowledge:

| | |
|---|---|
| `GET /health` | liveness, and whether a model is reachable |
| `GET /agent-card` | identity |
| `GET /tools` | the callable contract, as JSON Schema |
| `POST /task` | `{ goal }` — runs the reasoning loop, returns the answer and the full trace |
| `POST /chat` | the same loop, conversational shape |
| `POST /v1/chat/completions` | the same, in OpenAI response shape |

The chat endpoints accept `goal`, `task`, `message`, `input`, `prompt`,
`query`, `text`, `question`, `content`, or an OpenAI-style `messages` array,
and answer `400` naming what they accept rather than `500` when a body has
none of them. The reply is under `response`, and mirrored as `reply` and
`content`.

`/api/chat` is deliberately left to this repository's own handler.

### It runs with no configuration

The service boots and answers with nothing set at all, which is what a sandbox
gives it. Without a model key the reasoning endpoints return `ok: false` and
`stopReason: "no_llm_key"` rather than failing to start, so a harness sees a
live agent that is unconfigured instead of a dead process.

Set `OPENROUTER_API_KEY` to make it think.

### Authentication

`/task` and `/chat` run the model, so they are gated as soon as any of
`AGENT_TASK_TOKEN`, `AGENT_PASSWORD` or `DASHBOARD_PASSWORD` is set. The secret
may arrive as `Authorization: Bearer <secret>`, `X-Agent-Password` or
`X-Api-Key`.

With none of them set the endpoints are open. That is what makes a zero-config
sandbox work — and why any deployment reachable from the internet should set
one, or it is an unauthenticated endpoint spending your inference credit.
