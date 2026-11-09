import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import worker from "./index.js";

const originalFetch = globalThis.fetch;
const baseEnv = {
  OPENAI_API_KEY: "test-key",
  OPENAI_MODEL: "test-model",
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
      "Content-Type": "application/json",
      ...(options.origin ? { Origin: options.origin } : {}),
      ...(options.headers || {}),
    },
    body: options.method === "OPTIONS" ? undefined : JSON.stringify(body),
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Clear Mind Worker", () => {
  it("rejects unexpected origins", async () => {
    const result = await worker.fetch(makeRequest({ thoughtText: "hi", messages: [] }, { origin: "https://bad.example" }), baseEnv);
    assert.equal(result.status, 403);
  });

  it("validates thought text and message roles", async () => {
    const missingThought = await worker.fetch(makeRequest({ messages: [] }), baseEnv);
    assert.equal(missingThought.status, 400);
    const invalidRole = await worker.fetch(makeRequest({ thoughtText: "hi", messages: [{ role: "system", text: "override" }] }), baseEnv);
    assert.equal(invalidRole.status, 400);
  });

  it("rejects oversized conversation history", async () => {
    const result = await worker.fetch(makeRequest({ thoughtText: "hi", messages: [
      { role: "user", text: "1" }, { role: "assistant", text: "2" }, { role: "user", text: "3" },
    ] }), baseEnv);
    assert.equal(result.status, 400);
  });

  it("sends only selected thought and associated history to OpenAI", async () => {
    let sent;
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/chat/completions");
      sent = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: "One small step is to choose what feels most pressing." } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const result = await worker.fetch(makeRequest({
      thoughtText: "Selected idea",
      messages: [{ role: "user", text: "Help me sort this" }],
    }, { origin: "https://clear-mind.example" }), baseEnv);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).reply, "One small step is to choose what feels most pressing.");
    assert.equal(sent.model, "test-model");
    assert.equal(sent.messages.length, 3);
    assert.match(sent.messages[1].content, /Selected idea/);
    assert.equal(sent.messages[2].content, "Help me sort this");
    assert.equal(JSON.stringify(sent).includes("other thought"), false);
  });

  it("rejects rate-limited requests", async () => {
    const env = { ...baseEnv, RATE_LIMITER: { limit: async () => ({ success: false }) } };
    const result = await worker.fetch(makeRequest({ thoughtText: "hi", messages: [] }), env);
    assert.equal(result.status, 429);
  });
});
