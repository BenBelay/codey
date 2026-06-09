import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const localEnv = loadLocalEnv();
const PORT = Number(readEnv("GEMINI_CHARACTER_PORT") || 8787);
const MODEL = readEnv("GEMINI_CHARACTER_MODEL") || "gemini-3.1-flash-image";
const MAX_BODY_BYTES = 6_500_000;
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1/models";

const spritePrompt = `Convert the provided image into a 2D pixel-art game sprite. Preserve the subject's most recognizable visual features (shape, silhouette, colors, clothing, hairstyle, accessories, markings, and overall visual identity) while simplifying them into an extremely low-resolution 15×15 pixel design.

Interpret the subject as a game character rather than a cropped photograph. The output should represent the entire subject as a playable character sprite, not a direct pixelization of the source image.

If the reference image shows only part of the subject (headshot, portrait, close-up, upper body, or cropped animal), infer and generate a complete full-body version consistent with the visible features.

Allocate pixels to the entire body. Do not spend most of the resolution on the face or head. Even when the reference image is primarily a portrait, generate a complete head, torso, arms, and legs suitable for a retro game sprite. The head should occupy roughly 20–30% of the sprite height.

Prioritize silhouette recognition over facial detail. Clothing, posture, and overall shape are more important than eyes, nose, mouth, or other fine details.

Use a limited color palette, pixel-perfect square edges, and strong silhouette readability. No anti-aliasing, gradients, realistic textures, smooth lighting, 3D rendering, painterly effects, or direct image pixelization. Use a transparent background with no white, grey, checkerboard, or solid backdrop. The final result should appear as if a pixel artist intentionally designed a recognizable full-body character for a classic retro game at a true 15×15 pixel resolution.`;

const server = http.createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      ok: true,
      hasKey: Boolean(readImageGenerationApiKey()),
      model: MODEL
    });
    return;
  }

  if (request.method !== "POST" || request.url !== "/generate-character") {
    sendJson(response, 404, { ok: false, error: "Not found." });
    return;
  }

  try {
    const apiKey = readImageGenerationApiKey();
    if (!apiKey) {
      throw new HttpError(500, "Missing image generation API key.");
    }

    const payload = await readJsonBody(request);
    const image = parseImageDataUrl(payload?.imageDataUrl, payload?.mimeType);
    const generatedImage = await generateCharacterImage(apiKey, image);

    sendJson(response, 200, {
      ok: true,
      ...generatedImage
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(response, status, {
      ok: false,
      error: String(error?.message || error)
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Character generation server listening on http://127.0.0.1:${PORT}`);
});

async function generateCharacterImage(apiKey, image) {
  const geminiResponse = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(MODEL)}:generateContent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: spritePrompt },
            {
              inlineData: {
                mimeType: image.mimeType,
                data: image.base64
              }
            }
          ]
        }
      ]
    })
  });

  let body = null;
  try {
    body = await geminiResponse.json();
  } catch {
    throw new HttpError(502, "Image generation service returned invalid JSON.");
  }

  if (!geminiResponse.ok) {
    throw new HttpError(geminiResponse.status, `Image generation request failed with HTTP ${geminiResponse.status}.`);
  }

  return extractImageFromGeminiResponse(body);
}

function extractImageFromGeminiResponse(body) {
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
  throw new HttpError(502, reason ? `Image generation service did not return an image: ${reason}` : "Image generation service did not return an image.");
}

function getGeminiText(parts) {
  return parts
    .map((part) => typeof part?.text === "string" ? part.text.trim() : "")
    .filter(Boolean)
    .join(" ")
    .slice(0, 280);
}

function parseImageDataUrl(imageDataUrl, fallbackMimeType) {
  if (typeof imageDataUrl !== "string" || imageDataUrl.length > MAX_BODY_BYTES) {
    throw new HttpError(400, "Image data URL is missing or too large.");
  }

  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(imageDataUrl);
  if (!match) {
    throw new HttpError(400, "Use a PNG, JPEG, or WebP data URL.");
  }

  const mimeType = normalizeMimeType(fallbackMimeType || match[1]);
  return {
    mimeType,
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

function normalizeGeneratedImageMimeType(value) {
  const lowered = String(value || "").toLowerCase();
  if (lowered === "image/jpg") {
    return "image/jpeg";
  }

  return ["image/png", "image/jpeg", "image/webp"].includes(lowered)
    ? lowered
    : "image/png";
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "Request body is too large."));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "Request body must be JSON."));
      }
    });

    request.on("error", reject);
  });
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json"
  });
  response.end(JSON.stringify(body));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readEnv(key) {
  return process.env[key] || localEnv[key] || "";
}

function readImageGenerationApiKey() {
  return readEnv("AI_API_KEY") || readEnv("GEMINI_API_KEY") || readEnv("GOOGLE_API_KEY");
}

function loadLocalEnv() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const envPath = resolve(projectRoot, ".env");

  try {
    return parseDotEnv(readFileSync(envPath, "utf8"));
  } catch {
    return {};
  }
}

function parseDotEnv(source) {
  const values = {};

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    values[key] = unquote(value);
  }

  return values;
}

function unquote(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
