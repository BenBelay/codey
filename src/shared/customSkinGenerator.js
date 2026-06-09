export const CUSTOM_SKIN_GENERATOR_VERSION = 4;
export const GEMINI_SKIN_GENERATOR_VERSION = 7;
export const VB_PORTRAIT_GENERATOR_VERSION = 1;
export const COMPANION_PORTRAIT_GENERATOR_VERSION = 1;
export const COMPANION_ANIMAL_GENERATOR_VERSION = 1;
export const CUSTOM_SKIN_SPRITE_WIDTH = 24;
export const CUSTOM_SKIN_SPRITE_HEIGHT = 36;
export const GEMINI_SPRITE_WIDTH = 15;
export const GEMINI_SPRITE_HEIGHT = 15;
export const GEMINI_SPRITE_PLAN_MAX_BLOCKS = 90;

const OUTLINE = Object.freeze({ r: 17, g: 24, b: 39, a: 255 });
const TRANSPARENT = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

export function extractForegroundMask(imageData) {
  const { width, height, data } = imageData;
  const mask = new Uint8Array(width * height);
  let hasUsefulAlpha = false;

  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 245) {
      hasUsefulAlpha = true;
      break;
    }
  }

  if (hasUsefulAlpha) {
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      mask[pixel] = data[pixel * 4 + 3] > 36 ? 1 : 0;
    }

    return { width, height, data: mask };
  }

  const borderSamples = getBorderSamples(imageData);
  const threshold = Math.max(46, getAverageBorderDistance(borderSamples) * 1.55);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = getPixel(imageData, x, y);
      const borderDistance = getMinimumColorDistance(color, borderSamples);
      const edgeBias = x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 14 : 0;
      mask[y * width + x] = borderDistance > threshold + edgeBias ? 1 : 0;
    }
  }

  return { width, height, data: mask };
}

export function findPrimaryComponent(mask) {
  const { width, height, data } = mask;
  const visited = new Uint8Array(data.length);
  let bestPixels = [];
  let bestBounds = null;

  for (let start = 0; start < data.length; start += 1) {
    if (!data[start] || visited[start]) {
      continue;
    }

    const queue = [start];
    const pixels = [];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    visited[start] = 1;

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const pixel = queue[cursor];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      pixels.push(pixel);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      for (const neighbor of getNeighbors(x, y, width, height)) {
        if (data[neighbor] && !visited[neighbor]) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }

    if (pixels.length > bestPixels.length) {
      bestPixels = pixels;
      bestBounds = {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        count: pixels.length
      };
    }
  }

  const component = new Uint8Array(data.length);
  for (const pixel of bestPixels) {
    component[pixel] = 1;
  }

  return {
    width,
    height,
    data: component,
    bounds: bestBounds || { x: 0, y: 0, width, height, count: 0 }
  };
}

export function sampleRegionColors(imageData, mask) {
  const colors = [];
  const upper = [];
  const middle = [];
  const lower = [];
  const { width, data } = mask;
  const bounds = mask.bounds || getMaskBounds(mask);

  forEachMaskPixel(mask, (x, y) => {
    const color = getPixel(imageData, x, y);
    colors.push(color);

    const normalizedY = bounds.height > 0 ? (y - bounds.y) / bounds.height : 0;
    if (normalizedY < 0.34) {
      upper.push(color);
    } else if (normalizedY < 0.72) {
      middle.push(color);
    } else {
      lower.push(color);
    }
  });

  const dominantColor = dominantColorFrom(colors);
  const darkUpper = upper.filter((color) => getLuma(color) < 96);
  const skinPixels = colors.filter(isLikelySkinColor);

  return {
    colors,
    dominantColor,
    faceColor: skinPixels.length > Math.max(8, colors.length * 0.025)
      ? averageColor(skinPixels)
      : lightenColor(dominantColor, 26),
    hairColor: darkUpper.length > 4 ? dominantColorFrom(darkUpper) : darkenColor(dominantColor, 46),
    outfitColor: dominantColorFrom(middle.filter((color) => !isLikelySkinColor(color)), dominantColor),
    lowerColor: dominantColorFrom(lower.filter((color) => !isLikelySkinColor(color)), darkenColor(dominantColor, 30)),
    accentColor: getAccentColor(colors, dominantColor),
    skinRatio: colors.length ? skinPixels.length / colors.length : 0,
    darkUpperRatio: upper.length ? darkUpper.length / upper.length : 0,
    width
  };
}

export function classifyForegroundShape(mask, colors = sampleRegionColors(createBlankImageData(mask.width, mask.height), mask)) {
  const bounds = mask.bounds || getMaskBounds(mask);
  const aspect = bounds.height / Math.max(1, bounds.width);
  const fill = bounds.count / Math.max(1, bounds.width * bounds.height);
  const topWidth = getMaskRowSpanRatio(mask, bounds, 0.12);
  const middleWidth = getMaskRowSpanRatio(mask, bounds, 0.48);
  const lowerWidth = getMaskRowSpanRatio(mask, bounds, 0.84);

  if (aspect > 1.28 && (colors.skinRatio > 0.045 || lowerWidth <= middleWidth * 0.92)) {
    return "person";
  }

  if (aspect < 0.82 || topWidth > middleWidth * 1.18 || lowerWidth > middleWidth * 1.08) {
    return "animal";
  }

  if (fill > 0.62 && colors.skinRatio < 0.045) {
    return "object";
  }

  return aspect > 1.38 ? "person" : "object";
}

export function renderShapeAwarePixelSprite(imageData, mask, colors, subjectKind) {
  const sourceBounds = mask.bounds || getMaskBounds(mask);
  const sprite = createSprite(CUSTOM_SKIN_SPRITE_WIDTH, CUSTOM_SKIN_SPRITE_HEIGHT);
  const targetBounds = getTargetBounds(sourceBounds, subjectKind);
  const targetMask = new Uint8Array(sprite.width * sprite.height);

  for (let y = 0; y < targetBounds.height; y += 1) {
    for (let x = 0; x < targetBounds.width; x += 1) {
      const sourceX0 = Math.floor(sourceBounds.x + (x / targetBounds.width) * sourceBounds.width);
      const sourceX1 = Math.ceil(sourceBounds.x + ((x + 1) / targetBounds.width) * sourceBounds.width);
      const sourceY0 = Math.floor(sourceBounds.y + (y / targetBounds.height) * sourceBounds.height);
      const sourceY1 = Math.ceil(sourceBounds.y + ((y + 1) / targetBounds.height) * sourceBounds.height);
      const occupancy = getOccupancy(mask, sourceX0, sourceY0, sourceX1, sourceY1);

      if (occupancy > 0.26) {
        const targetX = targetBounds.x + x;
        const targetY = targetBounds.y + y;
        targetMask[targetY * sprite.width + targetX] = 1;
        setSpritePixel(sprite, targetX, targetY, quantizedAverage(imageData, mask, sourceX0, sourceY0, sourceX1, sourceY1, colors.dominantColor));
      }
    }
  }

  refineSubjectShape(sprite, targetMask, colors, subjectKind);
  addFeetIfNeeded(sprite, targetMask, colors, subjectKind);
  addOutline(sprite, targetMask);

  return sprite;
}

