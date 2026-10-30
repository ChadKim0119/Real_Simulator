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
      VoiceSet.url(line.audio).then((u) => {
        if (!u) return;
        const a = audios[u] || (audios[u] = new Audio(u));
        a.currentTime = 0;
        a.play().catch(() => {});
      });
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
    const lines = snap && snap.scripts ? [].concat(...Object.values(snap.scripts)) : E.CALL_OUT.concat(E.CALL_IN);
    lines.forEach((l) => { if (l.audio && !l.audio.startsWith('idb:') && !audios[l.audio]) { const a = audios[l.audio] = new Audio(l.audio); a.preload = 'auto'; } });
    if (noise.on && VIEW !== 'transcript') noise.start();
  }
  if (params.has('stage')) { document.body.classList.add('stage'); setTimeout(unlock, 300); }
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
    const f = (onCase && c) || (snap && snap.general && snap.general.state !== 'ringing');
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

  function lnb(onCase) {
    return `<nav class="lnb">${LNB.map(([n, k, ar]) => `<div class="it"><img src="${A}lnb_${k}.svg" alt="">${n}${ar === false ? '' : `<img class="ar" src="${A}arrow_white.svg" alt="">`}</div>`).join('')}
      <div class="grp"><div class="it"><img src="${A}lnb_ecare.svg" alt="">e-Care<img class="ar up" src="${A}arrow_white.svg" alt=""></div>
      <div class="sub ${onCase ? 'on' : 'dim'}">e-Care 고객 응대</div><div class="sub ${onCase ? 'dim' : 'on'}">e-Care 상담 이력</div></div></nav>`;
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

  // 11.4.1.1 e-Care 상담 이력: the agent's first screen
  const PAST = [
    ['2026-10-28 15:29:53', '2026-10-28 16:02', '긴급상담건', '이관 완료', '엔진 점화 이상', '김민수', '김상담', '김상담', 'JTHDL41BP8A000012', '58나2391', '종결', 'ES 300h', '렉서스'],
    ['2026-10-28 15:21:00', '2026-10-28 15:44', '긴급상담건', '이관 완료', '냉각수 온도 이상', '이영희', '이서준', '이서준', 'JTMW1RFV0LD521847', '12다7710', '정비완료', 'RAV4', '토요타'],
    ['2026-10-28 14:18:28', '-', '긴급상담건', '상담 완료', '브레이크 시스템', '박지훈', '김상담', '김상담', 'JTJGARBZ5M2190334', '301라4428', '-', 'NX 350h', '렉서스'],
    ['2026-10-28 11:05:52', '2026-10-28 11:40', '정비안내건', '이관 완료', '엔진 오일 레벨', '최수진', '박지민', '박지민', 'JTDKARFU3L3109826', '67마1205', '입고', 'Prius', '토요타'],
    ['2026-10-27 18:20:03', '2026-10-27 18:51', '긴급상담건', '이관 완료', '에어백 시스템', '정우성', '이서준', '김상담', 'JTJHY7AX6H4235561', '24바9912', '종결', 'LX 600', '렉서스'],
    ['2026-10-27 16:42:19', '-', '긴급상담건', '상담 완료', '충전 시스템', '한지민', '김상담', '김상담', 'JTEBU5JR1K5711093', '88사3104', '-', 'Land Cruiser', '토요타'],
    ['2026-10-27 10:09:53', '2026-10-27 10:33', '긴급상담건', '이관 완료', '엔진 점화 이상', '오세훈', '박지민', '박지민', 'JTMABAFV5PD130482', '15아6672', '종결', 'Crown', '토요타'],
    ['2026-10-26 17:55:31', '2026-10-26 18:20', '정비안내건', '이관 완료', 'ABS', '윤아름', '이서준', '이서준', 'JTJBAMCA2J2071548', '73자8820', '고객인도', 'RX 500h', '렉서스'],
  ];
  const callIco = '<svg width="13" height="13" viewBox="0 0 24 24" style="margin-left:5px;vertical-align:-2px"><path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 013 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" fill="#212121"/><path d="M15 3h6v6M21 3l-6 6" stroke="#212121" stroke-width="2" fill="none"/></svg>';
  function homePage() {
    const cs = snap ? snap.cases.filter((c) => c.kind === 'emergency') : [];
    const ks = snap ? snap.consults.filter((k) => !k.general || true) : [];
    const live = cs.filter((c) => !(snap.consults || []).some((k) => k.id === c.id)).map((c) => ({
      at: E.stamp(c.at), upd: c.log.length ? E.stamp(c.log[c.log.length - 1].t).slice(0, 16) : '-', title: '긴급상담건', st: E.CONTACT[c.contact], warn: c.warn.title,
      cust: E.CUSTOMER.name, agent: agentOf(c) ? agentOf(c).name : '-', last: agentOf(c) ? agentOf(c).name : '-', vin: E.VEHICLE.vin, plate: E.VEHICLE.plate,
      svc: c.dms >= 0 ? E.DMS[c.dms] : '-', model: E.VEHICLE.model, brand: E.VEHICLE.brand, go: c.contact === 0 ? 'start' : 'open', id: c.id, c }));
    const done = ks.map((k) => ({ at: E.stamp(k.at), upd: k.updated ? E.stamp(k.updated).slice(0, 16) : '-', title: k.general ? '일반문의' : '긴급상담건', st: k.result, warn: k.warn || '-',
      cust: E.CUSTOMER.name, agent: k.agent, last: k.memos && k.memos.length ? k.memos[k.memos.length - 1].agent : k.agent, vin: E.VEHICLE.vin, plate: E.VEHICLE.plate,
      svc: (() => { const c = snap.cases.find((x) => x.id === k.id); return c && c.dms >= 0 ? E.DMS[c.dms] : '-'; })(), model: E.VEHICLE.model, brand: E.VEHICLE.brand, go: 'detail', id: k.id }));
    const past = PAST.map((r, i) => ({ at: r[0], upd: r[1], title: r[2], st: r[3], warn: r[4], cust: r[5], agent: r[6], last: r[7], vin: r[8], plate: r[9], svc: r[10], model: r[11], brand: r[12], go: 'detail', id: `P${i}` }));
    const rows = live.concat(done, past).slice(0, 10);
    const total = 368 + live.length + done.length;
    const sel = (label, val, w, ico) => `<div class="sel" style="width:${w}px">${ico ? '<svg width="15" height="15" viewBox="0 0 16 16" style="margin-right:8px"><rect x="1.5" y="2.5" width="13" height="12" rx="1.5" fill="none" stroke="#212121" stroke-width="1.3"/><path d="M1.5 6h13M5 1v3M11 1v3" stroke="#212121" stroke-width="1.3"/><path d="M4 8.5h2M7 8.5h2M10 8.5h2M4 11h2M7 11h2" stroke="#212121"/></svg>' : ''}${val}<i></i></div>`;
    const today = E.ymd(Date.now()), from = E.ymd(Date.now() - 90 * 864e5);
    return `<div class="ptitle"><h2>고객 상담 이력</h2><span class="crumb">e-Care <svg width="8" height="10" viewBox="0 0 8 10"><path d="M2 1l4 4-4 4" stroke="#212121" fill="none"/></svg> e-Care 상담 이력</span></div>
      <div class="box filt">
        <div class="frow"><div class="f"><label>&nbsp;</label>${sel('', '최초 상담 일자', 280)}</div><div class="f"><label>&nbsp;</label>${sel('', from, 280, true)}</div><div class="f"><label>&nbsp;</label>${sel('', today, 280, true)}</div>
          <div class="f"><label>브랜드</label>${sel('', '전체', 170)}</div><div class="f"><label>고객명</label><span class="inp" style="width:200px"></span></div><div class="f"><label>제목</label><span class="inp" style="width:200px"></span></div></div>
        <div class="frow"><div class="f"><label>차대번호</label><span class="inp" style="width:200px"></span></div><div class="f"><label>차량 번호</label><span class="inp" style="width:200px"></span></div><div class="f"><label>경고등명</label><span class="inp" style="width:200px"></span></div><div class="f"><label>담당자</label><span class="inp" style="width:200px"></span></div>
          <label class="chk"><i>✓</i>내 상담건만 보기</label><span class="fbtns"><button class="rf"><img src="${A}ic_refresh.svg" alt="" width="24"></button><button class="q">조회</button></span></div>
      </div>
      <div class="cnt-l">조회 결과 총 <b>${total}</b> 건</div>
      <div class="lst"><table class="grid list"><thead><tr><th style="width:64px">No.</th><th style="width:196px">최초 상담일시</th><th style="width:150px">최종 업데이트</th><th style="width:112px">제목</th><th style="width:124px">바로가기</th><th style="width:88px">상담 상태</th><th>경고등명</th><th style="width:78px">고객명</th><th style="width:84px">담당자</th><th style="width:84px">최종 메모<br>작성자</th><th style="width:172px">차대번호/ 차량 번호</th><th style="width:96px">서비스센터<br>처리 상태</th><th style="width:96px">차량 모델</th><th style="width:66px">브랜드</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${r.go === 'start' ? 'hot' : ''}"><td>${total - i}</td><td>${r.at}${callIco}</td><td>${r.upd}</td><td class="l">${r.title}</td>
        <td>${r.go === 'start' ? `<button class="go-cs" data-cmd="accept">고객 상담 진행</button>` : r.go === 'open' ? `<span class="tx-live">진행 중</span>` : `<a class="det" data-detail="${r.id}">상세보기</a>`}</td>
        <td>${r.go === 'start' ? `<b class="slat">${r.st}</b><small class="slat" data-sla="${r.id}"></small>` : r.st}</td><td class="l">${esc(r.warn)}</td><td>${r.cust}</td><td>${r.agent}</td><td>${r.last}</td><td class="vin">${r.vin}<br>${r.plate}</td><td>${r.svc}</td><td>${r.model}</td><td>${r.brand}</td></tr>`).join('')}</tbody></table>
      <div class="pager"><span>‹</span><b>1</b><span>2</span><span>3</span><span>4</span><span>5</span><span>›</span></div></div>`;
  }

  // 상담이력 상세 (opened from 상세보기, or after a general call to add a memo)
  let detailId = null;
  function detail() {
    const g = snap && snap.general;
    const id = g && g.state === 'ended' ? g.consult || 'GENERAL' : detailId;
    if (!id) return '';
    const k = snap.consults.find((x) => x.id === id);
    const past = /^P\d+$/.test(id);
    const k0 = snap.consults.find((x) => x.id === id);
    const p = past ? PAST[+id.slice(1)] : k0 ? null : [E.stamp(g ? g.at : Date.now()), '-', '일반문의', '상담 완료', '-', E.CUSTOMER.name, me().name, me().name, E.VEHICLE.vin, E.VEHICLE.plate, '-', E.VEHICLE.model, E.VEHICLE.brand];
    const c = k && snap.cases.find((x) => x.id === k.id);
    const d = c && c.dealer ? E.DEALERS.find((x) => x.name === c.dealer) : E.DEALERS[0];
    const name = p ? p[5] : E.CUSTOMER.name;
    const warn = k ? k.warn : p ? p[4] : '-';
    const memo = k ? k.memo : past ? `${p[4]} 경고 관련 상담. 고객 안전 확인 후 서비스센터 입고 안내 완료.` : '고객 일반 문의 (진행 중인 경고 케이스 없음).';
    const memos = (k && k.memos) || [];
    const fromGeneral = g && g.state === 'ended';
    return `<div class="ov"><div class="dlg2"><div class="dh"><b>상담이력 상세</b><button class="x" data-close>✕</button></div>
      <div class="sum"><div><small>경고 발생</small><b>${p ? '경고 발생' : '긴급 경고 발생'}</b><em>${k ? E.stamp(k.at) : p[0]}</em></div><div><small>상담</small><b>${k ? `${k.agent}(${k.type === '인바운드 콜' ? '인바운드' : '아웃바운드'})` : `${p[6]}(아웃바운드)`}</b><em>${k ? E.stamp(k.updated || k.at) : p[0]}</em></div>
        <div><small>상담 정보 처리</small><b>${(k && k.dealer !== '-') || (p && p[10] !== '-') ? 'DMS 전송' : '상담 완료'}</b><em>${k ? E.stamp(k.updated || k.at) : p[1]}</em></div><div><small>서비스센터 처리</small><b class="bl">${c && c.dms >= 0 ? E.DMS[c.dms] : p ? p[10] : '-'}</b><em>${k ? E.ymd(Date.now()) : p[0].slice(0, 10)}</em></div></div>
      <h5>상담 기록</h5>
      <div class="rec"><div class="ci"><h6>고객 정보</h6><dl><dt>고객명</dt><dd class="fx">${name}</dd><dt>고객 연락처</dt><dd class="fx">${past ? '010-****-' + (4100 + +id.slice(1) * 37) : E.CUSTOMER.phone}<button class="callb">전화걸기</button></dd><dt>차대번호(VIN)</dt><dd class="fx">${p ? p[8] : E.VEHICLE.vin}</dd><dt>경고 발생 시각</dt><dd class="fx">${k ? E.stamp(k.at) : p[0]}</dd></dl></div>
        <div class="sc"><h6>서비스 센터</h6><dl><dt>선호 센터</dt><dd>${E.DEALERS[0].name}</dd><dt>상담 시 안내 센터</dt><dd>${d.name}${d.pref ? '' : '<span class="badge-r">고객 선호 센터 불일치</span>'}</dd><dt>주소</dt><dd>${d.addr.replace('서울특별시 ', '')} (${d.km}km)</dd><dt>대표번호</dt><dd>${d.tel}</dd></dl>
          <h6 style="margin-top:14px">경고 유형 / 주행 가능 여부</h6><div class="wt">${warn && warn !== '-' ? `#1 <a>${esc(warn)}</a> 주행 불가` : '경고 없음 · 일반 문의'}</div></div></div>
      <div class="lb2">상담 제목</div><div class="fx w">${k ? esc(k.title) : p[2]}</div>
      <div class="lb2">상담 내용</div><div class="fx w tall">${esc(memo)}</div>
      ${memos.length ? `<div class="lb2">추가 메모 이력</div>${memos.map((m) => `<div class="fx w">${E.stamp(m.t).slice(0, 16)} · ${esc(m.agent)} · ${esc(m.text)}</div>`).join('')}` : ''}
      <div class="am"><h6>추가 메모</h6><textarea data-addmemo maxlength="1000" placeholder="추가 메모를 입력하세요">${fromGeneral ? esc(g.memo) : ''}</textarea><button class="bt-dark" data-addmemo-btn>등록</button></div>
      <div class="df"><button class="bt-white" data-close>닫기</button><button class="bt-dark" data-close-save>저장</button></div></div></div>`;
  }

  function popup(c) {
    const g = snap && snap.general;
    if (g && g.state === 'ringing') {
      return `<div class="ov"><div class="pop"><div class="txt"><div class="ttl"><img class="ring" src="${A}ic_siren.svg" alt="">전화가 왔습니다.</div>
        <div class="cen">발신 번호: <b>${E.CUSTOMER.phone}</b><br>고객명 : <b>${E.CUSTOMER.name}</b> (가입 고객)</div></div><button class="go" data-cmd="answerGeneral">전화 받기</button></div></div>`;
    }
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
    const gen = snap.general;
    const pk = gen && gen.state === 'ringing' ? 'in' : c ? (c.inbound && !c.call ? 'in' : c.assign && !c.assign.done && c.contact === 0 ? 'warn' : '') : '';
    if (pk && pk !== lastPopup) { pk === 'in' ? sfx.ring() : sfx.popup(); }
    lastPopup = pk;
    const key = JSON.stringify([onCase, histTab, onlyOpen, pk, c && [c.id, c.contact, c.dispatch, c.dms, c.dealer, c.assign && c.assign.at, c.call && [c.call.state, c.call.hold, c.call.attempts], c.retry, c.sms, c.sheet, c.memo, c.log.length],
      snap.cases.length, snap.agents.map((a) => a.state), (snap.consults || []).map((k) => (k.memos || []).length), gen && [gen.state, gen.lines.length], detailId]);
    if (!force && key === renderedKey) return;
    // keep the agent's typing: no re-render while an input in the app has focus
    const f = document.activeElement;
    if (!force && f && app.contains(f) && f.matches('input,textarea')) return;
    renderedKey = key;
    app.innerHTML = `<div class="ccw">${gnb(c, onCase)}${band(onCase ? c : null)}${lnb(onCase)}<main class="page">${onCase ? casePage(c) : homePage()}</main></div>${popup(c)}${onCase ? '' : detail()}`;
    app.querySelectorAll('[data-wicon]').forEach((cv) => {
      const g = cv.getContext('2d');
      SimIcons.drawIcon(g, cv.dataset.wicon, 28, 28, 40, '#3f322e', null);
    });
    if (c && c.sheet && c.sheet.saved && Date.now() - c.sheet.saved < 5000) { setTimeout(() => render(true), 5100 - (Date.now() - c.sheet.saved)); }
    tick();
  }

  app.addEventListener('click', (e) => {
    const c = active();
    const t = e.target.closest('[data-cmd],[data-tab],[data-step],[data-save],[data-sheet],[data-toggle],[data-dealer],[data-only],[data-refresh],[data-detail],[data-close],[data-close-save],[data-addmemo-btn]');
    if (!t) return;
    unlock();
    if (t.dataset.detail) { detailId = t.dataset.detail; render(true); return; }
    if (t.hasAttribute('data-addmemo-btn') || t.hasAttribute('data-close-save') || t.hasAttribute('data-close')) {
      const ta = $('[data-addmemo]', app);
      const text = ta && !t.hasAttribute('data-close') ? ta.value.trim() : '';
      const g = snap.general;
      if (g && g.state === 'ended') cmd('closeGeneral', { text });
      else if (text && detailId) cmd('consultMemo', { consult: detailId, text });
      if (text) sfx.save();
      if (!t.hasAttribute('data-addmemo-btn') || (g && g.state === 'ended')) detailId = null;
      if (ta && t.hasAttribute('data-addmemo-btn')) ta.value = '';
      render(true);
      return;
    }
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
    }
    if (snap && snap.general && snap.general.state === 'ringing' && Date.now() - hotBeep > 3000) { hotBeep = Date.now(); sfx.ring(); }
    if (c && snap) {
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

  /* ---------------- transcript screen (상담 대화) ----------------
   * Live conversation with edit / delete per line, and the call scripts the
   * next calls will use. Everything goes through the director, so every
   * screen (CCW, other tablets) shows the same edits. */
  let trKey = '', trTab = 'live', trSys = true, trSel = -1, trEdit = -1, trSeen = new Set(), trConv = '';
  const tr = $('#transcript');
  function convo() {
    const g = snap && snap.general;
    if (g) return { general: true, lines: g.lines, title: `일반 전화 · ${E.CUSTOMER.name} 고객`, call: g, log: [] };
    const c = active();
    if (!c) return null;
    return { general: false, id: c.id, lines: c.call ? c.call.lines : [], title: `${c.warn.title} · ${E.CUSTOMER.name} 고객`, call: c.call, log: c.log, c };
  }
  function renderTranscript(force) {
    if (!snap) return;
    const v = convo();
    const key = JSON.stringify([trTab, trSys, trSel, trEdit, vsVer, v && [v.title, v.lines, v.call && v.call.state, v.log.length], v && v.c && [v.c.contact, v.c.dispatch, v.c.dms], trTab === 'script' && [snap.scripts, snap.pick]]);
    if (!force && key === trKey) return;
    const f = document.activeElement;
    if (!force && f && tr.contains(f) && f.matches('textarea')) return;
    trKey = key;
    const head = `<header class="trh"><span class="tag">E-CARE · 상담 대화</span><b>${v ? esc(v.title) : '상담 대기'}</b>
      <nav class="trtabs"><button data-trtab="live" class="${trTab === 'live' ? 'on' : ''}">실시간 대화</button><button data-trtab="script" class="${trTab === 'script' ? 'on' : ''}">대화 스크립트</button></nav>
      <span class="st" data-trst></span></header>`;
    let body;
    if (trTab === 'script') body = scriptsView();
    else if (!v) body = `<div class="tr-empty">진행 중인 상담이 없습니다.<br>차량에서 긴급 경고가 발생하거나 고객이 전화하면 대화가 여기에 실시간으로 표시됩니다.<br><small>대화 스크립트 탭에서 다음 통화의 대사를 미리 고칠 수 있습니다.</small></div>`;
    else body = liveView(v);
    const prev = $('.tr-list', tr);
    const keep = prev && (trSel >= 0 || trEdit >= 0) ? prev.scrollTop : null;
    tr.innerHTML = head + body;
    const list = $('.tr-list', tr);
    if (list) list.scrollTop = keep != null ? keep : list.scrollHeight;
    drawVs();
    tickTranscript();
  }
  function liveView(v) {
    const c = v.c;
    const conv = v.general ? `G${v.call.at}` : v.id;
    if (conv !== trConv) { trConv = conv; trSeen = new Set(); }
    const fresh = (k) => { if (trSeen.has(k)) return ''; trSeen.add(k); return ' new'; };
    const items = v.lines.map((l, i) => ({ t: l.t, l, i })).filter((x) => !x.l.deleted)
      .concat(trSys ? v.log.filter((e) => e.kind === 'call' || e.kind === 'alert').map((e) => ({ t: e.t, e })) : [])
      .sort((a, b) => a.t - b.t);
    const chips = c ? [['상담', E.CONTACT[c.contact]], ['긴급 출동', c.dispatch >= 0 ? E.DISPATCH[c.dispatch] : '-'], ['서비스센터', c.dms >= 0 ? E.DMS[c.dms] : '-']] : [['상담', v.call.state === 'ended' ? '후처리' : '통화']];
    const side = `<aside class="tr-side">
      <div class="card"><small>고객</small><b>${E.CUSTOMER.name}</b><span>${E.CUSTOMER.phone}</span></div>
      <div class="card"><small>차량</small><b>${E.VEHICLE.plate}</b><span>${E.VEHICLE.model} / ${E.VEHICLE.year} · ${E.VEHICLE.brand}</span></div>
      ${c ? `<div class="card red"><small>경고</small><b>${esc(c.warn.title)}</b><span>${c.kind === 'emergency' ? '주행 불가' : '주행 가능'} · ${c.warn.dtc}</span></div>` : '<div class="card"><small>문의</small><b>일반 전화</b><span>경고 케이스 없음</span></div>'}
      <div class="card"><small>처리 상태</small>${chips.map(([k, x]) => `<div class="kv2"><span>${k}</span><em>${x}</em></div>`).join('')}</div>
      <label class="sw ${trSys ? 'on' : ''}" data-trsys><i></i>시스템 이벤트 표시</label>
      <p class="hint">대화를 탭하면 <b>편집</b> · <b>삭제</b>할 수 있습니다. 모든 화면에 바로 반영됩니다.</p></aside>`;
    const bubbles = items.map(({ l, e, i }) => {
      if (e) return `<div class="tb sys${fresh('e' + e.t + e.text)}"><div class="msg">${E.hm(e.t).slice(0, 5)} · ${esc(e.text)}</div></div>`;
      const who = l.who === 'agent' ? 'e-Care 상담원' : `${E.CUSTOMER.name} 고객`;
      if (i === trEdit) return `<div class="tb ${l.who} editing"><span class="who">${who}</span><textarea data-edit="${i}" rows="3">${esc(l.text)}</textarea><div class="acts on"><button data-save-line="${i}" class="pri">저장</button><button data-cancel>취소</button></div></div>`;
      return `<div class="tb ${l.who} ${i === trSel ? 'picked' : ''}${fresh('l' + i)}" data-line="${i}"><span class="who">${who} · ${E.hm(l.t).slice(0, 5)}${l.edited ? ' · 수정됨' : ''}</span><div class="msg">${esc(l.text)}</div>
        <div class="acts"><button data-edit-line="${i}">✎ 편집</button><button data-del-line="${i}" class="del">삭제</button></div></div>`;
    }).join('');
    return `<div class="tr-wrap">${side}<div class="tr-list">${bubbles || '<div class="tr-empty">통화 연결 중…</div>'}</div></div>`;
  }
  // which conversation set each call type plays (only types with several sets)
  function pickBar() {
    const pick = snap.pick || {};
    return Object.keys(E.SCRIPT_SETS).filter((k) => E.SCRIPT_SETS[k].keys.length > 1).map((kind) => `<div class="pickbar"><b>대화 상황 · ${E.SCRIPT_SETS[kind].label}</b>
      ${E.SCRIPT_SETS[kind].keys.map((k) => `<button data-pick="${kind}:${k}" class="${pick[kind] === k ? 'on' : ''}">${esc(E.SCRIPT_NAMES[k])}<small>${(snap.scripts[k] || []).length}줄 · ${Math.round((snap.scripts[k] || []).reduce((t, l) => t + (l.dur || 0) + 0.7, 0))}초</small></button>`).join('')}
      <span>다음 통화부터 적용 · 리모컨에서도 선택 가능</span></div>`).join('');
  }
  function scriptsView() {
    const sc = snap.scripts || {};
    const where = Link.transport === 'lan' ? '릴레이 서버에 저장 · 모든 화면에서 재생' : '이 브라우저에 저장 · 같은 브라우저의 콜센터 화면에서 재생 (여러 PC는 릴레이로 실행)';
    return `<div class="tr-scripts"><p class="hint">다음 통화부터 아래 대사가 사용됩니다. 음성 파일이 있는 대사는 녹음으로, 없는 대사는 음성 합성(TTS)으로 재생됩니다. 대사를 고치면 그 줄의 녹음은 해제됩니다. <button data-sreset>기본 대사 · 음성으로 초기화</button></p>
      ${pickBar()}
      ${Object.keys(E.SCRIPT_NAMES).map((k) => {
        const list = sc[k] || [];
        const n = (who) => list.filter((l) => !who || l.who === who).length;
        const kind = Object.keys(E.SCRIPT_SETS).find((x) => E.SCRIPT_SETS[x].keys.includes(k));
        const multi = E.SCRIPT_SETS[kind].keys.length > 1;
        const used = (snap.pick || {})[kind] === k;
        return `<section class="${multi && used ? 'inuse' : ''}"><h3>${E.SCRIPT_NAMES[k]}${multi ? (used ? '<span class="inuse">● 사용 중</span>' : `<button class="usebtn" data-pick="${kind}:${k}">이 세트 사용</button>`) : ''}</h3>
        <div class="vset"><b>음성 세트</b><span>MP3 · WAV · M4A — 한 파일을 대사 사이 쉬는 구간에서 자동으로 나눕니다</span>
          <div class="vslots"><label class="vslot agent">상담원 음성<small>상담원 대사 ${n('agent')}줄 이어서</small><input type="file" accept="audio/*" data-vslot="${k}:agent" hidden></label>
          <label class="vslot customer">고객 음성<small>고객 대사 ${n('customer')}줄 이어서</small><input type="file" accept="audio/*" data-vslot="${k}:customer" hidden></label>
          <label class="vslot all">대화 전체<small>두 목소리 ${n()}줄 한 파일</small><input type="file" accept="audio/*" data-vslot="${k}:all" hidden></label></div>
          <small class="where">${where}</small></div>
        ${vs && vs.key === k ? vsView(list) : ''}
        ${list.map((l, i) => `<div class="srow">
        <button class="who ${l.who}" data-swho="${k}:${i}">${l.who === 'agent' ? '상담원' : '고객'}</button><textarea data-stext="${k}:${i}" rows="2">${esc(l.text)}</textarea>
        <span class="aud">${l.audio ? `<button data-splay="${k}:${i}" title="${esc(l.audio)}">▶ ${l.dur.toFixed(1)}초</button>` : 'TTS'}<label>파일<input type="file" accept="audio/*" data-sfile="${k}:${i}" hidden></label></span><button class="del" data-sdel="${k}:${i}">삭제</button></div>`).join('')}
        <div class="sadd"><button data-sadd="${k}:agent">+ 상담원 대사</button><button data-sadd="${k}:customer">+ 고객 대사</button></div></section>`;
      }).join('')}</div>`;
  }

  /* voice set being cut: { key, slot, name, a (decoded), cuts (s), idxs (script lines) } */
  let vs = null, vsVer = 0, vsDrag = -1;
  const VS_COL = ['#5aa2ff', '#ffb02e', '#3fd0c9', '#ff6b81', '#a98bff', '#8ff0b3', '#f7d774', '#ff9a5a'];
  const SLOT = { agent: '상담원 음성', customer: '고객 음성', all: '대화 전체' };
  function vsView(list) {
    const segs = VoiceSet.segments(vs.a, vs.cuts);
    const short = segs.length < vs.idxs.length;
    return `<div class="vwork"><div class="vh"><b>${SLOT[vs.slot]} · ${esc(vs.name)}</b><span class="${short ? 'bad' : 'ok'}">${segs.length} / ${vs.idxs.length} 구간</span></div>
      <canvas class="vwave" data-vwave></canvas>
      <p class="hint">${short ? `<b>구간이 대사 수보다 적습니다.</b> 파형에서 대사가 바뀌는 곳을 눌러 경계를 추가하세요. ` : ''}노란 경계선을 끌어 옮길 수 있고, ▶로 각 구간을 들어볼 수 있습니다.</p>
      <ol class="vsegs">${vs.idxs.map((idx, j) => { const l = list[idx], sg = segs[j]; return `<li style="--c:${VS_COL[j % VS_COL.length]}">${sg ? `<button data-vplay="${j}">▶</button>` : '<button disabled>—</button>'}<em>${l.who === 'agent' ? '상담원' : '고객'}</em><span>${esc(l.text)}</span><small>${sg ? `${(sg.end - sg.start).toFixed(1)}초` : '없음'}</small></li>`; }).join('')}</ol>
      <div class="vbtn"><button data-vapply class="pri" ${vs.busy ? 'disabled' : ''}>${vs.busy ? '저장 중…' : `대사 ${Math.min(segs.length, vs.idxs.length)}줄에 적용`}</button><button data-vauto>자동으로 다시 나누기</button><button data-vcancel>취소</button></div></div>`;
  }
  function drawVs() {
    const cv = $('[data-vwave]', tr);
    if (!cv || !vs) return;
    VoiceSet.draw(cv, vs.a, vs.cuts, VoiceSet.segments(vs.a, vs.cuts), VS_COL);
  }
  async function vsLoad(key, slot, file) {
    const list = snap.scripts[key];
    const idxs = list.map((l, i) => i).filter((i) => slot === 'all' || list[i].who === slot);
    if (!idxs.length) return alert('이 시나리오에 해당 대사가 없습니다.');
    try {
      const a = await VoiceSet.decode(await file.arrayBuffer());
      vs = { key, slot, name: file.name, a, idxs, cuts: VoiceSet.autoCuts(a, idxs.length).cuts };
    } catch (e) { alert(`오디오 파일을 읽을 수 없습니다: ${file.name}`); return; }
    vsVer++;
    renderTranscript(true);
  }
  async function vsApply() {
    const segs = VoiceSet.segments(vs.a, vs.cuts);
    vs.busy = true; vsVer++; renderTranscript(true);
    const audios = [];
    const stamp = Date.now().toString(36);
    for (let j = 0; j < Math.min(segs.length, vs.idxs.length); j++) {
      const idx = vs.idxs[j];
      const audio = await VoiceSet.store(`${vs.key}_${idx}_${stamp}`, VoiceSet.wav(vs.a, segs[j]));
      audios.push({ idx, audio, dur: +(segs[j].end - segs[j].start).toFixed(2) });
    }
    cmd('script', { key: vs.key, audios });
    vs = null; vsVer++;
    renderTranscript(true);
  }
  async function lineFile(key, idx, file) {
    try {
      const a = await VoiceSet.decode(await file.arrayBuffer());
      const seg = VoiceSet.segments(a, [])[0];
      const audio = await VoiceSet.store(`${key}_${idx}_${Date.now().toString(36)}`, VoiceSet.wav(a, seg));
      cmd('script', { key, audios: [{ idx, audio, dur: +(seg.end - seg.start).toFixed(2) }] });
    } catch (e) { alert(`오디오 파일을 읽을 수 없습니다: ${file.name}`); }
  }
  // drag a cut, or click the waveform to add one when lines are missing
  function vsAt(e) { const r = e.target.getBoundingClientRect(); return { t: ((e.clientX - r.left) / r.width) * vs.a.dur, px: r.width / vs.a.dur }; }
  tr.addEventListener('pointerdown', (e) => {
    if (!vs || !e.target.matches('[data-vwave]')) return;
    const { t, px } = vsAt(e);
    let best = -1;
    vs.cuts.forEach((c, i) => { if (Math.abs(c - t) * px < 10 && (best < 0 || Math.abs(c - t) < Math.abs(vs.cuts[best] - t))) best = i; });
    if (best < 0 && vs.cuts.length < vs.idxs.length - 1) { vs.cuts.push(t); vs.cuts.sort((x, y) => x - y); best = vs.cuts.indexOf(t); }
    if (best < 0) return;
    vsDrag = best;
    e.target.setPointerCapture(e.pointerId);
    drawVs();
  });
  tr.addEventListener('pointermove', (e) => {
    if (!vs || vsDrag < 0) return;
    const lo = vsDrag > 0 ? vs.cuts[vsDrag - 1] + 0.1 : 0.1, hi = vsDrag < vs.cuts.length - 1 ? vs.cuts[vsDrag + 1] - 0.1 : vs.a.dur - 0.1;
    vs.cuts[vsDrag] = Math.max(lo, Math.min(hi, vsAt(e).t));
    drawVs();
  });
  tr.addEventListener('pointerup', () => { if (vsDrag >= 0) { vsDrag = -1; vsVer++; renderTranscript(true); } });

  function tickTranscript() {
    const st = $('[data-trst]', tr);
    const v = convo();
    if (!st) return;
    const call = v && v.call;
    st.textContent = !call ? '' : call.state === 'connected' ? `● 통화 중 ${E.mmss(Date.now() - call.connectedAt)}` : call.state === 'dialing' ? '발신 중…' : call.state === 'ringing' ? '전화 수신 중…' : call.state === 'failed' ? '연결 실패 · 고객 미응답' : `통화 종료${call.connectedAt ? ` · ${E.mmss((call.endedAt || Date.now()) - call.connectedAt)}` : ''}`;
    st.classList.toggle('off', !call || call.state !== 'connected');
  }
  if (VIEW === 'transcript') {
    setInterval(tickTranscript, 250);
    tr.addEventListener('click', (e) => {
      const t = e.target.closest('button,[data-line],[data-trsys]');
      if (!t) return;
      const v = convo();
      const ref = (x) => { const [key, idx] = x.split(':'); return { key, idx: +idx }; };
      if (t.dataset.trtab) { trTab = t.dataset.trtab; trSel = trEdit = -1; }
      else if (t.hasAttribute('data-trsys')) trSys = !trSys;
      else if (t.dataset.editLine) { trEdit = +t.dataset.editLine; renderTranscript(true); const ta = $('textarea', tr); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } return; }
      else if (t.dataset.saveLine && v) { cmd('line', { id: v.id, general: v.general, idx: +t.dataset.saveLine, text: $('[data-edit]', tr).value.trim() }); trEdit = trSel = -1; }
      else if (t.hasAttribute('data-cancel')) trEdit = -1;
      else if (t.dataset.delLine && v) { cmd('line', { id: v.id, general: v.general, idx: +t.dataset.delLine, del: true }); trSel = -1; }
      else if (t.dataset.line) trSel = trSel === +t.dataset.line ? -1 : +t.dataset.line;
      else if (t.dataset.swho) { const r = ref(t.dataset.swho); const l = snap.scripts[r.key][r.idx]; cmd('script', { ...r, who: l.who === 'agent' ? 'customer' : 'agent' }); }
      else if (t.dataset.sdel) cmd('script', { ...ref(t.dataset.sdel), del: true });
      else if (t.dataset.pick) { const [kind, key] = t.dataset.pick.split(':'); cmd('pick', { kind, key }); }
      else if (t.dataset.sadd) { const [key, who] = t.dataset.sadd.split(':'); cmd('script', { key, add: true, who, text: who === 'agent' ? '상담원 대사를 입력하세요.' : '고객 대사를 입력하세요.' }); }
      else if (t.hasAttribute('data-sreset')) { if (confirm('대화 스크립트를 기본 대사 · 기본 음성으로 되돌릴까요?')) cmd('script', { reset: true }); }
      else if (t.dataset.vplay) { const sg = VoiceSet.segments(vs.a, vs.cuts)[+t.dataset.vplay]; if (sg) VoiceSet.preview(vs.a, sg); return; }
      else if (t.hasAttribute('data-vapply')) { if (!vs.busy) vsApply(); return; }
      else if (t.hasAttribute('data-vauto')) { vs.cuts = VoiceSet.autoCuts(vs.a, vs.idxs.length).cuts; vsVer++; }
      else if (t.hasAttribute('data-vcancel')) { VoiceSet.stop(); vs = null; vsVer++; }
      else if (t.dataset.splay) { const r = ref(t.dataset.splay); const l = snap.scripts[r.key][r.idx]; VoiceSet.url(l.audio).then((u) => { if (u) { const a = new Audio(u); a.play().catch(() => {}); } }); return; }
      else return;
      renderTranscript(true);
    });
    tr.addEventListener('change', (e) => {
      const d = e.target.dataset || {};
      if (d.vslot && e.target.files[0]) { const [key, slot] = d.vslot.split(':'); vsLoad(key, slot, e.target.files[0]); return; }
      if (d.sfile && e.target.files[0]) { const [key, idx] = d.sfile.split(':'); lineFile(key, +idx, e.target.files[0]); return; }
      const k = d.stext;
      if (!k) return;
      const [key, idx] = k.split(':');
      cmd('script', { key, idx: +idx, text: e.target.value.trim() });
    });
    tr.addEventListener('focusout', () => setTimeout(() => renderTranscript(), 50));
  }

  // a tablet showing the transcript should not dim or lock during the demo
  let wake = null;
  async function keepAwake() {
    if (VIEW !== 'transcript' || !navigator.wakeLock || document.visibilityState !== 'visible' || (wake && !wake.released)) return;
    try { wake = await navigator.wakeLock.request('screen'); } catch (e) { /* needs a tap first on some browsers */ }
  }
  document.addEventListener('pointerdown', keepAwake);
  document.addEventListener('visibilitychange', keepAwake);
  keepAwake();

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
