/* e-Care data flow monitor. Draws the systems involved (vehicle, VDP, VEP, WAM,
 * call center, CTI, dealer DMS, emergency dispatch, SMS, customer phone) and
 * animates every message the director records in snapshot.flows, labelled
 * with the interface name from the e-Care interface definition. */
(function () {
  'use strict';

  const E = window.ECare;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.getElementById('board');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');

  // systems, at 1920x1080
  const N = {
    car: { x: 225, y: 330, t: '차량 · HU', s: 'GX 550 · DCM / MM', zone: 'cust' },
    phone: { x: 225, y: 660, t: '고객 휴대폰', s: 'Global App · 통화 · SMS', zone: 'cust' },
    vdp: { x: 640, y: 330, t: 'VDP', s: 'Toyota · 일본', zone: 'plat' },
    vep: { x: 905, y: 330, t: 'VEP', s: '필터 · Case 판정', zone: 'plat' },
    wam: { x: 1170, y: 330, t: 'WAM', s: '오케스트레이션', zone: 'plat' },
    sms: { x: 905, y: 760, t: 'SMS', s: '문자 발송', zone: 'plat', small: true },
    ccw: { x: 1655, y: 225, t: '콜센터 CCW', s: 'e-Care 상담원', zone: 'ops' },
    cti: { x: 1655, y: 365, t: 'CTI', s: '콜 · 상담원 배정', zone: 'ops' },
    rescue: { x: 1655, y: 505, t: '긴급출동', s: '마스터자동차', zone: 'ops' },
    dms: { x: 1655, y: 645, t: '딜러 DMS', s: '서비스센터', zone: 'ops' },
    opw: { x: 1655, y: 785, t: '운영 OPW', s: '정책 · WNG master', zone: 'ops' },
  };
  const W = 250, H = 104;
  const LINKS = [['car', 'vdp'], ['vdp', 'vep'], ['vep', 'wam'], ['wam', 'ccw'], ['wam', 'cti'], ['wam', 'dms'], ['wam', 'opw'], ['wam', 'vdp'], ['vdp', 'phone'],
    ['cti', 'ccw'], ['cti', 'phone'], ['cti', 'car'], ['ccw', 'rescue'], ['ccw', 'sms'], ['sms', 'phone'], ['ccw', 'car'], ['wam', 'phone']];
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

  // zones
  [['cust', 40, '고객', 400], ['plat', 490, 'Toyota · TSP 플랫폼', 920], ['ops', 1450, '운영 · 대응', 430]].forEach(([k, x, label, w]) => {
    el('rect', { x, y: 150, width: w, height: 700, rx: 26, fill: 'rgba(120,160,220,0.035)', stroke: 'rgba(140,180,240,0.12)', 'stroke-width': 2 }, g('zones'));
    const t = el('text', { x: x + 26, y: 194, fill: '#7f93b0', 'font-size': 26, 'font-weight': 700, 'letter-spacing': 1 }, g('zones'));
    t.textContent = label;
  });

  const path = (a, b) => {
    const A = N[a], B = N[b];
    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    const bend = (a < b ? 1 : -1) * Math.min(80, len * 0.16);
    const mx = (A.x + B.x) / 2 - (dy / len) * bend, my = (A.y + B.y) / 2 + (dx / len) * bend;
    return { d: `M${A.x},${A.y} Q${mx},${my} ${B.x},${B.y}`, A, B, mx, my };
  };
  const linkEls = {};
  LINKS.forEach(([a, b]) => {
    const p = path(a, b);
    linkEls[a + b] = linkEls[b + a] = el('path', { d: p.d, fill: 'none', stroke: 'rgba(120,160,220,0.16)', 'stroke-width': 3, 'stroke-dasharray': '2 10', 'stroke-linecap': 'round' }, g('links'));
  });

  // nodes
  const nodeEls = {};
  for (const k in N) {
    const n = N[k];
    const w = n.small ? 190 : W, h = n.small ? 84 : H;
    const grp = el('g', { transform: `translate(${n.x - w / 2},${n.y - h / 2})` }, g('nodes'));
    const halo = el('rect', { x: -12, y: -12, width: w + 24, height: h + 24, rx: 30, fill: BLUE, opacity: 0, filter: 'url(#soft)' }, grp);
    el('rect', { width: w, height: h, rx: 20, fill: 'url(#nodeBg)', stroke: 'rgba(150,190,255,0.35)', 'stroke-width': 2 }, grp);
    const t = el('text', { x: 24, y: n.small ? 40 : 46, fill: '#eef3fb', 'font-size': n.small ? 30 : 36, 'font-weight': 800 }, grp); t.textContent = n.t;
    const s = el('text', { x: 24, y: n.small ? 68 : 82, fill: '#8fa4c2', 'font-size': 21, 'font-weight': 600 }, grp); s.textContent = n.s;
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
  const caseCard = card(760, 420, 290, 300, 'Case 판정 · WNG master');
  const cc = {
    code: el('text', { x: 22, y: 104, fill: '#eef3fb', 'font-size': 54, 'font-weight': 800, class: 'num' }, caseCard),
    name: el('text', { x: 22, y: 146, fill: '#c9d6ea', 'font-size': 26, 'font-weight': 700 }, caseCard),
    badgeBg: el('rect', { x: 22, y: 172, width: 120, height: 46, rx: 12, fill: '#2a3448' }, caseCard),
    badge: el('text', { x: 82, y: 204, fill: '#fff', 'font-size': 26, 'font-weight': 800, 'text-anchor': 'middle' }, caseCard),
    kind: el('text', { x: 156, y: 204, fill: '#c9d6ea', 'font-size': 22, 'font-weight': 700 }, caseCard),
    owner: el('text', { x: 22, y: 254, fill: '#9fb6d6', 'font-size': 22, 'font-weight': 600 }, caseCard),
    src: el('text', { x: 22, y: 284, fill: '#5f7392', 'font-size': 17, 'font-weight': 600 }, caseCard),
  };
  const slaCard = card(1068, 420, 300, 300, '워크플로우 · SLA');
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

  function ingest() {
    const fl = (snap && snap.flows) || [];
    if (!fl.length && seen) { seen = 0; for (const k in counts) counts[k] = 0; }    // scenario reset
    for (const f of fl) {
      if (f.id <= seen) continue;
      seen = f.id;
      if (first) continue;                 // joining mid-scenario: show state, do not replay
      if (f.type === 'skip') { skip(); continue; }
      launch(f);
    }
    first = false;
    renderLog();
  }

  /* ---------------- packets ---------------- */
  function launch(f) {
    const col = f.wcase ? CASECOL[f.wcase] : BLUE;
    counts[f.to] = (counts[f.to] || 0) + 1;
    if (f.from === f.to) { flash(f.to, col); chip(f, N[f.to].x, N[f.to].y - 92, col, 2600, null, [{ x: N[f.to].x, y: N[f.to].y - 92 }, { x: N[f.to].x, y: N[f.to].y + 92 }, { x: N[f.to].x - 150, y: N[f.to].y - 92 }]); return; }
    const p0 = path(f.from, f.to);
    const p = p0;
    const tail = el('path', { d: p.d, fill: 'none', stroke: col, 'stroke-width': 6, 'stroke-linecap': 'round', opacity: 0.9 }, g('pk'));
    const L = tail.getTotalLength();
    tail.setAttribute('stroke-dasharray', `0 ${L}`);
    const dot = el('circle', { r: 13, fill: col, filter: 'url(#dot)' }, g('pk'));
    const pk = { f, tail, dot, L, t0: performance.now(), dur: Math.min(1400, 520 + L * 0.9), col };
    packets.push(pk);
    chip(f, p.mx, p.my, col, 2600, pk);
    const link = linkEls[f.from + f.to];
    if (link) { link.setAttribute('stroke', col); link.setAttribute('stroke-opacity', 0.6); setTimeout(() => { link.setAttribute('stroke', 'rgba(120,160,220,0.16)'); link.removeAttribute('stroke-opacity'); }, 2400); }
    flash(f.from, col, 0.35);
  }
  // label chips: placed along the message's path where they cover no system
  // box and no other label
  const boxes = () => Object.keys(N).map((k) => { const n = N[k]; const w = (n.small ? 190 : W) + 16, h = (n.small ? 84 : H) + 16; return { x: n.x - w / 2, y: n.y - h / 2, w, h }; })
    .concat([{ x: 752, y: 412, w: 306, h: 316 }, { x: 1060, y: 412, w: 316, h: 316 }]);
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  function chip(f, x, y, col, ms, p, spots) {
    const grp = el('g', { opacity: 0 }, g('chips'));
    const txt = `${f.api} · ${f.label}`;
    const t = el('text', { x: 0, y: 0, fill: '#fff', 'font-size': 23, 'font-weight': 700, 'text-anchor': 'middle' }, grp);
    t.textContent = txt.length > 46 ? txt.slice(0, 45) + '…' : txt;
    const bb = t.getBBox();
    const r = el('rect', { x: bb.x - 16, y: bb.y - 9, width: bb.width + 32, height: bb.height + 18, rx: 14, fill: 'rgba(6,12,22,0.94)', stroke: col, 'stroke-width': 2.5 }, grp);
    grp.insertBefore(r, t);
    const w = bb.width + 32, h = bb.height + 18;
    const now = performance.now();
    const taken = boxes().concat(chips.map((c) => c.box));
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
    cc.src.textContent = w.assumed ? '시뮬레이터 가정 (master 미등록)' : 'WNG master for e-Care v7';
  }

  function skipMs(c) {
    return (snap.flows || []).filter((f) => f.type === 'skip' && f.caseId === c.id && f.t >= c.at).length * 25 * 60000;
  }
  function tickCards(now) {
    const c = primary();
    const circ = 2 * Math.PI * 62;
    if (!c) {
      sc.group.textContent = 'workflowId —'; sc.left.textContent = '—'; sc.l1.textContent = ''; sc.v1.textContent = ''; sc.l2.textContent = ''; sc.v2.textContent = ''; sc.foot.textContent = '';
      sc.ring.setAttribute('stroke-dashoffset', circ);
      return;
    }
    const w = c.wng || { case: 'A' };
    const K = E.CASE[w.case];
    sc.group.textContent = `workflowId ${(c.group || '').slice(0, 13)}…`;
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
      sc.l1.textContent = '콜센터 컨택'; sc.v1.textContent = E.CONTACT[c.contact];
      sc.l2.textContent = '딜러 상태'; sc.v2.textContent = c.dms >= 0 ? E.DMS[c.dms] : '-';
      sc.foot.textContent = contacted ? (c.call && c.call.dir === 'in' ? '고객 인바운드 · 상담 진행' : '25분 자동 아웃바운드 · 상담 진행') : '인바운드 대기 · 25분 후 자동 아웃바운드';
    } else {
      sc.left.textContent = K.slaText;
      sc.ring.setAttribute('stroke-dashoffset', circ * 0.04);
      sc.l1.textContent = '대응'; sc.v1.textContent = '딜러 직접';
      sc.l2.textContent = '딜러 상태'; sc.v2.textContent = c.dms >= 0 ? E.DMS[c.dms] : '-';
      sc.foot.textContent = '상담원 미대응 · 서비스센터 SLA';
    }
    const t = new Date(Date.now() + (snap.skip || 0) * 60000);
    clock.textContent = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
    const el2 = Date.now() - c.at + skipMs(c);
    elapsed.textContent = `${pad(Math.floor(el2 / 60000))}:${pad(Math.floor(el2 / 1000) % 60)}`;
  }

  function renderLog() {
    const fl = ((snap && snap.flows) || []).filter((f) => !f.type).slice(-4).reverse();
    logEls.forEach((r, i) => {
      const f = fl[i];
      r.row.setAttribute('opacity', f ? 1 - i * 0.18 : 0);
      if (!f) return;
      r.tm.textContent = E.hm(f.t);
      r.api.textContent = f.api;
      r.api.setAttribute('fill', f.wcase ? CASECOL[f.wcase] : BLUE);
      r.lb.textContent = f.label.length > 40 ? f.label.slice(0, 39) + '…' : f.label;
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
      c.grp.setAttribute('opacity', a < 0.08 ? a / 0.08 : a > 0.8 ? Math.max(0, (1 - a) / 0.2) : 1);
      if (a >= 1) { c.grp.remove(); chips.splice(i, 1); }
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
    if (snap) tickCards(Date.now());
    tickCaption(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setInterval(() => { if (!snap) { const t = new Date(); clock.textContent = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`; elapsed.textContent = '00:00'; } }, 500);
})();