export function generateShapeAwarePixelSprite(imageData) {
  const foregroundMask = extractForegroundMask(imageData);
  const component = findPrimaryComponent(foregroundMask);
  const colors = sampleRegionColors(imageData, component);
  const subjectKind = classifyForegroundShape(component, colors);
  const sprite = renderShapeAwarePixelSprite(imageData, component, colors, subjectKind);

  return {
    sprite,
    subjectKind,
    generatorVersion: CUSTOM_SKIN_GENERATOR_VERSION
  };
}

export function canCreateCompanionPortraitSprite(imageData) {
  if (!imageData?.width || !imageData?.height || !imageData?.data) {
    return false;
  }

  const faceRegion = getRegionColors(imageData, 0.25, 0.12, 0.75, 0.62);
  const lowerFaceRegion = getRegionColors(imageData, 0.34, 0.36, 0.66, 0.62);
  const lowerRegion = getRegionColors(imageData, 0.14, 0.58, 0.86, 0.98);
  const faceSkinRatio = getPredicateRatio(faceRegion, isLikelySkinColor);
  const lowerFaceSkinRatio = getPredicateRatio(lowerFaceRegion, isLikelySkinColor);
  const clothingRatio = getPredicateRatio(lowerRegion, (color) => (
    !isLikelySkinColor(color)
    && (getSaturation(color) > 0.10 || getLuma(color) < 120)
  ));

  return faceSkinRatio >= 0.18
    && lowerFaceSkinRatio >= 0.20
    && clothingRatio >= 0.08;
}

export function canCreateVbPortraitSprite(imageData) {
  if (!imageData?.width || !imageData?.height || !imageData?.data) {
    return false;
  }

  const faceRegion = getRegionColors(imageData, 0.24, 0.12, 0.76, 0.66);
  const upperRegion = getRegionColors(imageData, 0.18, 0.04, 0.82, 0.36);
  const lowerRegion = getRegionColors(imageData, 0.16, 0.60, 0.84, 0.98);
  const skinRatio = getPredicateRatio(faceRegion, isLikelySkinColor);
  const darkUpperRatio = getPredicateRatio(upperRegion, (color) => getLuma(color) < 96);
  const outfitRatio = getPredicateRatio(lowerRegion, (color) => (
    getSaturation(color) > 0.18
    && color.r > color.b * 1.12
    && color.r >= color.g * 0.86
  ));

  return skinRatio >= 0.16 && (darkUpperRatio >= 0.08 || outfitRatio >= 0.12);
}

export function generateCompanionPortraitSprite(imageData) {
  const colors = sampleCompanionPortraitColors(imageData);
  const sprite = createSprite(CUSTOM_SKIN_SPRITE_WIDTH, CUSTOM_SKIN_SPRITE_HEIGHT);
  const mask = new Uint8Array(sprite.width * sprite.height);
  const headX = colors.faceShape === "wide" ? 6 : 8;
  const headWidth = colors.faceShape === "wide" ? 14 : 10;
  const headY = colors.hairStyle === "bald" ? 6 : 5;

  paintSpriteRect(sprite, mask, 10, 18, 4, 4, colors.skinShadow);
  paintSpriteRect(sprite, mask, 6, 22, 14, 8, colors.shirt);

  if (colors.outfitStyle === "jacket") {
    paintSpriteRect(sprite, mask, 4, 22, 6, 8, colors.jacket);
    paintSpriteRect(sprite, mask, 16, 22, 4, 8, colors.jacket);
    paintSpriteRect(sprite, mask, 10, 22, 6, 8, colors.shirt);
    paintSpriteRect(sprite, mask, 8, 22, 2, 4, colors.jacketShadow);
    paintSpriteRect(sprite, mask, 16, 22, 2, 4, colors.jacketShadow);
  } else if (colors.outfitStyle === "collar") {
    paintSpriteRect(sprite, mask, 5, 22, 16, 8, colors.shirt);
    paintSpriteRect(sprite, mask, 8, 22, 4, 2, colors.shirtHighlight);
    paintSpriteRect(sprite, mask, 14, 22, 4, 2, colors.shirtHighlight);
  } else {
    paintSpriteRect(sprite, mask, 5, 24, 16, 6, colors.shirt);
    paintSpriteRect(sprite, mask, 6, 22, 14, 2, colors.shirtHighlight);
  }

  paintSpriteRect(sprite, mask, 3, 26, 4, 4, colors.skinShadow);
  paintSpriteRect(sprite, mask, 20, 26, 2, 4, colors.skinShadow);
  paintSpriteRect(sprite, mask, 8, 30, 4, 6, colors.trousers);
  paintSpriteRect(sprite, mask, 14, 30, 4, 6, colors.trousers);
  paintSpriteRect(sprite, mask, 6, 34, 6, 2, colors.shoe);
  paintSpriteRect(sprite, mask, 14, 34, 6, 2, colors.shoe);

  paintSpriteRect(sprite, mask, headX, headY, headWidth, 4, colors.skin);
  paintSpriteRect(sprite, mask, headX - 1, headY + 4, headWidth + 2, 8, colors.skin);
  paintSpriteRect(sprite, mask, headX, headY + 12, headWidth, 4, colors.skin);
  paintSpriteRect(sprite, mask, headX - 2, headY + 6, 2, 4, colors.skinShadow);
  paintSpriteRect(sprite, mask, headX + headWidth, headY + 6, 2, 4, colors.skinShadow);
  paintSpriteRect(sprite, mask, 12, headY + 8, 2, 4, colors.skinShadow);

  paintPortraitHair(sprite, mask, colors, headX, headY, headWidth);

  if (colors.hasGlasses) {
    paintSpriteRect(sprite, mask, headX + 1, headY + 7, 4, 2, OUTLINE);
    paintSpriteRect(sprite, mask, headX + headWidth - 5, headY + 7, 4, 2, OUTLINE);
    paintSpriteRect(sprite, mask, 12, headY + 8, 2, 1, OUTLINE);
    paintSpritePixel(sprite, mask, headX + 2, headY + 8, colors.skin);
    paintSpritePixel(sprite, mask, headX + headWidth - 4, headY + 8, colors.skin);
  } else {
    paintSpriteRect(sprite, mask, headX + 1, headY + 7, 4, 2, colors.brow);
    paintSpriteRect(sprite, mask, headX + headWidth - 5, headY + 7, 4, 2, colors.brow);
    paintSpritePixel(sprite, mask, headX + 2, headY + 8, OUTLINE);
    paintSpritePixel(sprite, mask, headX + headWidth - 3, headY + 8, OUTLINE);
  }

  if (colors.facialHairStyle === "beard") {
    paintSpriteRect(sprite, mask, headX + 2, headY + 10, headWidth - 4, 5, colors.facialHair);
    paintSpriteRect(sprite, mask, 10, headY + 10, 5, 2, colors.skin);
    paintSpriteRect(sprite, mask, 10, headY + 13, 5, 2, colors.facialHairShadow);
  } else if (colors.facialHairStyle === "moustache") {
    paintSpriteRect(sprite, mask, 9, headY + 11, 3, 2, colors.facialHair);
    paintSpriteRect(sprite, mask, 14, headY + 11, 3, 2, colors.facialHair);
    paintSpriteRect(sprite, mask, 11, headY + 14, 4, 2, colors.mouth);
  } else {
    paintSpriteRect(sprite, mask, 10, headY + 12, 6, 2, colors.mouth);
  }

  addOutline(sprite, mask);
  pixelateSprite(sprite, 2);

  return {
    sprite,
    subjectKind: "person",
    label: "Person",
    features: colors.features,
    generator: "local-companion-portrait",
    generatorVersion: COMPANION_PORTRAIT_GENERATOR_VERSION
  };
}

