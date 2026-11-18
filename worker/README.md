# Unravel — Cloudflare Workers AI Worker

This directory contains the Cloudflare Worker API used by Unravel's Explore with AI conversation in `index.html`. The browser sends only the selected Brain Dump thought, that thought's chat history, and task titles declined in that conversation; tasks and conversations remain in localStorage.

## What it does

- `POST /api/explore` accepts only `thoughtText`, `messages`, and `declinedTasks` (for example: `{ "thoughtText": "...", "messages": [{"role":"user|assistant","text":"..."}], "declinedTasks": ["A declined task title"] }`).
- It sends the selected thought, supplied history, and declined task titles to Cloudflare Workers AI. It does not read or receive other Brain Dump entries or the user's task list.
- Its system prompt requires a `[CONFIRM_TASK: ...]` question before an `[ADD_TASK: ...]` action, and preserves `[COMPLETE_TASK: ...]` for completion of an existing task. The frontend validates confirmation state and the user's affirmative response before adding; it removes machine markers from displayed text.
- It uses the Cloudflare Workers AI binding with `AI_MODEL` from `wrangler.toml`, currently `@cf/google/gemma-4-26b-a4b-it`. No OpenAI API key or OpenAI model setting is used.
- It validates JSON, message roles, field names, per-thought text lengths, history count, content type, and total request bytes.
- It uses Cloudflare's native Workers rate-limit binding, defaulting to 10 requests per IP per 60 seconds. This is a best-effort abuse safeguard with location-local counters, not a strict global quota or authentication.
- It allows browser origins listed in `ALLOWED_ORIGINS`; requests with a non-allowed `Origin` are rejected. CORS does not prevent non-browser clients from calling a public API.

No API key, `.env`, or local `.dev.vars` should be committed. The example file contains placeholders only.

## Prerequisites

- Node.js (current LTS recommended) and npm
- A Cloudflare account with Workers AI enabled
- Wrangler CLI (installed as a project dev dependency below)

Check Cloudflare Workers and Workers AI usage limits and pricing before deploying.

## Local setup and independent test

From the repository root:

```sh
cd worker
npm install
```

Start local Worker:

```sh
npm run dev
```

Wrangler serves the API at `http://localhost:8787` by default (confirm its output). In a second terminal, test a request. `Origin` below is the local origin allowed by `.dev.vars`:

```sh
curl -i http://localhost:8787/api/explore \
  -H 'Content-Type: application/json' \
  --data '{"thoughtText":"I have several things on my mind and I am not sure where to start.","messages":[]}'
```

A successful response is JSON with a `reply` string. The API does not save conversation history; each caller sends only that thought's own history. Test validation without an AI request, for example omit `thoughtText`, use an invalid role, exceed the configured size, or send an extra top-level field; these should return a 4xx response.

Test wrong origin rejection:

```sh
curl -i http://localhost:8787/api/explore \
  -H 'Origin: https://example.invalid' \
  -H 'Content-Type: application/json' \
  --data '{"thoughtText":"test","messages":[]}'
```

This should return 403. Requests made with curl and no Origin are accepted for independent backend testing; browser cross-origin access is restricted by CORS.

## Deploy to Cloudflare Workers

1. From `worker/`, authenticate Wrangler:

   ```sh
   npx wrangler login
   ```

2. Keep the existing public configuration in `wrangler.toml`:
   - `AI_MODEL`: the current Cloudflare Workers AI model identifier. Do not change it unless intentionally changing models.
   - `ALLOWED_ORIGINS`: comma-separated exact origins. The current value is the repository's GitHub Pages origin; keep localhost only for local testing, not production.
   - `MAX_REQUEST_BYTES`: total request body byte ceiling (default 65536).
   - `MAX_HISTORY_MESSAGES`, `MAX_MESSAGE_CHARS`, `MAX_THOUGHT_CHARS`: history and per-field limits. Up to 100 declined task titles are also accepted per conversation request.
   - Native rate limit: `[[ratelimits]]` `simple.limit` and `simple.period` in `wrangler.toml`. Cloudflare's supported period values are plan/runtime dependent; check current Workers rate-limit binding docs before changing it. The shipped config uses 10 requests / 60 seconds per IP key.

3. Deploy the Worker separately from the GitHub-hosted frontend:

   ```sh
   npx wrangler deploy
   ```

   The configured service name is `clear-mind-openai-worker`. Preserve it and the endpoint URL currently configured in `index.html` unless intentionally coordinating a URL change.

4. Test the deployed endpoint with the same JSON shape as above and an allowed GitHub Pages `Origin`. Verify invalid input and a deliberately disallowed origin fail.

Publishing a change to `index.html` does not deploy this Worker. Changes to `worker/src/index.js` require a separate Worker deployment; do not deploy automatically as part of reviewing or merging source changes.

## API contract

Request:

```json
{
  "thoughtText": "Only the selected thought text",
  "declinedTasks": ["A task declined earlier in this conversation"],
  "messages": [
    { "role": "user", "text": "A follow-up question" },
    { "role": "assistant", "text": "A prior reply" }
  ]
}
```

Response:

```json
{ "reply": "A concise, supportive response" }
```

The backend accepts no thought ID and stores no user data. The frontend selects the thought, its per-thought history, and declines from that same conversation locally. Do not send the full Brain Dump, the user's task list, or unrelated app data.

## Tests

Run the worker test suite from this directory:

```sh
npm test
```

Tests use Node's built-in test runner and stub the Workers AI binding; no production Worker or billable AI request is needed.

## Documentation references

- [Cloudflare Workers rate limiting bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
