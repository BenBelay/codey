import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultPreferences,
  mergePreferences,
  normalizePreferences,
  SKIN_LABELS
} from "../src/shared/preferences.js";

test("normalizePreferences fills default companion preferences", () => {
  assert.deepEqual(normalizePreferences(null), createDefaultPreferences());
});

test("skin labels expose character names", () => {
  assert.equal(SKIN_LABELS.default, "SamA");
  assert.equal(SKIN_LABELS.ember, "Benjamin");
  assert.equal(SKIN_LABELS.mint, "Andy");
  assert.equal(SKIN_LABELS.shadow, "Jimmy");
  assert.equal(SKIN_LABELS.autumn, "VB");
  assert.equal(SKIN_LABELS.custom, "Custom");
});

test("normalizePreferences accepts valid skin, clock, and panel values", () => {
  const customSkinDataUrl = "data:image/png;base64,iVBORw0KGgo=";
  const customSkin = {
    id: "custom:abc123",
    label: "Person 1",
    dataUrl: customSkinDataUrl,
    subjectKind: "person",
    generator: "gemini-sprite-plan",
    generatorVersion: 3,
    spriteWidth: 15,
    spriteHeight: 15,
    features: ["glasses", "hat", "glasses"],
    createdAt: 123
  };
  const normalizedCustomSkin = {
    ...customSkin,
    features: ["glasses", "hat"]
  };
  assert.deepEqual(normalizePreferences({
    enabled: true,
    chatEnabled: true,
    selectedSkin: "custom:abc123",
    customSkinDataUrl,
    customSkins: [customSkin],
    clockMode: "digital",
    clockEnabled: true,
    pomodoroSectionVisible: true,
    pomodoroEnabled: true,
    pomodoroStatus: "running",
    pomodoroDurationSeconds: 1500,
    pomodoroRemainingSeconds: 900,
    pomodoroEndsAt: 123456,
    speedScale: 1.4,
    jumpinessScale: 1.6,
    hiddenInDoor: true,
    activePanelTab: "about",
    blockedSites: ["Example.com", "https://www.youtube.com/watch?v=1"]
  }), {
    enabled: true,
    chatEnabled: true,
    selectedSkin: "custom:abc123",
    customSkinDataUrl,
    customSkins: [normalizedCustomSkin],
    clockMode: "digital",
    clockEnabled: true,
    pomodoroSectionVisible: true,
    pomodoroEnabled: true,
    pomodoroStatus: "running",
    pomodoroDurationSeconds: 1500,
    pomodoroRemainingSeconds: 900,
    pomodoroEndsAt: 123456,
    speedScale: 1.4,
    jumpinessScale: 1.6,
    hiddenInDoor: true,
    activePanelTab: "about",
    blockedSites: ["example.com", "youtube.com"]
  });
});

test("normalizePreferences repairs invalid enum values", () => {
  const prefs = normalizePreferences({
    selectedSkin: "unknown",
    customSkinDataUrl: "javascript:alert(1)",
    customSkins: [{ id: "bad", label: "", dataUrl: "nope" }],
    clockMode: "binary",
    pomodoroSectionVisible: "",
    pomodoroStatus: "later",
    pomodoroDurationSeconds: -1,
    pomodoroRemainingSeconds: Number.POSITIVE_INFINITY,
    pomodoroEndsAt: -1,
    speedScale: 5,
    jumpinessScale: 0.1,
    activePanelTab: "settings"
  });

  assert.equal(prefs.selectedSkin, "default");
  assert.equal(prefs.customSkinDataUrl, "");
  assert.deepEqual(prefs.customSkins, []);
  assert.equal(prefs.clockMode, "analog");
  assert.equal(prefs.pomodoroSectionVisible, false);
  assert.equal(prefs.pomodoroStatus, "idle");
  assert.equal(prefs.pomodoroDurationSeconds, 1500);
  assert.equal(prefs.pomodoroRemainingSeconds, 1500);
  assert.equal(prefs.pomodoroEndsAt, 0);
  assert.equal(prefs.speedScale, 2);
  assert.equal(prefs.jumpinessScale, 0.5);
  assert.equal(prefs.hiddenInDoor, false);
  assert.equal(prefs.activePanelTab, "ai");
  assert.deepEqual(prefs.blockedSites, ["instagram.com", "tiktok.com", "x.com", "youtube.com"]);
});

test("normalizePreferences never persists API key fields", () => {
  const prefs = normalizePreferences({
    selectedSkin: "default",
    geminiApiKey: "gemini-secret",
    apiKey: "another-secret",
    preferences: {
      geminiApiKey: "nested-secret"
    }
  });

  assert.equal("geminiApiKey" in prefs, false);
  assert.equal("apiKey" in prefs, false);
  assert.equal(JSON.stringify(prefs).includes("secret"), false);
});

test("normalizePreferences migrates the legacy single custom skin", () => {
  const customSkinDataUrl = "data:image/png;base64,iVBORw0KGgo=";
  const prefs = normalizePreferences({
    selectedSkin: "custom",
    customSkinDataUrl
  });

  assert.equal(prefs.selectedSkin, "custom:legacy");
  assert.equal(prefs.customSkins.length, 1);
  assert.equal(prefs.customSkins[0].id, "custom:legacy");
  assert.equal(prefs.customSkins[0].dataUrl, customSkinDataUrl);
  assert.equal(prefs.customSkins[0].generator, "legacy");
  assert.equal(prefs.customSkins[0].generatorVersion, 1);
  assert.equal(prefs.customSkins[0].spriteWidth, 24);
  assert.equal(prefs.customSkins[0].spriteHeight, 36);
  assert.deepEqual(prefs.customSkins[0].features, []);
});

test("mergePreferences preserves existing settings and normalizes patch values", () => {
  const prefs = mergePreferences({
    selectedSkin: "mint",
    clockMode: "digital",
    clockEnabled: true,
    pomodoroStatus: "paused",
    pomodoroRemainingSeconds: 600,
    speedScale: 1.3
  }, {
    selectedSkin: "shadow",
    activePanelTab: "clock",
    pomodoroStatus: "running",
    pomodoroEndsAt: 1234,
    jumpinessScale: 1.8,
    hiddenInDoor: true,
    blockedSites: ["https://news.ycombinator.com/item?id=1"]
  });

  assert.equal(prefs.selectedSkin, "shadow");
  assert.equal(prefs.clockMode, "digital");
  assert.equal(prefs.clockEnabled, true);
  assert.equal(prefs.pomodoroStatus, "running");
  assert.equal(prefs.pomodoroRemainingSeconds, 600);
  assert.equal(prefs.pomodoroEndsAt, 1234);
  assert.equal(prefs.speedScale, 1.3);
  assert.equal(prefs.jumpinessScale, 1.8);
  assert.equal(prefs.hiddenInDoor, true);
  assert.equal(prefs.activePanelTab, "clock");
  assert.deepEqual(prefs.blockedSites, ["news.ycombinator.com"]);
});
