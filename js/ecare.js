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
    { who: 'agent', text: '네, e-Care 상담센터입니다. 차량에서 경고가 확인되어 화면에 고객님 정보가 떠 있습니다.', dur: 5.4 },
    { who: 'customer', text: '계기판에 빨간 경고등이 들어왔어요. 계속 운전해도 되나요?', dur: 4.2 },
    { who: 'agent', text: '주행 불가 경고입니다. 가까운 안전한 곳에 정차하신 뒤 비상등을 켜 주세요. 지금 위치로 긴급출동을 접수하겠습니다.', dur: 7.2 },
    { who: 'customer', text: '네, 갓길에 세웠습니다. 감사합니다.', dur: 2.8 },
  ];
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
      if (!silent) this.publish();
    }

    after(ms, fn) { this.timers.push(setTimeout(fn, ms)); }

    log(c, text, kind) { c.log.push({ t: Date.now(), text, kind: kind || 'info' }); }

    me() { return this.agents[0]; }

    /** A warning lamp came on in the vehicle. */
    warning(level, item) {
      const v = this.getVehicle();
      const w = WARN[item.id] || { dtc: '—', sys: item.title, mid: item.title, risk: '—', act: item.desc };
      const id = `EC-${ymd(Date.now(), '')}-${pad4(++this.seq)}`;
      const c = {
        id, level, kind: level === 'red' ? 'emergency' : 'maintenance',
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
    }

    find(id) { return this.cases.find((c) => c.id === (id || this.active)); }
    live() { return this.cases.find((c) => c.kind === 'emergency' && c.contact < 3 && !(c.sheet && c.sheet.saved)); }

    command(name, args) {
      const c = this.find(args.id) || this.live();
      switch (name) {
        case 'reset': return this.reset();
        case 'select': if (c) { this.active = c.id; this.publish(); } return;
        case 'sla25': return this.sla25(c);
        case 'inbound': return this.inbound(c);
        case 'ack': return this.ack(c);
        case 'accept': return this.accept(c);
        case 'hangup': return this.hangup(c);
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
      const idle = this.agents.find((a) => a.state === '대기');
      this.log(c, 'SLA 25분 경과 · 인바운드 콜 없음 → 25분 자동 아웃바운드', 'sla');
      if (!idle) { this.log(c, '유휴 상담사 없음 → 고객 SMS 콜백 문자 발송, 유휴 상담사 발생 시 자동 할당', 'warn'); this.publish(); return; }
      c.assign = { agent: idle.id, at: Date.now(), until: Date.now() + ASSIGN_TIMEOUT };
      c.agent = idle.id;
      this.log(c, `유휴 상담사 자동 배정 · ${idle.name} (${idle.ext}) · 경고 알림 팝업 05:00`, 'info');
      this.active = c.id;
      this.publish();
      Link.send('ccw-open-case', { id: c.id });
    }

    /** A) the customer calls in (MM call through CTI). */
    inbound(c) {
      if (!c || c.kind !== 'emergency' || c.contact > 0 || c.inbound) return;
      const idle = this.agents.find((a) => a.state === '대기') || this.me();
      c.inbound = { at: Date.now(), agent: idle.id };
      c.agent = idle.id;
      c.assign = null;
      this.log(c, `고객 인바운드 콜 (MM 콜 · CTI) · ${CUSTOMER.phone} → ${idle.name} 상담원`, 'call');
      this.active = c.id;
      this.publish();
      Link.send('ccw-open-case', { id: c.id });
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
      this.publish();
      this.nextLine(c, 0, CALL_IN);
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
        this.publish();
        this.nextLine(c, 0, CALL_OUT);
      });
    }

    failed(c) {
      const agent = this.agents.find((a) => a.id === c.agent);
      c.call.state = 'failed';
      c.call.endedAt = Date.now();
      const used = c.call.attempts - 1;                       // redials used so far
      this.log(c, `연결 실패 · 고객 미응답 (${c.call.attempts}회차)`, 'warn');
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
      this.publish();
      [[4000, 1, '긴급출동 출동(목적지출발) · 도착 예정 12분'], [16000, 2, '긴급출동 도착(목적지도착) · 견인 준비'], [26000, 3, '긴급출동 출동완료 · 견인 후 서비스센터 이동']].forEach(([ms, k, text]) =>
        this.after(ms, () => { c.dispatch = k; this.log(c, text, 'alert'); this.publish(); }));
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
      this.consults.unshift({ id: c.id, at: Date.now(), type: c.memo.callType || '아웃바운드 콜', title: c.memo.title, agent: agent ? agent.name : '', result: c.memo.transfer ? '이관 완료' : '상담 완료', dealer: c.dealer || '-' });
      if (c.memo.transfer) {
        c.contact = 3;
        c.dms = 0;
        this.log(c, `상담 메모 저장 · ${c.dealer} 전달 · DMS 전송 → 이관 완료`, 'flow');
        [[6000, 1], [14000, 2]].forEach(([ms, k]) => this.after(ms, () => { c.dms = k; this.log(c, `DMS · ${DMS[k]} (${DMS_CODE[k]}) · ${c.dealer}`, 'flow'); this.publish(); }));
      } else {
        c.contact = 2;
        this.log(c, '상담 메모 저장 · 서비스센터 전달 OFF · 상담 완료', 'flow');
      }
      this.publish();
    }

    snapshot() {
      return { cases: this.cases, active: this.active, agents: this.agents, consults: this.consults, noAnswer: this.noAnswer, now: Date.now() };
    }

    publish() { Link.send('ecare', this.snapshot()); }
  }

  function pad4(n) { return String(n).padStart(4, '0'); }

  window.ECare = { SLA, ASSIGN_TIMEOUT, RETRY_WAIT, RETRIES, WARN, CUSTOMER, VEHICLE, AGENTS, DEALERS, CALL_OUT, CALL_IN, CONTACT, DISPATCH, DMS, DMS_CODE, Director, hm, ymd, stamp, mmss };
})();
