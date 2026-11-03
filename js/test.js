/* Monitor test mode for the demo wall (test.html), one 21:9 display.
 *
 *   test.html             console: wall preview from stills in the wall's own
 *                         layout, display size and per-panel readability,
 *                         display detection, output window, sound, checklist
 *   test.html?out=1       the output window, full screen on the display:
 *                         test pattern with the panel outlines, stills,
 *                         readability ladder, black. Follows the console.
 *
 * The layout is the wall's own (js/walldef.js), as edited on wall.html. */
(function () {
  'use strict';

  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const { H, PANELS } = window.WallDef;
  const wmode = () => window.WallDef.mode() || '21';
  const layoutOf = () => window.WallDef.rects(window.WallDef.load(wmode()), wmode());
  const OUT = new URLSearchParams(location.search).has('out');
  const app = $('#app');

  /* ---------------- shared state ---------------- */
  const DEF = { mode: 'stills', step: 0, labels: true, m: 5.0, dist: 18 };
  let S = load();
  function load() {
    let v = null;
    try { v = JSON.parse(localStorage.getItem('test-state-v2')); } catch (e) { /* none */ }
    const s = Object.assign(JSON.parse(JSON.stringify(DEF)), v || {});
    if (typeof s.m !== 'number') s.m = DEF.m;
    return s;
  }
  function save() { try { localStorage.setItem('test-state-v2', JSON.stringify(S)); } catch (e) { /* private */ } }
  function set(patch) {
    Object.assign(S, patch);
    save();
    Link.send('test', S);
    render();
  }
  Link.on('test', (d) => { S = d; save(); render(); });
  Link.on('test-hello', () => { if (!OUT) Link.send('test', S); });
  // the wall may run on another PC: follow its screen mode and layout
  const adopt = (d) => {
    if (d.mode && WallDef.MODES[d.mode]) WallDef.setMode(d.mode);
    if (d.layout && d.layout.slots) WallDef.save(d.mode || wmode(), d.layout);
    setTimeout(render, 100);
  };
  Link.on('wall', (d) => { if (d.layout || d.reset || d.mode) adopt(d); });
  Link.on('wall-state', (d) => { if (d.mode) adopt(d); });
  Link.send('wall-hello', {});

  // stills of each screen mode, taken in that mode's default layout (tools/capture-stills.cjs)
  let STILLS = [], SHOT = null, stillsOf = null;
  const dir = () => (wmode() === '169' ? 'assets/test/stills-169/' : 'assets/test/stills/');
  function loadStills() {
    const m = wmode();
    if (stillsOf === m) return;
    stillsOf = m;
    fetch(dir() + 'index.json', { cache: 'no-cache' }).then((r) => r.json()).then((d) => {
      if (stillsOf !== m) return;
      STILLS = Array.isArray(d) ? d : d.steps;
      SHOT = Array.isArray(d) ? null : d.layout;
      if (S.step >= STILLS.length) S.step = 0;
      render();
    }).catch(() => { STILLS = []; SHOT = null; render(); });
  }
  const still = (k) => { const s = STILLS[S.step]; return s ? `${dir()}${s.key}_${k}.jpg` : ''; };
  // the wall still as one picture when the current layout is the one it was taken in
  const sameLayout = (L) => !!SHOT && Object.keys(PANELS).every((k) => SHOT[k] && L[k] && SHOT[k].every((v, i) => Math.abs(v - L[k][i]) < 1));
  const W = () => window.WallDef.MODES[wmode()].W;

  /* ---------------- physical size and readability ---------------- */
  // Character height by visual angle: about 10 arc-minutes is readable with effort, 20 is comfortable.
  const need = () => S.dist * Math.tan((10 / 60) * Math.PI / 180);
  const good = () => S.dist * Math.tan((20 / 60) * Math.PI / 180);
  function phys() {
    const w = S.m, h = w * H / W();
    return { w, h, inch: Math.sqrt(w * w + h * h) / 0.0254, px: w / W() };
  }
  // text that matters on each panel, in the page's own design pixels
  // car: sizes in the photo's pixels at the overview; zoomed views enlarge them
  // 'cap': the step caption over the CCW / DMS panel, sized to the panel (2.4% of its width, 14–40 px)
  const TEXT = {
    car: [['계기판 속도 (확대 시)', 120], ['HU 팝업 문구 (HU 확대 시)', 27]],
    flow: [['진행 단계 설명 (레일 아래)', 31], ['상자 이름', 32], ['메시지 라벨', 26], ['통화 표시', 24]],
    ccw: [['단계 자막', 0, 'cap'], ['팝업 제목 (확대 시)', 18], ['화면 본문 (확대 시)', 13]],
    talk: [['대화 말풍선', 22], ['보조 글자', 14]],
    dms: [['단계 자막', 0, 'cap'], ['차량번호 (확대 시)', 24], ['SLA · 단계 정보 (확대 시)', 13]],
  };
  // zoom of the car panel's camera for a row (cluster ≈ 3.4x the overview, the HU screen ≈ 0.26 x 4.1)
  const CAR_ZOOM = [3.4 * 0.42, 0.255 * 4.1];
  function readability() {
    const L = layoutOf(), p = phys();
    return Object.keys(PANELS).map((k) => {
      const [, , w, h] = L[k];
      const d = PANELS[k].design;
      const scale = d ? Math.min(w / d[0], h / d[1]) : 1;
      const rows = TEXT[k].map(([what, px0, kind], i) => {
        const px = kind === 'cap' ? Math.round(Math.max(14, Math.min(40, w * 0.024))) : px0;
        const cm = kind === 'cap' ? px * p.px * 100 : px * scale * (k === 'car' ? CAR_ZOOM[i] : 1) * p.px * 100;
        const v = cm / 100 >= good() ? 'ok' : cm / 100 >= need() ? 'mid' : 'bad';
        return { what, px, cm, v };
      });
      return { k, w, h, scale, rows };
    });
  }

  /* ---------------- the wall: stills, pattern, ladder ---------------- */
  // draws the display's content into box (a W x 1080 canvas scaled to it)
  function wall(box, opts) {
    const L = layoutOf();
    box.innerHTML = `<div class="cv" style="width:${W()}px"></div>`;
    const cv = box.firstChild;
    // fit the canvas into the box (the output window letterboxes a display of another ratio)
    const k = Math.min(box.clientWidth / W(), (box.clientHeight || Infinity) / H) || 1;
    cv.style.transform = `scale(${k})`;
    cv.style.left = `${(box.clientWidth - W() * k) / 2}px`;
    cv.style.top = `${Math.max(0, (box.clientHeight - H * k) / 2)}px`;
    if (S.mode === 'black') return;
    if (S.mode === 'pattern') {
      const c = document.createElement('canvas');
      c.className = 'pat';
      cv.appendChild(c);
      patterns.push({ cv: c, L, out: !opts.preview });
      return;
    }
    if (S.mode === 'read' && !opts.preview) { cv.innerHTML = ladder(); return; }
    const verdict = S.mode === 'read' ? Object.fromEntries(readability().map((r) => [r.k, r.rows])) : null;
    const whole = sameLayout(L) && STILLS[S.step];
    // opening and closing fill the whole wall: no panel labels over the title
    const scene = whole && ['opening', 'closing'].includes(STILLS[S.step].id);
    cv.innerHTML = (whole ? `<img class="whole" src="${still('wall')}" alt="" draggable="false">` : '') + Object.keys(PANELS).map((p) => {
      const [x, y, w, h] = L[p];
      const v = verdict && verdict[p];
      return `<div class="pn ${whole ? 'over' : ''}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">
        ${!whole && STILLS[S.step] ? `<img src="${still(p)}" alt="" draggable="false">` : ''}
        ${(S.labels && !scene) || v ? `<span class="tg">${esc(PANELS[p].t)}</span>` : ''}
        ${v ? `<div class="rv">${v.map((r) => `<div class="${r.v}">${esc(r.what)} ${r.cm.toFixed(1)}cm ${r.v === 'ok' ? '✓' : r.v === 'mid' ? '△' : '✗'}</div>`).join('')}</div>` : ''}</div>`;
    }).join('');
  }

  let patterns = [];
  function drawPattern(p) {
    const c = p.cv, Wc = W();
    if (c.width !== Wc) { c.width = Wc; c.height = H; }
    const g = c.getContext('2d');
    g.fillStyle = '#05080d'; g.fillRect(0, 0, Wc, H);
    const sq = H / 12;
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
    for (let x = Wc / 2 % sq; x < Wc; x += sq) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = H / 2 % sq; y < H; y += sq) { g.beginPath(); g.moveTo(0, y); g.lineTo(Wc, y); g.stroke(); }
    // panel outlines from the wall layout
    for (const k in p.L) {
      const [x, y, w, h] = p.L[k];
      g.strokeStyle = 'rgba(90,162,255,0.8)'; g.lineWidth = 4; g.setLineDash([16, 10]); g.strokeRect(x + 2, y + 2, w - 4, h - 4); g.setLineDash([]);
      g.fillStyle = '#9fc6ff'; g.font = '700 30px Pretendard, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText(PANELS[k].t, x + 22, y + 20);
    }
    // safe areas, edges, circles (round = not stretched)
    g.setLineDash([12, 10]); g.strokeStyle = 'rgba(255,207,74,0.8)'; g.lineWidth = 3; g.strokeRect(Wc * 0.02, H * 0.05, Wc * 0.96, H * 0.9); g.setLineDash([]);
    g.strokeStyle = '#ffb02e'; g.lineWidth = 2; g.strokeRect(0.5, 0.5, Wc - 1, H - 1);
    g.lineWidth = 8;
    [[0, 0, 1, 1], [Wc, 0, -1, 1], [0, H, 1, -1], [Wc, H, -1, -1]].forEach(([x, y, sx, sy]) => { g.beginPath(); g.moveTo(x + sx * 70, y + sy * 4); g.lineTo(x + sx * 4, y + sy * 4); g.lineTo(x + sx * 4, y + sy * 70); g.stroke(); });
    g.strokeStyle = '#ffb02e'; g.lineWidth = 4;
    const R = H * 0.36;
    for (let cx = Wc / (2 * Math.round(Wc / H)); cx < Wc; cx += Wc / Math.round(Wc / H)) { g.beginPath(); g.arc(cx, H / 2, R, 0, Math.PI * 2); g.stroke(); }
    // label
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff'; g.font = '800 110px Barlow, Pretendard, sans-serif';
    g.fillText(`${window.WallDef.MODES[wmode()].name} WALL`, Wc / 2, H * 0.42);
    g.font = '600 36px Barlow, Pretendard, sans-serif'; g.fillStyle = '#cfd6e2';
    if (p.out) {
      const dpr = devicePixelRatio || 1, sw = Math.round(innerWidth * dpr), sh = Math.round(innerHeight * dpr);
      g.fillText(`신호 ${sw}×${sh} · 비율 ${(sw / sh).toFixed(3)} (${nearest(sw / sh)}) · 모니터 ${screen.width}×${screen.height} · DPR ${dpr}`, Wc / 2, H * 0.56);
    } else g.fillText(`캔버스 ${Wc}×${H}`, Wc / 2, H * 0.56);
    g.font = '500 28px Pretendard, sans-serif'; g.fillStyle = '#9fb0c8';
    g.fillText('원이 동그랗고 · 네 모서리 ㄱ자와 노란 점선이 보이고 · 패널 테두리가 잘리지 않아야 정상', Wc / 2, H * 0.64);
    // colour bars
    ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff', '#000000'].forEach((col, i) => { g.fillStyle = col; g.fillRect(Wc / 2 - 480 + i * 120, H * 0.72, 120, 60); });
    for (let i = 0; i < 32; i++) { const v = Math.round((i / 31) * 255); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Wc / 2 - 480 + i * 30, H * 0.72 + 60, 31, 30); }
    // sweep: a bar crossing the whole display, left to right
    const t = (Date.now() % 6000) / 6000;
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(t * Wc - 5, H * 0.9, 10, H * 0.1);
  }
  function nearest(r) {
    const c = [['16:9', 16 / 9], ['21:9 (64:27)', 64 / 27], ['21:9 (43:18)', 43 / 18], ['32:9', 32 / 9], ['63:9 (7:1)', 7], ['48:9', 48 / 9], ['2:1', 2], ['3:1', 3], ['4:1', 4], ['6:1', 6]];
    const best = c.reduce((a, b) => (Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a));
    return Math.abs(best[1] - r) < 0.04 ? best[0] : '비표준';
  }
  (function loop() { patterns = patterns.filter((p) => p.cv.isConnected); patterns.forEach(drawPattern); requestAnimationFrame(loop); })();

  // full-display ladder: sample sizes as they come out on the display
  function ladder() {
    const p = phys();
    const rows = [11, 14, 18, 22, 30, 40, 52, 72, 110].map((px) => {
      const cm = px * p.px * 100;
      const v = cm / 100 >= good() ? 'ok' : cm / 100 >= need() ? 'mid' : 'bad';
      return `<div class="lr ${v}"><span class="sz" style="font-size:${px}px">가나 AB 12</span><span class="mt"><b>${px}px</b> · ${cm.toFixed(1)}cm</span><i>${v === 'ok' ? '✓ 잘 보임' : v === 'mid' ? '△ 겨우' : '✗ 안 보임'}</i></div>`;
    }).join('');
    return `<div class="ladder"><div class="lh">캔버스 픽셀 기준 · 화면 ${p.w.toFixed(1)}×${p.h.toFixed(2)}m · 맨 뒷줄 ${S.dist}m → 글자 높이 최소 ${(need() * 100).toFixed(1)}cm, 편하게 ${(good() * 100).toFixed(1)}cm</div>${rows}</div>`;
  }

  /* ---------------- output window ---------------- */
  let outKey = '';
  function renderOut(force) {
    const key = JSON.stringify([S.mode, S.step, S.labels, S.m, S.dist, STILLS.length, stillsOf, !!SHOT, layoutOf()]);
    if (!force && key === outKey) return;
    outKey = key;
    document.body.className = 'out';
    patterns = [];
    app.innerHTML = `<div class="sig"></div><div id="hint">테스트 출력 · F 전체화면 · ← → 장면 · 1 패턴 2 스틸 3 가독성 0 검정</div>`;
    wall($('.sig'), { fill: true });
  }
  if (OUT) {
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyF') (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
      const modes = { Digit1: 'pattern', Digit2: 'stills', Digit3: 'read', Digit0: 'black' };
      if (modes[e.code]) set({ mode: modes[e.code] });
      if (e.code === 'ArrowRight') set({ step: Math.min(STILLS.length - 1, S.step + 1) });
      if (e.code === 'ArrowLeft') set({ step: Math.max(0, S.step - 1) });
    });
    let tid;
    addEventListener('mousemove', () => { document.body.classList.add('cur'); clearTimeout(tid); tid = setTimeout(() => document.body.classList.remove('cur'), 2000); });
  }

  /* ---------------- console ---------------- */
  let screens = null, screensErr = '';
  async function detect() {
    if (!('getScreenDetails' in window)) { screensErr = '이 브라우저는 디스플레이 목록을 지원하지 않습니다 (Chrome 권장). 창을 열어 해당 화면으로 끌어다 놓으세요.'; render(); return; }
    try {
      const d = await window.getScreenDetails();
      screens = d.screens;
      d.addEventListener('screenschange', () => { screens = d.screens; render(); });
    } catch (e) { screensErr = '권한이 거부되었습니다. 주소창 왼쪽 아이콘에서 “창 관리” 권한을 허용하세요.'; }
    render();
  }
  function openOn(url, name, scr) {
    const f = scr ? `left=${scr.availLeft},top=${scr.availTop},width=${scr.availWidth},height=${scr.availHeight}` : 'width=1280,height=560';
    window.open(url, name, f);
  }

  const GUIDE = `
    <div class="g"><b>연결</b><p>맥 → C to HDMI 1개 → 디스플레이. 맥에 외부 디스플레이 1대로 잡히면 됩니다. 아래 ③에서 <em>디스플레이 감지</em>로 해상도와 비율을 확인하고, 시연 화면 모드를 디스플레이에 맞춥니다: <em>21:9 디스플레이 → 21:9 모드</em>(2560×1080 · 3440×1440), <em>16:9 TV · 모니터 → 16:9 모드</em>(1920×1080 · 3840×2160). 모드와 신호 비율이 다르면 화면이 늘어나거나 여백이 생깁니다.</p></div>
    <div class="g"><b>맥 설정</b><p>시스템 설정 › 디스플레이: <em>확장</em>(미러링 아님), 해상도 “기본값” 또는 디스플레이 고유 해상도, 새로 고침 60Hz. 소리 출력 = HDMI 또는 현장 음향. 방해금지 · 화면보호기 · 잠자기 끄기, 충전기 연결.</p></div>
    <div class="g"><b>크롬</b><p>시연 화면(<code>wall.html</code>)을 외부 디스플레이에서 <em>F</em>로 전체화면. 소리가 클릭 없이 나오게 하려면 크롬을 <code>--autoplay-policy=no-user-gesture-required</code> 옵션으로 실행. 컨트롤 패널은 맥 화면이나 태블릿에서.</p></div>
    <div class="g"><b>비율이 다를 때</b><p>디스플레이 비율이 모드(21:9 · 16:9)와 조금 다르면 위아래나 좌우에 검은 여백이 생깁니다. 배치 편집(<code>wall.html</code>에서 E): 경계선을 끌면 옆 패널이 함께 줄고, 패널을 끌어 자리를 바꿉니다.</p></div>`;
  const CHECKS = [
    ['연결 · 신호', ['맥이 인식하는 해상도 · 비율 기록', '패턴의 원이 동그랗다 (늘어남 없음)', '네 모서리 · 노란 점선 · 패널 테두리가 다 보임', '흰 막대가 왼쪽 끝에서 오른쪽 끝까지 끊김 없이 지나감', '색 막대 · 회색 단계 구분됨']],
    ['구성 · 가독성', ['패널 배치 확정 (5개 · 필요하면 배치 편집)', '맨 뒷줄에서 데이터 흐름 진행 단계 · 설명 읽힘', '맨 뒷줄에서 CCW · DMS 단계 자막 읽힘', 'CCW · DMS 확대 화면에서 보여 줄 부분이 보임', '조명 아래 밝기 · 반사']],
    ['소리 · 진행', ['왼쪽 · 오른쪽 톤 위치 맞음', '상담원 · 고객 음성 크기 적당', '컨트롤 패널 연결 (같은 PC 또는 릴레이)', '① 인바운드: 여성 운전자 손 → 통화 → 긴급출동 차량 정차 · 경광등', '① 이어서 DMS 컨택 · 예약 확정 → 입고 → 정비 → 종결', '② 아웃바운드 시나리오 끝까지']],
  ];

  function renderConsole() {
    document.body.className = 'con';
    patterns = [];
    const st = STILLS[S.step] || { title: '스틸 없음', what: '' };
    const p = phys();
    const rd = readability();
    const scr = screens ? screens.map((s, i) => `<tr><td>${i + 1}${s.isPrimary ? ' · 기본' : ''}${s.isInternal ? ' · 내장' : ''}</td><td>${esc(s.label || '')}</td><td>${s.width}×${s.height}</td><td>${s.devicePixelRatio}</td><td>${(s.width / s.height).toFixed(3)} (${nearest(s.width / s.height)})</td>
      <td><button data-open="test:${i}">테스트 출력</button><button data-open="wall:${i}">시연 화면</button></td></tr>`).join('') : '';
    app.innerHTML = `
    <header><b>모니터 테스트 모드</b><span>시연 화면 (21:9 · 16:9) 사전 점검</span><em id="lk">● ${esc(Link.label())}</em></header>
    <main>
      <section class="card wide"><h2>① 시연 화면 미리보기 <small>${window.WallDef.MODES[wmode()].name} · 시연 화면의 현재 배치 · 장면 스틸</small></h2>
        <div class="wallwrap"><div class="prev" style="aspect-ratio:${W()}/${H}"></div></div>
        <div class="bar">
          <div class="seg">${[['pattern', '1 패턴'], ['stills', '2 스틸'], ['read', '3 가독성'], ['black', '0 검정']].map(([m, n]) => `<button data-mode="${m}" class="${S.mode === m ? 'on' : ''}">${n}</button>`).join('')}</div>
          <div class="seg"><button data-step="-1">◀</button><span class="stp"><b>${S.step + 1}/${STILLS.length || 0} ${esc(st.title)}</b><small>${esc(st.what || '')}</small></span><button data-step="1">▶</button></div>
          <div class="seg"><button data-labels class="${S.labels ? 'on' : ''}">라벨</button></div>
        </div>
        <div class="steps">${STILLS.map((s, i) => `<button data-go="${i}" class="${i === S.step ? 'on' : ''}"><img src="${dir()}${s.key}_car.jpg" alt=""><span>${i + 1}. ${esc(s.title)}</span></button>`).join('')}</div>
      </section>

      <section class="card"><h2>② 디스플레이 크기 · 가독성 <small>실측해서 입력</small></h2>
        <div class="vrow"><b>가로 폭</b><label><input data-m type="number" step="0.1" value="${S.m}"> m</label><b>맨 뒷줄</b><label><input data-dist type="number" step="1" value="${S.dist}"> m</label></div>
        <p class="sz">${p.w.toFixed(1)} × ${p.h.toFixed(2)} m · 대각 <b>${Math.round(p.inch)}″</b> · 캔버스 1px = ${(p.px * 1000).toFixed(2)}mm</p>
        <p class="note">맨 뒷줄 ${S.dist}m 기준 글자 높이: 최소 ${(need() * 100).toFixed(1)}cm, 편하게 ${(good() * 100).toFixed(1)}cm</p>
        <table><tr><th>패널</th><th>크기</th><th>확대</th><th>주요 글자 → 화면 위 높이</th></tr>
        ${rd.map((r) => `<tr><td>${esc(PANELS[r.k].t)}</td><td>${r.w}×${r.h}</td><td>${r.scale.toFixed(2)}×</td><td>${r.rows.map((x) => `<span class="rv1 ${x.v}">${esc(x.what)} ${x.cm.toFixed(1)}cm</span>`).join(' ')}</td></tr>`).join('')}</table>
        <p class="note">배치는 시연 화면(<code>wall.html</code>)에서 E로 편집하면 여기에도 반영됩니다.</p>
      </section>

      <section class="card"><h2>③ 출력 · 소리</h2>
        <p class="note">Chrome에서 <b>디스플레이 감지</b> → 외부 디스플레이 줄에서 <b>테스트 출력</b> 또는 <b>시연 화면</b>을 엽니다. 열린 창에서 <b>F</b> = 전체화면.</p>
        <div class="row"><button data-detect class="pri">디스플레이 감지</button><button data-open="test">테스트 출력 창</button><button data-open="wall">시연 화면 창</button></div>
        ${screensErr ? `<p class="warn">${esc(screensErr)}</p>` : ''}
        ${screens ? `<table><tr><th>#</th><th>이름</th><th>해상도</th><th>DPR</th><th>비율</th><th>이 화면에 열기</th></tr>${scr}</table>` : ''}
        <h3>소리</h3>
        <div class="row"><button data-tone="-1">◀ 왼쪽 톤</button><button data-tone="0">가운데 톤</button><button data-tone="1">오른쪽 톤 ▶</button><button data-voice>상담원 음성 샘플</button></div>
        <h3>바로가기</h3>
        <div class="row"><a href="wall.html" target="_blank">시연 화면</a><a href="control.html" target="_blank">컨트롤 패널</a></div>
      </section>

      <section class="card"><h2>④ 연결 안내 <small>M5 MacBook Air</small></h2>${GUIDE}</section>

      <section class="card wide"><h2>⑤ 현장 체크리스트 <small>이 브라우저에 저장 · 복사해서 공유</small></h2>
        <div class="checks">${CHECKS.map(([grp, items], g) => `<div><h3>${grp}</h3>${items.map((t, i) => { const k = `${g}.${i}`; const v = (S.checks || {})[k] || ''; return `<div class="ck ${v}"><span>${esc(t)}</span><button data-ck="${k}:ok">OK</button><button data-ck="${k}:ng">문제</button></div>`; }).join('')}</div>`).join('')}</div>
        <textarea data-notes rows="4" placeholder="현장 메모: 해상도, 비율, 배치, 보이지 않는 글자, 소리 등">${esc(S.notes || '')}</textarea>
        <div class="row"><button data-copy class="pri">결과 복사</button><button data-reset>설정 초기화</button></div>
      </section>
    </main>`;
    wall($('.prev'), { preview: true });
  }

  /* ---------------- console events ---------------- */
  let ac = null;
  function tone(pan) {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), gn = ac.createGain(), pn = ac.createStereoPanner();
    o.frequency.value = pan < 0 ? 523 : pan > 0 ? 784 : 659;
    pn.pan.value = pan;
    gn.gain.setValueAtTime(0, ac.currentTime); gn.gain.linearRampToValueAtTime(0.25, ac.currentTime + 0.05); gn.gain.setValueAtTime(0.25, ac.currentTime + 1.2); gn.gain.linearRampToValueAtTime(0, ac.currentTime + 1.4);
    o.connect(gn).connect(pn).connect(ac.destination);
    o.start(); o.stop(ac.currentTime + 1.5);
  }
  function wire() {
    app.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      if (d.mode) set({ mode: d.mode });
      else if (d.step) set({ step: Math.max(0, Math.min(STILLS.length - 1, S.step + +d.step)) });
      else if (d.go) set({ step: +d.go, mode: S.mode === 'read' ? 'read' : 'stills' });
      else if ('labels' in d) set({ labels: !S.labels });
      else if ('detect' in d) detect();
      else if (d.open) {
        const [what, i] = d.open.split(':');
        const s = i != null && screens ? screens[+i] : null;
        if (what === 'test') openOn('test.html?out=1', 'test-out', s); else openOn('wall.html', 'wall', s);
      } else if (d.tone) tone(+d.tone);
      else if ('voice' in d) new Audio('assets/audio/ecare_w_02_agent.mp3').play();
      else if (d.ck) { const [k, v] = d.ck.split(':'); const c = Object.assign({}, S.checks); c[k] = c[k] === v ? '' : v; set({ checks: c }); }
      else if ('copy' in d) copy();
      else if ('reset' in d) { if (confirm('설정과 체크리스트를 초기화할까요?')) { S = JSON.parse(JSON.stringify(DEF)); set({}); } }
    });
    app.addEventListener('change', (e) => {
      const d = e.target.dataset, v = e.target.value;
      if ('m' in d) set({ m: +v || 1 });
      else if ('dist' in d) set({ dist: +v || 1 });
      else if ('notes' in d) set({ notes: v });
    });
  }
  function copy() {
    const p = phys();
    const lines = [`[모니터 테스트] ${new Date().toLocaleString('ko-KR')}`, `${window.WallDef.MODES[wmode()].name} · ${p.w.toFixed(1)}×${p.h.toFixed(2)}m (${Math.round(p.inch)}″) · 맨 뒷줄 ${S.dist}m`];
    const L = layoutOf();
    lines.push(`배치: ${Object.keys(PANELS).map((k) => `${PANELS[k].t} ${L[k].join(',')}`).join(' / ')}`);
    readability().forEach((r) => lines.push(`  ${PANELS[r.k].t}: ${r.rows.map((x) => `${x.what} ${x.cm.toFixed(1)}cm${x.v === 'ok' ? '✓' : x.v === 'mid' ? '△' : '✗'}`).join(', ')}`));
    if (screens) lines.push(`디스플레이: ${screens.map((s, i) => `${i + 1}) ${s.label || ''} ${s.width}×${s.height}@${s.devicePixelRatio}`).join(', ')}`);
    CHECKS.forEach(([grp, items], g) => items.forEach((t, i) => { const v = (S.checks || {})[`${g}.${i}`]; lines.push(`${v === 'ok' ? '✓' : v === 'ng' ? '✗' : '·'} ${grp} — ${t}`); }));
    if (S.notes) lines.push('', S.notes);
    navigator.clipboard.writeText(lines.join('\n')).then(() => alert('복사했습니다.'), () => prompt('복사하세요', lines.join('\n')));
  }

  function render() {
    loadStills();
    if (OUT) { renderOut(); return; }
    const f = document.activeElement;
    if (f && app.contains(f) && f.matches('textarea, input')) return;
    renderConsole();
  }
  if (OUT) Link.send('test-hello', {}); else { wire(); Link.on('@transport', () => { const e = $('#lk'); if (e) e.textContent = `● ${Link.label()}`; }); }
  addEventListener('resize', () => (OUT ? renderOut(true) : render()));
  render();
})();
