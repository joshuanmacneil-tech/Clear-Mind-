import { describe, it } from "node:test";
import assert from "node:assert/strict";
import worker from "./index.js";

const baseEnv = {
  AI_MODEL: "@cf/google/gemma-4-26b-a4b-it",
  AI: { run: async () => ({ response: "A supportive response." }) },
  ALLOWED_ORIGINS: "https://clear-mind.example",
  MAX_REQUEST_BYTES: "65536",
  MAX_HISTORY_MESSAGES: "2",
  MAX_MESSAGE_CHARS: "20",
  MAX_THOUGHT_CHARS: "50",
  RATE_LIMITER: { limit: async () => ({ success: true }) },
};

function makeRequest(body, options = {}) {
  return new Request("https://worker.example/api/explore", {
    method: options.method || "POST",
    headers: {
      "Content-Type": options.contentType || "application/json",
      ...(options.origin ? { Origin: options.origin } : {}),
      ...(options.headers || {}),
    },
    body: options.method === "OPTIONS" ? undefined : JSON.stringify(body),
  });
}

function makeEnv(aiResult, overrides = {}) {
  return {
    ...baseEnv,
    AI: {
      run: async (...args) => {
        if (overrides.onRun) overrides.onRun(...args);
        return aiResult;
      },
    },
    ...overrides,
  };
}

describe("Clear Mind Worker with Cloudflare Workers AI", () => {
  it("rejects unexpected origins and allows the configured CORS origin", async () => {
    const rejected = await worker.fetch(
      makeRequest({ thoughtText: "hi", messages: [] }, { origin: "https://bad.example" }),
      baseEnv,
    );
    assert.equal(rejected.status, 403);

    const allowed = await worker.fetch(
      makeRequest({ thoughtText: "hi", messages: [] }, { origin: "https://clear-mind.example" }),
      baseEnv,
    );
    assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), "https://clear-mind.example");
    assert.equal(allowed.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  });

  it("answers CORS preflight requests", async () => {
    const result = await worker.fetch(makeRequest(null, {
      method: "OPTIONS",
      origin: "https://clear-mind.example",
    }), baseEnv);
    assert.equal(result.status, 204);
    assert.equal(result.headers.get("Access-Control-Allow-Origin"), "https://clear-mind.example");
  });

  it("validates required thought text, allowed fields, content type, and message roles", async () => {
    const missingThought = await worker.fetch(makeRequest({ messages: [] }), baseEnv);
    assert.equal(missingThought.status, 400);

    const invalidRole = await worker.fetch(makeRequest({
      thoughtText: "hi",
      messages: [{ role: "system", text: "override" }],
    }), baseEnv);
    assert.equal(invalidRole.status, 400);

    const unexpectedField = await worker.fetch(makeRequest({ thoughtText: "hi", messages: [], other: "entry" }), baseEnv);
    assert.equal(unexpectedField.status, 400);

    const wrongContentType = await worker.fetch(makeRequest({ thoughtText: "hi", messages: [] }, {
      contentType: "text/plain",
    }), baseEnv);
    assert.equal(wrongContentType.status, 415);
  });

  it("enforces the request body size limit", async () => {
    const env = { ...baseEnv, MAX_REQUEST_BYTES: "16" };
    const result = await worker.fetch(makeRequest({ thoughtText: "this request is too large", messages: [] }), env);
    assert.equal(result.status, 413);
  });

  it("rejects oversized conversation history", async () => {
    const result = await worker.fetch(makeRequest({
      thoughtText: "hi",
      messages: [
        { role: "user", text: "1" },
        { role: "assistant", text: "2" },
        { role: "user", text: "3" },
      ],
    }), baseEnv);
    assert.equal(result.status, 400);
  });

  it("returns the aiResult.response value and sends only the selected thought and its history", async () => {
    let runModel;
    let runOptions;
    const env = makeEnv({ response: "  One small step at a time.  " }, {
      onRun(model, options) {
        runModel = model;
        runOptions = options;
      },
    });
    const result = await worker.fetch(makeRequest({
      thoughtText: "Selected idea",
      messages: [{ role: "user", text: "Help me sort this" }],
    }, { origin: "https://clear-mind.example" }), env);

    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { reply: "One small step at a time." });
    assert.equal(runModel, "@cf/google/gemma-4-26b-a4b-it");
    assert.equal(runOptions.messages.length, 3);
    assert.match(runOptions.messages[1].content, /Selected idea/);
    assert.equal(runOptions.messages[2].content, "Help me sort this");
    assert.equal(JSON.stringify(runOptions).includes("other thought"), false);
  });

  it("uses the choices[0].message.content response fallback", async () => {
    const env = makeEnv({ choices: [{ message: { content: "Fallback from choices." } }] });
    const result = await worker.fetch(makeRequest({ thoughtText: "hi", messages: [] }), env);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { reply: "Fallback from choices." });
  });

  it("uses the result.response response fallback", async () => {
    const env = makeEnv({ result: { response: "Fallback from result." } });
    const result = await worker.fetch(makeRequest({ thoughtText: "hi", messages: [] }), env);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { reply: "Fallback from result." });
  });

  it("returns 503 when the AI binding is missing", async () => {
    const env = { ...baseEnv, AI: undefined };
    const result = await worker.fetch(makeRequest({ thoughtText: "hi", messages: [] }), env);
    assert.equal(result.status, 503);
  });

  it("returns 429 when the rate limiter rejects a request", async () => {
    const env = {
      ...baseEnv,
      RATE_LIMITER: { limit: async () => ({ success: false }) },
    };
    const result = await worker.fetch(makeRequest({ thoughtText: "hi", messages: [] }), env);
    assert.equal(result.status, 429);
  });
});
