export const GEMINI_CHARACTER_SERVER_URL = "http://127.0.0.1:8787/generate-character";
export const DEFAULT_GEMINI_CHARACTER_MODEL = "gemini-3.1-flash-image";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1/models";
const DEFAULT_TIMEOUT_MS = 25_000;

const SPRITE_PROMPT = `Convert the provided image into a 2D pixel-art game sprite. Preserve the subject's most recognizable visual features (shape, silhouette, colors, clothing, hairstyle, accessories, markings, and overall visual identity) while simplifying them into an extremely low-resolution 15×15 pixel design.

Interpret the subject as a game character rather than a cropped photograph. The output should represent the entire subject as a playable character sprite, not a direct pixelization of the source image.

If the reference image shows only part of the subject (headshot, portrait, close-up, upper body, or cropped animal), infer and generate a complete full-body version consistent with the visible features.

Allocate pixels to the entire body. Do not spend most of the resolution on the face or head. Even when the reference image is primarily a portrait, generate a complete head, torso, arms, and legs suitable for a retro game sprite. The head should occupy roughly 20–30% of the sprite height.

Prioritize silhouette recognition over facial detail. Clothing, posture, and overall shape are more important than eyes, nose, mouth, or other fine details.

Use a limited color palette, pixel-perfect square edges, and strong silhouette readability. No anti-aliasing, gradients, realistic textures, smooth lighting, 3D rendering, painterly effects, or direct image pixelization. Use a transparent background with no white, grey, checkerboard, or solid backdrop. The final result should appear as if a pixel artist intentionally designed a recognizable full-body character for a classic retro game at a true 15×15 pixel resolution.`;

export async function requestGeminiCharacterImage(payload, fetchImpl = globalThis.fetch, options = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is unavailable for character generation.");
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetchImpl(options.url || GEMINI_CHARACTER_SERVER_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        imageDataUrl: payload?.imageDataUrl,
        mimeType: payload?.mimeType
      }),
      signal: controller?.signal
    });

    let body = null;
    try {
      body = await response.json();
    } catch {
      throw new Error("Character generation service returned invalid JSON.");
    }

    if (!response.ok || body?.ok === false) {
      throw new Error(body?.error || `Character generation service failed with ${response.status}.`);
    }

    const imageDataUrl = normalizeGeneratedImageDataUrl(body?.imageDataUrl || body?.dataUrl);
    if (!imageDataUrl) {
      throw new Error("Character generation service did not return an image.");
    }

    return {
      imageDataUrl,
      mimeType: body?.mimeType || getDataUrlMimeType(imageDataUrl)
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function requestGeminiCharacterImageWithApiKey(payload, options = {}) {
  const apiKey = String(options.apiKey || "").trim();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const model = String(options.model || DEFAULT_GEMINI_CHARACTER_MODEL).trim();

  if (!apiKey) {
    throw new Error("Missing API key.");
  }

  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is unavailable for character generation.");
  }

  const image = parseImageDataUrl(payload?.imageDataUrl, payload?.mimeType);
  const response = await fetchImpl(`${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: SPRITE_PROMPT },
          {
            inlineData: {
              mimeType: image.mimeType,
              data: image.base64
            }
          }
        ]
      }]
    })
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    throw new Error("Image generation service returned invalid JSON.");
  }

  if (!response.ok) {
    throw new Error(`Image generation request failed with HTTP ${response.status}.`);
  }

  return extractGeminiImage(body);
}

function parseImageDataUrl(imageDataUrl, fallbackMimeType) {
  if (typeof imageDataUrl !== "string") {
    throw new Error("Image data URL is missing.");
  }

  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(imageDataUrl);
  if (!match) {
    throw new Error("Use a PNG, JPEG, or WebP data URL.");
  }

  return {
    mimeType: normalizeMimeType(fallbackMimeType || match[1]),
    base64: match[2]
  };
}

function normalizeMimeType(value) {
  const lowered = String(value || "").toLowerCase();
  if (lowered === "image/jpg") {
    return "image/jpeg";
  }

  return ["image/png", "image/jpeg", "image/webp"].includes(lowered)
    ? lowered
    : "image/png";
}

function extractGeminiImage(body) {
  const parts = body?.candidates?.[0]?.content?.parts || [];

  for (const part of parts) {
    const inlineData = part?.inlineData || part?.inline_data;
    const data = inlineData?.data;
    const mimeType = normalizeGeneratedImageMimeType(inlineData?.mimeType || inlineData?.mime_type);

    if (typeof data === "string" && data) {
      return {
        imageDataUrl: `data:${mimeType};base64,${data}`,
        mimeType
      };
    }
  }

  const text = getGeminiText(parts);
  const finishReason = body?.candidates?.[0]?.finishReason || body?.candidates?.[0]?.finish_reason || "";
  const reason = [finishReason && `finishReason=${finishReason}`, text].filter(Boolean).join(": ");
  throw new Error(reason ? `Image generation service did not return an image: ${reason}` : "Image generation service did not return an image.");
}

function getGeminiText(parts) {
  return parts
    .map((part) => typeof part?.text === "string" ? part.text.trim() : "")
    .filter(Boolean)
    .join(" ")
    .slice(0, 280);
}

function normalizeGeneratedImageDataUrl(value) {
  if (typeof value !== "string") {
    return "";
  }

  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(value.trim());
  if (!match) {
    return "";
  }

  return `data:${normalizeGeneratedImageMimeType(match[1])};base64,${match[2]}`;
}

function normalizeGeneratedImageMimeType(value) {
  const lowered = String(value || "").toLowerCase();
  if (lowered === "image/jpg") {
    return "image/jpeg";
  }

  return ["image/png", "image/jpeg", "image/webp"].includes(lowered)
    ? lowered
    : "image/png";
}

function getDataUrlMimeType(value) {
  return /^data:([^;]+);base64,/i.exec(value)?.[1] || "image/png";
}
