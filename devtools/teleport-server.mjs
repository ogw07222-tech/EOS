const SEARCH_VERTICAL_BLOCKS = 8;

function boundsFor(world, limits) {
  if (world?.worldGenVersion) {
    return { minX: -4096, maxX: 4096, minZ: -4096, maxZ: 4096, minY: limits.worldMinY, maxY: limits.worldMaxY };
  }
  return { minX: -64, maxX: 64, minZ: -64, maxZ: 64, minY: -8, maxY: 16 };
}

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }

function validXZ(world, x, z, limits) {
  const bounds = boundsFor(world, limits);
  return finite(x) && finite(z) && x >= bounds.minX && x < bounds.maxX && z >= bounds.minZ && z < bounds.maxZ;
}

function withinY(world, y, limits) {
  const bounds = boundsFor(world, limits);
  return finite(y) && y >= bounds.minY && y <= bounds.maxY;
}

function bodyPosition(x, y, z, grounded = true) {
  return { x, y, z, grounded };
}

/**
 * Build the developer-only teleport service. Terrain and collision queries are
 * injected by server.mjs so this module remains deterministic and easy to test.
 */
export function createTeleportService({
  worldMinY,
  worldMaxY,
  surfaceAt,
  isSolidForPlayer,
  hasGroundSupport,
  isLiquidAt = () => false,
  biomeAt = () => null,
}) {
  if (![worldMinY, worldMaxY].every(Number.isFinite)) throw new TypeError('Teleport world bounds are required');
  if (typeof surfaceAt !== 'function' || typeof isSolidForPlayer !== 'function' || typeof hasGroundSupport !== 'function') {
    throw new TypeError('Teleport terrain and collision callbacks are required');
  }

  const origins = new WeakMap();

  function validateXZ(world, x, z) {
    return validXZ(world, x, z, { worldMinY, worldMaxY });
  }

  function safePosition(world, x, y, z, { allowWater = false, requireSupport = true } = {}) {
    if (!validateXZ(world, x, z) || !withinY(world, y, { worldMinY, worldMaxY })) {
      return { ok: false, code: 'out-of-bounds', reason: '좌표가 월드 범위를 벗어났습니다.' };
    }
    if (isSolidForPlayer(world, x, y, z)) {
      return { ok: false, code: 'solid-overlap', reason: '플레이어 충돌체가 고체와 겹칩니다.' };
    }
    const liquid = !!isLiquidAt(world, x, y, z);
    if (liquid && !allowWater) {
      return { ok: false, code: 'water-disabled', reason: '물속 이동은 위험 위치 허용을 켜야 합니다.' };
    }
    const supported = !!hasGroundSupport(world, x, y, z);
    if (requireSupport && !supported && !(liquid && allowWater)) {
      return { ok: false, code: 'no-safe-ground', reason: '안전한 발판을 찾지 못했습니다.' };
    }
    return { ok: true, player: bodyPosition(x, y, z, supported), liquid };
  }

  function findSafeLanding(world, x, z, { allowWater = false } = {}) {
    if (!validateXZ(world, x, z)) return { ok: false, code: 'out-of-bounds', reason: 'X/Z 좌표가 월드 범위를 벗어났습니다.' };
    const terrainY = Math.floor(surfaceAt(world, Math.floor(x), Math.floor(z)));
    if (!Number.isFinite(terrainY)) return { ok: false, code: 'terrain-unavailable', reason: '지형 높이를 계산할 수 없습니다.' };
    const bounds = boundsFor(world, { worldMinY, worldMaxY });
    const checked = new Set();
    for (let offset = 0; offset <= SEARCH_VERTICAL_BLOCKS; offset++) {
      const candidates = offset === 0 ? [terrainY] : [terrainY + offset, terrainY - offset];
      for (const y of candidates) {
        if (checked.has(y) || y < bounds.minY || y > bounds.maxY) continue;
        checked.add(y);
        const result = safePosition(world, x, y, z, { allowWater });
        if (result.ok) return result;
      }
    }
    return { ok: false, code: 'no-safe-landing', reason: `주변 ${SEARCH_VERTICAL_BLOCKS}블록 범위에서 안전한 착지 지점을 찾지 못했습니다.` };
  }

  function metadata(world, player) {
    let biome = null;
    if (world?.worldGenVersion && Number.isFinite(player.x) && Number.isFinite(player.z)) {
      try { biome = biomeAt(world.worldSeed, Math.floor(player.x), Math.floor(player.z)); } catch { biome = null; }
    }
    return { biome, waterSafety: 'not-modeled' };
  }

  function resolve(world, player, body) {
    if (world?.location?.worldId === 'shop-hub') {
      return { ok: false, status: 409, code: 'unsupported-world', reason: '상점 허브에서는 좌표 이동을 지원하지 않습니다.' };
    }
    const { x, y, z, autoY = false, allowWater = false } = body || {};
    if (typeof autoY !== 'boolean' || typeof allowWater !== 'boolean' || !validateXZ(world, x, z)) {
      return { ok: false, status: 400, code: 'invalid-coordinates', reason: 'X/Z에는 월드 범위 안의 유한 숫자를 입력하세요.' };
    }
    if (!autoY && !withinY(world, y, { worldMinY, worldMaxY })) {
      return { ok: false, status: 400, code: 'invalid-coordinates', reason: 'Y에는 월드 범위 안의 유한 숫자를 입력하세요.' };
    }

    let destination;
    if (autoY) destination = findSafeLanding(world, x, z, { allowWater });
    else destination = safePosition(world, x, y, z, { allowWater });
    if (!destination.ok) return { ok: false, status: 400, ...destination };

    const origin = bodyPosition(player.x, player.y, player.z, player.grounded === true);
    const nextPlayer = { ...destination.player };
    return {
      ok: true,
      player: nextPlayer,
      origin,
      previousPosition: origin,
      ...metadata(world, nextPlayer),
    };
  }

  function rememberPrevious(session, world, origin) {
    if (!session || typeof session !== 'object') throw new TypeError('A player session is required');
    origins.set(session, { worldId: world?.location?.worldId || 'personal-island', position: bodyPosition(origin.x, origin.y, origin.z, origin.grounded === true) });
  }

  function returnToPrevious(session, world, player) {
    if (!session || typeof session !== 'object') throw new TypeError('A player session is required');
    if (world?.location?.worldId === 'shop-hub') {
      return { ok: false, status: 409, code: 'unsupported-world', reason: '상점 허브에서는 좌표 복귀를 지원하지 않습니다.' };
    }
    const saved = origins.get(session);
    if (!saved || saved.worldId !== (world?.location?.worldId || 'personal-island')) {
      return { ok: false, status: 409, code: 'no-previous-position', reason: '복귀할 이전 순간이동 위치가 없습니다.' };
    }
    const { x, y, z } = saved.position;
    const target = safePosition(world, x, y, z, { allowWater: false, requireSupport: false });
    if (!target.ok) return { ok: false, status: 400, ...target };
    // Keep the original teleport origin available; return does not toggle it.
    const nextPlayer = { ...target.player };
    return {
      ok: true,
      player: nextPlayer,
      previousPosition: saved.position,
      ...metadata(world, nextPlayer),
    };
  }

  function hasPrevious(session) { return !!session && origins.has(session); }
  function clearPrevious(session) { if (session && typeof session === 'object') origins.delete(session); }

  return { resolve, rememberPrevious, returnToPrevious, findSafeLanding, hasPrevious, clearPrevious };
}
