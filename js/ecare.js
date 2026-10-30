/* e-Care scenario: shared definitions and the case state machine.
 *
 * The vehicle simulator (index.html) is the director: it owns the case state,
 * advances it and broadcasts snapshots over Link. Other screens (call center,
 * transcript, later HU / OPW / DMS / data flow) render the snapshots and send
 * commands back. Flow follows the CCW screen definition (Global South Call
 * Center Web, 11.x):
 *  red warning -> case (컨택 전, SLA 25:00)
 *   A) MM call from the customer -> 11.1.1.1 전화 수신 안내 팝업 -> [확인]
 *   B) 25 min without a call -> idle agent auto-assigned -> 11.1.1.2 경고 알림
 *      팝업 (05:00, red under 01:00, then overcount) -> [전화 걸기]
 *  -> 11.2.1.1 e-Care 고객 응대 (발신중 -> 상담중) -> call ends (후처리중)
 *  -> 11.3.1.x 상담 메모 (메모 -> 서비스센터 선택 -> 상담내역 확인) -> 저장,
 *     DMS 전송 -> 상담 완료 / 이관 완료 -> service center repairStatus.
 *  Exception A: outbound fails 3 times (first + 2 retries, 01:00 apart) ->
 *     SMS sent automatically -> 상담대기 -> memo -> DMS -> 상담 완료.
 *  amber warning -> maintenance case sent to the preferred center, no contact.
 */
