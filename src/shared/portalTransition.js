import { PORTAL } from "./constants.js";

export function createPortalTransition() {
  return {
    status: "inactive",
    kind: "none",
    phaseStartedAt: 0
  };
}

export function createPageEnterTransition(now = performance.now()) {
  return createEnterTransition("page-change", now);
}

export function createTabEnterTransition(now = performance.now()) {
  return createEnterTransition("tab-change", now);
}

export function createEnterTransition(kind = "page-change", now = performance.now()) {
  return {
    status: "entering",
    kind,
    phaseStartedAt: now
  };
}

export function updatePortalTransition(transition, cursor, now = performance.now()) {
  const next = transition || createPortalTransition();
  const cursorInTrigger = isCursorInTopLeftTrigger(cursor);
  const elapsed = now - (next.phaseStartedAt || 0);

  if (next.status === "inactive" && cursorInTrigger) {
    return startPhase("exiting", "top-left", now);
  }

  if (next.status === "exiting" && elapsed >= PORTAL.exitDurationMs) {
    return startPhase("hidden", "top-left", now);
  }

  if (next.status === "hidden" && !cursorInTrigger) {
    return startPhase("entering", "top-left", now);
  }

  if (next.status === "entering" && elapsed >= PORTAL.enterVisibleDurationMs) {
    return startPhase("entered", next.kind, now);
  }

  if (
    next.status === "entered"
    && elapsed >= PORTAL.enteredDoorLingerMs + PORTAL.enteredDoorPopDurationMs
  ) {
    return startPhase("inactive", "none", now);
  }

  return next;
}

export function isCharacterVisibleDuringPortal(transition) {
  return transition?.status !== "hidden";
}

export function shouldRunPhysicsDuringPortal(transition) {
  return !transition || transition.status === "inactive" || transition.status === "entered";
}

export function isCursorInTopLeftTrigger(cursor) {
  return Boolean(cursor)
    && cursor.x >= 0
    && cursor.y >= 0
    && cursor.x <= PORTAL.topLeftTriggerSize
    && cursor.y <= PORTAL.topLeftTriggerSize;
}

function startPhase(status, kind, now) {
  return {
    status,
    kind,
    phaseStartedAt: now
  };
}
