import { CHARACTER } from "./constants.js";

export function createDefaultCharacterState(viewportWidth = 1024, scrollY = 0) {
  const now = Date.now();
  const session = createCompanionSession(now);

  return {
    companionId: session.companionId,
    companionCreatedAt: session.companionCreatedAt,
    continuityVersion: 1,
    x: Math.max(24, Math.min(viewportWidth - CHARACTER.width - 24, 96)),
    y: scrollY + 120,
    vx: CHARACTER.walkSpeed,
    vy: 0,
    direction: 1,
    animation: "fall",
    currentUrl: "",
    pageHops: 0,
    lastActiveAt: now
  };
}

export function normalizeCharacterState(candidate, fallback) {
  if (!candidate || typeof candidate !== "object") {
    return { ...fallback };
  }

  return {
    companionId: typeof candidate.companionId === "string" ? candidate.companionId : fallback.companionId,
    companionCreatedAt: finiteOr(candidate.companionCreatedAt, fallback.companionCreatedAt),
    continuityVersion: finiteOr(candidate.continuityVersion, fallback.continuityVersion || 1),
    x: finiteOr(candidate.x, fallback.x),
    y: finiteOr(candidate.y, fallback.y),
    vx: finiteOr(candidate.vx, fallback.vx),
    vy: finiteOr(candidate.vy, fallback.vy),
    direction: candidate.direction === -1 ? -1 : 1,
    animation: typeof candidate.animation === "string" ? candidate.animation : fallback.animation,
    currentUrl: typeof candidate.currentUrl === "string" ? candidate.currentUrl : fallback.currentUrl,
    viewportX: finiteOr(candidate.viewportX, fallback.viewportX),
    viewportY: finiteOr(candidate.viewportY, fallback.viewportY),
    pageHops: finiteOr(candidate.pageHops, fallback.pageHops || 0),
    lastActiveAt: finiteOr(candidate.lastActiveAt, fallback.lastActiveAt)
  };
}

export function createCompanionSession(now = Date.now()) {
  return {
    companionId: createCompanionId(),
    companionCreatedAt: now,
    pageHops: 0,
    lastUrl: "",
    lastActiveAt: now
  };
}

export function normalizeCompanionSession(candidate, fallback = createCompanionSession()) {
  if (!candidate || typeof candidate !== "object") {
    return { ...fallback };
  }

  return {
    companionId: typeof candidate.companionId === "string" ? candidate.companionId : fallback.companionId,
    companionCreatedAt: finiteOr(candidate.companionCreatedAt, fallback.companionCreatedAt),
    pageHops: finiteOr(candidate.pageHops, fallback.pageHops),
    lastUrl: typeof candidate.lastUrl === "string" ? candidate.lastUrl : fallback.lastUrl,
    lastActiveAt: finiteOr(candidate.lastActiveAt, fallback.lastActiveAt)
  };
}

export function attachSessionToState(state, session) {
  return {
    ...state,
    companionId: session.companionId,
    companionCreatedAt: session.companionCreatedAt,
    continuityVersion: 1,
    pageHops: session.pageHops
  };
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function createCompanionId() {
  if (globalThis.crypto?.randomUUID) {
    return `pixel-${globalThis.crypto.randomUUID()}`;
  }

  return `pixel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
