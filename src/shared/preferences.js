import { BAD_SITE_HOSTS, normalizeBlockedSites } from "./siteReactions.js";

export const SKINS = Object.freeze(["default", "ember", "mint", "shadow", "autumn", "custom"]);
export const SKIN_LABELS = Object.freeze({
  default: "SamA",
  ember: "Benjamin",
  mint: "Andy",
  shadow: "Jimmy",
  autumn: "VB",
  custom: "Custom"
});
export const CLOCK_MODES = Object.freeze(["analog", "digital"]);
export const PANEL_TABS = Object.freeze(["ai", "clock", "profile", "physics", "blocked", "about"]);
export const POMODORO_STATUSES = Object.freeze(["idle", "running", "paused", "complete"]);
export const POMODORO_DEFAULT_SECONDS = 25 * 60;
export const CUSTOM_SKIN_PREFIX = "custom:";

export function createDefaultPreferences() {
  return {
    enabled: true,
    chatEnabled: true,
    selectedSkin: "default",
    customSkinDataUrl: "",
    customSkins: [],
    clockMode: "analog",
    clockEnabled: false,
    pomodoroSectionVisible: false,
    pomodoroEnabled: false,
    pomodoroStatus: "idle",
    pomodoroDurationSeconds: POMODORO_DEFAULT_SECONDS,
    pomodoroRemainingSeconds: POMODORO_DEFAULT_SECONDS,
    pomodoroEndsAt: 0,
    speedScale: 1,
    jumpinessScale: 1,
    hiddenInDoor: false,
    activePanelTab: "ai",
    blockedSites: normalizeBlockedSites(BAD_SITE_HOSTS)
  };
}

export function normalizePreferences(candidate) {
  const fallback = createDefaultPreferences();

  if (!candidate || typeof candidate !== "object") {
    return fallback;
  }

  const customSkinDataUrl = normalizeCustomSkinDataUrl(candidate.customSkinDataUrl);
  const customSkins = normalizeCustomSkins(candidate.customSkins, customSkinDataUrl);

  return {
    enabled: candidate.enabled !== false,
    chatEnabled: candidate.chatEnabled !== false,
    selectedSkin: normalizeSelectedSkin(candidate.selectedSkin, customSkins, fallback.selectedSkin),
    customSkinDataUrl,
    customSkins,
    clockMode: CLOCK_MODES.includes(candidate.clockMode) ? candidate.clockMode : fallback.clockMode,
    clockEnabled: Boolean(candidate.clockEnabled),
    pomodoroSectionVisible: Boolean(candidate.pomodoroSectionVisible),
    pomodoroEnabled: Boolean(candidate.pomodoroEnabled),
    pomodoroStatus: POMODORO_STATUSES.includes(candidate.pomodoroStatus)
      ? candidate.pomodoroStatus
      : fallback.pomodoroStatus,
    pomodoroDurationSeconds: normalizePomodoroSeconds(
      candidate.pomodoroDurationSeconds,
      fallback.pomodoroDurationSeconds
    ),
    pomodoroRemainingSeconds: normalizePomodoroSeconds(
      candidate.pomodoroRemainingSeconds,
      fallback.pomodoroRemainingSeconds
    ),
    pomodoroEndsAt: Number.isFinite(candidate.pomodoroEndsAt) && candidate.pomodoroEndsAt > 0
      ? candidate.pomodoroEndsAt
      : fallback.pomodoroEndsAt,
    speedScale: normalizeScale(candidate.speedScale, fallback.speedScale),
    jumpinessScale: normalizeScale(candidate.jumpinessScale, fallback.jumpinessScale),
    hiddenInDoor: Boolean(candidate.hiddenInDoor),
    activePanelTab: PANEL_TABS.includes(candidate.activePanelTab) ? candidate.activePanelTab : fallback.activePanelTab,
    blockedSites: normalizeBlockedSites(candidate.blockedSites || fallback.blockedSites)
  };
}

export function mergePreferences(current, patch) {
  return normalizePreferences({
    ...normalizePreferences(current),
    ...(patch || {})
  });
}

function normalizeScale(value, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0.5, Math.min(2, Math.round(value * 100) / 100));
}

