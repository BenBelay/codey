import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyForegroundShape,
  canCreateCompanionPortraitSprite,
  canCreateVbPortraitSprite,
  extractForegroundMask,
  findPrimaryComponent,
  generateCompanionAnimalSprite,
  generateCompanionPortraitSprite,
  generateSpriteFromGeminiPlan,
  generateShapeAwarePixelSprite,
  generateVbPortraitSprite,
  normalizeGeminiSpritePlan,
  renderGeminiSpritePlan,
  renderShapeAwarePixelSprite,
  sampleRegionColors
} from "../src/shared/customSkinGenerator.js";

test("extractForegroundMask keeps central foreground and rejects border background", () => {
  const imageData = createImageData(8, 8, { r: 255, g: 255, b: 255, a: 255 });
  fillRect(imageData, 3, 2, 2, 4, { r: 220, g: 40, b: 40, a: 255 });

  const mask = extractForegroundMask(imageData);

  assert.equal(mask.data[0], 0);
  assert.equal(mask.data[2 * 8 + 3], 1);
  assert.equal(countMask(mask), 8);
});

test("findPrimaryComponent chooses the largest meaningful foreground component", () => {
  const mask = createMask(10, 8);
  fillMask(mask, 1, 1, 2, 2);
  fillMask(mask, 5, 2, 4, 4);

  const component = findPrimaryComponent(mask);

  assert.equal(component.bounds.x, 5);
  assert.equal(component.bounds.y, 2);
  assert.equal(component.bounds.width, 4);
  assert.equal(component.bounds.height, 4);
  assert.equal(component.bounds.count, 16);
});

test("classifyForegroundShape distinguishes tall, wide, and compact masks", () => {
  const tall = createMask(20, 30);
  fillMask(tall, 8, 2, 4, 23);
  const wide = createMask(30, 20);
  fillMask(wide, 4, 8, 22, 6);
  const compact = createMask(24, 24);
  fillMask(compact, 7, 7, 10, 10);

  assert.equal(classifyForegroundShape(withBounds(tall), { skinRatio: 0.08 }), "person");
  assert.equal(classifyForegroundShape(withBounds(wide), { skinRatio: 0, darkUpperRatio: 0 }), "animal");
  assert.equal(classifyForegroundShape(withBounds(compact), { skinRatio: 0, darkUpperRatio: 0 }), "object");
});

test("renderShapeAwarePixelSprite produces different occupied layouts for different masks", () => {
  const tallImage = createImageData(20, 30, { r: 255, g: 255, b: 255, a: 255 });
  const wideImage = createImageData(30, 20, { r: 255, g: 255, b: 255, a: 255 });
  fillRect(tallImage, 8, 2, 4, 23, { r: 40, g: 120, b: 220, a: 255 });
  fillRect(wideImage, 4, 8, 22, 6, { r: 160, g: 100, b: 40, a: 255 });

  const tallMask = findPrimaryComponent(extractForegroundMask(tallImage));
  const wideMask = findPrimaryComponent(extractForegroundMask(wideImage));
  const tallColors = sampleRegionColors(tallImage, tallMask);
  const wideColors = sampleRegionColors(wideImage, wideMask);
  const tallSprite = renderShapeAwarePixelSprite(tallImage, tallMask, tallColors, "person");
  const wideSprite = renderShapeAwarePixelSprite(wideImage, wideMask, wideColors, "animal");

  assert.notDeepEqual(getAlphaRows(tallSprite), getAlphaRows(wideSprite));
  assert.notEqual(getAlphaBounds(tallSprite).width, getAlphaBounds(wideSprite).width);
});

test("generateShapeAwarePixelSprite returns generator metadata", () => {
  const imageData = createImageData(16, 24, { r: 255, g: 255, b: 255, a: 255 });
  fillRect(imageData, 6, 3, 4, 17, { r: 220, g: 150, b: 100, a: 255 });

  const generated = generateShapeAwarePixelSprite(imageData);

  assert.equal(generated.generatorVersion, 4);
  assert.equal(generated.sprite.width, 24);
  assert.equal(generated.sprite.height, 36);
  assert.match(generated.subjectKind, /person|animal|object/);
});

