import test from "node:test";
import assert from "node:assert/strict";
import { createGeminiApiKeyStore, GEMINI_API_KEY } from "../src/shared/geminiApiKeyStore.js";

test("API key store writes only to provided extension storage", async () => {
  const writes = [];
  const removes = [];
  const store = createGeminiApiKeyStore({
    storageGet: async () => ({}),
    storageSet: async (items) => writes.push(items),
    storageRemove: async (keys) => removes.push(keys)
  });

  await store.set("  test-key  ");

  assert.equal(await store.get(), "test-key");
  assert.equal(await store.has(), true);
  assert.deepEqual(writes, [{ [GEMINI_API_KEY]: "test-key" }]);

  await store.clear();

  assert.equal(await store.get(), "");
  assert.equal(await store.has(), false);
  assert.deepEqual(removes, [[GEMINI_API_KEY]]);
});

test("API key store falls back to service-worker memory", async () => {
  const store = createGeminiApiKeyStore({
    storageGet: async () => {
      throw new Error("storage unavailable");
    },
    storageSet: async () => {
      throw new Error("storage unavailable");
    },
    storageRemove: async () => {
      throw new Error("storage unavailable");
    }
  });

  await store.set("memory-key");

  assert.equal(await store.get(), "memory-key");

  await store.clear();

  assert.equal(await store.get(), "");
});

test("API key store rejects empty keys", async () => {
  const store = createGeminiApiKeyStore();

  await assert.rejects(() => store.set("   "), /Enter an API key/);
});
