export const GEMINI_API_KEY = "companion.geminiApiKey";

export function createGeminiApiKeyStore({
  storageGet,
  storageSet,
  storageRemove,
  keyName = GEMINI_API_KEY
} = {}) {
  let memoryApiKey = "";

  return {
    async set(value) {
      const apiKey = normalizeGeminiApiKey(value);
      if (!apiKey) {
        throw new Error("Enter an API key.");
      }

      memoryApiKey = apiKey;

      if (typeof storageSet === "function") {
        try {
          await storageSet({ [keyName]: apiKey });
        } catch {
          // Memory fallback is intentional when extension storage is unavailable.
        }
      }
    },

    async clear() {
      memoryApiKey = "";

      if (typeof storageRemove === "function") {
        try {
          await storageRemove([keyName]);
        } catch {
          // Nothing else to clear when extension storage is unavailable.
        }
      }
    },

    async get() {
      if (typeof storageGet === "function") {
        try {
          const stored = await storageGet([keyName]);
          const apiKey = normalizeGeminiApiKey(stored?.[keyName]);
          if (apiKey) {
            memoryApiKey = apiKey;
            return apiKey;
          }
        } catch {
          // Fall through to in-memory key.
        }
      }

      return memoryApiKey;
    },

    async has() {
      return Boolean(await this.get());
    }
  };
}

function normalizeGeminiApiKey(value) {
  return typeof value === "string" ? value.trim() : "";
}
