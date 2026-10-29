/* e-Care call center (CCW) screen, after the Global South Call Center Web GUI
 * (11.1.1.x popups, 11.2.1.1 e-Care 고객 응대, 11.3.1.x 상담 메모). Renders the
 * director's snapshots and sends the agent's actions back. Views: office
 * (photo with the live monitor), monitor, transcript (?view=transcript). */
(function () {
  'use strict';

  const E = window.ECare;
  const $ = (s, r) => (r || document).querySelector(s);
  const params = new URLSearchParams(location.search);
  const VIEW = params.get('view') || 'office';
  const IMG = { w: 1344, h: 752 }, SCR = { x: 425, y: 265, w: 489, h: 245 };
  const A = 'assets/ccw/';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  let snap = null;          // latest e-Care snapshot from the director
  let veh = null;           // latest vehicle state
  let lastVeh = 0;
  let soundOn = false;
  let renderedKey = '';
  let histTab = 'warn';
  let onlyOpen = true;
  let locFlash = 0;         // "현재 위치 새로고침" pressed

  document.body.className = VIEW === 'transcript' ? 'view-transcript' : VIEW === 'app' ? 'view-app' : 'view-office';

  /* ---------------- camera: office photo <-> monitor ---------------- */
  const stage = $('#stage');
  const cam = { z: VIEW === 'monitor' ? 1 : 0, to: VIEW === 'monitor' ? 1 : 0, from: 0, t0: 0, dur: 0 };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function camTo(z, dur) { cam.from = cam.z; cam.to = z; cam.t0 = performance.now(); cam.dur = dur; }
  function placeStage() {
    if (VIEW === 'app') {
      // the agent screen alone, filling the display (a dedicated TV)
      const k = Math.min(innerWidth / 1920, innerHeight / 960);
      app.style.transform = `translate(${((innerWidth - 1920 * k) / 2).toFixed(1)}px, ${((innerHeight - 960 * k) / 2).toFixed(1)}px) scale(${k.toFixed(5)})`;
      return;
    }
    if (cam.dur > 0) {
      const p = clamp((performance.now() - cam.t0) / cam.dur, 0, 1);
      cam.z = cam.from + (cam.to - cam.from) * ease(p);
      if (p >= 1) cam.dur = 0;
    }
    const vw = innerWidth, vh = innerHeight;
    const s0 = Math.max(vw / IMG.w, vh / IMG.h);
    // zoomed in, the monitor fills most of the view but the desk, the other
    // screens and the office around it stay in frame
    const s1 = Math.max(s0, Math.min(vw / SCR.w, vh / SCR.h) * 0.74);
    const s = Math.exp(Math.log(s0) + (Math.log(s1) - Math.log(s0)) * cam.z);
    const k = (s - s0) / (s1 - s0 || 1);
    const cx = IMG.w / 2 + (SCR.x + SCR.w / 2 - IMG.w / 2) * k;
    const cy = IMG.h / 2 + (SCR.y + SCR.h / 2 + 18 - IMG.h / 2) * k;
    let tx = vw / 2 - cx * s, ty = vh / 2 - cy * s;
    tx = clamp(tx, Math.min(vw - IMG.w * s, 0), Math.max(vw - IMG.w * s, 0));
    ty = clamp(ty, Math.min(vh - IMG.h * s, 0), Math.max(vh - IMG.h * s, 0));
    stage.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${s.toFixed(5)})`;
    $('#viewBtn').textContent = cam.to > 0.5 ? '사무실 보기' : '상담원 화면';
  }

  /* ---------------- link ---------------- */
  Link.on('ecare', (d) => { snap = d; render(); });
  Link.on('veh', (d) => { veh = d; lastVeh = Date.now(); });
  Link.on('ccw-open-case', () => { if (VIEW !== 'transcript' && cam.to < 0.5) camTo(1, 2600); render(true); });
  Link.on('say', (d) => { if (VIEW !== 'transcript') speak(d.line); });
  Link.on('ccw-noise', (d) => setNoise(d.on == null ? !noise.on : d.on));
  Link.on('@transport', () => conn());
  Link.send('hello', { screen: VIEW === 'transcript' ? 'transcript' : 'ccw' });
  const cmd = (name, args) => Link.send('cmd', { name, args: args || {} });

  function conn() {
    const ok = Date.now() - lastVeh < 2500;
    $('#conn').textContent = ok ? `● 차량 연결됨 · ${Link.transport === 'lan' ? 'LAN' : '이 PC'}` : '○ 차량 시뮬레이터 연결 대기';
    $('#conn').style.color = ok ? '#7fe7a8' : '#ffb46b';
  }

  /* ---------------- sound: call lines, alerts, ringback ---------------- */
  const audios = {};
  let actx = null;
  function ac() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function speak(line) {
    if (!soundOn) return;
    if (line.audio) {
      const a = audios[line.audio] || (audios[line.audio] = new Audio(line.audio));
      a.currentTime = 0;
      a.play().catch(() => {});
      return;
    }
    // inbound lines have no recording: the browser's Korean voice reads them
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(line.text);
    u.lang = 'ko-KR';
    u.rate = 1.04;
    u.pitch = line.who === 'agent' ? 1.15 : 0.85;
    const v = speechSynthesis.getVoices().filter((x) => /ko/i.test(x.lang));
    if (v.length) u.voice = v[line.who === 'agent' ? 0 : v.length - 1];
    speechSynthesis.speak(u);
  }
  function tone(freqs, dur, vol, at) {
    const c = ac();
    if (!c || !soundOn) return;
    const t = (at || c.currentTime) + 0.01;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.setValueAtTime(vol, t + dur - 0.03);
    g.gain.linearRampToValueAtTime(0, t + dur);
    g.connect(c.destination);
    freqs.forEach((f) => { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + dur + 0.02); });
  }
  const sfx = {
    popup() { const c = ac(); if (!c) return; [880, 1175, 1568].forEach((f, i) => tone([f], 0.16, 0.12, c.currentTime + i * 0.13)); },
    alarm() { const c = ac(); if (!c) return; for (let i = 0; i < 3; i++) tone([1250], 0.12, 0.14, c.currentTime + i * 0.18); },
    ring() { const c = ac(); if (!c) return; for (let i = 0; i < 10; i++) tone([1320, 1660], 0.045, 0.08, c.currentTime + i * 0.05); },
    ringback() { tone([440, 480], 1.0, 0.05); },
    save() { const c = ac(); if (!c) return; tone([660], 0.12, 0.1, c.currentTime); tone([990], 0.2, 0.1, c.currentTime + 0.12); },
  };

  function unlock() {
    if (soundOn) return;
    soundOn = true;
    $('#sound').classList.add('on');
    ac();
    E.CALL_OUT.forEach((l) => { const a = audios[l.audio] = new Audio(l.audio); a.preload = 'auto'; });
    if (noise.on && VIEW !== 'transcript') noise.start();
  }
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);
  $('#sound').addEventListener('click', unlock);

  /* ---------------- call center ambience (generated, no recordings) ------
   * Room tone and ventilation, a murmur of distant agents on calls (voiced
   * sources through moving formant filters, turn-taking), keyboards in
   * bursts and the odd phone ringing across the floor, all through a room
   * reverb. */
  const noise = {
    on: (() => { try { return localStorage.getItem('ccw-noise') !== 'off'; } catch (e) { return true; } })(),
    started: false,
    start() {
      const c = ac();
      if (!c || this.started) { this.level(); return; }
      this.started = true;
      const out = this.out = c.createGain();
      out.gain.value = 0;
      out.connect(c.destination);
      const sr = c.sampleRate;
      const buf = (sec, fill) => { const b = c.createBuffer(2, sr * sec, sr); for (let ch = 0; ch < 2; ch++) fill(b.getChannelData(ch)); return b; };
      const white = buf(3, (d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
      const brown = buf(5, (d) => { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.2; } });
      const verb = c.createConvolver();
      verb.buffer = buf(2.2, (d) => { for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2) * 0.55; });
      const wet = c.createGain(); wet.gain.value = 0.9;
      verb.connect(wet); wet.connect(out);
      const src = (b) => { const s = c.createBufferSource(); s.buffer = b; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 2); return s; };
      // room tone / HVAC
      const hv = src(brown), hvl = c.createBiquadFilter(), hvg = c.createGain();
      hvl.type = 'lowpass'; hvl.frequency.value = 420; hvg.gain.value = 0.16;
      hv.connect(hvl); hvl.connect(hvg); hvg.connect(out);
      const air = src(white), airf = c.createBiquadFilter(), airg = c.createGain();
      airf.type = 'bandpass'; airf.frequency.value = 900; airf.Q.value = 0.4; airg.gain.value = 0.012;
      air.connect(airf); airf.connect(airg); airg.connect(out);
      // distant voices
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2300;
      const voices = c.createGain(); voices.gain.value = 0.55;
      lp.connect(voices); voices.connect(verb); voices.connect(out);
      this.voices = [];
      for (let i = 0; i < 7; i++) {
        const male = Math.random() < 0.5;
        const f0 = male ? 105 + Math.random() * 30 : 190 + Math.random() * 45;
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f0;
        const vib = c.createOscillator(), vibg = c.createGain(); vib.frequency.value = 3 + Math.random() * 2; vibg.gain.value = f0 * 0.04;
        vib.connect(vibg); vibg.connect(o.frequency); vib.start();
        const og = c.createGain(); og.gain.value = 0.06;
        const n = src(white), ng = c.createGain(); ng.gain.value = 0.05;
        const f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter();
        f1.type = f2.type = 'bandpass'; f1.Q.value = 5; f2.Q.value = 7;
        f1.frequency.value = 600; f2.frequency.value = 1500;
        const env = c.createGain(); env.gain.value = 0;
        const pan = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
        if (pan.pan) pan.pan.value = Math.random() * 1.6 - 0.8;
        const dist = c.createGain(); dist.gain.value = 0.35 + Math.random() * 0.65;
        o.connect(og); og.connect(f1); og.connect(f2); n.connect(ng); ng.connect(f1); ng.connect(f2);
        f1.connect(env); f2.connect(env); env.connect(pan); pan.connect(dist); dist.connect(lp);
        o.start();
        this.voices.push({ o, f0, f1, f2, env, next: c.currentTime + Math.random() * 4, talk: Math.random() < 0.5 });
      }
      this.timer = setInterval(() => this.schedule(), 400);
      this.level();
    },
    schedule() {
      const c = actx;
      if (!c || c.state !== 'running') return;
      const now = c.currentTime;
      for (const v of this.voices) {
        if (v.next > now + 1.2) continue;
        let t = Math.max(v.next, now + 0.05);
        if (!v.talk) { v.talk = true; v.next = t + 0.6 + Math.random() * 2.8; continue; }
        // a phrase: 5-16 syllables, pitch falling toward the end
        const n = 5 + Math.floor(Math.random() * 12);
        for (let k = 0; k < n; k++) {
          const d = 0.09 + Math.random() * 0.17;
          const a = (0.35 + Math.random() * 0.65) * (k === n - 1 ? 0.6 : 1);
          v.env.gain.setTargetAtTime(a, t, 0.018);
          v.env.gain.setTargetAtTime(0.04, t + d, 0.03);
          const vowel = [[300, 2300], [400, 2000], [550, 1700], [700, 1200], [500, 900], [350, 800]][Math.floor(Math.random() * 6)];
          v.f1.frequency.setTargetAtTime(vowel[0] * (v.f0 > 150 ? 1.15 : 1), t, 0.02);
          v.f2.frequency.setTargetAtTime(vowel[1] * (v.f0 > 150 ? 1.12 : 1), t, 0.02);
          v.o.frequency.setTargetAtTime(v.f0 * (1.08 - 0.16 * k / n + (Math.random() - 0.5) * 0.06), t, 0.05);
          t += d + Math.random() * 0.05;
        }
        v.env.gain.setTargetAtTime(0, t, 0.05);
        v.next = t + 0.25 + Math.random() * (Math.random() < 0.3 ? 4 : 1.2);
        v.talk = Math.random() < 0.7;
      }
      // keyboards
      if (Math.random() < 0.16) {
        let t = now + Math.random() * 0.3;
        const keys = 4 + Math.floor(Math.random() * 22);
        const g0 = 0.02 + Math.random() * 0.05;
        const p = Math.random() * 1.6 - 0.8;
        for (let k = 0; k < keys; k++) { this.click(t, g0 * (0.6 + Math.random() * 0.6), p); t += 0.07 + Math.random() * 0.14; }
      }
      // a phone across the floor, now and then
      if (Math.random() < 0.012) {
        for (let r = 0; r < 2; r++) for (let i = 0; i < 16; i++) {
          const t = now + 0.2 + r * 2.4 + i * 0.05;
          const o = c.createOscillator(), g = c.createGain();
          o.frequency.value = i % 2 ? 1180 : 940;
          g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.006, t + 0.01); g.gain.linearRampToValueAtTime(0.0001, t + 0.048);
          o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.06);
        }
      }
    },
    click(t, gain, pan) {
      const c = actx;
      const b = c.createBuffer(1, Math.floor(c.sampleRate * 0.02), c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6);
      const s = c.createBufferSource(); s.buffer = b;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2500 + Math.random() * 2500; f.Q.value = 1.4;
      const g = c.createGain(); g.gain.value = gain;
      const p = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
      if (p.pan) p.pan.value = pan;
      s.connect(f); f.connect(g); g.connect(p); p.connect(this.out);
      s.start(t);
    },
    level() {
      if (!this.out || !actx) return;
      this.out.gain.setTargetAtTime(this.on && soundOn ? 0.62 : 0, actx.currentTime, 0.6);
    },
  };
  function setNoise(on) {
    noise.on = on;
    try { localStorage.setItem('ccw-noise', on ? 'on' : 'off'); } catch (e) { /* private mode */ }
    if (on && soundOn) noise.start();
    noise.level();
    noiseUi();
  }
  function noiseUi() {
    const b = $('#noiseBtn');
    b.textContent = noise.on ? '주변 소음 끄기' : '주변 소음 켜기';
    b.classList.toggle('off', !noise.on);
  }

  /* ---------------- helpers ---------------- */
  const active = () => snap && snap.cases.find((c) => c.id === snap.active);
  const agentOf = (c) => snap && c && snap.agents.find((a) => a.id === c.agent);
  const me = () => (snap ? snap.agents[0] : { name: '김상담', state: '대기' });
  const ROADS = ['테헤란로', '언주로', '선릉로', '봉은사로', '역삼로', '논현로'];
  function place(s) {
    const [x, y] = Road.pos(s);
    const road = ROADS[Math.floor(s / 1400) % ROADS.length];
    const no = 101 + 2 * Math.floor((s % 1400) / 23);
    const lat = (37.5003 + y / 111000).toFixed(6), lng = (127.0364 + x / 88200).toFixed(8);
    return { addr: `서울특별시 강남구 ${road} ${no}`, xy: `(X : ${lat}, Y : ${lng})` };
  }
  const drvOk = (c) => c.kind !== 'emergency';
  const shortStamp = (t) => E.stamp(t);

  /* ---------------- markup ---------------- */
  const LNB = [['가입 정보', 'join', false], ['상담 정보', 'consult'], ['서비스 가입 관리', 'service'], ['Service Log', 'log'], ['고객 응대', 'cs'], ['공지 사항', 'notice'], ['E-Call', 'ecall']];
  const linkSvg = '<svg viewBox="0 0 20 20" fill="none" stroke="#212121" stroke-width="1.5" stroke-linecap="round"><path d="M8.5 11.5l3-3"/><path d="M9.6 5.6l1.6-1.6a3.4 3.4 0 014.8 4.8l-1.6 1.6"/><path d="M10.4 14.4l-1.6 1.6a3.4 3.4 0 01-4.8-4.8l1.6-1.6"/></svg>';
  const searchSvg = '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#212121" stroke-width="1.6"><circle cx="9.5" cy="9.5" r="7"/><path d="M14.6 14.6l5.4 5.4" stroke-linecap="round"/></svg>';

  function gnb(c, onCase) {
    const st = c && onCase ? (agentOf(c) || me()).state : me().state;
    const f = onCase && c;
    const fld = (w, label, val) => `<div class="fld ${w} ${f ? 'on' : ''}"><span>${f ? esc(val) : label}</span><i></i></div>`;
    const stIcon = `<img src="${A}ic_message.svg" alt="">`;
    const cti = (on) => `<button class="cti">${on ? `<img src="${A}ic_disconnect.svg" alt="">CTI 연결 해제` : `${linkSvg}CTI 연결`}</button>`;
    let right;
    if (st === '발신중') right = `<span class="state">${stIcon}발신중</span><button class="bt" data-cmd="hangup">전화 끊기</button>${cti(true)}`;
    else if (st === '상담중') right = `<span class="state">${stIcon}상담중</span><button class="bt" data-cmd="hangup">전화 끊기</button><button class="bt ${c && c.call && c.call.hold ? 'on' : ''}" data-cmd="hold">보류</button>${cti(true)}`;
    else if (st === '후처리중') right = `<span class="state">${stIcon}후처리중</span>${cti(!!(c && c.retry && !c.retry.done))}`;
    else if (st === '상담대기') right = `<span class="state wait">${stIcon}상담 대기</span>${cti(true)}`;
    else right = `<button class="bt">전화 걸기</button>${cti(false)}`;
    return `<div class="brand"><img src="${A}toyota_logo.png" alt="TOYOTA"></div>
      <div class="gnb"><div class="fields">${fld('', '고객명', E.CUSTOMER.name)}${fld('w160', '휴대전화번호', E.CUSTOMER.phone)}${fld('w130', '차량번호', E.VEHICLE.plate)}${fld('', '차대번호', E.VEHICLE.vin)}
        <span class="ico">${f ? `<img src="${A}ic_refresh.svg" alt="" width="24">` : searchSvg}</span></div>
        <div class="right">${right}<span class="div"></span><span class="prof"><img src="${A}ic_profile.svg" alt=""><b>+</b></span></div></div>`;
  }

  function band(c) {
    if (!c || !c.retry) return '<div class="band"></div>';
    if (c.sms) return `<div class="band on"><span class="sms"><svg width="22" height="16" viewBox="0 0 22 16" fill="none" stroke="#2f6b1f" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8l5 5L20 2"/><path d="M8 8l2 2"/></svg>SMS 자동 발송 완료</span><span class="cnt"><svg width="30" height="30" viewBox="0 0 30 30"><path d="M8 5c-2 1-3 3-2 6 2 6 7 11 13 13 3 1 5 0 6-2l-4-4-3 2c-3-1-6-4-7-7l2-3z" fill="#111"/><path d="M4 26L26 4" stroke="#111" stroke-width="2.2"/></svg>재시도 횟수 ${c.retry.count}/${E.RETRIES} — 재연결 불가</span></div>`;
    if (c.retry.done) return '<div class="band"></div>';
    return `<div class="band on"><span class="wait">남은 대기 시간<b data-wait>01:00</b></span><button class="re" data-cmd="redial" data-re>전화 재연결</button><span class="cnt">재시도 횟수 ${c.retry.count}/${E.RETRIES}</span></div>`;
  }

  function lnb() {
    return `<nav class="lnb">${LNB.map(([n, k, ar]) => `<div class="it"><img src="${A}lnb_${k}.svg" alt="">${n}${ar === false ? '' : `<img class="ar" src="${A}arrow_white.svg" alt="">`}</div>`).join('')}
      <div class="grp"><div class="it"><img src="${A}lnb_ecare.svg" alt="">e-Care<img class="ar up" src="${A}arrow_white.svg" alt=""></div>
      <div class="sub on">e-Care 고객 응대</div><div class="sub dim">e-Care 상담 이력</div></div></nav>`;
  }

  function vcard(c) {
    const st = c && c.dms >= 0 ? E.DMS[c.dms] : '-';
    return `<div class="box vcard"><div class="r1"><small>차량 정보</small><span class="plate">${E.VEHICLE.plate}</span><span class="model">${E.VEHICLE.model} / ${E.VEHICLE.year}</span><span class="tg">${E.VEHICLE.brand}</span><span class="vin">VIN: ${E.VEHICLE.vin}</span></div>
      <div class="r2"><span>고객명:<b>${E.CUSTOMER.name}</b></span><span>휴대전화번호:<b>${E.CUSTOMER.phone}</b></span><span>선호 센터:<b>${E.DEALERS[0].name}</b></span><span class="sep">|</span><span>처리 센터:<b>${esc(c && c.dealer ? c.dealer : '-')}</b></span>
      <span>상태: ${st === '-' ? '<b>-</b>' : `<span class="tg" style="margin-left:6px"><img src="${A}ic_wrench.svg" alt="" width="12">${st}</span>`}</span><button class="chipbt"><img src="${A}ic_refresh_s.svg" alt="" width="11">상태 새로고침</button></div></div>`;
  }

  function locCard(c) {
    const first = place(c.loc.odo);
    const last = place(veh ? veh.odoMeters : c.loc.odo);
    const canDisp = c.dispatch < 0 && c.contact >= 1;
    const steps = c.dispatch >= 0 ? `<span class="dsteps">${E.DISPATCH.map((n, i) => `<i class="${i < c.dispatch ? 'done' : i === c.dispatch ? 'on' : ''}">${n}</i>`).join('')}</span>` : '';
    return `<div class="box loc"><div class="hd"><img src="${A}ic_car.svg" alt="">고객 차량 위치 정보<span class="disp">${steps}<button class="bt-red" data-cmd="dispatch" ${canDisp ? '' : 'disabled'}>${c.dispatch >= 0 ? '출동 요청됨' : '긴급 출동'}</button></span></div>
      <table><tr><td class="k red">최초 고장 발생 위치</td><td class="v">${first.addr}<br>${first.xy}</td><td class="b"></td></tr>
      <tr><td class="k grn">마지막 수신 위치<img src="${A}ic_help.svg" alt=""></td><td class="v" data-lastloc>${last.addr}<br>${last.xy}</td><td class="b"><button class="bt-line" data-refresh><img src="${A}ic_refresh.svg" alt="">현재 위치 새로고침</button></td></tr></table></div>`;
  }

  function wpanel(c) {
    const cs = snap.cases;
    const red = cs.filter((x) => !drvOk(x)).length;
    const first = cs.length ? cs[cs.length - 1].at : c.at;
    return `<div class="wpanel"><div class="hd"><h3>차량 경고 정보 <em>실시간</em></h3><p>경고 최초 발생 일시: ${shortStamp(first)}</p>
      <div class="cnt"><b>총 ${cs.length}건</b><span>주행 불가 ${red}</span><span>주행 가능 ${cs.length - red}</span></div></div>
      <div class="wlist">${cs.slice(0, 3).map((x, i) => `<div class="witem ${i === 0 ? 'top' : ''}">
        <div class="h"><span class="ic">${x.warn.id === 'engine' ? `<img src="${A}ic_engine.png" alt="">` : x.warn.id === 'oillevel' ? `<img src="${A}ic_drop.svg" alt="">` : `<canvas data-wicon="${x.warn.id}" width="56" height="56"></canvas>`}</span>
          <div><b>${esc(x.warn.title)}</b>${i === 0 ? '<span class="new">NEW</span>' : ''}</div><span class="drv ${drvOk(x) ? 'ok' : ''}">${drvOk(x) ? '주행 가능' : '주행 불가'}</span></div>
        <dl><dt>발생일시</dt><dd>${shortStamp(x.at)}</dd><dt>상담 안내</dt><dd>${esc(x.warn.act)}</dd></dl>
        <div class="mid-t"><span>MID 메시지 · 고객 안내 문구</span><img src="${A}${i === 0 ? 'chev_up' : 'chev_down'}.svg" alt=""></div>
        ${i === 0 ? `<div class="midbox"><small>MID 메시지</small><p>${esc(x.warn.mid)}</p><small>고객 안내 문구</small><p style="margin:0">${esc(x.warn.desc)}</p></div>` : ''}</div>`).join('')}</div></div>`;
  }

  const OLD_WARN = [['2025-11-11 10:54:24', '긴급', '에어백 시스템', '강남 서비스센터', '종결'], ['2024-12-12 10:54:24', '경고', '워셔액 부족', '강남 서비스센터', '종결']];
  const OLD_CONSULT = [['2025-11-11 11:02:10', '인바운드 콜', '긴급상담건_홍길동_20251111', '이서준', '이관 완료', '강남 서비스센터'], ['2024-12-12 11:20:41', '아웃바운드 콜', '정비안내_홍길동_20241212', '박지민', '상담 완료', '-']];
  function hist() {
    const cs = snap.cases;
    let body;
    if (histTab === 'warn') {
      const rows = cs.map((x, i) => [cs.length - i + 2, shortStamp(x.at), x.kind === 'emergency' ? '긴급' : '경고', x.warn.title, x.dealer || '-', x.dms >= 0 ? E.DMS[x.dms] : '-', x.kind === 'emergency' && x.contact < 3])
        .concat(OLD_WARN.map((r, i) => [2 - i, ...r, false])).slice(0, 3);
      body = `<thead><tr><th style="width:86px">No.</th><th style="width:196px">이벤트 발생 일시</th><th style="width:106px">경고 등급</th><th>경고등명</th><th style="width:238px">처리 센터</th><th style="width:238px">서비스센터 처리 상태</th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="${r[6] ? 'hot' : ''}"><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td class="l">${esc(r[3])}</td><td>${esc(r[4])}</td><td>${r[5]}</td></tr>`).join('')}</tbody>`;
    } else {
      const rows = (snap.consults || []).map((x, i) => [snap.consults.length - i + 2, shortStamp(x.at), x.type, x.title, x.agent, x.result, x.dealer]).concat(OLD_CONSULT.map((r, i) => [2 - i, ...r])).slice(0, 3);
      body = `<thead><tr><th style="width:86px">No.</th><th style="width:196px">상담 일시</th><th style="width:130px">전화 타입</th><th>상담 제목</th><th style="width:120px">상담원</th><th style="width:140px">처리 결과</th><th style="width:200px">처리 센터</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td class="l">${esc(r[3])}</td><td>${esc(r[4])}</td><td>${r[5]}</td><td>${esc(r[6])}</td></tr>`).join('')}</tbody>`;
    }
    return `<div class="box hist"><div class="hd"><span class="tab ${histTab === 'warn' ? 'on' : ''}" data-tab="warn">경고등 이력</span><span class="tab ${histTab === 'consult' ? 'on' : ''}" data-tab="consult">상담 이력</span><button class="more">전체보기</button></div><table class="grid">${body}</table></div>`;
  }

  function sheet(c) {
    if (!c.sheet || c.sheet.saved) return '';
    const m = c.memo;
    const open = c.sheet.open;
    let inner;
    if (c.sheet.step === 1) {
      inner = `<div class="s1"><label>상담 제목<i>*</i></label><input data-in="title" maxlength="100" value="${esc(m.title)}" placeholder="제목 입력">
        <div class="side"><div>서비스 센터로 상담 메모 전달<span class="req">*</span></div><div class="tog ${m.transfer ? '' : 'off'}" data-toggle><span>${m.transfer ? 'ON' : 'OFF'}</span><i></i></div><div class="lb">전화타입</div><span class="ro">${esc(m.callType)}</span></div>
        <label>상담 내용<i>*</i></label><textarea data-in="text" maxlength="1000" placeholder="상담 내용을 입력하세요.">${esc(m.text)}</textarea></div>
        <div class="foot"><button class="bt-dark" data-step="${m.transfer ? 2 : 3}">다음</button></div>`;
    } else if (c.sheet.step === 2) {
      const list = E.DEALERS.filter((d) => !onlyOpen || d.open === '영업중' || d.name === m.dealer);
      inner = `<div class="s2"><h4>서비스센터 선택</h4><p>마지막 수신 위치: ${place(veh ? veh.odoMeters : c.loc.odo).addr}</p>
        <div class="srch">${searchSvg}<span class="q">서비스 센터명/주소/전화번호 검색</span><span class="only ${onlyOpen ? '' : 'off'}" data-only>업무중만 보기<i>✓</i></span></div>
        <table class="grid"><thead><tr><th style="width:82px">No.</th><th>서비스 센터명</th><th style="width:104px">브랜드</th><th style="width:104px">영업상태</th><th style="width:116px">거리(km)</th><th>주소</th><th style="width:196px">대표전화</th><th style="width:196px">운영 시간</th></tr></thead>
        <tbody>${list.map((d) => `<tr class="${d.name === m.dealer ? 'sel' : ''}" data-dealer="${esc(d.name)}"><td><span class="radio ${d.name === m.dealer ? 'on' : ''}"></span></td><td>${d.pref ? '[고객 선호] ' : ''}${esc(d.name)}</td><td>${d.brand}</td><td>${d.open}</td><td>${d.km}</td><td>${d.addr}</td><td>${d.tel}</td><td>${d.hours}</td></tr>`).join('')}</tbody></table>
        <div class="foot"><button class="bt-white" data-step="1">이전</button><button class="bt-dark" data-step="3">다음</button></div></div>`;
    } else {
      const d = E.DEALERS.find((x) => x.name === m.dealer) || E.DEALERS[0];
      inner = `<h4>상담내역 확인하기</h4><div class="s3">
        <dl><dt>고객명</dt><dd>${E.CUSTOMER.name}</dd><dt>고객 연락처</dt><dd>${E.CUSTOMER.phone}</dd><dt>상담 고객명</dt><dd class="box2">${esc(m.name)}</dd><dt>상담 고객 연락처</dt><dd class="box2">${esc(m.phone)}</dd><dt>차대번호 (VIN)</dt><dd>${E.VEHICLE.vin}</dd><dt>경고 발생 시각</dt><dd>${shortStamp(c.at)}</dd></dl>
        <div class="c2">경고 유형<div class="types">${snap.cases.filter((x) => x.kind === 'emergency').slice(0, 2).map((x, i) => `#${i + 1} <a>${esc(x.warn.title)}</a> 주행 불가`).join('&nbsp;&nbsp;&nbsp;')}</div>상담 내용<div class="txt">${esc(m.text)}</div></div>
        <div class="c3">${m.transfer ? `<h5>선택 서비스 센터</h5><dl><dt>선택 센터</dt><dd>${esc(d.name)}${d.pref ? '' : '<span class="badge-r">고객 선호 센터 불일치</span>'}</dd><dt>주소</dt><dd>${d.addr.replace('서울특별시 ', '')} (${d.km}km)</dd><dt>대표번호</dt><dd>${d.tel}</dd><dt>영업시간</dt><dd>${d.hours}</dd></dl>
          <div class="note">서비스 센터 요청 사항 (센터 변경 사유 포함)</div><textarea data-in="request">${esc(m.request)}</textarea>` : '<h5>서비스 센터 전달 OFF</h5><p style="color:#58595b;font-size:15px">상담 메모는 운영 DB에만 저장되며 서비스 센터로 전달되지 않습니다.</p>'}</div></div>
        <div class="foot"><button class="bt-white" data-step="${m.transfer ? 2 : 1}">이전</button><button class="bt-dark" data-save>저장</button></div>`;
    }
    return `<div class="sheet ${open ? '' : 'closed'}"><button class="tabh" data-sheet>상담정보<img class="${open ? '' : 'dn'}" src="${A}arrow_white.svg" alt="" style="transform:rotate(${open ? 180 : 0}deg)"></button><div class="in">${inner}</div></div>`;
  }

  function casePage(c) {
    return `<div class="ptitle"><h2>e-Care 고객 응대</h2><span class="crumb">e-Care <svg width="8" height="10" viewBox="0 0 8 10"><path d="M2 1l4 4-4 4" stroke="#212121" fill="none"/></svg> e-Care 고객 응대</span></div>
      ${vcard(c)}
      <div class="mid"><div class="left">${locCard(c)}<div class="map"><canvas data-map></canvas><img class="zoom" src="${A}map_zoom.svg" alt=""><span class="gps">GPS 환경에 따라 실제 위치와 차이가 있을 수 있습니다</span></div></div>${wpanel(c)}</div>
      ${hist()}${sheet(c)}${c.sheet && c.sheet.saved && Date.now() - c.sheet.saved < 5000 ? `<div class="toast"><i>✓</i>상담 메모 저장 및 DMS 전송 완료${c.dealer ? ` · ${esc(c.dealer)}` : ''}</div>` : ''}`;
  }

  function homePage() {
    const cs = snap ? snap.cases : [];
    const live = cs.filter((c) => c.kind === 'emergency' && c.contact === 0);
    const rows = cs.map((c) => [c.id, shortStamp(c.at), c.kind === 'emergency' ? '긴급' : '경고', c.warn.title, E.CONTACT[c.contact], c]).concat([
      ['EC-20261028-0038', '2026-10-28 13:42:10', '긴급', '브레이크 시스템', '이관 완료'],
      ['EC-20261028-0035', '2026-10-28 11:05:52', '경고', '엔진점화 이상', '이관 완료'],
      ['EC-20261027-0031', '2026-10-27 18:20:03', '긴급', '엔진 냉각 시스템', '상담 완료'],
    ]).slice(0, 8);
    return `<div class="ptitle"><h2>e-Care 상담 이력</h2><span class="crumb">e-Care <svg width="8" height="10" viewBox="0 0 8 10"><path d="M2 1l4 4-4 4" stroke="#212121" fill="none"/></svg> e-Care 상담 이력</span></div>
      <div class="idle" style="margin-top:0"><div class="box k"><small>오늘 e-Care 경고</small><b>${12 + cs.length}</b><span>긴급 ${3 + cs.filter((c) => c.kind === 'emergency').length} · 경고 ${9 + cs.filter((c) => c.kind !== 'emergency').length}</span></div>
        <div class="box k"><small>컨택 전 (SLA 25분)</small><b class="${live.length ? 'slat' : ''}">${live.length}</b><span>25분 경과 시 자동 아웃바운드</span></div>
        <div class="box k"><small>평균 응대 시간</small><b>03:12</b><span>SLA 준수율 98.6%</span></div>
        <div class="box k"><small>상담원 상태</small><b>${snap ? snap.agents.filter((a) => a.state === '대기').length : 3} / 3</b><span>대기 상담원 · 자동 배정 ON</span></div></div>
      <div class="box listbox" style="margin-top:14px"><div class="hd"><h3>e-Care 상담 목록</h3><small>VEP(TSP) 실시간 연동 · 고객 인바운드 대기 25분</small></div>
      <table class="grid"><thead><tr><th style="width:220px">케이스</th><th style="width:220px">경고 발생 일시</th><th style="width:110px">경고 등급</th><th>경고등명</th><th style="width:150px">고객명</th><th style="width:170px">처리 상태</th><th style="width:190px">SLA 잔여</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r[5] && r[5].kind === 'emergency' && r[5].contact === 0 ? 'hot' : ''}"><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td class="l">${esc(r[3])}</td><td>${E.CUSTOMER.name}</td><td>${r[4]}</td><td>${r[5] && r[5].kind === 'emergency' && r[5].contact === 0 ? `<span class="slat" data-sla="${r[0]}"></span>` : '-'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function popup(c) {
    if (!c || c.contact > 0) return '';
    const cust = `<div class="cust">고객명 : ${E.CUSTOMER.name}<br>연락처 : ${E.CUSTOMER.phone}<br>차량번호: ${E.VEHICLE.plate}</div>`;
    if (c.inbound && !c.call) {
      return `<div class="ov"><div class="pop"><div class="txt"><div class="ttl"><img class="ring" src="${A}ic_siren.svg" alt="">전화가 왔습니다.</div>
        <div class="cen">경고등명: <b>${esc(c.warn.sys)}</b><br>운전 가능 여부: <b>주행 불가</b><br>고객명 : <b>${E.CUSTOMER.name}</b><br>차량번호: <b>${E.VEHICLE.plate}</b></div></div>
        <button class="go" data-cmd="ack">확인</button></div></div>`;
    }
    if (c.assign && !c.assign.done) {
      return `<div class="ov"><div class="pop"><div class="txt"><div class="ttl"><img class="ring" src="${A}ic_siren.svg" alt="">고객 차량에서 경고 발생</div>
        <div class="timer" data-timer><div class="l"><span data-tl>잔여 시간</span><em>콜 대기 중</em></div><b data-cd>05:00</b></div>
        <div class="info">경고등명: <b>${esc(c.warn.sys)}</b><br>운전 가능 여부: <b>주행 불가</b><br>최초 감지: <b>${shortStamp(c.at).slice(0, 16)}</b></div>${cust}</div>
        <button class="go" data-cmd="accept">전화 걸기</button></div></div>`;
    }
    return '';
  }

  /* ---------------- render ---------------- */
  const app = $('#app');
  let lastPopup = '';
  function onCasePage(c) { return !!(c && (c.call || c.sheet || c.sms || (c.retry && !c.retry.done))); }

  function render(force) {
    if (VIEW === 'transcript') return renderTranscript();
    if (!snap) return;
    const c = active();
    const onCase = onCasePage(c);
    const pk = c ? (c.inbound && !c.call ? 'in' : c.assign && !c.assign.done && c.contact === 0 ? 'warn' : '') : '';
    if (pk && pk !== lastPopup) { pk === 'in' ? sfx.ring() : sfx.popup(); }
    lastPopup = pk;
    const key = JSON.stringify([onCase, histTab, onlyOpen, pk, c && [c.id, c.contact, c.dispatch, c.dms, c.dealer, c.assign && c.assign.at, c.call && [c.call.state, c.call.hold, c.call.attempts], c.retry, c.sms, c.sheet, c.memo, c.log.length],
      snap.cases.length, snap.agents.map((a) => a.state), (snap.consults || []).length]);
    if (!force && key === renderedKey) return;
    // keep the agent's typing: no re-render while an input in the app has focus
    const f = document.activeElement;
    if (!force && f && app.contains(f) && f.matches('input,textarea')) return;
    renderedKey = key;
    app.innerHTML = `<div class="ccw">${gnb(c, onCase)}${band(onCase ? c : null)}${lnb()}<main class="page">${onCase ? casePage(c) : homePage()}</main></div>${popup(c)}`;
    app.querySelectorAll('[data-wicon]').forEach((cv) => {
      const g = cv.getContext('2d');
      SimIcons.drawIcon(g, cv.dataset.wicon, 28, 28, 40, '#3f322e', null);
    });
    if (c && c.sheet && c.sheet.saved && Date.now() - c.sheet.saved < 5000) { setTimeout(() => render(true), 5100 - (Date.now() - c.sheet.saved)); }
    tick();
  }

  app.addEventListener('click', (e) => {
    const c = active();
    const t = e.target.closest('[data-cmd],[data-tab],[data-step],[data-save],[data-sheet],[data-toggle],[data-dealer],[data-only],[data-refresh]');
    if (!t) return;
    unlock();
    const id = c && c.id;
    if (t.dataset.cmd) {
      if (t.disabled) return;
      if (t.dataset.cmd === 'redial' && !t.classList.contains('go')) return;
      cmd(t.dataset.cmd, { id });
    }
    if (t.dataset.tab) { histTab = t.dataset.tab; render(true); }
    if (t.dataset.step) {
      const n = +t.dataset.step;
      if (n > c.sheet.step && c.sheet.step === 1 && (!c.memo.title.trim() || !c.memo.text.trim())) return;
      flushMemo();
      cmd('sheet', { id, step: n });
    }
    if (t.dataset.save != null && t.hasAttribute('data-save')) { flushMemo(); cmd('save', { id }); sfx.save(); }
    if (t.hasAttribute('data-sheet')) cmd('sheet', { id, open: !c.sheet.open });
    if (t.hasAttribute('data-toggle')) cmd('memo', { id, memo: { transfer: !c.memo.transfer } });
    if (t.dataset.dealer) cmd('memo', { id, memo: { dealer: t.dataset.dealer } });
    if (t.hasAttribute('data-only')) { onlyOpen = !onlyOpen; render(true); }
    if (t.hasAttribute('data-refresh')) locFlash = Date.now();
  });
  let memoBuf = {}, memoT = 0;
  function flushMemo() {
    const c = active();
    if (!c || !Object.keys(memoBuf).length) return;
    cmd('memo', { id: c.id, memo: memoBuf });
    memoBuf = {};
  }
  app.addEventListener('input', (e) => {
    const k = e.target.dataset && e.target.dataset.in;
    if (!k) return;
    memoBuf[k] = e.target.value;
    clearTimeout(memoT);
    memoT = setTimeout(flushMemo, 250);
  });
  app.addEventListener('focusout', () => setTimeout(() => { flushMemo(); render(); }, 0));

  /* ---------------- live values (4x a second) ---------------- */
  let hotBeep = 0;
  function tick() {
    const c = active();
    if (c && snap) {
      const cd = $('[data-cd]', app);
      if (cd && c.assign) {
        const left = c.assign.until - Date.now();
        const over = left <= 0;
        cd.textContent = over ? `+${E.mmss(-left)}` : E.mmss(left);
        $('[data-tl]', app).textContent = over ? '초과 시간' : '잔여 시간';
        const hot = left < 60000;
        $('[data-timer]', app).classList.toggle('hot', hot);
        if (hot && Date.now() - hotBeep > 2000) { hotBeep = Date.now(); sfx.alarm(); }
      }
      if (c.inbound && !c.call && Date.now() - hotBeep > 3000) { hotBeep = Date.now(); sfx.ring(); }
      if (c.call && c.call.state === 'dialing' && Date.now() - (tick.rb || 0) > 3000) { tick.rb = Date.now(); sfx.ringback(); }
      const w = $('[data-wait]', app);
      if (w && c.retry) {
        const dialing = c.call && c.call.state === 'dialing';
        const left = dialing ? E.RETRY_WAIT : c.retry.until - Date.now();
        w.textContent = E.mmss(left);
        w.classList.toggle('zero', !dialing && left <= 0);
        $('[data-re]', app).classList.toggle('go', !dialing && left <= 0);
      }
    }
    const ll = $('[data-lastloc]', app);
    if (ll && veh) {
      const p = place(veh.odoMeters);
      const html = `${p.addr}<br>${p.xy}`;
      if (ll.innerHTML !== html) ll.innerHTML = html;
      ll.style.background = Date.now() - locFlash < 600 ? '#eef8f1' : '';
    }
    if (snap) app.querySelectorAll('[data-sla]').forEach((el) => {
      const x = snap.cases.find((y) => y.id === el.dataset.sla);
      if (x) { const l = E.SLA - (Date.now() - x.slaBase); el.textContent = l >= 0 ? E.mmss(l) : `+${E.mmss(-l)}`; }
    });
    conn();
  }
  setInterval(tick, 250);

  /* ---------------- live map (GUI map tone, top-down) ---------------- */
  let mapT = 0;
  const pinR = new Image(); pinR.src = `${A}pin_red.svg`;
  const pinG = new Image(); pinG.src = `${A}pin_green.svg`;
  function drawMap(t) {
    const cv = $('[data-map]', app);
    const c = active();
    if (!cv || !c) return;
    const r = cv.getBoundingClientRect();
    const W = cv.offsetWidth, H = cv.offsetHeight;
    const k = clamp((r.width / W || 1) * (window.devicePixelRatio || 1), 0.4, 2.5);   // the app is scaled; draw at screen resolution
    if (cv.width !== Math.round(W * k)) { cv.width = Math.round(W * k); cv.height = Math.round(H * k); }
    const g = cv.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = '#f1efe9';
    g.fillRect(0, 0, W, H);
    const s = veh ? veh.odoMeters : c.loc.odo;
    const sf = c.loc.odo;
    const [ax, ay] = Road.pos(sf), [bx, by] = Road.pos(s);
    const cx = (ax + bx) / 2, cy = (ay + by) / 2;
    const m = clamp(Math.min((W - 160) / (Math.abs(bx - ax) + 1), (H - 90) / (Math.abs(by - ay) + 1)), 0.22, 1.1);
    const P = (X, Y) => [W / 2 + (X - cx) * m, H / 2 + 14 - (Y - cy) * m];
    const span = Math.max(W, H) / m;
    const s0 = Math.min(s, sf) - span * 0.7, s1 = Math.max(s, sf) + span * 0.7;
    grid(g, P, cx, cy, W, H, m);
    for (const b of Road.city(s0, s1)) {
      const pts = [Road.at(b.S0, b.l0), Road.at(b.S1, b.l0), Road.at(b.S1, b.l1), Road.at(b.S0, b.l1)].map(([X, Y]) => P(X, Y));
      g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath();
      g.fillStyle = b.kind === 'park' ? '#cfe6c4' : b.lm ? '#e3e1ea' : '#e9e4db';
      g.fill();
      g.strokeStyle = b.kind === 'park' ? '#b5d6a6' : '#d8d1c5';
      g.lineWidth = 1;
      g.stroke();
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const S of Road.streets(s0, s1)) {
      for (const side of [-1, 1]) {
        const a = P(...Road.at(S, side * 8)), b = P(...Road.at(S, side * 140));
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
        g.strokeStyle = '#ddd6ca'; g.lineWidth = Math.max(3, 9 * m); g.stroke();
        g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(2, 7 * m); g.stroke();
      }
    }
    const path = () => { g.beginPath(); for (let S = s0; S <= s1; S += 8) { const p = P(...Road.pos(S)); S === s0 ? g.moveTo(p[0], p[1]) : g.lineTo(p[0], p[1]); } };
    path(); g.strokeStyle = '#e2b066'; g.lineWidth = Math.max(6, 17 * m); g.stroke();
    path(); g.strokeStyle = '#f7d48c'; g.lineWidth = Math.max(4, 13 * m); g.stroke();
    // dispatch vehicle on its way
    if (c.dispatch >= 1) {
      const lg = c.log.find((e) => e.text.startsWith('긴급출동 출동'));
      const p = c.dispatch >= 2 ? 1 : clamp((Date.now() - (lg ? lg.t : Date.now())) / 12000, 0, 1);
      const q = P(...Road.at(s - 600 * (1 - p) - 12, -3));
      g.fillStyle = '#ff7a00'; g.beginPath(); g.arc(q[0], q[1], 10, 0, Math.PI * 2); g.fill();
      g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke();
      g.fillStyle = '#fff'; g.font = '700 10px Pretendard, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('출동', q[0], q[1] + 0.5);
    }
    const pin = (img, X, Y, label, col, pulse) => {
      const [px, py] = P(X, Y);
      if (pulse) {
        const f = (t / 1000) % 1.6 / 1.6;
        g.beginPath(); g.arc(px, py, 6 + f * 26, 0, Math.PI * 2);
        g.fillStyle = `rgba(0,123,84,${0.3 * (1 - f)})`; g.fill();
      }
      if (img.complete && img.naturalWidth) g.drawImage(img, px - 10, py - 25, 20, 25);
      g.font = '500 12px Pretendard, sans-serif';
      const tw = g.measureText(label).width + 12;
      g.fillStyle = col;
      g.beginPath(); g.roundRect(px - tw / 2, py - 47, tw, 19, 4); g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, px, py - 37);
    };
    const near = Math.hypot((bx - ax) * m, (by - ay) * m) < 34;
    pin(pinR, ax + (near ? -26 / m : 0), ay, '최초 고장', '#c0392b', false);
    pin(pinG, bx, by, '마지막 수신', '#007b54', true);
    g.fillStyle = '#58595b'; g.font = '500 11px Pretendard, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const bar = 100 * m;
    g.fillRect(W - 40 - bar, H - 34, bar, 2.5); g.fillText('100 m', W - 40 - bar, H - 40);
  }

  // the town around the route: a street grid of blocks, parks and places
  const hash = (i, j) => { const x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return x - Math.floor(x); };
  const POI = ['GS25', 'CU', '스타벅스', 'KB국민은행', '하나은행', '역삼동주민센터', '세븐일레븐', '올리브영', '신한은행', '역삼초등학교', '아트빌딩', '한화갤러리아', '주차장', '파리바게뜨', '이디야커피', '강남구보건소'];
  function grid(g, P, cx, cy, W, H, m) {
    const ang = 0.49, ca = Math.cos(ang), sa = Math.sin(ang);
    const C = 52, R = (Math.hypot(W, H) / 2) / m + C;
    const u0 = cx * ca + cy * sa, v0 = -cx * sa + cy * ca;
    const toW = (u, v) => [u * ca - v * sa, u * sa + v * ca];
    const labels = [];
    for (let i = Math.floor((u0 - R) / C); i <= Math.ceil((u0 + R) / C); i++) {
      for (let j = Math.floor((v0 - R) / C); j <= Math.ceil((v0 + R) / C); j++) {
        const h = hash(i, j);
        if (h < 0.05) continue;
        const park = h > 0.93;
        const inset = park ? 4 : 7;
        const u = i * C + inset, v = j * C + inset, w = C - inset * 2;
        const pts = [toW(u, v), toW(u + w, v), toW(u + w, v + w), toW(u, v + w)].map(([X, Y]) => P(X, Y));
        g.beginPath(); pts.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath();
        g.fillStyle = park ? '#d7ebcc' : '#ece8e0'; g.fill();
        g.strokeStyle = park ? '#c3dfb4' : '#dfd9ce'; g.lineWidth = 1; g.stroke();
        if (!park && h > 0.25) {
          // buildings inside the block
          const n = h > 0.6 ? 2 : 1;
          for (let k = 0; k < n; k++) {
            const bw = w * (n === 1 ? 0.62 : 0.4), bu = u + w * (n === 1 ? 0.19 : 0.06 + k * 0.5), bv = v + w * (0.14 + 0.1 * hash(j, i + k));
            const q = [toW(bu, bv), toW(bu + bw, bv), toW(bu + bw, bv + bw * 0.9), toW(bu, bv + bw * 0.9)].map(([X, Y]) => P(X, Y));
            g.beginPath(); q.forEach((p, z) => (z ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath();
            g.fillStyle = '#e3ddd3'; g.fill(); g.strokeStyle = '#d3ccc0'; g.stroke();
          }
        }
        if (h > 0.82 && h < 0.93 && m > 0.4) labels.push([toW(u + w / 2, v + w / 2), POI[Math.floor(hash(j, i) * POI.length)]]);
      }
    }
    g.font = '500 10px Pretendard, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [[X, Y], name] of labels) {
      const [px, py] = P(X, Y);
      g.fillStyle = '#ff8a3d'; g.beginPath(); g.arc(px, py - 8, 3.2, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#7a7164'; g.fillText(name, px, py + 4);
    }
  }

  /* ---------------- transcript screen ---------------- */
  let trKey = '';
  function renderTranscript() {
    const el = $('#transcript');
    const c = active();
    const key = JSON.stringify([c && c.id, c && c.call && c.call.lines.length, c && c.call && c.call.state, c && c.contact, c && c.dispatch, c && c.log.length]);
    if (key === trKey) return;
    trKey = key;
    if (!c) { el.innerHTML = `<div class="tr-head"><span class="tg">E-CARE · LIVE TRANSCRIPT</span><b>상담 대화</b></div><div class="tr-empty">진행 중인 상담이 없습니다.<br>차량에서 긴급 경고가 발생하면 상담 내용이 여기에 실시간으로 표시됩니다.</div>`; return; }
    // dialogue and the call/dispatch events, in time order
    const items = (c.call ? c.call.lines.map((l) => ({ t: l.t, l })) : [])
      .concat(c.log.filter((e) => e.kind === 'call' || e.kind === 'alert').map((e) => ({ t: e.t, e })))
      .sort((a, b) => a.t - b.t).slice(-9);
    el.innerHTML = `<div class="tr-head"><span class="tg">E-CARE · LIVE TRANSCRIPT</span><b>${esc(c.warn.title)} · ${E.CUSTOMER.name} 고객</b><span class="st" data-trst></span></div>
      <div class="tr-body">${c.call ? items.map(({ l, e }) => l
        ? `<div class="tb ${l.who}"><span class="who">${l.who === 'agent' ? 'e-Care 상담원' : `${E.CUSTOMER.name} 고객`} · ${E.hm(l.t).slice(0, 5)}</span><div class="msg">${esc(l.text)}</div></div>`
        : `<div class="tb sys"><div class="msg">${E.hm(e.t).slice(0, 5)} · ${esc(e.text)}</div></div>`).join('') : `<div class="tr-empty">${c.inbound ? '고객 전화 수신 중…' : c.contact === 0 ? '고객 연락 대기 중 · SLA 25분' : '통화 연결 중…'}</div>`}</div>`;
  }
  setInterval(() => {
    if (VIEW !== 'transcript') return;
    const c = active();
    const st = $('[data-trst]');
    if (st && c && c.call) st.textContent = c.call.state === 'connected' ? `● 통화 중 ${E.mmss(Date.now() - c.call.connectedAt)}` : c.call.state === 'dialing' ? '발신 중…' : c.call.state === 'failed' ? '연결 실패 · 고객 미응답' : `통화 종료 · ${E.mmss(c.call.endedAt - c.call.connectedAt)}`;
  }, 250);

  /* ---------------- controls ---------------- */
  $('#viewBtn').addEventListener('click', () => camTo(cam.to > 0.5 ? 0 : 1, 2200));
  $('#fsBtn').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}));
  $('#noiseBtn').addEventListener('click', () => { unlock(); setNoise(!noise.on); });
  noiseUi();
  addEventListener('keydown', (e) => {
    if (e.target.matches && e.target.matches('textarea,input')) return;
    if (e.code === 'KeyV') camTo(cam.to > 0.5 ? 0 : 1, 2200);
    if (e.code === 'KeyF') $('#fsBtn').click();
    if (e.code === 'KeyN') setNoise(!noise.on);
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
