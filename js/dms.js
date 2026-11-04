/* Service center DMS: the e-Care dashboard of a dealer's service center.
 *
 * One warning case = one row (list view) or one card (card view), followed
 * through the stages 컨택대기 → 예약대기 → 예약 → 입고 → 정비 → 종결 (or 중단),
 * with the SLA of the first contact. The live case of the demo customer comes
 * from the director (Link 'ecare'); what the service center does on it (contact
 * result, stopping, next stage) goes back as director commands, so the call
 * center screen (CCW) and the data flow follow. The other rows are a made-up
 * day of the center; their edits are shared between DMS screens ('dms-edit').
 * Drawn at 1920x1080 and scaled to the window. */
(function () {
  'use strict';

  const E = window.ECare;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const app = $('#app');
  const H = 3600e3, D = 24 * H;

  const LOGIN = E.DEALERS[0].name;                      // this screen's center
  const short = (name) => name.replace(' 서비스센터', '');
  const STAGES = ['컨택대기', '예약대기', '예약', '입고', '정비', '종결'];
  const GRADE = { A: { k: '긴급', col: '#e5534b' }, B: { k: '경고', col: '#f0922f' }, C: { k: '알림', col: '#6fbd3c' } };
  const STOP_REPLIES = ['입고거부', '타사입고', '컨택불가'];
  const SLA_OF = { A: D, B: D, C: 7 * D };            // first contact after the case reaches the center

  /* ---------------- a day of the center (made up) ----------------
   * Times are relative to today's midnight, so every DMS screen shows the same rows. */
  const day0 = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const T = (h) => day0 + h * H;
  const W = (id) => E.WNG[id];
  const BASE = [
    { id: 'd01', g: 'B', w: 'esp', more: 1, center: '강남', model: 'RX 500h', plate: '58나 2041', at: T(-26.2), stage: 0 },
    { id: 'd02', g: 'B', w: 'door', more: 0, center: '서초', model: 'NX 350h', plate: '17러 8823', at: T(-6.4), stage: 0 },
    { id: 'd03', g: 'C', w: 'brakepad', more: 1, center: '강남', model: 'ES 300h', plate: '302우 5519', at: T(-52), stage: 0 },
    { id: 'd04', g: 'C', w: 'brakepad', more: 0, center: '잠실', model: 'CAMRY HEV', plate: '64수 0712', at: T(-110), stage: 0 },
    { id: 'd05', g: 'A', w: 'engine', more: 2, center: '강남', model: 'LX 600', plate: '91보 3376', at: T(-9.5), stage: 1, contacts: [[0.4, '전화', '컨택', '예약대기', '박정비']], consult: true },
    { id: 'd06', g: 'B', w: 'gearbox', more: 1, center: '강남', model: 'RAV4 HEV', plate: '40저 6628', at: T(-30), stage: 1, late: true, contacts: [[26.5, '전화', '부재', '재컨택필요', '이정비']] },
    { id: 'd07', g: 'B', w: 'airbag', more: 2, center: '서초', model: 'SIENNA HEV', plate: '12도 4480', at: T(-20), stage: 1, contacts: [[2.2, '전화', '컨택', '예약대기', '최정비'], [8.4, '전화', '부재', '재컨택필요', '최정비']] },
    { id: 'd08', g: 'C', w: 'brakepad', more: 0, center: '강남', model: 'PRIUS PHEV', plate: '77누 1934', at: T(-44), stage: 1, stop: '입고거부', contacts: [[3.1, '전화', '컨택', '입고거부', '이정비']] },
    { id: 'd09', g: 'B', w: 'esp', more: 3, center: '강남', model: 'NX 450h+', plate: '208허 7701', at: T(-31), stage: 2, late: true, contacts: [[25.4, '전화', '컨택', '예약확정', '이정비']], resv: ['강남', '온라인', T(14)] },
    { id: 'd10', g: 'C', w: 'brakepad', more: 0, center: '용산', model: 'CROWN', plate: '33마 2268', at: T(-60), stage: 2, contacts: [[5, '전화', '컨택', '예약확정', '한정비']], resv: ['용산', 'AICC', T(11)] },
    { id: 'd11', g: 'A', w: 'oil', more: 3, center: '강남', model: 'GX 550', plate: '149가 6612', at: T(-15), stage: 3, contacts: [[0.3, '전화', '컨택', '예약확정', '이정비']], resv: ['강남', '전화', T(-4)], consult: true, times: { 3: T(-3.2) } },
    { id: 'd12', g: 'B', w: 'airbag', more: 0, center: '서초', model: 'SIENNA HEV', plate: '86바 5097', at: T(-28), stage: 3, contacts: [[3.5, '전화', '컨택', '예약확정', '최정비']], resv: ['서초', '전화', T(-6)], times: { 3: T(-5.6) } },
    { id: 'd13', g: 'A', w: 'abs', more: 2, center: '강남', model: 'ES 300h', plate: '51다 9003', at: T(-36), stage: 4, filter: 'ON', contacts: [[0.5, '전화', '컨택', '예약확정', '이정비']], resv: ['강남', '전화', T(-27)], consult: true, times: { 3: T(-26.5), 4: T(-25) } },
    { id: 'd14', g: 'B', w: 'gearbox', more: 1, center: '강남', model: 'RAV4 HEV', plate: '26라 3315', at: T(-40), stage: 4, filter: 'ON', contacts: [[4, '전화', '컨택', '예약확정', '박정비']], resv: ['강남', '온라인', T(-30)], times: { 3: T(-29.4), 4: T(-28), 5: T(-1.5) } },
    { id: 'd15', g: 'B', w: 'door', more: 1, center: '강남', model: 'CAMRY HEV', plate: '93소 4152', at: T(-50), stage: 5, contacts: [[2.1, '전화', '컨택', '예약확정', '이정비']], resv: ['강남', '전화', T(-44)], times: { 3: T(-43.6), 4: T(-42), 5: T(-34), 7: T(-33.5) } },
  ].map((r) => ({
    ...r,
    code: W(r.w).code, wname: W(r.w).name,
    contacts: (r.contacts || []).map(([h, method, result, reply, agent], i) => ({ n: i + 1, t: r.at + h * H, method, result, reply, agent, memo: '' })),
    reservation: r.resv ? { center: r.resv[0] + ' 서비스센터', route: r.resv[1], at: r.resv[2] } : null,
    stopInfo: r.stop ? { reason: r.stop, at: r.at + 3.2 * H } : null,
  }));
  // edits of the made-up rows, shared between DMS screens
  const edits = {};
  Link.on('dms-edit', (d) => { applyEdit(d); render(true); });
  function applyEdit(d) {
    const r = BASE.find((x) => x.id === d.id);
    if (!r) return;
    if (d.contact) { r.contacts.push({ ...d.contact, n: r.contacts.length + 1 }); if (d.contact.reply === '예약확정') { r.stage = Math.max(r.stage, 2); r.reservation = r.reservation || { center: short(LOGIN) + ' 서비스센터', route: '전화', at: Date.now() + D }; } else r.stage = Math.max(r.stage, 1); }
    if (d.stop) r.stopInfo = { reason: d.stop, at: d.t };
    edits[d.id] = true;
  }

  /* ---------------- live state ---------------- */
  let snap = null;
  let view = localStorage.getItem('dms-view') || 'list';
  let detail = null, detailTab = 'info';
  let q = '';
  let flash = {};              // live case id -> since (highlight a new or changed row)
  Link.on('ecare', (d) => {
    const before = snap ? Object.fromEntries((snap.cases || []).map((c) => [c.id, c.dms])) : {};
    snap = d;
    (snap.cases || []).forEach((c) => { if (c.dms >= 0 && before[c.id] !== c.dms) flash[c.id] = Date.now(); });
    render();
  });
  Link.on('dms-view', (d) => { view = d.view; localStorage.setItem('dms-view', view); render(true); });
  Link.send('hello', { screen: 'dms' });

  const stageOf = (dms, stop) => (stop ? 'stop' : dms <= 0 ? 0 : dms === 1 ? 1 : dms === 2 ? 2 : dms === 3 ? 3 : dms <= 5 ? 4 : 5);
  // the live cases (the demo customer) as rows
  function liveRows() {
    if (!snap) return [];
    return snap.cases.filter((c) => c.dms >= 0 || (c.wcase === 'A' && c.contact < 3)).map((c) => {
      const g = c.wcase || 'A';
      const w = c.wng || { code: c.warn.id.toUpperCase(), name: c.warn.title };
      const center = c.dealer || E.DEALERS[0].name;
      const handover = c.dmsAt && c.dmsAt[0];
      return {
        id: c.id, live: true, c,
        g, code: w.code, wname: w.name, more: Math.max(0, snap.cases.filter((x) => x.group === c.group).length - 1),
        center: short(center), model: E.VEHICLE.model, plate: E.VEHICLE.plate, at: c.at,
        stage: c.dms < 0 ? 0 : stageOf(c.dms, false), stopInfo: c.dmsStop || null,
        pending: c.dms < 0,                            // still with the e-Care support center
        slaFrom: handover || c.at,
        contacts: c.contacts || [], reservation: c.reservation || null,
        times: c.dmsAt || {}, filter: c.dms >= 4 ? 'ON' : '',
        consult: g === 'A' && c.sheet && c.sheet.saved ? { at: c.sheet.saved, text: c.memo.text, request: c.memo.request } : null,
      };
    });
  }
  function rows() {
    const live = liveRows();
    const all = live.concat(BASE.map((r) => ({ ...r, slaFrom: r.at, times: r.times || {}, consult: r.consult ? { at: r.at + 0.2 * H, text: `${r.wname} 경고 · 주행 중 경고등 점등, 서비스센터 방문 점검 안내`, request: '입고 시 진단 우선 요청' } : null })));
    return all.filter((r) => !q || r.plate.replace(/\s/g, '').includes(q.replace(/\s/g, '')));
  }
  const stageKey = (r) => (r.stopInfo ? 'stop' : r.stage);

  /* ---------------- SLA ---------------- */
  function sla(r) {
    const due = r.slaFrom + SLA_OF[r.g];
    const first = r.contacts[0];
    const done = first ? first.t : null;
    const left = (done || Date.now()) - due;           // > 0: over
    return { due, left: -left, over: left > 0, done, late: done && done > due };
  }
  const span = (ms) => {
    const neg = ms < 0; ms = Math.abs(ms);
    const d = Math.floor(ms / D), h = Math.floor((ms % D) / H), m = Math.floor((ms % H) / 60000);
    const s = d ? `${d}일 ${h}시간` : h ? `${h}시간 ${m}분` : `${Math.max(1, m)}분`;
    return (neg ? '-' : '') + s;
  };
  const md = (t) => { const d = new Date(t); return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const ymdhm = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const gaugeCls = (ms) => (ms <= 0 ? 'over' : ms <= D ? 'red' : ms <= 3 * D ? 'yel' : 'gry');

  /* ---------------- pieces ---------------- */
  const badge = (g, dim) => `<i class="gr g${g} ${dim ? 'dim' : ''}">${g}</i>`;
  const stChip = (r) => `<span class="st ${r.stopInfo ? 'stop' : ''}">${r.stopInfo ? '중단' : r.pending ? '지원실 대응' : STAGES[r.stage]}</span>`;
  function slaBox(r) {
    const s = sla(r);
    const cls = gaugeCls(s.left);
    const total = SLA_OF[r.g];
    const pct = Math.max(0, Math.min(1, s.left / total));
    if (r.pending) return `<div class="slab pend"><b>e-Care 지원실 상담 중</b><small>이관 시 SLA 시작</small></div>`;
    return `<div class="slab ${cls}"><b>${s.over ? '-' + span(-s.left) : span(s.left)}</b><small>${md(s.due)}</small><span class="gauge"><i style="width:${(s.over ? 100 : pct * 100).toFixed(1)}%"></i></span></div>`;
  }
  const dot = (t, label, cls) => `<span class="chip ${cls || ''}"><i></i>${label ? label + ' ' : ''}${t ? md(t) : ''}</span>`;
  function contactBox(k) {
    if (!k) return '';
    const rc = k.result === '컨택' ? 'ok' : k.result === '성공' ? 'ok' : 'miss';
    return `<div class="tbox"><div class="l1"><b>컨택 ${k.n}차</b><em class="${rc}">${esc(k.result)}</em><b class="rp">${esc(k.reply)}</b></div><div class="l2"><span>${esc(k.agent)}</span><span>${md(k.t)}</span></div></div>`;
  }
  function timeline(r) {
    const s = sla(r);
    const cells = ['', '', '', '', ''];
    const first = r.contacts[0], last = r.contacts[r.contacts.length - 1];
    const st = r.stopInfo ? Math.max(1, r.stage) : r.stage;
    if (st === 0) cells[0] = slaBox(r);
    else cells[0] = s.late ? `<span class="chip late"><i></i>SLA 초과 ${md(first.t)}</span>` : dot(first ? first.t : null, '컨택');
    if (st === 1) cells[1] = contactBox(last);
    else if (st > 1) cells[1] = dot(null, `${r.contacts.length}차 예약확정`);
    if (st === 2 && r.reservation) cells[2] = `<div class="tbox"><div class="l1"><b>${esc(short(r.reservation.center))}센터</b><em class="route ${r.reservation.route === 'AICC' ? 'aicc' : ''}">${esc(r.reservation.route)}</em></div><div class="l2"><span>${r.live ? esc(E.CUSTOMER.name) : '고객'}</span><span>${md(r.reservation.at)}</span></div></div>`;
    else if (st > 2) cells[2] = dot(r.reservation ? r.reservation.at : null, '');
    if (st === 3) cells[3] = `<div class="tbox"><div class="l1"><b>${esc(r.center)}센터</b></div><div class="l2"><span>입고</span><span>${md(r.times[3] || Date.now())}</span></div></div>`;
    else if (st > 3) cells[3] = dot(r.times[3], '');
    if (st >= 4) {
      const t5 = r.times[5], t7 = r.times[7];
      cells[4] = `<div class="tbox wide"><div class="l2"><span>정비 완료</span><b>${t5 ? md(t5) : '—'}</b></div><div class="l2"><span>정비 종결</span><b>${t7 ? md(t7) : '—'}</b></div>${t7 ? `<div class="l2"><span>Lead Time</span><b>${span(t7 - r.at)}</b></div>` : ''}</div>`;
    }
    return cells.map((x, i) => `<div class="tc">${x || '<span class="tick"></span>'}</div>`).join('');
  }
  function listRow(r) {
    const s = sla(r);
    const urgent = r.stage === 0 && !r.stopInfo && !r.pending && s.left <= D;
    const fl = r.live && flash[r.id] && Date.now() - flash[r.id] < 6000;
    return `<div class="row ${r.stopInfo ? 'stopped' : ''} ${s.over && r.stage === 0 && !r.pending ? 'expired' : ''} ${r.live ? 'live' : ''} ${fl ? 'flash' : ''}" data-open="${r.id}">
      <div class="info">${badge(r.g, r.stopInfo)}<span class="code">${esc(r.code)}${r.more ? `<small>외 ${r.more}건</small>` : ''}</span>
        <span class="ctr">${esc(r.center)}</span><span class="mdl">${esc(r.model)}</span><span class="plate">${esc(r.plate)}${r.live ? '<em class="livetag">e-Care 실시간</em>' : ''}</span>
        <span class="tm">${md(r.at)}</span>${stChip(r)}<span class="flt">${r.filter ? '<b>ON</b>' : ''}</span></div>
      <div class="tl ${urgent ? 'urg' : ''}">${timeline(r)}</div></div>`;
  }

  /* ---------------- list view ---------------- */
  function listView(all) {
    const by = (k) => all.filter((r) => stageKey(r) === k);
    const near = by(0).filter((r) => !r.pending && sla(r).left <= D).length;
    const head = `<div class="lhead"><div class="info"><span>경고등</span><span>대응센터</span><span>차종</span><span>차량번호</span><span>최초 발생일시</span><span>진행상태</span><span>정비필터</span></div>
      <div class="tl"><div class="th">컨택대기${near ? `<em class="near">임박 ${near}</em>` : ''}<b>${by(0).length}</b></div><div class="th">예약대기<b>${by(1).length + by('stop').length}</b></div><div class="th">예약<b>${by(2).length}</b></div><div class="th">입고<b>${by(3).length}</b></div><div class="th">정비 · 종결<small>정비 ${by(4).length} · 종결 ${by(5).length}</small></div></div></div>`;
    const groups = [[0], [1, 'stop'], [2], [3], [4, 5]].map((ks) => {
      const rs = all.filter((r) => ks.includes(stageKey(r))).sort((a, b) => (b.live - a.live) || (ks[0] === 0 ? sla(a).left - sla(b).left : a.at - b.at));
      return rs.length ? `<div class="grp">${rs.map(listRow).join('')}</div>` : '';
    }).join('');
    return head + `<div class="lbody">${groups}</div>`;
  }

  /* ---------------- card view ---------------- */
  function card(r) {
    const s = sla(r);
    const last = r.contacts[r.contacts.length - 1];
    const warn = (r.stage === 0 && !r.pending && s.left <= D) || s.late;
    let mid = '';
    if (r.stage === 0 && !r.stopInfo) mid = slaBox(r);
    else if (r.stage === 1 || r.stopInfo) mid = contactBox(last);
    else if (r.stage === 2 && r.reservation) mid = `<dl class="resv"><dt>고객명</dt><dd>${r.live ? esc(E.CUSTOMER.name) : '고객'}</dd><dt>예약경로</dt><dd><em class="route ${r.reservation.route === 'AICC' ? 'aicc' : ''}">${esc(r.reservation.route)}</em></dd><dt>실예약일시</dt><dd>${md(r.reservation.at)}</dd></dl>`;
    return `<div class="card ${r.stopInfo ? 'stopped' : ''} ${warn ? 'warnb' : ''} ${r.live ? 'live' : ''}" data-open="${r.id}">
      <div class="ch">${badge(r.g, r.stopInfo)}<div><b>${esc(r.plate)}</b><small>${esc(r.model)}${r.stopInfo ? ' <span class="st stop">중단</span>' : ''}</small></div><div class="cr"><small>${esc(r.center)}센터</small><small>${md(r.at)}</small></div></div>
      ${r.stage < 2 || r.stopInfo ? `<p class="wn">경고등명 <b>${esc(r.wname)}</b>${r.more ? ` 외 ${r.more}건` : ''}${r.live ? '<em class="livetag">e-Care 실시간</em>' : ''}</p>` : ''}
      ${mid}
      ${r.stage < 2 || r.stopInfo ? `<div class="cf"><span>발생 후 경과</span><b>${span(Date.now() - r.at)}</b></div>` : ''}</div>`;
  }
  function cardView(all) {
    const col = (title, ks, extra) => {
      const rs = all.filter((r) => ks.includes(stageKey(r))).sort((a, b) => (b.live - a.live) || ((sla(a).left <= D) - (sla(b).left <= D)) * -1 || a.at - b.at);
      return `<section class="kcol"><h3><i></i>${title} <b>${rs.length}</b>${extra(rs)}</h3><div class="kbody">${rs.map(card).join('') || '<p class="empty">해당 건 없음</p>'}</div></section>`;
    };
    return `<div class="kanban">
      ${col('컨택대기', [0], (rs) => { const o = rs.filter((r) => !r.pending && sla(r).over).length, n = rs.filter((r) => !r.pending && !sla(r).over && sla(r).left <= D).length; return `${o ? `<em class="exp">만료 ${o}</em>` : ''}${n ? `<em class="near">임박 ${n}</em>` : ''}`; })}
      ${col('예약대기', [1, 'stop'], (rs) => { const st = rs.filter((r) => r.stopInfo).length; return st ? `<em class="stp">중단 ${st}</em>` : ''; })}
      ${col('예약', [2], (rs) => { const a = rs.filter((r) => r.reservation && r.reservation.route === 'AICC').length; return a ? `<em class="aic">AICC ${a}</em>` : ''; })}
    </div>`;
  }

  /* ---------------- side panel, toolbar ---------------- */
  function side(all) {
    const n = (k) => all.filter((r) => stageKey(r) === k).length;
    return `<aside class="side">
      <div class="logo"><b>TOYOTA</b><small>e-Care DashBoard</small></div>
      <div class="center"><small>서비스센터</small><b>${esc(LOGIN)}</b><span>딜러 · 센터 변경</span></div>
      <div class="clock"><b data-clock></b><small data-date></small></div>
      <div class="views"><button data-view="list" class="${view === 'list' ? 'on' : ''}">☰ 리스트형</button><button data-view="card" class="${view === 'card' ? 'on' : ''}">▦ 카드형</button></div>
      <div class="stl"><div class="h"><span>단계별 목록</span><small>누르면 펼침</small></div>
        ${[['예약', 2], ['입고', 3], ['정비', 4], ['종결', 5], ['중단', 'stop']].map(([t, k]) => `<button data-stage="${k}"><i></i>${t}<b>${n(k)}</b><span>›</span></button>`).join('')}</div>
      <div class="legend"><small>긴급도</small>${['A', 'B', 'C'].map((g) => `<div>${badge(g)}${GRADE[g].k}</div>`).join('')}
        <small>만료 잔여기간</small><div><i class="lg gry"></i>3~7일</div><div><i class="lg yel"></i>1~3일</div><div><i class="lg red"></i>24시간 이하</div><div class="lgov"><i class="lg over"></i>SLA 만료</div></div>
      <div class="me"><i>이</i>이정비 · 서비스 어드바이저</div>
    </aside>`;
  }
  function toolbar(all) {
    const withC = all.filter((r) => r.contacts.length && !r.pending);
    const inTime = withC.filter((r) => !sla(r).late).length;
    const today = new Date(); const from = new Date(Date.now() - 6 * D);
    const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return `<div class="bar">
      <span class="date">${ymd(from)} ▭</span><span class="sep">~</span><span class="date">${ymd(today)} ▭</span><span class="nav">‹ ›</span>
      <span class="seg">${['D', 'W', 'M', 'Y'].map((x) => `<b class="${x === 'W' ? 'on' : ''}">${x}</b>`).join('')}</span>
      <label class="srch">⌕<input data-q placeholder="차량번호 검색" value="${esc(q)}"></label>
      <span class="flt">필터</span><span class="dd">경고등 ⌄</span><span class="dd">차종 ⌄</span><span class="dd">진행상태 ⌄</span>
      <span class="rate">SLA 시간내 컨택 <b>${inTime} / ${withC.length}</b> (${withC.length ? Math.round(inTime / withC.length * 100) : 100}%)</span></div>`;
  }

  /* ---------------- detail popup ---------------- */
  function findRow(id) { return rows().find((r) => r.id === id) || liveRows().find((r) => r.id === id); }
  function popup() {
    if (!detail) return '';
    const r = findRow(detail);
    if (!r) { detail = null; return ''; }
    const s = sla(r);
    const mine = r.center === short(LOGIN);
    const editable = mine && !r.stopInfo && r.stage < 3 && !r.pending;
    const last = r.contacts[r.contacts.length - 1];
    const canStop = editable && last && STOP_REPLIES.includes(last.reply);
    const steps = STAGES.map((t, i) => { const cur = i === r.stage && !r.stopInfo; const done = i < r.stage; return `<li class="${done ? 'done' : cur ? 'cur' : ''}"><i></i><div><b>${t}</b>${i === 0 ? `<small>경고등 발생 ${md(r.at)}</small>` : ''}${cur ? '<em>진행중</em>' : ''}${done && r.times && r.times[i === 4 ? 4 : i === 5 ? 7 : i] ? `<small>${md(r.times[i === 4 ? 4 : i === 5 ? 7 : i])}</small>` : ''}</div></li>`; }).join('');
    const vin = r.live ? E.VEHICLE.vin : `JT${r.plate.replace(/\D/g, '').padEnd(6, '7')}K${r.id.toUpperCase()}X41`;
    const left = `<div class="pl">
      <div class="gl">${badge(r.g, r.stopInfo)}<span>${GRADE[r.g].k} 대응</span>${stChip(r)}</div>
      <b class="pp">${esc(r.plate)}</b><small class="pm">${esc(r.model)}</small>
      <dl><dt>경고등 발생일시</dt><dd>${ymdhm(r.at)}</dd><dt>대응센터</dt><dd>${esc(r.center)}</dd></dl>
      ${r.pending ? '<div class="slab pend"><b>e-Care 지원실 상담 중</b><small>이관 시 SLA 시작</small></div>' : `<div class="psla ${gaugeCls(s.left)}"><small>첫 컨택 시점 SLA 잔여</small><b>${s.done ? (s.late ? 'SLA 초과 컨택' : '시간 내 컨택') : (s.over ? '-' : '') + span(Math.abs(s.left))}</b><span>${md(s.due)}</span><span class="gauge"><i style="width:${s.done ? 100 : Math.max(0, Math.min(100, s.left / SLA_OF[r.g] * 100)).toFixed(1)}%"></i></span></div>`}
      <h5>진행 단계</h5><ol class="steps ${r.stopInfo ? 'stopped' : ''}">${steps}</ol>${r.stopInfo ? `<div class="stopbox">대응 중단 · ${esc(r.stopInfo.reason)}<small>${md(r.stopInfo.at)}</small></div>` : ''}</div>`;
    const info = `
      <h4>차량 / 고객정보</h4><div class="grid3"><div><small>차대번호(VIN)</small><b>${esc(vin)}</b></div><div><small>e-Care 가입자명</small><b>${r.live ? esc(E.CUSTOMER.name) : esc(r.plate.slice(-4)) + ' 고객'}</b></div><div><small>가입자 연락처</small><b>${r.live ? E.CUSTOMER.phone.replace(/-(\d{4})-/, '-****-') : '010-****-' + r.plate.slice(-4)}</b></div>
        <div><small>차량 헤드유닛</small><b>${r.live ? '01229384417' : '0129' + r.plate.replace(/\D/g, '').padEnd(7, '3')}</b></div><div><small>e-Care 선호 서비스센터</small><b>${esc(r.center)} 서비스센터</b></div></div>
      ${r.g === 'A' ? `<h4>상담정보 <small>긴급(A) 등급 · e-Care 고객지원실</small></h4><div class="grid2"><div><small>상담일시</small><b>${r.consult ? ymdhm(r.consult.at) : '상담 진행 중'}</b></div><div><small>상담내용</small><b>${r.consult ? esc(r.consult.text) : '—'}</b></div>${r.consult && r.consult.request ? `<div class="full"><small>센터 요청 사항</small><b>${esc(r.consult.request)}</b></div>` : ''}</div>` : ''}
      ${editable ? `<div class="form"><div class="fh"><h4>컨택결과 등록</h4><button class="ghost" data-stop ${canStop ? '' : 'disabled'} title="최근 고객응답이 입고거부 · 타사입고 · 컨택불가일 때">대응중단</button></div>
        <div class="fr"><label>컨택방법<select data-f="method"><option>전화</option><option>문자</option><option>카카오톡</option></select></label><label>컨택결과<select data-f="result"><option>컨택</option><option>부재</option></select></label><label>고객응답<select data-f="reply"><option>예약확정</option><option>예약대기</option><option>재컨택필요</option><option>입고거부</option><option>타사입고</option><option>컨택불가</option></select></label></div>
        <label class="memo">컨택 메모<textarea data-f="memo" placeholder="컨택 결과에 대한 메모를 입력하세요"></textarea></label>
        <div class="ff"><small>저장하면 컨택 이력에 추가되고 진행 단계가 갱신됩니다${r.live ? ' · e-Care 고객지원실(CCW) · 데이터 흐름에 반영' : ''}.</small><button class="dark" data-save>저장</button></div></div>`
        : `<div class="ro">${!mine ? `대응센터(${esc(r.center)})가 로그인 센터(${esc(short(LOGIN))})와 달라 조회만 가능합니다.` : r.pending ? 'e-Care 고객지원실 상담 · 이관 후 컨택 등록이 가능합니다.' : r.stopInfo ? '대응 중단된 건입니다.' : '입고 이후 단계는 진행 현황만 표시합니다.'}</div>`}
      <h4>컨택 이력 <small>${r.contacts.length}</small></h4><table class="hist"><thead><tr><th>회차</th><th>컨택일시</th><th>결과</th><th>고객응답</th><th>담당</th><th>컨택 메모</th></tr></thead><tbody>
        ${r.contacts.slice().reverse().map((k) => `<tr><td>${k.n}차</td><td>${ymdhm(k.t)}</td><td><em class="${k.result === '컨택' ? 'ok' : 'miss'}">${esc(k.result)}</em></td><td>${esc(k.reply)}</td><td>${esc(k.agent)}</td><td class="l">${esc(k.memo || '—')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">컨택 이력 없음</td></tr>'}</tbody></table>`;
    const dtc = (r.live && r.c && r.c.warn && r.c.warn.dtc) || 'P0A80';
    const wlist = [[r.g, r.code, r.wname, `${r.wname} 이상 감지`]].concat(r.more ? Object.values(E.WNG).filter((w) => w.code !== r.code).slice(0, r.more).map((w) => [w.case, w.code, w.name, `${w.name} 관련 경고`]) : []);
    const warn = `<h4>Warning <small>${wlist.length}</small></h4><table class="hist"><thead><tr><th>등급</th><th>경고등 코드</th><th>경고등</th><th>경고 내용</th></tr></thead><tbody>${wlist.map(([g, c, n, d]) => `<tr><td>${badge(g)}</td><td>${esc(c)}</td><td class="l">${esc(n)}</td><td class="l">${esc(d)}</td></tr>`).join('')}</tbody></table>
      <h4>DTC</h4><table class="hist"><thead><tr><th>진단코드</th><th>진단명</th><th>진단 내용</th></tr></thead><tbody><tr><td>${esc(dtc)}</td><td class="l">${esc(r.wname)}</td><td class="l">${esc(r.wname)} 관련 고장 코드 · 서비스센터 정밀 진단 필요</td></tr></tbody></table>`;
    return `<div class="ov" data-close-bg><div class="dlg">${left}<div class="pr"><div class="tabs"><button data-tab="info" class="${detailTab === 'info' ? 'on' : ''}">기본정보</button><button data-tab="warn" class="${detailTab === 'warn' ? 'on' : ''}">Warning / DTC <i>${wlist.length + 1}</i></button><button class="x" data-close>✕</button></div><div class="pb">${detailTab === 'info' ? info : warn}</div></div></div></div>`;
  }

  /* ---------------- stage list (side panel) ---------------- */
  let stageList = null;
  function stagePanel(all) {
    if (stageList == null) return '';
    const rs = all.filter((r) => stageKey(r) === stageList);
    const name = stageList === 'stop' ? '중단' : STAGES[stageList];
    const when = (r) => (stageList === 'stop' ? r.stopInfo.at : stageList === 2 ? (r.reservation && r.reservation.at) : stageList === 3 ? r.times[3] : stageList === 4 ? r.times[4] : r.times[7]);
    return `<div class="spanel"><div class="sh"><b>${name}</b><span>${rs.length}건</span><button class="x" data-stage-close>✕</button></div>
      ${rs.map((r) => `<div class="si" data-open="${r.id}">${badge(r.g, stageList === 'stop')}<div><b>${esc(r.plate)}</b><small>${esc(r.model)}</small></div><div class="sr">${stageList === 'stop' ? `<em>${esc(r.stopInfo.reason)}</em>` : ''}<small>${{ 2: '실예약일시', 3: '입고일시', 4: '정비시작일시', 5: '정비종결일시', stop: '중단일시' }[stageList]}</small><span>${when(r) ? md(when(r)) : '—'}</span></div></div>`).join('') || '<p class="empty">해당 건 없음</p>'}</div>`;
  }

  /* ---------------- render ---------------- */
  let lastKey = '';
  function render(force) {
    const all = rows();
    const key = JSON.stringify([view, detail, detailTab, stageList, q, snap && snap.cases.map((c) => [c.id, c.dms, c.dmsStop, (c.contacts || []).length, c.contact, c.sheet && c.sheet.saved]), Object.keys(edits).length, Math.floor(Date.now() / 30000)]);
    if (!force && key === lastKey) return;
    const f = document.activeElement;
    if (!force && f && app.contains(f) && f.matches('input, textarea, select')) return;
    lastKey = key;
    app.innerHTML = `${side(all)}<main class="main">${toolbar(all)}<div class="content ${view}">${view === 'list' ? listView(all) : cardView(all)}</div></main>${stagePanel(all)}${popup()}`;
    tick();
  }
  function tick() {
    const d = new Date();
    const c = $('[data-clock]'), dt = $('[data-date]');
    if (c) c.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    if (dt) dt.textContent = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${'일월화수목금토'[d.getDay()]})`;
  }
  setInterval(tick, 1000);
  setInterval(() => render(), 1000);

  /* ---------------- events ---------------- */
  app.addEventListener('click', (e) => {
    const t = e.target.closest('[data-view],[data-open],[data-close],[data-close-bg],[data-tab],[data-save],[data-stop],[data-stage],[data-stage-close]');
    if (!t) return;
    const d = t.dataset;
    if (d.view) { view = d.view; localStorage.setItem('dms-view', view); render(true); return; }
    if ('closeBg' in d && e.target !== t) return;          // a click inside the dialog
    if ('close' in d || 'closeBg' in d) { detail = null; render(true); return; }
    if (d.tab) { detailTab = d.tab; render(true); return; }
    if ('stageClose' in d) { stageList = null; render(true); return; }
    if (d.stage != null && !('open' in d)) { const k = d.stage === 'stop' ? 'stop' : +d.stage; stageList = stageList === k ? null : k; render(true); return; }
    if (d.open) { detail = d.open; detailTab = 'info'; render(true); return; }
    const r = detail && findRow(detail);
    if (!r) return;
    if ('save' in d) {
      const v = (k) => $(`[data-f="${k}"]`).value;
      const contact = { t: Date.now(), method: v('method'), result: v('result'), reply: v('reply'), memo: v('memo').trim(), agent: '이정비' };
      if (r.live) Link.send('cmd', { name: 'dmsContact', args: { id: r.id, ...contact } });
      else { const m = { id: r.id, contact }; applyEdit(m); Link.send('dms-edit', m); }
      setTimeout(() => render(true), 120);
    }
    if ('stop' in d && !t.disabled) {
      const last = r.contacts[r.contacts.length - 1];
      const reason = last ? last.reply : '입고거부';
      if (r.live) Link.send('cmd', { name: 'dmsStop', args: { id: r.id, reason } });
      else { const m = { id: r.id, stop: reason, t: Date.now() }; applyEdit(m); Link.send('dms-edit', m); }
      setTimeout(() => render(true), 120);
    }
  });
  app.addEventListener('input', (e) => { if (e.target.matches('[data-q]')) { q = e.target.value; const pos = e.target.selectionStart; render(true); const i = $('[data-q]'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } } });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && detail) { detail = null; render(true); } });

  // the control panel can open the live case on every DMS screen
  Link.on('dms-open', (d) => { const id = d.id || (liveRows()[0] || {}).id; if (id) { detail = id; detailTab = 'info'; render(true); } });
  Link.on('dms-close', () => { detail = null; render(true); });

  /* ---------------- the advisor's desk: office photo → monitor → the part of the DMS in play ----------------
   * 'office' (default): the DMS on the monitor of the service advisor's desk, with a
   * camera that follows the main flow — the room while nothing happens, the monitor
   * when an e-Care case comes in, and in close on the row or the dialog being worked
   * on, so the audience at the back can read it. 'app' (?view=app or the control
   * panel's 화면만): the DMS alone, fitted to the window. The control panel's
   * call-center camera (Link 'ccw-cam') steers this desk the same way. */
  const params = new URLSearchParams(location.search);
  let mode = params.get('view') === 'app' ? 'app' : 'office';
  const IMG = { w: 1344, h: 752 }, SCR = { x: 398, y: 214, w: 501, h: 267 }, OW = 2026;   // the DMS is 2026x1080 on the monitor
  const stageEl = $('#stage'), capEl = $('#cap');
  const setBody = () => { document.body.classList.toggle('view-office', mode === 'office'); document.body.classList.toggle('view-app', mode === 'app'); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const cam = { to: 'office', rect: null, from: null, cur: null, t0: 0, dur: 0 };
  const same = (a, b) => (!a && !b) || (a && b && Math.abs(a.x - b.x) < 24 && Math.abs(a.y - b.y) < 24 && Math.abs(a.w - b.w) < 24 && Math.abs(a.h - b.h) < 24);
  function camTo(kind, dur, rect) {
    if (kind === cam.to && same(rect, cam.rect)) return;
    cam.from = cam.cur; cam.to = kind; cam.rect = rect || null; cam.t0 = performance.now(); cam.dur = cam.from ? dur : 0;
  }
  let screenOnly = false;       // 화면만: the room fades, the monitor fills the view, focus still zooms
  function viewOf(kind, rect, vw, vh, s0, s1) {
    if (kind === 'office') return { s: s0, cx: IMG.w / 2, cy: IMG.h / 2 };
    const sScr = Math.min(vw / SCR.w, vh / SCR.h);
    if (kind === 'screen') return { s: sScr, cx: SCR.x + SCR.w / 2, cy: SCR.y + SCR.h / 2 };
    if (kind === 'focus' && rect && screenOnly) {
      const k = SCR.w / OW;
      const r = { x: SCR.x + rect.x * k, y: SCR.y + rect.y * k, w: rect.w * k, h: rect.h * k };
      const s = clamp(Math.min(vw / (r.w * 1.1), vh / (r.h * 1.18)), sScr * 1.05, sScr * 3.6);
      return { s, cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
    }
    const mon = { s: s1, cx: SCR.x + SCR.w / 2, cy: SCR.y + SCR.h / 2 + 14 };
    if (kind !== 'focus' || !rect) return mon;
    const k = SCR.w / OW;
    const r = { x: SCR.x + rect.x * k, y: SCR.y + rect.y * k, w: rect.w * k, h: rect.h * k };
    const s = clamp(Math.min(vw / (r.w * 1.12), vh / (r.h * 1.2)), s1 * 1.15, s1 * 4.2);
    return { s, cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
  }
  function place() {
    if (mode === 'app') {
      stageEl.style.transform = '';
      const k = Math.min(innerWidth / 1920, innerHeight / 1080);
      app.style.transform = `translate(${((innerWidth - 1920 * k) / 2).toFixed(1)}px, ${((innerHeight - 1080 * k) / 2).toFixed(1)}px) scale(${k.toFixed(5)})`;
      return;
    }
    app.style.transform = '';
    const vw = innerWidth, vh = innerHeight, tall = vw / vh < 1;
    document.body.classList.toggle('tall', tall);
    const s0 = tall ? vw / IMG.w * 1.12 : Math.max(vw / IMG.w, vh / IMG.h);
    const s1 = Math.max(s0, Math.min(vw / SCR.w, vh / SCR.h) * (tall ? 0.97 : 0.8));
    const target = viewOf(cam.to, cam.rect, vw, vh, s0, s1);
    let v = target;
    if (cam.dur > 0 && cam.from) {
      const p = clamp((performance.now() - cam.t0) / cam.dur, 0, 1), e = ease(p), A = cam.from;
      v = { s: Math.exp(Math.log(A.s) + (Math.log(target.s) - Math.log(A.s)) * e), cx: A.cx + (target.cx - A.cx) * e, cy: A.cy + (target.cy - A.cy) * e };
      if (p >= 1) cam.dur = 0;
    }
    cam.cur = v;
    let tx = vw / 2 - v.cx * v.s, ty = vh / 2 - v.cy * v.s;
    tx = clamp(tx, Math.min(vw - IMG.w * v.s, 0), Math.max(vw - IMG.w * v.s, 0));
    ty = clamp(ty, Math.min(vh - IMG.h * v.s, 0), Math.max(vh - IMG.h * v.s, 0));
    const moving = cam.dur > 0;
    stageEl.style.willChange = moving ? 'transform' : 'auto';
    const tr = moving ? `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${v.s.toFixed(5)})` : `translate(${Math.round(tx)}px, ${Math.round(ty)}px) scale(${v.s.toFixed(5)})`;
    if (stageEl.style.transform !== tr) stageEl.style.transform = tr;
  }
  function frame() { place(); requestAnimationFrame(frame); }

  /* the live e-Care case and what the center is doing with it now */
  const liveCase = () => snap && snap.cases.filter((c) => c.dms >= 0 || (c.wcase === 'A' && c.contact < 3)).slice(-1)[0];
  const lastChange = () => { const c = liveCase(); return c ? Math.max(flash[c.id] || 0, c.at || 0, (c.sheet && c.sheet.saved) || 0) : 0; };
  function stepText() {
    const c = liveCase();
    if (!c) return null;
    const dlg = !!app.querySelector('.ov .dlg');
    if (c.dms < 0) return ['e-Care 고객지원실 상담 중', '긴급 경고 · 이관 대기'];
    if (c.dmsStop) return ['대응 중단', c.dmsStop];
    const T = {
      0: ['상담 메모 이관 접수 · 컨택대기', '고객지원실 → 서비스센터 (WAM-MEMO-001) · 첫 컨택 SLA 시작'],
      1: ['고객 컨택 · 예약대기', `서비스 어드바이저 ${'이정비'} 컨택 등록`],
      2: ['입고 예약 확정', '컨택 결과 → CCW · 데이터 흐름에 반영 (DMS-SVC-002)'],
      3: ['차량 입고', '긴급출동 견인 차량 서비스센터 도착'],
      4: ['정비 진행', '진단 · 수리'], 5: ['정비 완료', '고객 인도 준비'], 6: ['고객 인도', ''], 7: ['정비 종결', 'e-Care 케이스 종결'],
    };
    const t = T[c.dms] || T[0];
    return dlg && c.dms <= 1 ? ['컨택 결과 등록', `${E.CUSTOMER.name} 고객 · ${E.VEHICLE.model} · 예약 확정`] : t;
  }
  function focusSel() {
    if (app.querySelector('.ov .dlg')) return '.ov .dlg';
    if (app.querySelector('.spanel')) return '.spanel';
    const c = liveCase();
    if (c && Date.now() - lastChange() < 12000) return view === 'list' ? '.row.live' : '.card.live';
    return null;
  }
  function rectOf(sel) {
    const e = app.querySelector(sel);
    if (!e) return null;
    // the live row may sit below the fold of the list: scroll the list (only the list) to it
    const box = e.closest('.lbody, .kbody');
    if (box && sel !== '.ov .dlg') {
      const top = e.offsetTop - box.offsetTop, want = Math.max(0, top - box.clientHeight / 2 + e.offsetHeight / 2);
      if (top < box.scrollTop || top + e.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = want;
    }
    const ar = app.getBoundingClientRect(), W = mode === 'office' ? OW : 1920, k = ar.width / W || 1;
    const er = e.getBoundingClientRect();
    let r = { x: (er.left - ar.left) / k, y: (er.top - ar.top) / k, w: er.width / k, h: er.height / k };
    // a list row: the whole width of the table, with the header above it
    if (sel === '.row.live') { const m = app.querySelector('.content'); if (m) { const mr = m.getBoundingClientRect(); r = { x: (mr.left - ar.left) / k, y: Math.max(0, r.y - 80), w: Math.min(mr.width / k, 1240), h: r.h + 150 }; } }
    // never past the edges of the screen
    r.y = Math.max(0, r.y); r.h = Math.min(r.h, 1080 - r.y);
    if (r.w < 20 || r.h < 20) return null;
    return r;
  }
  let camHold = 'auto', quiet = 0;
  function camPolicy() {
    const st = stepText(), live = !!liveCase();
    const busyNow = live && (Date.now() - lastChange() < 14000 || !!app.querySelector('.ov .dlg'));
    capEl.classList.toggle('on', !!st && (busyNow || camHold !== 'auto'));
    if (st) { $('b', capEl).textContent = st[0]; $('small', capEl).textContent = st[1] || ''; }
    if (mode !== 'office') return;
    if (screenOnly) {
      const sel = focusSel(), r = sel && rectOf(sel);
      if (r) camTo('focus', cam.to === 'focus' ? 1600 : 2200, r); else camTo('screen', 2200);
      return;
    }
    if (camHold === 'office' || camHold === 'monitor') { camTo(camHold, 2400); return; }
    if (busyNow) quiet = 0; else if (!quiet) quiet = Date.now();
    // idle: the whole desk, framed like the call center room (same photo-to-monitor proportion)
    if (!busyNow && Date.now() - quiet >= 4000) { camTo('office', 2800); return; }
    const sel = focusSel(), r = sel && rectOf(sel);
    if (r) camTo('focus', cam.to === 'focus' ? 1600 : 2400, r); else camTo('monitor', 2400);
  }
  Link.on('ccw-cam', (d) => {
    const v = d.view || 'auto';
    if (mode !== 'office' && params.get('view') !== 'app') { mode = 'office'; setBody(); }
    screenOnly = v === 'screen';
    document.body.classList.toggle('screen-only', screenOnly);
    camHold = v === 'office' || v === 'monitor' ? v : 'auto';
    camPolicy();
  });
  Link.send('ccw-hello', {});
  setBody();
  setInterval(camPolicy, 400);
  render(true);
  requestAnimationFrame(frame);
})();
