import test from "node:test";
import assert from "node:assert/strict";
import { CHARACTER } from "../src/shared/constants.js";
import { resolveVerticalLanding, stepCharacter } from "../src/shared/physics.js";

test("resolveVerticalLanding finds crossed platform", () => {
  const previous = {
    x: 40,
    y: 60
  };
  const next = {
    x: 42,
    y: 88,
    vy: 100
  };
  const platform = {
    left: 30,
    right: 120,
    top: 120,
    bottom: 146
  };

  assert.equal(resolveVerticalLanding(next, [platform], previous, CHARACTER.width, CHARACTER.height), platform);
});

test("stepCharacter lands on a platform and switches to walk", () => {
  const originalRandom = Math.random;

  try {
    Math.random = () => 1;
    const result = stepCharacter({
      x: 40,
      y: 90,
      vx: CHARACTER.walkSpeed,
      vy: 250,
      direction: 1,
      animation: "fall",
      currentUrl: "https://example.com",
      lastActiveAt: 0
    }, [{
      left: 20,
      right: 180,
      top: 130,
      bottom: 154
    }], {
      viewportWidth: 800,
      viewportHeight: 600,
      scrollY: 0,
      documentHeight: 1200,
      characterWidth: CHARACTER.width,
      characterHeight: CHARACTER.height
    }, 0.016);

    assert.equal(result.y, 130 - CHARACTER.height);
    assert.equal(result.vy, 0);
    assert.match(result.animation, /walk|idle/);
  } finally {
    Math.random = originalRandom;
  }
});

test("stepCharacter turns around at viewport edge", () => {
  const result = stepCharacter({
    x: 2,
    y: 200,
    vx: -CHARACTER.walkSpeed,
    vy: 0,
    direction: -1,
    animation: "walk",
    currentUrl: "https://example.com",
    lastActiveAt: 0
  }, [], {
    viewportWidth: 320,
    viewportHeight: 600,
    scrollY: 0,
    documentHeight: 1200,
    characterWidth: CHARACTER.width,
    characterHeight: CHARACTER.height
  }, 0.016);

  assert.equal(result.x, CHARACTER.edgePadding);
  assert.equal(result.direction, 1);
  assert.ok(result.vx > 0);
});

test("stepCharacter keeps falling when no platform is crossed", () => {
  const result = stepCharacter({
    x: 40,
    y: 40,
    vx: CHARACTER.walkSpeed,
    vy: 0,
    direction: 1,
    animation: "fall",
    currentUrl: "https://example.com",
    lastActiveAt: 0
  }, [], {
    viewportWidth: 800,
    viewportHeight: 600,
    scrollY: 0,
    documentHeight: 1200,
    characterWidth: CHARACTER.width,
    characterHeight: CHARACTER.height
  }, 0.02);

  assert.equal(result.animation, "fall");
  assert.ok(result.vy > 0);
  assert.ok(result.y > 40);
});

test("stepCharacter keeps the character inside the bottom of the viewport", () => {
  const result = stepCharacter({
    x: 40,
    y: 380,
    vx: CHARACTER.walkSpeed,
    vy: 900,
    direction: 1,
    animation: "fall",
    currentUrl: "https://example.com",
    lastActiveAt: 0
  }, [], {
    viewportWidth: 800,
    viewportHeight: 420,
    scrollY: 0,
    documentHeight: 2000,
    characterWidth: CHARACTER.width,
    characterHeight: CHARACTER.height
  }, 0.05);

  assert.equal(result.y, 420 - CHARACTER.height - CHARACTER.edgePadding);
  assert.equal(result.vy, 0);
  assert.equal(result.animation, "walk");
});

test("stepCharacter follows the scrolled viewport when left above it", () => {
  const result = stepCharacter({
    x: 40,
    y: 80,
    vx: CHARACTER.walkSpeed,
    vy: 0,
    direction: 1,
    animation: "walk",
    currentUrl: "https://example.com",
    lastActiveAt: 0
  }, [], {
    viewportWidth: 800,
    viewportHeight: 600,
    scrollY: 500,
    documentHeight: 2000,
    characterWidth: CHARACTER.width,
    characterHeight: CHARACTER.height
  }, 0.016);

  assert.equal(result.y, 500 + CHARACTER.edgePadding);
  assert.ok(result.y - 500 >= 0);
});

