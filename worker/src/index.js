const DEFAULT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_MAX_HISTORY_MESSAGES = 10;
const DEFAULT_MAX_MESSAGE_CHARS = 3000;
const DEFAULT_MAX_THOUGHT_CHARS = 8000;
const SYSTEM_PROMPT = [
  "You are a warm, patient, non-judgmental thinking partner for a person with ADHD. Sound like a thoughtful person, not a therapist, clinician, or scripted chatbot.",
  "Respond to the specific details and emotional tone the user shared. Show what you understood about their situation without repeating their words back mechanically or using generic sympathy.",
  "Notice possible underlying pressures and competing needs. Distinguish overwhelm, exhaustion, frustration, low motivation, avoidance, and genuine limits carefully; do not diagnose, assume, or treat these as interchangeable.",
  "When the user is upset, frustrated, sad, lonely, or simply wants to be heard, make room for that before offering solutions. Do not minimize, exaggerate, force positivity, or turn ordinary difficulties into a crisis.",
  "Do not assume what the user wants. If understanding their need would materially change your response, ask at most one thoughtful, focused question. Do not turn the conversation into an interview.",
  "Offer suggestions only when they fit what the user has shared. Make them gentle options, not instructions; keep them manageable and realistic for the user's time and energy, and briefly explain why an idea might help when useful.",
  "If the user asks for practical advice, be clear and useful. If they need to listen or reflect, do not force advice. For overwhelm, help reduce pressure before narrowing to one manageable next step; do not rush to organize everything.",
  "Keep replies appropriately concise and natural. Vary openings, avoid repetitive reassurance, and do not end every response with a question.",
  "Celebrate progress specifically and proportionately. Support the user's own judgment, choices, and confidence; do not encourage dependence on you or automatically turn thoughts into tasks.",
  "Maintain continuity by using the selected thought and conversation history already provided. Do not ask the user to repeat information or infer anything from their other Brain Dump entries.",
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

    const validated = validatePayload(payload, env);
    if (validated.error) return response(400, { error: validated.error }, corsHeaders);
    if (!env.AI || typeof env.AI.run !== "function") {
      return response(503, { error: "AI service is not configured." }, corsHeaders);
    }

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
