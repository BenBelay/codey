import { CHARACTER } from "./constants.js";

export function stepCharacter(state, platforms, environment, dtSeconds) {
  const dt = clamp(dtSeconds, 0, 0.05);
  const next = {
    ...state,
    lastActiveAt: Date.now()
  };

  const width = environment.characterWidth || CHARACTER.width;
  const height = environment.characterHeight || CHARACTER.height;
  const viewportWidth = environment.viewportWidth || 1024;
  const viewportHeight = environment.viewportHeight || 768;
  const scrollX = environment.scrollX || 0;
  const scrollY = environment.scrollY || 0;
  const documentHeight = Math.max(environment.documentHeight || scrollY + 900, scrollY + height + 1);
  const horizontalSpeedScale = getCursorSlowdownScale(next, environment.cursor, width, height);
  const speedScale = normalizeScale(environment.speedScale);
  const jumpinessScale = normalizeScale(environment.jumpinessScale);

  next.vy = Math.min(CHARACTER.maxFallSpeed, next.vy + CHARACTER.gravity * dt);

  next.x += next.vx * speedScale * horizontalSpeedScale * dt;
  next.y += next.vy * dt;

  const minX = scrollX + CHARACTER.edgePadding;
  const maxX = scrollX + Math.max(CHARACTER.edgePadding, viewportWidth - width - CHARACTER.edgePadding);
  if (next.x <= minX || next.x >= maxX) {
    next.x = clamp(next.x, minX, maxX);
    next.direction *= -1;
    next.vx = Math.abs(next.vx || CHARACTER.walkSpeed) * next.direction;
  }

  const collision = resolveVerticalLanding(next, platforms, state, width, height);
  const grounded = Boolean(collision);

  if (grounded) {
    next.y = collision.top - height;
    next.vy = 0;

    const nearEdge = isNearPlatformEdge(next, collision, width);
    const jumpChance = Math.min(0.9, jumpinessScale * dt);
    if (nearEdge || Math.random() < jumpChance) {
      next.vy = -CHARACTER.jumpSpeed;
      next.animation = "jump";
    } else {
      next.animation = Math.abs(next.vx * speedScale * horizontalSpeedScale) > 8 ? "walk" : "idle";
    }
  } else {
    next.animation = next.vy < 0 ? "jump" : "fall";
  }

  const floorY = documentHeight - height - 8;
  if (next.y > floorY) {
    next.y = floorY;
    next.vy = 0;
    next.animation = "land";
  }

  const minVisibleY = scrollY + CHARACTER.edgePadding;
  const maxVisibleY = scrollY + Math.max(CHARACTER.edgePadding, viewportHeight - height - CHARACTER.edgePadding);
  const maxAllowedY = Math.max(minVisibleY, Math.min(maxVisibleY, floorY));

  if (next.y < minVisibleY) {
    next.y = minVisibleY;
    next.vy = Math.max(0, next.vy);
    next.animation = next.vy > 0 ? "fall" : "idle";
  }

  if (next.y > maxAllowedY) {
    next.y = maxAllowedY;
    next.vy = 0;
    next.animation = Math.abs(next.vx * speedScale * horizontalSpeedScale) > 8 ? "walk" : "idle";
  }

  next.direction = next.vx < 0 ? -1 : 1;
  return next;
}

function normalizeScale(value) {
  return Number.isFinite(value) ? Math.max(0.5, Math.min(2, value)) : 1;
}

function getCursorSlowdownScale(state, cursor, width, height) {
  if (!cursor || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) {
    return 1;
  }

  const nearestX = clamp(cursor.x, state.x, state.x + width);
  const nearestY = clamp(cursor.y, state.y, state.y + height);
  const distance = Math.hypot(cursor.x - nearestX, cursor.y - nearestY);

  if (distance >= CHARACTER.cursorSlowRadius) {
    return 1;
  }

  const distanceFactor = distance / CHARACTER.cursorSlowRadius;
  return CHARACTER.cursorSlowScale + (1 - CHARACTER.cursorSlowScale) * distanceFactor;
}

export function resolveVerticalLanding(next, platforms, previous, width, height) {
  const previousBottom = previous.y + height;
  const nextBottom = next.y + height;
  const movingDown = next.vy >= 0;

  if (!movingDown) {
    return null;
  }

  let best = null;
  for (const platform of platforms) {
    const overlapsHorizontally = next.x + width > platform.left + 4 && next.x < platform.right - 4;
    const crossedTop = previousBottom <= platform.top + CHARACTER.surfaceSnapDistance
      && nextBottom >= platform.top
      && previous.y < platform.top;

    if (!overlapsHorizontally || !crossedTop) {
      continue;
    }

    if (!best || platform.top < best.top) {
      best = platform;
    }
  }

  return best;
}

function isNearPlatformEdge(state, platform, width) {
  const leftGap = state.x - platform.left;
  const rightGap = platform.right - (state.x + width);
  return leftGap < 20 || rightGap < 20;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
