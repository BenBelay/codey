import test from "node:test";
import assert from "node:assert/strict";
import { PORTAL } from "../src/shared/constants.js";
import {
  createEnterTransition,
  createPageEnterTransition,
  createPortalTransition,
  createTabEnterTransition,
  isCharacterVisibleDuringPortal,
  isCursorInTopLeftTrigger,
  shouldRunPhysicsDuringPortal,
  updatePortalTransition
} from "../src/shared/portalTransition.js";

test("isCursorInTopLeftTrigger detects the configured corner zone", () => {
  assert.equal(isCursorInTopLeftTrigger({ x: 10, y: 10 }), true);
  assert.equal(isCursorInTopLeftTrigger({ x: PORTAL.topLeftTriggerSize + 1, y: 10 }), false);
  assert.equal(isCursorInTopLeftTrigger({ x: 10, y: PORTAL.topLeftTriggerSize + 1 }), false);
  assert.equal(isCursorInTopLeftTrigger(null), false);
});

test("updatePortalTransition exits, hides, enters, and returns inactive", () => {
  const idle = createPortalTransition();
  const exiting = updatePortalTransition(idle, { x: 4, y: 6 }, 100);
  assert.equal(exiting.status, "exiting");
  assert.equal(shouldRunPhysicsDuringPortal(exiting), false);
  assert.equal(isCharacterVisibleDuringPortal(exiting), true);

  const hidden = updatePortalTransition(exiting, { x: 4, y: 6 }, 100 + PORTAL.exitDurationMs);
  assert.equal(hidden.status, "hidden");
  assert.equal(isCharacterVisibleDuringPortal(hidden), false);

  const entering = updatePortalTransition(hidden, { x: 180, y: 120 }, 1000);
  assert.equal(entering.status, "entering");
  assert.equal(isCharacterVisibleDuringPortal(entering), true);

  const entered = updatePortalTransition(entering, { x: 180, y: 120 }, 1000 + PORTAL.enterVisibleDurationMs);
  assert.equal(entered.status, "entered");
  assert.equal(shouldRunPhysicsDuringPortal(entered), true);

  const inactive = updatePortalTransition(
    entered,
    { x: 180, y: 120 },
    1000 + PORTAL.enterVisibleDurationMs + PORTAL.enteredDoorLingerMs + PORTAL.enteredDoorPopDurationMs
  );
  assert.equal(inactive.status, "inactive");
  assert.equal(shouldRunPhysicsDuringPortal(inactive), true);
});

test("createPageEnterTransition starts directly in the entering phase", () => {
  const entering = createPageEnterTransition(500);
  assert.equal(entering.status, "entering");
  assert.equal(entering.kind, "page-change");
  assert.equal(entering.phaseStartedAt, 500);

  const entered = updatePortalTransition(entering, null, 500 + PORTAL.enterVisibleDurationMs);
  assert.equal(entered.status, "entered");

  const inactive = updatePortalTransition(
    entered,
    null,
    500 + PORTAL.enterVisibleDurationMs + PORTAL.enteredDoorLingerMs + PORTAL.enteredDoorPopDurationMs
  );
  assert.equal(inactive.status, "inactive");
});

test("createTabEnterTransition starts an entering phase for activated tabs", () => {
  const entering = createTabEnterTransition(700);
  assert.equal(entering.status, "entering");
  assert.equal(entering.kind, "tab-change");
  assert.equal(entering.phaseStartedAt, 700);
});

test("createEnterTransition supports explicit enter reasons", () => {
  const entering = createEnterTransition("manual-test", 900);
  assert.equal(entering.status, "entering");
  assert.equal(entering.kind, "manual-test");
});

test("entering uses a 500ms hold before the character pops out", () => {
  const entering = createPageEnterTransition(1000);

  assert.equal(PORTAL.enterHoldMs, 500);
  assert.equal(PORTAL.enterVisibleDurationMs, PORTAL.enterHoldMs + PORTAL.enterPopDurationMs);

  const stillEntering = updatePortalTransition(
    entering,
    null,
    1000 + PORTAL.enterVisibleDurationMs - 1
  );
  assert.equal(stillEntering.status, "entering");

  const entered = updatePortalTransition(entering, null, 1000 + PORTAL.enterVisibleDurationMs);
  assert.equal(entered.status, "entered");
});

test("entered keeps the door visible for one second before popping away", () => {
  const entering = createPageEnterTransition(1000);
  const entered = updatePortalTransition(entering, null, 1000 + PORTAL.enterVisibleDurationMs);

  assert.equal(PORTAL.enteredDoorLingerMs, 1000);
  assert.equal(PORTAL.enterDurationMs, PORTAL.enterVisibleDurationMs + PORTAL.enteredDoorLingerMs + PORTAL.enteredDoorPopDurationMs);
  assert.equal(shouldRunPhysicsDuringPortal(entered), true);

  const stillEntered = updatePortalTransition(
    entered,
    null,
    1000 + PORTAL.enterVisibleDurationMs + PORTAL.enteredDoorLingerMs - 1
  );
  assert.equal(stillEntered.status, "entered");

  const inactive = updatePortalTransition(
    entered,
    null,
    1000 + PORTAL.enterDurationMs
  );
  assert.equal(inactive.status, "inactive");
});
