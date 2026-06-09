import { CHARACTER, PORTAL, RAGE, STORAGE_KEYS, WORLD } from "./shared/constants.js";
import { collectPlatformRects } from "./shared/geometry.js";
import { getPageContext } from "./shared/pageContext.js";
import {
  createPageEnterTransition,
  createPortalTransition,
  createTabEnterTransition,
  isCharacterVisibleDuringPortal,
  shouldRunPhysicsDuringPortal,
  updatePortalTransition
} from "./shared/portalTransition.js";
import { getReaction, normalizeBlockedSites, normalizeHost } from "./shared/siteReactions.js";
import {
  addMessageListener,
  hasRuntimeMessaging,
  sendRuntimeMessage,
  storageGet,
  storageSet
} from "./shared/extensionApi.js";
import {
  CUSTOM_SKIN_PREFIX,
  mergePreferences,
  normalizePreferences,
  POMODORO_DEFAULT_SECONDS,
  SKIN_LABELS,
  SKINS
} from "./shared/preferences.js";
import {
  GEMINI_SKIN_GENERATOR_VERSION,
  CUSTOM_SKIN_SPRITE_HEIGHT,
  CUSTOM_SKIN_SPRITE_WIDTH,
  GEMINI_SPRITE_HEIGHT,
  GEMINI_SPRITE_WIDTH
} from "./shared/customSkinGenerator.js";
import { attachSessionToState, createDefaultCharacterState, normalizeCharacterState } from "./shared/state.js";
import { stepCharacter } from "./shared/physics.js";

const HOST_ID = "pixel-website-companion-root";

if (canInjectIntoPage()) {
  bootCompanion();
}

function canInjectIntoPage() {
  if (window.top !== window) {
    return false;
  }

  if (document.getElementById(HOST_ID)) {
    return false;
  }

  return document.documentElement && document.body;
}

async function bootCompanion() {
  const pageContext = getPageContext();
  let portalTransition = createPortalTransition();
  const fallbackState = createDefaultCharacterState(window.innerWidth, window.scrollY);
  const claimed = await claimCompanion(pageContext, fallbackState);
  const stored = claimed.storageFallback || {};

  let preferences = normalizePreferences(claimed.preferences || stored[STORAGE_KEYS.preferences]);
  if (preferences.enabled === false) {
    return;
  }
  let reaction = getReaction(pageContext, preferences.blockedSites);

  const storedCharacterState = claimed.characterState || stored[STORAGE_KEYS.characterState];
  let state = normalizeCharacterState(storedCharacterState, fallbackState);
  const shouldEnterFromDoor = Boolean(claimed.hadExistingCharacter || storedCharacterState?.currentUrl);

  if (!state.currentUrl || state.currentUrl !== location.href) {
    const carriedPosition = getCarriedViewportPosition(storedCharacterState, state);
    state = {
      ...state,
      x: clampToViewportX(window.scrollX + carriedPosition.x),
      y: clampToViewportY(window.scrollY + carriedPosition.y),
      currentUrl: location.href,
      animation: "fall"
    };
  } else {
    state = {
      ...state,
      x: clampToViewportX(state.x),
      y: clampToViewportY(state.y)
    };
  }

  if (shouldEnterFromDoor) {
    portalTransition = createPageEnterTransition(performance.now());
    state.animation = "idle";
  }

  if (claimed.characterSession) {
    state = attachSessionToState(state, claimed.characterSession);
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("data-pixel-companion", "true");
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = createStyles();

  const overlay = document.createElement("div");
  overlay.className = "companion-overlay";

  const stage = document.createElement("div");
  stage.className = "companion-stage";

  const spriteButton = document.createElement("button");
  spriteButton.className = "pixel-person";
  spriteButton.type = "button";
  spriteButton.setAttribute("aria-label", "Open pixel companion chat");
  spriteButton.dataset.animation = state.animation;
  spriteButton.dataset.direction = String(state.direction);
  spriteButton.dataset.mood = reaction.mood;

  const body = document.createElement("span");
  body.className = "pixel-body";
  body.setAttribute("aria-hidden", "true");
  spriteButton.append(body);

  const sword = document.createElement("span");
  sword.className = "pixel-sword";
  sword.setAttribute("aria-hidden", "true");
  spriteButton.append(sword);

  const clockAccessory = document.createElement("span");
  clockAccessory.className = "pixel-clock";
  clockAccessory.setAttribute("aria-hidden", "true");
  spriteButton.append(clockAccessory);

  const door = document.createElement("span");
  door.className = "portal-door";
  door.setAttribute("aria-hidden", "true");

  const panel = createCompanionPanel({
    pageContext,
    preferences,
    onHide: () => {
      persistPreferences({ hiddenInDoor: true, activePanelTab: "physics" });
      panel.close();
    },
    onGeminiKeyClear: clearGeminiKey,
    onGeminiKeySet: setGeminiKey,
    onGeminiKeyStatus: getGeminiKeyStatus,
    onPreferenceChange: persistPreferences,
    onSend: (userMessage, conversationHistory) => {
      const latestPageContext = getPageContext();
      return sendChatMessage({
        url: latestPageContext.url,
        title: latestPageContext.title,
        pageContext: latestPageContext,
        userMessage,
        conversationHistory
      });
    }
  });

  stage.append(door, spriteButton, panel.root);
  overlay.append(stage);
  shadow.append(style, overlay);

  const runtime = {
    platforms: [],
    cursor: null,
    lastFrameAt: performance.now(),
    lastGeometryAt: 0,
    lastPortalEnterAt: shouldEnterFromDoor ? portalTransition.phaseStartedAt : 0,
    lastPersistAt: 0,
    geometryQueued: false,
    destroyed: false,
    portalTransition,
    rageController: reaction.mood === "rage"
      ? createRageController({ doc: document, extensionHost: host, getJumpinessScale: () => preferences.jumpinessScale })
      : null
  };

  render();
  refreshGeometry();
  notifyPageContext(pageContext);

  spriteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (preferences.hiddenInDoor) {
      return;
    }
    if (runtime.portalTransition.status !== "inactive") {
      return;
    }
    panel.toggle();
  });

  door.addEventListener("click", (event) => {
    if (!preferences.hiddenInDoor) {
      return;
    }

    event.stopPropagation();
    persistPreferences({ hiddenInDoor: false });
  });

  let lastPanelPointerDownAt = -1;
  panel.root.addEventListener("pointerdown", (event) => {
    lastPanelPointerDownAt = event.timeStamp;
  }, { capture: true });

  window.addEventListener("pointerdown", (event) => {
    if (!panel.isOpen()) {
      return;
    }

    const pointerDown = {
      x: event.clientX,
      y: event.clientY,
      timeStamp: event.timeStamp
    };

    if (isPointInsideElement(pointerDown, panel.root) || isPointInsideElement(pointerDown, spriteButton)) {
      return;
    }

    window.setTimeout(() => {
      if (!panel.isOpen() || lastPanelPointerDownAt === pointerDown.timeStamp) {
        return;
      }

      if (isPointInsideElement(pointerDown, panel.root) || isPointInsideElement(pointerDown, spriteButton)) {
        return;
      }

      panel.close();
    }, 0);
  }, { capture: true });

  window.addEventListener("mousemove", (event) => {
    runtime.cursor = {
      x: event.clientX,
      y: event.clientY,
      at: performance.now()
    };
  }, { passive: true });

  window.addEventListener("scroll", queueGeometryRefresh, { passive: true });
  window.addEventListener("resize", queueGeometryRefresh, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      startPortalEntry("tab-change");
    }
  });

  addMessageListener((message) => {
    if (message?.type === "companion:tab-activated") {
      startPortalEntry("tab-change");
    }
  });

  const mutationObserver = new MutationObserver(queueGeometryRefresh);
  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "aria-hidden"]
  });

  window.addEventListener("pagehide", () => {
    runtime.destroyed = true;
    persistState(true);
  });

  requestAnimationFrame(tick);

  function tick(now) {
    if (runtime.destroyed) {
      mutationObserver.disconnect();
      runtime.rageController?.destroy();
      host.remove();
      return;
    }

    const dt = (now - runtime.lastFrameAt) / 1000;
    runtime.lastFrameAt = now;

    if (now - runtime.lastGeometryAt > WORLD.geometryRefreshMs) {
      refreshGeometry();
    }

    runtime.portalTransition = preferences.hiddenInDoor
      ? createPortalTransition()
      : updatePortalTransition(runtime.portalTransition, runtime.cursor, now);

    if (shouldRunPhysicsDuringPortal(runtime.portalTransition) && !panel.isOpen() && !preferences.hiddenInDoor) {
      if (runtime.rageController) {
        state = runtime.rageController.drive(state, now);
      }

      state = stepCharacter(state, runtime.platforms, getEnvironment(), dt);

      if (runtime.rageController) {
        state = runtime.rageController.afterMove(state, now);
      }
    } else {
      state = {
        ...state,
        vy: 0,
        animation: "idle"
      };
    }

    render();

    if (now - runtime.lastPersistAt > WORLD.statePersistMs) {
      persistState();
      runtime.lastPersistAt = now;
    }

    requestAnimationFrame(tick);
  }

  function getEnvironment() {
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      documentHeight: getDocumentHeight(),
      characterWidth: CHARACTER.width,
      characterHeight: CHARACTER.height,
      cursor: runtime.cursor
        ? {
            x: runtime.cursor.x + window.scrollX,
            y: runtime.cursor.y + window.scrollY
          }
        : null,
      speedScale: preferences.speedScale,
      jumpinessScale: preferences.jumpinessScale
    };
  }

  function render() {
    const viewportX = Math.round(state.x - window.scrollX);
    const viewportY = Math.round(state.y - window.scrollY);
    stage.style.transform = `translate3d(${viewportX}px, ${viewportY}px, 0)`;
    stage.dataset.portal = runtime.portalTransition.status;
    stage.dataset.hiddenDoor = String(preferences.hiddenInDoor);
    spriteButton.dataset.animation = state.animation;
    spriteButton.dataset.direction = String(state.direction);
    spriteButton.dataset.mood = reaction.mood;
    const selectedCustomSkin = getSelectedCustomSkin(preferences);
    spriteButton.dataset.skin = selectedCustomSkin ? "custom" : preferences.selectedSkin;
    spriteButton.dataset.accessory = preferences.clockEnabled ? "clock" : "none";
    spriteButton.dataset.clockMode = preferences.clockMode;
    spriteButton.dataset.portal = runtime.portalTransition.status;
    if (selectedCustomSkin) {
      spriteButton.style.setProperty("--custom-skin-image", `url(${selectedCustomSkin.dataUrl})`);
      applyCustomSkinDisplayVars(spriteButton, selectedCustomSkin);
    } else {
      spriteButton.style.removeProperty("--custom-skin-image");
      clearCustomSkinDisplayVars(spriteButton);
    }
    spriteButton.hidden = !preferences.hiddenInDoor && !isCharacterVisibleDuringPortal(runtime.portalTransition);
    door.dataset.portal = runtime.portalTransition.status;
    updateSpriteClock(clockAccessory, preferences);
    panel.position({
      direction: state.direction,
      viewportX,
      viewportY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    });
    panel.updateClock();
  }

  function persistPreferences(patch) {
    preferences = mergePreferences(preferences, patch);
    const nextReaction = getReaction(getPageContext(), preferences.blockedSites);
    reaction = nextReaction;
    if (reaction.mood === "rage" && !runtime.rageController) {
      runtime.rageController = createRageController({ doc: document, extensionHost: host, getJumpinessScale: () => preferences.jumpinessScale });
    } else if (reaction.mood !== "rage" && runtime.rageController) {
      runtime.rageController.destroy();
      runtime.rageController = null;
    }
    panel.setPreferences(preferences);
    render();

    const write = storageSet({
      [STORAGE_KEYS.preferences]: preferences
    });

    if (write?.catch) {
      write.catch(() => {});
    }
  }

  function startPortalEntry(kind) {
    const now = performance.now();

    if (now - runtime.lastPortalEnterAt < 500) {
      return;
    }

    runtime.lastPortalEnterAt = now;
    runtime.portalTransition = kind === "tab-change"
      ? createTabEnterTransition(now)
      : createPageEnterTransition(now);
    state = {
      ...state,
      x: clampToViewportX(state.x),
      y: clampToViewportY(state.y),
      vy: 0,
      animation: "idle"
    };
    render();
  }

  function queueGeometryRefresh() {
    if (runtime.geometryQueued) {
      return;
    }

    runtime.geometryQueued = true;
    window.requestAnimationFrame(() => {
      runtime.geometryQueued = false;
      refreshGeometry();
    });
  }

  function refreshGeometry() {
    runtime.platforms = collectPlatformRects({
      doc: document,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      extensionHost: host
    });
    runtime.lastGeometryAt = performance.now();
  }

  function persistState(force = false) {
    const payload = {
      ...state,
      viewportX: state.x - window.scrollX,
      viewportY: state.y - window.scrollY,
      currentUrl: location.href,
      lastActiveAt: Date.now()
    };

    const write = storageSet({
      [STORAGE_KEYS.characterState]: payload
    });

    const message = hasRuntimeMessaging()
      ? sendRuntimeMessage({
        type: "companion:state",
        payload
      })
      : null;

    if (message?.catch) {
      message.catch(() => {});
    }

    if (force && write?.catch) {
      write.catch(() => {});
    }
  }
}

