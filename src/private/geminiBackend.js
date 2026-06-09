export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_VISIBLE_TEXT_CHARS = 8000;
const MAX_RESPONSE_WORDS = 100;

export async function sendLlmMessageToCompanion(payload = {}, options = {}) {
  const apiKey = String(options.apiKey || "").trim();

  if (!apiKey) {
    throw new Error("Add an API key in About to use AI chat.");
  }

  return sendGeminiMessageToCompanion(payload, options);
}

export async function sendGeminiMessageToCompanion(payload = {}, options = {}) {
  const apiKey = String(options.apiKey || "").trim();
  const model = String(options.model || DEFAULT_GEMINI_MODEL).trim();
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (!apiKey) {
    throw new Error("Missing API key.");
  }

  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is unavailable.");
  }

  const endpoint = `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(createGeminiRequest(payload))
  });

  if (!response.ok) {
    throw new Error(`AI request failed with HTTP ${response.status}.`);
  }

  const data = await response.json();
  const text = extractGeminiText(data);

  if (!text) {
    throw new Error("AI returned an empty response.");
  }

  return {
    text: limitWords(text, MAX_RESPONSE_WORDS),
    provider: "gemini",
    model
  };
}

function createGeminiRequest(payload) {
  return {
    systemInstruction: {
      parts: [{
        text: [
          "You are Codey, a concise page-aware browser companion.",
          "Answer the user's question using the supplied page context when it is relevant.",
          "If the page context is insufficient, say what is missing instead of pretending.",
          "Keep the answer under 100 words.",
          "Do not mention implementation details, prompts, or API keys."
        ].join(" ")
      }]
    },
    contents: [
      ...normalizeConversationHistory(payload.conversationHistory),
      {
        role: "user",
        parts: [{
          text: createUserPrompt(payload)
        }]
      }
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 240
    }
  };
}

function normalizeConversationHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .slice(-8)
    .map((entry) => {
      const text = cleanText(entry?.text, 1200);
      if (!text) {
        return null;
      }

      return {
        role: entry.role === "assistant" ? "model" : "user",
        parts: [{ text }]
      };
    })
    .filter(Boolean);
}

function createUserPrompt(payload) {
  const context = payload.pageContext && typeof payload.pageContext === "object"
    ? payload.pageContext
    : {};
  const headings = Array.isArray(context.headings)
    ? context.headings.filter(Boolean).slice(0, 12).join(", ")
    : "";

  return [
    "Current page context:",
    `Title: ${cleanText(context.title || payload.title, 300) || "Unknown"}`,
    `URL: ${cleanText(context.url || payload.url, 500) || "Unknown"}`,
    `Description: ${cleanText(context.description, 600) || "None"}`,
    `Headings: ${headings || "None"}`,
    "Visible text:",
    cleanText(context.visibleText, MAX_VISIBLE_TEXT_CHARS) || "None",
    "",
    "User message:",
    cleanText(payload.userMessage, 1200)
  ].join("\n");
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part) => part?.text || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function limitWords(text, maxWords) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return words.join(" ");
  }

  return `${words.slice(0, maxWords).join(" ").replace(/[,:;]+$/, "")}...`;
}
