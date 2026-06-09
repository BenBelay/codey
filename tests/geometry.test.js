import test from "node:test";
import assert from "node:assert/strict";
import { clipViewportRect, getUsableRect, viewportRectToWorldRect } from "../src/shared/geometry.js";

test("viewportRectToWorldRect adds scroll offsets", () => {
  const result = viewportRectToWorldRect({
    left: 10,
    top: 20,
    right: 110,
    bottom: 50
  }, 5, 200);

  assert.deepEqual(result, {
    left: 15,
    top: 220,
    right: 115,
    bottom: 250,
    width: 100,
    height: 30,
    source: "dom"
  });
});

test("clipViewportRect trims offscreen rectangles", () => {
  assert.deepEqual(clipViewportRect({
    left: -20,
    top: 40,
    right: 60,
    bottom: 80
  }, 100, 100), {
    left: 0,
    top: 40,
    right: 60,
    bottom: 80,
    width: 60,
    height: 40,
    source: "dom"
  });
});

test("clipViewportRect drops fully offscreen rectangles", () => {
  assert.equal(clipViewportRect({
    left: 120,
    top: 10,
    right: 160,
    bottom: 40
  }, 100, 100), null);
});

test("getUsableRect ignores fixed overlays", () => {
  const element = createElement({
    rect: {
      left: 10,
      top: 10,
      right: 210,
      bottom: 60
    },
    style: {
      position: "fixed"
    }
  });

  assert.equal(getUsableRect(element, {
    viewportWidth: 500,
    viewportHeight: 500,
    scrollX: 0,
    scrollY: 0
  }), null);
});

test("getUsableRect accepts visible platform-like elements", () => {
  const element = createElement({
    rect: {
      left: 12,
      top: 30,
      right: 180,
      bottom: 72
    }
  });

  const result = getUsableRect(element, {
    viewportWidth: 500,
    viewportHeight: 500,
    scrollX: 3,
    scrollY: 90
  });

  assert.equal(result.left, 15);
  assert.equal(result.top, 120);
  assert.equal(result.width, 168);
  assert.equal(result.height, 42);
});

function createElement({ rect, style = {}, tagName = "P" }) {
  return {
    tagName,
    getBoundingClientRect() {
      return rect;
    },
    ownerDocument: {
      defaultView: {
        getComputedStyle() {
          return {
            display: "block",
            visibility: "visible",
            opacity: "1",
            pointerEvents: "auto",
            position: "static",
            ...style
          };
        }
      }
    }
  };
}

