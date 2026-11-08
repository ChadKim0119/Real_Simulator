/* Shared by the two Final screens: fit the 2560x1080 canvas to the window, F for full screen. */
(function () {
  'use strict';
  const canvas = document.getElementById('canvas');
  // the screen's own size (a phone may report a layout wider than the screen while the canvas loads)
  function fit() {
    const de = document.documentElement;
    const w = Math.min(innerWidth, de.clientWidth || innerWidth), h = Math.min(innerHeight, de.clientHeight || innerHeight);
    const s = Math.min(w / 2560, h / 1080);
    canvas.style.transform = `translate(${(w - 2560 * s) / 2}px, ${(h - 1080 * s) / 2}px) scale(${s})`;
    // a phone held upright shows the 21:9 screen small: say it reads bigger sideways
    hint.classList.toggle('on', h > w && w < 900);
  }
  const hint = document.createElement('div');
  hint.id = 'rotHint';
  hint.textContent = '가로로 돌리면 더 크게 볼 수 있습니다';
  document.body.appendChild(hint);
  addEventListener('resize', fit);
  addEventListener('orientationchange', () => setTimeout(fit, 250));
  document.addEventListener('fullscreenchange', fit);
  fit();
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyF') (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  });
  const pad = (n) => String(n).padStart(2, '0');
  window.FinalUI = {
    mmss: (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; },
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    CASECOL: { A: '#ff4d5e', B: '#ffb02e', C: '#3fd0c9' },
    // the case the screens follow: the newest (a new scenario starts afresh)
    primary: (snap) => snap && snap.cases && snap.cases[0],          // the newest case (new cases go in front)
  };
})();