(function () {
  'use strict';

  const SLA = 25 * 60 * 1000;
  const ASSIGN_TIMEOUT = 5 * 60 * 1000;
  const RETRY_WAIT = 60 * 1000;
  const RETRIES = 2;

  // diagnostic codes, cluster (MID) message and guidance per warning lamp
  const WARN = {
    brake: { dtc: 'C1241', sys: '브레이크 시스템', mid: 'Brake System Malfunction', risk: '높음 · 즉시 정차', act: '즉시 안전한 장소에 정차하고 서비스 센터에 연락하십시오. 제동력이 저하되어 계속 주행 시 사고 위험이 있습니다.' },
    oil: { dtc: 'P0524', sys: '엔진 오일 압력', mid: 'Low Engine Oil Pressure', risk: '높음 · 엔진 손상 위험', act: '즉시 안전한 장소에 정차하여 엔진을 끄고 서비스 센터에 연락하십시오. 계속 주행 시 심각한 엔진 손상이 발생할 수 있습니다.' },
    coolant: { dtc: 'P0217', sys: '엔진 냉각 시스템', mid: 'Engine Coolant Temp High', risk: '높음 · 과열', act: '즉시 안전한 장소에 정차하여 엔진을 끄고 서비스 센터에 연락하십시오. 계속 주행 시 심각한 엔진 손상이 발생할 수 있습니다.' },
    battery: { dtc: 'P0562', sys: '충전 시스템', mid: 'Charging System Malfunction', risk: '중간 · 시동 꺼짐 위험', act: '전기 장치 사용을 줄이고 가까운 서비스 센터를 방문하십시오.' },
    airbag: { dtc: 'B0001', sys: '에어백 시스템', mid: 'SRS Airbag Malfunction', risk: '높음 · 충돌 시 미작동', act: '충돌 시 에어백이 작동하지 않을 수 있습니다. 서비스 센터에서 즉시 점검을 받으십시오.' },
    door: { dtc: 'B1541', sys: '도어', mid: 'Door Open', risk: '중간', act: '안전한 장소에 정차한 뒤 모든 도어의 닫힘 상태를 확인하십시오.' },
    engine: { dtc: 'P0301', sys: '엔진점화 이상', mid: 'Check Engine', risk: '중간 · 실화 감지', act: '급가속을 피하고 가까운 서비스 센터에서 점검을 받으십시오.' },
    abs: { dtc: 'C1201', sys: 'ABS', mid: 'ABS Malfunction', risk: '중간', act: '급제동을 피하고 서비스 센터에서 점검을 받으십시오.' },
    esp: { dtc: 'C1210', sys: '차량 자세 제어(VSC)', mid: 'VSC Malfunction', risk: '중간', act: '미끄러운 노면에서 주의하고 서비스 센터에서 점검을 받으십시오.' },
    gearbox: { dtc: 'P0700', sys: '변속기', mid: 'Transmission Malfunction', risk: '중간', act: '급가속을 피하고 서비스 센터에서 점검을 받으십시오.' },
    brakepad: { dtc: 'C1300', sys: '브레이크 패드', mid: 'Brake Pad Worn', risk: '낮음', act: '브레이크 패드 교체를 위해 정비를 예약하십시오.' },
    oillevel: { dtc: 'P250F', sys: '엔진 오일 레벨', mid: 'Engine Oil Level Low', risk: '낮음', act: '엔진 오일을 보충하거나 교환 정비를 예약하십시오.' },
  };

  // lamp -> WNG master for e-Care (v7) data label, warning name, Case. Only these
  // three fields are kept here; the master itself stays in the project archive.
  const WNG = {
    brake: { code: 'BRW', name: '브레이크 시스템', case: 'A' },
    oil: { code: 'OPW', name: '엔진오일 압력 시스템', case: 'A' },
    coolant: { code: 'WTPW', name: '엔진냉각수 온도', case: 'A' },
    battery: { code: 'LW', name: '충전 시스템', case: 'A' },
    airbag: { code: 'FSRS', name: '에어백 시스템', case: 'B' },
    door: { code: 'ELSW', name: '도어락 시스템', case: 'B' },
    engine: { code: 'ENGW', name: '엔진 시스템', case: 'A' },
    abs: { code: 'ABSW', name: 'ABS 시스템', case: 'A' },
    esp: { code: 'VSCW', name: 'VSC 시스템', case: 'B' },
    gearbox: { code: 'TMW2', name: '트랜스미션 시스템', case: 'B' },
    brakepad: { code: 'BPAD', name: '브레이크 패드', case: 'C', assumed: true },
    oillevel: { code: 'OLW', name: '엔진오일 레벨', case: 'A' },
  };
  const CASE = {
    A: { label: 'Case A', kind: '주행불가', owner: '콜센터 (CCW)', sla: 25 * 60 * 1000, slaText: '25분' },
    B: { label: 'Case B', kind: '주행가능 · 점검 필요', owner: '서비스센터 (DMS)', sla: 24 * 3600 * 1000, slaText: '1일' },
    C: { label: 'Case C', kind: '정비 · 알림', owner: '서비스센터 · 고객 (DMS · App/MM)', sla: 7 * 24 * 3600 * 1000, slaText: '7일' },
  };

  const CUSTOMER = { name: '홍길동', phone: '010-1234-5678', grade: 'Lexus Premium' };
  const VEHICLE = { model: 'GX 550', year: 2026, brand: '렉서스', vin: 'JTJBA7BX5T4041417', plate: '123가4567', color: 'Atomic Silver' };
  const AGENTS = [
    { id: 'a1', name: '김상담', ext: '2101' },
    { id: 'a2', name: '이서준', ext: '2102' },
    { id: 'a3', name: '박지민', ext: '2103' },
  ];
  const DEALERS = [
    { name: '강남 서비스센터', brand: '렉서스', open: '영업중', km: 2.3, addr: '서울특별시 강남구 테헤란로 123', tel: '02-1234-5678', hours: '평일 09:00-18:00', pref: true },
    { name: '서초 서비스센터', brand: '렉서스', open: '영업중', km: 3.8, addr: '서울특별시 서초구 서초대로 456', tel: '02-2345-6789', hours: '평일 09:00-18:00' },
    { name: '용산 서비스센터', brand: '렉서스', open: '영업종료', km: 6.1, addr: '서울특별시 용산구 한강대로 92', tel: '02-3456-7890', hours: '평일 09:00-17:00' },
    { name: '잠실 서비스센터', brand: '토요타', open: '확인불가', km: 8.5, addr: '서울특별시 송파구 올림픽로 300', tel: '02-4567-8901', hours: '평일 09:00-18:00' },
  ];
  // outbound call after 25 minutes (recorded Korean lines)
  const CALL_OUT = [
    { who: 'agent', text: '안녕하세요, e-Care 상담센터입니다. 홍길동 고객님 휴대폰 맞으신가요?', audio: 'assets/audio/ko_agent_001.wav', dur: 5.64 },
    { who: 'customer', text: '네, 맞아요.', audio: 'assets/audio/ko_customer_002.wav', dur: 1.88 },
    { who: 'agent', text: '25분 전 차량에서 브레이크 시스템 경고가 감지됐는데 연락이 없으셔서 먼저 전화드렸습니다. 지금 안전한 곳에 계신가요?', audio: 'assets/audio/ko_agent_003.wav', dur: 8.56 },
    { who: 'customer', text: '경황이 없어서 연락을 못 했어요. 갓길에 세워 뒀어요.', audio: 'assets/audio/ko_customer_004.wav', dur: 4.24 },
    { who: 'agent', text: '현재 위치로 긴급출동 차량을 바로 보내드리겠습니다. 비상등을 켜고 차 밖 안전한 곳에서 기다려 주세요.', audio: 'assets/audio/ko_agent_005.wav', dur: 7.36 },
  ];
  // inbound MM call (customer presses the e-Care button / calls from the app)
  const CALL_IN = [
    { who: 'customer', text: '차량 화면에 브레이크 경고가 떠서 전화하기 버튼을 눌렀어요.', audio: 'assets/audio/ko_customer_006.wav', dur: 4.45 },
    { who: 'agent', text: 'e-Care 상담센터입니다. 차량에서 바로 연결되어 고객님 차량의 진단 정보가 함께 접수되었습니다.', audio: 'assets/audio/ko_agent_007.wav', dur: 8.06 },
    { who: 'agent', text: '브레이크 시스템 이상이라 주행을 멈추셔야 합니다. 정차하셨나요?', audio: 'assets/audio/ko_agent_008.wav', dur: 7.3 },
    { who: 'customer', text: '네, 갓길에 세웠어요.', audio: 'assets/audio/ko_customer_009.wav', dur: 1.7 },
    { who: 'agent', text: '현재 위치로 긴급출동 차량을 보내드리겠습니다. 차 밖 안전한 곳에서 기다려 주세요.', audio: 'assets/audio/ko_agent_010.wav', dur: 5.62 },
];
  // general call: the customer calls with no open warning case (11.1.1.3)
  const CALL_GEN = [
    { who: 'agent', text: '네, e-Care 상담센터 김상담입니다. 무엇을 도와드릴까요?', dur: 3.6 },
    { who: 'customer', text: '지난번 경고등 때문에 상담받았는데요, 서비스센터 입고 예약이 잘 됐는지 확인하고 싶어요.', dur: 5.2 },
    { who: 'agent', text: '확인해 보니 서비스센터로 상담 내용이 전달되어 있고, 담당 어드바이저가 오늘 중 연락드릴 예정입니다.', dur: 6.4 },
    { who: 'customer', text: '네, 알겠습니다. 감사합니다.', dur: 2.2 },
  ];
  const SCRIPTS = { in: CALL_IN, out: CALL_OUT, gen: CALL_GEN };
  const SCRIPT_NAMES = { in: '고객 인바운드 · HU 전화연결 (메인)', out: '25분 경과 아웃바운드', gen: '일반 전화 (재문의)' };
  const CONTACT = ['컨택 전', '컨택 중', '상담 완료', '이관 완료'];
  const DISPATCH = ['신고접수', '출동', '도착', '출동완료'];
  // service center, DMS-SVC-002 repairStatus
  const DMS = ['컨택대기', '컨택', '예약', '입고', '정비', '정비완료', '고객인도', '종결'];
  const DMS_CODE = ['CONTACT_REQUIRED', 'CONTACTED', 'RESERVED', 'RECEIVED', 'REPAIR_STARTED', 'REPAIR_DONE', 'DELIVERED', 'CLOSED'];

  const pad = (n) => String(n).padStart(2, '0');
  const hm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const ymd = (t, sep = '-') => { const d = new Date(t); return [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join(sep); };
  const stamp = (t) => `${ymd(t)} ${hm(t)}`;
  const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

  /* ------------------------------------------------------------ director -- */
  class Director {
    constructor(getVehicle) {
      this.getVehicle = getVehicle;
      this.hooks = {};
      this.noAnswer = false;
      this.scripts = loadScripts();
      this.reset(true);
      Link.on('cmd', (c) => this.command(c.name, c.args || {}));
      Link.on('hello', () => this.publish());
    }

    reset(silent) {
      this.cases = [];
      this.seq = 41;
      this.active = null;
      this.timers && this.timers.forEach(clearTimeout);
      this.timers = [];
      this.agents = AGENTS.map((a) => ({ ...a, state: '대기' }));
      this.consults = [];
      this.general = null;
      this.flows = [];
      this.flowSeq = 0;
      this.skip = 0;            // simulated minutes skipped (25-minute fast-forward)
      if (!silent) this.publish();
    }

    after(ms, fn) { this.timers.push(setTimeout(fn, ms)); }

    log(c, text, kind) { c.log.push({ t: Date.now(), text, kind: kind || 'info' }); }

    /** A message between two systems, for the data flow monitor. Steps are
     *  [from, to, api, label, payload?, delayMs?]; delays are cumulative. */
    flow(c, steps) {
      let at = 0;
      steps.forEach(([from, to, api, label, payload, delay]) => {
        at += delay == null ? 450 : delay;
        this.after(at, () => {
          this.flows.push({ id: ++this.flowSeq, t: Date.now(), from, to, api, label, payload: payload || null, caseId: c ? c.id : null, group: c ? c.group : null, wcase: c ? c.wcase : null });
          if (this.flows.length > 80) this.flows.splice(0, this.flows.length - 80);
          this.publish();
        });
      });
    }

    me() { return this.agents[0]; }

    /** A warning lamp came on in the vehicle. */
    warning(level, item) {
      const v = this.getVehicle();
      const w = WARN[item.id] || { dtc: '—', sys: item.title, mid: item.title, risk: '—', act: item.desc };
      const id = `EC-${ymd(Date.now(), '')}-${pad4(++this.seq)}`;
      const wng = WNG[item.id] || { code: item.id.toUpperCase(), name: item.title, case: level === 'red' ? 'A' : 'B', assumed: true };
      // a Case A that is still open absorbs the new warning into its group (one workflow)
      const open = this.cases.find((x) => x.group && x.contact < 3 && !(x.sheet && x.sheet.saved));
      const group = open && wng.case !== 'A' ? open.group : uuid();
      const c = {
        id, level, kind: wng.case === 'A' ? 'emergency' : 'maintenance', wcase: wng.case, wng, group,
        warn: { id: item.id, title: item.title, desc: item.desc, ...w },
        at: Date.now(), slaBase: Date.now(), contact: 0, dispatch: -1, dms: -1,
        agent: null, call: null, assign: null, inbound: null, retry: null, sms: false,
        sheet: null, memo: { title: '', text: '', transfer: true, dealer: DEALERS[0].name, name: CUSTOMER.name, phone: CUSTOMER.phone, request: '' },
        dealer: null, loc: { odo: v.odoMeters }, log: [],
      };
      this.log(c, `차량 경고 감지 · ${item.title} (${w.dtc})`, level === 'red' ? 'alert' : 'warn');
      this.log(c, 'VDP(일본) 수신 → VEP(TSP, 한국) 판정', 'flow');
      if (c.kind === 'emergency') {
        this.log(c, 'VEP(TSP) → 콜센터 웹 · DMS 등록 / VDP → 고객 앱 · 차량 HU 알림', 'flow');
        this.log(c, 'SLA 시작 · 고객 인바운드 대기 25:00', 'sla');
        if (!this.active || !this.find() || this.find().contact >= 2) this.active = id;
      } else {
        c.dealer = DEALERS[0].name;
        this.log(c, `정비 경고 · 상담원 미대응 · 선호 센터(${c.dealer}) DMS 전송`, 'flow');
        c.contact = 3;
        c.dms = 0;
      }
      this.cases.unshift(c);
      this.publish();
      const pos = Road.pos(v.odoMeters);
      const info = { wngId: wng.code, counterValue: 1, warningTriggerOccurrenceTime: new Date().toISOString(), latitude: +(37.5003 + pos[1] / 111000).toFixed(6), longitude: +(127.0364 + pos[0] / 88200).toFixed(6), odoInformationKm: +(v.odo || 0).toFixed(1), vin: VEHICLE.vin };
      const steps = [
        ['car', 'vdp', 'WNG', `경고 발생 · ${wng.code}`, info, 0],
        ['vdp', 'vep', 'VDP 이벤트', 'WNG 이벤트 전달 (VDP → TSP)', { messageId: String(Date.now()).slice(-10), wngInfo: [info] }],
        ['vep', 'vep', '필터 검사', 'VIN · 정비 · 중복 필터 통과', { vinFilter: 'pass', maintenanceFilter: 'pass', duplicateFilter: 'pass' }, 650],
        ['vep', 'vep', 'Case 판정', `WNG master ${wng.code} → ${CASE[wng.case].label} ${CASE[wng.case].kind}`, { dataLabel: wng.code, warningName: wng.name, case: wng.case, owner: CASE[wng.case].owner, source: wng.assumed ? '시뮬레이터 가정 (master 미등록)' : 'WNG master for e-Care v7' }, 700],
        ['vep', 'wam', '그룹 ID', `workflowId 발급 · ${group.slice(0, 8)}`, { workflowId: group, case: wng.case }],
      ];
      if (wng.case === 'A') steps.push(['wam', 'ccw', 'e-Care 이벤트', 'CCW 긴급 케이스 등록 · 인바운드 대기 25:00', { caseId: id, workflowId: group, case: 'A' }]);
      steps.push(
        ['wam', 'dms', 'WAM-EVT-001', `경고 이벤트 전달 · ${CASE[wng.case].label}`, { workflowId: group, vin: VEHICLE.vin, wngInfo: [{ wngId: wng.code, wngName: wng.name, grade: wng.case }] }, 300],
        ['wam', 'dms', 'WAM-SLA-001', `SLA 기준 전달 · ${CASE[wng.case].slaText}`, { workflowId: group, case: wng.case, thresholdMinutes: CASE[wng.case].sla / 60000 }, 300],
        ['wam', 'vdp', '고객 알림', wng.case === 'A' ? 'MM 팝업 · 앱 푸시 "콜센터에 연결하겠습니까?"' : 'MM 팝업 · 앱 푸시 "딜러에 연결하겠습니까?"', { channel: ['MM', 'Global App'], case: wng.case }, 300],
        ['vdp', 'car', 'MM 알림', 'HU 경고 팝업 표시', null, 400],
        ['vdp', 'phone', '앱 푸시', '고객 앱 경고 알림', null, 0],
      );
      this.flow(c, steps);
      if (c.kind !== 'emergency') this.dmsProgress(c, true);
    }

    /** Service center side: repair status updates coming back (DMS-SVC-002). */
    dmsProgress(c, direct) {
      const plan = direct ? [[9000, 1], [17000, 2]] : [[6000, 1], [14000, 2]];
      plan.forEach(([ms, k]) => this.after(ms, () => {
        c.dms = k;
        this.log(c, `DMS · ${DMS[k]} (${DMS_CODE[k]}) · ${c.dealer}`, 'flow');
        this.publish();
        this.flow(c, [
          ['dms', 'wam', 'DMS-SVC-002', `정비 상태 · ${DMS[k]}`, { workflowId: c.group, vin: VEHICLE.vin, repairStatus: DMS_CODE[k], repairStatusName: DMS[k], centerName: c.dealer }, 0],
          ['wam', direct ? 'phone' : 'ccw', '상태 반영', direct ? `고객 앱 · 서비스센터 ${DMS[k]}` : `CCW 처리 상태 · ${DMS[k]}`, null],
        ]);
      }));
    }

    find(id) { return this.cases.find((c) => c.id === (id || this.active)); }
    live() { return this.cases.find((c) => c.kind === 'emergency' && c.contact < 3 && !(c.sheet && c.sheet.saved)); }

    command(name, args) {
      const c = this.find(args.id) || this.live();
      switch (name) {
        case 'reset': return this.reset();
        case 'select': if (c) { this.active = c.id; this.publish(); } return;
        case 'sla25': return this.sla25(c);
        case 'inbound': return this.inbound(this.live());
        case 'answerGeneral': return this.answerGeneral();
        case 'endGeneral': return this.endGeneral();
        case 'closeGeneral': return this.closeGeneral(args.text);
        case 'line': return this.editLine(args);
        case 'script': return this.script(args);
        case 'consultMemo': { const k = this.consults.find((x) => x.id === args.consult); if (k && args.text) { (k.memos = k.memos || []).push({ t: Date.now(), text: args.text, agent: this.me().name }); k.updated = Date.now(); this.publish(); } return; }
        case 'ack': return this.ack(c);
        case 'accept': return this.accept(c);
        case 'hangup': if (this.general && this.general.state === 'connected') return this.endGeneral(); return this.hangup(c);
        case 'hold': if (c && c.call) { c.call.hold = !c.call.hold; this.publish(); } return;
        case 'redial': return this.redial(c);
        case 'noAnswer': this.noAnswer = args.on == null ? !this.noAnswer : !!args.on; this.publish(); return;
        case 'dispatch': return this.dispatch(c);
        case 'complete': return this.complete(c);
        case 'sheet': return this.sheet(c, args);
        case 'memo': if (c) { Object.assign(c.memo, args.memo || {}); this.publish(); } return;
        case 'save': return this.save(c);
        default:
      }
    }

    /** Fast-forward: 25 minutes without a call, or skip the redial wait. */
    sla25(c) {
      if (!c || c.kind !== 'emergency') return;
      if (c.retry && !c.retry.done && c.retry.until > Date.now()) { c.retry.until = Date.now(); this.publish(); return; }
      if (c.contact > 0 || c.assign || c.inbound) return;
      c.slaBase = Date.now() - SLA;
      this.skip += 25;
      this.flows.push({ id: ++this.flowSeq, t: Date.now(), type: 'skip', minutes: 25, label: '25분 경과 · 인바운드 콜 없음', caseId: c.id });
      const idle = this.agents.find((a) => a.state === '대기');
      this.log(c, 'SLA 25분 경과 · 인바운드 콜 없음 → 25분 자동 아웃바운드', 'sla');
      if (!idle) { this.log(c, '유휴 상담사 없음 → 고객 SMS 콜백 문자 발송, 유휴 상담사 발생 시 자동 할당', 'warn'); this.publish(); return; }
      c.assign = { agent: idle.id, at: Date.now(), until: Date.now() + ASSIGN_TIMEOUT };
      c.agent = idle.id;
      this.log(c, `유휴 상담사 자동 배정 · ${idle.name} (${idle.ext}) · 경고 알림 팝업 05:00`, 'info');
      this.flow(c, [
        ['wam', 'cti', '상담원 조회', 'IDLE 상담원 조회 (25분 경과)', { request: 'idleAgents' }, 900],
        ['cti', 'wam', 'IDLE 응답', `유휴 상담원 ${idle.name} (${idle.ext})`, { agentId: idle.id, ext: idle.ext, state: 'IDLE' }],
        ['wam', 'cti', '상태 전환', '상담원 상태 → 상담 (자동 배정 제외)', { agentId: idle.id, state: 'BUSY' }],
        ['wam', 'ccw', 'WNG 콜 팝업', `경고 알림 팝업 · 응대 제한 05:00`, { caseId: c.id, agent: idle.name }],
      ]);
      this.active = c.id;
      this.publish();
      Link.send('ccw-open-case', { id: c.id });
    }

    /** A) the customer calls in (MM call through CTI). Returns what happened. */
    inbound(c) {
      const busy = this.cases.find((x) => x.call && (x.call.state === 'connected' || x.call.state === 'dialing')) || (this.general && this.general.state !== 'ended');
      if (busy) return 'busy';
      if (c && c.kind === 'emergency' && c.contact === 0 && !c.inbound) {
        const idle = this.agents.find((a) => a.state === '대기') || this.me();
        c.inbound = { at: Date.now(), agent: idle.id };
        c.agent = idle.id;
        c.assign = null;
        this.log(c, `고객 인바운드 콜 (MM 콜 · CTI) · ${CUSTOMER.phone} → ${idle.name} 상담원`, 'call');
        this.flow(c, [
          ['car', 'cti', 'MM 콜', 'HU [전화연결] · 인바운드 콜', { from: 'MM', vin: VEHICLE.vin }, 0],
          ['cti', 'ccw', '콜 배정', `유휴 상담원 ${idle.name} 자동 할당 · 전화 수신 팝업`, { agent: idle.name }],
          ['cti', 'wam', '자동 할당 취소', '인바운드 발생 → 25분 아웃바운드 배정 취소', null],
        ]);
        this.active = c.id;
        this.publish();
        Link.send('ccw-open-case', { id: c.id });
        return 'case';
      }
      // no open warning case: a general call (11.1.1.3), answered without leaving the screen
      this.general = { state: 'ringing', at: Date.now(), lines: [], agent: this.me().id, consult: this.consults[0] ? this.consults[0].id : null };
      this.publish();
      this.flow(null, [['phone', 'cti', '일반 전화', '고객 휴대폰 → 콜센터 대표번호', { from: CUSTOMER.phone }, 0], ['cti', 'ccw', '콜 배정', '전화 수신 안내 팝업 (일반 전화)', null]]);
      return 'general';
    }

    answerGeneral() {
      const g = this.general;
      if (!g || g.state !== 'ringing') return;
      g.state = 'connected';
      g.connectedAt = Date.now();
      this.me().state = '상담중';
      this.publish();
      const next = (i) => {
        if (this.general !== g || g.state !== 'connected') return;
        const script = this.scripts.gen;
        if (i >= script.length) { this.after(1500, () => this.endGeneral()); return; }
        g.lines.push({ ...script[i], t: Date.now() });
        this.publish();
        Link.send('say', { line: script[i], index: i, general: true });
        this.after(script[i].dur * 1000 + 700, () => next(i + 1));
      };
      next(0);
    }

    endGeneral() {
      const g = this.general;
      if (!g || g.state !== 'connected') return;
      g.state = 'ended';
      g.endedAt = Date.now();
      this.me().state = '후처리중';
      g.memo = '고객 재문의: 서비스센터 입고 예약 확인 요청 → 상담 메모 전달 및 어드바이저 연락 예정 안내 완료.';
      this.publish();
    }

    closeGeneral(text) {
      const g = this.general;
      if (!g) return;
      if (g.state === 'connected') this.endGeneral();
      const k = this.consults.find((x) => x.id === g.consult);
      if (k && text) { (k.memos = k.memos || []).push({ t: Date.now(), text, agent: this.me().name }); k.updated = Date.now(); }
      this.consults.unshift({ id: `GN-${Date.now()}`, at: g.at, type: '인바운드 콜', title: '일반문의_홍길동', agent: this.me().name, result: '상담 완료', dealer: '-', general: true, memo: text || g.memo });
      this.general = null;
      this.me().state = '대기';
      this.publish();
    }

    /** Edit or delete a line of a call that is in progress or done. */
    editLine(args) {
      const lines = args.general ? this.general && this.general.lines : (this.find(args.id) || {}).call && this.find(args.id).call.lines;
      const l = lines && lines[args.idx];
      if (!l) return;
      if (args.del) l.deleted = true;
      else if (typeof args.text === 'string') { l.text = args.text; l.edited = true; }
      this.publish();
    }

    /** Edit the call scripts used by the next calls (kept on this PC). */
    script(args) {
      const list = this.scripts[args.key];
      if (args.reset) this.scripts = defaults();
      else if (!list) return;
      else if (args.add) list.push({ who: args.who || 'agent', text: args.text || '', dur: 4 });
      else if (args.audios) args.audios.forEach((x) => { const l = list[x.idx]; if (l) { l.audio = x.audio || null; l.dur = x.audio ? x.dur : Math.max(2, l.text.length * 0.16); } });
      else if (args.del) list.splice(args.idx, 1);
      else if (list[args.idx]) {
        const l = list[args.idx];
        if (typeof args.text === 'string' && args.text !== l.text) { l.text = args.text; l.audio = null; l.dur = Math.max(2, args.text.length * 0.16); }
        if (args.who) l.who = args.who;
      }
      saveScripts(this.scripts);
      this.publish();
    }

    /** [확인] on the incoming-call popup: the call is answered. */
    ack(c) {
      if (!c || !c.inbound || c.call) return;
      const agent = this.agents.find((a) => a.id === c.agent);
      agent.state = '상담중';
      c.contact = 1;
      c.call = { dir: 'in', state: 'connected', at: Date.now(), connectedAt: Date.now(), line: -1, lines: [], attempts: 1 };
      if (this.hooks.accept) this.hooks.accept(c);
      this.log(c, `${agent.name} 상담원 수신 · 통화 연결 (인바운드)`, 'call');
      this.flow(c, [['ccw', 'cti', '수신', '상담원 응답 · 통화 연결 (녹취)', null, 0], ['cti', 'car', '음성', '차량 MM ↔ 상담원 통화', null]]);
      this.publish();
      this.nextLine(c, 0, this.scripts.in);
    }

    /** [전화 걸기] on the warning popup: outbound call through CTI. */
    accept(c) {
      if (!c || c.kind !== 'emergency' || c.contact > 0) return;
      if (c.inbound) return this.ack(c);
      if (!c.assign) { c.slaBase = Math.min(c.slaBase, Date.now()); c.assign = { agent: 'a1', at: Date.now(), until: Date.now() + ASSIGN_TIMEOUT }; c.agent = 'a1'; }
      const agent = this.agents.find((a) => a.id === c.assign.agent);
      c.agent = agent.id;
      c.contact = 1;
      c.assign.done = Date.now();
      if (this.hooks.accept) this.hooks.accept(c);
      this.log(c, `${agent.name} 상담원 [전화 걸기] · e-Care 고객 응대 진입 · CTI 백그라운드 발신`, 'call');
      this.dial(c);
    }

    dial(c) {
      const agent = this.agents.find((a) => a.id === c.agent);
      agent.state = '발신중';
      const attempts = c.call ? c.call.attempts + 1 : 1;
      c.call = { dir: 'out', state: 'dialing', at: Date.now(), line: -1, lines: c.call ? c.call.lines : [], attempts };
      this.log(c, `아웃바운드 발신 ${attempts}회차 · ${CUSTOMER.phone}`, 'call');
      this.flow(c, [['ccw', 'cti', '발신 요청', `아웃바운드 ${attempts}회차`, { phone: CUSTOMER.phone, attempt: attempts }, 0], ['cti', 'phone', '발신', '고객 휴대폰 발신 중', null, 600]]);
      this.publish();
      const call = c.call;
      this.after(this.noAnswer ? 7000 : 3600, () => {
        if (c.call !== call || call.state !== 'dialing') return;
        if (this.noAnswer) return this.failed(c);
        call.state = 'connected';
        call.connectedAt = Date.now();
        agent.state = '상담중';
        c.retry = c.retry ? { ...c.retry, done: true } : null;
        this.log(c, '통화 연결', 'call');
        this.flow(c, [['phone', 'cti', '응답', '고객 응답 · 통화 연결 (녹취)', null, 0]]);
        this.publish();
        this.nextLine(c, 0, this.scripts.out);
      });
    }

    failed(c) {
      const agent = this.agents.find((a) => a.id === c.agent);
      c.call.state = 'failed';
      c.call.endedAt = Date.now();
      const used = c.call.attempts - 1;                       // redials used so far
      this.log(c, `연결 실패 · 고객 미응답 (${c.call.attempts}회차)`, 'warn');
      this.flow(c, [['cti', 'ccw', '미응답', `연결 실패 ${c.call.attempts}회차`, { attempt: c.call.attempts }, 0]]);
      if (c.call.attempts - 1 >= RETRIES) this.flow(c, [['ccw', 'sms', 'SMS', '3회 실패 → 고객 SMS 자동 발송', { to: CUSTOMER.phone }, 500], ['sms', 'phone', 'SMS', '고객 휴대폰 문자 수신', null]]);
      if (used >= RETRIES) {
        c.retry = { count: used, until: Date.now(), done: true };
        c.sms = true;
        c.contact = 2;
        agent.state = '상담대기';
        this.log(c, '3회 발신 모두 실패 → 시스템 SMS 자동 발송 완료 → 상담 완료 처리', 'alert');
        this.openSheet(c);
      } else {
        c.retry = { count: used, until: Date.now() + RETRY_WAIT };
        agent.state = '후처리중';
        this.log(c, `후처리중 · 남은 대기 시간 01:00 후 전화 재연결 가능 · 재시도 ${used}/${RETRIES}`, 'warn');
      }
      this.publish();
    }

    redial(c) {
      if (!c || !c.retry || c.retry.done || c.retry.until > Date.now() || (c.call && c.call.state === 'dialing')) return;
      c.retry.count += 1;
      this.log(c, `[전화 재연결] · 재시도 ${c.retry.count}/${RETRIES}`, 'call');
      this.dial(c);
    }

    nextLine(c, i, script) {
      const call = c.call;
      if (!call || call.state !== 'connected') return;
      if (i >= script.length) {
        this.after(1200, () => this.dispatch(c, true));
        this.after(2600, () => this.hangup(c));
        return;
      }
      call.line = i;
      call.lines.push({ ...script[i], t: Date.now() });
      this.publish();
      Link.send('say', { caseId: c.id, line: script[i], index: i });
      this.after(script[i].dur * 1000 + 700, () => { if (c.call === call) this.nextLine(c, i + 1, script); });
    }

    hangup(c) {
      if (!c || !c.call || c.call.state === 'ended' || c.call.state === 'failed') return;
      if (c.call.state === 'dialing') { c.call.state = 'failed'; c.call.endedAt = Date.now(); this.agents.find((a) => a.id === c.agent).state = '대기'; c.contact = 0; this.publish(); return; }
      c.call.state = 'ended';
      c.call.endedAt = Date.now();
      c.contact = Math.max(c.contact, 2);
      const agent = this.agents.find((a) => a.id === c.agent);
      if (agent) agent.state = '후처리중';
      this.log(c, `통화 종료 · ${mmss(c.call.endedAt - c.call.connectedAt)} · 후처리 (상담 메모)`, 'call');
      this.flow(c, [['ccw', 'cti', '통화 종료', `통화 ${mmss(c.call.endedAt - c.call.connectedAt)} · 후처리`, null, 0]]);
      this.openSheet(c);
      this.publish();
    }

    openSheet(c) {
      if (c.sheet) return;
      const d = new Date();
      c.memo.title = `긴급상담건_${CUSTOMER.name}_${ymd(d, '')}`;
      c.memo.callType = c.call && c.call.dir === 'in' ? '인바운드 콜' : '아웃바운드 콜';
      c.memo.text = c.sms
        ? `${c.warn.sys} 경고(주행 불가) 발생. 아웃바운드 3회 발신 실패로 SMS 자동 발송. 고객 회신 시 즉시 출동 및 입고 안내 필요.`
        : `${c.warn.sys} 경고(주행 불가) 발생. 고객 갓길 정차 확인, 비상등 점등 및 차량 밖 대기 안내. 현재 위치로 긴급출동 요청 완료, 견인 후 서비스센터 입고 필요.`;
      c.memo.request = '견인 입고 예정 차량입니다. 도착 즉시 진단 부탁드립니다.';
      c.sheet = { step: 1, open: true, at: Date.now() };
      this.log(c, '상담 메모(1) 바텀시트 · 상담 제목 자동 입력', 'info');
    }

    sheet(c, args) {
      if (!c || !c.sheet) return;
      if (args.step) c.sheet.step = Math.max(1, Math.min(3, args.step));
      if (args.open != null) c.sheet.open = !!args.open;
      this.publish();
    }

    dispatch(c, auto) {
      if (!c || c.kind !== 'emergency' || c.dispatch >= 0) return;
      c.dispatch = 0;
      this.log(c, `긴급출동 신고접수(출동접수)${auto ? ' · 상담 중 요청' : ''}`, 'alert');
      this.flow(c, [['ccw', 'rescue', '긴급출동', '마스터자동차 출동 요청 · 현재 위치', { caseId: c.id, vin: VEHICLE.vin, location: 'last received' }, 0]]);
      this.publish();
      [[4000, 1, '긴급출동 출동(목적지출발) · 도착 예정 12분'], [16000, 2, '긴급출동 도착(목적지도착) · 견인 준비'], [26000, 3, '긴급출동 출동완료 · 견인 후 서비스센터 이동']].forEach(([ms, k, text]) =>
        this.after(ms, () => {
          c.dispatch = k; this.log(c, text, 'alert'); this.publish();
          this.flow(c, [['rescue', 'ccw', '출동 상태', `${DISPATCH[k]}`, { status: DISPATCH[k] }, 0], ...(k === 1 ? [['ccw', 'car', 'MM 알림', '견인 차량 출동 · 도착 예정 12분', null]] : [])]);
        }));
    }

    /** Control panel shortcut: finish the call and the memo in one go. */
    complete(c) {
      if (!c || c.kind !== 'emergency') return;
      if (c.contact === 0 && !c.call) return;
      if (c.call && (c.call.state === 'connected' || c.call.state === 'dialing')) this.hangup(c);
      if (!c.sheet) { c.contact = Math.max(c.contact, 2); this.openSheet(c); }
      this.save(c);
    }

    save(c) {
      if (!c || !c.sheet || c.sheet.saved) return;
      c.sheet.saved = Date.now();
      c.sheet.open = false;
      c.dealer = c.memo.transfer ? c.memo.dealer : null;
      const agent = this.agents.find((a) => a.id === c.agent);
      if (agent) agent.state = '대기';
      this.consults.unshift({ id: c.id, at: c.at, updated: Date.now(), type: c.memo.callType || '아웃바운드 콜', title: c.memo.title, agent: agent ? agent.name : '', result: c.memo.transfer ? '이관 완료' : '상담 완료', dealer: c.dealer || '-', warn: c.warn.title, memo: c.memo.text, request: c.memo.request, memos: [] });
      if (c.memo.transfer) {
        c.contact = 3;
        c.dms = 0;
        this.log(c, `상담 메모 저장 · ${c.dealer} 전달 · DMS 전송 → 이관 완료`, 'flow');
        this.flow(c, [
          ['ccw', 'wam', '상담 메모', '상담 메모 저장 · 서비스센터 전달 ON', { title: c.memo.title, callType: c.memo.callType, sms: c.sms }, 0],
          ['wam', 'dms', 'WAM-MEMO-001', `상담 메모 전달 → ${c.dealer}`, { workflowId: c.group, centerName: c.dealer, memo: c.memo.text, request: c.memo.request, callSuccess: !c.sms }],
          ['dms', 'wam', 'DMS-SVC-002', '정비 상태 · 컨택대기', { workflowId: c.group, repairStatus: 'CONTACT_REQUIRED', repairStatusName: '컨택대기' }, 900],
        ]);
        this.dmsProgress(c, false);
      } else {
        c.contact = 2;
        this.log(c, '상담 메모 저장 · 서비스센터 전달 OFF · 상담 완료', 'flow');
      }
      this.publish();
    }

    snapshot() {
      return { cases: this.cases, active: this.active, agents: this.agents, consults: this.consults, noAnswer: this.noAnswer, general: this.general, scripts: this.scripts, flows: this.flows, skip: this.skip, now: Date.now() };
    }

    publish() { Link.send('ecare', this.snapshot()); }
  }

  function pad4(n) { return String(n).padStart(4, '0'); }
  const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => { const r = Math.random() * 16 | 0; return (ch === 'x' ? r : (r & 3) | 8).toString(16); });
  const defaults = () => JSON.parse(JSON.stringify(SCRIPTS));
  function loadScripts() {
    try { const v = JSON.parse(localStorage.getItem('ecare-scripts-v2')); if (v && v.out && v.in && v.gen) return v; } catch (e) { /* none saved */ }
    return defaults();
  }
  function saveScripts(v) { try { localStorage.setItem('ecare-scripts-v2', JSON.stringify(v)); } catch (e) { /* private mode */ } }

  window.ECare = { SLA, ASSIGN_TIMEOUT, RETRY_WAIT, RETRIES, WARN, CUSTOMER, VEHICLE, AGENTS, DEALERS, CALL_OUT, CALL_IN, CALL_GEN, SCRIPT_NAMES, WNG, CASE, CONTACT, DISPATCH, DMS, DMS_CODE, Director, hm, ymd, stamp, mmss };
})();