async function claimCompanion(pageContext, fallbackState) {
  if (!hasRuntimeMessaging()) {
    const storageFallback = await storageGet([
      STORAGE_KEYS.characterState,
      STORAGE_KEYS.preferences,
      STORAGE_KEYS.characterSession
    ]);

    return {
      ok: false,
      storageFallback,
      preferences: storageFallback[STORAGE_KEYS.preferences],
      characterState: storageFallback[STORAGE_KEYS.characterState],
      characterSession: storageFallback[STORAGE_KEYS.characterSession],
      hadExistingCharacter: Boolean(storageFallback[STORAGE_KEYS.characterState])
    };
  }

  try {
    const response = await sendRuntimeMessage({
      type: "companion:claim",
      payload: {
        url: pageContext.url,
        title: pageContext.title,
        fallbackState
      }
    });

    if (response?.ok) {
      return response;
    }
  } catch {
    // Fall through to storage fallback for restricted or early-extension states.
  }

  const storageFallback = await storageGet([
    STORAGE_KEYS.characterState,
    STORAGE_KEYS.preferences,
    STORAGE_KEYS.characterSession
  ]);

  return {
    ok: false,
    storageFallback,
    preferences: storageFallback[STORAGE_KEYS.preferences],
    characterState: storageFallback[STORAGE_KEYS.characterState],
    characterSession: storageFallback[STORAGE_KEYS.characterSession],
    hadExistingCharacter: Boolean(storageFallback[STORAGE_KEYS.characterState])
  };
}

function createRageController({ doc, extensionHost, getJumpinessScale = () => 1 }) {
  let currentTarget = null;
  let mode = "seeking";
  let attackEndsAt = 0;
  let nextAttackAt = 0;
  let nextJumpAt = 0;
  let lastAttackSide = "left";
  const recentTargets = [];

  const style = doc.createElement("style");
  style.id = "pixel-website-companion-rage-style";
  style.textContent = `
    [data-pixel-companion-destroying="true"],
    [data-pixel-companion-destroyed="true"] {
      position: relative !important;
    }

    [data-pixel-companion-destroying="true"] {
      animation: pixelCompanionCrumple ${RAGE.crumpleDurationMs}ms steps(7, end) both !important;
      transform-origin: 50% 50% !important;
      will-change: transform, filter, opacity !important;
      outline: 2px dashed rgba(239, 68, 68, 0.82) !important;
    }

    [data-pixel-companion-destroying="true"]::after {
      content: "SLASH";
      position: absolute;
      z-index: 2147483646;
      left: 10px;
      top: 8px;
      padding: 2px 5px;
      color: #ffffff;
      background: #dc2626;
      border: 2px solid #111827;
      box-shadow: 3px 3px 0 rgba(17, 24, 39, 0.55);
      font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: 0;
      pointer-events: none;
      animation: pixelCompanionHitSign ${RAGE.attackDurationMs}ms steps(3, end) both;
    }

    [data-pixel-companion-destroyed="true"] {
      overflow: hidden !important;
      opacity: 0.74 !important;
      filter: grayscale(0.92) contrast(1.55) brightness(0.68) !important;
      outline: 2px solid rgba(17, 24, 39, 0.65) !important;
      transform: skewX(-1deg) scale(0.985, 0.96) !important;
    }

    [data-pixel-companion-destroyed="true"]::before {
      content: "";
      position: absolute;
      z-index: 2147483645;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(135deg, transparent 0 46%, rgba(17, 24, 39, 0.8) 47% 49%, transparent 50%),
        linear-gradient(24deg, transparent 0 38%, rgba(17, 24, 39, 0.55) 39% 41%, transparent 42%),
        linear-gradient(156deg, transparent 0 58%, rgba(17, 24, 39, 0.5) 59% 61%, transparent 62%);
    }

    .pixel-companion-shard {
      position: absolute;
      z-index: 2147483644;
      pointer-events: none;
      box-sizing: border-box;
      border: 1px solid rgba(17, 24, 39, 0.55);
      background:
        linear-gradient(135deg, rgba(255, 255, 255, 0.22), rgba(17, 24, 39, 0.18)),
        repeating-linear-gradient(45deg, rgba(17, 24, 39, 0.28) 0 2px, transparent 2px 8px);
      mix-blend-mode: multiply;
      opacity: 0.78;
      animation: pixelCompanionShardBreak 900ms steps(5, end) both;
    }

    .pixel-companion-shard[data-shard="0"] {
      clip-path: polygon(0 0, 100% 0, 74% 100%, 0 70%);
      transform: translate(-7px, -5px) rotate(-5deg);
    }

    .pixel-companion-shard[data-shard="1"] {
      clip-path: polygon(22% 0, 100% 10%, 100% 88%, 0 100%);
      transform: translate(8px, -4px) rotate(4deg);
    }

    .pixel-companion-shard[data-shard="2"] {
      clip-path: polygon(0 14%, 82% 0, 100% 100%, 12% 90%);
      transform: translate(-5px, 8px) rotate(3deg);
    }

    .pixel-companion-shard[data-shard="3"] {
      clip-path: polygon(16% 0, 100% 24%, 82% 100%, 0 88%);
      transform: translate(7px, 7px) rotate(-4deg);
    }

    @keyframes pixelCompanionCrumple {
      0% {
        transform: translate(0, 0) rotate(0deg) scale(1, 1);
        filter: none;
      }
      18% {
        transform: translate(2px, -2px) rotate(1deg) scale(0.98, 1.03);
        filter: contrast(1.25);
      }
      34% {
        transform: translate(-3px, 2px) rotate(-2deg) skewX(5deg) scale(1.03, 0.95);
      }
      52% {
        transform: translate(4px, 3px) rotate(3deg) skewY(-4deg) scale(0.92, 0.9);
        filter: grayscale(0.4) contrast(1.35);
      }
      72% {
        transform: translate(-2px, 6px) rotate(-4deg) scale(0.78, 0.72);
        opacity: 0.72;
      }
      100% {
        transform: translate(0, 0) rotate(0deg) scale(1, 1);
        opacity: 1;
        filter: none;
      }
    }

    @keyframes pixelCompanionHitSign {
      0% {
        transform: translateY(-6px) scale(0.6);
        opacity: 0;
      }
      30% {
        transform: translateY(0) scale(1.2);
        opacity: 1;
      }
      100% {
        transform: translateY(8px) scale(1);
        opacity: 0;
      }
    }

    @keyframes pixelCompanionShardBreak {
      0% {
        opacity: 0;
        transform: translate(0, 0) rotate(0deg) scale(1);
      }
      30% {
        opacity: 0.85;
      }
      100% {
        opacity: 0.78;
      }
    }
  `;
  doc.documentElement.append(style);

  return {
    drive(characterState, now) {
      if (mode === "attacking") {
        return {
          ...characterState,
          vx: 0,
          vy: 0,
          animation: "attack"
        };
      }

      if (now < nextAttackAt) {
        return maybeJumpInRage(characterState, now);
      }

      currentTarget = getUsableRageTarget(currentTarget, extensionHost)
        || chooseRageTarget(doc, extensionHost, characterState, recentTargets);

      if (!currentTarget) {
        return maybeJumpInRage(characterState, now);
      }

      const attackX = getTargetAttackX(currentTarget, characterState, lastAttackSide);
      const dx = attackX - characterState.x;

      if (Math.abs(dx) <= RAGE.attackRange) {
        beginAttack(currentTarget, now);
        return {
          ...characterState,
          vx: 0,
          vy: 0,
          direction: dx < 0 ? -1 : 1,
          animation: "attack"
        };
      }

      const direction = dx < 0 ? -1 : 1;
      return maybeJumpInRage({
        ...characterState,
        vx: direction * RAGE.runSpeed,
        direction,
        animation: "walk"
      }, now);
    },
    afterMove(characterState, now) {
      if (mode === "attacking") {
        if (now >= attackEndsAt) {
          mode = "seeking";
          currentTarget = null;
          nextAttackAt = now + RAGE.attackCooldownMs;
          return {
            ...characterState,
            animation: "idle"
          };
        }

        return {
          ...characterState,
          vx: 0,
          vy: 0,
          animation: "attack"
        };
      }

      return characterState;
    },
    destroy() {
      style.remove();
    }
  };

  function beginAttack(target, now) {
    mode = "attacking";
    attackEndsAt = now + RAGE.attackDurationMs;
    lastAttackSide = lastAttackSide === "left" ? "right" : "left";
    destroyRageCluster(target, extensionHost, recentTargets);
  }

  function maybeJumpInRage(characterState, now) {
    const jumpinessScale = Math.max(0.5, Math.min(2, getJumpinessScale()));
    const jumpInterval = 1000 / jumpinessScale;

    if (nextJumpAt === 0) {
      nextJumpAt = now + jumpInterval;
    }

    if (now < nextJumpAt || Math.abs(characterState.vy || 0) > 1) {
      return characterState;
    }

    nextJumpAt = now + jumpInterval;
    return {
      ...characterState,
      vy: -RAGE.jumpSpeed,
      animation: "jump"
    };
  }

}

function chooseRageTarget(doc, extensionHost, characterState, recentTargets) {
  return getRageTargets(doc, extensionHost, characterState, recentTargets)[0] || null;
}

function getRageTargets(doc, extensionHost, characterState, recentTargets = []) {
  const characterCenterX = characterState.x + CHARACTER.width / 2;
  const visibleTargets = Array.from(doc.querySelectorAll("div"))
    .filter((element) => isRageTarget(element, extensionHost))
    .filter((element) => !recentTargets.includes(element));
  const focusedTargets = visibleTargets.filter((element) => !isOversizedRageTarget(element, RAGE.maxPrimaryViewportCoverage));

  const candidates = focusedTargets.length > 0
    ? focusedTargets
    : visibleTargets.length > 0
      ? visibleTargets
    : Array.from(doc.querySelectorAll("div")).filter((element) => isRageTarget(element, extensionHost));

  return candidates
    .sort((a, b) => getRageTargetRoamScore(b, characterCenterX) - getRageTargetRoamScore(a, characterCenterX))
    .slice(0, RAGE.maxTargetsPerBurst);
}

function isRageTarget(element, extensionHost) {
  if (extensionHost && (element === extensionHost || extensionHost.contains(element))) {
    return false;
  }

  if (
    element.hasAttribute("data-pixel-companion-destroying")
    || element.hasAttribute("data-pixel-companion-destroyed")
  ) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 42 || rect.height < 24) {
    return false;
  }

  const visibleRect = getViewportIntersection(rect);
  if (!visibleRect) {
    return false;
  }

  if (visibleRect.width < 36 || visibleRect.height < 18) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return style.display !== "none"
    && style.visibility !== "hidden"
    && Number.parseFloat(style.opacity || "1") > 0.1;
}

function getUsableRageTarget(element, extensionHost) {
  return element && element.isConnected && isRageTarget(element, extensionHost)
    ? element
    : null;
}

