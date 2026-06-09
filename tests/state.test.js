import test from "node:test";
import assert from "node:assert/strict";
import {
  attachSessionToState,
  createCompanionSession,
  createDefaultCharacterState,
  normalizeCharacterState,
  normalizeCompanionSession
} from "../src/shared/state.js";

test("default character state includes stable companion identity fields", () => {
  const state = createDefaultCharacterState(800, 0);

  assert.equal(typeof state.companionId, "string");
  assert.equal(state.companionId.startsWith("pixel-"), true);
  assert.equal(state.continuityVersion, 1);
  assert.equal(state.pageHops, 0);
});

test("normalizeCharacterState preserves an existing companion identity", () => {
  const fallback = createDefaultCharacterState(800, 0);
  const state = normalizeCharacterState({
    companionId: "pixel-same-one",
    companionCreatedAt: 123,
    x: 44,
    y: 55,
    currentUrl: "https://example.com",
    pageHops: 7
  }, fallback);

  assert.equal(state.companionId, "pixel-same-one");
  assert.equal(state.companionCreatedAt, 123);
  assert.equal(state.pageHops, 7);
});

test("attachSessionToState makes page states part of the same companion session", () => {
  const session = createCompanionSession(100);
  const state = attachSessionToState(createDefaultCharacterState(800, 0), {
    ...session,
    pageHops: 4
  });

  assert.equal(state.companionId, session.companionId);
  assert.equal(state.companionCreatedAt, 100);
  assert.equal(state.pageHops, 4);
});

test("normalizeCompanionSession keeps stable session values", () => {
  const session = normalizeCompanionSession({
    companionId: "pixel-existing",
    companionCreatedAt: 10,
    pageHops: 3,
    lastUrl: "https://example.com",
    lastActiveAt: 20
  });

  assert.equal(session.companionId, "pixel-existing");
  assert.equal(session.companionCreatedAt, 10);
  assert.equal(session.pageHops, 3);
  assert.equal(session.lastUrl, "https://example.com");
});
