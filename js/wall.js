/* One-screen demo wall (wall.html): the car (cockpit with the head unit in
 * the centre display), the data flow, the conversation and the support center
 * (CCW) as four tiled panels, for a 21:9 (2560x1080) or 16:9 (1920x1080)
 * display. The mode is chosen on a first screen (or ?mode=21 / ?mode=169),
 * and can be changed from the top bar or the control panel.
 *
 *   E  edit layout: drag a split to resize (neighbours give way, splits snap
 *      to each panel's own ratio), drag a panel onto another to swap, R reset
 *   M  screen mode   L  labels   F  full screen
 *
 * The car panel runs the vehicle and the e-Care director, so open one wall
 * per show. Layouts are kept per mode in this browser and sent to other screens. */
(function () {
  'use strict';

  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const D = window.WallDef;
  const { H, PANELS, MODES } = D;
  const SNAP = 10, MAGNET = 28, MIN = 220;
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  let mode = D.mode();
  let W = MODES[mode || '21'].W;
  let L = D.load(mode || '21');
  let labels = store.get('wall-labels', false);
  let edit = false;

  /* ---------------- panels ---------------- */
  const canvas = $('#canvas'), host = $('#panels');
  const frames = {};
  for (const k in PANELS) {
    const p = document.createElement('div');
    p.className = 'panel';
    p.dataset.k = k;
    p.innerHTML = `<span class="tag">${esc(PANELS[k].t)}</span><div class="grab"><b>${esc(PANELS[k].t)}</b><small></small><em>끌어서 다른 패널과 자리 바꾸기</em></div>`;
    host.appendChild(p);
    frames[k] = p;
  }
  // the pages load once a mode is chosen (the car page runs the director)
  function loadPages() {
    for (const k in frames) {
      if ($('iframe', frames[k])) continue;
      const f = document.createElement('iframe');
      f.src = PANELS[k].src; f.title = PANELS[k].t; f.allow = 'autoplay; fullscreen';
      frames[k].prepend(f);
    }
  }
  // split handles (edit mode): the outer split and one inner split per part
  for (const k of ['o', 'i0', 'i1', 'i2']) {
    const d = document.createElement('div');
    d.className = 'split';
    d.dataset.s = k;
    d.innerHTML = '<i></i><span class="badge"></span>';
    host.appendChild(d);
  }

  let scale = 1;
  function fit() {
    canvas.style.width = `${W}px`;
    scale = Math.min(innerWidth / W, innerHeight / H);
    canvas.style.transform = `translate(${(innerWidth - W * scale) / 2}px, ${(innerHeight - H * scale) / 2}px) scale(${scale})`;
    ratioNotice();
  }
  const ratioText = (w, h) => `${(w / h).toFixed(2)}:1`;
  const cols = () => L.dir === 'cols';
  function place() {
    const R = D.rects(L, mode || '21');
    for (const k in frames) {
      const [x, y, w, h] = R[k];
      Object.assign(frames[k].style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      const ideal = PANELS[k].ideal;
      const ok = !ideal || Math.abs(w / h - ideal) / ideal < 0.04;
      $('small', frames[k]).innerHTML = `${w} × ${h} · ${ratioText(w, h)}${ideal ? ` <span class="${ok ? 'ok' : 'off'}">권장 ${ratioText(ideal, 1)} ${ok ? '✓' : ''}</span>` : ''}`;
    }
    const [o, a, b, c2] = host.querySelectorAll('.split');
    const V = (el, x, y, h) => { el.className = 'split v'; Object.assign(el.style, { left: `${x - 9}px`, top: `${y}px`, width: '18px', height: `${h}px` }); };
    const Hh = (el, x, y, w) => { el.className = 'split h'; Object.assign(el.style, { left: `${x}px`, top: `${y - 9}px`, width: `${w}px`, height: '18px' }); };
    if (L.dir === 'wide') { V(a, L.i0, 0, H); V(b, L.i1, 0, H); V(o, L.o, 0, H); Hh(c2, L.o, L.i2, W - L.o); }
    else if (cols()) { V(o, L.o, 0, H); Hh(a, 0, L.i0, L.o); Hh(b, L.o, L.i1, W - L.o); V(c2, L.i2, L.i0, H - L.i0); }
    else { Hh(o, 0, L.o, W); V(a, L.i0, 0, L.o); V(b, L.i1, L.o, H - L.o); V(c2, L.i2, L.o, H - L.o); }
  }
  function render() {
    fit();
    place();
    document.body.classList.toggle('labels', labels);
    document.body.classList.toggle('edit', edit);
    $('[data-edit]').classList.toggle('on', edit);
    $('[data-labels]').classList.toggle('on', labels);
    $('[data-mode]').textContent = `화면 ${MODES[mode || '21'].name}`;
    $('#hint').textContent = edit ? '경계선을 끌어 크기 조절 (옆 패널이 함께 줄어듦 · 권장 비율에 자석처럼 붙음) · 패널을 끌어 자리 바꾸기 · R 기본 배치 · E 끝내기' : `${MODES[mode || '21'].name} · M 화면 모드 · E 배치 편집 · L 라벨 · F 전체화면`;
  }
  addEventListener('resize', fit);

  /* If the Mac sends a picture of another ratio than the chosen mode (a 16:9
   * picture on a 21:9 display gets stretched sideways), say so when the
   * window fills the screen. */
  let noticeHidden = false;
  function ratioNotice() {
    const n = $('#notice');
    const full = document.fullscreenElement || (Math.abs(innerWidth - screen.width) < 4 && Math.abs(innerHeight - screen.height) < 60);
    const r = screen.width / screen.height;
    const off = mode && full && Math.abs(r - W / H) / (W / H) > 0.04 && !noticeHidden;
    n.classList.toggle('on', !!off);
    if (off) n.innerHTML = `<b>화면 모드(${MODES[mode].name})와 출력 비율이 다릅니다</b> · 지금 ${screen.width}×${screen.height} (${r.toFixed(2)}:1). 위아래나 좌우에 여백이 생깁니다. ${Math.abs(r - 16 / 9) < 0.05 ? '이 출력에는 <em>16:9 모드</em>가 맞습니다' : Math.abs(r - 2560 / 1080) < 0.1 ? '이 출력에는 <em>21:9 모드</em>가 맞습니다' : Math.abs(r - 7) < 0.3 ? '이 출력에는 <em>63:9 모드</em>가 맞습니다' : ''}${mode === '21' && Math.abs(r - 16 / 9) < 0.05 ? ' — 21:9 디스플레이라면 맥 <em>시스템 설정 › 디스플레이</em>에서 2560×1080을 고르세요 (16:9로 나가면 디스플레이가 가로로 늘려 글자가 넓적해집니다)' : ''}. <em>M</em> 화면 모드 · 클릭하면 닫힘`;
  }
  document.addEventListener('fullscreenchange', fit);
  $('#notice').addEventListener('click', () => { noticeHidden = true; ratioNotice(); });

  function commit(quiet) {
    D.save(mode, L);
    place();
    if (!quiet) Link.send('wall', { mode, layout: L });
  }

  /* ---------------- screen mode ---------------- */
  function setMode(m, quiet) {
    if (!MODES[m]) return;
    const changed = m !== mode;
    mode = m;
    D.setMode(m);
    W = MODES[m].W;
    L = D.load(m);
    $('#modes').classList.remove('on');
    document.body.classList.remove('modes-open');
    loadPages();
    render();
    if (!quiet && changed) Link.send('wall', { mode: m });
  }
  // the first screen: pick 21:9, 16:9 or 63:9 (a miniature of each layout, the detected screen)
  function modeScreen() {
    const r = screen.width / screen.height;
    const best = Math.abs(r - 16 / 9) < 0.05 ? '169' : r > 5 ? '63' : r > 2.2 ? '21' : null;
    const mini = (m) => {
      const R = D.rects(D.load(m), m), w = MODES[m].W;
      return `<div class="mini" style="aspect-ratio:${w}/${H}">${Object.keys(R).map((k) => { const [x, y, ww, hh] = R[k]; return `<i style="left:${x / w * 100}%;top:${y / H * 100}%;width:${ww / w * 100}%;height:${hh / H * 100}%"><span>${esc(PANELS[k].t)}</span></i>`; }).join('')}</div>`;
    };
    const el = $('#modes');
    el.innerHTML = `<div class="box"><h1>시연 화면 모드</h1><p>이 화면(${screen.width}×${screen.height} · ${r.toFixed(2)}:1)에 맞는 모드를 고르세요. 나중에 위쪽 막대나 컨트롤 패널, <b>M</b> 키로 바꿀 수 있습니다.</p>
      <div class="opts">${['21', '169', '63'].map((m) => `<button data-pick="${m}" class="${m === best ? 'best' : ''} ${m === mode ? 'cur' : ''}">${mini(m)}<b>${MODES[m].name}</b><span>${MODES[m].desc}</span>${m === best ? '<em>이 화면에 맞음</em>' : ''}</button>`).join('')}</div></div>`;
    el.classList.add('on');
    document.body.classList.add('modes-open');
  }
  $('#modes').addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) setMode(b.dataset.pick); });

  /* ---------------- editing: splits ---------------- */
  // positions of a split where a panel next to it reaches its own ratio (found
  // numerically for any layout), and the line of the other part's inner split
  // does split k move along x, and how far may it go (63:9: the column splits keep their order)
  const horizOf = (k) => (L.dir === 'wide' ? k !== 'i2' : k === 'o' ? cols() : k === 'i2' ? true : !cols());
  function bounds(k) {
    if (L.dir === 'wide') {
      if (k === 'i0') return [MIN, L.i1 - MIN];
      if (k === 'i1') return [L.i0 + MIN, L.o - MIN];
      if (k === 'o') return [L.i1 + MIN, W - MIN];
      return [MIN, H - MIN];
    }
    return [MIN, (horizOf(k) ? W : H) - MIN];
  }
  function magnets(k) {
    const [lo, hi] = bounds(k);
    const ratios = (v) => { const T = Object.assign({}, L, { [k]: v }); const R = D.rects(T, mode); return Object.keys(R).map((p) => [p, R[p][2] / R[p][3]]); };
    const out = [];
    let prev = ratios(lo);
    for (let v = lo + 4; v <= hi; v += 4) {
      const cur = ratios(v);
      cur.forEach(([p, r], i) => {
        const id = PANELS[p].ideal;
        if (!id) return;
        const a = prev[i][1] - id, b = r - id;
        if (a === b || Math.sign(a) === Math.sign(b)) return;
        out.push({ v: v - 4 + 4 * (a / (a - b)), label: `${PANELS[p].t} ${ratioText(id, 1)}` });
      });
      prev = cur;
    }
    if (L.dir !== 'wide' && (k === 'i0' || k === 'i1')) out.push({ v: k === 'i0' ? L.i1 : L.i0, label: '다른 줄과 정렬' });
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
    drag = sp ? { split: sp.dataset.s, el: sp, mags: magnets(sp.dataset.s) } : { panel: p.dataset.k, el: p, x: e.clientX, y: e.clientY };
    if (p) p.classList.add('lift');
  });
  host.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect();
    const cx = (e.clientX - r.left) / scale, cy = (e.clientY - r.top) / scale;
    if (drag.split) {
      const k = drag.split;
      const horiz = horizOf(k);   // the split moves along x
      const [lo, hi] = bounds(k);
      let v = Math.max(lo, Math.min(hi, Math.round((horiz ? cx : cy) / SNAP) * SNAP));
      let hit = null;
      for (const m of drag.mags) if (Math.abs(m.v - v) < MAGNET && m.v >= lo && m.v <= hi && (!hit || Math.abs(m.v - v) < Math.abs(hit.v - v))) hit = m;
      if (hit) v = Math.round(hit.v);
      L[k] = v;
      const b = $('.badge', drag.el);
      b.textContent = hit ? `⦿ ${hit.label}` : '';
      drag.el.classList.toggle('snapped', !!hit);
      place();
      drag.el.classList.toggle('snapped', !!hit);
    } else {
      // swapping: highlight the panel under the pointer
      const R = D.rects(L, mode);
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

  function reset() { L = JSON.parse(JSON.stringify(MODES[mode].layout)); commit(); }

  /* ---------------- controls ---------------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#bar button');
    if (!b) return;
    if ('edit' in b.dataset) { edit = !edit; render(); Link.send('wall-state', { edit, labels, mode }); }
    else if ('labels' in b.dataset) { labels = !labels; store.set('wall-labels', labels); render(); Link.send('wall-state', { edit, labels, mode }); }
    else if ('reset' in b.dataset) reset();
    else if ('mode' in b.dataset) modeScreen();
    else if ('fs' in b.dataset) fullscreen();
  });
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyE') { edit = !edit; render(); }
    if (e.code === 'KeyL') { labels = !labels; store.set('wall-labels', labels); render(); }
    if (e.code === 'KeyF') fullscreen();
    if (e.code === 'KeyM') modeScreen();
    if (e.code === 'KeyR' && edit) reset();
  });
  let barT = 0;
  // the bar shows with the pointer, or a tap on a touch screen (phones and tablets have no hover)
  const showBar = (ms) => { document.body.classList.add('cur'); clearTimeout(barT); barT = setTimeout(() => document.body.classList.remove('cur'), ms); };
  addEventListener('mousemove', () => showBar(2500));
  addEventListener('touchstart', () => showBar(4000), { passive: true });

  // the control panel (or another wall) changes layout, labels, editing
  Link.on('wall', (d) => {
    if (d.mode && d.mode !== mode) setMode(d.mode, true);
    if (d.layout && (!d.mode || d.mode === mode)) { L = d.layout; D.save(mode, L); place(); }
    if (d.reset) reset();
    if (typeof d.labels === 'boolean') { labels = d.labels; store.set('wall-labels', labels); render(); }
    if (typeof d.edit === 'boolean') { edit = d.edit; render(); }
  });
  Link.on('wall-hello', () => Link.send('wall-state', { labels, edit, mode, layout: mode ? L : null }));
  Link.send('wall-state', { labels, edit, mode, layout: mode ? L : null });

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
    // opening: three lines over e-Care's key colours drifting slowly behind
    el.innerHTML = scene === 'opening' ? '<div class="aur" aria-hidden="true"><i class="a1"></i><i class="a2"></i><i class="a3"></i><i class="a4"></i></div>'
        + '<div class="op"><b>Real Simulator 시연</b><span>e-Care에 대한 고객의 경험 여정 및 업무 flow</span><small>본 시연에 사용되는 화면, 이미지, UI 디자인은 일부 변경될 수 있습니다.</small></div>'
      : scene === 'closing' ? closing() : '';
  }

  render();
  sceneRender();
  if (mode) loadPages(); else modeScreen();
})();
