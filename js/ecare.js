/* e-Care scenario: shared definitions and the case state machine.
 *
 * The vehicle simulator (index.html) is the director: it owns the case state,
 * advances it and broadcasts snapshots over Link. Other screens (call center,
 * transcript, later HU / OPW / DMS / data flow) render the snapshots and send
 * commands back. Flow follows the e-Care screen definition:
 *  red warning -> case (contact pending, SLA 25:00) -> [customer calls | 25 min
 *  pass -> auto-assign alert to an idle agent (05:00)] -> outbound call ->
 *  dispatch (report, dispatched, arrived, done) -> consultation done ->
 *  memo to the service center -> DMS transfer, handed over.
 *  amber warning -> maintenance case sent to the preferred dealer (DMS), no
 *  agent contact.
 */
(function () {
  'use strict';

  const SLA = 25 * 60 * 1000;
  const ASSIGN_TIMEOUT = 5 * 60 * 1000;

  // diagnostic codes and guidance per warning lamp
  const WARN = {
    brake: { dtc: 'C1241', sys: '브레이크', risk: '높음 · 즉시 정차', act: '즉시 안전한 곳에 정차 · 긴급출동 권장' },
    oil: { dtc: 'P0524', sys: '엔진 윤활', risk: '높음 · 엔진 손상 위험', act: '즉시 엔진 정지 · 견인 입고' },
    coolant: { dtc: 'P0217', sys: '냉각', risk: '높음 · 과열', act: '정차 후 냉각 · 견인 입고' },
    battery: { dtc: 'P0562', sys: '충전', risk: '중간 · 시동 꺼짐 위험', act: '가까운 서비스센터 입고' },
    airbag: { dtc: 'B0001', sys: 'SRS 에어백', risk: '높음 · 충돌 시 미작동', act: '서비스센터 즉시 점검' },
    door: { dtc: 'B1541', sys: '바디', risk: '중간', act: '도어 닫힘 확인' },
    engine: { dtc: 'P0301', sys: '엔진', risk: '중간 · 실화 감지', act: '정비 예약 권장' },
    abs: { dtc: 'C1201', sys: 'ABS', risk: '중간', act: '정비 예약 권장' },
    esp: { dtc: 'C1210', sys: 'VSC', risk: '중간', act: '정비 예약 권장' },
    gearbox: { dtc: 'P0700', sys: '변속기', risk: '중간', act: '정비 예약 권장' },
    brakepad: { dtc: 'C1300', sys: '브레이크 패드', risk: '낮음', act: '패드 교체 예약' },
    oillevel: { dtc: 'P250F', sys: '엔진 오일', risk: '낮음', act: '오일 보충 · 교환 예약' },
  };

  const CUSTOMER = { name: '홍길동', phone: '010-****-5678', grade: 'Lexus Premium', dealer: '서초 서비스센터' };
  const VEHICLE = { model: 'LEXUS GX 550 Overtrail+', vin: 'JTJ**********4417', plate: '12가 3456', color: 'Atomic Silver' };
  const AGENTS = [
    { id: 'a1', name: '김하늘', ext: '2101' },
    { id: 'a2', name: '이서준', ext: '2102' },
    { id: 'a3', name: '박지민', ext: '2103' },
  ];
  const DEALERS = [
    { name: '서초 서비스센터', km: 2.4, pref: true, open: true },
    { name: '강남 서비스센터', km: 3.8, open: true },
    { name: '용산 서비스센터', km: 6.1, open: true },
    { name: '송파 서비스센터', km: 7.9, open: false },
    { name: '분당 서비스센터', km: 12.6, open: true },
  ];
  // outbound call after 25 minutes (recorded Korean lines)
  const CALL_OUT = [
    { who: 'agent', text: '안녕하세요, e-Care 상담센터입니다. 홍길동 고객님 휴대폰 맞으신가요?', audio: 'assets/audio/ko_agent_001.wav', dur: 5.64 },
    { who: 'customer', text: '네, 맞아요.', audio: 'assets/audio/ko_customer_002.wav', dur: 1.88 },
    { who: 'agent', text: '25분 전 차량에서 브레이크 시스템 경고가 감지됐는데 연락이 없으셔서 먼저 전화드렸습니다. 지금 안전한 곳에 계신가요?', audio: 'assets/audio/ko_agent_003.wav', dur: 8.56 },
    { who: 'customer', text: '경황이 없어서 연락을 못 했어요. 갓길에 세워 뒀어요.', audio: 'assets/audio/ko_customer_004.wav', dur: 4.24 },
    { who: 'agent', text: '현재 위치로 긴급출동 차량을 바로 보내드리겠습니다. 비상등을 켜고 차 밖 안전한 곳에서 기다려 주세요.', audio: 'assets/audio/ko_agent_005.wav', dur: 7.36 },
  ];
  const CONTACT = ['컨택 전', '컨택 중', '상담 완료', '이관 완료'];
  const DISPATCH = ['신고접수', '출동', '도착', '출동완료'];
  const DMS = ['접수', '이관 확인', '예약 확정', '입고', '진단', '수리', '출고 준비', '출고 완료'];

  const pad = (n) => String(n).padStart(2, '0');
  const hm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

  /* ------------------------------------------------------------ director -- */
  class Director {
    constructor(getVehicle) {
      this.getVehicle = getVehicle;
      this.hooks = {};
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
      if (!silent) this.publish();
    }

    after(ms, fn) { this.timers.push(setTimeout(fn, ms)); }

    log(c, text, kind) { c.log.push({ t: Date.now(), text, kind: kind || 'info' }); }

    /** A warning lamp came on in the vehicle. */
    warning(level, item) {
      const v = this.getVehicle();
      const w = WARN[item.id] || { dtc: '—', sys: '—', risk: '—', act: item.desc };
      const id = `EC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(++this.seq).padStart(4, '0')}`;
      const c = {
        id, level, kind: level === 'red' ? 'emergency' : 'maintenance',
        warn: { id: item.id, title: item.title, desc: item.desc, ...w },
        at: Date.now(), slaBase: Date.now(), contact: 0, dispatch: -1, dms: -1,
        agent: null, call: null, assign: null, memo: '', transfer: true, dealer: DEALERS[0].name,
        loc: { odo: v.odoMeters, speed: v.speed }, log: [],
      };
      this.log(c, `차량 경고 감지 · ${item.title} (${w.dtc})`, level === 'red' ? 'alert' : 'warn');
      this.log(c, 'VDP(일본) 수신 → VEP(TSP, 한국) 판정', 'flow');
      if (c.kind === 'emergency') {
        this.log(c, 'VEP(TSP) → 콜센터 웹 · DMS 등록 / VDP → 고객 앱 · 차량 HU 알림', 'flow');
        this.log(c, 'SLA 시작 · 고객 연락 대기 25:00', 'sla');
        if (!this.active) this.active = id;
      } else {
        this.log(c, `정비 경고 · 상담원 미대응 · 선호 딜러(${c.dealer}) DMS 전송`, 'flow');
        c.contact = 3;
        c.dms = 0;
      }
      this.cases.unshift(c);
      this.publish();
    }

    find(id) { return this.cases.find((c) => c.id === (id || this.active)); }

    command(name, args) {
      const c = this.find(args.id);
      switch (name) {
        case 'reset': return this.reset();
        case 'select': if (c) { this.active = c.id; this.publish(); } return;
        case 'sla25': return this.sla25(c);
        case 'accept': return this.accept(c);
        case 'dispatch': return this.dispatch(c);
        case 'complete': return this.complete(c);
        case 'transfer': return this.transfer(c, args.dealer);
        case 'memo': if (c) { c.memo = args.text; this.publish(); } return;
        case 'toggleTransfer': if (c) { c.transfer = !c.transfer; this.publish(); } return;
        case 'dealer': if (c) { c.dealer = args.dealer; this.publish(); } return;
        default:
      }
    }

    /** Fast-forward: the customer has not called for 25 minutes. */
    sla25(c) {
      c = c || this.cases.find((x) => x.kind === 'emergency' && x.contact === 0);
      if (!c || c.kind !== 'emergency' || c.contact > 0 || c.assign) return;
      c.slaBase = Date.now() - SLA;
      const idle = this.agents.find((a) => a.state === '대기');
      this.log(c, 'SLA 25분 경과 · 고객 미연락 → 선제 아웃바운드', 'sla');
      if (!idle) { this.log(c, '유휴 상담사 없음 → SMS 콜백 문자 발송, 상담사 자동 할당 대기', 'warn'); this.publish(); return; }
      c.assign = { agent: idle.id, at: Date.now(), until: Date.now() + ASSIGN_TIMEOUT };
      this.log(c, `유휴 상담사 자동 배정 · ${idle.name} (${idle.ext}) · 응대 대기 05:00`, 'info');
      this.active = c.id;
      this.publish();
      Link.send('ccw-open-case', { id: c.id });
    }

    accept(c) {
      if (!c || c.kind !== 'emergency' || c.contact > 0) return;
      if (!c.assign) { c.slaBase = Math.min(c.slaBase, Date.now()); c.assign = { agent: 'a1', at: Date.now(), until: Date.now() + ASSIGN_TIMEOUT }; }
      const agent = this.agents.find((a) => a.id === c.assign.agent);
      agent.state = '통화 중';
      c.agent = agent.id;
      c.contact = 1;
      c.call = { state: 'dialing', at: Date.now(), line: -1, lines: [] };
      if (this.hooks.accept) this.hooks.accept(c);
      this.log(c, `${agent.name} 상담사 응대 시작 · 고객 휴대폰 발신 (${CUSTOMER.phone})`, 'call');
      this.publish();
      this.after(3200, () => {
        c.call.state = 'connected';
        c.call.connectedAt = Date.now();
        this.log(c, '통화 연결', 'call');
        this.publish();
        this.nextLine(c, 0);
      });
    }

    nextLine(c, i) {
      if (!c.call || c.call.state !== 'connected') return;
      if (i >= CALL_OUT.length) {
        this.after(1200, () => this.dispatch(c, true));
        this.after(2600, () => this.endCall(c));
        return;
      }
      c.call.line = i;
      c.call.lines.push({ ...CALL_OUT[i], t: Date.now() });
      this.publish();
      Link.send('say', { caseId: c.id, line: CALL_OUT[i], index: i });
      this.after(CALL_OUT[i].dur * 1000 + 700, () => this.nextLine(c, i + 1));
    }

    endCall(c) {
      if (!c.call || c.call.state === 'ended') return;
      c.call.state = 'ended';
      c.call.endedAt = Date.now();
      c.contact = 2;
      const agent = this.agents.find((a) => a.id === c.agent);
      if (agent) agent.state = '후처리';
      c.memo = c.memo || `[긴급] ${c.warn.title} (${c.warn.dtc})\n고객 갓길 정차 확인 · 비상등 점등 · 차량 밖 대기 안내\n긴급출동 요청 완료 · 견인 후 ${c.dealer} 입고 예정`;
      this.log(c, `통화 종료 · ${mmss(c.call.endedAt - c.call.connectedAt)} · 상담 완료`, 'call');
      this.publish();
    }

    dispatch(c, auto) {
      if (!c || c.kind !== 'emergency' || c.dispatch >= 0) return;
      c.dispatch = 0;
      this.log(c, `긴급출동 신고접수${auto ? ' (상담 중 요청)' : ''}`, 'alert');
      this.publish();
      [[4000, 1, '긴급출동 차량 출동 · 도착 예정 12분'], [16000, 2, '긴급출동 차량 현장 도착 · 견인 준비'], [26000, 3, '출동완료 · 견인 후 서비스센터 이동']].forEach(([ms, k, text]) =>
        this.after(ms, () => { c.dispatch = k; this.log(c, text, 'alert'); this.publish(); }));
    }

    complete(c) {
      if (!c) return;
      if (c.call && c.call.state !== 'ended') this.endCall(c);
      if (c.contact < 2) c.contact = 2;
      this.transfer(c);
    }

    transfer(c, dealer) {
      if (!c || c.contact >= 3) return;
      if (dealer) c.dealer = dealer;
      c.contact = 3;
      c.dms = 0;
      const agent = this.agents.find((a) => a.id === c.agent);
      if (agent) agent.state = '대기';
      this.log(c, c.transfer ? `상담 메모 → ${c.dealer} 전달 · DMS 전송 · 이관 완료` : '상담 완료 · 이관 없음', 'flow');
      this.publish();
      [[5000, 1], [11000, 2]].forEach(([ms, k]) => this.after(ms, () => { c.dms = k; this.log(c, `DMS · ${DMS[k]} (${c.dealer})`, 'flow'); this.publish(); }));
    }

    snapshot() {
      return { cases: this.cases, active: this.active, agents: this.agents, now: Date.now() };
    }

    publish() { Link.send('ecare', this.snapshot()); }
  }

  window.ECare = { SLA, ASSIGN_TIMEOUT, WARN, CUSTOMER, VEHICLE, AGENTS, DEALERS, CALL_OUT, CONTACT, DISPATCH, DMS, Director, hm, mmss };
})();
