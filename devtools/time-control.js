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
  panel.setAttribute('aria-label', '개발 시간 제어');
  panel.innerHTML = `
    <header class="terra-dev-head">
      <strong>DEV <span>— 시간 가속</span></strong>
      <button type="button" class="terra-dev-fold" aria-expanded="true" aria-label="개발자 패널 접기">−</button>
    </header>
    <div class="terra-dev-body">
      <div class="terra-dev-rates" role="group" aria-label="게임 시간 배율"></div>
      <p class="terra-dev-current">현재 가속: <b data-current>1×</b></p>
      <p class="terra-dev-rate">게임 시간: <b data-rate>12분/현실 1분</b></p>
      <p class="terra-dev-clock">누적 게임 시간: <b data-game-time>—</b></p>
      <p class="terra-dev-status" role="status" aria-live="polite"></p>
    </div>`;
  document.body.append(panel);

  const rates = panel.querySelector('.terra-dev-rates');
  const current = panel.querySelector('[data-current]');
  const rateText = panel.querySelector('[data-rate]');
  const gameTime = panel.querySelector('[data-game-time]');
  const status = panel.querySelector('.terra-dev-status');
  const fold = panel.querySelector('.terra-dev-fold');
  let clock = clockFrom(initialSnapshot), pending = false;

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
  fold.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('is-collapsed');
    fold.textContent = collapsed ? '+' : '−';
    fold.setAttribute('aria-expanded', String(!collapsed));
    fold.setAttribute('aria-label', collapsed ? '개발자 패널 펼치기' : '개발자 패널 접기');
  });

  function update(snapshot) { clock = clockFrom(snapshot); render(); }
  render();
  return { update, destroy() { panel.remove(); css.remove(); } };
}