export function generateVbPortraitSprite(imageData) {
  const colors = sampleVbPortraitColors(imageData);
  const sprite = createSprite(CUSTOM_SKIN_SPRITE_WIDTH, CUSTOM_SKIN_SPRITE_HEIGHT);
  const mask = new Uint8Array(sprite.width * sprite.height);

  paintSpriteRect(sprite, mask, 10, 20, 5, 3, colors.skin);
  paintSpriteRect(sprite, mask, 6, 23, 13, 8, colors.shirt);
  paintSpriteRect(sprite, mask, 5, 25, 15, 6, colors.shirt);
  paintSpriteRect(sprite, mask, 4, 24, 3, 5, colors.shirtShadow);
  paintSpriteRect(sprite, mask, 3, 29, 3, 3, colors.skinShadow);
  paintSpriteRect(sprite, mask, 19, 24, 2, 5, colors.shirtShadow);
  paintSpriteRect(sprite, mask, 20, 29, 2, 3, colors.skinShadow);
  paintSpriteRect(sprite, mask, 8, 31, 4, 5, colors.trousers);
  paintSpriteRect(sprite, mask, 14, 31, 4, 5, colors.trousers);
  paintSpriteRect(sprite, mask, 7, 35, 5, 1, colors.shoe);
  paintSpriteRect(sprite, mask, 14, 35, 5, 1, colors.shoe);

  paintSpriteRect(sprite, mask, 7, 9, 12, 8, colors.skin);
  paintSpriteRect(sprite, mask, 6, 11, 14, 6, colors.skin);
  paintSpriteRect(sprite, mask, 8, 17, 10, 3, colors.skin);
  paintSpriteRect(sprite, mask, 5, 12, 2, 4, colors.skinShadow);
  paintSpriteRect(sprite, mask, 19, 12, 2, 4, colors.skinShadow);

  paintSpriteRect(sprite, mask, 8, 2, 8, 1, colors.hair);
  paintSpriteRect(sprite, mask, 7, 3, 10, 1, colors.hair);
  paintSpriteRect(sprite, mask, 6, 4, 12, 2, colors.hair);
  paintSpriteRect(sprite, mask, 5, 6, 14, 2, colors.hair);
  paintSpriteRect(sprite, mask, 5, 8, 15, 3, colors.hair);
  paintSpriteRect(sprite, mask, 5, 11, 2, 3, colors.hair);
  paintSpriteRect(sprite, mask, 18, 10, 2, 3, colors.hair);
  paintSpritePixel(sprite, mask, 7, 2, colors.hairHighlight);
  paintSpritePixel(sprite, mask, 10, 1, colors.hairHighlight);
  paintSpritePixel(sprite, mask, 14, 2, colors.hairHighlight);
  paintSpritePixel(sprite, mask, 17, 5, colors.hairHighlight);
  paintSpritePixel(sprite, mask, 6, 7, colors.hairHighlight);
  paintSpritePixel(sprite, mask, 11, 5, colors.hairHighlight);
  paintSpritePixel(sprite, mask, 15, 6, colors.hairHighlight);

  paintSpriteRect(sprite, mask, 8, 12, 3, 1, colors.hair);
  paintSpriteRect(sprite, mask, 14, 12, 3, 1, colors.hair);
  paintSpritePixel(sprite, mask, 9, 13, OUTLINE);
  paintSpritePixel(sprite, mask, 15, 13, OUTLINE);
  paintSpritePixel(sprite, mask, 12, 14, colors.skinShadow);
  paintSpritePixel(sprite, mask, 12, 15, colors.skinShadow);
  paintSpriteRect(sprite, mask, 8, 16, 4, 1, colors.moustache);
  paintSpriteRect(sprite, mask, 13, 16, 4, 1, colors.moustache);
  paintSpritePixel(sprite, mask, 11, 17, colors.moustache);
  paintSpritePixel(sprite, mask, 14, 17, colors.moustache);
  paintSpritePixel(sprite, mask, 12, 18, colors.goatee);
  paintSpritePixel(sprite, mask, 13, 18, colors.goatee);

  paintSpritePixel(sprite, mask, 8, 23, colors.lanyard);
  paintSpritePixel(sprite, mask, 9, 24, colors.lanyard);
  paintSpritePixel(sprite, mask, 10, 25, colors.lanyard);
  paintSpritePixel(sprite, mask, 10, 26, colors.lanyard);
  paintSpritePixel(sprite, mask, 11, 27, colors.lanyard);
  paintSpritePixel(sprite, mask, 11, 28, colors.lanyard);
  paintSpritePixel(sprite, mask, 17, 23, colors.lanyard);
  paintSpritePixel(sprite, mask, 16, 24, colors.lanyard);
  paintSpritePixel(sprite, mask, 15, 25, colors.lanyard);
  paintSpritePixel(sprite, mask, 15, 26, colors.lanyard);
  paintSpritePixel(sprite, mask, 14, 27, colors.lanyard);
  paintSpritePixel(sprite, mask, 14, 28, colors.lanyard);

  addOutline(sprite, mask);

  return {
    sprite,
    subjectKind: "person",
    label: "Codey",
    features: ["curly-hair", "moustache", "lanyard"],
    generator: "local-vb-portrait",
    generatorVersion: VB_PORTRAIT_GENERATOR_VERSION
  };
}