test("canCreateCompanionPortraitSprite detects generic face uploads", () => {
  const imageData = createImageData(96, 128, { r: 36, g: 34, b: 42, a: 255 });
  fillRect(imageData, 28, 18, 40, 58, { r: 202, g: 144, b: 102, a: 255 });
  fillRect(imageData, 18, 80, 64, 44, { r: 34, g: 38, b: 48, a: 255 });

  assert.equal(canCreateCompanionPortraitSprite(imageData), true);
});

test("generateCompanionPortraitSprite creates built-in style person proportions", () => {
  const imageData = createImageData(96, 128, { r: 36, g: 34, b: 42, a: 255 });
  fillRect(imageData, 30, 16, 36, 14, { r: 76, g: 46, b: 28, a: 255 });
  fillRect(imageData, 28, 28, 40, 48, { r: 210, g: 150, b: 106, a: 255 });
  fillRect(imageData, 34, 54, 28, 14, { r: 72, g: 52, b: 42, a: 255 });
  fillRect(imageData, 14, 80, 68, 42, { r: 28, g: 34, b: 48, a: 255 });

  const generated = generateCompanionPortraitSprite(imageData);
  const bounds = getAlphaBounds(generated.sprite);

  assert.equal(generated.generator, "local-companion-portrait");
  assert.equal(generated.subjectKind, "person");
  assert.equal(generated.sprite.width, 24);
  assert.equal(generated.sprite.height, 36);
  assert.ok(bounds.height >= 32);
  assert.ok(bounds.width <= 22);
  assert.ok(generated.features.includes("beard"));
});

test("generateCompanionPortraitSprite changes hair and outfit traits across different faces", () => {
  const baldJacket = createImageData(96, 128, { r: 218, g: 160, b: 112, a: 255 });
  fillRect(baldJacket, 28, 18, 40, 54, { r: 218, g: 160, b: 112, a: 255 });
  fillRect(baldJacket, 14, 80, 24, 42, { r: 24, g: 28, b: 36, a: 255 });
  fillRect(baldJacket, 62, 80, 24, 42, { r: 24, g: 28, b: 36, a: 255 });
  fillRect(baldJacket, 38, 80, 24, 42, { r: 190, g: 196, b: 204, a: 255 });

  const longHairShirt = createImageData(96, 128, { r: 34, g: 30, b: 28, a: 255 });
  fillRect(longHairShirt, 22, 10, 56, 70, { r: 42, g: 30, b: 24, a: 255 });
  fillRect(longHairShirt, 30, 24, 36, 48, { r: 174, g: 108, b: 78, a: 255 });
  fillRect(longHairShirt, 14, 80, 68, 42, { r: 54, g: 122, b: 196, a: 255 });

  const baldGenerated = generateCompanionPortraitSprite(baldJacket);
  const longHairGenerated = generateCompanionPortraitSprite(longHairShirt);

  assert.ok(baldGenerated.features.includes("bald"));
  assert.ok(baldGenerated.features.includes("jacket"));
  assert.ok(longHairGenerated.features.includes("long-hair"));
  assert.ok(longHairGenerated.features.includes("shirt"));
  assert.notDeepEqual(getAlphaRows(baldGenerated.sprite), getAlphaRows(longHairGenerated.sprite));
});

test("generateCompanionPortraitSprite outputs a coarse 8-bit pixel grid", () => {
  const imageData = createImageData(96, 128, { r: 36, g: 34, b: 42, a: 255 });
  fillRect(imageData, 28, 18, 40, 58, { r: 202, g: 144, b: 102, a: 255 });
  fillRect(imageData, 18, 80, 64, 44, { r: 34, g: 38, b: 48, a: 255 });

  const generated = generateCompanionPortraitSprite(imageData);

  assert.equal(countNonUniformBlocks(generated.sprite, 2), 0);
});