function normalizePomodoroSeconds(value, fallback) {
  if (!Number.isFinite(value) || value < 60) {
    return fallback;
  }

  return Math.max(60, Math.min(99 * 60 + 59, Math.round(value)));
}

function normalizeCustomSkinDataUrl(value) {
  if (typeof value !== "string" || value.length > 250_000) {
    return "";
  }

  return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
    ? value
    : "";
}

function normalizeCustomSkins(candidate, legacyDataUrl = "") {
  const seen = new Set();
  const normalized = [];

  if (Array.isArray(candidate)) {
    for (const item of candidate) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const id = normalizeCustomSkinId(item.id);
      const dataUrl = normalizeCustomSkinDataUrl(item.dataUrl);

      if (!id || !dataUrl || seen.has(id)) {
        continue;
      }

      seen.add(id);
      normalized.push({
        id,
        label: normalizeCustomSkinLabel(item.label, normalized.length + 1),
        dataUrl,
        subjectKind: normalizeSubjectKind(item.subjectKind),
        generator: normalizeCustomSkinGenerator(item.generator, item.generatorVersion),
        generatorVersion: normalizeGeneratorVersion(item.generatorVersion),
        spriteWidth: normalizeCustomSkinSpriteDimension(item.spriteWidth),
        spriteHeight: normalizeCustomSkinSpriteDimension(item.spriteHeight),
        features: normalizeCustomSkinFeatures(item.features),
        createdAt: Number.isFinite(item.createdAt) && item.createdAt > 0 ? item.createdAt : Date.now()
      });
    }
  }

  if (legacyDataUrl && normalized.length === 0) {
    normalized.unshift({
      id: `${CUSTOM_SKIN_PREFIX}legacy`,
      label: "Custom 1",
      dataUrl: legacyDataUrl,
      subjectKind: "person",
      generator: "legacy",
      generatorVersion: 1,
      spriteWidth: 24,
      spriteHeight: 36,
      features: [],
      createdAt: 1
    });
  }

  return normalized.slice(0, 24);
}

function normalizeSelectedSkin(value, customSkins, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  if (value === "custom") {
    return customSkins[0]?.id || fallback;
  }

  if (value.startsWith(CUSTOM_SKIN_PREFIX)) {
    return customSkins.some((skin) => skin.id === value) ? value : fallback;
  }

  return SKINS.includes(value) && value !== "custom" ? value : fallback;
}

function normalizeCustomSkinId(value) {
  if (typeof value !== "string" || !value.startsWith(CUSTOM_SKIN_PREFIX)) {
    return "";
  }

  const suffix = value.slice(CUSTOM_SKIN_PREFIX.length).replace(/[^a-z0-9_-]/gi, "").slice(0, 48);
  return suffix ? `${CUSTOM_SKIN_PREFIX}${suffix}` : "";
}

function normalizeCustomSkinLabel(value, fallbackIndex) {
  if (typeof value !== "string") {
    return `Custom ${fallbackIndex}`;
  }

  const label = value.replace(/\s+/g, " ").trim().slice(0, 24);
  return label || `Custom ${fallbackIndex}`;
}

function normalizeSubjectKind(value) {
  return ["person", "animal", "object"].includes(value) ? value : "person";
}

function normalizeGeneratorVersion(value) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 1;
}

function normalizeCustomSkinGenerator(value, version) {
  if (
    value === "gemini-sprite-plan"
    || value === "local-shape-aware"
    || value === "local-vb-portrait"
    || value === "legacy"
  ) {
    return value;
  }

  const normalizedVersion = normalizeGeneratorVersion(version);
  if (normalizedVersion >= 3) {
    return "gemini-sprite-plan";
  }

  if (normalizedVersion === 2) {
    return "local-shape-aware";
  }

  return "legacy";
}

function normalizeCustomSkinFeatures(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];

  for (const feature of value) {
    if (typeof feature !== "string") {
      continue;
    }

    const clean = feature.replace(/[^a-z0-9_-]/gi, "").toLowerCase().slice(0, 24);
    if (!clean || seen.has(clean)) {
      continue;
    }

    seen.add(clean);
    normalized.push(clean);

    if (normalized.length >= 12) {
      break;
    }
  }

  return normalized;
}

function normalizeCustomSkinSpriteDimension(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const normalized = Math.round(value);
  return normalized >= 1 && normalized <= 64 ? normalized : 0;
}
