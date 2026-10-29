/* e-Care call center (CCW) screen: renders the director's snapshots, sends the
 * agent's actions back. Views: office (photo with the live monitor), monitor
 * (the agent screen filling the display), transcript (?view=transcript). */
(function () {
  'use strict';

  const E = window.ECare;
  const $ = (s, r) => (r || document).querySelector(s);
  const params = new URLSearchParams(location.search);
  const VIEW = params.get('view') || 'office';
  const IMG = { w: 1344, h: 752 }, SCR = { x: 425, y: 265, w: 489, h: 245 };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  let snap = null;          // latest e-Care snapshot from the director
  let veh = null;           // latest vehicle state
  let lastVeh = 0;
  let page = 'dash';
  let soundOn = false;
  let renderedKey = '';

  document.body.className = VIEW === 'transcript' ? 'view-transcript' : 'view-office';

  /* ---------------- camera: office photo <-> monitor ---------------- */
  const stage = $('#stage');
  const cam = { z: VIEW === 'monitor' ? 1 : 0, to: VIEW === 'monitor' ? 1 : 0, from: 0, t0: 0, dur: 0 };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function camTo(z, dur) { cam.from = cam.z; cam.to = z; cam.t0 = performance.now(); cam.dur = dur; }
  function placeStage() {
    if (cam.dur > 0) {
      const p = clamp((performance.now() - cam.t0) / cam.dur, 0, 1);
      cam.z = cam.from + (cam.to - cam.from) * ease(p);
      if (p >= 1) cam.dur = 0;
    }
    const vw = innerWidth, vh = innerHeight;
    const s0 = Math.max(vw / IMG.w, vh / IMG.h);
    const s1 = Math.min(vw / SCR.w, vh / SCR.h) * 0.985;
    const s = Math.exp(Math.log(s0) + (Math.log(s1) - Math.log(s0)) * cam.z);
    const k = (s - s0) / (s1 - s0 || 1);
    const cx = IMG.w / 2 + (SCR.x + SCR.w / 2 - IMG.w / 2) * k;
    const cy = IMG.h / 2 + (SCR.y + SCR.h / 2 - IMG.h / 2) * k;
    let tx = vw / 2 - cx * s, ty = vh / 2 - cy * s;
    tx = clamp(tx, Math.min(vw - IMG.w * s, 0), Math.max(vw - IMG.w * s, 0));
    ty = clamp(ty, Math.min(vh - IMG.h * s, 0), Math.max(vh - IMG.h * s, 0));
    stage.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${s.toFixed(5)})`;
    $('#viewBtn').textContent = cam.to > 0.5 ? '사무실 보기' : '상담원 화면';
  }

  /* ---------------- link ---------------- */
  Link.on('ecare', (d) => { snap = d; render(); });
  Link.on('veh', (d) => { veh = d; lastVeh = Date.now(); });
  Link.on('ccw-open-case', () => { page = 'case'; if (VIEW !== 'transcript' && cam.to < 0.5) camTo(1, 2600); render(true); });
  Link.on('say', (d) => { if (VIEW !== 'transcript') play(d.line.audio); typing = { text: d.line.text, at: Date.now(), dur: d.line.dur }; });
  Link.on('@transport', () => conn());
  Link.send('hello', { screen: VIEW === 'transcript' ? 'transcript' : 'ccw' });
  const cmd = (name, args) => Link.send('cmd', { name, args: args || {} });

  function conn() {
    const ok = Date.now() - lastVeh < 2500;
    $('#conn').textContent = ok ? `● 차량 연결됨 · ${Link.transport === 'lan' ? 'LAN' : '이 PC'}` : '○ 차량 시뮬레이터 연결 대기';
    $('#conn').style.color = ok ? '#7fe7a8' : '#ffb46b';
  }

  /* ---------------- audio ---------------- */
  let typing = null;
  const audios = {};
  function play(src) {
    if (!soundOn || !src) return;
    const a = audios[src] || (audios[src] = new Audio(src));
    a.currentTime = 0;
    a.play().catch(() => {});
  }
  function unlock() {
    if (soundOn) return;
    soundOn = true;
    $('#sound').classList.add('on');
    E.CALL_OUT.forEach((l) => { const a = audios[l.audio] = new Audio(l.audio); a.preload = 'auto'; });
  }
  document.addEventListener('pointerdown', unlock, { once: false });
  $('#sound').addEventListener('click', unlock);

  /* ---------------- helpers ---------------- */
  const active = () => snap && snap.cases.find((c) => c.id === snap.active);
  const agentOf = (c) => snap && c && snap.agents.find((a) => a.id === (c.agent || (c.assign && c.assign.agent)));
  function slaLeft(c) { return E.SLA - (Date.now() - c.slaBase); }

  function warnIcon(canvas, c) {
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.height = 128;
    ctx.fillStyle = '#16181c';
    ctx.fillRect(0, 0, 128, 128);
    const col = c.level === 'red' ? '#ff3527' : '#ffb21e';
    SimIcons.drawIcon(ctx, c.warn.id, 64, 64, 84, col, c.level === 'red' ? 'rgba(255,50,30,0.8)' : 'rgba(255,165,20,0.8)');
  }

  /* ---------------- CCW app ---------------- */
  const app = $('#app');
  const MENU = [['대시보드', 'dash'], ['e-Care 경고', 'case'], ['상담 이력'], ['고객 조회'], ['차량 조회'], ['긴급출동 현황'], ['서비스센터 연계'], ['통계 · 리포트'], ['설정']];

  function shell(inner) {
    const c = active();
    const me = snap ? snap.agents[0] : { name: '김하늘', state: '대기' };
    const open = snap ? snap.cases.filter((x) => x.kind === 'emergency' && x.contact < 3).length : 0;
    const idle = snap ? snap.agents.filter((a) => a.state === '대기').length : 3;
    const st = me.state === '통화 중' ? 'busy' : me.state === '후처리' ? 'wrap' : '';
    return `<div class="ccw">
      <aside class="side">
        <div class="brand"><b>TOYOTA</b><small>e-CARE · CALL CENTER WEB</small></div>
        <nav>${MENU.map(([n, k]) => `<div class="mi ${k && k === page ? 'on' : ''}" data-page="${k || ''}"><i></i>${n}${k === 'case' && open ? `<span class="cnt">${open}</span>` : ''}</div>`).join('')}</nav>
        <div class="me"><div class="av">${esc(me.name.slice(0, 1))}</div><div><b>${esc(me.name)} 상담원</b><small><span class="dot ${st}"></span>${esc(me.state)} · 내선 ${esc(me.ext || '2101')}</small></div></div>
      </aside>
      <div class="main">
        <header class="top">
          <div class="crumb">e-Care<b>${page === 'case' ? 'e-Care 경고 상세' : '상담 대시보드'}</b></div>
          <div class="tabs"><span class="tab ${page === 'dash' ? 'on' : ''}">실시간 모니터링</span><span class="tab ${page === 'case' ? 'on' : ''}">경고 상세</span><span class="tab">긴급출동</span></div>
          <div class="right">
            ${c && c.kind === 'emergency' && c.contact === 0 ? `<span class="pill red">미컨택 긴급 ${open}건</span>` : ''}
            <span class="pill green"><span class="dot"></span>대기 상담원 ${idle}명</span>
            <span class="clock num" data-clock></span>
          </div>
        </header>
        <div class="content">${inner}</div>
      </div>
    </div>`;
  }

  function dashboard() {
    const rows = [
      ['EC-20261028-0038', '긴급', '브레이크 시스템 이상', 'LEXUS LX 700h', '이관 완료', '13:42'],
      ['EC-20261028-0035', '정비', '엔진 점검', 'Toyota Land Cruiser 250', '이관 완료', '11:05'],
      ['EC-20261027-0031', '긴급', '엔진 과열', 'LEXUS GX 550', '상담 완료', '18:20'],
      ['EC-20261027-0029', '정비', '타이어 공기압', 'Toyota RAV4 HEV', '이관 완료', '09:48'],
    ];
    const cs = snap ? snap.cases : [];
    const live = cs.map((c) => [c.id, c.kind === 'emergency' ? '긴급' : '정비', c.warn.title, E.VEHICLE.model, E.CONTACT[c.contact], E.hm(c.at).slice(0, 5), c]);
    return `<div class="dash">
      <div class="kpis">
        <div class="card kpi"><small>오늘 e-Care 경고</small><b class="num">${12 + cs.length}</b><span>긴급 ${3 + cs.filter((c) => c.kind === 'emergency').length} · 정비 ${9 + cs.filter((c) => c.kind !== 'emergency').length}</span></div>
        <div class="card kpi"><small>SLA 25분 준수율</small><b class="num">98.6%</b><span>▲ 0.4%p</span></div>
        <div class="card kpi"><small>평균 응대 시간</small><b class="num">03:12</b><span>▼ 18초</span></div>
        <div class="card kpi"><small>긴급출동 진행</small><b class="num">${cs.filter((c) => c.dispatch >= 0 && c.dispatch < 3).length}</b><span>평균 도착 14분</span></div>
        <div class="card kpi"><small>대기 상담원</small><b class="num">${snap ? snap.agents.filter((a) => a.state === '대기').length : 3} / 3</b><span>자동 배정 ON</span></div>
      </div>
      <div class="card" style="overflow:hidden"><h4>e-Care 경고 접수 현황 <small>VEP(TSP) 실시간 연동</small></h4>
        <table class="tbl"><thead><tr><th>케이스</th><th>구분</th><th>경고</th><th>차량</th><th>고객</th><th>처리 상태</th><th>접수</th></tr></thead><tbody>
        ${live.map((r) => `<tr class="${r[1] === '긴급' && r[6].contact < 3 ? 'hot' : ''}" data-case="${r[0]}"><td class="num">${r[0]}</td><td><span class="pill ${r[1] === '긴급' ? 'red' : 'amber'}">${r[1]}</span></td><td>${esc(r[2])}</td><td>${r[3]}</td><td>${E.CUSTOMER.name}</td><td>${r[4]}</td><td class="num">${r[5]}</td></tr>`).join('')}
        ${rows.map((r) => `<tr><td class="num">${r[0]}</td><td><span class="pill ${r[1] === '긴급' ? 'red' : 'amber'}">${r[1]}</span></td><td>${r[2]}</td><td>${r[3]}</td><td>—</td><td>${r[4]}</td><td class="num">${r[5]}</td></tr>`).join('')}
        </tbody></table></div>
    </div>`;
  }

  function caseView(c) {
    const red = c.kind === 'emergency';
    const step = (arr, k, cls) => arr.map((n, i) => `<div class="step ${i < k ? 'done' : i === k ? 'now' : ''}"><i>${i < k ? '✓' : i + 1}</i>${n}</div>`).join('');
    const ag = agentOf(c);
    const call = c.call;
    const lines = call ? call.lines.slice(-4) : [];
    const procs = (arr, k, cls) => arr.map((n, i) => `<div class="proc ${cls || ''} ${i <= k ? 'done' : ''}"><i></i>${n}</div>`).join('');
    return `<div class="case">
      <div class="card casebar">
        <div><div class="id">${c.id} · 접수 ${E.hm(c.at)}</div><div class="ttl"><span class="pill ${red ? 'red' : 'amber'}">${red ? '긴급 · 주행 불가' : '정비'}</span>${esc(c.warn.title)}</div></div>
        <div class="steps">${step(E.CONTACT, c.contact)}</div>
        ${red ? `<div class="sla"><div class="row"><span>${c.contact === 0 ? 'SLA · 고객 연락 대기' : 'SLA · 컨택 완료'}</span><b class="num" data-sla></b></div><div class="bar"><i data-slabar></i></div></div>` : `<div class="sla"><div class="row"><span>상담원 미대응 · DMS 직접 전송</span><b class="num">${esc(c.dealer)}</b></div></div>`}
      </div>
      <div class="cols">
        <div class="stack">
          <div class="card warncard ${red ? '' : 'amber'}">
            <div class="warnhead"><canvas data-icon></canvas><div><b>${esc(c.warn.title)}</b><small>${c.warn.sys} · DTC <span class="num">${c.warn.dtc}</span></small></div></div>
            <dl class="kv" style="margin-top:14px"><dt>위험도</dt><dd style="color:${red ? 'var(--red)' : 'var(--amber)'}">${c.warn.risk}</dd><dt>권장 조치</dt><dd>${esc(c.warn.act)}</dd><dt>고객 안내</dt><dd>${esc(c.warn.desc)}</dd></dl>
            <div class="live"><div><small>속도</small><b class="num" data-v="speed">—</b></div><div><small>기어</small><b class="num" data-v="gear">—</b></div><div><small>시동</small><b data-v="ign">—</b></div><div><small>연료</small><b class="num" data-v="fuel">—</b></div></div>
          </div>
          <div class="card" style="flex:1 1 0;overflow:hidden"><h4>고객 · 차량 <small>본인 확인 · TCU 연결됨</small></h4><dl class="kv"><dt>고객명</dt><dd>${E.CUSTOMER.name} · ${E.CUSTOMER.grade}</dd><dt>연락처</dt><dd class="num">${E.CUSTOMER.phone}</dd><dt>선호 딜러</dt><dd>${E.CUSTOMER.dealer}</dd><dt>모델</dt><dd>${E.VEHICLE.model}</dd><dt>VIN</dt><dd class="num">${E.VEHICLE.vin}</dd><dt>차량번호</dt><dd>${E.VEHICLE.plate} · ${E.VEHICLE.color}</dd><dt>누적 주행</dt><dd class="num" data-v="odo">—</dd></dl></div>
        </div>
        <div class="stack">
          <div class="card mapcard"><canvas data-map></canvas><div class="mlabel"><b>차량 위치 · 실시간</b><span data-v="pos">456번 지방도</span></div></div>
          <div class="card callcard">
            <div class="callhead"><div class="ph ${call && call.state === 'connected' ? 'live' : call && call.state === 'dialing' ? 'dial' : ''}">✆</div>
              <div><b>${call ? (call.state === 'dialing' ? '고객 휴대폰 발신 중…' : call.state === 'connected' ? '통화 중 · 녹취 중' : '통화 종료') : red ? '고객 연락 대기' : '상담 연결 없음 (정비 경고)'}</b><div style="font-size:13px;color:var(--muted)">${E.CUSTOMER.name} · ${E.CUSTOMER.phone}${ag ? ` · 상담원 ${ag.name}` : ''}</div></div>
              <span class="dur num" data-dur></span></div>
            <div class="lines">${lines.map((l) => `<div class="ln ${l.who}"><span class="who">${l.who === 'agent' ? '상담원' : '고객'}</span><span class="txt">${esc(l.text)}</span></div>`).join('') || `<div style="color:var(--soft);font-size:14px">${red ? 'SLA 내 고객 연락이 없으면 25분 경과 시 유휴 상담사에게 자동 배정되어 선제 발신합니다.' : '정비 경고는 상담원 대응 없이 선호 딜러 DMS로 전달됩니다.'}</div>`}</div>
            <div class="btns">
              <button class="b pri" data-cmd="accept" ${red && c.contact === 0 ? '' : 'disabled'}>응대 시작 · 고객 발신</button>
              <button class="b" data-cmd="dispatch" ${red && c.dispatch < 0 ? '' : 'disabled'}>긴급출동 요청</button>
              <button class="b dark" data-cmd="complete" ${c.contact < 3 ? '' : 'disabled'}>상담 완료 · 이관</button>
            </div>
          </div>
        </div>
        <div class="stack">
          ${red ? `<div class="card"><h4>긴급출동 <small>${c.dispatch >= 0 ? E.DISPATCH[c.dispatch] : '요청 전'}</small></h4><div class="procs">${procs(E.DISPATCH, c.dispatch)}</div></div>` : ''}
          <div class="card"><h4>서비스센터 전달 <small>${c.transfer ? '전달 ON' : '전달 OFF'}</small></h4><div class="dealers">${E.DEALERS.map((d) => `<div class="dl ${d.name === c.dealer ? 'sel' : ''}" data-dealer="${d.name}">${d.pref ? '★ ' : ''}${d.name}<span class="st ${d.open ? '' : 'off'}">${d.open ? '업무중' : '업무종료'}</span><span class="km">${d.km} km</span></div>`).join('')}</div>
            ${c.dms >= 0 ? `<div class="procs" style="margin-top:12px">${procs(E.DMS.slice(0, 4), c.dms, 'dms')}</div>` : ''}</div>
          <div class="card"><h4>상담 메모</h4><textarea class="memo" data-memo placeholder="상담 내용을 입력하세요">${esc(c.memo || '')}</textarea></div>
          <div class="card" style="flex:1 1 0;overflow:hidden"><h4>처리 이력</h4><div class="tl">${c.log.slice(-9).reverse().map((e) => `<div class="e ${e.kind}"><time>${E.hm(e.t)}</time><i></i><span>${esc(e.text)}</span></div>`).join('')}</div></div>
        </div>
      </div>
    </div>`;
  }

  function modal(c) {
    if (!c || !c.assign || c.contact > 0) return '';
    const ag = agentOf(c);
    return `<div class="modal"><div class="dlg">
      <div class="hd">⚠ 고객 미연락 25분 경과 · 상담원 자동 배정<span class="cd num" data-assign></span></div>
      <div class="bd">긴급 경고 발생 후 25분 동안 고객 연락이 없어 <b>${ag ? ag.name : ''} 상담원</b>에게 자동 배정되었습니다. 05:00 안에 응대를 시작해 주세요.
        <dl class="kv"><dt>케이스</dt><dd class="num">${c.id}</dd><dt>경고</dt><dd style="color:var(--red)">${esc(c.warn.title)} · ${c.warn.dtc}</dd><dt>고객</dt><dd>${E.CUSTOMER.name} · ${E.CUSTOMER.phone}</dd><dt>차량</dt><dd>${E.VEHICLE.model} · ${E.VEHICLE.plate}</dd></dl></div>
      <div class="ft"><button class="b" data-cmd="later">나중에</button><button class="b pri" data-cmd="accept">응대 시작 · 고객 발신</button></div>
    </div></div>`;
  }

  function render(force) {
    if (VIEW === 'transcript') return renderTranscript();
    const c = active();
    if (c && page === 'dash' && c.kind === 'emergency' && c.contact < 3 && !renderedKey) page = 'case';
    // re-render only on content changes so the memo keeps focus while typing
    const key = JSON.stringify([page, c && [c.id, c.contact, c.dispatch, c.dms, c.dealer, c.transfer, c.assign && c.assign.at, c.call && [c.call.state, c.call.lines.length], c.log.length], snap && snap.cases.length, snap && snap.agents.map((a) => a.state)]);
    if (!force && key === renderedKey) return;
    renderedKey = key;
    const memoFocus = document.activeElement && document.activeElement.matches && document.activeElement.matches('[data-memo]');
    if (memoFocus) return;
    app.innerHTML = shell(page === 'case' && c ? caseView(c) : dashboard()) + modal(c);
    const ic = $('[data-icon]', app);
    if (ic && c) warnIcon(ic, c);
    tick();
  }

  app.addEventListener('click', (e) => {
    const t = e.target.closest('[data-cmd],[data-page],[data-dealer],[data-case]');
    if (!t) return;
    const c = active();
    if (t.dataset.cmd === 'later') { $('.modal', app) && $('.modal', app).remove(); return; }
    if (t.dataset.cmd) cmd(t.dataset.cmd, { id: c && c.id });
    if (t.dataset.page) { page = t.dataset.page; render(true); }
    if (t.dataset.dealer && c) cmd('dealer', { id: c.id, dealer: t.dataset.dealer });
    if (t.dataset.case) { cmd('select', { id: t.dataset.case }); page = 'case'; render(true); }
  });
  app.addEventListener('input', (e) => {
    if (e.target.matches('[data-memo]')) { const c = active(); if (c) cmd('memo', { id: c.id, text: e.target.value }); }
  });

  /* ---------------- live values (4x a second) ---------------- */
  function tick() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    app.querySelectorAll('[data-clock]').forEach((el) => { el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`; });
    const c = active();
    if (c) {
      const left = slaLeft(c);
      const sla = $('[data-sla]', app), bar = $('[data-slabar]', app);
      if (sla) {
        const shown = c.contact === 0 ? left : E.SLA - ((c.call ? c.call.at : Date.now()) - c.slaBase);
        sla.textContent = shown >= 0 ? E.mmss(shown) : `+${E.mmss(-shown)}`;
        sla.classList.toggle('over', shown < 0);
        const f = clamp(1 - shown / E.SLA, 0, 1);
        bar.style.width = `${(f * 100).toFixed(1)}%`;
        bar.className = f >= 1 ? 'over' : f > 0.7 ? 'warn' : '';
      }
      const as = $('[data-assign]', app);
      if (as && c.assign) as.textContent = E.mmss(c.assign.until - Date.now());
      const du = $('[data-dur]', app);
      if (du) du.textContent = c.call && c.call.connectedAt ? E.mmss((c.call.endedAt || Date.now()) - c.call.connectedAt) : '';
    }
    if (veh) {
      const set = (k, v) => app.querySelectorAll(`[data-v="${k}"]`).forEach((el) => { el.textContent = v; });
      set('speed', `${Math.round(veh.speed)} km/h`);
      set('gear', veh.gear === 'D' ? `D${veh.gearNum}` : veh.gear);
      set('ign', veh.ign === 'off' ? 'OFF' : 'ON');
      set('fuel', `${Math.round(veh.fuel * 100)}%`);
      set('odo', `${Math.floor(veh.odo).toLocaleString('en-US')} km`);
      set('pos', `${Road.isUrban(veh.odoMeters) ? '시가지' : '교외'} · 456번 지방도 ${(veh.odoMeters / 1000).toFixed(2)} km 지점`);
    }
    conn();
  }
  setInterval(tick, 250);

  /* ---------------- live map (light theme, top-down) ---------------- */
  let mapT = 0;
  function drawMap(t) {
    const cv = $('[data-map]', app);
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const scaleUp = r.width / cv.offsetWidth || 1;              // the app is scaled; draw at screen resolution
    const W = cv.offsetWidth, H = cv.offsetHeight;
    const k = clamp(scaleUp * (window.devicePixelRatio || 1), 0.4, 2.5);
    if (cv.width !== Math.round(W * k)) { cv.width = Math.round(W * k); cv.height = Math.round(H * k); }
    const g = cv.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = '#eef1f4';
    g.fillRect(0, 0, W, H);
    const s = veh ? veh.odoMeters : 0;
    const [cx, cy] = Road.pos(s);
    const m = 0.85;                                             // px per metre
    const P = (X, Y) => [W / 2 + (X - cx) * m, H / 2 - (Y - cy) * m];
    const s0 = s - 700, s1 = s + 700;
    // town
    for (const b of Road.city(s0, s1)) {
      const pts = [Road.at(b.S0, b.l0), Road.at(b.S1, b.l0), Road.at(b.S1, b.l1), Road.at(b.S0, b.l1)].map(([X, Y]) => P(X, Y));
      g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath();
      g.fillStyle = b.kind === 'park' ? '#cfe6d3' : b.lm ? '#d6dde8' : '#dde1e6';
      g.fill();
      g.strokeStyle = b.kind === 'park' ? '#b9d9c0' : '#c9ced5';
      g.lineWidth = 1;
      g.stroke();
    }
    // side streets
    g.strokeStyle = '#ffffff';
    g.lineWidth = 7;
    for (const S of Road.streets(s0, s1)) {
      for (const side of [-1, 1]) {
        const a = P(...Road.at(S, side * 8)), b = P(...Road.at(S, side * 140));
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      }
    }
    // main road: casing, fill, route
    const path = () => { g.beginPath(); for (let S = s0; S <= s1; S += 8) { const p = P(...Road.pos(S)); S === s0 ? g.moveTo(p[0], p[1]) : g.lineTo(p[0], p[1]); } };
    g.lineJoin = 'round'; g.lineCap = 'round';
    path(); g.strokeStyle = '#c3c9d1'; g.lineWidth = 15; g.stroke();
    path(); g.strokeStyle = '#ffffff'; g.lineWidth = 12; g.stroke();
    g.beginPath(); for (let S = s; S <= s1; S += 8) { const p = P(...Road.pos(S)); S === s ? g.moveTo(p[0], p[1]) : g.lineTo(p[0], p[1]); }
    g.strokeStyle = 'rgba(37,99,235,0.55)'; g.lineWidth = 5; g.stroke();
    const c = active();
    // dispatch vehicle driving to the customer
    if (c && c.dispatch >= 1) {
      const p = c.dispatch >= 2 ? 1 : clamp((Date.now() - (c.log.find((e) => e.text.startsWith('긴급출동 차량 출동')) || { t: Date.now() }).t) / 12000, 0, 1);
      const S = s - 600 * (1 - p);
      const q = P(...Road.at(S, -2));
      g.fillStyle = '#ff7a00'; g.beginPath(); g.arc(q[0], q[1], 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.font = '700 10px Barlow'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🚚', q[0], q[1]);
    }
    // the customer's car with a pulse
    const me = P(cx, cy);
    const pulse = (t / 1000) % 1.6 / 1.6;
    g.beginPath(); g.arc(me[0], me[1], 10 + pulse * 28, 0, Math.PI * 2);
    g.fillStyle = `rgba(230,0,18,${0.28 * (1 - pulse)})`; g.fill();
    g.beginPath(); g.arc(me[0], me[1], 9, 0, Math.PI * 2); g.fillStyle = '#e60012'; g.fill();
    g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
    // scale bar
    g.fillStyle = '#4b5563'; g.font = '500 12px Barlow'; g.textAlign = 'left';
    g.fillRect(W - 116, H - 22, 85, 3); g.fillText('100 m', W - 116, H - 30);
  }

  /* ---------------- transcript screen ---------------- */
  let trKey = '';
  function renderTranscript() {
    const el = $('#transcript');
    const c = active();
    const key = JSON.stringify([c && c.id, c && c.call && c.call.lines.length, c && c.call && c.call.state, c && c.contact, c && c.dispatch, c && c.log.length]);
    if (key === trKey) return;
    trKey = key;
    if (!c) { el.innerHTML = `<div class="tr-head"><span class="tag">E-CARE · LIVE TRANSCRIPT</span><b>상담 대화</b></div><div class="tr-empty">진행 중인 상담이 없습니다.<br>차량에서 긴급 경고가 발생하면 상담 내용이 여기에 실시간으로 표시됩니다.</div>`; return; }
    // dialogue and the call/dispatch events, in time order
    const items = (c.call ? c.call.lines.map((l) => ({ t: l.t, l })) : [])
      .concat(c.log.filter((e) => e.kind === 'call' || e.kind === 'alert').map((e) => ({ t: e.t, e })))
      .sort((a, b) => a.t - b.t).slice(-9);
    el.innerHTML = `<div class="tr-head"><span class="tag">E-CARE · LIVE TRANSCRIPT</span><b>${esc(c.warn.title)} · ${E.CUSTOMER.name} 고객</b><span class="st" data-trst></span></div>
      <div class="tr-body">${c.call ? items.map(({ l, e }) => l
        ? `<div class="tb ${l.who}"><span class="who">${l.who === 'agent' ? 'e-Care 상담원' : `${E.CUSTOMER.name} 고객`} · ${E.hm(l.t).slice(0, 5)}</span><div class="msg">${esc(l.text)}</div></div>`
        : `<div class="tb sys"><div class="msg">${E.hm(e.t).slice(0, 5)} · ${esc(e.text)}</div></div>`).join('') : `<div class="tr-empty">${c.contact === 0 ? '고객 연락 대기 중 · SLA 25분' : '통화 연결 중…'}</div>`}</div>`;
  }
  setInterval(() => {
    if (VIEW !== 'transcript') return;
    const c = active();
    const st = $('[data-trst]');
    if (st && c && c.call) st.textContent = c.call.state === 'connected' ? `● 통화 중 ${E.mmss(Date.now() - c.call.connectedAt)}` : c.call.state === 'dialing' ? '발신 중…' : `통화 종료 · ${E.mmss(c.call.endedAt - c.call.connectedAt)}`;
  }, 250);

  /* ---------------- controls ---------------- */
  $('#viewBtn').addEventListener('click', () => camTo(cam.to > 0.5 ? 0 : 1, 2200));
  $('#fsBtn').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}));
  addEventListener('keydown', (e) => {
    if (e.target.matches && e.target.matches('textarea')) return;
    if (e.code === 'KeyV') camTo(cam.to > 0.5 ? 0 : 1, 2200);
    if (e.code === 'KeyF') $('#fsBtn').click();
  });

  function frame(t) {
    if (VIEW !== 'transcript') {
      placeStage();
      if (t - mapT > 60) { mapT = t; drawMap(t); }
    }
    requestAnimationFrame(frame);
  }
  render(true);
  requestAnimationFrame(frame);
  // the office view settles on the agent screen after a moment
  if (VIEW === 'office') setTimeout(() => { if (cam.to < 0.5) camTo(1, 3000); }, 2500);
})();