test("generateCompanionAnimalSprite creates upright mascot proportions", () => {
  const imageData = createImageData(96, 128, { r: 74, g: 118, b: 50, a: 255 });
  fillRect(imageData, 20, 44, 58, 36, { r: 154, g: 104, b: 58, a: 255 });
  fillRect(imageData, 58, 26, 24, 26, { r: 128, g: 86, b: 50, a: 255 });
  fillRect(imageData, 72, 34, 14, 10, { r: 82, g: 58, b: 42, a: 255 });
  fillRect(imageData, 14, 52, 18, 8, { r: 128, g: 86, b: 50, a: 255 });

  const generated = generateCompanionAnimalSprite(imageData);
  const bounds = getAlphaBounds(generated.sprite);

  assert.equal(generated.generator, "local-companion-animal");
  assert.equal(generated.subjectKind, "animal");
  assert.ok(bounds.height >= 31);
  assert.ok(bounds.width <= 24);
  assert.deepEqual(generated.features, ["ears", "snout", "tail", "paws"]);
  assert.equal(generated.sprite.data[(11 * 24 + 9) * 4 + 3], 255);
  assert.equal(generated.sprite.data[(34 * 24 + 14) * 4 + 3], 255);
});

test("canCreateVbPortraitSprite detects portrait-like source images", () => {
  const imageData = createImageData(96, 128, { r: 38, g: 26, b: 18, a: 255 });
  fillRect(imageData, 22, 10, 52, 32, { r: 44, g: 34, b: 26, a: 255 });
  fillRect(imageData, 28, 32, 44, 40, { r: 210, g: 150, b: 100, a: 255 });
  fillRect(imageData, 16, 82, 64, 34, { r: 180, g: 92, b: 48, a: 255 });

  assert.equal(canCreateVbPortraitSprite(imageData), true);
});

test("generateVbPortraitSprite creates a compact Codey portrait with moustache and lanyard", () => {
  const imageData = createImageData(96, 128, { r: 38, g: 26, b: 18, a: 255 });
  fillRect(imageData, 22, 10, 52, 32, { r: 44, g: 34, b: 26, a: 255 });
  fillRect(imageData, 28, 32, 44, 40, { r: 210, g: 150, b: 100, a: 255 });
  fillRect(imageData, 16, 82, 64, 34, { r: 180, g: 92, b: 48, a: 255 });
  fillRect(imageData, 36, 78, 8, 34, { r: 110, g: 220, b: 235, a: 255 });
  fillRect(imageData, 58, 78, 8, 34, { r: 110, g: 220, b: 235, a: 255 });

  const generated = generateVbPortraitSprite(imageData);

  assert.equal(generated.generator, "local-vb-portrait");
  assert.equal(generated.subjectKind, "person");
  assert.equal(generated.label, "Codey");
  assert.deepEqual(generated.features, ["curly-hair", "moustache", "lanyard"]);
  assert.equal(generated.sprite.width, 24);
  assert.equal(generated.sprite.height, 36);
  assert.ok(countOpaquePixels(generated.sprite) >= 220);
  assert.equal(generated.sprite.data[(16 * 24 + 12) * 4 + 3], 255);
  assert.equal(generated.sprite.data[(28 * 24 + 14) * 4 + 3], 255);
});

test("normalize sprite plan accepts valid 15x15 sprite plans", () => {
  const plan = normalizeGeminiSpritePlan(createGeminiPlan());

  assert.equal(plan.canvas.width, 15);
  assert.equal(plan.canvas.height, 15);
  assert.equal(plan.subjectKind, "animal");
  assert.equal(plan.label, "Dog 1");
  assert.deepEqual(plan.features, ["ears", "tail"]);
  assert.equal(plan.pixels[0].color, "#8b5e34");
});

test("normalize sprite plan rejects invalid colors and empty plans", () => {
  assert.throws(() => normalizeGeminiSpritePlan({
    ...createGeminiPlan(),
    pixels: [{ x: 1, y: 1, w: 2, h: 2, color: "missing" }]
  }), /invalid color/);

  assert.throws(() => normalizeGeminiSpritePlan({
    ...createGeminiPlan(),
    pixels: []
  }), /visible pixels/);
});

test("normalize sprite plan clamps out-of-bounds blocks and limits excessive plans", () => {
  const manyPixels = Array.from({ length: 120 }, (_, index) => ({
    x: index % 30,
    y: index % 40,
    w: 5,
    h: 5,
    color: "#123456"
  }));

  const plan = normalizeGeminiSpritePlan({
    ...createGeminiPlan(),
    pixels: manyPixels
  });

  assert.equal(plan.pixels.length, 90);
  assert.ok(plan.pixels.every((pixel) => pixel.x >= 0 && pixel.y >= 0));
  assert.ok(plan.pixels.every((pixel) => pixel.x + pixel.w <= 15));
  assert.ok(plan.pixels.every((pixel) => pixel.y + pixel.h <= 15));
});

