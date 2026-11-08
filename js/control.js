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
 *   ['dms', open|close]   the service center DMS: the live case's detail dialog
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
  Link.on('veh', (d) => { const hz = !!(veh && veh.hazard), en = veh && veh.engine; veh = d; if (!!d.hazard !== hz) manualState(); if (d.engine && d.engine !== en) engineMarks(); });
  // the engine voice the car panel plays (its own setting, shown here)
  let engineSel = null;
  const engineId = () => (veh && veh.engine) || engineSel || 'ls500';
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
  // a step's own pauses end early once the presenter pressed [다음]
  async function waitOrSkip(ms) { const t0 = Date.now(); while (!skip && Date.now() - t0 < ms) await wait(Math.min(120, ms)); }
  function send(kind, a, b) {
    if (kind === 'scene') { scene = a; Link.send('stage', { scene: a }); }
    else if (kind === 'act') Link.send('act', { name: a, args: b || {} });
    else if (kind === 'warn') Link.send('act', { name: 'warnItem', args: { id: a === '@in' ? E.SCRIPT_WARN[(snap && snap.pick && snap.pick.in) || 'in'] : a } });
    else if (kind === 'cmd') Link.send('cmd', { name: a, args: b || {} });
    else if (kind === 'dms') Link.send(a === 'open' ? 'dms-open' : 'dms-close', {});
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
  async function run(ops, tok) {
    for (const [kind, a, b] of ops) {
      if (tok != null && tok !== token) return;
      if (kind === 'wait') await waitOrSkip(a);
      else if (kind === 'ign') { if (!veh || (veh.ign === 'on') !== a) { send('act', 'ign'); await waitOrSkip(a ? 6500 : 4000); } }
      else if (kind === 'reset') {
        Link.send('hush', {}); send('act', 'clear'); send('act', 'careReset'); send('cmd', 'noAnswer', { on: false });
        await wait(700);
      } else if (kind === 'hush') Link.send('hush', {});
      else send(kind, a, b);
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
    arrived: () => { const c = active(); return !!(c && c.dispatch >= 2); },
    dmsIn: () => { const c = active(); return !!(c && c.dms >= 0 && (!c.got || (c.kind === 'emergency' ? c.got.memo : c.got.dms))); },
    // the head unit popup is up: the warning's message has reached the car on the data flow
    hu: () => { const c = active(); return !!(c && (!c.got || c.got.car)); },
    resv: () => { const c = active(); return !!(c && c.dms >= 2); },
    closed: () => { const c = active(); return !!(c && c.dms >= 7); },
    dealerEnd: () => { const c = active(); return !!(c && c.dcall && c.dcall.state === 'ended'); },
    done: () => { const c = active(); return !!(c && c.done); },
    recv: () => { const c = active(); return !!(c && c.dms >= 3); },
    repDone: () => { const c = active(); return !!(c && c.dms >= 5); },
  };
  // the service center (DMS) works the transferred case: contact, reservation, then the repair
  const DMS_RESULT = { method: '전화', result: '컨택', reply: '예약확정', memo: '견인 입고 · 내일 10시 예약 확정', agent: '이정비' };
  const DMS_CONTACT = { t: '서비스센터 · 고객 컨택 · 예약 확정', cue: '“서비스센터 DMS에 컨택대기로 들어온 건을 서비스 어드바이저가 열어 고객에게 전화하고, 입고 예약을 확정합니다. 예약 정보는 CCW로 전달됩니다.”', run: [['dms', 'open'], ['wait', 2000], ['cmd', 'dmsContact', DMS_RESULT], ['wait', 2400], ['dms', 'close']], until: 'resv', pause: 2200 };
  const DMS_REPAIR = { t: '입고 → 정비 → 종결', cue: '“견인 차량이 서비스센터에 도착해 입고되고, 정비를 마치고 종결됩니다. 단계마다 DMS-SVC-002로 상태가 돌아옵니다.”', run: [['cmd', 'dmsAdvance'], ['wait', 2200], ['cmd', 'dmsAdvance'], ['wait', 2200], ['cmd', 'dmsAdvance'], ['wait', 2200], ['cmd', 'dmsAdvance']], until: 'closed', pause: 9000 };
  // after the rescue: the service center follows up — the dealer calls the customer, books the visit,
  // and the reservation goes to the e-Care agent, which closes the e-Care task
  const DEALER_CALL = { t: '서비스센터(딜러) 후속 처리 · 고객 통화', cue: '“긴급출동 이후는 서비스센터의 후속 처리입니다. 이관받은 서비스 어드바이저가 고객 휴대폰으로 직접 전화해 먼저 안심시키고, 오늘 견인 입고 · 내일 오전 10시 점검으로 예약을 잡습니다.” 계기판 화면은 ‘서비스센터(딜러) 후속 처리’ 화면으로 바뀝니다.', run: [['wait', 800], ['cmd', 'dealerCall']], until: 'dealerEnd', pause: 1500, long: true };
  // after the dealer's call: the tow truck brings the car in, the repair, then the car goes back to
  // the customer and the case closes — each stage DMS → TSP; the e-Care task ends at the close
  const TOW_IN = { t: '견인 입고 · 서비스센터 접수', cue: '“긴급출동 견인차가 차량을 강남 서비스센터로 옮기고, 서비스센터가 입고를 접수합니다. 상태는 DMS에서 TSP로 기록되고, 상담원은 조회로 확인합니다.”', run: [['cmd', 'towIn']], until: 'recv', pause: 1500 };
  // the repair and the hand-over in one step: 정비 → 정비 완료 → 고객 인도 · 종결 (the e-Care task ends)
  const REPAIR_CLOSE = { t: '정비 → 고객 인도 · 정비 종결', cue: '“서비스센터에서 정비를 마치고 고객에게 차량을 인도한 뒤 종결합니다. 단계마다 DMS → TSP로 기록되고, 종결이 도착하면 e-Care 과업이 끝납니다.”', run: [['cmd', 'dmsAdvance'], ['wait', 1600], ['cmd', 'dmsAdvance'], ['wait', 1600], ['cmd', 'dmsAdvance']], until: 'done', pause: 9000 };
  // the end: the recap ceremony stays up until [다음]; then the end message and silence everywhere
  const SIM_END = { t: 'e-Care 시뮬레이션 종료', cue: '종료 메시지를 띄우고 모든 소리(시동 · 비상등 · 콜센터 소음)를 멈춥니다. 처음부터 다시 하려면 [초기화] 또는 시나리오를 다시 고릅니다.', run: [['hush'], ['scene', 'end']] };
  // the rescue truck the agent called pulls up in front of the customer's car (car panel scene)
  const ARRIVE = { t: '긴급출동 차량 도착', cue: '“상담원이 요청한 긴급출동 차량이 도착합니다. 출동 기사가 고객에게 직접 연락하고, 운전석 옆을 지나 고객 차 앞에 정차합니다.”', run: [['wait', 1200], ['cmd', 'arrive']], until: 'arrived', pause: 6500, timeout: 40000 };
  const PREP = { t: '준비 · 초기화 · 시동', cue: '경고와 상담 기록을 지우고 라이브 화면에서 시동을 켭니다.', run: [['reset'], ['scene', 'live'], ['ign', true]] };
  const DRIVE = { t: '주행 시작', cue: '“고객이 GX 550으로 주행 중입니다.” 가운데 화면은 차량에서 콜센터 · 딜러까지 연결된 시스템입니다.', run: [['act', 'drive']], pause: 5000 };
  const SCENARIOS = [
    {
      id: 'in', n: '1', title: '긴급 경고 → 고객 전화', sub: '메인 · 고객이 HU로 상담센터에 전화', sets: true,
      steps: [PREP, DRIVE,
        { t: '긴급 경고 · HU 팝업', cue: '“주행불가 경고가 발생했습니다. TSP(VEP)가 필터 · 긴급(Case A) 판정을 마치고 CCW와 DMS로 보내며, 고객 문구는 VDP를 다시 거쳐 헤드유닛 팝업 ‘엔진오일 압력 시스템 이상 · 고객 지원실로 연결하시겠습니까?’와 앱 푸시로 전달됩니다.” 경고등은 고른 대화 세트에 맞춰 나옵니다.', run: [['warn', '@in']], until: 'hu', pause: 3000, timeout: 20000 },
        { t: '고객 HU [전화연결]', cue: '“고객이 화면의 전화연결 버튼을 누릅니다. 헤드유닛 콜이 CTI를 거쳐 유휴 상담원에게 배정됩니다.”', run: [['hu', 'press']], until: 'inbound', pause: 2500 },
        { t: '상담원 전화 받기 · 통화 · 긴급출동', cue: '“상담원이 전화를 받습니다. 차량 위치와 진단 정보가 이미 화면에 있습니다.” 위치 확인 → 정차 · 비상등 안내 → 긴급출동 요청 → 선호 서비스센터 진행 동의 · 연락처 확인 · 추가 전달 사항 → 출동 기사와 서비스센터가 연락드린다는 안내로 통화를 마칩니다. 통화가 끝나면 출동 차량이 도착합니다.', run: [['cmd', 'ack']], until: 'callEnd', pause: 2500, long: true },
        { t: '상담 완료 · 서비스센터 이관', cue: '“견인 전에 상담 메모가 서비스센터 DMS로 이관됩니다. 서비스센터 화면에 컨택대기로 뜨고 첫 컨택 SLA가 시작됩니다.”', run: [['act', 'complete']], until: 'dmsIn', pause: 3000 },
        ARRIVE,
        DEALER_CALL, TOW_IN, REPAIR_CLOSE, SIM_END,
      ],
    },
    {
      id: 'out', n: '2', title: '긴급 경고 → 상담원 발신', sub: '고객 미연락 25분 뒤 상담원이 전화',
      steps: [PREP, DRIVE,
        { t: '긴급 경고 (고객 미연락)', cue: '“이번에는 고객이 전화하지 못하는 상황입니다.” 경고와 팝업은 뜨지만 전화연결을 누르지 않습니다.', run: [['warn', 'brake']], until: 'hu', pause: 3000, timeout: 20000 },
        { t: '25분 경과 · 상담원 자동 배정', cue: '“25분간 고객 연락이 없으면 TSP가 대기 만료를 판단해 유휴 상담원에게 배정합니다. 상담원 화면에 경고 알림 팝업이 뜹니다.”', run: [['act', 'sla25']], until: 'assigned', pause: 3500 },
        { t: '상담원 전화 걸기 · 통화', cue: '“상담원이 고객 휴대전화로 전화를 겁니다.” 고객 휴대전화가 울리고 통화가 자막으로 흐릅니다. 통화 중 긴급출동을 요청하고, 출동 기사가 직접 연락한다고 안내합니다.', run: [['act', 'accept']], until: 'callEnd', pause: 2500, long: true },
        { t: '상담 완료 · 서비스센터 이관', cue: '“같은 방식으로 견인 전에 상담 메모가 서비스센터 DMS로 넘어갑니다.”', run: [['act', 'complete']], until: 'dmsIn', pause: 6000 },
        ARRIVE,
        DEALER_CALL, TOW_IN, REPAIR_CLOSE, SIM_END,
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
        { t: '에어백 · 경고 등급', cue: '“주행 가능한 경고는 경고 등급(Case B)으로 판정되어 서비스센터에 바로 전달되고, SLA는 1일입니다. 헤드유닛에는 ‘지정된 서비스센터로 연결하시겠습니까?’가 뜹니다.”', run: [['warn', 'airbag']], until: 'dmsIn', pause: 5000 },
        { ...DMS_CONTACT, t: '서비스센터 직접 컨택 · 예약 확정', cue: '“상담원을 거치지 않고 서비스센터 DMS에 바로 들어온 건을 서비스 어드바이저가 고객에게 연락해 예약을 확정합니다.”' },
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
      { t: '오프닝', cue: '“Real Simulator 시연 — e-Care에 대한 고객의 경험 여정과 업무 flow를 보여 드리겠습니다.”', run: [['reset'], ['scene', 'opening']] },
      { t: '라이브 · 시동', cue: '라이브 화면으로 전환하며 시동을 켭니다.', run: [['scene', 'live'], ['wait', 900], ['ign', true]] },
      ...SCENARIOS[0].steps.slice(1).map((s) => ({ ...s, grp: '1막 · 고객 인바운드' })),
      { t: '다른 상황 · 다시 주행', cue: '“이번에는 고객이 전화하지 못하는 상황입니다.”', run: [['act', 'clear'], ['wait', 600], ['act', 'drive']], pause: 2500, grp: '2막 · 상담원 아웃바운드' },
      ...SCENARIOS[1].steps.slice(2, 8).map((s) => ({ ...s, grp: '2막 · 상담원 아웃바운드' })),
      { ...SCENARIOS[3].steps[2], run: [['act', 'clear'], ['wait', 900], ['warn', 'airbag']], grp: '3막 · 경고 등급' },
      { ...SCENARIOS[3].steps[3], grp: '3막 · 경고 등급' },
      { t: '시동 끄기', cue: 'IG OFF 세리머니가 재생됩니다.', run: [['ign', false]], grp: '클로징' },
      { t: '3면 클로징 · 요약', cue: '“경고 발생부터 상담 · 출동 · 딜러 이관까지의 흐름을 정리하면 이렇습니다. 감사합니다.”', run: [['scene', 'closing']], grp: '클로징' },
    ],
  });

  let sc = SCENARIOS.find((x) => x.id === (localStorage.getItem('control-scenario') || 'in')) || SCENARIOS[1];
  let cur = -1, busy = false, auto = false, waiting = '', skip = false;

  /* A step runs its ops, then may wait for its condition. Every step first saves a checkpoint
   * of the whole demo on the car panel; [이전] puts that back (the state before the step) and
   * abandons whatever is still running (token). */
  let token = 0;
  const cpKey = (i) => `${sc.id}:${i}`;
  const visited = new Set();          // steps whose checkpoint the car panel holds
  /* A step picked in the list: the demo is brought to the state that step expects and the
   * step plays from there. A step already played: its checkpoint (the state before it) is put
   * back. A step further on: the steps in between are settled quickly (no voice, each
   * situation finished at once), then the step plays. */
  async function jumpTo(i) {
    if (i < 0 || i >= sc.steps.length) return;
    if (i === cur + 1 && !busy) return go(i);
    const tok = ++token;
    busy = false; auto = false; waiting = ''; skip = false;
    Link.send('hush', {});
    leaveEnd();
    if (visited.has(i)) {
      Link.send('act', { name: 'restore', args: { k: cpKey(i) } });
      cur = i - 1; steps();
      await wait(700);
      if (tok === token) go(i);
      return;
    }
    jumping = true;
    for (let k = Math.max(0, cur + 1); k < i; k++) {
      if (tok !== token) { jumping = false; return; }
      const s = sc.steps[k];
      cur = k; waiting = `${i + 1}단계로 빠르게 맞추는 중 · ${k + 1}/${sc.steps.length} ${s.t}`; steps();
      Link.send('act', { name: 'checkpoint', args: { k: cpKey(k) } }); visited.add(k);
      skip = true;                                  // the step's own pauses end at once
      await run(s.run, tok);
      if (s.until) {
        const t0 = Date.now();
        while (tok === token && !UNTIL[s.until]() && Date.now() - t0 < (s.timeout || 15000)) {
          if (FINISH[s.until] && Date.now() - t0 > 600) FINISH[s.until]();
          await wait(400);
        }
      }
      Link.send('hush', {});
      await wait(300);
    }
    jumping = false; skip = false; waiting = '';
    if (tok === token) go(i);
  }
  let jumping = false;
  /* [다음] while a step plays: what it waits for is brought about at once (FINISH), waited for
   * a moment at most, and the next step starts — the presenter is never left waiting */
  let advancing = false;
  async function advance() {
    if (advancing) return;
    advancing = true;
    const tok = ++token;                              // the step's own run and wait stop here
    const i = cur, s = sc.steps[i];
    skip = true;
    Link.send('hush', {});
    send('act', 'settle');                            // a car still starting is on at once
    waiting = '마무리 중 · 곧 다음 단계'; steps();
    if (s && s.until) {
      const t0 = Date.now(), cap = SETTLE[s.until] || 3000;
      while (tok === token && !UNTIL[s.until]() && Date.now() - t0 < cap) {
        if (FINISH[s.until] && Date.now() - t0 < cap - 400) FINISH[s.until]();
        await wait(350);
      }
    }
    advancing = false;
    if (tok !== token) return;
    busy = false; skip = false; waiting = '';
    go(i + 1);
  }
  // the end message is over once the presenter goes back or jumps to another step
  function leaveEnd() { if (scene === 'end') { scene = 'live'; Link.send('stage', { scene: 'live' }); } }
  async function go(i) {
    if (busy) { advance(); return; }                 // next while a step runs: settle it, then go on
    if (i < 0 || i >= sc.steps.length) return;
    const tok = ++token;
    busy = true;
    skip = false;
    cur = i;
    waiting = '';
    steps();
    const s = sc.steps[i];
    Link.send('act', { name: 'checkpoint', args: { k: cpKey(i) } });
    visited.add(i);
    screenOnly();
    await run(s.run, tok);
    if (tok !== token) return;
    if (s.until) {
      waiting = s.long ? '통화 진행 중 · 끝나면 다음' : '반영 대기';
      steps();
      const t0 = Date.now();
      while (tok === token && !skip && !UNTIL[s.until]() && Date.now() - t0 < (s.timeout || (s.long ? 180000 : 15000))) await wait(300);
      if (tok !== token) return;
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
      if (tok !== token) return;
      waiting = '';
      if (auto && cur === i) go(i + 1);
    } else if (auto && i + 1 >= sc.steps.length) { auto = false; steps(); }
  }
  /* [다음] while a step is still playing: the voice stops and what the step waits for is
   * brought about at once (the call is settled, the truck pulls up, the DMS steps finish),
   * so the next step starts from the situation it expects */
  // conditions that need a little time of their own (a missed call takes a few seconds)
  const SETTLE = { hu: 6000, failed1: 9000, failed2: 9000, sms: 9000, inbound: 4000 };
  const FINISH = {
    inbound: () => Link.send('hu', { action: 'press' }),
    assigned: () => send('act', 'sla25'),
    saved: () => send('act', 'complete'),
    dealerEnd: () => send('cmd', 'finishDealer'),
    recv: () => send('cmd', 'towIn'),
    repDone: () => { const c = active(); if (c && c.dms >= 5) return; [0, 1].forEach((k) => setTimeout(() => send('cmd', 'dmsAdvance'), k * 200)); },
    done: () => { const c = active(); if (c && c.dms >= 7) return; [0, 1, 2].forEach((k) => setTimeout(() => send('cmd', 'dmsAdvance'), k * 200)); },
    callEnd: () => send('cmd', 'finishCall'),
    genEnd: () => send('cmd', 'endGeneral'),
    arrived: () => send('cmd', 'arrive'),
    dmsIn: () => send('act', 'complete'),
    resv: () => send('cmd', 'dmsContact', DMS_RESULT),
    closed: () => { const c = active(); if (c && c.dms >= 7) return; [0, 1, 2, 3, 4].forEach((k) => setTimeout(() => send('cmd', 'dmsAdvance'), k * 180)); },
  };
  function finishNow() {
    Link.send('hush', {});
    const s = sc.steps[cur];
    if (s && s.until && FINISH[s.until] && !UNTIL[s.until]()) FINISH[s.until]();
  }
  /** [이전]: back to the state just before the current step, as it was before it was pressed. */
  function back() {
    if (cur < 0) return;
    token++;
    busy = false; skip = false; auto = false; waiting = '';
    Link.send('hush', {});
    advancing = false;
    Link.send('hu', { action: 'cancelReach' });
    leaveEnd();
    Link.send('act', { name: 'restore', args: { k: cpKey(cur) } });
    cur -= 1;
    steps();
  }
  /** 초기화: no question, everything at once — the car stops and switches off. */
  function resetAll() {
    token++;
    visited.clear();
    busy = false; skip = false; auto = false; waiting = ''; cur = -1;
    Link.send('hush', {});
    Link.send('act', { name: 'fullReset', args: {} });
    send('cmd', 'noAnswer', { on: false });
    scene = 'live'; Link.send('stage', { scene: 'live' });
    camView = 'auto'; Link.send('cam', { view: 'auto' });
    ccwManual = false; localStorage.removeItem('control-ccwcam-manual');
    ccwCam = 'auto'; localStorage.setItem('control-ccwcam', ccwCam); Link.send('ccw-cam', { view: 'auto' });
    steps(); manualState();
  }
  /* the call center and DMS panels show the screen alone (화면만) once a scenario runs,
   * until the presenter picks a view for them on the dock */
  let ccwManual = localStorage.getItem('control-ccwcam-manual') === '1';
  function screenOnly() {
    if (ccwManual || ccwCam === 'screen') return;
    ccwCam = 'screen'; Link.send('ccw-cam', { view: 'screen' }); manualState();
  }
  function pick(id) {
    sc = SCENARIOS.find((x) => x.id === id);
    localStorage.setItem('control-scenario', id);
    cur = -1; auto = false; visited.clear();
    scenarios(); steps();
  }

  // chip labels (the full title and description are on hover)
  const SHORT = { show: '전체 발표', in: '고객 전화', out: '상담원 발신', noans: '미응답 → SMS', caseb: '경고 → DMS 직행', gen: '일반 전화' };
  const SET_SHORT = { in2: '메인 · 여성 · 엔진', in: '보조 · 남성 · 브레이크' };
  function scenarios() {
    $('#scenarios').innerHTML = SCENARIOS.map((x) => `<button class="sc ${x === sc ? 'on' : ''}" data-sc="${x.id}" title="${esc(x.title)} — ${esc(x.sub)}"><i>${x.n}</i><b>${esc(SHORT[x.id] || x.title)}</b><small>${esc(x.sub)}</small></button>`).join('')
      + `<div class="sets"><h3>인바운드 대화</h3>${E.SCRIPT_SETS.in.keys.map((k) => `<button data-pick="in:${k}" title="${esc(E.SCRIPT_NAMES[k])}">${esc(SET_SHORT[k] || E.SCRIPT_NAMES[k])}</button>`).join('')}</div>`;
    manualState();
  }
  // the screens show the scenario step as it plays (Final_Instrument, top left)
  let stepKey = '';
  function stepMsg() {
    const s = cur >= 0 ? sc.steps[cur] : null;
    return { sc: sc.id, title: sc.title, i: cur, n: sc.steps.length, t: s ? s.t : '', grp: s && s.grp ? s.grp : '', titles: sc.steps.map((x) => x.t) };
  }
  function sendStep(force) {
    const m = stepMsg();
    const key = `${m.sc}|${m.i}`;
    if (!force && key === stepKey) return;
    stepKey = key;
    Link.send('scn-step', m);
  }
  Link.on('scn-hello', () => sendStep(true));
  function steps() {
    const s = cur >= 0 ? sc.steps[cur] : null;
    const next = sc.steps[cur + 1];
    const now = $('#now');
    if (!now.firstElementChild) {
      now.innerHTML = `<div class="btns"><button id="prev">◀ 이전</button><button id="next" class="pri"><b></b><small></small></button><button id="auto"></button></div>
        <div class="hd"><small class="sn"></small><b class="st"></b><p class="cue"></p><em class="wait"></em></div>`;
    }
    const set = (sel, txt) => { const e = $(sel, now); if (e.textContent !== txt) e.textContent = txt; };
    set('.sn', `${sc.n} · ${sc.title}`);
    set('.st', s ? `${cur + 1}/${sc.steps.length} · ${s.t}` : '시작 전');
    set('.cue', s ? s.cue : `첫 단계: ${sc.steps[0].t}`);
    set('.wait', waiting ? `⏳ ${waiting}` : '');
    $('.wait', now).style.visibility = waiting ? 'visible' : 'hidden';
    set('#next b', busy ? '마무리하고 다음 ▶' : next ? '다음 ▶' : '끝');
    set('#next small', next ? next.t : '');
    set('#auto', auto ? '■ 멈춤' : '▶▶ 자동');
    $('#auto').classList.toggle('on', auto);
    $('#prev').disabled = cur < 0;
    sendStep();
    let grp = '';
    $('#steps').innerHTML = sc.steps.map((x, i) => {
      const head = x.grp && x.grp !== grp ? `<div class="grp">${esc(x.grp)}</div>` : '';
      grp = x.grp || grp;
      return `${head}<button data-step="${i}" class="${i < cur ? 'done' : ''} ${i === cur ? 'cur' : ''}"><i>${i < cur ? '✓' : i + 1}</i><span class="t" title="${esc(x.t)}">${esc(x.t)}</span>${x.long ? '<small>통화</small>' : ''}</button>`;
    }).join('');
    // the list scrolls inside its column: keep the step playing (or the next one) in view
    const at = $(`#steps [data-step="${Math.max(0, cur)}"]`);
    if (at && at.scrollIntoView) at.scrollIntoView({ block: 'nearest' });
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
        + chunk('엔진 사운드', [['ls500', 'LS 500'], ['lx600', 'LX 600'], ['lc500', 'LC 500']].map(([id, n]) => b(`data-engine="${id}"`, n, engineId() === id ? 'on' : '')).join(''), '시동 · 주행음 · 기본 LS 500')
        + chunk('경고등 켜기', `<div class="lampset"><span class="kA">긴급</span>${lamps('A')}</div><div class="lampset"><span class="kB">경고</span>${lamps('B')}<span class="kC">알림</span>${lamps('C')}</div>`, 'WNG 등급')
        + chunk('고객 헤드유닛', b('data-hu="show"', '팝업 다시 띄우기') + b('data-hu="press"', '전화연결 누르기'))
        + chunk('정리', b('data-a="clear"', '경고등 모두 끄기'))],
      call: ['상담센터', chunk('통화 진행', b('data-c="ack"', '① 상담원 받기') + b('data-a="accept"', '② 상담원 전화 걸기') + b('data-c="redial"', '③ 재연결') + b('data-c="hangup"', '④ 통화 종료'), '순서대로')
        + chunk('통화 후', b('data-a="dispatch"', '긴급출동') + b('data-c="arrive"', '출동 차량 도착') + b('data-a="complete"', '상담 완료 · 이관'))
        + chunk('시간 · 상황', b('data-a="sla25"', '25분 경과') + b('data-noans', '고객 미응답') + b('data-a="ccwNoise"', '콜센터 소음'))
        + chunk('서비스센터 (DMS)', b('data-dms="open"', 'DMS 상세 열기') + b('data-dms="close"', '닫기') + b('data-c="dmsAdvance"', '다음 단계 진행'), '예약 → 입고 → 정비 → 종결')
        + chunk('일반 전화 (경고 없음)', b('data-a="inbound"', '고객 전화 오기') + b('data-c="answerGeneral"', '전화 받기') + b('data-c="closeGeneral"', '메모 저장'))],
      wall: ['장면 · 화면', chunk('장면', ['opening:오프닝', 'live:라이브', 'closing:클로징', 'end:종료', 'black:암전'].map((x) => { const [k, n] = x.split(':'); return b(`data-scene="${k}"`, n); }).join(''))
        + chunk('시연 화면 비율', b('data-wmode="21"', '21:9') + b('data-wmode="169"', '16:9') + b('data-wmode="63"', '63:9'))
        + chunk('Final 화면 · 데이터 흐름', b('data-dfmode="simple"', '심플 (시연 중)') + b('data-dfmode="detail"', '상세 (Q&A)') + b('data-flowlog', flowLog ? '상세 로그 접기' : '상세 로그 펼치기'), 'Final_Dataflow')
        + chunk('Final 화면 · 상담 대화', b('data-talk="auto"', '자동') + b('data-talk="open"', '펼치기') + b('data-talk="close"', '접기'), 'Final_Instrument')
        + chunk('시연 화면 배치', b('data-wedit', '배치 편집') + b('data-wlabels', '라벨') + b('data-wreset', '기본 배치'))
        + chunk('점검 · 열기', b('data-identify', '화면 번호 표시') + ['final_instrument.html:Final_Instrument', 'final_dataflow.html:Final_Dataflow', 'wall.html:시연 화면 (1대)', 'dms.html:DMS 열기', 'test.html:모니터 테스트'].map((x) => { const i = x.indexOf(':'); return `<a href="${x.slice(0, i)}" target="_blank">${x.slice(i + 1)}</a>`; }).join(''))],
    };
    if (!TABS[mtab]) mtab = 'car';
    $('#manual').innerHTML = `<div class="mh"><h2>수동 제어</h2><nav class="tabs">${Object.keys(TABS).map((k) => `<button data-mtab="${k}" class="${k === mtab ? 'on' : ''}">${TABS[k][0]}</button>`).join('')}</nav></div>
      <div class="mbody">${TABS[mtab][1]}</div>`;
    manualState();
  }
  // the engine sound buttons: only their marks change (re-rendering the panel would swallow a click)
  function engineMarks() { const id = engineId(); document.querySelectorAll('[data-engine]').forEach((x) => x.classList.toggle('on', x.dataset.engine === id)); }
  let dfMode = 'simple', talkMode = 'auto';
  Link.on('df-state', (d) => { dfMode = d.mode; manualState(); });
  function manualState() {
    document.querySelectorAll('[data-dfmode]').forEach((x) => x.classList.toggle('on', x.dataset.dfmode === dfMode));
    document.querySelectorAll('[data-talk]').forEach((x) => x.classList.toggle('on', x.dataset.talk === talkMode));
    document.querySelectorAll('[data-wmode]').forEach((x) => x.classList.toggle('on', x.dataset.wmode === wall.mode));
    document.querySelectorAll('[data-cam]').forEach((x) => x.classList.toggle('on', x.dataset.cam === camView));
    document.querySelectorAll('[data-ccwcam]').forEach((x) => x.classList.toggle('on', x.dataset.ccwcam === ccwCam));
    const we = $('[data-wedit]'), wl = $('[data-wlabels]');
    if (we) we.classList.toggle('on', !!wall.edit);
    if (wl) wl.classList.toggle('on', !!wall.labels);
    document.querySelectorAll('[data-scene]').forEach((x) => x.classList.toggle('on', x.dataset.scene === scene));
    const op = $('[data-opening]');
    if (op) { op.classList.toggle('on', scene === 'opening'); op.textContent = scene === 'opening' ? '오프닝 끄기' : '오프닝'; }
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
    else if (t.id === 'prev') back();
    else if ('opening' in d) { const on = scene !== 'opening'; send('scene', on ? 'opening' : 'live'); manualState(); }
    else if (t.id === 'auto') { auto = !auto; steps(); if (auto && !busy) go(cur + 1); }
    else if (d.mtab) { mtab = d.mtab; localStorage.setItem('control-mtab', mtab); manual(); }
    else if (d.sc) pick(d.sc);
    else if (d.step) jumpTo(+d.step);
    else if (d.pick) { const [kind, key] = d.pick.split(':'); send('cmd', 'pick', { kind, key }); }
    else if (d.scene) { send('scene', d.scene); manualState(); }
    else if ('identify' in d) Link.send('stage-identify', {});
    else if (d.cam) { camView = d.cam; Link.send('cam', { view: d.cam }); manualState(); }
    else if (d.dms) Link.send(d.dms === 'open' ? 'dms-open' : 'dms-close', {});
    else if (d.dfmode) { dfMode = d.dfmode; Link.send('df-mode', { mode: d.dfmode }); manualState(); }
    else if (d.talk) { talkMode = d.talk; Link.send('talk-panel', { open: d.talk === 'auto' ? 'auto' : d.talk === 'open' }); manualState(); }
    else if ('flowlog' in d) { flowLog = !flowLog; Link.send('flow-log', { open: flowLog }); manual(); }
    else if (d.ccwcam) { ccwCam = d.ccwcam; ccwManual = true; localStorage.setItem('control-ccwcam-manual', '1'); localStorage.setItem('control-ccwcam', ccwCam); Link.send('ccw-cam', { view: ccwCam }); manualState(); }
    else if (d.wmode) setWall({ mode: d.wmode });
    else if ('wedit' in d) setWall({ edit: !wall.edit });
    else if ('wlabels' in d) setWall({ labels: !wall.labels });
    else if ('wreset' in d) { if (confirm('현재 비율의 배치를 기본값으로 되돌릴까요?')) Link.send('wall', { reset: true }); }
    else if (d.engine) { Link.send('act', { name: 'engineSound', args: { id: d.engine } }); engineSel = d.engine; engineMarks(); }
    else if (d.a === 'hazard') send('act', 'hazard', { on: !(veh && veh.hazard) });
    else if (d.a) send('act', d.a);
    else if (d.warn) send('warn', d.warn);
    else if (d.hu) send('hu', d.hu);
    else if (d.c) send('cmd', d.c, d.c === 'closeGeneral' ? {} : undefined);
    else if ('noans' in d) send('cmd', 'noAnswer', { on: !(snap && snap.noAnswer) });
    else if ('reset' in d) resetAll();
  });
  addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea')) return;
    if (e.code === 'ArrowRight' || e.code === 'ArrowDown' || e.code === 'Space' || e.code === 'PageDown') { e.preventDefault(); go(cur + 1); }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowUp' || e.code === 'PageUp') { e.preventDefault(); back(); }
  });

  scenarios();
  steps();
  status();
  manual();
  Link.send('wall-hello', {});
})();
