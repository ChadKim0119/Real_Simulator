/* Synthesised sound (Web Audio, no samples): the engine heard through a
 * well-insulated cabin, a short refined starter, soft road, tyre and wind
 * noise, and the cluster's chimes.
 *
 * Three engine voices, modelled on Lexus flagships (picked on the control panel;
 * the default is the LS 500, the brand's flagship):
 *   ls500  LS 500  — V35A-FTS 3.4 L twin-turbo V6, 416 hp: the quietest, a soft
 *                    whisper start, barely a turbo breath under load
 *   lx600  LX 600  — the same V35A-FTS family, 409 hp in the flagship SUV: a
 *                    deeper body boom, more induction and turbo, a firmer start
 *   lc500  LC 500  — 2UR-GSE 5.0 L naturally aspirated V8, 471 hp at 7,100 rpm:
 *                    cross-plane burble, the intake sound generator's tones, a rev
 *                    flare on start
 * Engine orders are given relative to the firing frequency (rpm / 60 x cylinders / 2). */
(function () {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ENGINES = {
    ls500: { name: 'LS 500', sub: '3.4L V6 트윈터보 · 416hp', cyl: 6, amps: [0.12, 1.0, 0.1, 0.3, 0.06, 0.02], bodyF: 75, bodyG: 4,
      lp: [240, 0.08, 520], level: [0.055, 0.11, 0.06], intake: [0.004, 0.018, 420, 0.15, 0.7], turbo: 0.006, crank: 0.75, crankLvl: 0.15, flare: 250, thump: 0.22 },
    lx600: { name: 'LX 600', sub: '3.4L V6 트윈터보 · 409hp', cyl: 6, amps: [0.18, 1.0, 0.16, 0.34, 0.08, 0.03], bodyF: 62, bodyG: 7,
      lp: [260, 0.09, 650], level: [0.07, 0.15, 0.07], intake: [0.006, 0.03, 360, 0.16, 0.7], turbo: 0.012, crank: 0.95, crankLvl: 0.22, flare: 450, thump: 0.32 },
    lc500: { name: 'LC 500', sub: '5.0L V8 자연흡기 · 471hp', cyl: 8, amps: [0.42, 1.0, 0.3, 0.42, 0.12, 0.06], bodyF: 90, bodyG: 5,
      lp: [320, 0.14, 900], level: [0.08, 0.2, 0.12], intake: [0.01, 0.05, 300, 0.22, 1.4], turbo: 0, crank: 0.85, crankLvl: 0.24, flare: 1400, thump: 0.36 },
  };

  class SimAudio {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.repeat = null;
      this.eng = ENGINES.ls500;
      this.flareAt = -1;
    }

    /* Switch the engine voice (ls500 | lx600 | lc500). */
    setEngine(id) {
      this.eng = ENGINES[id] || ENGINES.ls500;
      this.engId = ENGINES[id] ? id : 'ls500';
      if (!this.ctx) return;
      const E = this.eng, t = this.ctx.currentTime;
      this.orders.forEach((o, i) => o.g.gain.setTargetAtTime(E.amps[i], t, 0.1));
      this.body.frequency.setTargetAtTime(E.bodyF, t, 0.1);
      this.body.gain.setTargetAtTime(E.bodyG, t, 0.1);
      this.intakeBP.Q.setTargetAtTime(E.intake[4], t, 0.1);
    }

    /* Must be called from a user gesture (browser autoplay policy). */
    unlock() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();

      this.master = ctx.createGain();
      this.master.gain.value = this.enabled ? 1 : 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 3.5;
      // under a call (customer ↔ agent / dealer) the car steps back so the voices carry
      this.duckG = ctx.createGain();
      this.duckG.gain.value = this.ducked ? 0.32 : 1;
      this.master.connect(this.duckG).connect(comp).connect(ctx.destination);

      // everything mechanical is heard through the cabin: dull it down
      this.cabin = ctx.createBiquadFilter();
      this.cabin.type = 'lowpass';
      this.cabin.frequency.value = 1500;      // laminated glass, thick insulation
      this.cabin.Q.value = 0.4;
      this.cabin.connect(this.master);

      this.noiseBuf = this.makeNoise(3);
      this.buildEngine();
      this.buildRoad();
    }

    makeNoise(seconds) {
      const ctx = this.ctx;
      const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }

    noise(rate) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      src.playbackRate.value = rate || 1;
      src.start(0, Math.random() * 2);
      return src;
    }

    filter(type, f, q) {
      const n = this.ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      if (q !== undefined) n.Q.value = q;
      return n;
    }

    gain(v) {
      const g = this.ctx.createGain();
      g.gain.value = v;
      return g;
    }

    buildEngine() {
      const ctx = this.ctx;
      // A V8 with a cross-plane crank fires 4 times per revolution. Its cabin
      // sound is dominated by a few low engine orders; uneven bank firing adds
      // the half and 1.5 orders that give the soft burble. Pure partials (no
      // saw/square) keep it smooth, a gentle saturator ties them together.
      this.engBus = this.gain(0);
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(2048);
      for (let i = 0; i < 2048; i++) {
        const x = i / 1024 - 1;
        curve[i] = Math.tanh(x * 1.3) / Math.tanh(1.3);
      }
      shaper.curve = curve;
      shaper.oversample = '2x';
      this.engLP = this.filter('lowpass', 420, 0.7);
      const body = this.body = this.filter('peaking', 85, 1.0);
      body.gain.value = 6;                         // chassis resonance: felt more than heard
      const sum = this.gain(0.42);
      sum.connect(shaper).connect(body).connect(this.engLP).connect(this.engBus).connect(this.cabin);

      this.orders = [[0.5, 'sine'], [1, 'sine'], [1.5, 'sine'], [2, 'triangle'], [3, 'sine'], [4, 'sine']].map(([mul, type], i) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = 26 * mul;
        o.detune.value = (Math.random() - 0.5) * 6;
        const g = this.gain(this.eng.amps[i]);
        o.connect(g).connect(sum);
        o.start();
        return { o, mul, g };
      });

      // the faintest combustion texture, so it never sounds like a tone generator
      const rough = this.noise(0.2);
      const roughLP = this.filter('lowpass', 18);
      this.roughAmt = this.gain(0.0);
      rough.connect(roughLP).connect(this.roughAmt).connect(this.engBus.gain);

      // induction: a soft, low breath that rises with load
      const intake = this.noise(1);
      this.intakeBP = this.filter('bandpass', 520, 0.7);
      this.intakeGain = this.gain(0);
      intake.connect(this.intakeBP).connect(this.intakeGain).connect(this.cabin);

      // turbo: a faint, high breath that follows boost (twin-turbo V6 only)
      const tw = this.noise(1);
      this.turboBP = this.filter('bandpass', 2400, 6);
      this.turboGain = this.gain(0);
      tw.connect(this.turboBP).connect(this.turboGain).connect(this.master);
      this.setEngine(this.engId || 'ls500');
    }

    buildRoad() {
      // fine-grained tyre roar, a low structural rumble, and air over the mirrors
      const tyre = this.noise(1);
      const tyreBP = this.filter('bandpass', 260, 0.55);
      this.tyreGain = this.gain(0);
      tyre.connect(tyreBP).connect(this.tyreGain).connect(this.cabin);
      const rumble = this.noise(0.5);
      const rumbleLP = this.filter('lowpass', 110, 0.7);
      this.rumbleGain = this.gain(0);
      rumble.connect(rumbleLP).connect(this.rumbleGain).connect(this.master);
      const wind = this.noise(1);
      const windHP = this.filter('highpass', 500, 0.5);
      this.windBP = this.filter('lowpass', 1400, 0.4);
      this.windGain = this.gain(0);
      wind.connect(windHP).connect(this.windBP).connect(this.windGain).connect(this.master);
    }

    setEnabled(on) {
      this.enabled = on;
      if (this.ctx) this.master.gain.setTargetAtTime(on && !this.muted ? 1 : 0, this.ctx.currentTime, 0.05);
      if (!on) this.stopRepeat();
    }

    /* Starter: a short, muted whir with a soft compression rhythm, then the
     * engine catches with a low thump. Well damped, as in a luxury car. */
    crank(seconds0) {
      if (!this.ctx) return;
      const E = this.eng, seconds = E.crank || seconds0;
      const ctx = this.ctx, t = ctx.currentTime;
      this.flareAt = t + seconds;
      const env = this.gain(0);
      env.connect(this.cabin);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(E.crankLvl, t + 0.08);
      env.gain.setValueAtTime(E.crankLvl, t + seconds - 0.15);
      env.gain.linearRampToValueAtTime(0, t + seconds + 0.05);

      const motor = ctx.createOscillator();
      motor.type = 'triangle';
      motor.frequency.setValueAtTime(90, t);
      motor.frequency.linearRampToValueAtTime(150, t + 0.3);
      const motorLP = this.filter('lowpass', 520, 0.8);
      const chop = this.gain(0.6);
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(9, t);
      lfo.frequency.linearRampToValueAtTime(13, t + seconds);
      const lfoAmt = this.gain(0.35);
      lfo.connect(lfoAmt).connect(chop.gain);
      motor.connect(motorLP).connect(chop).connect(env);
      motor.start(t);
      lfo.start(t);
      motor.stop(t + seconds + 0.1);
      lfo.stop(t + seconds + 0.1);

      // the engine catches: a deep, short thump under the first revs
      const thump = ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(62, t + seconds - 0.05);
      thump.frequency.exponentialRampToValueAtTime(34, t + seconds + 0.45);
      const tg = this.gain(0);
      tg.gain.setValueAtTime(0, t + seconds - 0.05);
      tg.gain.linearRampToValueAtTime(E.thump, t + seconds + 0.02);
      tg.gain.exponentialRampToValueAtTime(0.001, t + seconds + 0.6);
      thump.connect(tg).connect(this.master);
      thump.start(t + seconds - 0.05);
      thump.stop(t + seconds + 0.65);
    }

    update(st, dt) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const E = this.eng;
      // the start: revs flare as the engine catches, then settle to idle
      const ft = t - this.flareAt;
      const flare = this.flareAt > 0 && ft > 0 && ft < 2 ? E.flare * Math.min(1, ft / 0.18) * Math.exp(-Math.max(0, ft - 0.18) / 0.45) : 0;
      const rpm = Math.max(st.rpm, 1) + (st.rpm > 150 ? flare : 0);
      const fire = rpm / 60 * E.cyl / 2;         // four-stroke: cylinders / 2 pulses per rev
      for (const { o, mul } of this.orders) o.frequency.setTargetAtTime(fire * mul, t, 0.03);
      const running = st.rpm > 150;
      const load = clamp(st.throttle + flare / 4000, 0, 1);

      // quiet at idle and cruise, a refined swell under load
      this.engLP.frequency.setTargetAtTime(E.lp[0] + rpm * E.lp[1] + load * E.lp[2], t, 0.08);
      const lvl = running ? E.level[0] + load * E.level[1] + (rpm / 6000) * E.level[2] : 0;
      this.engBus.gain.setTargetAtTime(lvl, t, running ? 0.08 : 0.35);
      this.roughAmt.gain.setTargetAtTime(running ? lvl * 0.12 : 0, t, 0.1);
      this.intakeBP.frequency.setTargetAtTime(E.intake[2] + rpm * E.intake[3], t, 0.12);
      this.intakeGain.gain.setTargetAtTime(running ? E.intake[0] + load * E.intake[1] : 0, t, 0.12);
      const boost = running ? clamp((rpm - 1600) / 3000, 0, 1) * load : 0;
      this.turboBP.frequency.setTargetAtTime(1800 + rpm * 0.45, t, 0.2);
      this.turboGain.gain.setTargetAtTime(E.turbo * boost, t, 0.25);

      const v = st.speed;
      this.tyreGain.gain.setTargetAtTime(Math.min(0.2, Math.pow(v / 110, 1.2) * 0.13), t, 0.3);
      this.rumbleGain.gain.setTargetAtTime(Math.min(0.32, Math.pow(v / 110, 1.1) * 0.2), t, 0.3);
      this.windGain.gain.setTargetAtTime(Math.min(0.16, Math.pow(v / 140, 2.4) * 0.14), t, 0.4);
      this.windBP.frequency.setTargetAtTime(900 + v * 7, t, 0.4);
    }

    /* A soft mallet tone: fundamental + inharmonic partials, exponential decay. */
    bell(f, at, level, decay, partials) {
      const ctx = this.ctx;
      const t0 = ctx.currentTime + at;
      const g = this.gain(0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(level, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + decay);
      g.connect(this.master);
      for (const [mul, amp] of partials || [[1, 1], [2.0, 0.25], [3.01, 0.08], [4.2, 0.04]]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * mul;
        const og = this.gain(amp);
        o.connect(og).connect(g);
        o.start(t0);
        o.stop(t0 + decay + 0.05);
      }
    }

    beep(f, at, len, level) {
      const ctx = this.ctx;
      const t0 = ctx.currentTime + at;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const lp = this.filter('lowpass', f * 2.2, 0.7);
      const g = this.gain(0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(level, t0 + 0.008);
      g.gain.setValueAtTime(level, t0 + len - 0.02);
      g.gain.linearRampToValueAtTime(0, t0 + len);
      o.connect(lp).connect(g).connect(this.master);
      o.start(t0);
      o.stop(t0 + len + 0.02);
    }

    /* a dark hall for the start/stop signatures (built once) */
    hall() {
      if (this._hall) return this._hall;
      const ctx = this.ctx, sec = 3.2, n = ctx.sampleRate * sec;
      const buf = ctx.createBuffer(2, n, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
      }
      const cv = ctx.createConvolver();
      cv.buffer = buf;
      const tone = this.filter('lowpass', 2600, 0.5);
      const wet = this.gain(0.42);
      cv.connect(tone).connect(wet).connect(this.master);
      this._hall = cv;
      return cv;
    }

    /* A slow, warm pad: two detuned triangles per note through a low-pass that
     * opens (or closes) over the swell, plus a dry and a hall send. */
    pad(notes, at, o) {
      const ctx = this.ctx, t0 = ctx.currentTime + at;
      const { attack = 0.9, hold = 0.8, release = 3.2, level = 0.05, lp = [260, 1800], sweep = 1.6 } = o || {};
      const end = t0 + attack + hold + release;
      const lpf = this.filter('lowpass', lp[0], 0.6);
      lpf.frequency.setValueAtTime(lp[0], t0);
      lpf.frequency.exponentialRampToValueAtTime(lp[1], t0 + sweep);
      const g = this.gain(0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(level, t0 + attack);
      g.gain.setValueAtTime(level, t0 + attack + hold);
      g.gain.exponentialRampToValueAtTime(0.0003, end);
      lpf.connect(g);
      g.connect(this.master);
      g.connect(this.hall());
      notes.forEach(([f, amp = 1]) => {
        for (const det of [-5, 5]) {
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.value = f;
          osc.detune.value = det;
          const og = this.gain(amp * 0.5);
          osc.connect(og).connect(lpf);
          osc.start(t0);
          osc.stop(end + 0.1);
        }
      });
    }

    /* a felt-soft low sine swell under the chord */
    sub(f, at, level, attack, len) {
      const ctx = this.ctx, t0 = ctx.currentTime + at;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = this.gain(0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(level, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0003, t0 + len);
      osc.connect(g).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + len + 0.1);
    }

    /* a restrained, warm bell with a hall tail */
    softBell(f, at, level, decay) {
      const ctx = this.ctx, t0 = ctx.currentTime + at;
      const g = this.gain(0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(level, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0004, t0 + decay);
      const lp = this.filter('lowpass', 2400, 0.5);
      g.connect(lp);
      lp.connect(this.master);
      lp.connect(this.hall());
      for (const [mul, amp] of [[1, 1], [2.0, 0.12], [3.0, 0.03]]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f * mul;
        const og = this.gain(amp);
        osc.connect(og).connect(g);
        osc.start(t0);
        osc.stop(t0 + decay + 0.05);
      }
    }

    /* Start-up signature: a deep, slowly opening D-flat major 9 chord over a
     * sub swell, then two quiet bells as the welcome words land. */
    welcome() {
      if (!this.ctx) return;
      this.sub(34.65, 0, 0.16, 0.7, 4.6);                                     // Db1
      this.pad([[69.3, 1], [103.8, 0.8], [138.6, 0.7], [174.6, 0.5], [207.7, 0.45]], 0, { attack: 1.1, hold: 0.9, release: 3.4, level: 0.07, lp: [180, 1500], sweep: 1.8 });
      this.pad([[277.2, 0.6], [311.1, 0.5], [415.3, 0.4]], 0.7, { attack: 1.0, hold: 0.6, release: 3.0, level: 0.03, lp: [400, 2200], sweep: 1.4 });
      this.softBell(554.4, 1.25, 0.032, 3.6);                                 // Db5
      this.softBell(830.6, 1.7, 0.022, 3.4);                                  // Ab5
    }

    /* Switch-off signature: the chord settles downward and closes, like a
     * door shutting on a quiet cabin. */
    goodbye() {
      if (!this.ctx) return;
      this.softBell(622.3, 0, 0.026, 2.8);                                    // Eb5
      this.softBell(415.3, 0.38, 0.026, 3.0);                                 // Ab4
      this.pad([[103.8, 0.9], [138.6, 0.7], [207.7, 0.5], [277.2, 0.35]], 0.1, { attack: 0.5, hold: 0.4, release: 2.6, level: 0.055, lp: [1400, 220], sweep: 2.4 });
      this.pad([[69.3, 1], [103.8, 0.6], [174.6, 0.4]], 0.9, { attack: 0.6, hold: 0.3, release: 2.8, level: 0.05, lp: [700, 160], sweep: 2.6 });
      this.sub(34.65, 0.9, 0.13, 0.5, 3.8);
    }

    /* The e-Care task is complete: a low swell, a broad D-flat chord that opens slowly,
     * a rising fifth in quiet bells and a soft low gong under the check mark. */
    finale() {
      if (!this.ctx) return;
      this.sub(34.65, 0, 0.17, 1.4, 7.5);
      this.pad([[69.3, 1], [103.8, 0.8], [138.6, 0.75], [174.6, 0.55], [207.7, 0.5], [277.2, 0.35]], 0.2, { attack: 1.8, hold: 2.2, release: 4.2, level: 0.075, lp: [160, 1700], sweep: 2.6 });
      this.pad([[349.2, 0.45], [415.3, 0.4], [554.4, 0.3]], 1.6, { attack: 1.4, hold: 1.4, release: 3.6, level: 0.026, lp: [500, 2600], sweep: 1.8 });
      this.softBell(415.3, 1.2, 0.028, 3.6);
      this.softBell(554.4, 1.75, 0.03, 3.8);
      this.softBell(830.6, 2.5, 0.024, 4.2);                                  // as the check is drawn
      this.softBell(69.3, 2.5, 0.06, 5.5);                                    // low gong
    }

    /* The end of the demo: everything goes silent (and comes back for the next run). */
    mute(on) {
      this.muted = !!on;
      if (on) this.stopRepeat();
      if (this.ctx) this.master.gain.setTargetAtTime(on ? 0 : this.enabled ? 1 : 0, this.ctx.currentTime, on ? 0.12 : 0.05);
    }

    duck(on) {
      on = !!on;
      if (on === this.ducked) return;
      this.ducked = on;
      if (this.ctx && this.duckG) this.duckG.gain.setTargetAtTime(on ? 0.32 : 1, this.ctx.currentTime, on ? 0.35 : 0.8);
    }

    stopRepeat() {
      if (this.repeat) { clearInterval(this.repeat); this.repeat = null; }
    }

    /* Warning (red): urgent triple beep, repeated. Caution (amber): single soft chime. */
    chime(level, id) {
      if (!this.ctx) return;
      this.stopRepeat();
      if (level === 'red') {
        if (id === 'seatbelt' || id === 'airbag') {
          let n = 0;
          const ding = () => { this.bell(1480, 0, 0.16, 0.5, [[1, 1], [2.7, 0.1]]); if (++n >= 10) this.stopRepeat(); };
          ding();
          this.repeat = setInterval(ding, 520);
          return;
        }
        const burst = (at) => { for (let i = 0; i < 3; i++) this.beep(2050, at + i * 0.15, 0.09, 0.07); };
        burst(0);
        burst(0.75);
        this.bell(1046, 1.4, 0.1, 1.2);
      } else {
        this.bell(1318.5, 0, 0.13, 1.5);
      }
    }

    tick() {
      if (!this.ctx) return;
      this.bell(2093, 0, 0.05, 0.12, [[1, 1]]);
    }

    click() {
      if (!this.ctx) return;
      const ctx = this.ctx, t0 = ctx.currentTime;
      const n = this.noise(1);
      const bp = this.filter('bandpass', 2600, 3);
      const g = this.gain(0);
      g.gain.setValueAtTime(0.25, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04);
      n.connect(bp).connect(g).connect(this.master);
      n.stop(t0 + 0.05);
    }
  }

  SimAudio.ENGINES = ENGINES;
  window.SimAudio = SimAudio;
})();
