import test from "node:test";
import assert from "node:assert/strict";
import {
  requestGeminiCharacterImage,
  requestGeminiCharacterImageWithApiKey
} from "../src/shared/geminiCharacterClient.js";

test("character image request returns a generated image", async () => {
  const image = await requestGeminiCharacterImage({
    imageDataUrl: "data:image/png;base64,abc=",
    mimeType: "image/png"
  }, async () => createResponse(200, {
    ok: true,
    imageDataUrl: "data:image/png;base64,xyz="
  }));

  assert.equal(image.imageDataUrl, "data:image/png;base64,xyz=");
  assert.equal(image.mimeType, "image/png");
});

test("character image request rejects proxy errors", async () => {
  await assert.rejects(() => requestGeminiCharacterImage({}, async () => createResponse(500, {
    ok: false,
    error: "Missing image generation API key."
  })), /Missing image generation API key/);
});

test("character image request rejects proxy responses without images", async () => {
  await assert.rejects(() => requestGeminiCharacterImage({}, async () => createResponse(200, {
    ok: true,
    imageDataUrl: ""
  })), /did not return an image/);
});

test("character image request rejects invalid JSON responses", async () => {
  await assert.rejects(() => requestGeminiCharacterImage({}, async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("bad json");
    }
  })), /invalid JSON/);
});

test("direct character image request calls the image model with supplied user key", async () => {
  const calls = [];
  const image = await requestGeminiCharacterImageWithApiKey({
    imageDataUrl: "data:image/png;base64,abc=",
    mimeType: "image/png"
  }, {
    apiKey: "user-key",
    model: "gemini-test",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return createResponse(200, {
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                mimeType: "image/png",
                data: "generated="
              }
            }]
          }
        }]
      });
    }
  });

  assert.equal(image.imageDataUrl, "data:image/png;base64,generated=");
  assert.equal(image.mimeType, "image/png");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /generativelanguage\.googleapis\.com\/v1\/models\/gemini-test:generateContent$/);
  assert.equal(calls[0].init.headers["x-goog-api-key"], "user-key");

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.contents[0].parts[1].inlineData.mimeType, "image/png");
  assert.equal(body.contents[0].parts[1].inlineData.data, "abc=");
  assert.equal(body.generationConfig, undefined);
});

test("direct character image request surfaces text-only image responses", async () => {
  await assert.rejects(() => requestGeminiCharacterImageWithApiKey({
    imageDataUrl: "data:image/png;base64,abc=",
    mimeType: "image/png"
  }, {
    apiKey: "user-key",
    model: "gemini-test",
    fetchImpl: async () => createResponse(200, {
      candidates: [{
        finishReason: "STOP",
        content: {
          parts: [{ text: "I cannot generate that image." }]
        }
      }]
    })
  }), /finishReason=STOP: I cannot generate that image/);
});

test("direct character image request requires an API key", async () => {
  await assert.rejects(() => requestGeminiCharacterImageWithApiKey({
    imageDataUrl: "data:image/png;base64,abc=",
    mimeType: "image/png"
  }, {
    apiKey: ""
  }), /Missing API key/);
});

function createResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}
