# Clear Mind — OpenAI Cloudflare Worker (Stage 1)

This directory contains a standalone Cloudflare Worker API for Clear Mind's future Explore with AI frontend integration. It does **not** change or depend on `index.html`, Brain Dump data, tasks, planner data, or any browser localStorage keys. Stage 1 is backend-only; the current frontend is intentionally not connected.

## What it does

- `POST /api/explore` accepts only `{ "thoughtText": "...", "messages": [{"role":"user|assistant","text":"..."}] }`.
- It sends the selected thought and only the supplied history for that thought to OpenAI. It does not read or receive other Brain Dump entries.
- It uses `OPENAI_API_KEY` only as a server-side Worker secret and `OPENAI_MODEL` as a configurable model identifier. The default is `gpt-4o-mini`; select a model currently available to your OpenAI API account.
- It validates JSON, message roles, field names, per-thought text lengths, history count, content type, and total request bytes.
- It uses Cloudflare's native Workers rate-limit binding, defaulting to 10 requests per IP per 60 seconds. This is a best-effort abuse safeguard with location-local counters, not a strict global quota or authentication.
- It allows browser origins listed in `ALLOWED_ORIGINS`; requests with a non-allowed `Origin` are rejected. CORS does not prevent non-browser clients from calling a public API.

No API key, `.env`, or local `.dev.vars` should be committed. The example file contains placeholders only.

## Prerequisites

- Node.js (current LTS recommended) and npm
- A Cloudflare account on the Workers Free plan
- Wrangler CLI (installed as a project dev dependency below)
- An OpenAI API account with API billing enabled and a model available to that account

Cloudflare's free plan covers Worker requests within its then-current quota; OpenAI model usage is billed separately. Verify Cloudflare and OpenAI pricing/limits before deploying.

## Local setup and independent test

From the repository root:

```sh
cd worker
npm install
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` locally and replace the placeholder `OPENAI_API_KEY` with your key. `.dev.vars` is gitignored. Never paste the key into `wrangler.toml`, source code, GitHub, frontend files, or client storage.

Start local Worker:

```sh
npm run dev
```

Wrangler serves the API at `http://localhost:8787` by default (confirm its output). In a second terminal, test a request. `Origin` below is the local origin allowed by `.dev.vars`:

```sh
curl -i http://localhost:8787/api/explore \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:8788' \
  --data '{"thoughtText":"I have several things on my mind and I am not sure where to start.","messages":[]}'
```

A successful response is JSON with a `reply` string. The API does not save conversation history; each caller sends only that thought's own history. Test validation without spending an OpenAI request, for example omit `thoughtText`, use an invalid role, exceed the configured size, or send an extra top-level field; these should return a 4xx response. A valid request can incur OpenAI API usage.

Test wrong origin rejection:

```sh
curl -i http://localhost:8787/api/explore \
  -H 'Origin: https://example.invalid' \
  -H 'Content-Type: application/json' \
  --data '{"thoughtText":"test","messages":[]}'
```

This should return 403. Requests made with curl and no Origin are accepted for independent backend testing; browser cross-origin access is restricted by CORS.

## Configure and deploy to Cloudflare Workers Free

1. From `worker/`, authenticate Wrangler:

   ```sh
   npx wrangler login
   ```

2. Set the production key as an encrypted Worker secret. Wrangler prompts for the value; do not put it in a command argument or source file:

   ```sh
   npx wrangler secret put OPENAI_API_KEY
   ```

3. Set public, non-secret configuration in `wrangler.toml` (or Cloudflare dashboard):
   - `OPENAI_MODEL`: model ID enabled for your OpenAI API project. Default is `gpt-4o-mini`, not a claim that any specific newer model is supported.
   - `ALLOWED_ORIGINS`: comma-separated exact origins. The current value is the repository's GitHub Pages origin; keep localhost only for local testing, not production.
   - `MAX_REQUEST_BYTES`: total request body byte ceiling (default 65536).
   - `MAX_HISTORY_MESSAGES`, `MAX_MESSAGE_CHARS`, `MAX_THOUGHT_CHARS`: history and per-field limits.
   - Native rate limit: `[[ratelimits]]` `simple.limit` and `simple.period` in `wrangler.toml`. Cloudflare's supported period values are plan/runtime dependent; check current Workers rate-limit binding docs before changing it. The shipped config uses 10 requests / 60 seconds per IP key.

   `wrangler.toml` is public configuration, so never put credentials there. `OPENAI_API_KEY` must remain a secret binding.

4. Deploy:

   ```sh
   npx wrangler deploy
   ```

   Save the Worker URL printed by Wrangler. The endpoint is `https://<worker-name>.<account-subdomain>.workers.dev/api/explore`. This stage does not wire that URL into the frontend.

5. Test the deployed endpoint with the same JSON shape as above and an allowed GitHub Pages `Origin`. Verify missing/invalid input and a deliberately disallowed origin fail. Do not test by exposing or including the API key in the request.

## OpenAI billing safeguards

OpenAI API charges are separate from Cloudflare Workers, even when Workers usage stays within its free tier. Before sending real user requests:

1. In the OpenAI platform, open the organization/project billing and usage settings.
2. Add a payment method only if required for API access; create a dedicated project/API key for this Worker where available.
3. Set the tightest available project/org monthly budget or usage limit and enable email budget/usage notifications. Check whether each configured limit is a hard spending cap or only an alert: alerts may not stop requests immediately.
4. Review usage after tests and regularly thereafter. Revoke/rotate a key immediately if it may have been exposed.
5. Keep Worker request limits conservative. A public endpoint has no user authentication in Stage 1, and IP rate limits can be bypassed or shared. Do not treat them as a substitute for provider budgets or authorization.

OpenAI dashboard labels and limit behavior can change. Confirm the current controls in official OpenAI billing documentation before deployment; do not rely on a Worker limit alone to guarantee a maximum bill.

## API contract

Request:

```json
{
  "thoughtText": "Only the selected thought text",
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

The backend accepts no thought ID and stores no user data. The future frontend must select the thought and its per-thought chat history locally and send only those values. Do not send the full Brain Dump or unrelated app data.

## Tests

Run the worker test suite from this directory:

```sh
npm test
```

Tests use Node's built-in test runner and stub OpenAI fetch; no API key or billable API call is needed.

## Documentation references

- [Cloudflare Workers rate limiting bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat)
- [OpenAI billing and usage limits](https://help.openai.com/en/collections/6864547-billing)
