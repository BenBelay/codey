export const STORAGE_KEYS = Object.freeze({
  characterState: "companion.characterState",
  characterSession: "companion.characterSession",
  preferences: "companion.preferences",
  lastPageContext: "companion.lastPageContext"
});

export const CHARACTER = Object.freeze({
  width: 37,
  height: 48,
  visualScale: 1.2,
  gravity: 2100,
  maxFallSpeed: 1800,
  walkSpeed: 74,
  jumpSpeed: 710,
  surfaceSnapDistance: 18,
  edgePadding: 10,
  cursorSlowRadius: 110,
  cursorSlowScale: 0.08
});

export const WORLD = Object.freeze({
  geometryRefreshMs: 650,
  statePersistMs: 900,
  maxPlatforms: 240,
  minPlatformWidth: 22,
  minPlatformHeight: 8,
  maxPlatformHeight: 260
});

export const PORTAL = Object.freeze({
  topLeftTriggerSize: 84,
  exitDurationMs: 760,
  enterHoldMs: 500,
  enterPopDurationMs: 620,
  enterVisibleDurationMs: 1120,
  enteredDoorLingerMs: 1000,
  enteredDoorPopDurationMs: 180,
  enterDurationMs: 2300
});

export const RAGE = Object.freeze({
  runSpeed: 360,
  attackRange: 34,
  attackDurationMs: 260,
  attackCooldownMs: 80,
  crumpleDurationMs: 420,
  maxTargetsPerBurst: 1,
  clusterDestroyCount: 5,
  clusterRadiusPx: 320,
  targetMemorySize: 10,
  maxPrimaryViewportCoverage: 0.55,
  maxClusterViewportCoverage: 0.7,
  jumpIntervalMs: 950,
  jumpSpeed: 520
});
