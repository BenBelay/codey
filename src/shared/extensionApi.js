export const extensionApi = globalThis.browser || globalThis.chrome || null;

export function getExtensionUrl(path) {
  return extensionApi?.runtime?.getURL?.(path) || path;
}

export function addInstalledListener(listener) {
  extensionApi?.runtime?.onInstalled?.addListener?.(listener);
}

export function addMessageListener(listener) {
  extensionApi?.runtime?.onMessage?.addListener?.(listener);
}

export function addTabActivatedListener(listener) {
  extensionApi?.tabs?.onActivated?.addListener?.(listener);
}

export function sendTabMessage(tabId, message) {
  if (!extensionApi?.tabs?.sendMessage) {
    return Promise.resolve(null);
  }

  return Promise.resolve(extensionApi.tabs.sendMessage(tabId, message));
}

export function hasRuntimeMessaging() {
  return Boolean(extensionApi?.runtime?.sendMessage);
}

export function sendRuntimeMessage(message) {
  if (!hasRuntimeMessaging()) {
    return Promise.reject(new Error("Extension runtime messaging is unavailable."));
  }

  return Promise.resolve(extensionApi.runtime.sendMessage(message));
}

export function storageGet(keys) {
  if (!extensionApi?.storage?.local?.get) {
    return Promise.resolve({});
  }

  return Promise.resolve(extensionApi.storage.local.get(keys));
}

export function storageSet(items) {
  if (!extensionApi?.storage?.local?.set) {
    return Promise.resolve();
  }

  return Promise.resolve(extensionApi.storage.local.set(items));
}

export function storageRemove(keys) {
  if (!extensionApi?.storage?.local?.remove) {
    return Promise.resolve();
  }

  return Promise.resolve(extensionApi.storage.local.remove(keys));
}
