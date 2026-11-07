/* Shared by the two Final screens: fit the 2560x1080 canvas to the window, F for full screen. */
(function () {
  'use strict';
  const canvas = document.getElementById('canvas');
  function fit() {
    const s = Math.min(innerWidth / 2560, innerHeight / 1080);
    canvas.style.transform = `translate(${(innerWidth - 2560 * s) / 2}px, ${(innerHeight - 1080 * s) / 2}px) scale(${s})`;
  }
  addEventListener('resize', fit);
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
