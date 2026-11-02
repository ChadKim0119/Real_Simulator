/* One-screen demo wall (wall.html) for a 21:9 display (2560x1080): the car
 * (cockpit with the head unit in the centre display), the data flow, the
 * conversation and the support center (CCW) as four tiled panels.
 *
 *   E  edit layout: drag a split to resize (neighbours give way, splits snap
 *      to each panel's own ratio), drag a panel onto another to swap, R reset
 *   L  labels   F  full screen
 *
 * The car panel runs the vehicle and the e-Care director, so open one wall
 * per show. The layout is kept in this browser and sent to other screens. */
(function () {
  'use strict';

  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const { W, H, PANELS, DEFAULT } = window.WallDef;
  const SNAP = 10, MAGNET = 28, MIN = 220;
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  let L = window.WallDef.load();
  let labels = store.get('wall-labels', false);
  let edit = false;

  /* ---------------- panels ---------------- */
  const canvas = $('#canvas'), host = $('#panels');
  canvas.style.width = `${W}px`;
  const frames = {};
  for (const k in PANELS) {
    const p = document.createElement('div');
    p.className = 'panel';
    p.dataset.k = k;
    p.innerHTML = `<iframe src="${PANELS[k].src}" title="${esc(PANELS[k].t)}" allow="autoplay; fullscreen"></iframe>
      <span class="tag">${esc(PANELS[k].t)}</span><div class="grab"><b>${esc(PANELS[k].t)}</b><small></small><em>끌어서 다른 패널과 자리 바꾸기</em></div>`;
    host.appendChild(p);
    frames[k] = p;
  }
  // split handles (edit mode)
  const splits = { cx: 'v', ly: 'h', ry: 'h' };
  for (const k in splits) {
    const d = document.createElement('div');
    d.className = `split ${splits[k]}`;
    d.dataset.s = k;
    d.innerHTML = '<i></i><span class="badge"></span>';
    host.appendChild(d);
  }

  let scale = 1;
  function fit() {
    scale = Math.min(innerWidth / W, innerHeight / H);
    canvas.style.transform = `translate(${(innerWidth - W * scale) / 2}px, ${(innerHeight - H * scale) / 2}px) scale(${scale})`;
    ratioNotice();
  }
  const ratioText = (w, h) => `${(w / h).toFixed(2)}:1`;
  function place() {
    const R = window.WallDef.rects(L);
    for (const k in frames) {
      const [x, y, w, h] = R[k];
      Object.assign(frames[k].style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      const ideal = PANELS[k].ideal;
      const ok = !ideal || Math.abs(w / h - ideal) / ideal < 0.04;
      $('small', frames[k]).innerHTML = `${w} × ${h} · ${ratioText(w, h)}${ideal ? ` <span class="${ok ? 'ok' : 'off'}">권장 ${ratioText(ideal, 1)} ${ok ? '✓' : ''}</span>` : ''}`;
    }
    const s = host.querySelectorAll('.split');
    Object.assign(s[0].style, { left: `${L.cx - 9}px`, top: '0px', width: '18px', height: `${H}px` });
    Object.assign(s[1].style, { left: '0px', top: `${L.ly - 9}px`, width: `${L.cx}px`, height: '18px' });
    Object.assign(s[2].style, { left: `${L.cx}px`, top: `${L.ry - 9}px`, width: `${W - L.cx}px`, height: '18px' });
  }
  function render() {
    fit();
    place();
    document.body.classList.toggle('labels', labels);
    document.body.classList.toggle('edit', edit);
    $('[data-edit]').classList.toggle('on', edit);
    $('[data-labels]').classList.toggle('on', labels);
    $('#hint').textContent = edit ? '경계선을 끌어 크기 조절 (옆 패널이 함께 줄어듦 · 권장 비율에 자석처럼 붙음) · 패널을 끌어 자리 바꾸기 · R 기본 배치 · E 끝내기' : '21:9 · E 배치 편집 · L 라벨 · F 전체화면';
  }
  addEventListener('resize', fit);

  /* If the Mac sends a 16:9 picture to a 21:9 display, the display stretches it
   * sideways and every letter looks wide. Say so when the window fills the
   * screen at another ratio. */
  function ratioNotice() {
    const full = document.fullscreenElement || (Math.abs(innerWidth - screen.width) < 4 && Math.abs(innerHeight - screen.height) < 60);
    const r = screen.width / screen.height;
    const off = full && Math.abs(r - W / H) / (W / H) > 0.04 && !noticeHidden;
    const n = $('#notice');
    n.classList.toggle('on', off);
    if (off) n.innerHTML = `<b>출력 비율이 21:9가 아닙니다</b> · 지금 ${screen.width}×${screen.height} (${r.toFixed(2)}:1). 디스플레이가 이 화면을 가로로 늘리면 글자가 넓적하게 보입니다 — 맥 <em>시스템 설정 › 디스플레이</em>에서 해상도를 <em>2560×1080</em>(또는 디스플레이 고유 21:9 해상도)으로 선택하세요. 16:9 모니터로 리허설 중이면 위아래 여백은 정상입니다 <em>(클릭하면 닫힘)</em>.`;
  }
  document.addEventListener('fullscreenchange', fit);
  // rehearsing on a 16:9 monitor: a click on the notice hides it for this session
  let noticeHidden = false;
  $('#notice').addEventListener('click', () => { noticeHidden = true; ratioNotice(); });

  function commit(quiet) {
    window.WallDef.save(L);
    place();
    if (!quiet) Link.send('wall', { layout: L });
  }

  /* ---------------- editing: splits ---------------- */
  // positions of a split where one of the panels next to it reaches its own ratio
  function magnets(k) {
    const S = L.slots, r = (slot) => PANELS[S[slot]].ideal;
    const out = [];
    const add = (v, slot) => { const id = r(slot); if (id) out.push({ v, label: `${PANELS[S[slot]].t} ${ratioText(id, 1)}` }); };
    if (k === 'cx') {
      if (r('lt')) add(r('lt') * L.ly, 'lt');
      if (r('lb')) add(r('lb') * (H - L.ly), 'lb');
      if (r('rt')) add(W - r('rt') * L.ry, 'rt');
      if (r('rb')) add(W - r('rb') * (H - L.ry), 'rb');
    } else {
      const left = k === 'ly', w = left ? L.cx : W - L.cx, top = left ? 'lt' : 'rt', bot = left ? 'lb' : 'rb';
      if (r(top)) add(w / r(top), top);
      if (r(bot)) add(H - w / r(bot), bot);
      out.push({ v: left ? L.ry : L.ly, label: '다른 쪽 행과 정렬' });
    }
    return out;
  }
  let drag = null;
  host.addEventListener('pointerdown', (e) => {
    if (!edit) return;
    const sp = e.target.closest('.split');
    const p = e.target.closest('.panel');
    if (!sp && !p) return;
    e.preventDefault();
    const el = sp || p;
    el.setPointerCapture(e.pointerId);
    drag = sp ? { split: sp.dataset.s, el: sp } : { panel: p.dataset.k, el: p, x: e.clientX, y: e.clientY };
    if (p) p.classList.add('lift');
  });
  host.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect();
    const cx = (e.clientX - r.left) / scale, cy = (e.clientY - r.top) / scale;
    if (drag.split) {
      const k = drag.split;
      const lo = MIN, hi = (k === 'cx' ? W : H) - MIN;
      let v = Math.max(lo, Math.min(hi, Math.round((k === 'cx' ? cx : cy) / SNAP) * SNAP));
      let hit = null;
      for (const m of magnets(k)) if (Math.abs(m.v - v) < MAGNET && m.v >= lo && m.v <= hi && (!hit || Math.abs(m.v - v) < Math.abs(hit.v - v))) hit = m;
      if (hit) v = Math.round(hit.v);
      L[k] = v;
      const b = $('.badge', drag.el);
      b.textContent = hit ? `⦿ ${hit.label}` : '';
      drag.el.classList.toggle('snapped', !!hit);
      place();
    } else {
      // swapping: highlight the panel under the pointer
      const R = window.WallDef.rects(L);
      let over = null;
      for (const k in R) { const [x, y, w, h] = R[k]; if (k !== drag.panel && cx >= x && cx <= x + w && cy >= y && cy <= y + h) over = k; }
      for (const k in frames) frames[k].classList.toggle('target', k === over);
      drag.over = over;
      drag.el.style.translate = `${(e.clientX - drag.x) / scale}px ${(e.clientY - drag.y) / scale}px`;
    }
  });
  host.addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.split) { drag.el.classList.remove('snapped'); $('.badge', drag.el).textContent = ''; }
    else {
      drag.el.classList.remove('lift');
      drag.el.style.translate = '';
      for (const k in frames) frames[k].classList.remove('target');
      if (drag.over) {
        const S = L.slots, a = Object.keys(S).find((s) => S[s] === drag.panel), b = Object.keys(S).find((s) => S[s] === drag.over);
        [S[a], S[b]] = [S[b], S[a]];
      }
    }
    drag = null;
    commit();
  });

  function reset() { L = JSON.parse(JSON.stringify(DEFAULT)); commit(); }

  /* ---------------- controls ---------------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#bar button');
    if (!b) return;
    if ('edit' in b.dataset) { edit = !edit; render(); Link.send('wall-state', { edit, labels }); }
    else if ('labels' in b.dataset) { labels = !labels; store.set('wall-labels', labels); render(); Link.send('wall-state', { edit, labels }); }
    else if ('reset' in b.dataset) reset();
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

  // the control panel (or another wall) changes layout, labels, editing
  Link.on('wall', (d) => {
    if (d.layout) { L = d.layout; window.WallDef.save(L); place(); }
    if (d.reset) reset();
    if (typeof d.labels === 'boolean') { labels = d.labels; store.set('wall-labels', labels); render(); }
    if (typeof d.edit === 'boolean') { edit = d.edit; render(); }
  });
  Link.on('wall-hello', () => Link.send('wall-state', { labels, edit }));
  Link.send('wall-state', { labels, edit });

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