export function generateCompanionAnimalSprite(imageData) {
  const foregroundMask = extractForegroundMask(imageData);
  const component = findPrimaryComponent(foregroundMask);
  const colors = sampleCompanionAnimalColors(imageData, component);
  const sprite = createSprite(CUSTOM_SKIN_SPRITE_WIDTH, CUSTOM_SKIN_SPRITE_HEIGHT);
  const mask = new Uint8Array(sprite.width * sprite.height);

  paintSpriteRect(sprite, mask, 8, 15, 9, 3, colors.fur);
  paintSpriteRect(sprite, mask, 7, 18, 11, 11, colors.fur);
  paintSpriteRect(sprite, mask, 6, 21, 3, 7, colors.furShadow);
  paintSpriteRect(sprite, mask, 17, 21, 2, 7, colors.furShadow);
  paintSpriteRect(sprite, mask, 8, 28, 4, 6, colors.furShadow);
  paintSpriteRect(sprite, mask, 14, 28, 4, 6, colors.furShadow);
  paintSpriteRect(sprite, mask, 7, 34, 5, 2, colors.paw);
  paintSpriteRect(sprite, mask, 14, 34, 5, 2, colors.paw);
  paintSpritePixel(sprite, mask, 19, 22, colors.tail);
  paintSpritePixel(sprite, mask, 20, 21, colors.tail);
  paintSpritePixel(sprite, mask, 21, 20, colors.tail);

  paintSpriteRect(sprite, mask, 7, 7, 12, 9, colors.fur);
  paintSpriteRect(sprite, mask, 6, 10, 14, 5, colors.fur);
  paintSpriteRect(sprite, mask, 5, 5, 4, 6, colors.ear);
  paintSpriteRect(sprite, mask, 16, 5, 4, 6, colors.ear);
  paintSpritePixel(sprite, mask, 6, 4, colors.ear);
  paintSpritePixel(sprite, mask, 18, 4, colors.ear);
  paintSpriteRect(sprite, mask, 10, 13, 6, 4, colors.muzzle);
  paintSpritePixel(sprite, mask, 9, 11, OUTLINE);
  paintSpritePixel(sprite, mask, 16, 11, OUTLINE);
  paintSpriteRect(sprite, mask, 12, 14, 2, 1, colors.nose);
  paintSpritePixel(sprite, mask, 12, 15, colors.nose);
  paintSpritePixel(sprite, mask, 14, 15, colors.nose);
  paintSpritePixel(sprite, mask, 11, 8, colors.marking);
  paintSpritePixel(sprite, mask, 15, 8, colors.marking);
  paintSpriteRect(sprite, mask, 11, 19, 4, 1, colors.accent);

  addOutline(sprite, mask);
  pixelateSprite(sprite, 2);

  return {
    sprite,
    subjectKind: "animal",
    label: "Pet",
    features: colors.features,
    generator: "local-companion-animal",
    generatorVersion: COMPANION_ANIMAL_GENERATOR_VERSION
  };
}

export function normalizeGeminiSpritePlan(plan) {
  if (!plan || typeof plan !== "object") {
    throw new Error("AI returned an empty sprite plan.");
  }

  if (
    !plan.canvas
    || plan.canvas.width !== GEMINI_SPRITE_WIDTH
    || plan.canvas.height !== GEMINI_SPRITE_HEIGHT
  ) {
    throw new Error("AI sprite plan must use a 15x15 canvas.");
  }

  const subjectKind = ["person", "animal", "object"].includes(plan.subjectKind)
    ? plan.subjectKind
    : "object";
  const palette = normalizeGeminiPalette(plan.palette);
  const pixels = normalizeGeminiPixels(plan.pixels, palette, GEMINI_SPRITE_WIDTH, GEMINI_SPRITE_HEIGHT);

  if (!pixels.length) {
    throw new Error("AI sprite plan did not include visible pixels.");
  }

  return {
    subjectKind,
    label: normalizeGeminiLabel(plan.label, subjectKind),
    canvas: {
      width: GEMINI_SPRITE_WIDTH,
      height: GEMINI_SPRITE_HEIGHT
    },
    palette,
    pixels,
    features: normalizeGeminiFeatures(plan.features)
  };
}

export function renderGeminiSpritePlan(plan) {
  const normalized = normalizeGeminiSpritePlan(plan);
  const sprite = createSprite(normalized.canvas.width, normalized.canvas.height);
  const mask = new Uint8Array(sprite.width * sprite.height);

  for (const block of normalized.pixels) {
    const color = hexToColor(block.color);
    for (let y = block.y; y < block.y + block.h; y += 1) {
      for (let x = block.x; x < block.x + block.w; x += 1) {
        mask[y * sprite.width + x] = 1;
        setSpritePixel(sprite, x, y, color);
      }
    }
  }

  addOutline(sprite, mask);

  return sprite;
}

export function generateSpriteFromGeminiPlan(plan) {
  const normalized = normalizeGeminiSpritePlan(plan);
  const sprite = renderGeminiSpritePlan(normalized);

  return {
    sprite,
    subjectKind: normalized.subjectKind,
    label: normalized.label,
    features: normalized.features,
    generator: "gemini-sprite-plan",
    generatorVersion: GEMINI_SKIN_GENERATOR_VERSION
  };
}

function normalizeGeminiPalette(palette) {
  const normalized = {};

  if (!palette || typeof palette !== "object" || Array.isArray(palette)) {
    return normalized;
  }

  for (const [rawName, rawColor] of Object.entries(palette).slice(0, 8)) {
    const name = String(rawName).replace(/[^a-z0-9_-]/gi, "").slice(0, 24);
    const color = normalizeHexColor(rawColor);
    if (name && color) {
      normalized[name] = color;
    }
  }

  return normalized;
}

function normalizeGeminiPixels(pixels, palette, canvasWidth, canvasHeight) {
  if (!Array.isArray(pixels)) {
    throw new Error("AI sprite plan pixels must be an array.");
  }

  const normalized = [];

  for (const rawBlock of pixels) {
    if (!rawBlock || typeof rawBlock !== "object") {
      continue;
    }

    const color = resolveGeminiColor(rawBlock.color, palette);
    if (!color) {
      throw new Error("AI sprite plan contains an invalid color.");
    }

    const x = Math.floor(Number(rawBlock.x));
    const y = Math.floor(Number(rawBlock.y));
    const w = Math.floor(Number(rawBlock.w));
    const h = Math.floor(Number(rawBlock.h));

    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
      continue;
    }

    const clampedX = Math.max(0, Math.min(canvasWidth - 1, x));
    const clampedY = Math.max(0, Math.min(canvasHeight - 1, y));
    const clampedRight = Math.max(clampedX + 1, Math.min(canvasWidth, x + w));
    const clampedBottom = Math.max(clampedY + 1, Math.min(canvasHeight, y + h));

    normalized.push({
      x: clampedX,
      y: clampedY,
      w: clampedRight - clampedX,
      h: clampedBottom - clampedY,
      color
    });

    if (normalized.length >= GEMINI_SPRITE_PLAN_MAX_BLOCKS) {
      break;
    }
  }

  return normalized;
}

function resolveGeminiColor(value, palette) {
  if (typeof value !== "string") {
    return "";
  }

  return normalizeHexColor(value) || palette[value] || "";
}

function normalizeHexColor(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  const shortMatch = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (shortMatch) {
    return `#${shortMatch[1].split("").map((char) => char + char).join("").toLowerCase()}`;
  }

  const fullMatch = /^#([0-9a-f]{6})$/i.exec(trimmed);
  return fullMatch ? `#${fullMatch[1].toLowerCase()}` : "";
}

function hexToColor(hex) {
  const normalized = normalizeHexColor(hex) || "#2563eb";
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
    a: 255
  };
}

