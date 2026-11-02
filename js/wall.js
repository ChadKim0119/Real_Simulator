/* One-screen demo wall (wall.html) for a 21:9 or 63:9 display: the cockpit,
 * the head unit, the data flow monitor, the conversation and the support
 * center (CCW) as panels on one canvas, laid out for the ratio and movable.
 *
 *   wall.html?ratio=21 | 63      start with that ratio (also set from control.html)
 *   E  edit layout (drag to move, corner to resize, R to reset)   L  labels   F  full screen
 *
 * The cockpit panel runs the vehicle and the e-Care director, so open one
 * wall per show. Layouts are kept per ratio in this browser and sent to
 * the other open walls through Link. */
(function () {
  'use strict';

  const E = window.ECare;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const { H, RATIO, PANELS, DEFAULTS } = window.WallDef;
  const SNAP = 20;

  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const q = new URLSearchParams(location.search);
  let ratio = RATIO[q.get('ratio')] ? +q.get('ratio') : store.get('wall-ratio', 21);
  let labels = store.get('wall-labels', false);
  let edit = false;
  const layoutOf = window.WallDef.layoutOf;
  let layout = layoutOf(ratio);

  /* ---------------- panels ---------------- */
  const canvas = $('#canvas'), host = $('#panels');
  const frames = {};
  for (const k in PANELS) {
    const p = document.createElement('div');
    p.className = 'panel';
    p.dataset.k = k;
    p.innerHTML = `<iframe src="${PANELS[k].src}" title="${esc(PANELS[k].t)}" allow="autoplay; fullscreen"></iframe>
      <span class="tag">${esc(PANELS[k].t)}</span><div class="grab"><b>${esc(PANELS[k].t)}</b><small></small><i class="rs"></i></div>`;
    host.appendChild(p);
    frames[k] = p;
  }

  function fit() {
    const W = RATIO[ratio].w;
    const k = Math.min(innerWidth / W, innerHeight / H);
    canvas.style.width = `${W}px`;
    canvas.style.transform = `translate(${(innerWidth - W * k) / 2}px, ${(innerHeight - H * k) / 2}px) scale(${k})`;
    canvas.dataset.k = k;
  }
  function place() {
    for (const k in frames) {
      const [x, y, w, h] = layout[k];
      Object.assign(frames[k].style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      $('small', frames[k]).textContent = `${w} × ${h}`;
    }
  }
  function render() {
    fit();
    place();
    document.body.classList.toggle('labels', labels);
    document.body.classList.toggle('edit', edit);
    document.querySelectorAll('[data-ratio]').forEach((b) => b.classList.toggle('on', +b.dataset.ratio === ratio));
    $('[data-edit]').classList.toggle('on', edit);
    $('[data-labels]').classList.toggle('on', labels);
    $('#hint').textContent = edit ? '끌어서 이동 · 모서리로 크기 · R 기본 배치 · E 끝내기' : `${RATIO[ratio].name} · E 배치 편집 · L 라벨 · F 전체화면`;
  }
  addEventListener('resize', fit);

  function setRatio(r, quiet) {
    if (!RATIO[r] || r === ratio) return;
    ratio = r;
    store.set('wall-ratio', r);
    layout = layoutOf(r);
    render();
    if (!quiet) Link.send('wall', { ratio });
  }
  function save(quiet) {
    store.set(`wall-layout-${ratio}`, layout);
    if (!quiet) Link.send('wall', { ratio, layout });
  }

  /* ---------------- editing ---------------- */
  let drag = null;
  host.addEventListener('pointerdown', (e) => {
    if (!edit) return;
    const p = e.target.closest('.panel');
    if (!p) return;
    e.preventDefault();
    host.appendChild(p);                                   // bring to front while moving
    drag = { k: p.dataset.k, resize: e.target.classList.contains('rs'), x: e.clientX, y: e.clientY, r: layout[p.dataset.k].slice() };
    p.setPointerCapture(e.pointerId);
  });
  host.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const s = +canvas.dataset.k || 1;
    const dx = (e.clientX - drag.x) / s, dy = (e.clientY - drag.y) / s;
    const snap = (v) => Math.round(v / SNAP) * SNAP;
    const W = RATIO[ratio].w;
    let [x, y, w, h] = drag.r;
    if (drag.resize) { w = Math.max(240, Math.min(W - x, snap(w + dx))); h = Math.max(160, Math.min(H - y, snap(h + dy))); }
    else { x = Math.max(0, Math.min(W - w, snap(x + dx))); y = Math.max(0, Math.min(H - h, snap(y + dy))); }
    layout[drag.k] = [x, y, w, h];
    place();
  });
  host.addEventListener('pointerup', () => { if (drag) { drag = null; save(); } });

  function reset() {
    layout = Object.assign({}, DEFAULTS[ratio]);
    store.set(`wall-layout-${ratio}`, {});
    place();
    Link.send('wall', { ratio, layout });
  }

  /* ---------------- controls ---------------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#bar button');
    if (!b) return;
    if (b.dataset.ratio) setRatio(+b.dataset.ratio);
    else if ('edit' in b.dataset) { edit = !edit; render(); }
    else if ('labels' in b.dataset) { labels = !labels; store.set('wall-labels', labels); render(); Link.send('wall', { labels }); }
    else if ('fs' in b.dataset) fullscreen();
  });
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyE') { edit = !edit; render(); }
    if (e.code === 'KeyL') { labels = !labels; store.set('wall-labels', labels); render(); }
    if (e.code === 'KeyF') fullscreen();
    if (e.code === 'KeyR' && edit) reset();
  });
  let barT = 0;
  addEventListener('mousemove', () => { document.body.classList.add('cur'); clearTimeout(barT); barT = setTimeout(() => document.body.classList.remove('cur'), 2500); });

  // the control panel (or another wall) changes ratio, layout, labels, editing
  Link.on('wall', (d) => {
    if (d.ratio && d.ratio !== ratio) setRatio(d.ratio, true);
    if (d.layout && (d.ratio || ratio) === ratio) { layout = Object.assign({}, DEFAULTS[ratio], d.layout); save(true); place(); }
    if (d.reset) reset();
    if (typeof d.labels === 'boolean') { labels = d.labels; store.set('wall-labels', labels); render(); }
    if (typeof d.edit === 'boolean') { edit = d.edit; render(); }
  });
  Link.on('wall-hello', () => Link.send('wall-state', { ratio, labels, edit }));
  Link.send('wall-state', { ratio, labels, edit });

  /* ---------------- scenes: opening / closing over the whole wall ---------------- */
  let snap = null, scene = 'live';
  Link.on('ecare', (d) => { snap = d; if (scene === 'closing') sceneRender(); });
  Link.on('stage', (d) => { if (d.scene !== scene) { scene = d.scene; sceneRender(); } });
  Link.send('stage-hello', { screen: 'wall' });
  const pad = (n) => String(n).padStart(2, '0');
  const rel = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
  function closing() {
    const c = snap && (snap.cases.slice().reverse().find((x) => x.wcase === 'A') || snap.cases[snap.cases.length - 1]);
    const fl = (snap && snap.flows) || [];
    let kpi = ['—', '—', '—'];
    if (c) {
      const skips = fl.filter((f) => f.type === 'skip' && f.caseId === c.id).map((f) => f.t);
      const at = (t) => t - c.at + skips.filter((x) => x <= t).length * 25 * 60000;
      const find = (fn) => fl.find((f) => !f.type && f.caseId === c.id && fn(f));
      const reach = find((f) => f.to === 'ccw' || f.api === 'WAM-EVT-001');
      const memo = find((f) => f.api === 'WAM-MEMO-001');
      kpi = [reach ? `${((reach.t - c.at) / 1000).toFixed(1)}초` : '—', c.call && c.call.connectedAt ? rel(at(c.call.connectedAt)) : '—', memo ? rel(at(memo.t)) : '—'];
    }
    return `<div class="cl"><h2>e-Care 시연 요약</h2><div class="kpis">
      <div><b>${kpi[0]}</b><span>경고 → 고객지원실 · 서비스센터 도달</span></div>
      <div><b>${kpi[1]}</b><span>경고 → 고객 통화 연결</span></div>
      <div><b>${kpi[2]}</b><span>경고 → 서비스센터 이관</span></div></div>
      <p>고객 차량 · 일본측 서버 [VDP] · 한국측 서버 [TSP] · e-Care 고객지원실 · 긴급출동 · 서비스센터</p><div class="thanks">감사합니다</div></div>`;
  }
  function sceneRender() {
    const el = $('#scene');
    el.className = scene === 'live' ? '' : `on ${scene}`;
    el.innerHTML = scene === 'opening' ? '<div class="op"><small>TOYOTA · LEXUS CONNECT</small><b>Global South</b><span>개발 진척 보고회 · e-Care</span></div>'
      : scene === 'closing' ? closing() : '';
  }

  render();
  sceneRender();
})();
