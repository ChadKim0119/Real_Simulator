/* One-screen demo wall (wall.html): the car (cockpit with the head unit in
 * the centre display), the data flow, the support center (CCW), the service
 * center DMS and the conversation as five tiled panels, for a 21:9 (2560x1080),
 * 16:9 (1920x1080) or 63:9 (7560x1080) display. The mode is chosen on a first
 * screen (or ?mode=21 / 169 / 63),
 * and can be changed from the top bar or the control panel.
 *
 *   E  edit layout: drag a split to resize (neighbours give way, splits snap
 *      to each panel's own ratio), drag a panel onto another to swap (the
 *      splits then move so both keep their ratio), R reset
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
    p.innerHTML = `<span class="tag">${esc(PANELS[k].t)}</span><div class="grab"><b>${esc(PANELS[k].t)}</b><small></small></div>`;
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
  // split handles (edit mode): one per cut of the layout tree, made as needed
  const handles = {};
  function handle(id) {
    if (handles[id]) return handles[id];
    const d = document.createElement('div');
    d.className = 'split';
    d.dataset.s = id;
    d.innerHTML = '<i></i><span class="badge"></span>';
    host.appendChild(d);
    return (handles[id] = d);
  }

  let scale = 1;
  function fit() {
    canvas.style.width = `${W}px`;
    scale = Math.min(innerWidth / W, innerHeight / H);
    canvas.style.transform = `translate(${(innerWidth - W * scale) / 2}px, ${(innerHeight - H * scale) / 2}px) scale(${scale})`;
    ratioNotice();
  }
  const ratioText = (w, h) => `${(w / h).toFixed(2)}:1`;
  function place() {
    const R = D.rects(L, mode || '21');
    for (const k in frames) {
      const [x, y, w, h] = R[k];
      Object.assign(frames[k].style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      const ideal = PANELS[k].ideal;
      const ok = !ideal || Math.abs(w / h - ideal) / ideal < 0.04;
      $('small', frames[k]).innerHTML = `${w} × ${h} · ${ratioText(w, h)}${ideal ? ` <span class="${ok ? 'ok' : 'off'}">권장 ${ratioText(ideal, 1)} ${ok ? '✓' : ''}</span>` : ''}`;
    }
    const C = D.cuts(L, mode || '21'), live = new Set();
    for (const c of C) {
      const el = handle(c.id);
      live.add(c.id);
      const [x0, y0, x1, y1] = c.r;
      el.style.display = '';
      if (c.d === 'x') { el.className = 'split v'; Object.assign(el.style, { left: `${c.at - 9}px`, top: `${y0}px`, width: '18px', height: `${y1 - y0}px` }); }
      else { el.className = 'split h'; Object.assign(el.style, { left: `${x0}px`, top: `${c.at - 9}px`, width: `${x1 - x0}px`, height: '18px' }); }
    }
    for (const id in handles) if (!live.has(id)) handles[id].style.display = 'none';
  }
  function render() {
    fit();
    place();
    document.body.classList.toggle('labels', labels);
    document.body.classList.toggle('edit', edit);
    $('[data-edit]').classList.toggle('on', edit);
    $('[data-labels]').classList.toggle('on', labels);
    $('[data-mode]').textContent = `화면 ${MODES[mode || '21'].name}`;
    $('#hint').textContent = edit ? 'R 기본 배치 · E 끝내기' : `${MODES[mode || '21'].name} · M 화면 모드 · E 배치 편집 · L 라벨 · F 전체화면`;
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
    if (typeof sceneRender === 'function' && scene !== 'live') { sceneShown = ''; sceneRender(); }
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
  // positions of a cut where a panel next to it reaches its own ratio (found
  // numerically), and the other cuts along the same axis to line up with
  const cutOf = (id) => D.cuts(L, mode).find((c) => c.id === id);
  function magnets(id) {
    const c = cutOf(id);
    if (!c) return [];
    const n = c.node, keep = n.at;
    const ratios = () => { const R = D.rects(L, mode); return Object.keys(R).map((p) => [p, R[p][2] / R[p][3]]); };
    const out = [];
    n.at = c.lo;
    let prev = ratios();
    for (let v = c.lo + 4; v <= c.hi; v += 4) {
      n.at = v;
      const cur = ratios();
      cur.forEach(([p, r], i) => {
        const idl = PANELS[p].ideal;
        if (!idl) return;
        const a = prev[i][1] - idl, b = r - idl;
        if (a === b || Math.sign(a) === Math.sign(b)) return;
        out.push({ v: v - 4 + 4 * (a / (a - b)), label: `${PANELS[p].t} ${ratioText(idl, 1)}` });
      });
      prev = cur;
    }
    n.at = keep;
    for (const o of D.cuts(L, mode)) if (o.id !== id && o.d === c.d && o.at > c.lo && o.at < c.hi) out.push({ v: o.at, label: '다른 경계와 정렬' });
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
      const c = cutOf(drag.split);
      if (!c) return;
      const horiz = c.d === 'x', lo = c.lo, hi = c.hi;
      let v = Math.max(lo, Math.min(hi, Math.round((horiz ? cx : cy) / SNAP) * SNAP));
      let hit = null;
      for (const m of drag.mags) if (Math.abs(m.v - v) < MAGNET && m.v >= lo && m.v <= hi && (!hit || Math.abs(m.v - v) < Math.abs(hit.v - v))) hit = m;
      if (hit) v = Math.round(hit.v);
      c.node.at = v;
      D.normalize(L, mode);
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
      // swap the two panels; the cuts move so each keeps its own ratio and size
      if (drag.over) L = D.swap(L, mode, drag.panel, drag.over);
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
    if (d.layout && D.valid(d.layout) && (!d.mode || d.mode === mode)) { L = D.normalize(d.layout, mode); D.save(mode, L); place(); }
    if (d.reset) reset();
    if (typeof d.labels === 'boolean') { labels = d.labels; store.set('wall-labels', labels); render(); }
    if (typeof d.edit === 'boolean') { edit = d.edit; render(); }
  });
  Link.on('wall-hello', () => Link.send('wall-state', { labels, edit, mode, layout: mode ? L : null }));
  Link.send('wall-state', { labels, edit, mode, layout: mode ? L : null });

  /* ---------------- scenes: opening / closing over the whole wall ---------------- */
  let snap = null, scene = 'live';
  Link.on('ecare', (d) => { snap = d; if (scene === 'closing') sceneRender(); finCheck(d); });
  /* the e-Care task is done (the repair closed in DMS): a short, solemn ceremony over the
   * whole wall so the room sees that the journey has ended. Cases already closed when the
   * wall opens do not replay it. */
  const finSeen = new Set();
  let finFirst = true, finT = 0;
  function finCheck(d) {
    for (const c of d.cases || []) {
      if (c.dms >= 7 && !finSeen.has(c.id)) { finSeen.add(c.id); if (!finFirst) ceremony(c); }
      if (c.dms < 7) finSeen.delete(c.id);        // [이전] went back before the close
    }
    if (!(d.cases || []).length) finSeen.clear();
    finFirst = false;
  }
  function ceremony(c) {
    const el = $('#fin');
    const steps = ['경고 감지', '고객 연결', c.kind === 'emergency' ? '상담 · 긴급출동' : '경고 판정', '서비스센터 이관', '예약 · 입고', '정비 · 종결'];
    const html = `<div class="fx"><svg viewBox="0 0 200 200" class="ring"><circle cx="100" cy="100" r="86" class="bg"/><circle cx="100" cy="100" r="86" class="fg"/><path d="M64 102 L90 128 L140 76" class="ck"/></svg>
      <b>e-Care 과업 종료</b><span>${steps.map((t) => `<i>${esc(t)}</i>`).join('<em>›</em>')}</span>
      <small>${esc(c.dealer || '서비스센터')} 정비 종결 · 모든 단계가 고객 앱과 상담원 화면에 반영되었습니다</small></div>`;
    if (window.FX && FX.ceremony(el, html)) return;
    el.innerHTML = html;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    clearTimeout(finT);
    finT = setTimeout(() => el.classList.remove('on'), 8500);
  }
  Link.on('stage', (d) => { if (d.scene && d.scene !== 'live') { if (window.FX && FX.gsap) FX.stopCeremony($('#fin')); else $('#fin').classList.remove('on'); } });
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
      const reach = find((f) => f.to === 'ccw' || f.to === 'dms');
      const memo = find((f) => f.api === '상담 메모 이관');
      kpi = [reach ? `${((reach.t - c.at) / 1000).toFixed(1)}초` : '—', c.call && c.call.connectedAt ? rel(at(c.call.connectedAt)) : '—', memo ? rel(at(memo.t)) : '—'];
    }
    return `<div class="cl"><h2>e-Care 시연 요약</h2><div class="kpis">
      <div><b>${kpi[0]}</b><span>경고 → 고객지원실 · 서비스센터 도달</span></div>
      <div><b>${kpi[1]}</b><span>경고 → 고객 통화 연결</span></div>
      <div><b>${kpi[2]}</b><span>경고 → 서비스센터 이관</span></div></div>
      <p>고객 차량 · 일본측 서버 [VDP] · 한국측 서버 [TSP] · e-Care 고객지원실 · 긴급출동 · 서비스센터</p><div class="thanks">감사합니다</div></div>`;
  }
  const OPENING = '<div class="op"><b>Real Simulator 시연</b><span>e-Care에 대한 고객의 경험 여정 및 업무 flow</span><small>본 시연에 사용되는 화면, 이미지, UI 디자인은 일부 변경될 수 있습니다.</small></div>';
  let sceneShown = 'live', sceneT = 0;
  function sceneRender() {
    const el = $('#scene');
    const html = () => (scene === 'opening' ? '<div class="aur" aria-hidden="true"><i class="a1"></i><i class="a2"></i><i class="a3"></i><i class="a4"></i></div>'
        + (mode === '63' ? `<div class="op3">${OPENING.replace('class="op"', 'class="op side"')}${OPENING}${OPENING.replace('class="op"', 'class="op side"')}</div>` : OPENING)
      : scene === 'closing' ? closing() : '');
    clearTimeout(sceneT);
    // fades: in, out, and scene → scene through a short dip
    if (scene === sceneShown) { if (scene === 'closing') el.innerHTML = html(); return; }
    if (scene === 'live') { el.classList.remove('on'); sceneShown = 'live'; sceneT = setTimeout(() => { if (scene === 'live') { el.innerHTML = ''; el.className = ''; } }, 1000); return; }
    if (sceneShown === 'live') { el.className = scene; el.innerHTML = html(); void el.offsetWidth; el.classList.add('on'); sceneShown = scene; return; }
    el.classList.add('dim');
    sceneShown = scene;
    sceneT = setTimeout(() => { el.className = `${scene} on dim`; el.innerHTML = html(); void el.offsetWidth; el.classList.remove('dim'); }, 450);
  }

  render();
  sceneRender();
  if (mode) loadPages(); else modeScreen();
})();
