const extensionApi = globalThis.browser || globalThis.chrome;

if (extensionApi?.runtime?.getURL) {
  import(extensionApi.runtime.getURL("src/contentMain.js")).catch((error) => {
    console.warn("[Pixel Website Companion] Failed to start", error);
  });
} else {
  console.warn("[Pixel Website Companion] Web Extensions runtime API is unavailable.");
}