function getRageTargetRoamScore(element, characterCenterX) {
  const rect = element.getBoundingClientRect();
  const visibleRect = getViewportIntersection(rect) || rect;
  const centerX = visibleRect.left + window.scrollX + visibleRect.width / 2;
  const horizontalTravel = Math.abs(centerX - characterCenterX);
  const visibleArea = visibleRect.width * visibleRect.height;
  const area = Math.min(visibleArea, 160000) / 160000;
  const viewportCenterBias = 1 - Math.min(
    1,
    Math.abs(visibleRect.top + visibleRect.height / 2 - window.innerHeight / 2) / window.innerHeight
  );
  const oversizedPenalty = isOversizedRageTarget(element, RAGE.maxPrimaryViewportCoverage) ? 420 : 0;

  return horizontalTravel + area * 220 + viewportCenterBias * 160 - oversizedPenalty + Math.random() * 180;
}

function getTargetAttackX(element, characterState, preferredSide = "left") {
  const rect = element.getBoundingClientRect();
  const visibleRect = getViewportIntersection(rect) || rect;
  const worldLeft = visibleRect.left + window.scrollX;
  const worldRight = visibleRect.right + window.scrollX;
  const worldCenter = worldLeft + visibleRect.width / 2;
  const characterCenter = characterState.x + CHARACTER.width / 2;
  const side = preferredSide || (characterCenter < worldCenter ? "left" : "right");

  if (side === "left") {
    return clampToViewportX(worldLeft - CHARACTER.width - 6);
  }

  return clampToViewportX(worldRight + 6);
}

function rememberRageTarget(target, recentTargets) {
  recentTargets.push(target);
  while (recentTargets.length > RAGE.targetMemorySize) {
    recentTargets.shift();
  }
}

function destroyRageCluster(primaryTarget, extensionHost, recentTargets) {
  const targets = getRageClusterTargets(primaryTarget, extensionHost);

  targets.forEach((target, index) => {
    rememberRageTarget(target, recentTargets);
    window.setTimeout(() => {
      markRageTargetDestroying(target);
    }, index * 45);
  });
}

function getRageClusterTargets(primaryTarget, extensionHost) {
  const primaryRect = primaryTarget.getBoundingClientRect();
  const primaryVisibleRect = getViewportIntersection(primaryRect) || primaryRect;
  const primaryCenterX = primaryVisibleRect.left + primaryVisibleRect.width / 2;
  const primaryCenterY = primaryVisibleRect.top + primaryVisibleRect.height / 2;
  const candidates = Array.from(document.querySelectorAll("div"))
    .filter((element) => element === primaryTarget || isRageTarget(element, extensionHost))
    .filter((element) => element === primaryTarget || !isOversizedRageTarget(element, RAGE.maxClusterViewportCoverage))
    .sort((a, b) => {
      if (a === primaryTarget) {
        return -1;
      }

      if (b === primaryTarget) {
        return 1;
      }

      return getViewportDistance(a, primaryCenterX, primaryCenterY) - getViewportDistance(b, primaryCenterX, primaryCenterY);
    });

  return candidates
    .filter((element) => element === primaryTarget || getViewportDistance(element, primaryCenterX, primaryCenterY) <= RAGE.clusterRadiusPx)
    .slice(0, RAGE.clusterDestroyCount);
}

function getViewportDistance(element, x, y) {
  const rect = element.getBoundingClientRect();
  const visibleRect = getViewportIntersection(rect) || rect;
  const centerX = visibleRect.left + visibleRect.width / 2;
  const centerY = visibleRect.top + visibleRect.height / 2;
  return Math.hypot(centerX - x, centerY - y);
}

function getViewportIntersection(rect) {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);

  if (right <= left || bottom <= top) {
    return null;
  }

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top
  };
}

function isOversizedRageTarget(element, maxViewportCoverage) {
  const rect = element.getBoundingClientRect();
  const visibleRect = getViewportIntersection(rect);
  if (!visibleRect) {
    return false;
  }

  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
  const visibleCoverage = (visibleRect.width * visibleRect.height) / viewportArea;
  const spansMostViewport = visibleRect.width >= window.innerWidth * 0.86
    && visibleRect.height >= window.innerHeight * 0.62;
  const extendsBeyondViewport = rect.top < 0
    || rect.left < 0
    || rect.right > window.innerWidth
    || rect.bottom > window.innerHeight;

  return visibleCoverage >= maxViewportCoverage || (spansMostViewport && extendsBeyondViewport);
}

function markRageTargetDestroying(target) {
  if (
    !target.isConnected
    || target.hasAttribute("data-pixel-companion-destroying")
    || target.hasAttribute("data-pixel-companion-destroyed")
  ) {
    return;
  }

  target.setAttribute("data-pixel-companion-destroying", "true");

  window.setTimeout(() => {
    if (!target.isConnected) {
      return;
    }

    target.removeAttribute("data-pixel-companion-destroying");
    target.setAttribute("data-pixel-companion-destroyed", "true");
    addDestroyedShards(target);
  }, RAGE.crumpleDurationMs);
}

function addDestroyedShards(target) {
  if (target.querySelector(":scope > .pixel-companion-shard")) {
    return;
  }

  const rect = target.getBoundingClientRect();
  const shardWidth = Math.max(18, Math.min(90, rect.width / 2));
  const shardHeight = Math.max(14, Math.min(70, rect.height / 2));
  const positions = [
    [0, 0],
    [Math.max(0, rect.width - shardWidth), 0],
    [0, Math.max(0, rect.height - shardHeight)],
    [Math.max(0, rect.width - shardWidth), Math.max(0, rect.height - shardHeight)]
  ];

  positions.forEach(([left, top], index) => {
    const shard = document.createElement("span");
    shard.className = "pixel-companion-shard";
    shard.dataset.shard = String(index);
    shard.style.left = `${left}px`;
    shard.style.top = `${top}px`;
    shard.style.width = `${shardWidth}px`;
    shard.style.height = `${shardHeight}px`;
    target.append(shard);
  });
}

