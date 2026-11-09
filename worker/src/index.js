const DEFAULT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_MAX_HISTORY_MESSAGES = 10;
const DEFAULT_MAX_MESSAGE_CHARS = 3000;
const DEFAULT_MAX_THOUGHT_CHARS = 8000;
const SYSTEM_PROMPT = [
  "You are a patient, supportive, non-judgmental thinking partner for a person with ADHD.",
  "Help clarify and organize scattered thoughts. Keep replies concise, natural, and easy to understand.",
  "Do not turn conversations into interviews. Avoid unnecessary clarification questions.",
  "Ask at most one focused question when the answer is genuinely needed to help.",
  "Use the information the user has already provided instead of repeatedly asking them to explain themselves.",
  "When someone feels overwhelmed or doesn't know where to start, take the lead gently and suggest one practical first step.",
  "Break complicated problems into small, manageable actions. Reassure users that they do not have to do everything at once.",
  "Do not end every response with a question. Sometimes provide support, useful guidance, or simply listen.",
  "Let users explore feelings and ideas without requiring action. Never automatically turn a thought into a task.",
  "Use only the selected thought and conversation history included in this request. Do not ask for or infer the user's other Brain Dump entries.",
].join(" ");

function response(status, data, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
  });
}

function getCorsHeaders(origin, allowedOrigins) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (origin && allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

async function readJsonWithLimit(request, maxBytes) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > maxBytes) throw new RangeError("Request body is too large.");

  if (!request.body) throw new SyntaxError("Request body is required.");
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new RangeError("Request body is too large.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function validatePayload(payload, env) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Request body must be a JSON object." };
  }
  if (Object.keys(payload).some(key => !["thoughtText", "messages"].includes(key))) {
    return { error: "Request may contain only thoughtText and messages." };
  }

  const maxThoughtChars = Number(env.MAX_THOUGHT_CHARS || DEFAULT_MAX_THOUGHT_CHARS);
  const maxMessageChars = Number(env.MAX_MESSAGE_CHARS || DEFAULT_MAX_MESSAGE_CHARS);
  const maxHistoryMessages = Number(env.MAX_HISTORY_MESSAGES || DEFAULT_MAX_HISTORY_MESSAGES);
  const thoughtText = payload.thoughtText;
  if (typeof thoughtText !== "string" || !thoughtText.trim()) {
    return { error: "thoughtText must be a non-empty string." };
  }
  if (thoughtText.length > maxThoughtChars) {
    return { error: `thoughtText exceeds the ${maxThoughtChars} character limit.` };
  }

  const messages = payload.messages === undefined ? [] : payload.messages;
  if (!Array.isArray(messages)) return { error: "messages must be an array." };
  if (messages.length > maxHistoryMessages) {
    return { error: `Conversation history exceeds the ${maxHistoryMessages} message limit.` };
  }

  const cleanedMessages = [];
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message) ||
        Object.keys(message).some(key => !["role", "text"].includes(key))) {
      return { error: "Each message must contain only role and text." };
    }
    if (message.role !== "user" && message.role !== "assistant") {
      return { error: "Message role must be user or assistant." };
    }
    if (typeof message.text !== "string" || !message.text.trim()) {
      return { error: "Each message must have non-empty text." };
    }
    if (message.text.length > maxMessageChars) {
      return { error: `Each message must be at most ${maxMessageChars} characters.` };
    }
    cleanedMessages.push({ role: message.role, content: message.text });
  }

  return { value: { thoughtText: thoughtText.trim(), messages: cleanedMessages } };
}

export default {
  async fetch(request, env) {
    const allowedOrigins = (env.ALLOWED_ORIGINS || "")
      .split(",").map(origin => origin.trim()).filter(Boolean);
    const origin = request.headers.get("Origin");
    if (origin && !allowedOrigins.includes(origin)) {
      return response(403, { error: "Origin is not allowed." });
    }
    const corsHeaders = getCorsHeaders(origin, allowedOrigins);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    const url = new URL(request.url);
    if (url.pathname !== "/api/explore") return response(404, { error: "Not found." }, corsHeaders);
    if (request.method !== "POST") return response(405, { error: "Method not allowed." }, corsHeaders);
    if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
      return response(415, { error: "Content-Type must be application/json." }, corsHeaders);
    }

    const maxRequestBytes = Number(env.MAX_REQUEST_BYTES || DEFAULT_MAX_REQUEST_BYTES);
    let payload;
    try {
      payload = await readJsonWithLimit(request, maxRequestBytes);
    } catch (error) {
      if (error instanceof RangeError) return response(413, { error: "Request body is too large." }, corsHeaders);
      return response(400, { error: "Request body must be valid JSON." }, corsHeaders);
    }

    aiResult?.result?.choices?.[0]?.message?.content,

    if (!env.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== "function") {
      return response(503, { error: "Rate limiter is not configured." }, corsHeaders);
    }
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    let limitResult;
    try {
      limitResult = await env.RATE_LIMITER.limit({ key: ip });
    } catch {
      return response(503, { error: "Rate limiter is unavailable. Please try again later." }, corsHeaders);
    }
    if (!limitResult.success) {
      return response(429, { error: "Too many requests. Please wait before trying again." }, corsHeaders);
    }

    const model = env.AI_MODEL || DEFAULT_MODEL;
    let aiResult;
    try {
      aiResult = await env.AI.run(model, {
        max_tokens: 500,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Selected thought (the only Brain Dump context):\n${validated.value.thoughtText}` },
          ...validated.value.messages,
        ],
      });
    } catch {
      return response(502, { error: "Could not reach the AI service. Please retry." }, corsHeaders);
    }

        const reply = [
      aiResult?.response,
      aiResult?.choices?.[0]?.message?.content,
      aiResult?.result?.response,
      aiResult?.result?.choices?.[0]?.message?.content,
    ].find(value => typeof value === "string" && value.trim());
    if (typeof reply !== "string") {
      return response(502, { error: "The AI service returned no reply. Please retry." }, corsHeaders);
    }
    return response(200, { reply: reply.trim() }, corsHeaders);
  },
};