test("render sprite plan creates a transparent sprite with outline pixels", () => {
  const sprite = renderGeminiSpritePlan(createGeminiPlan());

  assert.equal(sprite.width, 15);
  assert.equal(sprite.height, 15);
  assert.ok(countOpaquePixels(sprite) > 8);
  assert.equal(sprite.data[0 + 3], 0);
});

test("generate sprite plan returns generator metadata", () => {
  const generated = generateSpriteFromGeminiPlan(createGeminiPlan());

  assert.equal(generated.generatorVersion, 7);
  assert.equal(generated.generator, "gemini-sprite-plan");
  assert.equal(generated.label, "Dog 1");
  assert.deepEqual(generated.features, ["ears", "tail"]);
});

function createImageData(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    setPixel(data, pixel, color);
  }

  return { width, height, data };
}

function fillRect(imageData, x, y, width, height, color) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      setPixel(imageData.data, yy * imageData.width + xx, color);
    }
  }
}

function setPixel(data, pixel, color) {
  const index = pixel * 4;
  data[index] = color.r;
  data[index + 1] = color.g;
  data[index + 2] = color.b;
  data[index + 3] = color.a;
}

function createMask(width, height) {
  return { width, height, data: new Uint8Array(width * height) };
}

function fillMask(mask, x, y, width, height) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      mask.data[yy * mask.width + xx] = 1;
    }
  }
}

function withBounds(mask) {
  return findPrimaryComponent(mask);
}

function countMask(mask) {
  return mask.data.reduce((sum, value) => sum + value, 0);
}

function getAlphaRows(sprite) {
  const rows = [];
  for (let y = 0; y < sprite.height; y += 1) {
    let count = 0;
    for (let x = 0; x < sprite.width; x += 1) {
      if (sprite.data[(y * sprite.width + x) * 4 + 3] > 0) {
        count += 1;
      }
    }
    rows.push(count);
  }
  return rows;
}

function getAlphaBounds(sprite) {
  let minX = sprite.width;
  let minY = sprite.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < sprite.height; y += 1) {
    for (let x = 0; x < sprite.width; x += 1) {
      if (sprite.data[(y * sprite.width + x) * 4 + 3] > 0) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

function countNonUniformBlocks(sprite, blockSize) {
  let nonUniform = 0;

  for (let y = 0; y < sprite.height; y += blockSize) {
    for (let x = 0; x < sprite.width; x += blockSize) {
      const first = getSpritePixelKey(sprite, x, y);

      for (let yy = y; yy < Math.min(sprite.height, y + blockSize); yy += 1) {
        for (let xx = x; xx < Math.min(sprite.width, x + blockSize); xx += 1) {
          if (getSpritePixelKey(sprite, xx, yy) !== first) {
            nonUniform += 1;
            yy = y + blockSize;
            break;
          }
        }
      }
    }
  }

  return nonUniform;
}

function getSpritePixelKey(sprite, x, y) {
  const index = (y * sprite.width + x) * 4;
  return `${sprite.data[index]},${sprite.data[index + 1]},${sprite.data[index + 2]},${sprite.data[index + 3]}`;
}

function createGeminiPlan() {
  return {
    subjectKind: "animal",
    label: "Dog 1",
    canvas: { width: 15, height: 15 },
    palette: {
      fur: "#8b5e34",
      dark: "#1f2937"
    },
    pixels: [
      { x: 5, y: 3, w: 5, h: 4, color: "fur" },
      { x: 3, y: 6, w: 3, h: 3, color: "#8b5e34" },
      { x: 9, y: 2, w: 2, h: 3, color: "fur" },
      { x: 5, y: 9, w: 3, h: 5, color: "dark" },
      { x: 9, y: 9, w: 3, h: 5, color: "dark" }
    ],
    features: ["ears", "tail", "ears"]
  };
}

function countOpaquePixels(sprite) {
  let count = 0;
  for (let index = 3; index < sprite.data.length; index += 4) {
    if (sprite.data[index] > 0) {
      count += 1;
    }
  }
  return count;
}
