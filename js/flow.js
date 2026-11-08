/* e-Care data flow monitor. Draws the systems involved (vehicle, Japan server
 * VDP, Korea server TSP with VEP / WAM / OPW / SMS, the support center CCW,
 * dispatch, service center DMS, customer phone) and
 * animates every message the director records in snapshot.flows, labelled
 * with the interface name from the e-Care interface definition. */
(function () {
  'use strict';

  const E = window.ECare;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.getElementById('board');
  const G = window.gsap && window.MotionPathPlugin ? window.gsap : null;   // GSAP packets when loaded (pilot)
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');

  /* systems, at 1920x1080: an easy name on top, the project name below.
   * Zones run left to right: customer → Japan server (VDP) → Korea server
   * (TSP: VEP + WAM) → response (e-Care support center with CTI, dispatch,
   * service center). */
  const N = {
    // three rows: the main path on top, support systems in the middle, the phone and DMS below
    car: { x: 195, y: 330, w: 270, t: '고객 차량', s: 'DCM · 헤드유닛', zone: 'cust' },
    phone: { x: 195, y: 735, w: 270, t: '고객 휴대폰', s: 'Global App · 문자', zone: 'cust' },
    vdp: { x: 520, y: 330, w: 250, t: '차량 신호 수집', s: 'VDP · 고객 알림 중계', zone: 'jp' },
    // TSP (VEP) filters and judges the case, maps the customer's text; it sends to CCW and DMS
    // itself, and the customer's text back through VDP to the car and the phone
    vep: { x: 1000, y: 470, w: 380, h: 136, t: '경고 판정 · 고객 문구', s: 'VEP · 필터 · Case 분류 · 문구 매핑', zone: 'kr' },
    ccw: { x: 1607, y: 330, w: 320, t: '상담원 화면', s: 'CCW', zone: 'res' },
    rescue: { x: 1607, y: 560, w: 320, t: '긴급출동', s: '마스터자동차', zone: 'res' },
    dms: { x: 1607, y: 735, w: 320, t: '서비스센터 (딜러)', s: 'DMS', zone: 'res' },
  };
  const ZONES = [
    { k: 'cust', x: 40, w: 310, t: '고객', tag: '', col: '#9fb6d6' },
    { k: 'jp', x: 375, w: 290, t: '일본측 서버', tag: 'VDP', col: '#c58bff' },
    { k: 'kr', x: 690, w: 620, t: '한국측 서버', tag: 'TSP', col: '#5aa2ff' },
    { k: 'res', x: 1335, w: 545, t: '대응', tag: '', col: '#3ddc84' },
  ];
  const ZCOL = Object.fromEntries(ZONES.map((z) => [z.k, z.col]));
  const W = 250, H = 104;
  const size = (n) => ({ w: n.w || W, h: n.h || H });
  // the backbone drawn at rest; other messages (calls, alerts) draw their path while they travel
  const LINKS = [['car', 'vdp'], ['vdp', 'vep'], ['vep', 'ccw'], ['vep', 'dms'], ['vdp', 'phone'], ['ccw', 'rescue'], ['ccw', 'dms'], ['dms', 'phone']];
  const CASECOL = { A: '#ff4d5e', B: '#ffb02e', C: '#3fd0c9' };
  const BLUE = '#5aa2ff';
  const FIELD_COL = '#e0a54a';

  let snap = null;
  let seen = 0;              // highest flow id animated
  let first = true;
  const packets = [];
  const chips = [];
  const glow = {};
  const counts = {};
  let caption = null;

  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  /* ---------------- static board ---------------- */
  svg.innerHTML = `
    <defs>
      <linearGradient id="nodeBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16243a"/><stop offset="1" stop-color="#0d1626"/></linearGradient>
      <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
      <filter id="dot" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <g id="zones"></g><g id="links"></g><g id="nodes"></g><g id="cards"></g><g id="pk"></g><g id="chips"></g><g id="hud"></g><g id="foot"></g>`;
  const g = (id) => svg.querySelector('#' + id);

  // zones, and the support center group (CCW + CTI) inside the response zone
  ZONES.forEach((z) => {
    el('rect', { x: z.x, y: 150, width: z.w, height: 700, rx: 26, fill: 'rgba(120,160,220,0.035)', stroke: 'rgba(140,180,240,0.12)', 'stroke-width': 2 }, g('zones'));
    el('rect', { x: z.x + 24, y: 172, width: 6, height: 30, rx: 3, fill: z.col }, g('zones'));
    const t = el('text', { x: z.x + 42, y: 197, fill: '#dfe7f3', 'font-size': 27, 'font-weight': 800 }, g('zones'));
    t.textContent = z.t;
    if (z.tag) {
      const tg = el('g', { transform: `translate(${z.x + 54 + z.t.length * 25},174)` }, g('zones'));
      el('rect', { width: z.tag.length * 15 + 24, height: 32, rx: 9, fill: z.col, 'fill-opacity': 0.16, stroke: z.col, 'stroke-opacity': 0.6 }, tg);
      el('text', { x: 12, y: 23, fill: z.col, 'font-size': 21, 'font-weight': 800, class: 'num' }, tg).textContent = z.tag;
    }
  });
  el('rect', { x: 1355, y: 222, width: 505, height: 186, rx: 20, fill: 'rgba(61,220,132,0.05)', stroke: 'rgba(61,220,132,0.4)', 'stroke-width': 2, 'stroke-dasharray': '8 7' }, g('zones'));
  el('text', { x: 1378, y: 256, fill: '#8ff0b3', 'font-size': 22, 'font-weight': 800 }, g('zones')).textContent = 'e-Care 고객지원실';

  /* links run edge to edge as S-curves: sideways between columns, up/down
   * within one. SMS → phone dips under the bottom row so it clears OPW. */
  const UNDER = { 'phone|sms': 820 };     // key: the two ids sorted; the first is the left box
  const OVER = { 'car|vep': 246 };        // top edge to top edge, over the boxes between
  const RIGHT = { 'ccw|rescue': 1838, 'ccw|dms': 1838 };   // around the right of the column
  /* calls between the customer and the agent: the car's head unit (MM call) over the
   * top of the boxes, the customer's phone along the corridor under the cards */
  const VOICE = {
    'car|ccw': 'M195,278 C195,240 210,228 250,228 L1560,228 C1600,228 1607,240 1607,278',
    'ccw|phone': 'M330,735 C380,735 400,830 450,830 L1360,830 C1405,830 1410,815 1410,700 L1410,400 C1410,345 1420,330 1447,330',
  };
  const mid = (d) => { const t = document.createElementNS(NS, 'path'); t.setAttribute('d', d); svg.appendChild(t); const L = t.getTotalLength(); const m = t.getPointAtLength(L / 2); t.remove(); return m; };
  const path = (a, b) => {
    const key = [a, b].sort().join('|');
    if (VOICE[key]) {
      // walk the fixed route from a to b (the strings run from the customer side)
      const fromCust = a === 'car' || a === 'phone';
      const d = fromCust ? VOICE[key] : reversePath(VOICE[key]);
      const m = mid(VOICE[key]);
      return { d, mx: m.x, my: m.y };
    }
    const flip = a > b;                         // draw one curve per pair, walk it either way
    const [p, q] = flip ? [b, a] : [a, b];
    const A = N[p], B = N[q], sa = size(A), sb = size(B);
    const dx = B.x - A.x, dy = B.y - A.y;
    let P0, P1, P2, P3;
    if (OVER[key] != null) {
      const hi = OVER[key];
      P0 = [A.x, A.y - sa.h / 2]; P1 = [A.x, hi]; P2 = [B.x, hi]; P3 = [B.x, B.y - sb.h / 2];
    } else if (RIGHT[key] != null) {
      const xr = RIGHT[key];
      P0 = [A.x + sa.w / 2, A.y]; P1 = [xr, A.y]; P2 = [xr, B.y]; P3 = [B.x + sb.w / 2, B.y];
    } else if (UNDER[key] != null) {
      // A is the left box (its right edge), B the box above the dip (its bottom)
      const lo = UNDER[key];
      P0 = [A.x + sa.w / 2, A.y]; P1 = [A.x + sa.w / 2 + 200, lo]; P2 = [B.x, lo]; P3 = [B.x, B.y + sb.h / 2];
    } else if (Math.abs(dx) > Math.abs(dy) * 0.8) {
      const sg = Math.sign(dx);
      const x1 = A.x + sg * sa.w / 2, x2 = B.x - sg * sb.w / 2;
      const k = Math.max(60, Math.abs(x2 - x1) * 0.45);
      P0 = [x1, A.y]; P1 = [x1 + sg * k, A.y]; P2 = [x2 - sg * k, B.y]; P3 = [x2, B.y];
    } else {
      const sg = Math.sign(dy) || 1;
      const y1 = A.y + sg * sa.h / 2, y2 = B.y - sg * sb.h / 2;
      const k = Math.max(40, Math.abs(y2 - y1) * 0.45);
      P0 = [A.x, y1]; P1 = [A.x, y1 + sg * k]; P2 = [B.x, y2 - sg * k]; P3 = [B.x, y2];
    }
    if (flip) [P0, P1, P2, P3] = [P3, P2, P1, P0];
    const mx = (P0[0] + 3 * P1[0] + 3 * P2[0] + P3[0]) / 8, my = (P0[1] + 3 * P1[1] + 3 * P2[1] + P3[1]) / 8;
    return { d: `M${P0[0]},${P0[1]} C${P1[0]},${P1[1]} ${P2[0]},${P2[1]} ${P3[0]},${P3[1]}`, mx, my };
  };
  // reverse an SVG path of M / L / C segments (absolute coordinates)
  function reversePath(d) {
    const segs = d.match(/[MLC][^MLC]*/g).map((x) => ({ c: x[0], p: x.slice(1).trim().split(/[\s,]+/).map(Number) }));
    const pts = []; let cur;
    const out = [];
    segs.forEach((sg) => {
      if (sg.c === 'M') { cur = [sg.p[0], sg.p[1]]; return; }
      if (sg.c === 'L') { out.push({ c: 'L', from: cur, to: [sg.p[0], sg.p[1]] }); cur = [sg.p[0], sg.p[1]]; }
      if (sg.c === 'C') { out.push({ c: 'C', from: cur, c1: [sg.p[0], sg.p[1]], c2: [sg.p[2], sg.p[3]], to: [sg.p[4], sg.p[5]] }); cur = [sg.p[4], sg.p[5]]; }
    });
    let r = `M${cur[0]},${cur[1]}`;
    out.reverse().forEach((x) => { r += x.c === 'L' ? ` L${x.from[0]},${x.from[1]}` : ` C${x.c2[0]},${x.c2[1]} ${x.c1[0]},${x.c1[1]} ${x.from[0]},${x.from[1]}`; });
    void pts;
    return r;
  }
  const linkEls = {};
  LINKS.forEach(([a, b]) => {
    const p = path(a, b);
    linkEls[a + b] = linkEls[b + a] = el('path', { d: p.d, fill: 'none', stroke: 'rgba(120,160,220,0.045)', 'stroke-width': 3, 'stroke-dasharray': '2 10', 'stroke-linecap': 'round' }, g('links'));
  });

  // nodes: easy name, project name, a colour bar for the zone
  const nodeEls = {};
  for (const k in N) {
    const n = N[k];
    const { w, h } = size(n);
    const small = h < H;
    const grp = el('g', { transform: `translate(${n.x - w / 2},${n.y - h / 2})` }, g('nodes'));
    const halo = el('rect', { x: -12, y: -12, width: w + 24, height: h + 24, rx: 30, fill: BLUE, opacity: 0, filter: 'url(#soft)' }, grp);
    el('rect', { width: w, height: h, rx: 18, fill: 'url(#nodeBg)', stroke: 'rgba(150,190,255,0.3)', 'stroke-width': 2 }, grp);
    el('rect', { x: 0, y: 14, width: 6, height: h - 28, rx: 3, fill: ZCOL[n.zone] }, grp);
    const t = el('text', { x: 26, y: small ? 40 : 47, fill: '#eef3fb', 'font-size': small ? 27 : 32, 'font-weight': 800 }, grp); t.textContent = n.t;
    const s2 = el('text', { x: 26, y: small ? 70 : 82, fill: ZCOL[n.zone], 'font-size': 21, 'font-weight': 700, class: 'num' }, grp); s2.textContent = n.s;
    const badge = el('g', { opacity: 0 }, grp);
    el('rect', { x: w - 30, y: -16, width: 46, height: 32, rx: 16, fill: '#24406a', stroke: '#0a1220', 'stroke-width': 3 }, badge);
    const bt = el('text', { x: w - 7, y: 7, fill: '#cfe1ff', 'font-size': 19, 'font-weight': 700, 'text-anchor': 'middle', class: 'num' }, badge);
    nodeEls[k] = { halo, badge, bt, grp };
  }

  // Case judgement card (under VEP) and workflow / SLA card (under WAM)
  const card = (x, y, w, h, title) => {
    const grp = el('g', { transform: `translate(${x},${y})` }, g('cards'));
    el('rect', { width: w, height: h, rx: 18, fill: 'rgba(10,18,32,0.85)', stroke: 'rgba(150,190,255,0.18)', 'stroke-width': 2 }, grp);
    const t = el('text', { x: 22, y: 38, fill: '#7f93b0', 'font-size': 21, 'font-weight': 700 }, grp); t.textContent = title;
    return grp;
  };
  const caseCard = card(700, 382, 290, 300, '경고 등급 · WNG master');
  caseCard.style.display = 'none';      // removed: the step rail tells where the case is
  const cc = {
    code: el('text', { x: 22, y: 104, fill: '#eef3fb', 'font-size': 54, 'font-weight': 800, class: 'num' }, caseCard),
    name: el('text', { x: 22, y: 146, fill: '#c9d6ea', 'font-size': 26, 'font-weight': 700 }, caseCard),
    badgeBg: el('rect', { x: 22, y: 172, width: 120, height: 46, rx: 12, fill: '#2a3448' }, caseCard),
    badge: el('text', { x: 82, y: 204, fill: '#fff', 'font-size': 26, 'font-weight': 800, 'text-anchor': 'middle' }, caseCard),
    kind: el('text', { x: 156, y: 204, fill: '#c9d6ea', 'font-size': 22, 'font-weight': 700 }, caseCard),
    owner: el('text', { x: 22, y: 254, fill: '#9fb6d6', 'font-size': 22, 'font-weight': 600 }, caseCard),
    src: el('text', { x: 22, y: 284, fill: '#5f7392', 'font-size': 17, 'font-weight': 600 }, caseCard),
  };
  const slaCard = card(1005, 382, 290, 300, '처리 기한 · SLA');
  slaCard.style.display = 'none';
  const sc = {
    ringBg: el('circle', { cx: 92, cy: 178, r: 62, fill: 'none', stroke: '#1e2b40', 'stroke-width': 14 }, slaCard),
    ring: el('circle', { cx: 92, cy: 178, r: 62, fill: 'none', stroke: CASECOL.A, 'stroke-width': 14, 'stroke-linecap': 'round', transform: 'rotate(-90 92 178)', 'stroke-dasharray': `${2 * Math.PI * 62}`, 'stroke-dashoffset': 0 }, slaCard),
    left: el('text', { x: 92, y: 190, fill: '#fff', 'font-size': 34, 'font-weight': 700, 'text-anchor': 'middle', class: 'num' }, slaCard),
    l1: el('text', { x: 172, y: 150, fill: '#7f93b0', 'font-size': 19, 'font-weight': 700 }, slaCard),
    v1: el('text', { x: 172, y: 182, fill: '#eef3fb', 'font-size': 25, 'font-weight': 800 }, slaCard),
    l2: el('text', { x: 172, y: 222, fill: '#7f93b0', 'font-size': 19, 'font-weight': 700 }, slaCard),
    v2: el('text', { x: 172, y: 254, fill: '#eef3fb', 'font-size': 25, 'font-weight': 800 }, slaCard),
    foot: el('text', { x: 22, y: 284, fill: '#5f7392', 'font-size': 17, 'font-weight': 600 }, slaCard),
  };

  // header
  const hud = g('hud');
  const tt = el('text', { x: 52, y: 72, fill: '#eef3fb', 'font-size': 38, 'font-weight': 800 }, hud); tt.textContent = 'e-Care 데이터 흐름';
  /* replay of the scenario just run, on this panel only: [다시 보기] plays every message again
   * in order, [한 단계씩] shows one message per press, [실시간] goes back to the live feed */
  const BTN = [['replay', '↻ 다시 보기'], ['step', '한 단계씩 ▶'], ['live', '● 실시간']];
  const btnEls = {};
  BTN.reduce((x, [k, label]) => {
    const grp = el('g', { transform: `translate(${x},88)`, class: 'fbtn', 'data-k': k, style: 'cursor:pointer' }, hud);
    const t = el('text', { x: 16, y: 23, fill: '#cfe1ff', 'font-size': 18, 'font-weight': 700 }, grp); t.textContent = label;
    const w = t.getBBox().width + 32;
    const r = el('rect', { width: w, height: 34, rx: 17, fill: 'rgba(90,162,255,0.10)', stroke: 'rgba(140,180,240,0.35)', 'stroke-width': 1.5 }, grp);
    grp.insertBefore(r, t);
    btnEls[k] = { grp, r, t };
    grp.addEventListener('click', () => onBtn(k));
    return x + w + 10;
  }, 52);
  const elapsedL = el('text', { x: 1868, y: 44, fill: '#7f93b0', 'font-size': 19, 'font-weight': 700, 'text-anchor': 'end' }, hud); elapsedL.textContent = '경고 발생 후 경과';
  const elapsed = el('text', { x: 1868, y: 98, fill: '#fff', 'font-size': 52, 'font-weight': 700, 'text-anchor': 'end', class: 'num' }, hud);
  const clock = el('text', { x: 1868, y: 128, fill: '#6f84a3', 'font-size': 20, 'font-weight': 700, 'text-anchor': 'end', class: 'num' }, hud);
  /* the journey rail: where the case is now, in six steps, read from the back of the room.
   * The step playing is lit in the case colour; its one-line explanation sits under the rail. */
  const STEPS = E.JOURNEY;
  const RX = 450, RW = 190, RG = 8;
  const rail = STEPS.map((t, i) => {
    const grp = el('g', { transform: `translate(${RX + i * (RW + RG)},26)` }, hud);
    const bg = el('rect', { width: RW, height: 50, rx: 25, fill: 'rgba(120,160,220,0.07)', stroke: 'rgba(140,180,240,0.18)', 'stroke-width': 2 }, grp);
    const n = el('text', { x: 24, y: 32, fill: '#5d7090', 'font-size': 18, 'font-weight': 800, 'text-anchor': 'middle', class: 'num' }, grp); n.textContent = i + 1;
    const lb = el('text', { x: 42, y: 32, fill: '#7f93b0', 'font-size': 18.5, 'font-weight': 700 }, grp); lb.textContent = t;
    return { bg, n, lb };
  });
  const nowT = el('text', { x: RX + (STEPS.length * (RW + RG) - RG) / 2, y: 120, fill: '#fff', 'font-size': 31, 'font-weight': 800, 'text-anchor': 'middle' }, hud);
  const stepOf = (c) => E.journey(c);
  let railKey = '';
  function tickRail() {
    const c = primary();
    const st = replay ? { i: replay.maxStep, d: replay.last ? `${replay.step ? '한 단계씩' : '다시 보기'} · ${replay.last.label}` : (replay.step ? '한 단계씩 — 버튼을 누를 때마다 다음 메시지' : '다시 보기') } : stepOf(c);
    const col = c ? CASECOL[(c.wng && c.wng.case) || c.wcase || 'A'] : BLUE;
    const key = st.i + '|' + st.d + '|' + col + '|' + !!replay;
    if (key === railKey) return;
    railKey = key;
    rail.forEach((r, i) => {
      const on = i === st.i, done = i < st.i;
      r.bg.setAttribute('fill', on ? col : done ? 'rgba(120,160,220,0.14)' : 'rgba(120,160,220,0.05)');
      r.bg.setAttribute('stroke', on ? col : 'rgba(140,180,240,0.18)');
      r.n.setAttribute('fill', on ? '#fff' : done ? '#8fa6c6' : '#4d5f7c');
      r.lb.setAttribute('fill', on ? '#fff' : done ? '#a9b8cf' : '#5d7090');
      r.n.textContent = done ? '✓' : i + 1;
    });
    nowT.textContent = st.d;
  }

  /* footer: the detailed message log, folded by default to one line (the newest
   * message); a tap or the control panel unfolds it to the last six messages */
  const foot = g('foot');
  let logOpen = false;
  const fbg = el('rect', { x: 40, y: 872, width: 1840, height: 64, rx: 20, fill: 'rgba(8,14,26,0.85)', stroke: 'rgba(150,190,255,0.14)', 'stroke-width': 2 }, foot);
  const fTitle = el('text', { x: 70, y: 934, fill: '#7f93b0', 'font-size': 22, 'font-weight': 800 }, foot); fTitle.textContent = '상세 데이터 흐름';
  const fHint = el('text', { x: 1850, y: 934, fill: '#5d7090', 'font-size': 21, 'font-weight': 700, 'text-anchor': 'end' }, foot);
  const ROWS = 6;
  const logEls = [...Array(ROWS)].map((i) => {
    const row = el('g', {}, foot);
    const tm = el('text', { x: 0, y: 0, fill: '#6f84a3', 'font-size': 22, 'font-weight': 600, class: 'num' }, row);
    const api = el('text', { x: 108, y: 0, fill: BLUE, 'font-size': 22, 'font-weight': 800 }, row);
    const lb = el('text', { x: 300, y: 0, fill: '#d4def0', 'font-size': 23, 'font-weight': 600 }, row);
    return { row, tm, api, lb };
  });
  function layoutFoot() {
    // folded: one line beside the title; open: six lines in two columns under it
    const open = logOpen && !replay;              // a replay shows the whole-journey bar instead
    fbg.setAttribute('y', open ? 872 : 872);
    fbg.setAttribute('height', open ? 196 : 64);
    fTitle.setAttribute('y', open ? 912 : 914);
    fHint.setAttribute('y', open ? 912 : 914);
    fHint.textContent = logOpen ? '▴ 접기' : '▾ 펼치기';
    logEls.forEach((r, i) => {
      const x = open ? (i < 3 ? 70 : 990) : 290, y = open ? 958 + (i % 3) * 38 : 914;
      r.row.setAttribute('transform', `translate(${x},${y})`);
      r.row.style.display = open || i === 0 ? '' : 'none';
    });
    renderLog();
  }
  function setLog(open) { logOpen = !!open; layoutFoot(); }
  foot.style.cursor = 'pointer';
  foot.addEventListener('click', () => { setLog(!logOpen); Link.send('flow-log', { open: logOpen }); });
  Link.on('flow-log', (d) => setLog(d.open));

  /* the whole journey while replaying: every message as a dot on one bar, grouped
   * by the six steps; played dots fill in, the one playing now is ringed */
  const prog = el('g', { style: 'display:none' }, g('foot'));
  el('rect', { x: 40, y: 948, width: 1840, height: 116, rx: 20, fill: 'rgba(8,14,26,0.92)', stroke: 'rgba(150,190,255,0.18)', 'stroke-width': 2 }, prog);
  const progT = el('text', { x: 70, y: 986, fill: '#9fb6d6', 'font-size': 21, 'font-weight': 800 }, prog);
  const progN = el('text', { x: 1850, y: 986, fill: '#fff', 'font-size': 24, 'font-weight': 800, 'text-anchor': 'end', class: 'num' }, prog);
  const progBody = el('g', {}, prog);
  let progKey = '';
  function renderProg() {
    prog.style.display = replay ? '' : 'none';
    if (!replay) { progKey = ''; return; }
    const L = replay.list, done = replay.i;
    const key = L.length + '|' + done;
    if (key === progKey) return;
    progKey = key;
    // the step of each message, never going back
    let mx = 0;
    const stg = L.map((f) => (mx = Math.max(mx, stepOfFlow(f))));
    const cnt = STEPS.map((_, k) => stg.filter((x) => x === k).length);
    const X0 = 70, X1 = 1850, GAPS = 14, MINS = 110;
    const used = cnt.filter((n) => n).length;
    const free = X1 - X0 - GAPS * (used - 1) - MINS * used;
    const total = L.length || 1;
    progBody.innerHTML = '';
    let x = X0;
    const col = replay.last ? CASECOL[replay.last.wcase] || BLUE : BLUE;
    const cur = done - 1;
    STEPS.forEach((t, k) => {
      if (!cnt[k]) return;
      const w = MINS + free * cnt[k] / total;
      const idx = stg.map((s2, i) => (s2 === k ? i : -1)).filter((i) => i >= 0);
      const playedAll = idx.every((i) => i < done), playing = idx.includes(cur);
      el('text', { x, y: 1018, fill: playing ? '#fff' : playedAll ? '#a9b8cf' : '#5d7090', 'font-size': 18, 'font-weight': 800 }, progBody).textContent = `${k + 1} ${t}`;
      el('rect', { x, y: 1032, width: w, height: 10, rx: 5, fill: 'rgba(120,160,220,0.12)' }, progBody);
      const pd = idx.filter((i) => i < done).length;
      const dotX = (j) => x + (idx.length === 1 ? w / 2 : 6 + (w - 12) * j / (idx.length - 1));
      if (pd) el('rect', { x, y: 1032, width: playedAll ? w : Math.max(10, dotX(pd - 1) - x + 5), height: 10, rx: 5, fill: col, 'fill-opacity': playedAll ? 0.55 : 0.9 }, progBody);
      idx.forEach((i, j) => {
        const cx = dotX(j);
        if (i === cur) {
          el('circle', { cx, cy: 1037, r: 11, fill: 'none', stroke: '#fff', 'stroke-width': 3 }, progBody);
          el('circle', { cx, cy: 1037, r: 6, fill: '#fff' }, progBody);
        } else el('circle', { cx, cy: 1037, r: 3, fill: i < done ? '#0b1422' : 'rgba(160,190,230,0.45)' }, progBody);
      });
      x += w + GAPS;
    });
    progT.textContent = replay.step ? '전체 과정 · 한 단계씩' : '전체 과정 · 다시 보기';
    progN.textContent = `${done} / ${L.length}`;
  }

  /* ---------------- replay (this panel only) ---------------- */
  let replay = null;                 // { list, i, step, maxStep, last }
  const norm = (f0) => (f0.from === 'cti' || f0.to === 'cti' ? { ...f0, from: f0.from === 'cti' ? 'ccw' : f0.from, to: f0.to === 'cti' ? 'ccw' : f0.to } : f0);
  function clearBoard() {
    queue.length = 0;
    shown = [];
    for (const k in touched) delete touched[k];
    for (const k in used) { const l = used[k]; if (l.dataset.extra) l.remove(); else l.setAttribute('class', ''); delete used[k]; }
    packets.splice(0).forEach((p) => { if (p.tl) p.tl.kill(); p.tail.remove(); p.dot.remove(); });
    chips.splice(0).forEach((c) => c.grp.remove());
    renderLog();
  }
  function onBtn(k) {
    const list = replayList();
    if (k === 'live') { replay = null; railKey = ''; btnState(); return; }
    if (!list.length) return;
    if (k === 'replay' || !replay || !replay.step) { clearBoard(); replay = { list, i: 0, step: k === 'step', maxStep: -1, last: null }; railKey = ''; lastLaunch = 0; }
    if (k === 'step') stepOnce();
    btnState();
  }
  function stepOnce() {
    if (!replay || replay.i >= replay.list.length) return;
    const f = replay.list[replay.i++];
    replay.last = f;
    replay.maxStep = Math.max(replay.maxStep, stepOfFlow(f));
    shown.push(f);
    launch(f);
    replay.lastGroup = [f];
    while (f.burst && replay.i < replay.list.length && replay.list[replay.i].burst === f.burst) { const x = replay.list[replay.i++]; shown.push(x); launch(x); replay.lastGroup.push(x); }
    // TSP's customer text reaches VDP and goes straight on to the car and the phone: the
    // relay is part of the same step, leaving VDP the moment the first packet lands there
    const nx = replay.list[replay.i];
    if (f.burst && nx && nx.burst === f.burst + 'v') {
      const rg = [];
      while (replay.i < replay.list.length && replay.list[replay.i].burst === nx.burst) rg.push(replay.list[replay.i++]);
      rg.forEach((x) => { shown.push(x); replay.lastGroup.push(x); replay.last = x; });
      const rp = replay;
      setTimeout(() => { if (replay === rp) { rg.forEach((x) => launch(x)); renderLog(); } }, E.TRAVEL);
    }
    renderLog();
    renderProg();
    notify();
  }
  function btnState() {
    renderProg();
    layoutFoot();
    const mode = !replay ? 'live' : replay.step ? 'step' : 'replay';
    for (const k in btnEls) {
      const on = k === mode;
      btnEls[k].r.setAttribute('fill', on ? 'rgba(90,162,255,0.32)' : 'rgba(90,162,255,0.10)');
      btnEls[k].r.setAttribute('stroke', on ? '#5aa2ff' : 'rgba(140,180,240,0.35)');
    }
    if (replay && replay.step) btnEls.step.t.textContent = `한 단계씩 ▶  ${replay.i}/${replay.list.length}`;
    else btnEls.step.t.textContent = '한 단계씩 ▶';
    const w = btnEls.step.t.getBBox().width + 32; btnEls.step.r.setAttribute('width', w);
    btnEls.live.grp.setAttribute('transform', `translate(${52 + (btnEls.replay.t.getBBox().width + 32) + 10 + w + 10},88)`);
  }
  const stepOfFlow = (f) => E.stageOfFlow(f);

  /* ---------------- embedding: the detail view of Final_Dataflow drives the replay ---------------- */
  const EMBED = new URLSearchParams(location.search).has('embed');
  if (EMBED) { document.body.classList.add('embed'); for (const k in btnEls) btnEls[k].grp.style.display = 'none'; }
  const listeners = [];
  function notify() { const st = ctlState(); listeners.forEach((fn) => { try { fn(st); } catch (e) { /* the host went away */ } }); }
  // the detail view may hand in a recorded run (after a reset there is nothing live to replay)
  let ext = null;
  const liveList = () => ((snap && snap.flows) || []).filter((f) => f.type !== 'skip').map(norm);
  const replayList = () => (ext && !liveList().length ? ext : liveList());
  function ctlState() {
    const list = replay ? replay.list : replayList();
    return { group: replay && replay.lastGroup ? replay.lastGroup : null, src: ext && !liveList().length ? 'recorded' : 'live', mode: replay ? (replay.step ? 'step' : 'play') : 'live', i: replay ? replay.i : list.length, n: list.length, last: replay ? replay.last : shown[shown.length - 1] || null, list, stage: replay ? replay.maxStep : (primary() ? stepOf(primary()).i : -1) };
  }
  /** the board as of message n (1 = the first): earlier paths drawn still, the n-th one animated */
  // one step on the board: a burst, and the relay that continues it (VDP → car · phone)
  const sameStep = (a, b) => !!(a && b && a.burst && b.burst && (b.burst === a.burst || b.burst === a.burst + 'v' || (a.burst.endsWith('v') && b.burst === a.burst)));
  function seek(n) {
    const list = replayList();
    if (!list.length) return;
    n = Math.max(0, Math.min(list.length, n));
    clearBoard();
    replay = { list, i: 0, step: true, maxStep: -1, last: null };
    // n counts messages; a burst is drawn whole
    let upto = n - 1;
    while (upto > 0 && upto < list.length && sameStep(list[upto - 1], list[upto])) upto--;
    for (let k = 0; k < upto; k++) {
      const f = list[k];
      if (f.from !== f.to) keep(f.from, f.to, f.wcase ? CASECOL[f.wcase] : BLUE);
      touched[f.from] = touched[f.to] = true;
      shown.push(f);
      replay.maxStep = Math.max(replay.maxStep, stepOfFlow(f));
      replay.last = f;
      replay.i++;
    }
    if (n > 0 && replay.i < list.length) stepOnce(); else renderLog();
    railKey = ''; btnState(); notify();
  }
  window.FlowCtl = {
    state: ctlState,
    seek,
    next: () => { const st = ctlState(); if (st.mode === 'live') seek(1); else if (replay.step) { stepOnce(); btnState(); } else { replay.step = true; stepOnce(); btnState(); } },
    // back one step: to just before the group (a burst) the last shown message belongs to
    prev: () => {
      const st = ctlState(), L = st.list;
      let k = (st.mode === 'live' ? st.n : st.i) - 1;
      while (k > 0 && L[k] && sameStep(L[k - 1], L[k])) k--;
      seek(k);
    },
    /** the first message of journey step k */
    stage: (k) => { const list = replayList(); let mx = 0; const at = list.findIndex((f) => (mx = Math.max(mx, stepOfFlow(f))) >= k); if (at >= 0) seek(at + 1); },
    play: () => { if (!replay) { onBtn('replay'); } else { replay.step = false; lastLaunch = 0; } btnState(); notify(); },
    pause: () => { if (replay) { replay.step = true; btnState(); notify(); } },
    live: () => { onBtn('live'); notify(); },
    onChange: (fn) => { listeners.push(fn); fn(ctlState()); },
    /** a recorded run to replay while nothing live is there (null: back to live only) */
    useList: (list) => { ext = list && list.length ? list.map(norm) : null; notify(); },
    source: () => (ext && !liveList().length ? 'recorded' : 'live'),
  };

  /* ---------------- link ---------------- */
  Link.on('ecare', (d) => { snap = d; ingest(); renderCards(); if (!replay) notify(); });
  // who speaks now (the call animation sends the voice that way)
  Link.on('say', (d) => { caption = { who: d.line.who, until: performance.now() + (d.line.dur || 4) * 1000 + 700 }; });
  Link.send('hello', { screen: 'flow' });

  /* Messages play one at a time in arrival order (the director sends them in
   * bursts); each one's description goes to the log as it plays. */
  const queue = [];
  let shown = [];             // messages already played, for the log
  let lastLaunch = 0;
  function ingest() {
    const fl = (snap && snap.flows) || [];
    if (!fl.length && seen) { replay = null; btnState(); reset(); }    // scenario reset
    // the presenter went back a step: the feed is shorter now, draw it again as it stands
    if (fl.length && seen && fl[fl.length - 1].id < seen) { reset(); first = true; }
    if (replay) {                                                     // replaying: the live feed waits
      for (const f0 of fl) if (f0.id > seen) seen = f0.id;
      return;
    }
    for (const f0 of fl) {
      if (f0.id <= seen) continue;
      const f = f0.from === 'cti' || f0.to === 'cti' ? { ...f0, from: f0.from === 'cti' ? 'ccw' : f0.from, to: f0.to === 'cti' ? 'ccw' : f0.to } : f0;
      seen = f.id;
      if (f.type === 'skip') { if (!first) queue.push(f); continue; }
      // joining mid-scenario: show the paths and the log, do not replay
      if (first) { if (f.from !== f.to) keep(f.from, f.to, f.wcase ? CASECOL[f.wcase] : BLUE); touched[f.from] = touched[f.to] = true; shown.push(f); continue; }
      queue.push(f);
    }
    first = false;
    renderLog();
  }
  function reset() {
    seen = 0;
    for (const k in touched) delete touched[k];
    for (const k in counts) counts[k] = 0;
    queue.length = 0;
    shown = [];
    for (const k in used) { const l = used[k]; if (l.dataset.extra) l.remove(); else l.setAttribute('class', ''); delete used[k]; }
    renderLog();
  }
  function pump(now) {
    if (replay && !replay.step) {
      if (replay.i >= replay.list.length) { if (now - lastLaunch > 6000) { replay = null; btnState(); } return; }
      if (now - lastLaunch < 1900) return;
      lastLaunch = now;
      stepOnce();
      return;
    }
    if (!queue.length) return;
    const gap = queue.length > 6 ? 900 : 1300;           // the director paces messages about as fast
    if (now - lastLaunch < gap) return;
    lastLaunch = now;
    const f = queue.shift();
    if (f.type === 'skip') { skip(); return; }
    const group = [f];
    while (f.burst && queue.length && queue[0].burst === f.burst) group.push(queue.shift());
    for (const x of group) { shown.push(x); launch(x); }
    while (shown.length > 40) shown.shift();
    renderLog();
  }

  /* Paths a message has taken stay drawn (solid, in the case colour) until
   * the scenario is reset; the backbone shows faintly before that. */
  const used = {};
  function keep(a, b, col) {
    const k = [a, b].sort().join('|');
    let l = linkEls[a + b];
    if (!l || !l.isConnected) {
      l = el('path', { d: path(a, b).d, fill: 'none', 'stroke-linecap': 'round' }, g('links'));
      l.dataset.extra = '1';
      linkEls[a + b] = linkEls[b + a] = l;
    }
    l.setAttribute('class', 'used');
    l.style.setProperty('--c', col);
    used[k] = l;
  }

  /* ---------------- packets ---------------- */
  const touched = {};
  // the detail view of Final_Dataflow: each packet the presenter plays sounds once, softly
  const sfxOn = () => { try { return EMBED && window.FlowSfx && parent.document.body.classList.contains('detail-on'); } catch (e) { return false; } };
  let sfxBurst = '';
  function launch(f) {
    if (sfxOn() && !(f.burst && f.burst === sfxBurst)) FlowSfx.play(f, f.deliver || f.burst ? E.TRAVEL : 1400);
    sfxBurst = f.burst || '';
    const col = f.field ? FIELD_COL : f.wcase ? CASECOL[f.wcase] : BLUE;   // a vehicle moved (field) in amber
    touched[f.from] = touched[f.to] = true;
    counts[f.to] = (counts[f.to] || 0) + 1;
    if (f.from === f.to) { flash(f.to, col); chip(f, N[f.to].x, N[f.to].y - 92, col, 5600, null, [{ x: N[f.to].x, y: N[f.to].y - 92 }, { x: N[f.to].x, y: N[f.to].y + 92 }, { x: N[f.to].x - 150, y: N[f.to].y - 92 }]); return; }
    const p0 = path(f.from, f.to);
    if (G) { gsLaunch(f, col, p0); return; }
    const p = p0;
    const tail = el('path', { d: p.d, fill: 'none', stroke: col, 'stroke-width': 6, 'stroke-linecap': 'round', opacity: 0.9 }, g('pk'));
    const L = tail.getTotalLength();
    tail.setAttribute('stroke-dasharray', `0 ${L}`);
    const dot = el('circle', { r: 13, fill: col, filter: 'url(#dot)' }, g('pk'));
    const pk = { f, tail, dot, L, t0: performance.now(), dur: f.deliver || f.burst ? E.TRAVEL : Math.min(2300, 950 + L * 1.3), col };
    packets.push(pk);
    chip(f, p.mx, p.my, col, 5600, pk);
    keep(f.from, f.to, col);
    flash(f.from, col, 0.35);
  }
  // label chips: placed along the message's path where they cover no system
  // box and no other label
  const boxes = () => Object.keys(N).map((k) => { const n = N[k]; const { w: w0, h: h0 } = size(n); const w = w0 + 16, h = h0 + 16; return { x: n.x - w / 2, y: n.y - h / 2, w, h }; })
    .concat([{ x: 1370, y: 230, w: 260, h: 36 }])
    .concat(ZONES.map((z) => ({ x: z.x, y: 160, w: z.w, h: 52 })));        // zone titles
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const MAX_CHIPS = 1;        // only the message playing now has a label; the log has the rest
  /* ---------------- GSAP packets (pilot) ----------------
   * A capsule that turns along its path with a comet tail, eased in and out; a small ripple
   * where it leaves, a larger one and the node's glow where it lands. Same travel time as
   * before (a screen waiting for the message reacts when it lands). */
  function ripple(x, y, col, big) {
    const c = el('circle', { cx: x, cy: y, r: 8, fill: 'none', stroke: col, 'stroke-width': big ? 4 : 3, opacity: 0.9 }, g('pk'));
    G.to(c, { attr: { r: big ? 86 : 42 }, opacity: 0, duration: big ? 1.1 : 0.7, ease: 'expo.out', onComplete: () => c.remove() });
  }
  function gsLaunch(f, col, p0) {
    const tail = el('path', { d: p0.d, fill: 'none', stroke: col, 'stroke-width': 6, 'stroke-linecap': 'round', opacity: 0.9 }, g('pk'));
    const L = tail.getTotalLength();
    const dot = el('g', {}, g('pk'));
    el('circle', { r: 26, fill: col, opacity: 0.22 }, dot);
    el('rect', { x: -19, y: -9, width: 38, height: 18, rx: 9, fill: col, filter: 'url(#dot)' }, dot);
    el('rect', { x: -10, y: -4, width: 20, height: 8, rx: 4, fill: '#fff', opacity: 0.9 }, dot);
    const dur = (f.deliver || f.burst ? E.TRAVEL : Math.min(2300, 950 + L * 1.3)) / 1000;
    const pk = { f, tail, dot, L, col, gs: true };
    const prog = { h: 0 }, COMET = 170;
    const draw = () => { const h = prog.h * L; tail.setAttribute('stroke-dasharray', `${Math.min(h, COMET)} ${L}`); tail.setAttribute('stroke-dashoffset', -Math.max(0, h - COMET)); };
    draw();
    const a = tail.getPointAtLength(0), b = tail.getPointAtLength(L);
    ripple(a.x, a.y, col, false);
    pk.tl = G.timeline({ onComplete: () => { tail.remove(); dot.remove(); const i = packets.indexOf(pk); if (i >= 0) packets.splice(i, 1); } })
      .fromTo(dot, { scale: 0.2, opacity: 0, transformOrigin: '50% 50%' }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(2.4)' }, 0)
      .to(dot, { duration: dur, ease: 'power2.inOut', motionPath: { path: tail, align: tail, alignOrigin: [0.5, 0.5], autoRotate: true } }, 0)
      .to(prog, { h: 1, duration: dur, ease: 'power2.inOut', onUpdate: draw }, 0)
      .add(() => { flash(f.to, col); ripple(b.x, b.y, col, true); }, dur)
      .to(dot, { scale: 1.9, opacity: 0, duration: 0.45, ease: 'power2.out' }, dur)
      .to(tail, { opacity: 0, duration: 0.5, ease: 'power1.out' }, dur);
    packets.push(pk);
    chip(f, p0.mx, p0.my, col, 5600, pk);
    keep(f.from, f.to, col);
    flash(f.from, col, 0.35);
  }

  function chip(f, x, y, col, ms, p, spots) {
    const live = chips.filter((c) => !c.out);
    live.slice(0, Math.max(0, live.length - MAX_CHIPS + 1)).forEach((c) => { c.out = performance.now(); });
    const grp = el('g', { opacity: 0 }, g('chips'));
    const txt = f.api;
    const t = el('text', { x: 0, y: 0, fill: '#fff', 'font-size': 26, 'font-weight': 800, 'text-anchor': 'middle' }, grp);
    t.textContent = txt.length > 38 ? txt.slice(0, 37) + '…' : txt;
    const bb = t.getBBox();
    const r = el('rect', { x: bb.x - 16, y: bb.y - 9, width: bb.width + 32, height: bb.height + 18, rx: 14, fill: 'rgba(6,12,22,0.94)', stroke: col, 'stroke-width': 2.5 }, grp);
    grp.insertBefore(r, t);
    const w = bb.width + 32, h = bb.height + 18;
    const now = performance.now();
    const taken = boxes().concat(chips.filter((c) => !c.out).map((c) => c.box));
    const cands = [];
    const pts = p ? [0.5, 0.38, 0.62, 0.28, 0.72].map((k) => p.tail.getPointAtLength(p.L * k)) : spots || [{ x, y }];
    for (const dy of [0, -40, 40, -84, 84, -128, 128]) for (const pt of pts) cands.push({ x: pt.x, y: pt.y + dy });
    // first spot that is free, otherwise the one with the least overlap
    const area = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    let best = cands[0], bestCost = Infinity;
    for (const c of cands) {
      const bx = { x: Math.max(50, Math.min(1870 - w, c.x - w / 2)), y: c.y - h / 2, w, h };
      if (bx.y < 140 || bx.y + h > 870) continue;
      const cost = taken.reduce((sum, b) => sum + area(bx, b), 0);
      if (cost < bestCost) { best = c; bestCost = cost; }
      if (cost === 0) break;
    }
    const cx = Math.max(50 + w / 2, Math.min(1870 - w / 2, best.x));
    grp.setAttribute('transform', `translate(${cx},${best.y - bb.y - bb.height / 2})`);
    const ch = { grp, t0: now, ms, box: { x: cx - w / 2, y: best.y - h / 2, w, h } };
    if (G) {
      // the label pops in, holds, and lifts away; an inner group so the placement stays put
      const inner = el('g', {}, grp);
      inner.appendChild(r); inner.appendChild(t);
      grp.setAttribute('opacity', 1);
      ch.gs = true; ch.inner = inner;
      ch.tl = G.timeline({ onComplete: () => { grp.remove(); const i = chips.indexOf(ch); if (i >= 0) chips.splice(i, 1); } })
        .fromTo(inner, { opacity: 0, scale: 0.78, y: 8, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: 'back.out(2.2)' })
        .to(inner, { opacity: 0, y: -10, duration: 0.6, ease: 'power2.in' }, ms / 1000 - 0.6);
    }
    chips.push(ch);
  }
  function flash(k, col, a) {
    glow[k] = { t0: performance.now(), col, a: a || 0.75 };
  }

  function skip() {
    const s = document.getElementById('skip');
    s.classList.add('on');
    setTimeout(() => s.classList.remove('on'), 3200);
  }

  /* ---------------- cards ---------------- */
  const lastCase = () => snap && snap.cases && snap.cases[0];
  const primary = () => snap && snap.cases && (snap.cases.find((c) => c.id === snap.active) || snap.cases[0]);
  function renderCards() {
    const c = lastCase();
    if (!c) {
      cc.code.textContent = '대기'; cc.name.textContent = '차량 이벤트 수신 대기'; cc.badge.textContent = '—'; cc.kind.textContent = ''; cc.owner.textContent = ''; cc.src.textContent = '';
      cc.badgeBg.setAttribute('fill', '#2a3448');
      return;
    }
    const w = c.wng || { code: '—', name: c.warn.title, case: 'A' };
    const K = E.CASE[w.case];
    cc.code.textContent = w.code;
    cc.name.textContent = w.name;
    cc.badge.textContent = K.label;
    cc.badgeBg.setAttribute('fill', CASECOL[w.case]);
    cc.badge.setAttribute('fill', w.case === 'A' ? '#fff' : '#111');
    cc.kind.textContent = K.kind;
    cc.owner.textContent = `→ ${K.owner}`;
    cc.src.textContent = w.assumed ? '시뮬레이터 가정 (master 미등록)' : 'WNG master v8.2';
  }

  function skipMs(c) {
    return (snap.flows || []).filter((f) => f.type === 'skip' && f.caseId === c.id && f.t >= c.at).length * 25 * 60000;
  }
  function tickCards(now) {
    const c = primary();
    const circ = 2 * Math.PI * 62;
    if (!c) {
      sc.left.textContent = '—'; sc.l1.textContent = ''; sc.v1.textContent = ''; sc.l2.textContent = ''; sc.v2.textContent = ''; sc.foot.textContent = '';
      sc.ring.setAttribute('stroke-dashoffset', circ);
      return;
    }
    const w = c.wng || { case: 'A' };
    const K = E.CASE[w.case];
    sc.ring.setAttribute('stroke', CASECOL[w.case]);
    if (w.case === 'A') {
      const contacted = c.contact > 0;
      const left = K.sla - (now - c.slaBase);
      if (contacted) {
        sc.left.textContent = '컨택';
        sc.ring.setAttribute('stroke', '#3ddc84');
        sc.ring.setAttribute('stroke-dashoffset', 0);
      } else {
        sc.left.textContent = left >= 0 ? E.mmss(left) : `+${E.mmss(-left)}`;
        sc.ring.setAttribute('stroke-dashoffset', circ * Math.min(1, Math.max(0, 1 - left / K.sla)));
      }
      sc.l1.textContent = '지원실 연락'; sc.v1.textContent = E.CONTACT[c.contact];
      sc.l2.textContent = '서비스센터'; sc.v2.textContent = c.dms >= 0 ? E.DMS[c.dms] : '-';
      sc.foot.textContent = contacted ? (c.call && c.call.dir === 'in' ? '고객 인바운드 · 상담 진행' : '25분 경과 · 상담원 발신') : '25분 내 고객 연락 대기';
    } else {
      sc.left.textContent = K.slaText;
      sc.ring.setAttribute('stroke-dashoffset', circ * 0.04);
      sc.l1.textContent = '대응'; sc.v1.textContent = '서비스센터 직접';
      sc.l2.textContent = '서비스센터'; sc.v2.textContent = c.dms >= 0 ? E.DMS[c.dms] : '-';
      sc.foot.textContent = '상담원 미대응 · 서비스센터 SLA';
    }
    const t = new Date(Date.now() + (snap.skip || 0) * 60000);
    clock.textContent = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
    const el2 = Date.now() - c.at + skipMs(c);
    elapsed.textContent = `${pad(Math.floor(el2 / 60000))}:${pad(Math.floor(el2 / 1000) % 60)}`;
  }

  function renderLog() {
    const fl = shown.slice(-ROWS).reverse();
    const max = logOpen ? 34 : 70;
    logEls.forEach((r, i) => {
      const f = fl[i];
      r.row.setAttribute('opacity', f ? (logOpen ? 1 - i * 0.1 : 1) : 0);
      if (!f) return;
      r.tm.textContent = E.hm(f.t);
      r.api.textContent = f.api;
      r.api.setAttribute('fill', f.wcase ? CASECOL[f.wcase] : BLUE);
      r.lb.textContent = f.label.length > max ? f.label.slice(0, max - 1) + '…' : f.label;
      r.lb.setAttribute('fill', i === 0 ? '#ffffff' : '#a9b8cf');            // the message playing now
    });
  }
  /* ---------------- the call ----------------
   * While the customer talks with the agent, voice keeps flowing between the
   * agent screen and the customer: the car (MM call from the head unit) or the
   * phone (outbound and general calls). Packets run toward whoever listens. */
  const VOICE_COL = '#3ddc84';
  const callG = el('g', { opacity: 0 }, g('links'));
  const callGlow = el('path', { fill: 'none', stroke: VOICE_COL, 'stroke-width': 16, 'stroke-opacity': 0.12, 'stroke-linecap': 'round' }, callG);
  const callLine = el('path', { fill: 'none', stroke: VOICE_COL, 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-dasharray': '2 16' }, callG);
  const callDotsG = el('g', {}, g('pk'));
  const callLbl = el('g', { opacity: 0 }, g('chips'));
  const callLblBg = el('rect', { rx: 16, fill: 'rgba(6,22,14,0.95)', stroke: VOICE_COL, 'stroke-width': 2.5 }, callLbl);
  const callLblT = el('text', { fill: '#dfffe9', 'font-size': 24, 'font-weight': 800, 'text-anchor': 'middle', class: 'num' }, callLbl);
  let callKey = '', callDots = [], lastVoice = 0, callA = 0;
  // in a replay (the detail view, step by step) the call is read from the messages shown so far
  function replayCall() {
    let cc = null;
    for (const f of shown) {
      const a = f.api || '';
      if (a === '헤드유닛 콜') cc = { who: 'car', peer: 'ccw', live: false, label: '헤드유닛 콜' };
      else if (a === '음성' || (a === '수신' && cc && cc.who === 'car')) cc = { who: 'car', peer: 'ccw', live: true, label: '차량 통화', at: null };
      else if (a === '발신' && f.to === 'phone') cc = { who: 'phone', peer: 'ccw', live: false, label: '휴대폰 통화' };
      else if (a === '응답' && f.from === 'phone') cc = { who: 'phone', peer: 'ccw', live: true, label: '휴대폰 통화' };
      else if (a === '딜러 발신') cc = { who: 'phone', peer: 'dms', live: false, label: '서비스센터 ↔ 고객 통화' };
      else if (a === '딜러 통화 연결') cc = { who: 'phone', peer: 'dms', live: true, label: '서비스센터 ↔ 고객 통화' };
      else if (/통화 종료|미응답/.test(a)) cc = null;
    }
    return cc;
  }
  function currentCall() {
    if (replay) return replayCall();
    if (!snap) return null;
    const gc = snap.general;
    if (gc && (gc.state === 'connected' || gc.state === 'ringing')) return { who: 'phone', live: gc.state === 'connected', at: gc.connectedAt, label: '일반 전화' };
    const c = primary();
    if (!c) return null;
    const dc = c.dcall;
    if (dc && (dc.state === 'connected' || dc.state === 'dialing')) return { who: 'phone', peer: 'dms', live: dc.state === 'connected', at: dc.connectedAt, label: '서비스센터 ↔ 고객 통화' };
    if (c.call && (c.call.state === 'connected' || c.call.state === 'dialing')) return { who: c.call.dir === 'in' ? 'car' : 'phone', live: c.call.state === 'connected', at: c.call.connectedAt, label: c.call.dir === 'in' ? '차량 통화' : '휴대폰 통화' };
    if (c.inbound && !c.call) return { who: 'car', live: false, label: '헤드유닛 콜' };
    return null;
  }
  function tickCall(now) {
    const cc = currentCall();
    callA += ((cc ? 1 : 0) - callA) * 0.12;
    callG.setAttribute('opacity', callA.toFixed(3));
    callLbl.setAttribute('opacity', callA.toFixed(3));
    if (!cc) { if (callA < 0.02 && callDots.length) { callDots.forEach((d) => d.c.remove()); callDots = []; } return; }
    const peer = cc.peer || 'ccw';
    const key = cc.who + peer;
    if (key !== callKey) {
      callKey = key;
      const d = path(cc.who, peer).d;            // customer → agent (or the dealer)
      callLine.setAttribute('d', d); callGlow.setAttribute('d', d);
      const L = callLine.getTotalLength(), m = callLine.getPointAtLength(L / 2);
      callLbl.dataset.x = m.x; callLbl.dataset.y = m.y;
    }
    const L = callLine.getTotalLength();
    let speaking = caption && now < caption.until ? caption.who : null;     // 'agent' | 'dealer' | 'customer'
    if (speaking === 'dealer') speaking = 'agent';
    const toAgent = speaking !== 'agent';
    // the dashes crawl toward the listener; ringing just blinks
    callLine.setAttribute('stroke-dashoffset', ((toAgent ? -1 : 1) * now / 28 % 18).toFixed(1));
    callLine.setAttribute('stroke-opacity', cc.live ? 0.95 : (0.35 + 0.6 * (Math.sin(now / 160) > 0 ? 1 : 0)).toFixed(2));
    if (cc.live && now - lastVoice > (speaking ? 240 : 650)) {
      lastVoice = now;
      const dir = speaking ? (speaking === 'agent' ? -1 : 1) : (Math.random() < 0.5 ? 1 : -1);
      callDots.push({ c: el('circle', { r: speaking ? 8 : 6, fill: VOICE_COL, filter: 'url(#dot)' }, callDotsG), t0: now, dir });
      flash(dir > 0 ? peer : cc.who, VOICE_COL, 0.3);
    }
    for (let i = callDots.length - 1; i >= 0; i--) {
      const d = callDots[i];
      const k = (now - d.t0) / 1700;
      if (k >= 1) { d.c.remove(); callDots.splice(i, 1); continue; }
      const pt = callLine.getPointAtLength((d.dir > 0 ? k : 1 - k) * L);
      d.c.setAttribute('cx', pt.x); d.c.setAttribute('cy', pt.y);
      d.c.setAttribute('opacity', (k < 0.1 ? k / 0.1 : k > 0.85 ? (1 - k) / 0.15 : 1).toFixed(2));
    }
    const sec = cc.live && cc.at ? Math.max(0, Math.floor((Date.now() - cc.at) / 1000)) : 0;
    callLblT.textContent = cc.live ? (cc.at ? `📞 ${cc.label} ${pad(Math.floor(sec / 60))}:${pad(sec % 60)}` : `📞 ${cc.label} · 통화 중`) : `📞 ${cc.label} · 연결 중…`;
    const bb = callLblT.getBBox();
    callLblBg.setAttribute('x', bb.x - 18); callLblBg.setAttribute('y', bb.y - 10); callLblBg.setAttribute('width', bb.width + 36); callLblBg.setAttribute('height', bb.height + 20);
    // on the line, in the Japan-server column where nothing else sits at that height
    let lx = 520, ly = cc.who === 'car' ? 228 : 703;
    if (peer === 'dms') { const m = callLine.getPointAtLength(L / 2); lx = m.x; ly = m.y + 58; }
    callLbl.setAttribute('transform', `translate(${lx},${ly - bb.y - bb.height / 2})`);
  }

  /* ---------------- frame ---------------- */
  function frame(now) {
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i];
      if (p.gs) continue;
      const k = Math.min(1, (now - p.t0) / p.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const head = e * p.L;
      const pt = p.tail.getPointAtLength(head);
      p.dot.setAttribute('cx', pt.x); p.dot.setAttribute('cy', pt.y);
      p.tail.setAttribute('stroke-dasharray', `${Math.min(head, 140)} ${p.L}`);
      p.tail.setAttribute('stroke-dashoffset', -Math.max(0, head - 140));
      if (k >= 1) { flash(p.f.to, p.col); p.tail.remove(); p.dot.remove(); packets.splice(i, 1); }
    }
    for (let i = chips.length - 1; i >= 0; i--) {
      const c = chips[i];
      if (c.gs) {
        if (c.out && !c.outDone) { c.outDone = true; c.tl.kill(); G.to(c.inner, { opacity: 0, scale: 0.9, duration: 0.3, ease: 'power2.in', onComplete: () => { c.grp.remove(); const j = chips.indexOf(c); if (j >= 0) chips.splice(j, 1); } }); }
        continue;
      }
      const a = (now - c.t0) / c.ms;
      const out = c.out ? Math.max(0, 1 - (now - c.out) / 300) : 1;     // pushed out by newer labels
      c.grp.setAttribute('opacity', (a < 0.08 ? a / 0.08 : a > 0.8 ? Math.max(0, (1 - a) / 0.2) : 1) * out);
      if (a >= 1 || out <= 0) { c.grp.remove(); chips.splice(i, 1); }
    }
    for (const k in nodeEls) {
      const gl = glow[k], n = nodeEls[k];
      const a = gl ? Math.max(0, 1 - (now - gl.t0) / 1400) * gl.a : 0;
      n.halo.setAttribute('opacity', a.toFixed(3));
      if (gl) n.halo.setAttribute('fill', gl.col);
      // systems the case has not reached yet stay dim, so the path taken reads at a glance
      const dim = snap && primary() && !touched[k] ? 0.42 : 1;
      if (n.dim !== dim) { n.dim = dim; n.grp.setAttribute('opacity', dim); }
    }
    pump(now);
    if (snap) tickCards(Date.now());
    tickRail();
    tickCall(now);
    requestAnimationFrame(frame);
  }
  layoutFoot();
  btnState();
  requestAnimationFrame(frame);
  // the clock always runs; the elapsed time only while there is a warning case
  setInterval(() => { const t = new Date(); clock.textContent = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`; if (!snap || !primary()) elapsed.textContent = '00:00'; }, 500);
})();
