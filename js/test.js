/* Monitor test mode for the auditorium (test.html).
 *
 *   test.html                       console: displays, venue screens, modes,
 *                                   wall preview, checklist
 *   test.html?out=1&role=left       an output window (one per HDMI / display);
 *                                   role: left | center | right | all | sides
 *
 * Output windows draw the actual signal: test patterns (round circles, safe
 * areas, edges, sync sweep), still frames of each demo step, a readability
 * ladder, or the live stage. The console's wall preview draws the same at
 * the venue's physical aspect ratios, so a composition can be judged before
 * the real screens are measured. Windows follow the console through Link. */
(function () {
  'use strict';

  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const P = new URLSearchParams(location.search);
  const OUT = P.has('out');
  const ROLE = P.get('role') || 'center';
  const app = $('#app');

  const ROLES = { left: '왼쪽', center: '가운데', right: '오른쪽', all: '3면 한 소스', sides: '양쪽 (미러)' };
  const SRC = { left: '고객 · 계기판/HU', center: '데이터 흐름', right: '상담센터 CCW' };
  const ASPECTS = [['16:9', 16, 9], ['16:10', 16, 10], ['2:1', 2, 1], ['21:9', 21, 9], ['2.39:1 (시네마)', 2.39, 1], ['32:9', 32, 9], ['4:1', 4, 1], ['직접 입력', 0, 0]];

  /* ---------------- shared state ---------------- */
  const DEF = {
    mode: 'pattern', step: 0, fit: 'fit', labels: true,
    // estimated from the venue video (1101.mp4): three LED sections about 4.6 x 2.2 m, last row about 18 m
    venue: { center: { a: '2:1', w: 2, h: 1, m: 4.6 }, side: { a: '2:1', w: 2, h: 1, m: 4.6 }, dist: 18 },
    comp: { left: ['left'], center: ['center'], right: ['right'], sides: ['left'] },
  };
  let S = load();
  function load() {
    try { const v = JSON.parse(localStorage.getItem('test-state')); if (v && v.venue) return Object.assign(JSON.parse(JSON.stringify(DEF)), v); } catch (e) { /* none */ }
    return JSON.parse(JSON.stringify(DEF));
  }
  function save() { try { localStorage.setItem('test-state', JSON.stringify(S)); } catch (e) { /* private */ } }
  function set(patch) { Object.assign(S, patch); save(); Link.send('test', S); render(); }
  Link.on('test', (d) => { S = d; save(); render(); });
  Link.on('test-hello', () => { if (!OUT) Link.send('test', S); });

  let STILLS = [];
  fetch('assets/test/stills/index.json').then((r) => r.json()).then((d) => { STILLS = d; render(); }).catch(() => {});
  const still = (src) => { const s = STILLS[S.step]; return s ? `assets/test/stills/${s.key}_${src}.jpg` : ''; };

  const aspect = (v) => v.w / v.h;
  const screenOf = (role) => (role === 'center' ? S.venue.center : S.venue.side);
  /** physical size of a screen from its width in meters */
  function phys(v) {
    const h = v.m / aspect(v);
    return { w: v.m, h, inch: Math.sqrt(v.m * v.m + h * h) / 0.0254 };
  }

  /* ---------------- regions: one screen's content ---------------- */
  // Fills el (a sized box) with the given mode for one role.
  function region(slot, role, ctx) {
    const mode = S.mode;
    slot.innerHTML = '';
    const el = document.createElement('div');
    el.className = `rg rg-${role}`;
    slot.appendChild(el);
    if (mode === 'black') return;
    if (mode === 'pattern') { const cv = document.createElement('canvas'); el.appendChild(cv); patterns.push({ cv, role, ctx }); return; }
    if (mode === 'read') { el.innerHTML = ladder(role, ctx); return; }
    if (mode === 'live') {
      if (ctx.preview) { el.innerHTML = `<div class="ph">라이브는 출력 창에서만 표시<br><small>${esc(ROLES[role])}: stage.html?screen=${role === 'sides' ? 'left' : role}</small></div>`; return; }
      el.innerHTML = `<iframe src="stage.html?screen=${role === 'sides' ? 'left' : role}" allow="autoplay; fullscreen"></iframe>`;
      return;
    }
    // stills: one or two 16:9 panes side by side
    const panes = S.comp[role] || [role];
    el.innerHTML = panes.map((src) => `<div class="pane ${S.fit}"><img src="${still(src)}" alt="" draggable="false">${S.labels ? `<span class="tg">${esc(SRC[src])}</span>` : ''}</div>`).join('');
  }

  /* ---------------- test pattern ---------------- */
  let patterns = [];
  function drawPattern(p, t) {
    const cv = p.cv, r = cv.parentNode.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d');
    const col = { left: '#ff6b81', center: '#5aa2ff', right: '#3ddc84', all: '#ffb02e', sides: '#c58bff' }[p.role] || '#fff';
    g.fillStyle = '#05080d'; g.fillRect(0, 0, W, H);
    // grid of squares (stays square unless stretched)
    const sq = H / 12;
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
    for (let x = W / 2 % sq; x < W; x += sq) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = H / 2 % sq; y < H; y += sq) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    // safe areas 5% / 10%
    g.setLineDash([10 * dpr, 8 * dpr]);
    [[0.05, 'rgba(255,207,74,0.8)'], [0.1, 'rgba(255,207,74,0.4)']].forEach(([k, c]) => { g.strokeStyle = c; g.lineWidth = 2 * dpr; g.strokeRect(W * k, H * k, W * (1 - 2 * k), H * (1 - 2 * k)); });
    g.setLineDash([]);
    // edge: 1px border + corner markers
    g.strokeStyle = col; g.lineWidth = 1; g.strokeRect(0.5, 0.5, W - 1, H - 1);
    g.lineWidth = 6 * dpr;
    const m = H * 0.06;
    [[0, 0, 1, 1], [W, 0, -1, 1], [0, H, 1, -1], [W, H, -1, -1]].forEach(([x, y, sx, sy]) => { g.beginPath(); g.moveTo(x + sx * m, y + sy * 3); g.lineTo(x + sx * 3, y + sy * 3); g.lineTo(x + sx * 3, y + sy * m); g.stroke(); });
    // circles: must look round on the screen
    g.strokeStyle = col; g.lineWidth = 3 * dpr;
    const R = H * 0.36;
    g.beginPath(); g.arc(W / 2, H / 2, R, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2 * dpr;
    [[R * 0.42, R * 0.42], [W - R * 0.42, R * 0.42], [R * 0.42, H - R * 0.42], [W - R * 0.42, H - R * 0.42]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, R * 0.3, 0, Math.PI * 2); g.stroke(); });
    g.beginPath(); g.moveTo(W / 2 - R, H / 2); g.lineTo(W / 2 + R, H / 2); g.moveTo(W / 2, H / 2 - R); g.lineTo(W / 2, H / 2 + R); g.stroke();
    // color bars + gray ramp at the bottom
    const bars = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff', '#000000'];
    const bw = W * 0.5 / bars.length, by = H * 0.8, bh = H * 0.06;
    bars.forEach((c, i) => { g.fillStyle = c; g.fillRect(W * 0.25 + i * bw, by, bw, bh); });
    for (let i = 0; i < 32; i++) { const v = Math.round((i / 31) * 255); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(W * 0.25 + i * (W * 0.5 / 32), by + bh, W * 0.5 / 32 + 1, bh * 0.5); }
    // labels
    g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${H * 0.13}px Barlow, Pretendard, sans-serif`;
    g.fillText({ left: 'LEFT ①', center: 'CENTER ②', right: 'RIGHT ③', all: 'ALL', sides: 'SIDES' }[p.role] || p.role, W / 2, H * 0.36);
    g.fillStyle = '#fff';
    g.font = `700 ${H * 0.05}px Pretendard, sans-serif`;
    g.fillText(`${ROLES[p.role] || p.role} 스크린`, W / 2, H * 0.48);
    g.font = `600 ${H * 0.032}px Barlow, Pretendard, sans-serif`;
    g.fillStyle = '#cfd6e2';
    const rw = Math.round(r.width * dpr), rh = Math.round(r.height * dpr);
    g.fillText(`신호 ${rw}×${rh}  ·  비율 ${(rw / rh).toFixed(3)} (${nearest(rw / rh)})  ·  DPR ${dpr}`, W / 2, H * 0.58);
    if (!p.ctx.preview) g.fillText(`모니터 ${screen.width}×${screen.height}  ·  창 ${innerWidth}×${innerHeight}`, W / 2, H * 0.64);
    g.font = `500 ${H * 0.024}px Pretendard, sans-serif`;
    g.fillStyle = '#9fb0c8';
    g.fillText('원이 동그랗고 · 네 모서리 ㄱ자 표시와 노란 점선(안전영역)이 모두 보여야 정상', W / 2, H * 0.71);
    // sync sweep: one bar travels left → center → right across all windows
    const idx = { left: 0, center: 1, right: 2 }[p.role];
    const ph = (t % 6000) / 6000 * 3;
    const span = p.role === 'all' || p.role === 'sides' ? null : idx;
    const local = span == null ? (p.role === 'sides' ? (ph % 1) : ph / 3) : ph - span;
    if (local >= 0 && local <= 1) {
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillRect(local * W - 4 * dpr, H * 0.9, 8 * dpr, H * 0.1);
    }
  }
  function nearest(r) {
    const c = [['16:9', 16 / 9], ['16:10', 1.6], ['4:3', 4 / 3], ['21:9', 21 / 9], ['32:9', 32 / 9], ['48:9 (16:9×3)', 48 / 9], ['2:1', 2], ['3:1', 3], ['4:1', 4], ['6:1', 6]];
    const best = c.reduce((a, b) => (Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a));
    return Math.abs(best[1] - r) < 0.03 ? best[0] : '비표준';
  }
  function loop(t) { patterns = patterns.filter((p) => p.cv.isConnected); patterns.forEach((p) => drawPattern(p, Date.now())); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);

  /* ---------------- readability ladder ---------------- */
  // Character height by visual angle: about 10 arc-minutes is readable with effort, 20 is comfortable.
  const SAMPLES = [[13, 'CCW 표 · 작은 라벨'], [18, 'CCW 본문 · 흐름 로그'], [24, '흐름 패킷 라벨'], [30, '흐름 노드 이름 · HU 보조문구'], [40, 'HU 카드 · 경고 이름'], [52, '자막 (HU · 흐름)'], [72, '흐름 시계'], [110, '25분 경과 · 큰 제목']];
  function ladder(role, ctx) {
    const v = screenOf(role === 'all' ? 'center' : role);
    const ph = phys(v);
    const panes = (S.comp[role] || [role]).length;
    // content is a 16:9 frame fitted into the screen (or into half of it for two panes)
    const contentH = Math.min(ph.h, (ph.w / panes) * 9 / 16);
    const need = S.venue.dist * Math.tan((10 / 60) * Math.PI / 180), good = S.venue.dist * Math.tan((20 / 60) * Math.PI / 180);
    const rows = SAMPLES.map(([px, what]) => {
      const cm = (px / 1080) * contentH * 100;
      const ok = cm / 100 >= good ? 'ok' : cm / 100 >= need ? 'mid' : 'bad';
      return `<div class="lr ${ok}"><span class="sz" style="font-size:${(px / 1080) * 100}cqh">가나 AB 12</span><span class="mt"><b>${px}px</b> · ${cm.toFixed(1)}cm · ${esc(what)}</span><i>${ok === 'ok' ? '✓ 잘 보임' : ok === 'mid' ? '△ 겨우' : '✗ 안 보임'}</i></div>`;
    }).join('');
    return `<div class="ladder"><div class="lh">${esc(ROLES[role])} 가독성 · 화면 ${ph.w.toFixed(1)}×${ph.h.toFixed(1)}m (${Math.round(ph.inch)}″) · 맨 뒷줄 ${S.venue.dist}m → 글자 높이 최소 ${(need * 100).toFixed(0)}cm, 편하게 ${(good * 100).toFixed(0)}cm${panes > 1 ? ' · 화면당 2분할' : ''}</div>${rows}</div>`;
  }

  /* ---------------- output window ---------------- */
  let outKey = '';
  function renderOut(force) {
    // only what this window shows; the live stage must not reload on every change
    const key = JSON.stringify(S.mode === 'live' ? ['live'] : [S.mode, S.step, S.fit, S.labels, S.comp, S.venue, STILLS.length]);
    if (!force && key === outKey) return;
    outKey = key;
    document.body.className = 'out';
    patterns = [];
    const roles = ROLE === 'all' ? ['left', 'center', 'right'] : [ROLE];
    app.innerHTML = `<div class="wall sig">${roles.map((r) => `<div class="slot" data-r="${r}"></div>`).join('')}</div>
      <div id="hint">${esc(ROLES[ROLE] || ROLE)} 출력 · F 전체화면 · ← → 장면 · 1 패턴 2 스틸 3 가독성 4 라이브 0 검정</div>`;
    roles.forEach((r) => region($(`[data-r="${r}"]`), ROLE === 'all' ? r : ROLE, { preview: false }));
  }
  function outKeys() {
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyF') (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
      const modes = { Digit1: 'pattern', Digit2: 'stills', Digit3: 'read', Digit4: 'live', Digit0: 'black' };
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
    if (!('getScreenDetails' in window)) { screensErr = '이 브라우저는 디스플레이 목록을 지원하지 않습니다 (Chrome 권장). 아래 버튼으로 창을 열어 해당 화면으로 끌어다 놓으세요.'; render(); return; }
    try {
      const d = await window.getScreenDetails();
      screens = d.screens;
      d.addEventListener('screenschange', () => { screens = d.screens; render(); });
    } catch (e) { screensErr = '권한이 거부되었습니다. 주소창 왼쪽 아이콘에서 “창 관리” 권한을 허용하세요.'; }
    render();
  }
  function openOut(role, scr) {
    const name = `test-${role}`;
    if (scr) {
      const f = `left=${scr.availLeft},top=${scr.availTop},width=${scr.availWidth},height=${scr.availHeight}`;
      window.open(`test.html?out=1&role=${role}`, name, f);
    } else window.open(`test.html?out=1&role=${role}`, name, 'width=960,height=540');
  }

  const STEP = (s) => STILLS[s] || { title: '스틸 없음', what: '' };
  function aspectSel(k) {
    const v = S.venue[k];
    return `<select data-asp="${k}">${ASPECTS.map(([n]) => `<option ${v.a === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <input data-w="${k}" type="number" step="0.01" value="${v.w}" ${v.a === '직접 입력' ? '' : 'disabled'}> : <input data-h="${k}" type="number" step="0.01" value="${v.h}" ${v.a === '직접 입력' ? '' : 'disabled'}>
      <label>가로 폭 <input data-m="${k}" type="number" step="0.1" value="${v.m}"> m</label>`;
  }
  function sizeText(k) {
    const ph = phys(S.venue[k]);
    return `${ph.w.toFixed(1)} × ${ph.h.toFixed(2)} m · 대각 <b>${Math.round(ph.inch)}″</b> · 비율 ${aspect(S.venue[k]).toFixed(2)}:1`;
  }
  function compSel(role) {
    const c = S.comp[role] || [role];
    const opt = (sel) => ['left', 'center', 'right'].map((s) => `<option value="${s}" ${sel === s ? 'selected' : ''}>${SRC[s]}</option>`).join('');
    return `<div class="comp"><b>${ROLES[role]}</b><select data-comp="${role}:0">${opt(c[0])}</select><select data-comp="${role}:1"><option value="">— (1분할)</option>${opt(c[1])}</select></div>`;
  }

  function renderConsole() {
    document.body.className = 'con';
    patterns = [];
    const st = STEP(S.step);
    const scr = screens ? screens.map((s, i) => `<tr><td>${i + 1}${s.isPrimary ? ' · 기본' : ''}${s.isInternal ? ' · 내장' : ''}</td><td>${esc(s.label || '')}</td><td>${s.width}×${s.height}</td><td>${s.devicePixelRatio}</td><td>${(s.width / s.height).toFixed(3)} (${nearest(s.width / s.height)})</td><td>${['left', 'center', 'right', 'all', 'sides'].map((r) => `<button data-open="${r}:${i}">${ROLES[r]}</button>`).join('')}</td></tr>`).join('') : '';
    app.innerHTML = `
    <header><b>모니터 테스트 모드</b><span>대강당 3면 · 현장 사전 점검</span><em id="lk">${Link.transport === 'lan' ? '● LAN 릴레이' : '● 이 PC'}</em></header>
    <main>
      <section class="card wide"><h2>① 벽면 미리보기 <small>현장 화면비로 본 3면 · 아래 설정 반영</small></h2>
        <div class="wallwrap"><div class="wall phys">${['left', 'center', 'right'].map((r) => `<div class="slot" data-pr="${r}" style="aspect-ratio:${aspect(screenOf(r))}"></div>`).join('')}</div></div>
        <div class="bar">
          <div class="seg">${[['pattern', '1 패턴'], ['stills', '2 스틸'], ['read', '3 가독성'], ['live', '4 라이브'], ['black', '0 검정']].map(([m, n]) => `<button data-mode="${m}" class="${S.mode === m ? 'on' : ''}">${n}</button>`).join('')}</div>
          <div class="seg"><button data-step="-1">◀</button><span class="stp"><b>${S.step + 1}/${STILLS.length || 0} ${esc(st.title)}</b><small>${esc(st.what || '')}</small></span><button data-step="1">▶</button></div>
          <div class="seg"><button data-fit="fit" class="${S.fit === 'fit' ? 'on' : ''}">맞춤 (레터박스)</button><button data-fit="fill" class="${S.fit === 'fill' ? 'on' : ''}">채움 (잘림)</button><button data-labels class="${S.labels ? 'on' : ''}">라벨</button></div>
        </div>
        <div class="steps">${STILLS.map((s, i) => `<button data-go="${i}" class="${i === S.step ? 'on' : ''}"><img src="assets/test/stills/${s.key}_center.jpg" alt=""><span>${i + 1}. ${esc(s.title)}</span></button>`).join('')}</div>
      </section>

      <section class="card"><h2>② 현장 스크린 <small>영상 · 도면 · 실측으로 입력</small></h2>
        <div class="vrow"><b>가운데</b>${aspectSel('center')}</div><p class="sz">${sizeText('center')}</p>
        <div class="vrow"><b>양쪽</b>${aspectSel('side')}</div><p class="sz">${sizeText('side')}</p>
        <div class="vrow"><b>맨 뒷줄 거리</b><label><input data-dist type="number" step="1" value="${S.venue.dist}"> m</label></div>
        <p class="note">대각 인치 = √(가로² + 세로²) ÷ 0.0254. 가로가 아주 긴 스크린은 인치보다 <b>가로 × 세로(m)</b>와 비율이 중요합니다. 16:9 300″ ≈ 6.6 × 3.7 m.</p>
        <h3>화면별 구성 (스틸 · 가독성에 반영)</h3>
        ${['left', 'center', 'right', 'sides'].map(compSel).join('')}
        <p class="note">가로가 긴 스크린은 16:9 화면 2개를 나란히 (예: 계기판/HU + 상담센터) 두는 구성이 빈 공간이 적습니다.</p>
      </section>

      <section class="card"><h2>③ 출력 창 <small>HDMI · 디스플레이마다 하나</small></h2>
        <p class="note">Chrome에서 <b>디스플레이 감지</b> → 각 디스플레이 줄의 역할 버튼을 누르면 그 화면에 창이 열립니다. 열린 창에서 <b>F</b> = 전체화면.</p>
        <div class="row"><button data-detect class="pri">디스플레이 감지</button>${['left', 'center', 'right', 'all', 'sides'].map((r) => `<button data-open="${r}">${ROLES[r]} 창</button>`).join('')}</div>
        ${screensErr ? `<p class="warn">${esc(screensErr)}</p>` : ''}
        ${screens ? `<table><tr><th>#</th><th>이름</th><th>해상도</th><th>DPR</th><th>비율</th><th>이 화면에 열기</th></tr>${scr}</table>` : ''}
        <h3>소리</h3>
        <div class="row"><button data-tone="-1">◀ 왼쪽 톤</button><button data-tone="0">가운데 톤</button><button data-tone="1">오른쪽 톤 ▶</button><button data-voice>상담원 음성 샘플</button></div>
        <h3>바로가기</h3>
        <div class="row"><a href="stage.html?screen=all" target="_blank">3면 미리보기</a><a href="control.html" target="_blank">컨트롤 패널</a><a href="hu.html" target="_blank">HU</a><a href="flow.html" target="_blank">데이터 흐름</a><a href="ccw.html" target="_blank">상담센터</a></div>
      </section>

      <section class="card"><h2>④ 연결 시나리오 <small>M5 MacBook Air · 외부 2대</small></h2>${GUIDE}</section>

      <section class="card wide"><h2>⑤ 현장 체크리스트 <small>이 브라우저에 저장 · 복사해서 공유</small></h2>
        <div class="checks">${CHECKS.map(([grp, items], g) => `<div><h3>${grp}</h3>${items.map((t, i) => { const k = `${g}.${i}`; const v = (S.checks || {})[k] || ''; return `<div class="ck ${v}"><span>${esc(t)}</span><button data-ck="${k}:ok">OK</button><button data-ck="${k}:ng">문제</button></div>`; }).join('')}</div>`).join('')}</div>
        <textarea data-notes rows="4" placeholder="현장 메모: 해상도, 화면비, 연결 방식, 보이지 않는 글자, 소리 등">${esc(S.notes || '')}</textarea>
        <div class="row"><button data-copy class="pri">결과 복사</button><button data-reset>설정 초기화</button></div>
      </section>
    </main>`;
    ['left', 'center', 'right'].forEach((r) => region($(`[data-pr="${r}"]`), r, { preview: true }));
  }

  const GUIDE = `
    <div class="g"><b>A. 무대 장비가 1개 입력을 3분할</b> (프로세서 · 엣지블렌딩)
      <p>맥 → C to HDMI 1개 → 장비. 맥에 큰 디스플레이 1대로 보이면(예: 5760×1080) 그 화면에 <em>3면 한 소스</em> 창을 엽니다. 패턴의 LEFT/CENTER/RIGHT가 제자리에 나오는지, 원이 둥근지 확인.</p></div>
    <div class="g"><b>B. 스크린마다 입력 따로</b> (HDMI 3개)
      <p>맥 단독으로는 외부 2대까지라 서로 다른 화면 3개는 안 됩니다. 가운데 = C to HDMI, 양쪽 = C to 2HDMI(같은 화면 복제) → 양쪽 창은 <em>양쪽 (미러)</em> 역할로 엽니다. 양쪽에 같은 그림이 나가므로 ②에서 양쪽 구성을 “고객 + 상담센터” 2분할로 두는 안을 점검하세요.</p>
      <p>3면을 모두 다르게 하려면: ① 현장 스위처/프로세서 사용 ② DisplayLink 어댑터(추가 디스플레이) ③ 두 번째 노트북을 같은 와이파이에 두고 <code>node tools/relay.mjs</code> 주소로 한 화면 담당 (이미 지원).</p></div>
    <div class="g"><b>C. 비상: 가운데 1면만</b><p>가운데에 <em>3면 한 소스</em> 또는 데이터 흐름만. 상담 화면은 리모컨 · 아이패드.</p></div>
    <div class="g"><b>맥 설정</b><p>시스템 설정 › 디스플레이: 미러링/확장 확인, 해상도 “기본값” 확인, 배열에서 화면 순서를 실제 좌·우와 일치. 소리 출력 = HDMI 장비. 방해금지 · 화면보호기 · 잠자기 끄기. 충전기 연결.</p></div>`;
  const CHECKS = [
    ['연결 · 신호', ['맥이 인식하는 외부 디스플레이 수와 해상도 기록', '한 소스 3분할 가능 여부 (A안)', '스크린별 입력 개수 (B안)', '왼쪽/가운데/오른쪽 순서가 맞음 (스윕 바가 왼→오)', '원이 동그랗다 (늘어남 없음)', '네 모서리 · 노란 점선 보임 (잘림 없음)', '색 막대 · 회색 단계 구분됨']],
    ['가독성 · 구성', ['맨 뒷줄에서 자막(52px) 읽힘', '맨 뒷줄에서 흐름 노드 이름(30px) 읽힘', '상담센터 화면(작은 표) 확대 장면이 읽힘', '레터박스(빈 공간)가 거슬리지 않음 / 채움 시 잘림 확인', '스크린 실제 화면비 측정 (②에 입력)']],
    ['소리 · 진행', ['왼쪽 · 가운데 · 오른쪽 톤 들림', '상담원 · 고객 음성 크기 적당', '리모컨(태블릿) 와이파이 연결 · 반응', '1막 인바운드 끝까지 진행', '2막 아웃바운드 · 클로징 진행', '조명 아래 밝기 · 반사 확인']],
  ];

  /* ---------------- console events ---------------- */
  let ac = null;
  function tone(pan) {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), gn = ac.createGain(), p = ac.createStereoPanner();
    o.frequency.value = pan < 0 ? 523 : pan > 0 ? 784 : 659;
    p.pan.value = pan;
    gn.gain.setValueAtTime(0, ac.currentTime); gn.gain.linearRampToValueAtTime(0.25, ac.currentTime + 0.05); gn.gain.setValueAtTime(0.25, ac.currentTime + 1.2); gn.gain.linearRampToValueAtTime(0, ac.currentTime + 1.4);
    o.connect(gn).connect(p).connect(ac.destination);
    o.start(); o.stop(ac.currentTime + 1.5);
  }
  function wire() {
    app.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      if (d.mode) set({ mode: d.mode });
      else if (d.step) set({ step: Math.max(0, Math.min(STILLS.length - 1, S.step + +d.step)) });
      else if (d.go) set({ step: +d.go, mode: S.mode === 'stills' || S.mode === 'read' ? S.mode : 'stills' });
      else if (d.fit) set({ fit: d.fit });
      else if ('labels' in d) set({ labels: !S.labels });
      else if ('detect' in d) detect();
      else if (d.open) { const [r, i] = d.open.split(':'); openOut(r, i != null && screens ? screens[+i] : null); }
      else if (d.tone) tone(+d.tone);
      else if ('voice' in d) new Audio('assets/audio/ecare_v4_02_agent.mp3').play();
      else if (d.ck) { const [k, v] = d.ck.split(':'); const c = Object.assign({}, S.checks); c[k] = c[k] === v ? '' : v; set({ checks: c }); }
      else if ('copy' in d) copy();
      else if ('reset' in d) { if (confirm('화면 설정과 체크리스트를 초기화할까요?')) { S = JSON.parse(JSON.stringify(DEF)); set({}); } }
    });
    app.addEventListener('change', (e) => {
      const d = e.target.dataset, v = e.target.value;
      const venue = JSON.parse(JSON.stringify(S.venue));
      if (d.asp) { const a = ASPECTS.find((x) => x[0] === v); Object.assign(venue[d.asp], { a: v }, a[1] ? { w: a[1], h: a[2] } : {}); set({ venue }); }
      else if (d.w) { venue[d.w].w = +v || 1; set({ venue }); }
      else if (d.h) { venue[d.h].h = +v || 1; set({ venue }); }
      else if (d.m) { venue[d.m].m = +v || 1; set({ venue }); }
      else if ('dist' in d) { venue.dist = +v || 1; set({ venue }); }
      else if (d.comp) { const [r, i] = d.comp.split(':'); const comp = JSON.parse(JSON.stringify(S.comp)); const c = comp[r] || [r]; c[+i] = v; comp[r] = c.filter(Boolean); if (!comp[r].length) comp[r] = [r]; set({ comp }); }
      else if ('notes' in d) set({ notes: v });
    });
  }
  function copy() {
    const lines = [`[모니터 테스트] ${new Date().toLocaleString('ko-KR')}`,
      `가운데: ${S.venue.center.a} ${sizeText('center').replace(/<[^>]+>/g, '')}`,
      `양쪽: ${S.venue.side.a} ${sizeText('side').replace(/<[^>]+>/g, '')}`,
      `맨 뒷줄: ${S.venue.dist}m`,
      `구성: ${['left', 'center', 'right', 'sides'].map((r) => `${ROLES[r]}=${(S.comp[r] || [r]).map((x) => SRC[x]).join('+')}`).join(' / ')}`];
    if (screens) lines.push(`디스플레이: ${screens.map((s, i) => `${i + 1}) ${s.label || ''} ${s.width}×${s.height}@${s.devicePixelRatio}`).join(', ')}`);
    CHECKS.forEach(([grp, items], g) => items.forEach((t, i) => { const v = (S.checks || {})[`${g}.${i}`]; lines.push(`${v === 'ok' ? '✓' : v === 'ng' ? '✗' : '·'} ${grp} — ${t}`); }));
    if (S.notes) lines.push('', S.notes);
    navigator.clipboard.writeText(lines.join('\n')).then(() => alert('복사했습니다.'), () => prompt('복사하세요', lines.join('\n')));
  }

  function render() {
    if (OUT) renderOut();
    else {
      // don't rebuild under a field being typed in
      const f = document.activeElement;
      if (f && app.contains(f) && f.matches('textarea, input')) { ['left', 'center', 'right'].forEach((r) => { const el = $(`[data-pr="${r}"]`); if (el) region(el, r, { preview: true }); }); return; }
      renderConsole();
    }
  }
  if (OUT) { outKeys(); Link.send('test-hello', {}); } else { wire(); Link.on('@transport', () => { const e = $('#lk'); if (e) e.textContent = '● LAN 릴레이'; }); }
  addEventListener('resize', () => { if (OUT && S.mode !== 'live') renderOut(true); });
  render();
})();