test("stepCharacter respects horizontal scroll when clamping to the viewport", () => {
  const result = stepCharacter({
    x: 40,
    y: 140,
    vx: -CHARACTER.walkSpeed,
    vy: 0,
    direction: -1,
    animation: "walk",
    currentUrl: "https://example.com",
    lastActiveAt: 0
  }, [], {
    viewportWidth: 500,
    viewportHeight: 600,
    scrollX: 300,
    scrollY: 0,
    documentHeight: 2000,
    characterWidth: CHARACTER.width,
    characterHeight: CHARACTER.height
  }, 0.016);

  assert.equal(result.x, 300 + CHARACTER.edgePadding);
  assert.equal(result.direction, 1);
});

test("stepCharacter slows near the cursor without changing direction", () => {
  const baseState = {
    x: 120,
    y: 180,
    vx: CHARACTER.walkSpeed,
    vy: 0,
    direction: 1,
    animation: "walk",
    currentUrl: "https://example.com",
    lastActiveAt: 0
  };
  const environment = {
    viewportWidth: 800,
    viewportHeight: 600,
    scrollX: 0,
    scrollY: 0,
    documentHeight: 2000,
    characterWidth: CHARACTER.width,
    characterHeight: CHARACTER.height
  };

  const withoutCursor = stepCharacter(baseState, [], environment, 0.016);
  const withCursor = stepCharacter(baseState, [], {
    ...environment,
    cursor: {
      x: baseState.x + CHARACTER.width / 2,
      y: baseState.y + CHARACTER.height / 2
    }
  }, 0.016);

  assert.ok(withCursor.x > baseState.x);
  assert.ok(withCursor.x < withoutCursor.x);
  assert.equal(withCursor.vx, withoutCursor.vx);
  assert.equal(withCursor.direction, withoutCursor.direction);
});

test("stepCharacter applies speed scale to horizontal movement", () => {
  const state = {
    x: 120,
    y: 180,
    vx: 100,
    vy: 0,
    direction: 1,
    animation: "walk",
    currentUrl: "https://example.com",
    lastActiveAt: 0
  };
  const environment = {
    viewportWidth: 800,
    viewportHeight: 600,
    scrollX: 0,
    scrollY: 0,
    documentHeight: 2000,
    characterWidth: CHARACTER.width,
    characterHeight: CHARACTER.height
  };

  const normal = stepCharacter(state, [], environment, 0.02);
  const fast = stepCharacter(state, [], {
    ...environment,
    speedScale: 2
  }, 0.02);

  assert.ok(fast.x > normal.x);
});

test("stepCharacter keeps jump height fixed when jumpiness changes", () => {
  const state = {
    x: 21,
    y: 90,
    vx: CHARACTER.walkSpeed,
    vy: 250,
    direction: 1,
    animation: "fall",
    currentUrl: "https://example.com",
    lastActiveAt: 0
  };
  const platform = {
    left: 20,
    right: 180,
    top: 130,
    bottom: 154
  };
  const environment = {
    viewportWidth: 800,
    viewportHeight: 600,
    scrollY: 0,
    documentHeight: 1200,
    characterWidth: CHARACTER.width,
    characterHeight: CHARACTER.height,
    jumpinessScale: 1.5
  };

  const result = stepCharacter(state, [platform], environment, 0.016);

  assert.equal(result.animation, "jump");
  assert.equal(result.vy, -CHARACTER.jumpSpeed);
});

test("stepCharacter applies jumpiness scale to random jump frequency", () => {
  const originalRandom = Math.random;
  const state = {
    x: 80,
    y: 90,
    vx: CHARACTER.walkSpeed,
    vy: 250,
    direction: 1,
    animation: "fall",
    currentUrl: "https://example.com",
    lastActiveAt: 0
  };
  const platform = {
    left: 20,
    right: 180,
    top: 130,
    bottom: 154
  };
  const environment = {
    viewportWidth: 800,
    viewportHeight: 600,
    scrollY: 0,
    documentHeight: 1200,
    characterWidth: CHARACTER.width,
    characterHeight: CHARACTER.height
  };

  try {
    Math.random = () => 0.025;
    const lowJumpiness = stepCharacter(state, [platform], {
      ...environment,
      jumpinessScale: 1
    }, 0.016);
    const highJumpiness = stepCharacter(state, [platform], {
      ...environment,
      jumpinessScale: 2
    }, 0.016);

    assert.notEqual(lowJumpiness.animation, "jump");
    assert.equal(highJumpiness.animation, "jump");
    assert.equal(highJumpiness.vy, -CHARACTER.jumpSpeed);
  } finally {
    Math.random = originalRandom;
  }
});