function createCompanionPanel({
  pageContext,
  preferences,
  onGeminiKeyClear,
  onGeminiKeySet,
  onGeminiKeyStatus,
  onHide,
  onPreferenceChange,
  onSend
}) {
  let currentPreferences = normalizePreferences(preferences);
  let activeTab = currentPreferences.activePanelTab;
  const chatHistory = [];

  const root = document.createElement("section");
  root.className = "companion-panel";
  root.hidden = true;
  root.setAttribute("aria-label", "Pixel companion controls");

  const tabRow = document.createElement("div");
  tabRow.className = "panel-tabs";

  const tabButtons = new Map();
  for (const [id, label] of [["ai", "AI"], ["clock", "Clock"], ["profile", "Profile"], ["physics", "Physics"], ["blocked", "Blocked"], ["about", "About"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "panel-tab";
    button.textContent = label;
    button.dataset.tab = id;
    button.addEventListener("click", () => setActiveTab(id));
    tabButtons.set(id, button);
    tabRow.append(button);
  }

  const aiPane = document.createElement("form");
  aiPane.className = "panel-pane ai-pane";
  aiPane.dataset.tab = "ai";

  const log = document.createElement("div");
  log.className = "chat-log";
  appendChatMessage("assistant", pageContext.title
    ? `I am wandering around "${pageContext.title}".`
    : "I am wandering around this page.");

  const row = document.createElement("div");
  row.className = "chat-row";

  const input = document.createElement("input");
  input.className = "chat-input";
  input.type = "text";
  input.placeholder = "Say hi";
  input.autocomplete = "off";

  const submit = document.createElement("button");
  submit.className = "chat-submit";
  submit.type = "submit";
  submit.textContent = ">";

  row.append(input, submit);
  aiPane.append(log, row);

  const clockPane = document.createElement("div");
  clockPane.className = "panel-pane clock-pane";
  clockPane.dataset.tab = "clock";

  const clockFace = document.createElement("div");
  clockFace.className = "panel-clock-face";
  const clockHandHour = document.createElement("span");
  clockHandHour.className = "clock-hand hour";
  const clockHandMinute = document.createElement("span");
  clockHandMinute.className = "clock-hand minute";
  const clockDigital = document.createElement("span");
  clockDigital.className = "panel-clock-digital";
  clockFace.append(clockHandHour, clockHandMinute, clockDigital);

  const clockModeRow = document.createElement("div");
  clockModeRow.className = "segmented";
  const analogButton = createPanelButton("Analog", () => {
    onPreferenceChange({ clockMode: "analog", clockEnabled: true, activePanelTab: "clock" });
  });
  const digitalButton = createPanelButton("Digital", () => {
    onPreferenceChange({ clockMode: "digital", clockEnabled: true, activePanelTab: "clock" });
  });
  const clockToggle = createPanelButton("Hold clock", () => {
    onPreferenceChange({ clockEnabled: !currentPreferences.clockEnabled, activePanelTab: "clock" });
  });
  clockModeRow.append(analogButton, digitalButton, clockToggle);

  const pomodoroToggle = createPanelButton("Show Pomodoro", () => {
    onPreferenceChange({
      activePanelTab: "clock",
      pomodoroSectionVisible: !currentPreferences.pomodoroSectionVisible
    });
  });
  pomodoroToggle.classList.add("pomodoro-toggle");

  const pomodoroBox = document.createElement("div");
  pomodoroBox.className = "pomodoro-box";

  const pomodoroTime = document.createElement("div");
  pomodoroTime.className = "pomodoro-time";
  const pomodoroHandMinute = document.createElement("span");
  pomodoroHandMinute.className = "pomodoro-hand minute";
  const pomodoroDigital = document.createElement("span");
  pomodoroDigital.className = "pomodoro-digital";
  pomodoroDigital.textContent = "25:00";
  pomodoroTime.append(pomodoroHandMinute, pomodoroDigital);

  const pomodoroStatus = document.createElement("div");
  pomodoroStatus.className = "pomodoro-status";
  pomodoroStatus.textContent = "Pomodoro";

  const pomodoroButtons = document.createElement("div");
  pomodoroButtons.className = "segmented pomodoro-actions";

  const pomodoroStartButton = createPanelButton("Start", () => {
    const snapshot = getPomodoroSnapshot(currentPreferences);
    const durationSeconds = currentPreferences.pomodoroDurationSeconds || POMODORO_DEFAULT_SECONDS;
    const remainingSeconds = snapshot.remainingSeconds > 0 && snapshot.status !== "complete"
      ? snapshot.remainingSeconds
      : durationSeconds;

    onPreferenceChange({
      activePanelTab: "clock",
      clockEnabled: true,
      pomodoroSectionVisible: true,
      pomodoroEnabled: true,
      pomodoroStatus: "running",
      pomodoroDurationSeconds: durationSeconds,
      pomodoroRemainingSeconds: remainingSeconds,
      pomodoroEndsAt: Date.now() + remainingSeconds * 1000
    });
  });

  const pomodoroPauseButton = createPanelButton("Pause", () => {
    const snapshot = getPomodoroSnapshot(currentPreferences);
    onPreferenceChange({
      activePanelTab: "clock",
      clockEnabled: true,
      pomodoroSectionVisible: true,
      pomodoroEnabled: true,
      pomodoroStatus: snapshot.status === "running" ? "paused" : "running",
      pomodoroRemainingSeconds: snapshot.remainingSeconds,
      pomodoroEndsAt: snapshot.status === "running"
        ? 0
        : Date.now() + snapshot.remainingSeconds * 1000
    });
  });

  const pomodoroResetButton = createPanelButton("Reset", () => {
    const durationSeconds = currentPreferences.pomodoroDurationSeconds || POMODORO_DEFAULT_SECONDS;
    onPreferenceChange({
      activePanelTab: "clock",
      pomodoroSectionVisible: true,
      pomodoroEnabled: false,
      pomodoroStatus: "idle",
      pomodoroRemainingSeconds: durationSeconds,
      pomodoroEndsAt: 0
    });
  });

  pomodoroButtons.append(pomodoroStartButton, pomodoroPauseButton, pomodoroResetButton);

  const pomodoroDurations = document.createElement("div");
  pomodoroDurations.className = "segmented pomodoro-durations";
  const pomodoro25Button = createPanelButton("25m", () => setPomodoroDuration(25 * 60));
  const pomodoro5Button = createPanelButton("5m", () => setPomodoroDuration(5 * 60));
  pomodoroDurations.append(pomodoro25Button, pomodoro5Button);
  pomodoroBox.append(pomodoroTime, pomodoroStatus, pomodoroButtons, pomodoroDurations);

  clockPane.append(clockFace, clockModeRow, pomodoroToggle, pomodoroBox);

  const profilePane = document.createElement("div");
  profilePane.className = "panel-pane profile-pane";
  profilePane.dataset.tab = "profile";

  const skinGrid = document.createElement("div");
  skinGrid.className = "skin-grid";
  const skinButtons = new Map();
  for (const skin of SKINS.filter((skin) => skin !== "custom")) {
    const skinLabel = SKIN_LABELS[skin] || skin;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "skin-option";
    button.dataset.skin = skin;
    button.setAttribute("aria-label", `${skinLabel} skin`);
    button.addEventListener("click", () => {
      onPreferenceChange({ selectedSkin: skin, activePanelTab: "profile" });
    });

    const preview = document.createElement("span");
    preview.className = "skin-preview";
    preview.dataset.skin = skin;
    const label = document.createElement("span");
    label.className = "skin-label";
    label.textContent = skinLabel;
    button.append(preview, label);
    skinButtons.set(skin, button);
    skinGrid.append(button);
  }

  profilePane.append(skinGrid);

  // Tried making custom Codey's - wasn't good.
  /*
  const customSection = document.createElement("div");
  customSection.className = "custom-skin-section";

  const customTitle = document.createElement("div");
  customTitle.className = "custom-skin-title";
  customTitle.textContent = "Custom";

  const customHelp = document.createElement("div");
  customHelp.className = "custom-skin-help";
  customHelp.textContent = "Upload an image and Codey will pixel it into a tiny character.";

  const customActions = document.createElement("div");
  customActions.className = "custom-skin-actions";

  const customSkinList = document.createElement("div");
  customSkinList.className = "custom-skin-list";

  const customFileInput = document.createElement("input");
  customFileInput.className = "custom-skin-input";
  customFileInput.type = "file";
  customFileInput.accept = "image/png,image/jpeg,image/webp,image/gif,image/*";

  const customUploadButton = createPanelButton("Upload image", () => {
    customFileInput.click();
  });

  const customClearButton = createPanelButton("Remove", () => {
    const selectedCustomSkin = getSelectedCustomSkin(currentPreferences);

    if (!selectedCustomSkin) {
      return;
    }

    const nextCustomSkins = currentPreferences.customSkins
      .filter((skin) => skin.id !== selectedCustomSkin.id);

    onPreferenceChange({
      activePanelTab: "profile",
      selectedSkin: "default",
      customSkins: nextCustomSkins,
      customSkinDataUrl: nextCustomSkins[0]?.dataUrl || ""
    });
  });

  const customStatus = document.createElement("div");
  customStatus.className = "custom-skin-status";

  customActions.append(customUploadButton, customClearButton);
  customSection.append(customTitle, customHelp, customActions, customFileInput, customSkinList, customStatus);
  profilePane.append(customSection);

  customFileInput.addEventListener("change", async () => {
    const [file] = Array.from(customFileInput.files || []);
    customFileInput.value = "";

    if (!file) {
      return;
    }

    customUploadButton.disabled = true;
    customStatus.textContent = "Generating sprite...";

    try {
      const result = await createPixelSkinFromFile(file);
      const customSkin = {
        id: createCustomSkinId(),
        label: result.label || createCustomSkinLabel(result.subjectKind, currentPreferences.customSkins.length + 1),
        dataUrl: result.dataUrl,
        subjectKind: result.subjectKind,
        generator: result.generator,
        generatorVersion: result.generatorVersion,
        spriteWidth: result.spriteWidth,
        spriteHeight: result.spriteHeight,
        features: result.features || [],
        createdAt: Date.now()
      };

      onPreferenceChange({
        activePanelTab: "profile",
        selectedSkin: customSkin.id,
        customSkins: [...currentPreferences.customSkins, customSkin],
        customSkinDataUrl: result.dataUrl
      });
      customStatus.textContent = `Generated ${result.label || result.subjectKind} sprite.`;
    } catch (error) {
      customStatus.textContent = String(error?.message || "Generation failed. Add an API key in About or try another image.");
    } finally {
      customUploadButton.disabled = false;
    }
  });
  */

  const physicsPane = document.createElement("div");
  physicsPane.className = "panel-pane physics-pane";
  physicsPane.dataset.tab = "physics";

  const speedControl = createSliderControl({
    label: "Speed",
    min: "0.5",
    max: "2",
    step: "0.1",
    value: String(currentPreferences.speedScale),
    onInput: (value) => {
      onPreferenceChange({ speedScale: Number(value), activePanelTab: "physics" });
    }
  });

  const jumpinessControl = createSliderControl({
    label: "Jumpiness",
    min: "0.5",
    max: "2",
    step: "0.1",
    value: String(currentPreferences.jumpinessScale),
    onInput: (value) => {
      onPreferenceChange({ jumpinessScale: Number(value), activePanelTab: "physics" });
    }
  });

  physicsPane.append(speedControl.root, jumpinessControl.root);

  const blockedPane = document.createElement("form");
  blockedPane.className = "panel-pane blocked-pane";
  blockedPane.dataset.tab = "blocked";

  const blockedList = document.createElement("div");
  blockedList.className = "blocked-list";

  const blockedRow = document.createElement("div");
  blockedRow.className = "blocked-row";

  const blockedInput = document.createElement("input");
  blockedInput.className = "blocked-input";
  blockedInput.type = "text";
  blockedInput.placeholder = "example.com";
  blockedInput.autocomplete = "off";

  const blockedSubmit = document.createElement("button");
  blockedSubmit.className = "blocked-submit";
  blockedSubmit.type = "submit";
  blockedSubmit.textContent = "+";

  blockedRow.append(blockedInput, blockedSubmit);
  blockedPane.append(blockedList, blockedRow);

  const aboutPane = document.createElement("div");
  aboutPane.className = "panel-pane about-pane";
  aboutPane.dataset.tab = "about";

  const aboutText = document.createElement("p");
  aboutText.className = "about-text";
  aboutText.textContent = "Hi, this is Codey. He's a little helper that helps you focus, study, and have fun. He also helps you avoid distractions! Spun this up in an hour so hope you have fun with him - Benjamin";

  const geminiForm = document.createElement("form");
  geminiForm.className = "gemini-key-form";

  const geminiHelp = document.createElement("p");
  geminiHelp.className = "gemini-key-help";
  geminiHelp.textContent = "Your key is saved on this device and is used only for AI chat and character generation.";

  const geminiInput = document.createElement("input");
  geminiInput.className = "gemini-key-input";
  geminiInput.type = "password";
  geminiInput.placeholder = "API key";
  geminiInput.autocomplete = "off";
  geminiInput.spellcheck = false;

  const geminiUseButton = document.createElement("button");
  geminiUseButton.className = "gemini-key-submit";
  geminiUseButton.type = "submit";
  geminiUseButton.textContent = "Save key";

  const geminiClearButton = document.createElement("button");
  geminiClearButton.className = "gemini-key-clear";
  geminiClearButton.type = "button";
  geminiClearButton.textContent = "Clear key";

  const geminiStatus = document.createElement("div");
  geminiStatus.className = "gemini-key-status";
  geminiStatus.textContent = "No key added";

  geminiForm.append(geminiHelp, geminiInput, geminiUseButton, geminiClearButton, geminiStatus);

  const hideButton = createPanelButton("Hide", () => {
    onHide?.();
  });
  hideButton.classList.add("hide-action");
  aboutPane.append(aboutText, geminiForm, hideButton);

  const paneWrap = document.createElement("div");
  paneWrap.className = "panel-panes";
  paneWrap.append(aiPane, clockPane, profilePane, physicsPane, blockedPane, aboutPane);
  root.append(tabRow, paneWrap);

  root.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  root.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });

  aiPane.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) {
      return;
    }

    input.value = "";
    appendChatMessage("user", message);
    submit.disabled = true;

    try {
      const response = await onSend(message, chatHistory.slice(0, -1).slice(-8));
      appendChatMessage("assistant", response?.text || "...");
    } catch (error) {
      appendChatMessage("assistant", String(error?.message || "AI chat is unavailable right now."));
    } finally {
      submit.disabled = false;
      input.focus();
    }
  });

  blockedPane.addEventListener("submit", (event) => {
    event.preventDefault();
    const host = normalizeHost(blockedInput.value);
    if (!host) {
      return;
    }

    blockedInput.value = "";
    onPreferenceChange({
      activePanelTab: "blocked",
      blockedSites: normalizeBlockedSites([...currentPreferences.blockedSites, host])
    });
    blockedInput.focus();
  });

  geminiForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const apiKey = geminiInput.value.trim();
    geminiInput.value = "";

    if (!apiKey) {
      geminiStatus.textContent = "No key added";
      return;
    }

    geminiUseButton.disabled = true;
    geminiStatus.textContent = "Saving...";

    try {
      const response = await onGeminiKeySet?.(apiKey);
      geminiStatus.textContent = response?.hasKey ? "AI enabled" : "No key added";
    } catch {
      geminiStatus.textContent = "Could not save key.";
    } finally {
      geminiUseButton.disabled = false;
    }
  });

  geminiClearButton.addEventListener("click", async () => {
    geminiInput.value = "";
    geminiClearButton.disabled = true;
    geminiStatus.textContent = "Clearing...";

    try {
      await onGeminiKeyClear?.();
      geminiStatus.textContent = "Key cleared";
    } catch {
      geminiStatus.textContent = "Could not clear key.";
    } finally {
      geminiClearButton.disabled = false;
    }
  });

  applyPanelState();

  return {
    root,
    toggle() {
      root.hidden = !root.hidden;
      if (!root.hidden) {
        focusActiveTab();
        if (activeTab === "about") {
          refreshGeminiStatus();
        }
      }
    },
    close() {
      root.hidden = true;
    },
    isOpen() {
      return !root.hidden;
    },
    position({ direction, viewportX, viewportY, viewportWidth, viewportHeight }) {
      root.dataset.direction = String(direction);

      if (root.hidden) {
        return;
      }

      const panelWidth = root.offsetWidth || 335;
      const panelHeight = root.offsetHeight || 210;
      const margin = 8;
      const defaultLeft = direction < 0 ? CHARACTER.width - panelWidth + 10 : -10;
      const minLeft = margin - viewportX;
      const maxLeft = viewportWidth - viewportX - panelWidth - margin;
      const clampedLeft = clamp(defaultLeft, minLeft, maxLeft);
      const fitsAbove = viewportY - panelHeight - margin >= 0;
      const top = fitsAbove
        ? -(panelHeight + 8)
        : Math.min(viewportHeight - viewportY - panelHeight - margin, CHARACTER.height + 8);

      root.style.setProperty("--panel-left", `${clampedLeft}px`);
      root.style.setProperty("--panel-top", `${top}px`);
    },
    setPreferences(nextPreferences) {
      currentPreferences = normalizePreferences(nextPreferences);
      activeTab = currentPreferences.activePanelTab;
      applyPanelState();
    },
    updateClock() {
      updatePanelClock(clockFace, clockDigital, clockHandHour, clockHandMinute, currentPreferences);
      updatePomodoroPanel();
    }
  };

  function setActiveTab(tab) {
    activeTab = tab;
    onPreferenceChange({ activePanelTab: tab, clockEnabled: tab === "clock" ? true : currentPreferences.clockEnabled });
    applyPanelState();
    focusActiveTab();
    if (tab === "about") {
      refreshGeminiStatus();
    }
  }

  function applyPanelState() {
    root.dataset.activeTab = activeTab;
    clockFace.dataset.mode = currentPreferences.clockMode;
    analogButton.dataset.active = String(currentPreferences.clockMode === "analog");
    digitalButton.dataset.active = String(currentPreferences.clockMode === "digital");
    clockToggle.dataset.active = String(currentPreferences.clockEnabled);
    clockToggle.textContent = currentPreferences.clockEnabled ? "Clock on" : "Clock off";
    pomodoroToggle.dataset.active = String(currentPreferences.pomodoroSectionVisible);
    pomodoroToggle.textContent = currentPreferences.pomodoroSectionVisible ? "Hide Pomodoro" : "Show Pomodoro";
    updatePomodoroPanel();
    renderBlockedSites();
    updatePhysicsPanel();

    for (const [tab, button] of tabButtons) {
      button.dataset.active = String(tab === activeTab);
    }

    for (const pane of [aiPane, clockPane, profilePane, physicsPane, blockedPane, aboutPane]) {
      pane.hidden = pane.dataset.tab !== activeTab;
    }

    for (const [skin, button] of skinButtons) {
      button.dataset.active = String(skin === currentPreferences.selectedSkin);
    }

    // Tried making custom Codey's - wasn't good.
    // updateCustomSkinPanel();
  }

  function focusActiveTab() {
    if (activeTab === "ai") {
      input.focus();
      return;
    }

    if (activeTab === "blocked") {
      blockedInput.focus();
      return;
    }

    if (activeTab === "physics") {
      speedControl.input.focus();
      return;
    }

    if (activeTab === "about") {
      geminiInput.focus();
      return;
    }

    tabButtons.get(activeTab)?.focus();
  }

  async function refreshGeminiStatus() {
    try {
      const response = await onGeminiKeyStatus?.();
      geminiStatus.textContent = response?.hasKey
        ? "AI enabled"
        : "No key added";
    } catch {
      geminiStatus.textContent = "No key added";
    }
  }

  function updatePhysicsPanel() {
    speedControl.setValue(currentPreferences.speedScale);
    jumpinessControl.setValue(currentPreferences.jumpinessScale);
    hideButton.textContent = currentPreferences.hiddenInDoor ? "Hidden" : "Hide";
    hideButton.disabled = currentPreferences.hiddenInDoor;
  }

  function updateCustomSkinPanel() {
    customSkinList.textContent = "";

    for (const customSkin of currentPreferences.customSkins) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "skin-option";
      button.dataset.skin = "custom";
      button.dataset.active = String(currentPreferences.selectedSkin === customSkin.id);
      button.setAttribute("aria-label", `${customSkin.label} skin`);
      button.addEventListener("click", () => {
        onPreferenceChange({
          activePanelTab: "profile",
          selectedSkin: customSkin.id,
          customSkinDataUrl: customSkin.dataUrl
        });
      });

      const preview = document.createElement("span");
      preview.className = "skin-preview";
      preview.dataset.skin = "custom";
      preview.style.setProperty("--custom-skin-image", `url(${customSkin.dataUrl})`);
      applyCustomSkinDisplayVars(preview, customSkin);

      const label = document.createElement("span");
      label.className = "skin-label";
      label.textContent = customSkin.label;

      button.append(preview, label);
      customSkinList.append(button);
    }

    const selectedCustomSkin = getSelectedCustomSkin(currentPreferences);
    customClearButton.disabled = !selectedCustomSkin;
    customStatus.textContent = currentPreferences.customSkins.length
      ? `${currentPreferences.customSkins.length} custom saved.`
      : "No custom skins yet.";
  }

  function setPomodoroDuration(durationSeconds) {
    onPreferenceChange({
      activePanelTab: "clock",
      pomodoroSectionVisible: true,
      pomodoroEnabled: false,
      pomodoroStatus: "idle",
      pomodoroDurationSeconds: durationSeconds,
      pomodoroRemainingSeconds: durationSeconds,
      pomodoroEndsAt: 0
    });
  }

  function updatePomodoroPanel() {
    const snapshot = getPomodoroSnapshot(currentPreferences);
    const handDegrees = getPomodoroHandDegrees(snapshot.remainingSeconds);
    pomodoroBox.hidden = !currentPreferences.pomodoroSectionVisible;
    pomodoroTime.dataset.mode = currentPreferences.clockMode;
    pomodoroTime.dataset.status = snapshot.status;
    pomodoroTime.style.setProperty("--pomodoro-minute", `${handDegrees.minuteDegrees}deg`);
    pomodoroTime.setAttribute("aria-label", `${formatPomodoroTime(snapshot.remainingSeconds)} remaining`);
    pomodoroDigital.textContent = formatPomodoroTime(snapshot.remainingSeconds);
    pomodoroStatus.textContent = snapshot.status === "running"
      ? "Focus running"
      : snapshot.status === "paused"
        ? "Focus paused"
        : snapshot.status === "complete"
          ? "Focus complete"
          : "Pomodoro";
    pomodoroStartButton.dataset.active = String(snapshot.status === "running");
    pomodoroPauseButton.textContent = snapshot.status === "running" ? "Pause" : "Resume";
    pomodoroPauseButton.disabled = snapshot.status === "idle" || snapshot.status === "complete";
    pomodoroResetButton.dataset.active = String(snapshot.status === "complete");
    pomodoro25Button.dataset.active = String(currentPreferences.pomodoroDurationSeconds === 25 * 60);
    pomodoro5Button.dataset.active = String(currentPreferences.pomodoroDurationSeconds === 5 * 60);
  }

  function renderBlockedSites() {
    blockedList.textContent = "";

    for (const site of currentPreferences.blockedSites) {
      const item = document.createElement("div");
      item.className = "blocked-item";

      const label = document.createElement("span");
      label.textContent = site;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "blocked-remove";
      remove.textContent = "x";
      remove.setAttribute("aria-label", `Remove ${site}`);
      remove.addEventListener("click", () => {
        onPreferenceChange({
          activePanelTab: "blocked",
          blockedSites: currentPreferences.blockedSites.filter((blockedSite) => blockedSite !== site)
        });
      });

      item.append(label, remove);
      blockedList.append(item);
    }
  }

  function appendChatMessage(role, text) {
    const item = document.createElement("div");
    item.className = "chat-message";
    item.dataset.role = role;
    item.textContent = `${role === "user" ? "You" : "Codey"}: ${text}`;
    log.append(item);
    log.scrollTop = log.scrollHeight;

    if (role === "user" || role === "assistant") {
      chatHistory.push({ role, text });
      while (chatHistory.length > 12) {
        chatHistory.shift();
      }
    }
  }
}

function createPanelButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "panel-action";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function getSelectedCustomSkin(preferences) {
  if (!preferences?.selectedSkin?.startsWith?.(CUSTOM_SKIN_PREFIX)) {
    return null;
  }

  return preferences.customSkins.find((skin) => skin.id === preferences.selectedSkin) || null;
}

function applyCustomSkinDisplayVars(element, customSkin) {
  const spriteWidth = Number(customSkin?.spriteWidth || 0);
  const spriteHeight = Number(customSkin?.spriteHeight || 0);
  const isTinySprite = spriteWidth > 0 && spriteHeight > 0 && Math.max(spriteWidth, spriteHeight) <= 15;

  if (isTinySprite) {
    const aspect = spriteWidth / Math.max(1, spriteHeight);
    const displayWidth = aspect >= 1 ? 24 : Math.max(15, Math.round(24 * aspect));
    const displayHeight = aspect >= 1 ? Math.max(15, Math.round(24 / aspect)) : 24;
    element.style.setProperty("--custom-skin-display-width", `${displayWidth}px`);
    element.style.setProperty("--custom-skin-display-height", `${displayHeight}px`);
    element.style.setProperty("--custom-skin-left", `${Math.round((24 - displayWidth) / 2) + 2}px`);
    element.style.setProperty("--custom-skin-top", `${34 - displayHeight}px`);
    element.style.setProperty("--custom-skin-bg-size", "100% 100%");
    return;
  }

  clearCustomSkinDisplayVars(element);
}

function clearCustomSkinDisplayVars(element) {
  element.style.removeProperty("--custom-skin-display-width");
  element.style.removeProperty("--custom-skin-display-height");
  element.style.removeProperty("--custom-skin-left");
  element.style.removeProperty("--custom-skin-top");
  element.style.removeProperty("--custom-skin-bg-size");
}

