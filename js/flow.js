/* e-Care data flow monitor. Draws the systems involved (vehicle, Japan server
 * VDP, Korea server TSP with VEP / WAM / OPW / SMS, the support center CCW with
 * CTI, dispatch, service center DMS, customer phone) and
 * animates every message the director records in snapshot.flows, labelled
 * with the interface name from the e-Care interface definition. */
(function () {
  'use strict';

  const E = window.ECare;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.getElementById('board');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');

  /* systems, at 1920x1080: an easy name on top, the project name below.
   * Zones run left to right: customer → Japan server (VDP) → Korea server
   * (TSP: VEP + WAM) → response (e-Care support center with CTI, dispatch,
   * service center). */
  const N = {
    car: { x: 195, y: 330, w: 260, t: '고객 차량', s: 'DCM · 헤드유닛 (MM)', zone: 'cust' },
    phone: { x: 195, y: 700, w: 260, t: '고객 휴대폰', s: 'Global App · 문자', zone: 'cust' },
    vdp: { x: 520, y: 330, w: 240, t: '차량 신호 수집', s: 'VDP', zone: 'jp' },
    vep: { x: 840, y: 290, w: 280, t: '경고 판정', s: 'VEP · Case 판정', zone: 'kr' },
    wam: { x: 1150, y: 290, w: 280, t: '업무 흐름 관리', s: 'WAM · 배정 · SLA', zone: 'kr' },
    opw: { x: 840, y: 768, w: 280, h: 88, t: '운영 관리', s: 'OPW · 정책', zone: 'kr' },
    sms: { x: 1150, y: 768, w: 280, h: 88, t: '문자 발송', s: 'SMS', zone: 'kr' },
    ccw: { x: 1607, y: 318, w: 310, t: '상담원 화면', s: 'CCW', zone: 'res' },
    cti: { x: 1607, y: 428, w: 310, h: 88, t: '전화 교환 · 상담원 배정', s: 'CTI', zone: 'res' },
    rescue: { x: 1607, y: 610, w: 310, t: '긴급출동', s: '마스터자동차', zone: 'res' },
    dms: { x: 1607, y: 760, w: 310, t: '서비스센터 (딜러)', s: 'DMS', zone: 'res' },
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
  const LINKS = [['car', 'vdp'], ['vdp', 'vep'], ['vep', 'wam'], ['wam', 'ccw'], ['wam', 'cti'], ['cti', 'ccw'], ['wam', 'dms'], ['ccw', 'rescue'], ['vdp', 'phone'], ['ccw', 'sms'], ['sms', 'phone']];
  const CASECOL = { A: '#ff4d5e', B: '#ffb02e', C: '#3fd0c9' };
  const BLUE = '#5aa2ff';

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
    el('rect', { x: z.x, y: 150, width: z.w, height: 712, rx: 26, fill: 'rgba(120,160,220,0.035)', stroke: 'rgba(140,180,240,0.12)', 'stroke-width': 2 }, g('zones'));
    el('rect', { x: z.x + 24, y: 172, width: 6, height: 30, rx: 3, fill: z.col }, g('zones'));
    const t = el('text', { x: z.x + 42, y: 197, fill: '#dfe7f3', 'font-size': 27, 'font-weight': 800 }, g('zones'));
    t.textContent = z.t;
    if (z.tag) {
      const tg = el('g', { transform: `translate(${z.x + 54 + z.t.length * 25},174)` }, g('zones'));
      el('rect', { width: z.tag.length * 15 + 24, height: 32, rx: 9, fill: z.col, 'fill-opacity': 0.16, stroke: z.col, 'stroke-opacity': 0.6 }, tg);
      el('text', { x: 12, y: 23, fill: z.col, 'font-size': 21, 'font-weight': 800, class: 'num' }, tg).textContent = z.tag;
    }
  });
  el('rect', { x: 1355, y: 222, width: 505, height: 260, rx: 20, fill: 'rgba(61,220,132,0.05)', stroke: 'rgba(61,220,132,0.4)', 'stroke-width': 2, 'stroke-dasharray': '8 7' }, g('zones'));
  el('text', { x: 1378, y: 256, fill: '#8ff0b3', 'font-size': 22, 'font-weight': 800 }, g('zones')).textContent = 'e-Care 고객지원실';

  /* links run edge to edge as S-curves: sideways between columns, up/down
   * within one. SMS → phone dips under the bottom row so it clears OPW. */
  const UNDER = { 'phone|sms': 905 };     // key: the two ids sorted; the first is the left box
  const OVER = { 'vdp|wam': 214 };        // top edge to top edge, over the boxes between
  const RIGHT = { 'ccw|rescue': 1838, 'ccw|dms': 1838, 'cti|rescue': 1838 };   // around the right of the column
  const path = (a, b) => {
    const key = [a, b].sort().join('|');
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
  const linkEls = {};
  LINKS.forEach(([a, b]) => {
    const p = path(a, b);
    linkEls[a + b] = linkEls[b + a] = el('path', { d: p.d, fill: 'none', stroke: 'rgba(120,160,220,0.16)', 'stroke-width': 3, 'stroke-dasharray': '2 10', 'stroke-linecap': 'round' }, g('links'));
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
    nodeEls[k] = { halo, badge, bt };
  }

  // Case judgement card (under VEP) and workflow / SLA card (under WAM)
  const card = (x, y, w, h, title) => {
    const grp = el('g', { transform: `translate(${x},${y})` }, g('cards'));
    el('rect', { width: w, height: h, rx: 18, fill: 'rgba(10,18,32,0.85)', stroke: 'rgba(150,190,255,0.18)', 'stroke-width': 2 }, grp);
    const t = el('text', { x: 22, y: 38, fill: '#7f93b0', 'font-size': 21, 'font-weight': 700 }, grp); t.textContent = title;
    return grp;
  };
  const caseCard = card(700, 382, 290, 300, '경고 등급 · WNG master');
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
  const sc = {
    group: el('text', { x: 22, y: 76, fill: '#9fb6d6', 'font-size': 21, 'font-weight': 600, class: 'num' }, slaCard),
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
  const tt = el('text', { x: 60, y: 82, fill: '#eef3fb', 'font-size': 46, 'font-weight': 800 }, hud); tt.textContent = 'e-Care 데이터 흐름';
  const ts = el('text', { x: 60, y: 120, fill: '#7f93b0', 'font-size': 22, 'font-weight': 600 }, hud); ts.textContent = 'Toyota Global South · 실시간 시스템 연동';
  const clockL = el('text', { x: 960, y: 50, fill: '#7f93b0', 'font-size': 20, 'font-weight': 700, 'text-anchor': 'middle' }, hud); clockL.textContent = '시각';
  const clock = el('text', { x: 960, y: 112, fill: '#fff', 'font-size': 66, 'font-weight': 700, 'text-anchor': 'middle', class: 'num' }, hud);
  const elapsedL = el('text', { x: 1860, y: 50, fill: '#7f93b0', 'font-size': 20, 'font-weight': 700, 'text-anchor': 'end' }, hud); elapsedL.textContent = '경고 발생 후 경과';
  const elapsed = el('text', { x: 1860, y: 112, fill: '#fff', 'font-size': 62, 'font-weight': 700, 'text-anchor': 'end', class: 'num' }, hud);

  // footer: event log (left) and dialogue caption (right)
  const foot = g('foot');
  el('rect', { x: 40, y: 880, width: 1840, height: 170, rx: 22, fill: 'rgba(8,14,26,0.85)', stroke: 'rgba(150,190,255,0.12)', 'stroke-width': 2 }, foot);
  const logEls = [0, 1, 2, 3].map((i) => {
    const row = el('g', { transform: `translate(70,${922 + i * 36})` }, foot);
    const tm = el('text', { x: 0, y: 0, fill: '#6f84a3', 'font-size': 22, 'font-weight': 600, class: 'num' }, row);
    const api = el('text', { x: 108, y: 0, fill: BLUE, 'font-size': 22, 'font-weight': 800 }, row);
    const lb = el('text', { x: 300, y: 0, fill: '#d4def0', 'font-size': 23, 'font-weight': 600 }, row);
    return { row, tm, api, lb };
  });
  el('line', { x1: 1080, y1: 900, x2: 1080, y2: 1030, stroke: 'rgba(150,190,255,0.15)', 'stroke-width': 2 }, foot);
  const capWho = el('text', { x: 1110, y: 930, fill: '#7f93b0', 'font-size': 22, 'font-weight': 700 }, foot);
  const capT1 = el('text', { x: 1110, y: 976, fill: '#fff', 'font-size': 34, 'font-weight': 700 }, foot);
  const capT2 = el('text', { x: 1110, y: 1020, fill: '#fff', 'font-size': 34, 'font-weight': 700 }, foot);

  /* ---------------- link ---------------- */
  Link.on('ecare', (d) => { snap = d; ingest(); renderCards(); });
  Link.on('say', (d) => { caption = { who: d.line.who, text: d.line.text, until: performance.now() + (d.line.dur || 4) * 1000 + 2500 }; });
  Link.send('hello', { screen: 'flow' });

  /* Messages play one at a time in arrival order (the director sends them in
   * bursts); each one's description goes to the log as it plays. */
  const queue = [];
  let shown = [];             // messages already played, for the log
  let lastLaunch = 0;
  function ingest() {
    const fl = (snap && snap.flows) || [];
    if (!fl.length && seen) reset();                                 // scenario reset
    for (const f of fl) {
      if (f.id <= seen) continue;
      seen = f.id;
      if (f.type === 'skip') { if (!first) queue.push(f); continue; }
      // joining mid-scenario: show the paths and the log, do not replay
      if (first) { if (f.from !== f.to) keep(f.from, f.to, f.wcase ? CASECOL[f.wcase] : BLUE); shown.push(f); continue; }
      queue.push(f);
    }
    first = false;
    renderLog();
  }
  function reset() {
    seen = 0;
    for (const k in counts) counts[k] = 0;
    queue.length = 0;
    shown = [];
    for (const k in used) { const l = used[k]; if (l.dataset.extra) l.remove(); else l.setAttribute('class', ''); delete used[k]; }
    renderLog();
  }
  function pump(now) {
    if (!queue.length) return;
    const gap = queue.length > 5 ? 650 : 1100;
    if (now - lastLaunch < gap) return;
    lastLaunch = now;
    const f = queue.shift();
    if (f.type === 'skip') { skip(); return; }
    shown.push(f);
    if (shown.length > 40) shown.shift();
    launch(f);
    renderLog();
  }

  /* Paths a message has taken stay drawn (solid, in the case colour) until
   * the scenario is reset; the backbone shows faintly before that. */
  const used = {};
  function keep(a, b, col) {
    const k = [a, b].sort().join('|');
    let l = linkEls[a + b];
    if (!l) {
      l = el('path', { d: path(a, b).d, fill: 'none', 'stroke-linecap': 'round' }, g('links'));
      l.dataset.extra = '1';
      linkEls[a + b] = linkEls[b + a] = l;
    }
    l.setAttribute('class', 'used');
    l.style.setProperty('--c', col);
    used[k] = l;
  }

  /* ---------------- packets ---------------- */
  function launch(f) {
    const col = f.wcase ? CASECOL[f.wcase] : BLUE;
    counts[f.to] = (counts[f.to] || 0) + 1;
    if (f.from === f.to) { flash(f.to, col); chip(f, N[f.to].x, N[f.to].y - 92, col, 4200, null, [{ x: N[f.to].x, y: N[f.to].y - 92 }, { x: N[f.to].x, y: N[f.to].y + 92 }, { x: N[f.to].x - 150, y: N[f.to].y - 92 }]); return; }
    const p0 = path(f.from, f.to);
    const p = p0;
    const tail = el('path', { d: p.d, fill: 'none', stroke: col, 'stroke-width': 6, 'stroke-linecap': 'round', opacity: 0.9 }, g('pk'));
    const L = tail.getTotalLength();
    tail.setAttribute('stroke-dasharray', `0 ${L}`);
    const dot = el('circle', { r: 13, fill: col, filter: 'url(#dot)' }, g('pk'));
    const pk = { f, tail, dot, L, t0: performance.now(), dur: Math.min(1400, 520 + L * 0.9), col };
    packets.push(pk);
    chip(f, p.mx, p.my, col, 4200, pk);
    keep(f.from, f.to, col);
    flash(f.from, col, 0.35);
  }
  // label chips: placed along the message's path where they cover no system
  // box and no other label
  const boxes = () => Object.keys(N).map((k) => { const n = N[k]; const { w: w0, h: h0 } = size(n); const w = w0 + 16, h = h0 + 16; return { x: n.x - w / 2, y: n.y - h / 2, w, h }; })
    .concat([{ x: 692, y: 374, w: 306, h: 316 }, { x: 997, y: 374, w: 306, h: 316 }, { x: 1370, y: 230, w: 260, h: 36 }])
    .concat(ZONES.map((z) => ({ x: z.x, y: 160, w: z.w, h: 52 })));        // zone titles
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const MAX_CHIPS = 3;        // only the newest labels stay; the log has the descriptions
  function chip(f, x, y, col, ms, p, spots) {
    const live = chips.filter((c) => !c.out);
    live.slice(0, Math.max(0, live.length - MAX_CHIPS + 1)).forEach((c) => { c.out = performance.now(); });
    const grp = el('g', { opacity: 0 }, g('chips'));
    const txt = f.api;
    const t = el('text', { x: 0, y: 0, fill: '#fff', 'font-size': 23, 'font-weight': 700, 'text-anchor': 'middle' }, grp);
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
    chips.push({ grp, t0: now, ms, box: { x: cx - w / 2, y: best.y - h / 2, w, h } });
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
      sc.group.textContent = '그룹 ID —'; sc.left.textContent = '—'; sc.l1.textContent = ''; sc.v1.textContent = ''; sc.l2.textContent = ''; sc.v2.textContent = ''; sc.foot.textContent = '';
      sc.ring.setAttribute('stroke-dashoffset', circ);
      return;
    }
    const w = c.wng || { case: 'A' };
    const K = E.CASE[w.case];
    sc.group.textContent = `그룹 ID ${(c.group || '').slice(0, 13)}…`;
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
    const fl = shown.slice(-4).reverse();
    logEls.forEach((r, i) => {
      const f = fl[i];
      r.row.setAttribute('opacity', f ? 1 - i * 0.18 : 0);
      if (!f) return;
      r.tm.textContent = E.hm(f.t);
      r.api.textContent = f.api;
      r.api.setAttribute('fill', f.wcase ? CASECOL[f.wcase] : BLUE);
      r.lb.textContent = f.label.length > 40 ? f.label.slice(0, 39) + '…' : f.label;
      r.lb.setAttribute('fill', i === 0 ? '#ffffff' : '#a9b8cf');            // the message playing now
    });
  }

  /* ---------------- caption ---------------- */
  function wrap(text, max) {
    if (text.length <= max) return [text, ''];
    const cut = text.lastIndexOf(' ', max);
    const i = cut > max * 0.5 ? cut : max;
    const rest = text.slice(i).trim();
    return [text.slice(0, i).trim(), rest.length > max ? rest.slice(0, max - 1) + '…' : rest];
  }
  function tickCaption(now) {
    if (caption && now < caption.until) {
      capWho.textContent = caption.who === 'agent' ? 'e-Care 상담원' : `${E.CUSTOMER.name} 고객`;
      capWho.setAttribute('fill', caption.who === 'agent' ? BLUE : '#c9d6ea');
      const [a, b] = wrap(caption.text, 23);
      capT1.textContent = a; capT2.textContent = b;
    } else {
      capWho.textContent = '상담 대화'; capWho.setAttribute('fill', '#4c5f7c');
      capT1.textContent = ''; capT2.textContent = '';
    }
  }

  /* ---------------- frame ---------------- */
  function frame(now) {
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i];
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
      const cnt = counts[k] || 0;
      n.badge.setAttribute('opacity', cnt ? 1 : 0);
      n.bt.textContent = cnt;
    }
    pump(now);
    if (snap) tickCards(Date.now());
    tickCaption(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setInterval(() => { if (!snap) { const t = new Date(); clock.textContent = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`; elapsed.textContent = '00:00'; } }, 500);
})();