function normalizeGeminiLabel(value, subjectKind) {
  if (typeof value === "string") {
    const label = value.replace(/\s+/g, " ").trim().slice(0, 24);
    if (label) {
      return label;
    }
  }

  return {
    person: "Person",
    animal: "Animal",
    object: "Object"
  }[subjectKind] || "Custom";
}

function normalizeGeminiFeatures(features) {
  if (!Array.isArray(features)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];

  for (const feature of features) {
    if (typeof feature !== "string") {
      continue;
    }

    const value = feature.replace(/[^a-z0-9_-]/gi, "").toLowerCase().slice(0, 24);
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    normalized.push(value);

    if (normalized.length >= 12) {
      break;
    }
  }

  return normalized;
}

function refineSubjectShape(sprite, mask, colors, subjectKind) {
  if (subjectKind === "person") {
    addPersonFeatures(sprite, mask, colors);
  } else if (subjectKind === "animal") {
    addAnimalFeatures(sprite, mask, colors);
  } else {
    addObjectFeatures(sprite, mask, colors);
  }
}

function addPersonFeatures(sprite, mask, colors) {
  const bounds = getMaskBounds({ width: sprite.width, height: sprite.height, data: mask });
  const centerX = Math.round(bounds.x + bounds.width / 2);
  const eyeY = Math.max(2, bounds.y + Math.round(bounds.height * 0.22));
  const hairY = bounds.y;

  paintMaskPixel(sprite, mask, centerX - 3, hairY, colors.hairColor);
  paintMaskPixel(sprite, mask, centerX - 2, hairY, colors.hairColor);
  paintMaskPixel(sprite, mask, centerX - 1, hairY, colors.hairColor);
  paintMaskPixel(sprite, mask, centerX, hairY, colors.hairColor);
  paintMaskPixel(sprite, mask, centerX - 3, eyeY, OUTLINE);
  paintMaskPixel(sprite, mask, centerX + 2, eyeY, OUTLINE);
  paintMaskPixel(sprite, mask, centerX - 1, eyeY + 2, colors.faceColor);
  paintMaskPixel(sprite, mask, centerX, eyeY + 2, colors.faceColor);
}

function addAnimalFeatures(sprite, mask, colors) {
  const bounds = getMaskBounds({ width: sprite.width, height: sprite.height, data: mask });
  const leftEarX = bounds.x + Math.max(1, Math.floor(bounds.width * 0.2));
  const rightEarX = bounds.x + Math.min(bounds.width - 2, Math.floor(bounds.width * 0.78));
  const earY = Math.max(0, bounds.y - 2);
  const eyeY = bounds.y + Math.max(3, Math.floor(bounds.height * 0.28));

  paintMaskPixel(sprite, mask, leftEarX, earY, colors.dominantColor);
  paintMaskPixel(sprite, mask, rightEarX, earY, colors.dominantColor);
  paintMaskPixel(sprite, mask, leftEarX + 1, earY + 1, colors.dominantColor);
  paintMaskPixel(sprite, mask, rightEarX - 1, earY + 1, colors.dominantColor);
  paintMaskPixel(sprite, mask, bounds.x + Math.floor(bounds.width * 0.34), eyeY, OUTLINE);
  paintMaskPixel(sprite, mask, bounds.x + Math.floor(bounds.width * 0.66), eyeY, OUTLINE);
  paintMaskPixel(sprite, mask, bounds.x + Math.floor(bounds.width * 0.5), eyeY + 2, colors.accentColor);
}

function addObjectFeatures(sprite, mask, colors) {
  const bounds = getMaskBounds({ width: sprite.width, height: sprite.height, data: mask });
  const accentY = bounds.y + Math.floor(bounds.height * 0.54);

  for (let x = bounds.x + 2; x < bounds.x + bounds.width - 2; x += 1) {
    if (mask[accentY * sprite.width + x]) {
      setSpritePixel(sprite, x, accentY, colors.accentColor);
    }
  }
}

function paintPortraitHair(sprite, mask, colors, headX, headY, headWidth) {
  if (colors.hairStyle === "bald") {
    paintSpriteRect(sprite, mask, headX - 1, headY + 3, 2, 4, colors.hair);
    paintSpriteRect(sprite, mask, headX + headWidth - 1, headY + 3, 2, 4, colors.hair);
    return;
  }

  if (colors.hairStyle === "receding") {
    paintSpriteRect(sprite, mask, headX, headY - 2, 4, 2, colors.hair);
    paintSpriteRect(sprite, mask, headX + headWidth - 4, headY - 2, 4, 2, colors.hair);
    paintSpriteRect(sprite, mask, headX - 1, headY, 3, 6, colors.hair);
    paintSpriteRect(sprite, mask, headX + headWidth - 2, headY, 3, 6, colors.hair);
    return;
  }

  paintSpriteRect(sprite, mask, headX, headY - 4, headWidth, 2, colors.hair);
  paintSpriteRect(sprite, mask, headX - 1, headY - 2, headWidth + 2, 4, colors.hair);

  if (colors.hairStyle === "long") {
    paintSpriteRect(sprite, mask, headX - 2, headY + 2, 4, 10, colors.hair);
    paintSpriteRect(sprite, mask, headX + headWidth - 2, headY + 2, 4, 10, colors.hair);
    paintSpriteRect(sprite, mask, headX + 2, headY - 5, headWidth - 4, 2, colors.hairHighlight);
  } else if (colors.hairStyle === "short") {
    paintSpriteRect(sprite, mask, headX - 1, headY + 2, 3, 4, colors.hair);
    paintSpriteRect(sprite, mask, headX + headWidth - 2, headY + 2, 3, 4, colors.hair);
    paintSpriteRect(sprite, mask, headX + 2, headY - 3, 4, 2, colors.hairHighlight);
  } else {
    paintSpriteRect(sprite, mask, headX - 2, headY + 1, 4, 6, colors.hair);
    paintSpriteRect(sprite, mask, headX + headWidth - 2, headY + 1, 4, 6, colors.hair);
    paintSpriteRect(sprite, mask, headX + 2, headY - 4, headWidth - 3, 2, colors.hairHighlight);
  }
}

function addFeetIfNeeded(sprite, mask, colors, subjectKind) {
  const bounds = getMaskBounds({ width: sprite.width, height: sprite.height, data: mask });
  const footColor = subjectKind === "person" ? colors.lowerColor : darkenColor(colors.dominantColor, 34);
  const y = Math.min(sprite.height - 2, bounds.y + bounds.height);
  const leftX = Math.max(1, bounds.x + Math.floor(bounds.width * 0.25));
  const rightX = Math.min(sprite.width - 3, bounds.x + Math.floor(bounds.width * 0.65));

  paintMaskPixel(sprite, mask, leftX, y, footColor);
  paintMaskPixel(sprite, mask, leftX + 1, y, footColor);
  paintMaskPixel(sprite, mask, rightX, y, footColor);
  paintMaskPixel(sprite, mask, rightX + 1, y, footColor);
}

