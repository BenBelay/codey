import { WORLD } from "./constants.js";

const PLATFORM_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "summary",
  "nav",
  "header",
  "footer",
  "main",
  "article",
  "section",
  "p",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "img",
  "video",
  "canvas",
  "[role='button']",
  "[role='link']",
  "[role='navigation']",
  "[data-companion-platform]"
].join(",");

export function collectPlatformRects({
  doc = document,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
  scrollX = window.scrollX,
  scrollY = window.scrollY,
  extensionHost
} = {}) {
  const rects = [];
  const seen = new Set();
  const candidates = Array.from(doc.querySelectorAll(PLATFORM_SELECTOR));

  for (const element of candidates) {
    if (rects.length >= WORLD.maxPlatforms) {
      break;
    }

    if (extensionHost && (element === extensionHost || extensionHost.contains(element))) {
      continue;
    }

    const rect = getUsableRect(element, {
      viewportWidth,
      viewportHeight,
      scrollX,
      scrollY
    });

    if (!rect) {
      continue;
    }

    const key = `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    rects.push(rect);
  }

  rects.sort((a, b) => a.top - b.top || a.left - b.left);
  return rects;
}

export function getUsableRect(element, viewport) {
  if (!element || typeof element.getBoundingClientRect !== "function") {
    return null;
  }

  const style = getElementStyle(element);

  if (!isVisibleStyle(style)) {
    return null;
  }

  if (style.position === "fixed") {
    return null;
  }

  const domRect = element.getBoundingClientRect();
  const clipped = clipViewportRect(domRect, viewport.viewportWidth, viewport.viewportHeight);

  if (!clipped) {
    return null;
  }

  if (clipped.width < WORLD.minPlatformWidth || clipped.height < WORLD.minPlatformHeight) {
    return null;
  }

  if (clipped.height > WORLD.maxPlatformHeight && !isNaturallyPlatformLike(element)) {
    return null;
  }

  return viewportRectToWorldRect(clipped, viewport.scrollX, viewport.scrollY);
}

export function viewportRectToWorldRect(rect, scrollX = 0, scrollY = 0) {
  return {
    left: rect.left + scrollX,
    top: rect.top + scrollY,
    right: rect.right + scrollX,
    bottom: rect.bottom + scrollY,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    source: rect.source || "dom"
  };
}

export function clipViewportRect(rect, viewportWidth, viewportHeight) {
  const left = clamp(rect.left, 0, viewportWidth);
  const right = clamp(rect.right, 0, viewportWidth);
  const top = clamp(rect.top, 0, viewportHeight);
  const bottom = clamp(rect.bottom, 0, viewportHeight);

  if (right <= left || bottom <= top) {
    return null;
  }

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    source: rect.source || "dom"
  };
}

function getElementStyle(element) {
  const view = element.ownerDocument?.defaultView;
  if (!view || typeof view.getComputedStyle !== "function") {
    return {
      display: "block",
      visibility: "visible",
      opacity: "1",
      pointerEvents: "auto",
      position: "static"
    };
  }

  return view.getComputedStyle(element);
}

function isVisibleStyle(style) {
  return style.display !== "none"
    && style.visibility !== "hidden"
    && Number.parseFloat(style.opacity || "1") > 0.05;
}

function isNaturallyPlatformLike(element) {
  const tagName = element.tagName?.toLowerCase();
  return tagName === "img"
    || tagName === "video"
    || tagName === "canvas"
    || tagName === "button"
    || tagName === "input";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

