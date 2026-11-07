/* Final_Dataflow: 21:9 screen 2.
 *   simple  (during the demo) — the six journey steps with the one happening now open,
 *           in plain words, and the message travelling now; the support center (CCW)
 *           and the service center (DMS) screens, each with one sentence on what it is
 *           doing and three key facts. The panel that just received data glows.
 *   detail  (Q&A, after the demo) — the whole screen: the full data flow board on the
 *           left, and on the right the step controls (first / previous / next / next
 *           step / auto / live), the message shown (route, interface, payload) and the
 *           demo screens of that step. It only replays here; other screens are not touched.
 * D or the control panel (Link 'df-mode' { mode: 'simple' | 'detail' }) switches. */
(function () {
  'use strict';
  const { mmss, esc, CASECOL, primary } = window.FinalUI;
  const E = window.ECare;
  const $ = (s, el) => (el || document).querySelector(s);
  Scenes.mount($('#canvas'));

  const NAME = { car: '고객 차량', phone: '고객 휴대폰', vdp: '일본측 서버 · VDP', vep: '경고 판정 · VEP', ccw: '고객지원실 · CCW', cti: '상담 전화 · CTI', rescue: '긴급출동', dms: '서비스센터 · DMS' };
  const SHORT = { car: '차량', phone: '휴대폰', ccw: 'CCW', cti: 'CCW', dms: 'DMS', rescue: '긴급출동', vdp: 'VDP', vep: 'VEP' };
  let snap = null;

  /* ---------------- simple: the journey ---------------- */
  const stepsEl = $('#steps');
  stepsEl.innerHTML = E.JOURNEY.map((t, i) => `<div class="s" data-i="${i}"><i>${i + 1}</i><b>${esc(t)}</b><p>${esc(E.JOURNEY_PLAIN[i])}</p><small></small></div>`).join('');
  let jKey = '';
  function renderJourney() {
    const c = primary(snap);
    const j = c ? E.journey(c) : { i: -1, d: '' };
    const col = c ? CASECOL[(c.wng && c.wng.case) || c.wcase || 'A'] : '#4f8cff';
    document.documentElement.style.setProperty('--case', col);
    const key = j.i + '|' + j.d;
    if (key !== jKey) {
      jKey = key;
      stepsEl.querySelectorAll('.s').forEach((el, i) => {
        el.classList.toggle('done', i < j.i);
        el.classList.toggle('cur', i === j.i);
        $('i', el).textContent = i < j.i ? '✓' : i + 1;
        $('small', el).textContent = i === j.i ? j.d : '';
      });
    }
    $('#elapsed').textContent = c ? mmss(Date.now() - c.at + skipped(c)) : '00:00';
  }
  const skipped = (c) => ((snap && snap.flows) || []).filter((f) => f.type === 'skip' && f.caseId === c.id).length * 25 * 60000;

  /* the message travelling now: each new one shown for at least 1.6 s, in order */
  const queue = [];
  let seen = 0, showT = 0, firstSnap = true;
  function ingest() {
    const fl = (snap && snap.flows) || [];
    if (fl.length && fl[fl.length - 1].id < seen) seen = 0;          // went back / reset
    if (!fl.length) { seen = 0; queue.length = 0; idleMsg(); return; }
    for (const f of fl) {
      if (f.id <= seen) continue;
      seen = f.id;
      if (f.type === 'skip' || firstSnap) continue;
      queue.push(f);
    }
    firstSnap = false;
  }
  function idleMsg() { $('#msg').classList.add('idle'); $('#mFrom').textContent = '고객 차량'; $('#mTo').textContent = '서버'; $('#mApi').textContent = '대기'; $('#mLb').textContent = '차량 이벤트를 기다리는 중'; }
  function pump() {
    if (!queue.length || Date.now() - showT < (queue.length > 4 ? 1100 : 1600)) return;
    const f = queue.shift();
    const grp = [f];
    while (f.burst && queue.length && queue[0].burst === f.burst) grp.push(queue.shift());
    showT = Date.now();
    const m = $('#msg');
    m.classList.remove('idle');
    const to = f.to === f.from ? f.to : f.to;
    $('#mFrom').textContent = NAME[f.from] || f.from;
    $('#mTo').textContent = f.from === f.to ? '내부 처리' : grp.length > 1 ? grp.map((x) => SHORT[x.to] || x.to).join(' · ') : (NAME[to] || to);
    $('#mApi').textContent = grp.length > 1 ? '동시 발송' : f.api;
    $('#mLb').textContent = grp.length > 1 ? grp.map((x) => x.api).join(' · ') : f.label;
    const line = $('#msg .line'); line.style.animation = 'none'; void line.offsetWidth; line.style.animation = '';
    // the screen that just received data glows
    for (const x of grp) {
      const hit = x.to === 'ccw' || x.to === 'cti' ? '#ccwCol' : x.to === 'dms' ? '#dmsCol' : null;
      // the panel lights when the packet arrives (the board's travel time)
      if (hit) setTimeout(() => glow(hit, x.wcase ? CASECOL[x.wcase] : '#3ddc84'), x.deliver || x.burst ? 1800 : 900);
    }
  }
  const glowT = {};
  function glow(sel, col) {
    const el = $(sel);
    el.style.setProperty('--hit', col);
    el.classList.add('hit');
    clearTimeout(glowT[sel]);
    glowT[sel] = setTimeout(() => el.classList.remove('hit'), 1800);
  }

  /* ---------------- simple: what CCW and DMS are doing ---------------- */
  const fact = (k, v) => `<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`;
  function ccwText(c) {
    if (snap && snap.general && snap.general.state !== 'ended') return ['일반 전화 · 고객의 문의를 <em>상담원이 바로 받습니다</em>', 'live'];
    if (!c) return ['대기 중 — 차량 경고가 들어오면 <em>이 화면에 바로</em> 뜹니다', ''];
    if (c.kind !== 'emergency') return [`${E.CASE[c.wcase].label} 등급은 <em>상담원 없이</em> 서비스센터로 바로 넘어갑니다`, ''];
    const k = c.call;
    if (c.done) return ['고객 인도 · 정비 종결 · <em>e-Care 과업 종료</em> (조회로 확인)', 'live'];
    if (c.dms >= 1) return [`서비스센터 진행 상태를 <em>조회</em>로 확인합니다 · ${E.DMS[c.dms]}`, ''];
    if (c.dms >= 0) return ['이관 완료 · 이후는 서비스센터가 <em>고객에게 직접 연락</em>합니다', ''];
    if (c.sheet && !c.sheet.saved) return ['상담 메모를 정리해 <em>서비스센터로 이관</em>합니다', 'live'];
    if (k && k.state === 'connected') return ['상담원이 고객과 통화 중 · <em>차량 위치와 진단 정보</em>를 보며 안내합니다', 'live'];
    if (c.dispatch >= 0) return [c.dispatch >= 2 ? '긴급출동 차량이 <em>고객 차 앞에 도착</em>했습니다' : '긴급출동 요청 완료 · <em>출동 기사가 고객에게 직접</em> 연락합니다', 'live'];
    if (k && k.state === 'dialing') return [k.dir === 'out' ? '25분간 연락이 없어 <em>상담원이 먼저 전화</em>를 겁니다' : '고객 전화 연결 중', 'live'];
    if (c.inbound) return ['고객이 <em>헤드유닛 버튼</em>으로 전화를 걸었습니다 · 상담원 배정', 'live'];
    if (c.assign) return ['25분 경과 · <em>상담원이 자동 배정</em>되었습니다', 'live'];
    return ['긴급 경고 접수 · <em>고객의 연락</em>을 기다리는 중입니다', 'live'];
  }
  const DMS_SAY = [
    '이관 접수 · 서비스 어드바이저가 <em>고객에게 연락할 차례</em>입니다',
    '서비스 어드바이저가 <em>고객과 통화</em>하고 있습니다',
    '<em>입고 예약 확정</em> · 상태는 DMS → TSP로 기록됩니다',
    '견인 차량이 <em>서비스센터에 입고</em>되었습니다',
    '<em>정비 진행 중</em> · 단계마다 DMS → TSP로 기록',
    '정비 완료 · <em>고객 인도</em>를 준비합니다',
    '고객에게 차량을 <em>인도</em>했습니다',
    '고객 인도 · <em>정비 종결</em> · e-Care 과업 종료',
  ];
  /* who gets the room on the screen: the support center while e-Care handles the case, the
   * service center from the moment the case is theirs (the memo has reached DMS, or a Case B / C
   * sent to them directly); evenly split while there is nothing going on */
  let phase = '';
  function setPhase() {
    const cs = (snap && snap.cases) || [];
    const c = cs[0];
    let ph = 'even';
    if (c) {
      const g = c.got || {};
      ph = c.kind === 'emergency' ? (c.dms >= 0 && (g.memo || !c.got) ? 'dms' : 'ccw') : ((g.dms || !c.got) ? 'dms' : 'even');
    }
    if (snap && snap.general && snap.general.state !== 'ended') ph = 'ccw';
    if (ph === phase) return;
    phase = ph;
    document.body.dataset.phase = ph;
    $('#ccwCol').classList.toggle('narrow', ph === 'dms');
    $('#dmsCol').classList.toggle('narrow', ph === 'ccw');
  }
  function renderSys() {
    setPhase();
    const c = primary(E.gate(snap, 'ccw'));
    const [say, live] = ccwText(c);
    const cs = $('#ccwState');
    if ($('#ccwSay').innerHTML !== say) $('#ccwSay').innerHTML = say;
    cs.classList.toggle('live', live === 'live');
    const k = c && c.call;
    cs.textContent = !c ? '대기' : k && k.state === 'connected' ? `통화 ${mmss(Date.now() - k.connectedAt)}` : c.done ? '과업 종료' : c.dms >= 0 ? '이관 완료' : live ? '처리 중' : '대기';
    const resv = c && c.dms >= 1;
    const ff = c ? [fact('고객', `${E.CUSTOMER.name} · ${E.VEHICLE.model || 'GX 550'}`), fact('경고', `${c.warn ? c.warn.title : ''} · ${E.CASE[c.wcase] ? E.CASE[c.wcase].label : ''}`), resv ? fact('서비스센터 (조회)', E.DMS[c.dms]) : fact('긴급출동', c.dispatch >= 0 ? E.DISPATCH[c.dispSeen != null ? Math.min(c.dispatch, c.dispSeen) : c.dispatch] : '—')].join('')
      : [fact('고객', '—'), fact('경고', '—'), fact('긴급출동', '—')].join('');
    if ($('#ccwFacts').innerHTML !== ff) $('#ccwFacts').innerHTML = ff;
    // DMS: the case transferred (or sent straight for B / C)
    const gd = E.gate(snap, 'dms');
    const d = gd && (gd.cases || []).find((x) => x.dms >= 0);      // the newest case at the service center
    const ds = $('#dmsState');
    const dc = d && d.dcall;
    const dsay = !d ? '대기 중 — e-Care 상담이 끝나면 <em>이관 건이 여기</em> 들어옵니다'
      : d.done ? '고객 인도 · <em>정비 종결</em> · e-Care 과업 종료'
        : d.towing && d.dms < 3 ? '견인차가 차량을 <em>서비스센터로 운송</em>하고 있습니다'
        : dc && dc.state === 'dialing' ? '서비스 어드바이저가 <em>고객 휴대폰으로 전화</em>를 겁니다'
          : dc && dc.state === 'connected' ? '서비스 어드바이저가 <em>고객과 통화</em> · 안심 안내 후 입고 예약'
            : DMS_SAY[Math.min(7, d.dms)];
    if ($('#dmsSay').innerHTML !== dsay) $('#dmsSay').innerHTML = dsay;
    ds.textContent = !d ? '대기' : dc && dc.state === 'connected' ? `통화 ${mmss(Date.now() - dc.connectedAt)}` : d.done ? '종결' : E.DMS[d.dms];
    ds.classList.toggle('live', !!d && !d.done && d.dms < 7);
    const K = d && E.CASE[d.wcase];
    const df = d ? [fact('서비스센터', d.dealer || '강남 서비스센터'), fact('진행 단계', d.done ? '고객인도 · 종결' : dc && dc.state !== 'ended' ? '고객 통화' : E.DMS[d.dms]), d.reservation ? fact('입고 예약', `내일 ${E.hm(d.reservation.at).slice(0, 5)} · 오늘 견인 입고`) : fact('고객 연락', d.kind === 'emergency' ? '고객 휴대폰 직접 통화' : `첫 컨택 기한 ${K ? K.slaText : '—'}`)].join('')
      : [fact('서비스센터', '—'), fact('진행 단계', '—'), fact('첫 컨택 기한', '—')].join('');
    if ($('#dmsFacts').innerHTML !== df) $('#dmsFacts').innerHTML = df;
  }

  /* ---------------- detail (Q&A) ---------------- */
  const detail = $('#detail'), board = $('#board');
  let ctl = null, st = null, detailOn = false;
  function setDetail(on) {
    detailOn = on;
    detail.classList.toggle('on', on);
    document.body.classList.toggle('detail-on', on);
    if (on && !board.src) {
      board.src = 'flow.html?embed=1';
      board.addEventListener('load', () => {
        const w = board.contentWindow;
        const hook = () => { if (!w.FlowCtl) return setTimeout(hook, 200); ctl = w.FlowCtl; feed(); ctl.onChange((s) => { st = s; renderQA(); }); };
        hook();
      }, { once: true });
    }
    Link.send('df-state', { mode: on ? 'detail' : 'simple' });
  }
  /* what the detail view replays: the live run; after a reset, the last run shown here
   * (kept in this browser) or the recorded main scenario, so Q&A works at any time */
  let recorded = null, recName = '';
  function saveRun() {
    const fl = ((snap && snap.flows) || []).filter((f) => f.type !== 'skip');
    if (fl.length < 12) return;
    try { localStorage.setItem('df-last-flows-v2', JSON.stringify(fl)); } catch (e) { /* full or private */ }
  }
  function feed() {
    if (!ctl) return;
    let list = null;
    try { list = JSON.parse(localStorage.getItem('df-last-flows-v2')); recName = '직전 시연 기록'; } catch (e) { list = null; }
    if (Array.isArray(list) && list.length) { recorded = list; ctl.useList(list); return; }
    fetch('assets/flows_main.json', { cache: 'no-cache' }).then((r) => r.json()).then((l) => { recorded = l; recName = '기본 시나리오 기록'; ctl.useList(l); }).catch(() => {});
  }
  let saveN = 0;
  $('#toDetail').addEventListener('click', () => setDetail(true));
  $('#toSimple').addEventListener('click', () => setDetail(false));
  $('#chips').innerHTML = E.JOURNEY.map((t, i) => `<button data-stage="${i}" title="${esc(t)}의 첫 메시지로"><i>${i + 1}</i>${esc(t)}</button>`).join('');
  $('#qa').addEventListener('click', (e) => {
    if (!ctl) return;
    const li = e.target.closest('[data-seek]');
    if (li) return ctl.seek(+li.dataset.seek);
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.stage) return ctl.stage(+b.dataset.stage);
    const q = b.dataset.q;
    if (q === 'reset') ctl.seek(0);
    else if (q === 'first') ctl.seek(1);
    else if (q === 'prev') ctl.prev();
    else if (q === 'next') ctl.next();
    else if (q === 'stage') { const cur = st && st.stage >= 0 ? st.stage : -1; ctl.stage(Math.min(5, cur + 1)); }
    else if (q === 'play') { if (st && st.mode === 'play') ctl.pause(); else ctl.play(); }
    else if (q === 'live') ctl.live();
  });
  // the demo screens of each journey step (stills taken by tools/capture-stills.cjs)
  const SHOT_ID = ['warning', 'incoming', 'dispatch', 'memo', 'dealer', 'repair'];
  let stills = null;
  fetch('assets/test/stills-63/index.json', { cache: 'no-cache' }).then((r) => r.json()).then((d) => { stills = Array.isArray(d) ? d : d.steps; renderQA(); }).catch(() => { stills = []; });
  let shotKey = '';
  function renderQA() {
    if (!st) return;
    const L = st.list || [];
    let mx = 0;
    const stg = L.map((f) => (mx = Math.max(mx, E.stageOfFlow(f))));
    const curStage = st.mode === 'live' ? st.stage : (st.i > 0 ? stg[st.i - 1] : -1);
    $('#chips').querySelectorAll('button').forEach((b, i) => { b.classList.toggle('done', i < curStage); b.classList.toggle('cur', i === curStage); b.disabled = !stg.includes(i); });
    $('#qN').textContent = `${st.mode === 'live' ? L.length : st.i} / ${L.length}`;
    $('#qSrc').textContent = st.src === 'recorded' ? recName : '실시간 기록';
    $('#qSrc').classList.toggle('rec', st.src === 'recorded');
    $('#qPlay').textContent = st.mode === 'play' ? '⏸ 일시 정지' : '▶ 자동 재생';
    $('#qPlay').classList.toggle('on', st.mode === 'play');
    $('#qLive').classList.toggle('on', st.mode === 'live');
    const f = st.last;
    const grp = st.group && st.group.length > 1 && st.mode !== 'live' ? st.group : (f ? [f] : []);
    const col = f && f.wcase ? CASECOL[f.wcase] : '#4f8cff';
    $('#detail').style.setProperty('--case', col);
    const hh = (d) => String(d).padStart(2, '0');
    if (!f) $('#qCard').innerHTML = '<div><div class="lb">시나리오를 진행하면 메시지가 여기 쌓입니다. [다음 ▶]으로 첫 메시지부터 한 단계씩 볼 수 있습니다.</div></div><pre>{}</pre>';
    else {
      const t = new Date(f.t);
      const to = f.from === f.to ? '<span class="to">내부 처리</span>' : grp.map((x) => `<span class="to">${esc(NAME[x.to] || x.to)}</span>`).join('');
      const payload = grp.length > 1 ? grp.map((x) => `// → ${NAME[x.to] || x.to} · ${x.api}\n${JSON.stringify(x.payload || {}, null, 2)}`).join('\n\n') : f.payload ? JSON.stringify(f.payload, null, 2) : '(전달 데이터 없음)';
      $('#qCard').innerHTML = `<div><div class="r">${esc(NAME[f.from] || f.from)} <em>→</em> ${to}</div>
        <div class="api">${esc(grp.length > 1 ? grp.map((x) => x.api).join(' · ') : f.api)}<small>${hh(t.getHours())}:${hh(t.getMinutes())}:${hh(t.getSeconds())}</small></div>
        <div class="lb">${esc(grp.length > 1 ? (f.from === 'vdp' ? `VDP가 고객 문구를 ${grp.map((x) => SHORT[x.to] || x.to).join(' · ')}에 동시에 전달합니다` : `${E.CASE[f.wcase] ? E.CASE[f.wcase].label : ''} 판정 결과를 ${grp.map((x) => SHORT[x.to] || x.to).join(' · ')}에 동시에 보냅니다`) : f.label)}</div>
        ${grp.length > 1 ? `<span class="burst">동시 발송 · ${grp.length}곳</span>` : ''}</div><pre>${esc(payload)}</pre>`;
    }
    // the plain sentence of the step, and the messages of the step as a list
    const k = Math.max(0, curStage);
    $('#qPlain').innerHTML = `<small>${k + 1}단계 · ${esc(E.JOURNEY[k])}</small>${esc(E.JOURNEY_PLAIN[k])}`;
    const upto = st.mode === 'live' ? L.length : st.i;
    const items = [];
    L.forEach((x, i) => { if (stg[i] !== k) return; if (x.burst && i > 0 && L[i - 1].burst === x.burst && items.length) { const it = items[items.length - 1]; it.n++; it.last = i; it.to.push(x.to); return; } items.push({ x, i, last: i, n: 1, to: [x.to] }); });
    const lk = k + '|' + upto + '|' + L.length;
    if (lk !== listKey) {
      listKey = lk;
      $('#qList').innerHTML = items.map((it) => `<li data-seek="${it.last + 1}" class="${it.last < upto - 1 ? 'done' : it.i <= upto - 1 && upto - 1 <= it.last ? 'cur' : ''}"><i>${it.i + 1}</i><b>${esc(it.n > 1 ? `동시 발송 · ${it.n}곳` : it.x.api)}</b><span>${esc(SHORT[it.x.from] || it.x.from)} → ${esc(it.n > 1 ? it.to.map((t) => SHORT[t] || t).join(' · ') : it.x.from === it.x.to ? '내부' : SHORT[it.x.to] || it.x.to)} · ${esc(it.x.label)}</span></li>`).join('');
      const cur = $('#qList .cur'); if (cur) cur.scrollIntoView({ block: 'nearest' });
    }
    // the three screens at this message, and which of them it goes to
    const id = shotFor(f, k);
    const sk = stills && stills.length ? (stills.find((x) => x.id === id) || {}).key : null;
    if (sk && sk + id !== shotKey) {
      shotKey = sk + id;
      const huZoomed = ['warning', 'incoming', 'call', 'dispatch', 'sla25', 'outbound', 'outcall'].includes(id);
      const set = (who, file, pos) => { const el = $(`#shots [data-who="${who}"] .img`); el.style.opacity = 0; setTimeout(() => { el.style.backgroundImage = `url(assets/test/stills-63/${sk}_${file}.jpg)`; el.style.backgroundSize = pos ? pos[0] : 'cover'; el.style.backgroundPosition = pos ? pos[1] : 'center'; el.style.opacity = 1; }, 220); };
      set('car', 'car', huZoomed ? null : ['250% auto', '80% 20%']);      // a full cockpit: the head unit up close
      set('ccw', 'ccw'); set('dms', 'dms');
    }
    const to = new Set(grp.map((x) => (x.to === 'cti' ? 'ccw' : x.to === 'phone' ? 'car' : x.to)));
    $('#shots').querySelectorAll('figure').forEach((fg) => fg.classList.toggle('on', !!f && to.has(fg.dataset.who)));
  }
  let listKey = '';
  // the demo still that shows what this message does on the screens
  function shotFor(f, k) {
    if (!f) return SHOT_ID[Math.max(0, k)];
    const a = f.api, st = (f.payload && f.payload.repairStatus) || '';
    if (a === '견인 입고') return 'towin';
    if (a === 'DMS 상태') { const s2 = (f.payload && f.payload.repairStatus) || ''; return /RESERVED/.test(s2) ? 'dealer' : /RECEIVED/.test(s2) ? 'towin' : /CLOSED/.test(s2) ? 'done' : 'repair'; }
    if (/딜러/.test(a)) return 'dealer';
    if (/WNG|VDP 이벤트|필터|Case 판정|e-Care 이벤트|DMS 이벤트|고객 알림 요청|앱 푸시/.test(a) || (a === '헤드유닛 알림' && !/출동/.test(f.label))) return 'warning';
    if (/헤드유닛 콜|콜 배정|자동 할당/.test(a)) return 'incoming';
    if (/상담원 조회|IDLE|WNG 콜 팝업|대기 만료|배정 대상/.test(a)) return 'sla25';
    if (/발신|응답|SMS/.test(a) && f.to === 'phone') return 'outbound';
    if (/수신|음성|응답/.test(a)) return 'call';
    if (/긴급출동/.test(a) || (a === '출동 상태' && !/도착|완료/.test(f.label)) || (a === '헤드유닛 알림')) return 'dispatch';
    if (a === '출동 상태') return 'arrive';
    if (/통화 종료|상담 메모/.test(a) || /CONTACT_REQUIRED/.test(st)) return 'memo';
    if (/CONTACTED|RESERVED/.test(st)) return 'dms';
    if (st) return 'repair';
    return SHOT_ID[Math.max(0, k)];
  }
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyD') setDetail(!detailOn);
    if (!detailOn || !ctl) return;
    if (e.code === 'ArrowRight' || e.code === 'Space') { e.preventDefault(); ctl.next(); }
    if (e.code === 'ArrowLeft') ctl.prev();
    if (e.code === 'ArrowDown') { const cur = st && st.stage >= 0 ? st.stage : -1; ctl.stage(Math.min(5, cur + 1)); }
    if (e.code === 'ArrowUp') ctl.stage(Math.max(0, (st ? st.stage : 1) - 1));
    if (e.code === 'Home') ctl.seek(0);
  });
  Link.on('df-mode', (d) => setDetail(d.mode === 'detail'));
  Link.on('df-hello', () => Link.send('df-state', { mode: detailOn ? 'detail' : 'simple' }));

  Link.on('ecare', (d) => {
      if (!d || !d.cases) return;
    snap = d; ingest(); renderJourney(); renderSys();
    const n = (d.flows || []).length;
    if (n !== saveN) { saveN = n; saveRun(); if (ctl && !recorded) feed(); }
  });
  setInterval(() => { pump(); if (snap) { renderJourney(); renderSys(); } }, 250);
  Link.send('hello', { screen: 'final-dataflow' });
})();
