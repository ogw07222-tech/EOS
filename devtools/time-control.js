const MULTIPLIERS = [1, 2, 5, 10, 50];

function clockFrom(value = {}) {
  const clock = value.gameClock || value.devClock || value.clock || value;
  const multiplier = MULTIPLIERS.includes(Number(clock.multiplier)) ? Number(clock.multiplier) : 1;
  const minutesPerRealMinute = Number(clock.gameMinutesPerRealMinute) || 12 * multiplier;
  const gameMinutes = Number(clock.gameMinutes ?? clock.elapsedGameMinutes ?? clock.totalGameMinutes);
  return { multiplier, minutesPerRealMinute, gameMinutes: Number.isFinite(gameMinutes) ? gameMinutes : null };
}

function formatGameTime(minutes) {
  if (minutes === null) return '—';
  const total = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(total / 60), remainder = total % 60;
  return hours ? `${hours}시간 ${remainder}분` : `${remainder}분`;
}

export function mountDevPanel(initialSnapshot) {
  if (document.getElementById('terra-dev-time-panel')) return null;
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = '/devtools/dev-panel.css'; css.dataset.terraDevtools = 'time-control';
  document.head.append(css);

  const panel = document.createElement('aside');
  panel.id = 'terra-dev-time-panel'; panel.className = 'terra-dev-time-panel';
  panel.setAttribute('aria-label', '개발자 도구');
  panel.innerHTML = `
    <header class="terra-dev-head">
      <strong>DEV <span>— 시간·좌표·바이옴</span></strong>
      <button type="button" class="terra-dev-fold" aria-expanded="false" aria-label="개발자 패널 펼치기">+</button>
    </header>
    <div class="terra-dev-body">
      <div class="terra-dev-rates" role="group" aria-label="게임 시간 배율"></div>
      <p class="terra-dev-current">현재 가속: <b data-current>1×</b></p>
      <p class="terra-dev-rate">게임 시간: <b data-rate>12분/현실 1분</b></p>
      <p class="terra-dev-clock">누적 게임 시간: <b data-game-time>—</b></p>
      <div class="terra-dev-fluid-rate"><label>물 흐름 <select data-fluid-rate aria-label="물 흐름 틱 빈도"><option value="2">2틱/초</option><option value="5" selected>5틱/초</option><option value="10">10틱/초</option></select></label><span data-fluid-rate-status></span></div>
      <section class="terra-dev-teleport" aria-labelledby="terra-dev-teleport-title">
        <h2 id="terra-dev-teleport-title">좌표 이동</h2>
        <div class="terra-dev-coordinates">
          <label>X<input data-tp-x type="number" inputmode="decimal" step="0.1" autocomplete="off" aria-label="이동할 X 좌표"></label>
          <label>Y<input data-tp-y type="number" inputmode="decimal" step="0.1" autocomplete="off" aria-label="이동할 Y 좌표"></label>
          <label>Z<input data-tp-z type="number" inputmode="decimal" step="0.1" autocomplete="off" aria-label="이동할 Z 좌표"></label>
        </div>
        <label class="terra-dev-check"><input data-tp-auto-y type="checkbox" checked> Y 자동 (안전한 지면)</label>
        <label class="terra-dev-check terra-dev-risk"><input data-tp-water type="checkbox" disabled> 위험 위치 허용 (물속 QA)</label>
        <p class="terra-dev-water-status" data-tp-water-status>물속 판정 미구현</p>
        <div class="terra-dev-actions">
          <button type="button" data-tp-go>이동</button>
          <button type="button" data-tp-return disabled>이전 위치</button>
        </div>
        <div class="terra-dev-location">
          <span>현재 위치 <b data-tp-current>—</b></span>
          <button type="button" data-tp-copy aria-label="현재 좌표 복사">복사</button>
        </div>
        <p class="terra-dev-biome">바이옴: <b data-tp-biome>—</b></p>
        <div class="terra-dev-biome-jump">
          <label>바이옴 이동<select data-tp-biome-select aria-label="이동할 바이옴"><option value="plains">평원</option><option value="forest">숲</option><option value="beach">해변</option><option value="ocean">바다</option><option value="river">강</option></select></label>
          <button type="button" data-tp-biome-go>검색 후 이동</button>
        </div>
        <p class="terra-dev-biome-status" data-tp-biome-status role="status" aria-live="polite"></p>
        <p class="terra-dev-tp-status" role="status" aria-live="polite"></p>
      </section>
      <p class="terra-dev-status" role="status" aria-live="polite"></p>
    </div>`;
  document.body.append(panel);
  panel.classList.add("is-collapsed");

  const rates = panel.querySelector('.terra-dev-rates');
  const current = panel.querySelector('[data-current]');
  const rateText = panel.querySelector('[data-rate]');
  const gameTime = panel.querySelector('[data-game-time]');
  const status = panel.querySelector('.terra-dev-status');
  const fluidRate = panel.querySelector('[data-fluid-rate]');
  const fluidRateStatus = panel.querySelector('[data-fluid-rate-status]');
  const fold = panel.querySelector('.terra-dev-fold');
  const tpX = panel.querySelector('[data-tp-x]');
  const tpY = panel.querySelector('[data-tp-y]');
  const tpZ = panel.querySelector('[data-tp-z]');
  const autoY = panel.querySelector('[data-tp-auto-y]');
  const allowWater = panel.querySelector('[data-tp-water]');
  const waterStatus = panel.querySelector('[data-tp-water-status]');
  const teleportButton = panel.querySelector('[data-tp-go]');
  const returnButton = panel.querySelector('[data-tp-return]');
  const currentPosition = panel.querySelector('[data-tp-current]');
  const biomeLabel = panel.querySelector('[data-tp-biome]');
  const biomeSelect = panel.querySelector('[data-tp-biome-select]');
  const biomeGo = panel.querySelector('[data-tp-biome-go]');
  const biomeStatus = panel.querySelector('[data-tp-biome-status]');
  const teleportStatus = panel.querySelector('.terra-dev-tp-status');
  let clock = clockFrom(initialSnapshot), pending = false;
  let teleportPending = false, biomePending = false, previousPosition = null;
  let previousAvailable = initialSnapshot?.devTeleport?.previousAvailable === true;
  let playerPosition = initialSnapshot?.player || null;
  let biome = initialSnapshot?.biome ?? null;
  let waterSafety = initialSnapshot?.waterSafety ?? initialSnapshot?.devTeleport?.waterSafety ?? 'not-modeled';
  let generatedWorld = Boolean(initialSnapshot?.worldGenVersion);
  let fluidRateSupported = initialSnapshot?.worldGenVersion === 2 && Number.isFinite(Number(initialSnapshot?.fluidTickRate));

  function coordinates(value) {
    if (!value || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.y)) || !Number.isFinite(Number(value.z))) return null;
    return { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
  }

  function displayCoordinates(value) {
    const point = coordinates(value);
    return point ? `X ${point.x.toFixed(2)} · Y ${point.y.toFixed(2)} · Z ${point.z.toFixed(2)}` : '—';
  }

  function biomeText(value) {
    if (typeof value === 'string' && value.trim()) return value;
    if (value && typeof value.id === 'string') return value.name ? `${value.name} (${value.id})` : value.id;
    return '—';
  }

  function updateLocation(snapshot = {}) {
    if (snapshot.player) playerPosition = snapshot.player;
    if (Object.hasOwn(snapshot, 'biome')) biome = snapshot.biome;
    if (Object.hasOwn(snapshot, 'worldGenVersion')) generatedWorld = Boolean(snapshot.worldGenVersion);
    if (Object.hasOwn(snapshot, 'fluidTickRate')) { fluidRateSupported = Number(snapshot.worldGenVersion ?? initialSnapshot?.worldGenVersion) === 2; if ([2, 5, 10].includes(Number(snapshot.fluidTickRate))) fluidRate.value = String(snapshot.fluidTickRate); }
    if (Object.hasOwn(snapshot, 'waterSafety')) waterSafety = snapshot.waterSafety;
    else if (snapshot.devTeleport && Object.hasOwn(snapshot.devTeleport, 'waterSafety')) waterSafety = snapshot.devTeleport.waterSafety;
    if (snapshot.devTeleport && Object.hasOwn(snapshot.devTeleport, 'previousAvailable')) previousAvailable = snapshot.devTeleport.previousAvailable === true;
    const waterSupported = waterSafety === 'modeled' || waterSafety === true;
    allowWater.disabled = !waterSupported;
    if (!waterSupported) allowWater.checked = false;
    waterStatus.textContent = waterSupported ? '물속 판정 사용 가능' : '물속 판정 미구현';
    biomeGo.disabled = !generatedWorld || biomePending || teleportPending;
    fluidRate.disabled = !fluidRateSupported;
    fluidRateStatus.textContent = fluidRateSupported ? `${fluidRate.value}틱/초` : 'v2 월드에서 사용';
    currentPosition.textContent = displayCoordinates(playerPosition);
    biomeLabel.textContent = biomeText(biome);
    returnButton.disabled = teleportPending || !previousAvailable;
  }

  async function postTeleport(path, body = {}) {
    if (teleportPending) return;
    teleportPending = true;
    teleportButton.disabled = true;
    returnButton.disabled = true;
    teleportStatus.textContent = path.endsWith('/return') ? '이전 위치로 이동 중…' : '안전한 위치를 확인하고 이동 중…';
    try {
      const response = await fetch(path, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '좌표 이동에 실패했습니다.');
      if (payload.player) playerPosition = payload.player;
      if (path.endsWith('/return')) previousPosition = null;
      else if (Object.hasOwn(payload, 'previousPosition')) previousPosition = payload.previousPosition;
      previousAvailable = path.endsWith('/return') ? false : Boolean(payload.previousPosition);
      if (Object.hasOwn(payload, 'biome')) biome = payload.biome;
      if (Object.hasOwn(payload, 'waterSafety')) waterSafety = payload.waterSafety;
      if (payload.world) {
        updateLocation({ ...payload.world, biome, waterSafety });
        window.dispatchEvent(new CustomEvent('terra-dev-teleport', { detail: payload.world }));
      } else updateLocation({ player: payload.player, biome: payload.biome, waterSafety });
      teleportStatus.textContent = path.endsWith('/return') ? '이전 위치로 돌아왔습니다.' : '이동했습니다.';
      return true;
    } catch (error) {
      teleportStatus.textContent = error.message || '좌표 이동 요청에 실패했습니다.';
      return false;
    } finally {
      teleportPending = false;
      teleportButton.disabled = false;
      returnButton.disabled = !previousAvailable;
    }
  }

  function render() {
    current.textContent = `${clock.multiplier}×`;
    rateText.textContent = `${clock.minutesPerRealMinute}분/현실 1분`;
    gameTime.textContent = formatGameTime(clock.gameMinutes);
    for (const button of rates.children) {
      const active = Number(button.dataset.multiplier) === clock.multiplier;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      button.disabled = pending;
    }
  }

  for (const multiplier of MULTIPLIERS) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = `${multiplier}×`;
    button.dataset.multiplier = String(multiplier);
    button.addEventListener('click', async () => {
      if (pending || multiplier === clock.multiplier) return;
      pending = true; status.textContent = '서버 시간 동기화 중…'; render();
      try {
        const response = await fetch('/api/dev/time', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ multiplier })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || '배율 변경에 실패했습니다.');
        clock = clockFrom(payload.gameClock || payload.devClock || payload.clock || payload.world || payload);
        status.textContent = '';
      } catch (error) {
        status.textContent = error.message || '시간 서버에 연결할 수 없습니다.';
      } finally { pending = false; render(); }
    });
    rates.append(button);
  }
  fluidRate.addEventListener('change', async () => {
    const tickRate = Number(fluidRate.value); fluidRate.disabled = true; fluidRateStatus.textContent = '물 흐름 속도 적용 중…';
    try {
      const response = await fetch('/api/dev/fluid-rate', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tickRate}) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '물 흐름 속도를 변경하지 못했습니다.');
      const actual = Number(payload.fluidTickRate ?? payload.tickRate ?? tickRate); if ([2,5,10].includes(actual)) fluidRate.value = String(actual);
      fluidRateStatus.textContent = `${fluidRate.value}틱/초`;
    } catch (error) { fluidRateStatus.textContent = error.message || '물 흐름 속도 변경 실패'; }
    finally { fluidRate.disabled = !fluidRateSupported; }
  });
  autoY.addEventListener('change', () => { tpY.disabled = autoY.checked; });
  tpY.disabled = autoY.checked;
  teleportButton.addEventListener('click', () => {
    const x = tpX.valueAsNumber, z = tpZ.valueAsNumber, y = tpY.valueAsNumber;
    if (!Number.isFinite(x) || !Number.isFinite(z) || (!autoY.checked && !Number.isFinite(y))) {
      teleportStatus.textContent = 'X/Z와 직접 지정할 Y에는 유효한 숫자를 입력해 주세요.';
      return;
    }
    const minXZ = generatedWorld ? -4096 : -64, maxXZ = generatedWorld ? 4096 : 64;
    const minY = generatedWorld ? -32 : -8, maxY = generatedWorld ? 32 : 16;
    if (x < minXZ || x >= maxXZ || z < minXZ || z >= maxXZ) {
      teleportStatus.textContent = `X/Z 범위는 ${minXZ} 이상 ${maxXZ} 미만입니다.`;
      return;
    }
    if (!autoY.checked && (y < minY || y > maxY)) {
      teleportStatus.textContent = `Y 범위는 ${minY}부터 ${maxY}까지입니다.`;
      return;
    }
    void postTeleport('/api/dev/teleport', {
      x, z, ...(autoY.checked ? {} : { y }), autoY: autoY.checked, allowWater: allowWater.checked
    });
  });
  returnButton.addEventListener('click', () => void postTeleport('/api/dev/teleport/return'));
  biomeGo.addEventListener('click', async () => {
    if (!generatedWorld || biomePending || teleportPending) return;
    biomePending = true; biomeGo.disabled = true; biomeStatus.textContent = '시드에서 바이옴 좌표를 찾는 중…';
    try {
      const response = await fetch('/api/dev/biomes', { credentials: 'same-origin' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '바이옴 좌표 검색에 실패했습니다.');
      const target = payload.biomes?.[biomeSelect.value];
      if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.z)) throw new Error('해당 시드에 찾은 바이옴 좌표가 없습니다.');
      tpX.value = String(target.x); tpZ.value = String(target.z); autoY.checked = true; tpY.disabled = true;
      biomeStatus.textContent = `${payload.seed} 시드 · X ${target.x}, Z ${target.z} · 안전 착지 확인 중`;
      const moved = await postTeleport('/api/dev/teleport', { x: target.x, z: target.z, autoY: true });
      biomeStatus.textContent = moved ? `${biomeText(biome)} 도착 · X ${target.x}, Z ${target.z}` : '이동 실패 · 오류 내용을 확인해 주세요.';
    } catch (error) {
      biomeStatus.textContent = error.message || '바이옴 이동에 실패했습니다.';
    } finally {
      biomePending = false; biomeGo.disabled = !generatedWorld || teleportPending;
    }
  });
  panel.querySelector('[data-tp-copy]').addEventListener('click', async () => {
    const point = coordinates(playerPosition);
    if (!point) { teleportStatus.textContent = '복사할 현재 좌표가 없습니다.'; return; }
    const value = `${point.x}, ${point.y}, ${point.z}`;
    try {
      await navigator.clipboard.writeText(value);
      teleportStatus.textContent = '현재 좌표를 복사했습니다.';
    } catch {
      const field = document.createElement('textarea');
      field.value = value; field.setAttribute('readonly', '');
      field.style.position = 'fixed'; field.style.opacity = '0';
      document.body.append(field); field.select();
      const copied = document.execCommand('copy'); field.remove();
      teleportStatus.textContent = copied ? '현재 좌표를 복사했습니다.' : '좌표를 복사할 수 없습니다.';
    }
  });
  fold.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('is-collapsed');
    fold.textContent = collapsed ? '+' : '−';
    fold.setAttribute('aria-expanded', String(!collapsed));
    fold.setAttribute('aria-label', collapsed ? '개발자 패널 펼치기' : '개발자 패널 접기');
  });

  function update(snapshot) { clock = clockFrom(snapshot); updateLocation(snapshot); returnButton.disabled = teleportPending || !previousAvailable; render(); }
  updateLocation(initialSnapshot || {});
  render();
  return { update, destroy() { panel.remove(); css.remove(); } };
}