function paintSpriteRect(sprite, mask, x, y, width, height, color) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      paintSpritePixel(sprite, mask, xx, yy, color);
    }
  }
}

function paintSpritePixel(sprite, mask, x, y, color) {
  if (x < 0 || y < 0 || x >= sprite.width || y >= sprite.height) {
    return;
  }

  mask[y * sprite.width + x] = 1;
  setSpritePixel(sprite, x, y, color);
}

function addOutline(sprite, mask) {
  const outlineMask = new Uint8Array(mask.length);

  for (let y = 0; y < sprite.height; y += 1) {
    for (let x = 0; x < sprite.width; x += 1) {
      const index = y * sprite.width + x;
      if (mask[index]) {
        continue;
      }

      for (const neighbor of getNeighbors(x, y, sprite.width, sprite.height)) {
        if (mask[neighbor]) {
          outlineMask[index] = 1;
          break;
        }
      }
    }
  }

  for (let index = 0; index < outlineMask.length; index += 1) {
    if (!outlineMask[index]) {
      continue;
    }

    const x = index % sprite.width;
    const y = Math.floor(index / sprite.width);
    setSpritePixel(sprite, x, y, OUTLINE);
  }
}

function pixelateSprite(sprite, blockSize) {
  const source = new Uint8ClampedArray(sprite.data);

  for (let y = 0; y < sprite.height; y += blockSize) {
    for (let x = 0; x < sprite.width; x += blockSize) {
      const color = getDominantBlockColor(source, sprite.width, sprite.height, x, y, blockSize);

      for (let yy = y; yy < Math.min(sprite.height, y + blockSize); yy += 1) {
        for (let xx = x; xx < Math.min(sprite.width, x + blockSize); xx += 1) {
          setSpritePixel(sprite, xx, yy, color);
        }
      }
    }
  }
}

function getDominantBlockColor(data, width, height, x0, y0, blockSize) {
  const buckets = new Map();
  let bestKey = "0,0,0,0";
  let bestScore = -1;

  for (let y = y0; y < Math.min(height, y0 + blockSize); y += 1) {
    for (let x = x0; x < Math.min(width, x0 + blockSize); x += 1) {
      const index = (y * width + x) * 4;
      const alpha = data[index + 3];
      const key = alpha > 0
        ? `${data[index]},${data[index + 1]},${data[index + 2]},255`
        : "0,0,0,0";
      const score = (buckets.get(key) || 0) + (
        key === "0,0,0,0" ? 0.2 : key === "17,24,39,255" ? 2.2 : 1
      );
      buckets.set(key, score);

      if (score > bestScore) {
        bestKey = key;
        bestScore = score;
      }
    }
  }

  const [r, g, b, a] = bestKey.split(",").map(Number);
  return { r, g, b, a };
}

function getTargetBounds(sourceBounds, subjectKind) {
  const maxWidth = subjectKind === "animal" ? 22 : 18;
  const maxHeight = subjectKind === "animal" ? 26 : 32;
  const scale = Math.min(maxWidth / Math.max(1, sourceBounds.width), maxHeight / Math.max(1, sourceBounds.height));
  const width = Math.max(5, Math.min(CUSTOM_SKIN_SPRITE_WIDTH - 2, Math.round(sourceBounds.width * scale)));
  const height = Math.max(8, Math.min(CUSTOM_SKIN_SPRITE_HEIGHT - 3, Math.round(sourceBounds.height * scale)));

  return {
    x: Math.round((CUSTOM_SKIN_SPRITE_WIDTH - width) / 2),
    y: Math.max(0, CUSTOM_SKIN_SPRITE_HEIGHT - height - 3),
    width,
    height
  };
}

function getOccupancy(mask, x0, y0, x1, y1) {
  let total = 0;
  let filled = 0;

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) {
        continue;
      }

      total += 1;
      filled += mask.data[y * mask.width + x] ? 1 : 0;
    }
  }

  return total ? filled / total : 0;
}

function quantizedAverage(imageData, mask, x0, y0, x1, y1, fallback) {
  const colors = [];

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (x < 0 || y < 0 || x >= mask.width || y >= mask.height || !mask.data[y * mask.width + x]) {
        continue;
      }

      colors.push(getPixel(imageData, x, y));
    }
  }

  return quantizeColorObject(colors.length ? averageColor(colors) : fallback);
}

function paintMaskPixel(sprite, mask, x, y, color) {
  if (x < 0 || y < 0 || x >= sprite.width || y >= sprite.height) {
    return;
  }

  mask[y * sprite.width + x] = 1;
  setSpritePixel(sprite, x, y, color);
}

function createSprite(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    setRawPixel(data, pixel, TRANSPARENT);
  }

  return { width, height, data };
}

function setSpritePixel(sprite, x, y, color) {
  setRawPixel(sprite.data, y * sprite.width + x, color);
}

function setRawPixel(data, pixel, color) {
  const index = pixel * 4;
  data[index] = Math.round(color.r);
  data[index + 1] = Math.round(color.g);
  data[index + 2] = Math.round(color.b);
  data[index + 3] = color.a ?? 255;
}

function getBorderSamples(imageData) {
  const samples = [];
  const { width, height } = imageData;

  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 16))) {
    samples.push(getPixel(imageData, x, 0), getPixel(imageData, x, height - 1));
  }

  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 16))) {
    samples.push(getPixel(imageData, 0, y), getPixel(imageData, width - 1, y));
  }

  return samples;
}

function getAverageBorderDistance(samples) {
  if (samples.length < 2) {
    return 0;
  }

  const average = averageColor(samples);
  return samples.reduce((sum, color) => sum + getColorDistance(color, average), 0) / samples.length;
}

function getMinimumColorDistance(color, samples) {
  return samples.reduce((minimum, sample) => Math.min(minimum, getColorDistance(color, sample)), Number.POSITIVE_INFINITY);
}

function getNeighbors(x, y, width, height) {
  const neighbors = [];
  if (x > 0) neighbors.push(y * width + x - 1);
  if (x < width - 1) neighbors.push(y * width + x + 1);
  if (y > 0) neighbors.push((y - 1) * width + x);
  if (y < height - 1) neighbors.push((y + 1) * width + x);
  return neighbors;
}

function forEachMaskPixel(mask, callback) {
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.data[y * mask.width + x]) {
        callback(x, y);
      }
    }
  }
}

function getMaskBounds(mask) {
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;

  forEachMaskPixel(mask, (x, y) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    count += 1;
  });

  if (count === 0) {
    return { x: 0, y: 0, width: mask.width, height: mask.height, count: 0 };
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    count
  };
}

function getMaskRowSpanRatio(mask, bounds, normalizedY) {
  const y = Math.max(0, Math.min(mask.height - 1, bounds.y + Math.round(bounds.height * normalizedY)));
  let minX = mask.width;
  let maxX = -1;

  for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
    if (mask.data[y * mask.width + x]) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  }

  return maxX >= minX ? (maxX - minX + 1) / Math.max(1, bounds.width) : 0;
}

