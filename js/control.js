/* Demo control panel (control.html): main scenarios run step by step or
 * automatically, plus manual control of every screen.
 *
 * A scenario is a list of steps; each step runs ops and may wait for a
 * condition on the e-Care snapshot (call ended, popup shown …) before the
 * next step. Ops:
 *   ['scene', s]          stage scene: opening | live | closing | black
 *   ['act', name, args]   vehicle simulator action (index.html)
 *   ['warn', id]          raise a warning lamp ('@in' = lamp of the picked inbound set)
 *   ['cmd', name, args]   e-Care director command
 *   ['hu', action]        head unit: press (전화연결) | show (popup again)
 *   ['ign', on]           ignition on / off (only if it is not already)
 *   ['reset']             clear warnings, reset e-Care, customer answers
 *   ['wait', ms] */
(function () {
  'use strict';

  const E = window.ECare;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------------- state from the other screens ---------------- */
  let snap = null, veh = null, scene = 'live', say = null;
  // the demo wall (wall.html): ratio, labels, layout editing
  let wall = { labels: false, edit: false, mode: null }, camView = 'auto';
  Link.on('wall-state', (d) => { Object.assign(wall, d); manualState(); });
  Link.on('wall', (d) => { if (d.mode) wall.mode = d.mode; if (typeof d.labels === 'boolean') wall.labels = d.labels; if (typeof d.edit === 'boolean') wall.edit = d.edit; manualState(); });
  Link.on('ecare', (d) => { snap = d; status(); manualState(); });
  Link.on('veh', (d) => { const hz = !!(veh && veh.hazard); veh = d; if (!!d.hazard !== hz) manualState(); });
  Link.on('say', (d) => { say = d.line; status(); });
  Link.on('toast', (d) => { const t = $('#toast'); t.textContent = d.msg; clearTimeout(t.tid); t.tid = setTimeout(() => { t.textContent = ''; }, 5000); });
  Link.on('stage-hello', () => Link.send('stage', { scene }));
  // the call-center room camera (office photo ↔ monitor ↔ screen only), kept for new screens
  let ccwCam = localStorage.getItem('control-ccwcam') || 'auto';
  Link.on('ccw-hello', () => Link.send('ccw-cam', { view: ccwCam }));
  // the data flow panel's detailed log (folded by default)
  let flowLog = false;
  Link.on('flow-log', (d) => { flowLog = !!d.open; if (mtab === 'wall') manual(); });
  Link.on('@transport', linkText);
  Link.send('hello', { screen: 'control' });
  function linkText() { $('#link').textContent = `● ${Link.label()}`; }
  linkText();

  const active = () => snap && (snap.cases.find((c) => c.id === snap.active) || snap.cases[snap.cases.length - 1]);
  const callState = () => { const c = active(); return c && c.call ? c.call.state : null; };
  const failedAt = (n) => { const c = active(); return !!(c && c.call && c.call.state === 'failed' && c.call.attempts >= n); };

  /* ---------------- ops ---------------- */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  function send(kind, a, b) {
    if (kind === 'scene') { scene = a; Link.send('stage', { scene: a }); }
    else if (kind === 'act') Link.send('act', { name: a, args: b || {} });
    else if (kind === 'warn') Link.send('act', { name: 'warnItem', args: { id: a === '@in' ? E.SCRIPT_WARN[(snap && snap.pick && snap.pick.in) || 'in'] : a } });
    else if (kind === 'cmd') Link.send('cmd', { name: a, args: b || {} });
    else if (kind === 'hu') {
      if (a !== 'press') { Link.send('hu', { action: a }); return; }
      // the driver's hand presses the button on the car panel; with no car panel open
      // (nobody acknowledges the reach) the head unit is pressed directly
      reachAck = false;
      Link.send('hu', { action: 'reach' });
      setTimeout(() => { if (!reachAck) Link.send('hu', { action: 'press' }); }, 1500);
    }
  }
  let reachAck = false;
  Link.on('hu', (d) => { if (d.action === 'reaching') reachAck = true; });
  async function run(ops) {
    for (const [kind, a, b] of ops) {
      if (kind === 'wait') await wait(a);
      else if (kind === 'ign') { if (!veh || (veh.ign === 'on') !== a) { send('act', 'ign'); await wait(a ? 6500 : 4000); } }
      else if (kind === 'reset') {
        Link.send('hush', {}); send('act', 'clear'); send('act', 'careReset'); send('cmd', 'noAnswer', { on: false });
        await wait(700);
      } else send(kind, a, b);
    }
  }

  /* ---------------- scenarios ---------------- */
  // conditions a step may wait for (checked on the snapshot)
  const UNTIL = {
    case: () => !!active(),
    inbound: () => { const c = active(); return !!(c && c.inbound); },
    assigned: () => { const c = active(); return !!(c && (c.assign || c.inbound)); },
    callEnd: () => ['ended'].includes(callState()),
    failed1: () => failedAt(1),
    failed2: () => failedAt(2),
    sms: () => { const c = active(); return !!(c && c.sms); },
    saved: () => { const c = active(); return !!(c && c.sheet && c.sheet.saved); },
    genRing: () => !!(snap && snap.general && snap.general.state === 'ringing'),
    genEnd: () => !!(snap && snap.general && snap.general.state === 'ended'),
  };
  const PREP = { t: '준비 · 초기화 · 시동', cue: '경고와 상담 기록을 지우고 라이브 화면에서 시동을 켭니다.', run: [['reset'], ['scene', 'live'], ['ign', true]] };
  const DRIVE = { t: '주행 시작', cue: '“고객이 GX 550으로 주행 중입니다.” 가운데 화면은 차량에서 콜센터 · 딜러까지 연결된 시스템입니다.', run: [['act', 'drive']], pause: 5000 };
  const SCENARIOS = [
    {
      id: 'in', n: '1', title: '긴급 경고 → 고객 전화', sub: '메인 · 고객이 HU로 상담센터에 전화', sets: true,
      steps: [PREP, DRIVE,
        { t: '긴급 경고 · HU 팝업', cue: '“주행불가 경고가 발생했습니다. VEP가 긴급(Case A)으로 판정하고, 헤드유닛에 ‘고객 지원실로 연결하시겠습니까?’ 팝업을 띄웁니다.” 경고등은 고른 대화 세트에 맞춰 나옵니다.', run: [['warn', '@in']], until: 'case', pause: 4000 },
        { t: '고객 HU [전화연결]', cue: '“고객이 화면의 전화연결 버튼을 누릅니다. MM 콜이 CTI를 거쳐 유휴 상담원에게 배정되고, 25분 자동 아웃바운드는 취소됩니다.”', run: [['hu', 'press']], until: 'inbound', pause: 2500 },
        { t: '상담원 전화 받기 · 통화', cue: '“상담원이 전화를 받습니다. 차량 진단 정보가 이미 화면에 있습니다.” 통화 중 고객이 갓길에 정차하고, 통화가 끝나면 긴급출동이 자동 요청됩니다.', run: [['cmd', 'ack']], until: 'callEnd', pause: 2500, long: true },
        { t: '상담 완료 · 서비스센터 이관', cue: '“상담 메모가 WAM-MEMO-001로 서비스센터에 전달되고, 정비 상태가 DMS-SVC-002로 돌아옵니다.”', run: [['act', 'complete']], until: 'saved', pause: 9000 },
      ],
    },
    {
      id: 'out', n: '2', title: '긴급 경고 → 상담원 발신', sub: '고객 미연락 25분 뒤 상담원이 전화',
      steps: [PREP, DRIVE,
        { t: '긴급 경고 (고객 미연락)', cue: '“이번에는 고객이 전화하지 못하는 상황입니다.” 경고와 팝업은 뜨지만 전화연결을 누르지 않습니다.', run: [['warn', 'brake']], until: 'case', pause: 4000 },
        { t: '25분 경과 · 상담원 자동 배정', cue: '“25분간 고객 연락이 없으면 CTI에서 유휴 상담원을 찾아 자동 배정합니다. 상담원 화면에 경고 알림 팝업이 뜹니다.”', run: [['act', 'sla25']], until: 'assigned', pause: 3500 },
        { t: '상담원 전화 걸기 · 통화', cue: '“상담원이 고객 휴대전화로 전화를 겁니다.” 고객 휴대전화가 울리고 통화가 자막으로 흐릅니다. 통화 중 긴급출동이 자동 요청됩니다.', run: [['act', 'accept']], until: 'callEnd', pause: 2500, long: true },
        { t: '상담 완료 · 서비스센터 이관', cue: '“같은 방식으로 상담 메모가 서비스센터로 넘어갑니다.”', run: [['act', 'complete']], until: 'saved', pause: 9000 },
      ],
    },
    {
      id: 'noans', n: '3', title: '발신 미응답 → SMS', sub: '3회 연결 실패 시 SMS 자동 발송',
      steps: [PREP, DRIVE,
        { t: '긴급 경고 · 고객 미응답 설정', cue: '고객이 전화를 받지 않는 상황으로 설정합니다.', run: [['cmd', 'noAnswer', { on: true }], ['warn', 'brake']], until: 'case', pause: 3000 },
        { t: '25분 경과 · 자동 배정', cue: '“25분이 지나 상담원이 자동 배정됩니다.”', run: [['act', 'sla25']], until: 'assigned', pause: 2500 },
        { t: '1차 발신 → 미응답', cue: '“상담원이 전화를 걸지만 고객이 받지 않습니다.” 상담원 화면에 재연결 안내가 뜹니다.', run: [['act', 'accept']], until: 'failed1', pause: 2000, timeout: 20000 },
        { t: '2차 재연결 → 미응답', cue: '재연결 대기(1분)를 건너뛰고 다시 겁니다.', run: [['act', 'sla25'], ['wait', 300], ['cmd', 'redial']], until: 'failed2', pause: 2000, timeout: 20000 },
        { t: '3차 재연결 → SMS 발송', cue: '“세 번 연결되지 않으면 고객에게 SMS가 자동 발송됩니다.”', run: [['act', 'sla25'], ['wait', 300], ['cmd', 'redial']], until: 'sms', pause: 4000, timeout: 20000 },
        { t: '후처리 · 이관', cue: '상담 메모를 저장하고 서비스센터로 넘깁니다. 고객 미응답 설정은 해제합니다.', run: [['act', 'complete'], ['cmd', 'noAnswer', { on: false }]], until: 'saved', pause: 6000 },
      ],
    },
    {
      id: 'caseb', n: '4', title: '경고 등급 → 서비스센터', sub: '주행 가능 · 상담원 없이 직행',
      steps: [PREP, DRIVE,
        { t: '에어백 · 경고 등급', cue: '“주행 가능한 경고는 경고 등급(Case B)으로 판정되어 서비스센터에 바로 전달되고, SLA는 1일입니다. 헤드유닛에는 ‘지정된 서비스센터로 연결하시겠습니까?’가 뜹니다.”', run: [['warn', 'airbag']], until: 'case', pause: 18000 },
      ],
    },
    {
      id: 'gen', n: '5', title: '일반 전화', sub: '경고 없이 고객이 재문의',
      steps: [PREP,
        { t: '고객 전화 수신', cue: '“경고 없이 고객이 전화를 겁니다.” 상담원 화면에 일반 전화 팝업이 뜹니다.', run: [['act', 'inbound']], until: 'genRing', pause: 2500 },
        { t: '전화 받기 · 통화', cue: '상담원이 전화를 받고 통화가 진행됩니다.', run: [['cmd', 'answerGeneral']], until: 'genEnd', pause: 2000, long: true },
        { t: '상담 메모 저장', cue: '상담 메모를 저장하고 마칩니다.', run: [['cmd', 'closeGeneral', {}]], pause: 3000 },
      ],
    },
  ];
  // the whole presentation: opening, scenario 1, scenario 2, Case B, closing
  SCENARIOS.unshift({
    id: 'show', n: '★', title: '전체 발표', sub: '오프닝 → 1 · 2 · 4 → 클로징', sets: true,
    steps: [
      { t: '3면 오프닝', cue: '“Global South 개발 진척 보고회를 시작하겠습니다.”', run: [['reset'], ['scene', 'opening']] },
      { t: '라이브 · 시동', cue: '라이브 화면으로 전환하며 시동을 켭니다.', run: [['scene', 'live'], ['wait', 900], ['ign', true]] },
      ...SCENARIOS[0].steps.slice(1).map((s) => ({ ...s, grp: '1막 · 고객 인바운드' })),
      { t: '다른 상황 · 다시 주행', cue: '“이번에는 고객이 전화하지 못하는 상황입니다.”', run: [['act', 'clear'], ['wait', 600], ['act', 'drive']], pause: 2500, grp: '2막 · 상담원 아웃바운드' },
      ...SCENARIOS[1].steps.slice(2).map((s) => ({ ...s, grp: '2막 · 상담원 아웃바운드' })),
      { ...SCENARIOS[3].steps[2], run: [['act', 'clear'], ['wait', 900], ['warn', 'airbag']], grp: '3막 · 경고 등급' },
      { t: '시동 끄기', cue: 'IG OFF 세리머니가 재생됩니다.', run: [['ign', false]], grp: '클로징' },
      { t: '3면 클로징 · 요약', cue: '“경고 발생부터 상담 · 출동 · 딜러 이관까지의 흐름을 정리하면 이렇습니다. 감사합니다.”', run: [['scene', 'closing']], grp: '클로징' },
    ],
  });

  let sc = SCENARIOS.find((x) => x.id === (localStorage.getItem('control-scenario') || 'in')) || SCENARIOS[1];
  let cur = -1, busy = false, auto = false, waiting = '', skip = false;

  async function go(i) {
    if (busy) { skip = true; return; }             // next while waiting: stop waiting
    if (i < 0 || i >= sc.steps.length) return;
    busy = true;
    skip = false;
    cur = i;
    waiting = '';
    steps();
    const s = sc.steps[i];
    await run(s.run);
    if (s.until) {
      waiting = s.long ? '통화 진행 중 · 끝나면 다음' : '반영 대기';
      steps();
      const t0 = Date.now();
      while (!skip && !UNTIL[s.until]() && Date.now() - t0 < (s.timeout || (s.long ? 180000 : 15000))) await wait(300);
    }
    waiting = '';
    busy = false;
    const skipped = skip;
    skip = false;
    steps();
    if (skipped && !auto) { go(i + 1); return; }
    if (auto && cur === i && i + 1 < sc.steps.length) {
      waiting = '자동 진행 · 잠시 후 다음';
      steps();
      await wait(s.pause || 1500);
      waiting = '';
      if (auto && cur === i) go(i + 1);
    } else if (auto && i + 1 >= sc.steps.length) { auto = false; steps(); }
  }
  function pick(id) {
    sc = SCENARIOS.find((x) => x.id === id);
    localStorage.setItem('control-scenario', id);
    cur = -1; auto = false;
    scenarios(); steps();
  }

  function scenarios() {
    $('#scenarios').innerHTML = SCENARIOS.map((x) => `<button class="sc ${x === sc ? 'on' : ''}" data-sc="${x.id}" title="${esc(x.title)} — ${esc(x.sub)}"><i>${x.n}</i><b>${esc(x.title)}</b><small>${esc(x.sub)}</small></button>`).join('')
      + `<div class="sets"><h3>인바운드 대화 세트</h3>${E.SCRIPT_SETS.in.keys.map((k) => `<button data-pick="in:${k}">${esc(E.SCRIPT_NAMES[k])}</button>`).join('')}</div>`;
    manualState();
  }
  function steps() {
    const s = cur >= 0 ? sc.steps[cur] : null;
    const next = sc.steps[cur + 1];
    $('#now').innerHTML = `<div class="hd"><small>${esc(sc.n)} · ${esc(sc.title)}</small><b>${s ? `${cur + 1}/${sc.steps.length} · ${esc(s.t)}` : '시작 전'}</b>
        <p>${s ? esc(s.cue) : `첫 단계: ${esc(sc.steps[0].t)}`}</p>${waiting ? `<em class="wait">⏳ ${esc(waiting)}</em>` : ''}</div>
      <div class="btns"><button id="prev">◀ 이전</button><button id="next" class="pri"><b>${busy ? '대기 건너뛰고 다음 ▶' : next ? '다음 ▶' : '끝'}</b>${next ? `<small>${esc(next.t)}</small>` : ''}</button>
        <button id="auto" class="${auto ? 'on' : ''}">${auto ? '■ 멈춤' : '▶▶ 자동'}</button></div>`;
    let grp = '';
    $('#steps').innerHTML = sc.steps.map((x, i) => {
      const head = x.grp && x.grp !== grp ? `<div class="grp">${esc(x.grp)}</div>` : '';
      grp = x.grp || grp;
      return `${head}<button data-step="${i}" class="${i < cur ? 'done' : ''} ${i === cur ? 'cur' : ''}"><i>${i < cur ? '✓' : i + 1}</i><span class="t" title="${esc(x.t)}">${esc(x.t)}</span>${x.long ? '<small>통화</small>' : ''}</button>`;
    }).join('');
  }

  /* ---------------- status ---------------- */
  // the presenter reads the state on the wall itself: no status box here, the room
  // goes to the manual controls (fits the screen without scrolling)
  function status() {}
  setInterval(() => {
    $('#veh').textContent = veh ? `차량 ${veh.ign === 'on' ? '시동 ON' : '시동 OFF'} · ${Math.round(veh.speed)} km/h` : '차량 시뮬레이터 대기';
  }, 500);

  /* ---------------- manual ---------------- */
  const WARNS = [['brake', '브레이크', 'A'], ['engine', '엔진', 'A'], ['coolant', '냉각수', 'A'], ['oil', '오일 압력', 'A'], ['airbag', '에어백', 'B'], ['door', '도어락', 'B'], ['brakepad', '브레이크 패드', 'C']];
  /* Manual controls, chunked by what is being driven, one tab at a time:
   *   차량 · 고객   — the car (driving, lamps by WNG case) and the customer's head unit
   *   상담센터      — the call in its order, timing and situations, the general call
   *   장면 · 화면   — what the wall shows, its layout, checks
   * Reset and the camera stay in the fixed dock; the scenario steps stay on top. */
  let mtab = localStorage.getItem('control-mtab') || 'car';
  function manual() {
    const b = (attr, label, cls) => `<button ${attr} class="${cls || ''}">${label}</button>`;
    const chunk = (title, body, note) => `<div class="ck"><h3>${title}${note ? `<small>${note}</small>` : ''}</h3><div class="row">${body}</div></div>`;
    const lamps = (k) => WARNS.filter((w) => w[2] === k).map(([id, n]) => b(`data-warn="${id}"`, n, `lamp k${k}`)).join('');
    const TABS = {
      car: ['차량 · 고객', chunk('운행', b('data-a="ign"', '시동 ON/OFF') + b('data-a="drive"', '출발') + b('data-a="stop"', '정지') + b('data-a="hazard"', '비상등'))
        + chunk('경고등 켜기', `<div class="lampset"><span class="kA">긴급</span>${lamps('A')}</div><div class="lampset"><span class="kB">경고</span>${lamps('B')}<span class="kC">알림</span>${lamps('C')}</div>`, 'WNG 등급')
        + chunk('고객 헤드유닛', b('data-hu="show"', '팝업 다시 띄우기') + b('data-hu="press"', '전화연결 누르기'))
        + chunk('정리', b('data-a="clear"', '경고등 모두 끄기'))],
      call: ['상담센터', chunk('통화 진행', b('data-c="ack"', '① 상담원 받기') + b('data-a="accept"', '② 상담원 전화 걸기') + b('data-c="redial"', '③ 재연결') + b('data-c="hangup"', '④ 통화 종료'), '순서대로')
        + chunk('통화 후', b('data-a="dispatch"', '긴급출동') + b('data-a="complete"', '상담 완료 · 이관'))
        + chunk('시간 · 상황', b('data-a="sla25"', '25분 경과') + b('data-noans', '고객 미응답') + b('data-a="ccwNoise"', '콜센터 소음'))
        + chunk('서비스센터 (DMS)', b('data-dms="open"', 'DMS 상세 열기') + b('data-dms="close"', '닫기') + b('data-c="dmsAdvance"', '다음 단계 진행'), '예약 → 입고 → 정비 → 종결')
        + chunk('일반 전화 (경고 없음)', b('data-a="inbound"', '고객 전화 오기') + b('data-c="answerGeneral"', '전화 받기') + b('data-c="closeGeneral"', '메모 저장'))],
      wall: ['장면 · 화면', chunk('장면', ['opening:오프닝', 'live:라이브', 'closing:클로징', 'black:암전'].map((x) => { const [k, n] = x.split(':'); return b(`data-scene="${k}"`, n); }).join(''))
        + chunk('시연 화면 비율', b('data-wmode="21"', '21:9') + b('data-wmode="169"', '16:9'))
        + chunk('데이터 흐름', b('data-flowlog', flowLog ? '상세 흐름 접기' : '상세 흐름 펼치기'))
        + chunk('시연 화면 배치', b('data-wedit', '배치 편집') + b('data-wlabels', '라벨') + b('data-wreset', '기본 배치'))
        + chunk('점검 · 열기', b('data-identify', '화면 번호 표시') + ['wall.html:시연 화면 열기', 'dms.html:DMS 열기', 'test.html:모니터 테스트'].map((x) => { const i = x.indexOf(':'); return `<a href="${x.slice(0, i)}" target="_blank">${x.slice(i + 1)}</a>`; }).join(''))],
    };
    if (!TABS[mtab]) mtab = 'car';
    $('#manual').innerHTML = `<div class="mh"><h2>수동 제어</h2><nav class="tabs">${Object.keys(TABS).map((k) => `<button data-mtab="${k}" class="${k === mtab ? 'on' : ''}">${TABS[k][0]}</button>`).join('')}</nav></div>
      <div class="mbody">${TABS[mtab][1]}</div>`;
    manualState();
  }
  function manualState() {
    document.querySelectorAll('[data-wmode]').forEach((x) => x.classList.toggle('on', x.dataset.wmode === wall.mode));
    document.querySelectorAll('[data-cam]').forEach((x) => x.classList.toggle('on', x.dataset.cam === camView));
    document.querySelectorAll('[data-ccwcam]').forEach((x) => x.classList.toggle('on', x.dataset.ccwcam === ccwCam));
    const we = $('[data-wedit]'), wl = $('[data-wlabels]');
    if (we) we.classList.toggle('on', !!wall.edit);
    if (wl) wl.classList.toggle('on', !!wall.labels);
    document.querySelectorAll('[data-scene]').forEach((x) => x.classList.toggle('on', x.dataset.scene === scene));
    document.querySelectorAll('[data-pick]').forEach((x) => x.classList.toggle('on', x.dataset.pick === `in:${(snap && snap.pick && snap.pick.in) || 'in'}`));
    const hz = $('[data-a="hazard"]');
    if (hz) hz.classList.toggle('on', !!(veh && veh.hazard));
    const na = $('[data-noans]');
    if (na) na.classList.toggle('on', !!(snap && snap.noAnswer));
  }
  function setWall(patch) {
    Object.assign(wall, patch);
    Link.send('wall', patch);
    manualState();
  }

  /* ---------------- events ---------------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;
    const d = t.dataset;
    if (t.id === 'next') go(cur + 1);
    else if (t.id === 'prev') { Link.send('hush', {}); cur = Math.max(-1, cur - 1); steps(); }
    else if (t.id === 'auto') { auto = !auto; steps(); if (auto && !busy) go(cur + 1); }
    else if (d.mtab) { mtab = d.mtab; localStorage.setItem('control-mtab', mtab); manual(); }
    else if (d.sc) pick(d.sc);
    else if (d.step) go(+d.step);
    else if (d.pick) { const [kind, key] = d.pick.split(':'); send('cmd', 'pick', { kind, key }); }
    else if (d.scene) { send('scene', d.scene); manualState(); }
    else if ('identify' in d) Link.send('stage-identify', {});
    else if (d.cam) { camView = d.cam; Link.send('cam', { view: d.cam }); manualState(); }
    else if (d.dms) Link.send(d.dms === 'open' ? 'dms-open' : 'dms-close', {});
    else if ('flowlog' in d) { flowLog = !flowLog; Link.send('flow-log', { open: flowLog }); manual(); }
    else if (d.ccwcam) { ccwCam = d.ccwcam; localStorage.setItem('control-ccwcam', ccwCam); Link.send('ccw-cam', { view: ccwCam }); manualState(); }
    else if (d.wmode) setWall({ mode: d.wmode });
    else if ('wedit' in d) setWall({ edit: !wall.edit });
    else if ('wlabels' in d) setWall({ labels: !wall.labels });
    else if ('wreset' in d) { if (confirm('현재 비율의 배치를 기본값으로 되돌릴까요?')) Link.send('wall', { reset: true }); }
    else if (d.a) send('act', d.a);
    else if (d.warn) send('warn', d.warn);
    else if (d.hu) send('hu', d.hu);
    else if (d.c) send('cmd', d.c, d.c === 'closeGeneral' ? {} : undefined);
    else if ('noans' in d) send('cmd', 'noAnswer', { on: !(snap && snap.noAnswer) });
    else if ('reset' in d) { if (confirm('차량 경고 · e-Care 시나리오를 초기화할까요?')) { Link.send('hush', {}); run([['reset']]); cur = -1; auto = false; camView = 'auto'; Link.send('cam', { view: 'auto' }); ccwCam = 'auto'; localStorage.setItem('control-ccwcam', ccwCam); Link.send('ccw-cam', { view: 'auto' }); steps(); manualState(); } }
  });
  addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea')) return;
    if (e.code === 'ArrowRight' || e.code === 'Space' || e.code === 'PageDown') { e.preventDefault(); go(cur + 1); }
    if (e.code === 'ArrowLeft' || e.code === 'PageUp') { e.preventDefault(); cur = Math.max(-1, cur - 1); steps(); }
  });

  scenarios();
  steps();
  status();
  manual();
  Link.send('wall-hello', {});
})();
