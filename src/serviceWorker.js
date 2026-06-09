import { STORAGE_KEYS } from "./shared/constants.js";
import { sendLlmMessageToCompanion } from "./private/geminiBackend.js";
import {
  addInstalledListener,
  addMessageListener,
  addTabActivatedListener,
  sendTabMessage,
  storageGet,
  storageRemove,
  storageSet
} from "./shared/extensionApi.js";
import { createDefaultPreferences, normalizePreferences } from "./shared/preferences.js";
import { requestGeminiCharacterImageWithApiKey } from "./shared/geminiCharacterClient.js";
import { createGeminiApiKeyStore } from "./shared/geminiApiKeyStore.js";
import {
  attachSessionToState,
  createCompanionSession,
  normalizeCharacterState,
  normalizeCompanionSession
} from "./shared/state.js";

const geminiKeyStore = createGeminiApiKeyStore({
  storageGet,
  storageSet,
  storageRemove
});

addInstalledListener(async () => {
  const existing = await storageGet([
    STORAGE_KEYS.preferences,
    STORAGE_KEYS.characterSession
  ]);

  if (!existing[STORAGE_KEYS.preferences]) {
    await storageSet({
      [STORAGE_KEYS.preferences]: createDefaultPreferences()
    });
  } else {
    await storageSet({
      [STORAGE_KEYS.preferences]: normalizePreferences(existing[STORAGE_KEYS.preferences])
    });
  }

  if (!existing[STORAGE_KEYS.characterSession]) {
    const session = createCompanionSession();
    await storageSet({
      [STORAGE_KEYS.characterSession]: session
    });
  }
});

addTabActivatedListener(({ tabId }) => {
  sendTabMessage(tabId, {
    type: "companion:tab-activated",
    activatedAt: Date.now()
  }).catch(() => {
    // Content scripts are not available on browser pages and some restricted URLs.
  });
});

addMessageListener((message, sender, sendResponse) => {
  if (message?.type === "companion:claim") {
    claimCompanion(message.payload, sender)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: String(error?.message || error)
        });
      });
    return true;
  }

  if (message?.type === "companion:state") {
    saveCompanionState(message.payload, sender)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: String(error?.message || error)
        });
      });
    return true;
  }

  if (message?.type === "companion:chat") {
    getGeminiApiKey()
      .then((apiKey) => sendLlmMessageToCompanion(message.payload, { apiKey }))
      .then((response) => sendResponse({ ok: true, ...response }))
      .catch((error) => {
        sendResponse({
          ok: false,
          text: String(error?.message || "AI chat is unavailable right now."),
          error: String(error?.message || error)
        });
      });
    return true;
  }

  if (message?.type === "companion:gemini-key-set") {
    geminiKeyStore.set(message.payload?.apiKey)
      .then(() => sendResponse({ ok: true, hasKey: true }))
      .catch((error) => {
        sendResponse({
          ok: false,
          hasKey: false,
          error: String(error?.message || error)
        });
      });
    return true;
  }

  if (message?.type === "companion:gemini-key-clear") {
    geminiKeyStore.clear()
      .then(() => sendResponse({ ok: true, hasKey: false }))
      .catch((error) => {
        sendResponse({
          ok: false,
          hasKey: false,
          error: String(error?.message || error)
        });
      });
    return true;
  }

  if (message?.type === "companion:gemini-key-status") {
    geminiKeyStore.has()
      .then((hasKey) => sendResponse({ ok: true, hasKey }))
      .catch(() => sendResponse({ ok: true, hasKey: false }));
    return true;
  }

  if (message?.type === "companion:page-context") {
    storageSet({
      [STORAGE_KEYS.lastPageContext]: {
        ...message.payload,
        tabId: sender.tab?.id
      }
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "companion:generate-custom-skin") {
    getGeminiApiKey()
      .then((apiKey) => {
        if (!apiKey) {
          throw new Error("No saved API key.");
        }

        return requestGeminiCharacterImageWithApiKey(message.payload, { apiKey });
      })
      .then((image) => sendResponse({ ok: true, ...image }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: String(error?.message || error)
        });
      });
    return true;
  }

  return false;
});

async function claimCompanion(payload = {}, sender) {
  const now = Date.now();
  const stored = await storageGet([
    STORAGE_KEYS.characterState,
    STORAGE_KEYS.characterSession,
    STORAGE_KEYS.preferences
  ]);

  const fallbackState = payload.fallbackState || {};
  const storedCharacterState = stored[STORAGE_KEYS.characterState];
  const hadExistingCharacter = Boolean(storedCharacterState);
  const fallbackSession = createSessionFallback(storedCharacterState);
  let session = normalizeCompanionSession(stored[STORAGE_KEYS.characterSession], fallbackSession);
  const previousUrl = session.lastUrl || storedCharacterState?.currentUrl || "";

  if (payload.url && previousUrl && previousUrl !== payload.url) {
    session = {
      ...session,
      pageHops: session.pageHops + 1
    };
  }

  session = {
    ...session,
    lastUrl: payload.url || previousUrl,
    lastActiveAt: now,
    activeTabId: sender.tab?.id
  };

  const normalized = normalizeCharacterState(storedCharacterState, fallbackState);
  const characterState = attachSessionToState(normalized, session);

  await storageSet({
    [STORAGE_KEYS.characterSession]: session,
    [STORAGE_KEYS.characterState]: characterState
  });

  return {
    ok: true,
    characterState,
    characterSession: session,
    preferences: normalizePreferences(stored[STORAGE_KEYS.preferences]),
    hadExistingCharacter,
    previousUrl
  };
}

async function saveCompanionState(payload = {}, sender) {
  const now = Date.now();
  const stored = await storageGet([
    STORAGE_KEYS.characterSession
  ]);
  const session = normalizeCompanionSession(
    stored[STORAGE_KEYS.characterSession],
    createSessionFallback(payload)
  );
  const nextSession = {
    ...session,
    lastUrl: payload.currentUrl || session.lastUrl,
    lastActiveAt: now,
    activeTabId: sender.tab?.id
  };
  const characterState = attachSessionToState({
    ...payload,
    lastActiveAt: now
  }, nextSession);

  await storageSet({
    [STORAGE_KEYS.characterSession]: nextSession,
    [STORAGE_KEYS.characterState]: characterState
  });

  return {
    ok: true,
    characterState,
    characterSession: nextSession
  };
}

function createSessionFallback(characterState = {}) {
  if (typeof characterState.companionId === "string") {
    return {
      companionId: characterState.companionId,
      companionCreatedAt: Number.isFinite(characterState.companionCreatedAt)
        ? characterState.companionCreatedAt
        : Date.now(),
      pageHops: Number.isFinite(characterState.pageHops) ? characterState.pageHops : 0,
      lastUrl: typeof characterState.currentUrl === "string" ? characterState.currentUrl : "",
      lastActiveAt: Number.isFinite(characterState.lastActiveAt)
        ? characterState.lastActiveAt
        : Date.now()
    };
  }

  return createCompanionSession();
}

async function getGeminiApiKey() {
  return geminiKeyStore.get();
}