function getPixel(imageData, x, y) {
  const index = (y * imageData.width + x) * 4;
  return {
    r: imageData.data[index],
    g: imageData.data[index + 1],
    b: imageData.data[index + 2],
    a: imageData.data[index + 3] ?? 255
  };
}

function getRegionColors(imageData, x0Ratio, y0Ratio, x1Ratio, y1Ratio) {
  const colors = [];
  const x0 = Math.max(0, Math.floor(imageData.width * x0Ratio));
  const y0 = Math.max(0, Math.floor(imageData.height * y0Ratio));
  const x1 = Math.min(imageData.width, Math.ceil(imageData.width * x1Ratio));
  const y1 = Math.min(imageData.height, Math.ceil(imageData.height * y1Ratio));

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      colors.push(getPixel(imageData, x, y));
    }
  }

  return colors;
}

function getPredicateRatio(colors, predicate) {
  return colors.length
    ? colors.filter(predicate).length / colors.length
    : 0;
}

function sampleVbPortraitColors(imageData) {
  const faceRegion = getRegionColors(imageData, 0.28, 0.18, 0.72, 0.62);
  const hairRegion = getRegionColors(imageData, 0.22, 0.05, 0.80, 0.36);
  const lowerRegion = getRegionColors(imageData, 0.10, 0.60, 0.90, 0.98);
  const skinColors = faceRegion.filter(isLikelySkinColor);
  const hairColors = hairRegion.filter((color) => getLuma(color) < 116);
  const shirtColors = lowerRegion.filter((color) => (
    getSaturation(color) > 0.18
    && color.r > color.b * 1.18
    && color.r >= color.g * 0.82
    && !isLikelySkinColor(color)
  ));
  const lanyardColors = lowerRegion.filter((color) => (
    color.g > color.r * 1.05
    && color.b > color.r * 1.08
    && getSaturation(color) > 0.12
  ));

  const skin = quantizeColorObject(skinColors.length ? averageColor(skinColors) : { r: 212, g: 150, b: 100 });
  const sampledHair = darkenColor(quantizeColorObject(hairColors.length ? dominantColorFrom(hairColors) : { r: 42, g: 32, b: 26 }), 8);
  const hair = getLuma(sampledHair) < 40
    ? { r: 42, g: 32, b: 26, a: 255 }
    : sampledHair;
  const shirt = quantizeColorObject(shirtColors.length ? dominantColorFrom(shirtColors) : { r: 184, g: 96, b: 52 });
  const lanyard = quantizeColorObject(lanyardColors.length ? averageColor(lanyardColors) : { r: 100, g: 210, b: 230 });
  const moustache = getLuma(hair) < 48
    ? { r: 74, g: 46, b: 32, a: 255 }
    : darkenColor(hair, 18);

  return {
    skin,
    skinShadow: darkenColor(skin, 34),
    hair,
    hairHighlight: lightenColor(hair, 48),
    moustache,
    goatee: darkenColor(moustache, 18),
    shirt,
    shirtShadow: darkenColor(shirt, 30),
    lanyard,
    trousers: { r: 50, g: 50, b: 58, a: 255 },
    shoe: OUTLINE
  };
}

function sampleCompanionPortraitColors(imageData) {
  const faceRegion = getRegionColors(imageData, 0.26, 0.14, 0.74, 0.62);
  const topRegion = getRegionColors(imageData, 0.20, 0.02, 0.82, 0.34);
  const upperHairRegion = getRegionColors(imageData, 0.24, 0.02, 0.76, 0.22);
  const sideHairRegion = [
    ...getRegionColors(imageData, 0.16, 0.14, 0.30, 0.52),
    ...getRegionColors(imageData, 0.70, 0.14, 0.84, 0.52)
  ];
  const browRegion = getRegionColors(imageData, 0.26, 0.28, 0.74, 0.44);
  const eyeRegion = getRegionColors(imageData, 0.26, 0.30, 0.74, 0.46);
  const lowerFaceRegion = getRegionColors(imageData, 0.30, 0.42, 0.70, 0.64);
  const chinRegion = getRegionColors(imageData, 0.32, 0.50, 0.68, 0.68);
  const clothingRegion = getRegionColors(imageData, 0.08, 0.58, 0.92, 0.98);
  const centerClothingRegion = getRegionColors(imageData, 0.34, 0.62, 0.66, 0.98);
  const sideClothingRegion = [
    ...getRegionColors(imageData, 0.08, 0.62, 0.30, 0.98),
    ...getRegionColors(imageData, 0.70, 0.62, 0.92, 0.98)
  ];
  const skinColors = faceRegion.filter(isLikelySkinColor);
  const skin = quantizeColorObject(skinColors.length ? averageColor(skinColors) : { r: 212, g: 150, b: 100 });
  const hairPredicate = (color) => (
    !isLikelySkinColor(color)
    && getLuma(color) < Math.min(150, getLuma(skin) + 22)
    && getColorDistance(color, skin) > 26
  );
  const nonSkinTop = topRegion.filter(hairPredicate);
  const upperHair = upperHairRegion.filter(hairPredicate);
  const sideHair = sideHairRegion.filter(hairPredicate);
  const browColors = browRegion.filter((color) => hairPredicate(color) && getLuma(color) < 126);
  const darkEyeColors = eyeRegion.filter((color) => (
    !isLikelySkinColor(color)
    && getLuma(color) < 78
    && getColorDistance(color, skin) > 34
  ));
  const clothingColors = clothingRegion.filter((color) => (
    !isLikelySkinColor(color)
    && (getSaturation(color) > 0.10 || getLuma(color) < 130)
  ));
  const centerClothingColors = centerClothingRegion.filter((color) => (
    !isLikelySkinColor(color)
    && (getSaturation(color) > 0.08 || getLuma(color) < 220)
  ));
  const sideClothingColors = sideClothingRegion.filter((color) => (
    !isLikelySkinColor(color)
    && (getSaturation(color) > 0.08 || getLuma(color) < 220)
  ));
  const facialHairColors = lowerFaceRegion.filter((color) => (
    !isLikelySkinColor(color)
    && getColorDistance(color, skin) > 28
    && getLuma(color) < getLuma(skin) - 16
  ));
  const beardColors = chinRegion.filter((color) => (
    !isLikelySkinColor(color)
    && getColorDistance(color, skin) > 28
    && getLuma(color) < getLuma(skin) - 12
  ));
  const sampledHair = quantizeColorObject(nonSkinTop.length
    ? dominantColorFrom(nonSkinTop)
    : dominantColorFrom(browColors, darkenColor(skin, 86)));
  const hair = getLuma(sampledHair) < 32
    ? { r: 42, g: 32, b: 26, a: 255 }
    : sampledHair;
  const hairCoverage = nonSkinTop.length / Math.max(1, topRegion.length);
  const upperHairCoverage = upperHair.length / Math.max(1, upperHairRegion.length);
  const sideHairCoverage = sideHair.length / Math.max(1, sideHairRegion.length);
  const facialHairRatio = facialHairColors.length / Math.max(1, lowerFaceRegion.length);
  const beardRatio = beardColors.length / Math.max(1, chinRegion.length);
  const darkEyeRatio = darkEyeColors.length / Math.max(1, eyeRegion.length);
  const shirt = quantizeColorObject(centerClothingColors.length
    ? dominantColorFrom(centerClothingColors)
    : clothingColors.length ? dominantColorFrom(clothingColors)
    : { r: 37, g: 99, b: 235 });
  const jacket = quantizeColorObject(sideClothingColors.length
    ? dominantColorFrom(sideClothingColors)
    : darkenColor(shirt, 28));
  const hasJacket = sideClothingColors.length > 8
    && getColorDistance(jacket, shirt) > 48
    && getLuma(jacket) < getLuma(shirt) + 24;
  const hairStyle = getPortraitHairStyle(hairCoverage, upperHairCoverage, sideHairCoverage);
  const facialHairStyle = beardRatio > 0.10
    ? "beard"
    : facialHairRatio > 0.045 ? "moustache" : "none";
  const faceShape = getPredicateRatio(faceRegion, isLikelySkinColor) > 0.48 ? "wide" : "narrow";
  const outfitStyle = hasJacket
    ? "jacket"
    : getSaturation(shirt) < 0.12 || getLuma(shirt) > 160 ? "collar" : "shirt";
  const features = [hairStyle === "bald" ? "bald" : `${hairStyle}-hair`, outfitStyle];

  if (facialHairStyle !== "none") {
    features.push(facialHairStyle);
  }

  if (darkEyeRatio > 0.055) {
    features.push("glasses");
  }

  return {
    skin,
    skinShadow: darkenColor(skin, 32),
    hair,
    hairHighlight: lightenColor(hair, 42),
    brow: browColors.length ? quantizeColorObject(dominantColorFrom(browColors)) : darkenColor(hair, 8),
    mouth: darkenColor(skin, 58),
    facialHair: quantizeColorObject(facialHairColors.length ? dominantColorFrom(facialHairColors) : darkenColor(hair, 12)),
    facialHairShadow: darkenColor(hair, 24),
    shirt,
    shirtHighlight: lightenColor(shirt, 34),
    shirtShadow: darkenColor(shirt, 34),
    jacket,
    jacketShadow: darkenColor(jacket, 28),
    trousers: getLuma(shirt) < 80 ? { r: 68, g: 76, b: 92, a: 255 } : { r: 50, g: 50, b: 58, a: 255 },
    shoe: OUTLINE,
    hairCoverage,
    hairStyle,
    faceShape,
    facialHairStyle,
    outfitStyle,
    hasGlasses: darkEyeRatio > 0.055,
    features
  };
}

