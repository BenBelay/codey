import test from "node:test";
import assert from "node:assert/strict";
import {
  sendGeminiMessageToCompanion,
  sendLlmMessageToCompanion
} from "../src/private/geminiBackend.js";

test("AI backend request includes page context", async () => {
  const calls = [];
  const response = await sendGeminiMessageToCompanion({
    userMessage: "What is this page about?",
    pageContext: {
      title: "Example Product",
      url: "https://example.com/product",
      description: "A page about a browser companion extension.",
      headings: ["Overview", "Features"],
      visibleText: "Features include page-aware chat and Pomodoro support."
    },
    conversationHistory: [
      { role: "user", text: "Hi" },
      { role: "assistant", text: "Hi. I can help with this page." }
    ]
  }, {
    apiKey: "test-key",
    model: "gemini-test",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ text: "This page describes a browser companion extension." }]
            }
          }]
        })
      };
    }
  });

  assert.equal(response.provider, "gemini");
  assert.equal(response.model, "gemini-test");
  assert.equal(response.text, "This page describes a browser companion extension.");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-test:generateContent$/);
  assert.equal(calls[0].init.headers["x-goog-api-key"], "test-key");

  const body = JSON.parse(calls[0].init.body);
  assert.match(body.contents.at(-1).parts[0].text, /Example Product/);
  assert.match(body.contents.at(-1).parts[0].text, /page-aware chat/);
  assert.equal(body.contents[1].role, "model");
});

test("AI backend request rejects empty AI responses", async () => {
  await assert.rejects(
    sendGeminiMessageToCompanion({
      userMessage: "Hello"
    }, {
      apiKey: "test-key",
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ candidates: [] })
      })
    }),
    /empty response/
  );
});

test("sendLlmMessageToCompanion requires an API key for chat", async () => {
  await assert.rejects(
    sendLlmMessageToCompanion({
      userMessage: "What is this page about?",
      pageContext: {
        title: "Secure Keys",
        hostname: "example.com",
        visibleText: "This page explains how browser extensions should handle API keys safely."
      }
    }, {
      fetchImpl: async () => {
        throw new Error("should not call the AI backend without a key");
      }
    }),
    /Add an API key/
  );
});

test("sendLlmMessageToCompanion surfaces AI failures instead of returning local page text", async () => {
  await assert.rejects(
    sendLlmMessageToCompanion({
      userMessage: "What is this page about?",
      pageContext: {
        title: "Secure Keys",
        hostname: "example.com",
        visibleText: "This page explains how browser extensions should handle API keys safely."
      }
    }, {
      apiKey: "test-key",
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        json: async () => ({})
      })
    }),
    /AI request failed with HTTP 403/
  );
});
