/* Small corner buttons on the control panel and the Final screens: open the other two
 * screens of the demo in their own windows, each on another monitor when the browser can
 * tell where the monitors are (Window Management API — Chrome / Edge ask once for
 * permission). Without it the window opens and can be dragged to the monitor.
 * Each screen keeps one window: pressing again brings that window forward (it is not
 * reloaded), so a running demo is never interrupted. */
(function () {
  'use strict';
  const SCREENS = {
    control: { url: 'control.html', label: '컨트롤', title: '컨트롤 패널' },
    instrument: { url: 'final_instrument.html', label: '계기판 · HU', title: 'Final_Instrument (계기판 · HU)' },
    dataflow: { url: 'final_dataflow.html', label: '데이터 흐름', title: 'Final_Dataflow (데이터 흐름 · CCW · DMS)' },
  };
  const page = /final_instrument/.test(location.pathname) ? 'instrument' : /final_dataflow/.test(location.pathname) ? 'dataflow' : 'control';
  if (window.top !== window) return;                 // not inside an iframe
  const others = Object.keys(SCREENS).filter((k) => k !== page);

  const css = `
  #launch { position: fixed; left: 10px; bottom: 10px; z-index: 2147483000; display: flex; gap: 6px; align-items: center;
    font: 600 12px/1 "Pretendard", system-ui, sans-serif; transition: opacity .35s ease; }
  #launch.idle { opacity: 0; }
  #launch.idle:hover { opacity: 1; }
  #launch.inline { position: static; margin-left: 4px; }
  #launch button { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 999px; cursor: pointer;
    color: #cfe0ff; background: rgba(12, 18, 30, .72); border: 1px solid rgba(160, 190, 255, .22); backdrop-filter: blur(8px); white-space: nowrap; }
  #launch button:hover { color: #fff; background: rgba(40, 70, 140, .85); border-color: rgba(160, 190, 255, .5); }
  #launch button svg { width: 13px; height: 13px; flex: none; }
  #launch button.open::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #3ddc84; }
  `;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>';
  const bar = document.createElement('div');
  bar.id = 'launch';
  bar.innerHTML = others.map((k) => `<button data-launch="${k}" title="${SCREENS[k].title} — 다른 모니터에 새 창으로 열기 (다시 누르면 그 창을 앞으로)">${ICON}${SCREENS[k].label}</button>`).join('');
  // the control panel: in its header bar; the Final screens: the bottom-left corner
  const mount = () => {
    const head = page === 'control' && document.querySelector('body > header');
    if (head) { bar.classList.add('inline'); head.appendChild(bar); } else document.body.appendChild(bar);
  };
  if (document.body) mount(); else addEventListener('DOMContentLoaded', mount);

  // the presentation screens: the buttons fade away while the mouse is still (the car and
  // the panels are iframes that keep the mouse to themselves: hovering the corner shows them)
  if (page !== 'control') {
    let t = 0;
    const wake = () => { bar.classList.remove('idle'); clearTimeout(t); t = setTimeout(() => { if (!bar.matches(':hover')) bar.classList.add('idle'); }, 3000); };
    ['mousemove', 'pointerdown', 'keydown'].forEach((e) => addEventListener(e, wake, { passive: true }));
    wake();
  }

  /* A window opened by these buttons (?fs=1) goes fullscreen by itself: at once where the
   * browser allows it (a fullscreen popup, or the site allowed automatic fullscreen); if
   * the browser wants a gesture first, a light layer asks for one click anywhere, and the
   * first click or key makes it fullscreen. */
  const q = new URLSearchParams(location.search);
  if (q.has('fs')) {
    q.delete('fs');
    history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : '') + location.hash);
    const full = () => !!document.fullscreenElement || (Math.abs(innerWidth - screen.width) < 4 && Math.abs(innerHeight - screen.height) < 4);
    const go = () => (document.fullscreenElement ? Promise.resolve() : document.documentElement.requestFullscreen({ navigationUI: 'hide' }));
    const ask = () => {
      if (full() || document.getElementById('fsAsk')) return;
      const st2 = document.createElement('style');
      st2.textContent = `#fsAsk { position: fixed; inset: 0; z-index: 2147483001; display: grid; place-items: center; cursor: pointer; background: rgba(4, 7, 12, .38); }
        #fsAsk span { padding: 16px 30px; border-radius: 999px; font: 700 22px/1.2 "Pretendard", system-ui, sans-serif; color: #eaf2ff; background: rgba(14, 22, 38, .9); border: 1px solid rgba(160, 190, 255, .35); }`;
      document.head.appendChild(st2);
      const a = document.createElement('div');
      a.id = 'fsAsk';
      a.innerHTML = '<span>화면을 한 번 클릭하면 전체화면으로 전환됩니다</span>';
      document.body.appendChild(a);
      const done = () => { a.remove(); removeEventListener('keydown', onKey, true); };
      const onKey = () => { go().then(done, () => {}); };
      a.addEventListener('pointerdown', () => { go().then(done, done); });
      addEventListener('keydown', onKey, true);
    };
    const tryNow = () => go().catch(() => setTimeout(ask, 300));
    if (document.readyState === 'complete') tryNow(); else addEventListener('load', tryNow);
    // a window that was fullscreen as a popup has no fullscreen element: nothing to ask then
  }

  const wins = {};
  async function screenFor(k) {
    if (!('getScreenDetails' in window)) return null;
    try {
      const d = await window.getScreenDetails();
      const cur = d.currentScreen;
      const rest = d.screens.filter((s) => s !== cur).sort((a, b) => a.left - b.left || a.top - b.top);
      if (!rest.length) return null;
      // the two other screens go to two different monitors when there are two to spare
      return rest[Math.min(others.indexOf(k), rest.length - 1)];
    } catch (e) { return null; }             // permission refused: a plain window
  }
  async function open(k) {
    const name = `rs-${k}`;
    const known = wins[k];
    if (known && !known.closed) { known.focus(); mark(); return; }
    const s = await screenFor(k);
    // 'fullscreen': Chrome / Edge open the window straight into fullscreen on that monitor
    // where fullscreen popups are allowed (window management permission); elsewhere ignored
    const feat = s
      ? `popup,fullscreen,left=${s.availLeft},top=${s.availTop},width=${s.availWidth},height=${s.availHeight}`
      : `popup,width=${Math.round(screen.availWidth * 0.8)},height=${Math.round(screen.availHeight * 0.8)}`;
    // an empty url finds a window of that name that is already open, without reloading it
    let w = null;
    try { w = window.open('', name, feat); } catch (e) { w = null; }
    if (!w) { window.open(SCREENS[k].url, name); return; }   // popups blocked: a tab
    let blank = true;
    try { blank = w.location.href === 'about:blank'; } catch (e) { blank = false; }
    if (blank) { const u = new URL(SCREENS[k].url, location.href); u.searchParams.set('fs', '1'); w.location.href = u.href; }
    else if (s) { try { w.moveTo(s.availLeft, s.availTop); w.resizeTo(s.availWidth, s.availHeight); } catch (e) { /* the browser keeps it where it is */ } }
    wins[k] = w;
    w.focus();
    mark();
  }
  function mark() { bar.querySelectorAll('[data-launch]').forEach((b) => { const w = wins[b.dataset.launch]; b.classList.toggle('open', !!(w && !w.closed)); }); }
  setInterval(mark, 2000);
  bar.addEventListener('click', (e) => { const b = e.target.closest('[data-launch]'); if (b) open(b.dataset.launch); });
})();