function getPortraitHairStyle(hairCoverage, upperHairCoverage, sideHairCoverage) {
  if (upperHairCoverage < 0.045 && sideHairCoverage < 0.10) {
    return "bald";
  }

  if (upperHairCoverage < 0.14 && sideHairCoverage >= 0.08) {
    return "receding";
  }

  if (sideHairCoverage > 0.30) {
    return "long";
  }

  return hairCoverage > 0.30 ? "full" : "short";
}

function sampleCompanionAnimalColors(imageData, mask) {
  const colors = sampleRegionColors(imageData, mask);
  const furColors = colors.colors.filter((color) => !isGreenScreenLike(color) && getLuma(color) > 26);
  const fur = quantizeColorObject(furColors.length ? dominantColorFrom(furColors) : colors.dominantColor);
  const darkFurCandidates = furColors.filter((color) => getLuma(color) < getLuma(fur) - 18);
  const accentCandidates = furColors.filter((color) => (
    getColorDistance(color, fur) > 44
    && getSaturation(color) > 0.12
  ));
  const marking = quantizeColorObject(accentCandidates.length ? dominantColorFrom(accentCandidates) : lightenColor(fur, 28));

  return {
    fur,
    furShadow: darkenColor(fur, 38),
    ear: darkenColor(fur, 24),
    paw: darkenColor(fur, 50),
    muzzle: lightenColor(fur, 48),
    nose: OUTLINE,
    tail: darkenColor(fur, 18),
    marking,
    accent: darkFurCandidates.length ? quantizeColorObject(dominantColorFrom(darkFurCandidates)) : darkenColor(fur, 52),
    features: ["ears", "snout", "tail", "paws"]
  };
}

function createBlankImageData(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    setRawPixel(data, pixel, { r: 255, g: 255, b: 255, a: 255 });
  }

  return { width, height, data };
}

function dominantColorFrom(colors, fallback = { r: 37, g: 99, b: 235 }) {
  if (!colors.length) {
    return fallback;
  }

  const buckets = new Map();

  for (const color of colors) {
    const quantized = quantizeColorObject(color);
    const key = `${quantized.r},${quantized.g},${quantized.b}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  let bestKey = "";
  let bestCount = -1;

  for (const [key, count] of buckets) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }

  const [r, g, b] = bestKey.split(",").map(Number);
  return { r, g, b };
}

function averageColor(colors) {
  if (!colors.length) {
    return { r: 37, g: 99, b: 235 };
  }

  const sum = colors.reduce((accumulator, color) => ({
    r: accumulator.r + color.r,
    g: accumulator.g + color.g,
    b: accumulator.b + color.b
  }), { r: 0, g: 0, b: 0 });

  return {
    r: sum.r / colors.length,
    g: sum.g / colors.length,
    b: sum.b / colors.length
  };
}

function quantizeColorObject(color) {
  return {
    r: quantizeChannel(color.r),
    g: quantizeChannel(color.g),
    b: quantizeChannel(color.b),
    a: color.a ?? 255
  };
}

function quantizeChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value / 42) * 42));
}

function getAccentColor(colors, dominantColor) {
  const saturated = colors
    .filter((color) => getSaturation(color) > 0.22)
    .sort((a, b) => getColorDistance(b, dominantColor) - getColorDistance(a, dominantColor));

  return saturated[0] || lightenColor(dominantColor, 42);
}

function isLikelySkinColor({ r, g, b }) {
  return r > 82
    && g > 42
    && b > 24
    && r > b * 1.18
    && r >= g * 0.88
    && Math.max(r, g, b) - Math.min(r, g, b) > 22;
}

function isGreenScreenLike({ r, g, b }) {
  return g > r * 1.18
    && g > b * 1.12
    && getSaturation({ r, g, b }) > 0.24;
}

function getLuma({ r, g, b }) {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function getSaturation({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function getColorDistance(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

function lightenColor(color, amount) {
  return {
    r: Math.min(255, color.r + amount),
    g: Math.min(255, color.g + amount),
    b: Math.min(255, color.b + amount)
  };
}

function darkenColor(color, amount) {
  return {
    r: Math.max(0, color.r - amount),
    g: Math.max(0, color.g - amount),
    b: Math.max(0, color.b - amount)
  };
}