function createCustomSkinId() {
  return `${CUSTOM_SKIN_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createCustomSkinLabel(subjectKind, index) {
  const label = {
    person: "Person",
    animal: "Animal",
    object: "Object"
  }[subjectKind] || "Custom";

  return `${label} ${index}`;
}

function createSliderControl({ label, min, max, step, value, onInput }) {
  const root = document.createElement("label");
  root.className = "slider-control";

  const header = document.createElement("span");
  header.className = "slider-header";

  const labelText = document.createElement("span");
  labelText.textContent = label;

  const valueText = document.createElement("span");
  valueText.className = "slider-value";

  const input = document.createElement("input");
  input.type = "range";
  input.min = min;
  input.max = max;
  input.step = step;
  input.value = value;
  input.className = "panel-slider";

  input.addEventListener("input", () => {
    valueText.textContent = `${Number(input.value).toFixed(1)}x`;
    onInput(input.value);
  });

  header.append(labelText, valueText);
  root.append(header, input);

  return {
    root,
    input,
    setValue(nextValue) {
      const normalized = Number(nextValue || 1);
      input.value = String(normalized);
      valueText.textContent = `${normalized.toFixed(1)}x`;
    }
  };
}

async function createPixelSkinFromFile(file) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("Choose an image file.");
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Use an image under 5MB.");
  }

  const sourceUrl = await readFileAsDataUrl(file);
  return createGeminiPixelSkin(sourceUrl, file.type);
}

async function createGeminiPixelSkin(imageDataUrl, mimeType) {
  if (!hasRuntimeMessaging()) {
    throw new Error("Character generation is unavailable in this browser context.");
  }

  const response = await sendRuntimeMessage({
    type: "companion:generate-custom-skin",
    payload: {
      imageDataUrl,
      mimeType
    }
  });

  if (!response?.ok || !response.imageDataUrl) {
    throw new Error(response?.error || "Image generation service did not return an image.");
  }

  const generated = await createSpriteFromGeneratedImage(response.imageDataUrl);
  return createPixelSkinResult(generated, {
    generator: "gemini-image-sprite",
    usedFallback: false
  });
}

async function createSpriteFromGeneratedImage(imageDataUrl) {
  const image = await loadImage(imageDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = GEMINI_SPRITE_WIDTH;
  canvas.height = GEMINI_SPRITE_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.clearRect(0, 0, canvas.width, canvas.height);
  drawImageContained(context, image, canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  removePlainBackground(imageData);
  quantizeImageData(imageData);

  return {
    sprite: {
      width: imageData.width,
      height: imageData.height,
      data: imageData.data
    },
    subjectKind: "object",
    label: "Sprite",
    features: [],
    generator: "gemini-image-sprite",
    generatorVersion: GEMINI_SKIN_GENERATOR_VERSION
  };
}

function drawImageContained(context, image, width, height) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
  const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
  const x = Math.round((width - drawWidth) / 2);
  const y = Math.round((height - drawHeight) / 2);
  context.drawImage(image, x, y, drawWidth, drawHeight);
}

function quantizeImageData(imageData) {
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 96) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = 0;
      continue;
    }

    data[index] = quantizeSpriteChannel(data[index]);
    data[index + 1] = quantizeSpriteChannel(data[index + 1]);
    data[index + 2] = quantizeSpriteChannel(data[index + 2]);
    data[index + 3] = 255;
  }
}

function removePlainBackground(imageData) {
  const background = getEstimatedBackgroundColor(imageData);

  if (!background) {
    return;
  }

  const { data } = imageData;
  const threshold = isLowSaturationColor(background) ? 74 : 52;

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 96) {
      continue;
    }

    const color = {
      r: data[index],
      g: data[index + 1],
      b: data[index + 2]
    };

    if (getSpriteColorDistance(color, background) <= threshold) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = 0;
    }
  }
}

function getEstimatedBackgroundColor(imageData) {
  const samples = [];
  const { width, height, data } = imageData;

  for (let x = 0; x < width; x += 1) {
    addOpaqueSample(samples, data, x, 0, width);
    addOpaqueSample(samples, data, x, height - 1, width);
  }

  for (let y = 1; y < height - 1; y += 1) {
    addOpaqueSample(samples, data, 0, y, width);
    addOpaqueSample(samples, data, width - 1, y, width);
  }

  if (!samples.length) {
    return null;
  }

  const dominant = getDominantSpriteColor(samples);
  const borderMatchRatio = samples.filter((sample) => getSpriteColorDistance(sample, dominant) <= 52).length / samples.length;

  if (borderMatchRatio < 0.45 && !isLowSaturationColor(dominant)) {
    return null;
  }

  return dominant;
}

function addOpaqueSample(samples, data, x, y, width) {
  const index = (y * width + x) * 4;

  if (data[index + 3] < 96) {
    return;
  }

  samples.push({
    r: data[index],
    g: data[index + 1],
    b: data[index + 2]
  });
}

function getDominantSpriteColor(colors) {
  const buckets = new Map();
  let bestKey = "";
  let bestCount = -1;

  for (const color of colors) {
    const key = `${quantizeSpriteChannel(color.r)},${quantizeSpriteChannel(color.g)},${quantizeSpriteChannel(color.b)}`;
    const count = (buckets.get(key) || 0) + 1;
    buckets.set(key, count);

    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }

  const [r, g, b] = bestKey.split(",").map(Number);
  return { r, g, b };
}

function isLowSaturationColor(color) {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  return max - min <= 36 || max >= 210;
}

function getSpriteColorDistance(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

function quantizeSpriteChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value / 51) * 51));
}

function createPixelSkinResult(generated, options = {}) {
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = generated.sprite.width || CUSTOM_SKIN_SPRITE_WIDTH;
  outputCanvas.height = generated.sprite.height || CUSTOM_SKIN_SPRITE_HEIGHT;
  const outputContext = outputCanvas.getContext("2d");
  outputContext.imageSmoothingEnabled = false;
  outputContext.putImageData(new ImageData(generated.sprite.data, generated.sprite.width, generated.sprite.height), 0, 0);

  return {
    dataUrl: outputCanvas.toDataURL("image/png"),
    subjectKind: generated.subjectKind,
    label: generated.label || "",
    features: Array.isArray(generated.features) ? generated.features : [],
    generator: options.generator || generated.generator || "",
    generatorVersion: generated.generatorVersion,
    spriteWidth: generated.sprite.width,
    spriteHeight: generated.sprite.height,
    usedFallback: Boolean(options.usedFallback)
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("Could not read that image.")));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("Could not load generated sprite image.")), { once: true });
    image.src = src;
  });
}

function updatePanelClock(clockFace, digital, hourHand, minuteHand, preferences) {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const hourDegrees = (hours % 12) * 30 + minutes * 0.5;
  const minuteDegrees = minutes * 6 + seconds * 0.1;

  clockFace.dataset.mode = preferences.clockMode;
  clockFace.dataset.pomodoro = "false";
  digital.textContent = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  hourHand.style.transform = `rotate(${hourDegrees}deg)`;
  minuteHand.style.transform = `rotate(${minuteDegrees}deg)`;
}

function updateSpriteClock(clockAccessory, preferences) {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const hourDegrees = (hours % 12) * 30 + minutes * 0.5;
  const minuteDegrees = minutes * 6 + seconds * 0.1;
  const snapshot = getPomodoroSnapshot(preferences, now.getTime());
  const showPomodoro = preferences.pomodoroEnabled && snapshot.status !== "idle";
  const pomodoroHandDegrees = getPomodoroHandDegrees(snapshot.remainingSeconds);
  const clockHourDegrees = showPomodoro && preferences.clockMode === "analog"
    ? pomodoroHandDegrees.minuteDegrees
    : hourDegrees;
  const clockMinuteDegrees = showPomodoro && preferences.clockMode === "analog"
    ? 0
    : minuteDegrees;

  clockAccessory.style.setProperty("--clock-hour", `${clockHourDegrees}deg`);
  clockAccessory.style.setProperty("--clock-minute", `${clockMinuteDegrees}deg`);
  clockAccessory.dataset.pomodoro = String(showPomodoro);
  clockAccessory.textContent = showPomodoro
    ? preferences.clockMode === "digital"
      ? formatPomodoroTime(snapshot.remainingSeconds)
      : ""
    : preferences.clockMode === "digital"
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
      : "";
}

function getPomodoroHandDegrees(remainingSeconds) {
  const safeSeconds = Math.max(0, Math.round(remainingSeconds));

  return {
    minuteDegrees: ((safeSeconds / 60) % 60) * 6
  };
}

function getPomodoroSnapshot(preferences, now = Date.now()) {
  const durationSeconds = preferences.pomodoroDurationSeconds || POMODORO_DEFAULT_SECONDS;
  const fallbackRemaining = Number.isFinite(preferences.pomodoroRemainingSeconds)
    ? preferences.pomodoroRemainingSeconds
    : durationSeconds;

  if (preferences.pomodoroStatus !== "running") {
    return {
      status: preferences.pomodoroStatus || "idle",
      remainingSeconds: Math.max(0, Math.min(durationSeconds, Math.ceil(fallbackRemaining)))
    };
  }

  const remainingSeconds = Math.max(0, Math.ceil((preferences.pomodoroEndsAt - now) / 1000));
  return {
    status: remainingSeconds > 0 ? "running" : "complete",
    remainingSeconds
  };
}

function formatPomodoroTime(seconds) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function isPointInsideElement(event, element) {
  if (!element || typeof element.getBoundingClientRect !== "function") {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return event.clientX >= rect.left
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom;
}

function getCarriedViewportPosition(storedCharacterState, normalizedState) {
  return {
    x: Number.isFinite(storedCharacterState?.viewportX)
      ? storedCharacterState.viewportX
      : normalizedState.x,
    y: Number.isFinite(storedCharacterState?.viewportY)
      ? storedCharacterState.viewportY
      : 96
  };
}

async function sendChatMessage(payload) {
  if (!hasRuntimeMessaging()) {
    throw new Error("AI chat needs the extension runtime. Reload the extension and try again.");
  }

  try {
    const response = await sendRuntimeMessage({
      type: "companion:chat",
      payload
    });

    if (response?.ok === false) {
      throw new Error(response.text || response.error || "AI chat is unavailable right now.");
    }

    if (isLegacyChatStubResponse(response)) {
      throw new Error("AI chat returned an invalid response. Reload the extension and try again.");
    }

    return response;
  } catch (error) {
    throw new Error(String(error?.message || "AI chat is unavailable right now."));
  }
}

async function setGeminiKey(apiKey) {
  if (!hasRuntimeMessaging()) {
    return { ok: false, hasKey: false };
  }

  return sendRuntimeMessage({
    type: "companion:gemini-key-set",
    payload: { apiKey }
  });
}

async function clearGeminiKey() {
  if (!hasRuntimeMessaging()) {
    return { ok: false, hasKey: false };
  }

  return sendRuntimeMessage({
    type: "companion:gemini-key-clear"
  });
}

async function getGeminiKeyStatus() {
  if (!hasRuntimeMessaging()) {
    return { ok: false, hasKey: false };
  }

  return sendRuntimeMessage({
    type: "companion:gemini-key-status"
  });
}

function isLegacyChatStubResponse(response) {
  const text = String(response?.text || "");
  return !text
    || text.includes("I heard:")
    || text.includes("I am still a local stub")
    || text.includes("chat boundary is ready");
}

function notifyPageContext(pageContext) {
  if (!hasRuntimeMessaging()) {
    return;
  }

  sendRuntimeMessage({
    type: "companion:page-context",
    payload: pageContext
  }).catch(() => {});
}

function getDocumentHeight() {
  return Math.max(
    document.documentElement.scrollHeight,
    document.body?.scrollHeight || 0,
    window.innerHeight
  );
}

function createStyles() {
  return `
    :host {
      all: initial;
    }

    .companion-overlay {
      all: initial;
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      pointer-events: none;
      contain: layout style paint;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .companion-stage {
      position: absolute;
      left: 0;
      top: 0;
      width: ${CHARACTER.width}px;
      height: ${CHARACTER.height}px;
      pointer-events: none;
      will-change: transform;
    }

    .pixel-person {
      all: initial;
      position: absolute;
      left: 0;
      top: 0;
      z-index: 1;
      width: ${CHARACTER.width}px;
      height: ${CHARACTER.height}px;
      pointer-events: auto;
      cursor: pointer;
      border: 0;
      background: transparent;
      image-rendering: pixelated;
      transform-origin: 50% 100%;
      filter: drop-shadow(0 2px 0 rgba(0, 0, 0, 0.25));
    }

    .pixel-person[data-direction="-1"] {
      transform: scaleX(-1);
    }

    .pixel-body {
      position: absolute;
      left: 6px;
      top: 2px;
      width: 4px;
      height: 4px;
      background: #2d2335;
      transform: scale(${CHARACTER.visualScale});
      transform-origin: 0 0;
      box-shadow:
        4px 0 #2d2335,
        8px 0 #2d2335,
        0 4px #f5b88d,
        4px 4px #f5b88d,
        8px 4px #f5b88d,
        12px 4px #f5b88d,
        0 8px #f5b88d,
        4px 8px #111827,
        8px 8px #f5b88d,
        12px 8px #111827,
        4px 12px #f5b88d,
        8px 12px #f5b88d,
        0 16px #2563eb,
        4px 16px #2563eb,
        8px 16px #2563eb,
        12px 16px #2563eb,
        -4px 20px #f5b88d,
        0 20px #2563eb,
        4px 20px #2563eb,
        8px 20px #2563eb,
        12px 20px #f5b88d,
        0 24px #1f2937,
        8px 24px #1f2937,
        0 28px #1f2937,
        8px 28px #1f2937;
    }

    .pixel-sword {
      position: absolute;
      left: 19px;
      top: 10px;
      width: 4px;
      height: 4px;
      display: none;
      background: #e5e7eb;
      image-rendering: pixelated;
      transform: scale(${CHARACTER.visualScale});
      transform-origin: 0 100%;
      box-shadow:
        4px -4px #e5e7eb,
        8px -8px #f8fafc,
        12px -12px #f8fafc,
        16px -16px #94a3b8,
        -4px 4px #7c2d12,
        0 4px #7c2d12,
        4px 4px #7c2d12;
    }

    .pixel-person[data-animation="walk"] .pixel-body {
      animation: pixel-walk 360ms steps(2, end) infinite;
    }

    .pixel-person[data-animation="jump"] .pixel-body,
    .pixel-person[data-animation="fall"] .pixel-body {
      top: 0;
    }

    .pixel-person[data-animation="land"] .pixel-body {
      animation: pixel-land 160ms steps(1, end);
    }

    .pixel-person[data-animation="attack"] .pixel-body {
      animation: pixel-attack-body ${RAGE.attackDurationMs}ms steps(3, end) infinite;
    }

    .pixel-person[data-animation="attack"] .pixel-sword {
      display: block;
      animation: pixel-sword-slash ${RAGE.attackDurationMs}ms steps(5, end) infinite;
    }

    .pixel-person[data-skin="ember"] .pixel-body {
      background: #2a1f18;
      box-shadow:
        -4px -4px #2a1f18,
        0 -4px #2a1f18,
        4px -4px #2a1f18,
        8px -4px #2a1f18,
        12px -4px #2a1f18,
        -4px 0 #2a1f18,
        0 0 #2a1f18,
        4px 0 #2a1f18,
        8px 0 #2a1f18,
        12px 0 #2a1f18,
        16px 0 #2a1f18,
        -4px 4px #2a1f18,
        0 4px #dfb18e,
        4px 4px #dfb18e,
        8px 4px #dfb18e,
        12px 4px #dfb18e,
        0 8px #dfb18e,
        4px 8px #111827,
        8px 8px #dfb18e,
        12px 8px #111827,
        -2px 9px #111827,
        6px 9px #111827,
        14px 9px #111827,
        4px 12px #dfb18e,
        8px 12px #dfb18e,
        -4px 16px #111827,
        0 16px #111827,
        4px 16px #111827,
        8px 16px #111827,
        12px 16px #111827,
        16px 16px #111827,
        -4px 20px #111827,
        0 20px #111827,
        4px 20px #1e3a8a,
        8px 20px #111827,
        12px 20px #dfb18e,
        0 24px #4b5563,
        8px 24px #4b5563,
        0 28px #4b5563,
        8px 28px #4b5563;
      filter: none;
    }

    .pixel-person[data-skin="mint"] .pixel-body {
      filter: sepia(1) saturate(3) hue-rotate(105deg) brightness(1.08);
    }

    .pixel-person[data-skin="shadow"] .pixel-body {
      filter: grayscale(1) contrast(1.35) brightness(0.62);
    }

    .pixel-person[data-skin="autumn"] .pixel-body {
      background: #0f172a;
      box-shadow:
        4px -4px #0f172a,
        8px -4px #0f172a,
        12px 0 #0f172a,
        0 0 #0f172a,
        4px 0 #0f172a,
        8px 0 #0f172a,
        -4px 4px #0f172a,
        0 4px #d7a27e,
        4px 4px #d7a27e,
        8px 4px #d7a27e,
        12px 4px #d7a27e,
        0 8px #d7a27e,
        4px 8px #111827,
        8px 8px #d7a27e,
        12px 8px #111827,
        -2px 9px #111827,
        6px 9px #111827,
        14px 9px #111827,
        4px 12px #d7a27e,
        8px 12px #d7a27e,
        0 16px #7f1d1d,
        4px 16px #7f1d1d,
        8px 16px #7f1d1d,
        12px 16px #7f1d1d,
        -4px 20px #d7a27e,
        0 20px #7f1d1d,
        4px 20px #7f1d1d,
        8px 20px #7f1d1d,
        12px 20px #d7a27e,
        0 24px #111827,
        8px 24px #111827,
        0 28px #111827,
        8px 28px #111827;
    }

    .pixel-person[data-skin="custom"] .pixel-body {
      left: var(--custom-skin-left, 2px);
      top: var(--custom-skin-top, -2px);
      width: var(--custom-skin-display-width, 24px);
      height: var(--custom-skin-display-height, 36px);
      background: transparent var(--custom-skin-image) center / var(--custom-skin-bg-size, 100% 100%) no-repeat;
      box-shadow: none;
      image-rendering: pixelated;
    }

    .pixel-person[data-mood="rage"] {
      animation: pixel-rage-shake 180ms steps(2, end) infinite;
      filter:
        drop-shadow(0 2px 0 rgba(0, 0, 0, 0.25))
        drop-shadow(0 0 6px rgba(239, 68, 68, 0.65));
    }

    .pixel-person[data-mood="rage"] .pixel-body {
      filter: sepia(1) saturate(6) hue-rotate(320deg) brightness(0.92) !important;
    }

    .pixel-clock {
      position: absolute;
      left: 22px;
      top: 14px;
      display: none;
      box-sizing: border-box;
      pointer-events: none;
      image-rendering: pixelated;
    }

    .pixel-person[data-accessory="clock"] .pixel-clock {
      display: block;
    }

    .pixel-person[data-clock-mode="analog"] .pixel-clock {
      width: 24px;
      height: 24px;
      border: 2px solid #111827;
      border-radius: 50%;
      background: #fef3c7;
      box-shadow: 1px 1px 0 rgba(17, 24, 39, 0.45);
    }

    .pixel-person[data-clock-mode="analog"] .pixel-clock::before,
    .pixel-person[data-clock-mode="analog"] .pixel-clock::after {
      content: "";
      position: absolute;
      left: 10px;
      top: 3px;
      width: 2px;
      height: 9px;
      background: #111827;
      transform-origin: 1px 9px;
    }

    .pixel-person[data-clock-mode="analog"] .pixel-clock::before {
      transform: rotate(var(--clock-hour, 0deg));
    }

    .pixel-person[data-clock-mode="analog"] .pixel-clock::after {
      height: 8px;
      transform-origin: 1px 8px;
      transform: rotate(var(--clock-minute, 90deg));
    }

    .pixel-person[data-clock-mode="digital"] .pixel-clock {
      min-width: 50px;
      height: 24px;
      padding: 2px 4px;
      color: #22c55e;
      background: #111827;
      border: 1px solid #020617;
      font: 700 14px/20px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: 0;
    }

    .pixel-person[data-direction="-1"][data-clock-mode="digital"] .pixel-clock {
      transform: scaleX(-1);
    }

    .pixel-person[data-direction="-1"][data-clock-mode="analog"] .pixel-clock {
      transform: scaleX(-1);
    }

    .pixel-person[data-clock-mode="analog"] .pixel-clock[data-pomodoro="true"] {
      width: 24px;
      height: 24px;
      background: #fee2e2;
      border-color: #991b1b;
    }

    .pixel-person[data-clock-mode="analog"] .pixel-clock[data-pomodoro="true"]::before,
    .pixel-person[data-clock-mode="analog"] .pixel-clock[data-pomodoro="true"]::after {
      left: 10px;
      top: 3px;
      height: 9px;
      background: #991b1b;
      transform-origin: 1px 9px;
      opacity: 1;
    }

    .pixel-person[data-clock-mode="analog"] .pixel-clock[data-pomodoro="true"]::after {
      height: 8px;
      transform-origin: 1px 8px;
    }

    .pixel-person[data-clock-mode="digital"] .pixel-clock[data-pomodoro="true"] {
      min-width: 58px !important;
      width: auto !important;
      height: 24px !important;
      padding: 2px 4px !important;
      color: #fef3c7 !important;
      background: #991b1b !important;
      border: 2px solid #111827 !important;
      border-radius: 0 !important;
      box-shadow: 1px 1px 0 rgba(17, 24, 39, 0.45) !important;
      font: 700 13px/18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
      letter-spacing: 0 !important;
      text-align: center !important;
    }

    .pixel-person[data-clock-mode="digital"] .pixel-clock[data-pomodoro="true"]::before,
    .pixel-person[data-clock-mode="digital"] .pixel-clock[data-pomodoro="true"]::after {
      display: none !important;
    }

    .pixel-person[hidden] {
      display: none;
    }

    .portal-door {
      position: absolute;
      left: 1px;
      bottom: 0;
      z-index: 2;
      width: 26px;
      height: 34px;
      pointer-events: none;
      opacity: 0;
      transform-origin: 0 100%;
      image-rendering: pixelated;
    }

    .portal-door::before {
      content: "";
      position: absolute;
      left: 1px;
      top: 0;
      width: 4px;
      height: 4px;
      background: #111827;
      box-shadow:
        4px 0 #111827,
        8px 0 #111827,
        12px 0 #111827,
        16px 0 #111827,
        20px 0 #111827,
        0 4px #111827,
        20px 4px #111827,
        0 8px #111827,
        20px 8px #111827,
        0 12px #111827,
        20px 12px #111827,
        0 16px #111827,
        20px 16px #111827,
        0 20px #111827,
        20px 20px #111827,
        0 24px #111827,
        20px 24px #111827,
        0 28px #111827,
        4px 28px #111827,
        8px 28px #111827,
        12px 28px #111827,
        16px 28px #111827,
        20px 28px #111827;
    }

    .portal-door::after {
      content: "";
      position: absolute;
      left: 5px;
      top: 4px;
      width: 4px;
      height: 4px;
      background: #7c3f1d;
      transform-origin: 0 50%;
      box-shadow:
        4px 0 #8b5a2b,
        8px 0 #8b5a2b,
        12px 0 #7c3f1d,
        0 4px #8b5a2b,
        4px 4px #9a6a35,
        8px 4px #9a6a35,
        12px 4px #8b5a2b,
        0 8px #7c3f1d,
        4px 8px #8b5a2b,
        8px 8px #facc15,
        12px 8px #7c3f1d,
        0 12px #8b5a2b,
        4px 12px #9a6a35,
        8px 12px #9a6a35,
        12px 12px #8b5a2b,
        0 16px #7c3f1d,
        4px 16px #8b5a2b,
        8px 16px #8b5a2b,
        12px 16px #7c3f1d,
        0 20px #8b5a2b,
        4px 20px #9a6a35,
        8px 20px #9a6a35,
        12px 20px #8b5a2b;
    }

    .companion-stage[data-portal="exiting"] .portal-door,
    .companion-stage[data-portal="hidden"] .portal-door,
    .companion-stage[data-portal="entering"] .portal-door,
    .companion-stage[data-portal="entered"] .portal-door {
      opacity: 1;
    }

    .companion-stage[data-portal="exiting"] .portal-door::after {
      animation: door-open-close ${PORTAL.exitDurationMs}ms steps(4, end) both;
    }

    .companion-stage[data-portal="entering"] .portal-door::after {
      animation: door-open-close ${PORTAL.enterPopDurationMs}ms steps(4, end) ${PORTAL.enterHoldMs}ms both;
    }

    .companion-stage[data-portal="entered"] .portal-door {
      animation: door-pop-away ${PORTAL.enteredDoorPopDurationMs}ms steps(3, end) ${PORTAL.enteredDoorLingerMs}ms both;
    }

    .companion-stage[data-hidden-door="true"] .portal-door {
      z-index: 3;
      opacity: 1;
      pointer-events: auto;
      cursor: pointer;
    }

    .companion-stage[data-hidden-door="true"] .portal-door::after {
      transform: scaleX(1);
    }

    .companion-stage[data-hidden-door="true"] .pixel-person {
      z-index: 2;
      pointer-events: none;
      opacity: 0;
      transform: translateX(4px) scale(1);
      transition: opacity 120ms steps(2, end), transform 120ms steps(2, end);
    }

    .companion-stage[data-hidden-door="true"] .portal-door:hover::after {
      transform: scaleX(0.42);
    }

    .companion-stage[data-hidden-door="true"] .portal-door:hover + .pixel-person {
      opacity: 1;
      transform: translateX(15px) scale(1);
    }

    .companion-stage[data-hidden-door="true"] .pixel-person[data-clock-mode="digital"] .pixel-clock,
    .companion-stage[data-hidden-door="true"] .pixel-person[data-clock-mode="analog"] .pixel-clock {
      transform: scaleX(1);
    }

    .companion-stage[data-portal="exiting"] .pixel-person {
      pointer-events: none;
      animation: pixel-enter-door ${PORTAL.exitDurationMs}ms steps(5, end) both;
    }

    .companion-stage[data-portal="entering"] .pixel-person {
      pointer-events: none;
      animation: pixel-exit-door ${PORTAL.enterPopDurationMs}ms steps(5, end) ${PORTAL.enterHoldMs}ms both;
    }

    .companion-stage[data-portal="exiting"] .companion-panel,
    .companion-stage[data-portal="hidden"] .companion-panel,
    .companion-stage[data-portal="entering"] .companion-panel {
      display: none;
    }

    .companion-panel {
      position: absolute;
      top: var(--panel-top, -218px);
      left: var(--panel-left, -10px);
      width: 335px;
      box-sizing: border-box;
      padding: 8px;
      pointer-events: auto;
      color: #1f2937;
      background: #fff7d6;
      border: 3px solid #1f2937;
      box-shadow: 4px 4px 0 rgba(31, 41, 55, 0.35);
      font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .companion-panel[hidden] {
      display: none;
    }

    .panel-tabs {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 3px;
      margin-bottom: 8px;
    }

    .panel-tab,
    .panel-action,
    .skin-option {
      all: initial;
      box-sizing: border-box;
      color: #1f2937;
      background: #ffffff;
      border: 2px solid #1f2937;
      font: 700 10px/22px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      text-align: center;
      cursor: pointer;
    }

    .panel-action:disabled {
      opacity: 0.45;
      cursor: default;
    }

    .physics-pane {
      display: grid;
      gap: 9px;
    }

    .slider-control {
      display: grid;
      gap: 5px;
    }

    .slider-header {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: #1f2937;
      font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .slider-value {
      color: #2563eb;
    }

    .panel-slider {
      width: 100%;
      accent-color: #2563eb;
    }

    .hide-action {
      width: 100%;
      padding: 0 6px;
    }

    .about-pane {
      display: grid;
      gap: 8px;
    }

    .about-text {
      margin: 0;
      padding: 7px 8px;
      color: #1f2937;
      background: rgba(255, 255, 255, 0.68);
      border: 2px solid rgba(31, 41, 55, 0.38);
      font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .gemini-key-form {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      padding: 7px 8px;
      color: #1f2937;
      background: rgba(255, 255, 255, 0.68);
      border: 2px solid rgba(31, 41, 55, 0.38);
      font: 10px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .gemini-key-help,
    .gemini-key-status {
      grid-column: 1 / -1;
      margin: 0;
    }

    .gemini-key-status {
      font-weight: 700;
      color: #2563eb;
    }

    .gemini-key-input {
      all: initial;
      grid-column: 1 / -1;
      min-width: 0;
      box-sizing: border-box;
      height: 26px;
      padding: 4px 6px;
      color: #1f2937;
      background: #ffffff;
      border: 2px solid #1f2937;
      font: 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .gemini-key-submit,
    .gemini-key-clear {
      all: initial;
      box-sizing: border-box;
      min-width: 0;
      height: 26px;
      padding: 0 5px;
      color: #1f2937;
      background: #ffffff;
      border: 2px solid #1f2937;
      text-align: center;
      font: 700 10px/22px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      cursor: pointer;
    }

    .gemini-key-submit {
      color: #ffffff;
      background: #2563eb;
    }

    .gemini-key-submit:disabled,
    .gemini-key-clear:disabled {
      opacity: 0.55;
      cursor: wait;
    }

    .panel-tab[data-active="true"],
    .panel-action[data-active="true"],
    .skin-option[data-active="true"] {
      color: #ffffff;
      background: #2563eb;
      box-shadow: 2px 2px 0 rgba(31, 41, 55, 0.35);
    }

    .panel-pane[hidden] {
      display: none;
    }

    .chat-log {
      display: grid;
      gap: 6px;
      min-height: 54px;
      max-height: 150px;
      overflow: auto;
      margin-bottom: 8px;
      white-space: normal;
      word-break: break-word;
    }

    .chat-message {
      padding: 5px 6px;
      color: #1f2937;
      background: rgba(255, 255, 255, 0.68);
      border: 2px solid rgba(31, 41, 55, 0.38);
      font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .chat-message[data-role="user"] {
      background: #dbeafe;
    }

    .chat-row {
      display: grid;
      grid-template-columns: 1fr 28px;
      gap: 6px;
      align-items: center;
    }

    .chat-input {
      all: initial;
      min-width: 0;
      box-sizing: border-box;
      height: 26px;
      padding: 4px 6px;
      color: #1f2937;
      background: #ffffff;
      border: 2px solid #1f2937;
      font: 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .blocked-row {
      display: grid;
      grid-template-columns: 1fr 28px;
      gap: 6px;
      align-items: center;
    }

    .blocked-input {
      all: initial;
      min-width: 0;
      box-sizing: border-box;
      height: 26px;
      padding: 4px 6px;
      color: #1f2937;
      background: #ffffff;
      border: 2px solid #1f2937;
      font: 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .chat-submit,
    .blocked-submit,
    .blocked-remove {
      all: initial;
      box-sizing: border-box;
      height: 26px;
      color: #ffffff;
      background: #2563eb;
      border: 2px solid #1f2937;
      text-align: center;
      font: 700 14px/22px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      cursor: pointer;
    }

    .chat-submit:disabled {
      opacity: 0.6;
      cursor: wait;
    }

    .blocked-list {
      display: grid;
      gap: 5px;
      max-height: 116px;
      overflow: auto;
      margin-bottom: 8px;
    }

    .blocked-item {
      display: grid;
      grid-template-columns: 1fr 26px;
      gap: 6px;
      align-items: center;
      min-width: 0;
      padding: 4px 5px;
      color: #1f2937;
      background: rgba(255, 255, 255, 0.72);
      border: 2px solid #1f2937;
      font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .blocked-item span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .blocked-remove {
      height: 22px;
      color: #ffffff;
      background: #dc2626;
      font: 700 12px/18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .clock-pane {
      display: grid;
      gap: 8px;
      justify-items: center;
    }

    .panel-clock-face {
      position: relative;
      width: 70px;
      height: 70px;
      box-sizing: border-box;
      color: #111827;
      background: #ffffff;
      border: 3px solid #111827;
      border-radius: 50%;
      box-shadow: 4px 4px 0 rgba(31, 41, 55, 0.35);
    }

    .panel-clock-face[data-mode="digital"] {
      width: 118px;
      height: 42px;
      border-radius: 0;
      display: grid;
      place-items: center;
      color: #22c55e;
      background: #111827;
    }

    .clock-hand {
      position: absolute;
      left: 32px;
      top: 10px;
      width: 3px;
      height: 25px;
      background: #111827;
      transform-origin: 1px 25px;
    }

    .clock-hand.hour {
      top: 18px;
      height: 17px;
      transform-origin: 1px 17px;
    }

    .panel-clock-face[data-mode="digital"] .clock-hand {
      display: none;
    }

    .panel-clock-digital {
      position: absolute;
      inset: 0;
      display: none;
      place-items: center;
      font: 700 20px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: 0;
    }

    .panel-clock-face[data-mode="digital"] .panel-clock-digital {
      display: grid;
    }

    .pomodoro-box {
      display: grid;
      width: 100%;
      gap: 6px;
      justify-items: center;
      padding-top: 2px;
    }

    .pomodoro-box[hidden] {
      display: none;
    }

    .pomodoro-time {
      position: relative;
      box-sizing: border-box;
      width: 112px;
      color: #fef3c7;
      background: #991b1b;
      border: 2px solid #111827;
      box-shadow: 3px 3px 0 rgba(31, 41, 55, 0.28);
      text-align: center;
      font: 700 20px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: 0;
    }

    .pomodoro-time[data-mode="digital"] {
      display: grid;
      min-height: 34px;
      padding: 5px 6px;
      place-items: center;
    }

    .pomodoro-time[data-mode="analog"] {
      width: 72px;
      height: 72px;
      padding: 0;
      border: 4px solid #111827;
      border-radius: 50%;
      background: #ffffff;
      box-shadow: 4px 4px 0 rgba(31, 41, 55, 0.35);
    }

    .pomodoro-time[data-mode="analog"]::before {
      content: "";
      position: absolute;
      left: 32px;
      top: 8px;
      width: 3px;
      height: 27px;
      background: #111827;
      transform-origin: 1px 27px;
    }

    .pomodoro-hand {
      display: none;
    }

    .pomodoro-time[data-mode="analog"] .pomodoro-hand {
      position: absolute;
      left: 32px;
      top: 10px;
      display: block;
      width: 3px;
      height: 25px;
      background: #991b1b;
      transform-origin: 1px 25px;
    }

    .pomodoro-time[data-mode="analog"] .pomodoro-hand.minute {
      transform: rotate(var(--pomodoro-minute, 0deg));
    }

    .pomodoro-time[data-mode="analog"] .pomodoro-digital {
      display: none;
    }

    .pomodoro-time[data-mode="digital"] .pomodoro-digital {
      display: block;
    }

    .pomodoro-status {
      color: #374151;
      font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .pomodoro-toggle {
      width: 100%;
    }

    .pomodoro-actions,
    .pomodoro-durations {
      width: 100%;
    }

    .pomodoro-actions {
      grid-template-columns: repeat(3, 1fr);
    }

    .pomodoro-durations {
      grid-template-columns: repeat(2, 1fr);
    }

    .segmented {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 5px;
      width: 100%;
    }

    .pomodoro-actions {
      grid-template-columns: repeat(3, 1fr);
    }

    .pomodoro-durations {
      grid-template-columns: repeat(2, 1fr);
    }

    .skin-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
    }

    .custom-skin-section {
      display: grid;
      gap: 6px;
      width: 100%;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 2px solid rgba(31, 41, 55, 0.32);
    }

    .custom-skin-title {
      color: #111827;
      font: 700 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .custom-skin-help,
    .custom-skin-status {
      color: #4b5563;
      font: 10px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .custom-skin-actions {
      display: grid;
      grid-template-columns: 1fr 64px;
      gap: 6px;
      width: 100%;
    }

    .custom-skin-list {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
      max-height: 92px;
      overflow: auto;
    }

    .custom-skin-input {
      display: none;
    }

    .skin-option {
      display: grid;
      grid-template-columns: 22px 1fr;
      gap: 6px;
      align-items: center;
      padding: 5px;
      line-height: 1;
    }

    .skin-preview {
      width: 18px;
      height: 18px;
      background: #2563eb;
      border: 2px solid #111827;
      box-shadow: inset 0 5px #f5b88d;
      image-rendering: pixelated;
    }

    .skin-preview[data-skin="ember"] {
      background: #111827;
      box-shadow:
        inset 0 5px #dfb18e,
        0 -3px 0 #2a1f18,
        inset 5px 0 #111827,
        inset -5px 0 #4b5563,
        0 4px 0 #1e3a8a;
    }

    .skin-preview[data-skin="mint"] {
      background: #14b8a6;
      box-shadow: inset 0 5px #bbf7d0;
    }

    .skin-preview[data-skin="shadow"] {
      background: #111827;
      box-shadow: inset 0 5px #94a3b8;
    }

    .skin-preview[data-skin="autumn"] {
      background: #7f1d1d;
      box-shadow:
        inset 0 5px #d7a27e,
        0 -3px 0 #0f172a,
        inset 5px 0 #111827,
        inset -5px 0 #111827;
    }

    .skin-preview[data-skin="custom"] {
      background:
        var(--custom-skin-image) center / contain no-repeat,
        repeating-conic-gradient(#f9fafb 0 25%, #e5e7eb 0 50%) 0 0 / 8px 8px;
      box-shadow: none;
    }

    @keyframes pixel-walk {
      0% {
        transform: scale(${CHARACTER.visualScale}) translateY(0);
      }
      50% {
        transform: scale(${CHARACTER.visualScale}) translateY(-2px);
      }
      100% {
        transform: scale(${CHARACTER.visualScale}) translateY(0);
      }
    }

    @keyframes pixel-land {
      0% {
        transform: scale(${CHARACTER.visualScale}) scaleY(0.86) translateY(4px);
      }
      100% {
        transform: scale(${CHARACTER.visualScale}) scaleY(1) translateY(0);
      }
    }

    @keyframes pixel-rage-shake {
      0% {
        margin-left: -1px;
      }
      50% {
        margin-left: 1px;
      }
      100% {
        margin-left: -1px;
      }
    }

    @keyframes pixel-attack-body {
      0% {
        transform: scale(${CHARACTER.visualScale}) translateX(0);
      }
      40% {
        transform: scale(${CHARACTER.visualScale}) translateX(2px);
      }
      100% {
        transform: scale(${CHARACTER.visualScale}) translateX(0);
      }
    }

    @keyframes pixel-sword-slash {
      0% {
        opacity: 1;
        transform: scale(${CHARACTER.visualScale}) rotate(-62deg) translate(0, 0);
      }
      45% {
        opacity: 1;
        transform: scale(${CHARACTER.visualScale}) rotate(34deg) translate(4px, 1px);
      }
      100% {
        opacity: 0;
        transform: scale(${CHARACTER.visualScale}) rotate(52deg) translate(6px, 2px);
      }
    }

    @keyframes door-open-close {
      0% {
        transform: scaleX(1);
      }
      22% {
        transform: scaleX(0.28);
      }
      70% {
        transform: scaleX(0.28);
      }
      100% {
        transform: scaleX(1);
      }
    }

    @keyframes door-pop-away {
      0% {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
      55% {
        opacity: 1;
        transform: scale(1.18) translateY(-2px);
      }
      100% {
        opacity: 0;
        transform: scale(0.2) translateY(-8px);
      }
    }

    @keyframes pixel-enter-door {
      0% {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
      30% {
        opacity: 1;
        transform: translateX(2px) scale(1);
      }
      68% {
        opacity: 1;
        transform: translateX(8px) scale(0.72);
      }
      100% {
        opacity: 0;
        transform: translateX(10px) scale(0.35);
      }
    }

    @keyframes pixel-exit-door {
      0% {
        opacity: 0;
        transform: translateX(10px) scale(0.35);
      }
      35% {
        opacity: 1;
        transform: translateX(8px) scale(0.72);
      }
      100% {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
    }
  `;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampToViewportX(x) {
  const min = window.scrollX + CHARACTER.edgePadding;
  const max = window.scrollX + Math.max(
    CHARACTER.edgePadding,
    window.innerWidth - CHARACTER.width - CHARACTER.edgePadding
  );
  return clamp(x, min, max);
}

function clampToViewportY(y) {
  const min = window.scrollY + CHARACTER.edgePadding;
  const max = window.scrollY + Math.max(
    CHARACTER.edgePadding,
    window.innerHeight - CHARACTER.height - CHARACTER.edgePadding
  );
  return clamp(y, min, max);
}
