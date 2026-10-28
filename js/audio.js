/* Synthesised sound: twin-turbo V6, starter, cabin road/tyre/wind noise and
 * cluster chimes (Web Audio). Everything is generated, no samples. */
(function () {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  class SimAudio {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.boost = 0;
      this.lastThr = 0;
      this.repeat = null;
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
      this.master.connect(comp).connect(ctx.destination);

      // everything mechanical is heard through the cabin: dull it down
      this.cabin = ctx.createBiquadFilter();
      this.cabin.type = 'lowpass';
      this.cabin.frequency.value = 2600;
      this.cabin.Q.value = 0.5;
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
      // exhaust pulse spectrum: strong low orders, falling off, with a dip
      // around the 4th order that gives a V6 its slightly hollow note
      const N = 32;
      const re = new Float32Array(N), im = new Float32Array(N);
      for (let n = 1; n < N; n++) {
        let a = 1 / Math.pow(n, 0.85);
        if (n === 4) a *= 0.45;
        if (n === 3 || n === 6) a *= 1.35;
        im[n] = a * (n % 2 ? 1 : -0.8);
      }
      const pulse = ctx.createPeriodicWave(re, im);

      this.engBus = this.gain(0);
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(2048);
      for (let i = 0; i < 2048; i++) {
        const x = i / 1024 - 1;
        curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8);
      }
      shaper.curve = curve;
      shaper.oversample = '2x';
      this.engLP = this.filter('lowpass', 600, 1.1);
      const body = this.filter('peaking', 110, 0.9);
      body.gain.value = 5;
      const sum = this.gain(0.32);
      sum.connect(shaper).connect(body).connect(this.engLP).connect(this.engBus).connect(this.cabin);

      // firing order (1.0), half order (crank, uneven V6 bank firing) and 1.5 order
      this.orders = [[1, 0.9], [0.5, 0.42], [1.5, 0.28], [3, 0.08]].map(([mul, amp]) => {
        const o = ctx.createOscillator();
        o.setPeriodicWave(pulse);
        o.frequency.value = 30 * mul;
        const g = this.gain(amp);
        o.connect(g).connect(sum);
        o.start();
        return { o, mul };
      });

      // combustion roughness: slow random amplitude modulation
      const rough = this.noise(0.25);
      const roughLP = this.filter('lowpass', 30);
      this.roughAmt = this.gain(0.0);
      rough.connect(roughLP).connect(this.roughAmt).connect(this.engBus.gain);

      // intake roar + turbo whistle
      const intake = this.noise(1);
      this.intakeBP = this.filter('bandpass', 900, 0.9);
      this.intakeGain = this.gain(0);
      intake.connect(this.intakeBP).connect(this.intakeGain).connect(this.cabin);
      this.whistle = ctx.createOscillator();
      this.whistle.type = 'sine';
      this.whistle.frequency.value = 3000;
      this.whistleGain = this.gain(0);
      this.whistle.connect(this.whistleGain).connect(this.master);
      this.whistle.start();
    }

    buildRoad() {
      const tyre = this.noise(1);
      const tyreBP = this.filter('bandpass', 320, 0.6);
      this.tyreGain = this.gain(0);
      tyre.connect(tyreBP).connect(this.tyreGain).connect(this.cabin);
      const rumble = this.noise(0.5);
      const rumbleLP = this.filter('lowpass', 140, 0.8);
      this.rumbleGain = this.gain(0);
      rumble.connect(rumbleLP).connect(this.rumbleGain).connect(this.master);
      const wind = this.noise(1);
      const windHP = this.filter('highpass', 700, 0.5);
      this.windBP = this.filter('lowpass', 2200, 0.4);
      this.windGain = this.gain(0);
      wind.connect(windHP).connect(this.windBP).connect(this.windGain).connect(this.master);
    }

    setEnabled(on) {
      this.enabled = on;
      if (this.ctx) this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
      if (!on) this.stopRepeat();
    }

    /* Starter motor: whine plus the rhythmic load of each compression stroke. */
    crank(seconds) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const env = this.gain(0);
      env.connect(this.cabin);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.5, t + 0.05);
      env.gain.setValueAtTime(0.5, t + seconds - 0.12);
      env.gain.linearRampToValueAtTime(0, t + seconds);

      const motor = ctx.createOscillator();
      motor.type = 'sawtooth';
      motor.frequency.setValueAtTime(70, t);
      motor.frequency.linearRampToValueAtTime(118, t + 0.25);
      const motorBP = this.filter('bandpass', 520, 1.6);
      const chop = this.gain(0.55);
      const lfo = ctx.createOscillator();
      lfo.type = 'triangle';
      lfo.frequency.setValueAtTime(7, t);
      lfo.frequency.linearRampToValueAtTime(10.5, t + seconds);
      const lfoAmt = this.gain(0.45);
      lfo.connect(lfoAmt).connect(chop.gain);
      const lfoPitch = this.gain(14);
      lfo.connect(lfoPitch).connect(motor.frequency);
      motor.connect(motorBP).connect(chop).connect(env);

      const clatter = this.noise(1);
      const clBP = this.filter('bandpass', 1400, 2);
      const clG = this.gain(0.35);
      clatter.connect(clBP).connect(clG).connect(chop);

      motor.start(t);
      lfo.start(t);
      motor.stop(t + seconds + 0.05);
      lfo.stop(t + seconds + 0.05);
      clatter.stop(t + seconds + 0.05);

      // the engine catching: a low thump
      const thump = ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(70, t + seconds - 0.05);
      thump.frequency.exponentialRampToValueAtTime(38, t + seconds + 0.4);
      const tg = this.gain(0);
      tg.gain.setValueAtTime(0, t + seconds - 0.05);
      tg.gain.linearRampToValueAtTime(0.55, t + seconds);
      tg.gain.exponentialRampToValueAtTime(0.001, t + seconds + 0.5);
      thump.connect(tg).connect(this.master);
      thump.start(t + seconds - 0.05);
      thump.stop(t + seconds + 0.55);
    }

    update(st, dt) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const rpm = Math.max(st.rpm, 1);
      const fire = rpm / 60 * 3;                 // V6, four-stroke: 3 pulses per rev
      for (const { o, mul } of this.orders) o.frequency.setTargetAtTime(fire * mul, t, 0.025);
      const running = st.rpm > 150;
      const load = clamp(st.throttle, 0, 1);
      const targetBoost = running ? clamp(load * 1.4 - 0.25, 0, 1) * clamp((rpm - 1200) / 1800, 0, 1) : 0;
      this.boost += (targetBoost - this.boost) * (1 - Math.exp(-dt / (targetBoost > this.boost ? 0.6 : 0.15)));

      this.engLP.frequency.setTargetAtTime(220 + rpm * 0.16 + load * 1100, t, 0.05);
      const lvl = running ? 0.13 + load * 0.2 + (rpm / 6000) * 0.12 : 0;
      this.engBus.gain.setTargetAtTime(lvl, t, running ? 0.05 : 0.3);
      this.roughAmt.gain.setTargetAtTime(running ? lvl * 0.35 : 0, t, 0.1);
      this.intakeBP.frequency.setTargetAtTime(500 + rpm * 0.35, t, 0.1);
      this.intakeGain.gain.setTargetAtTime(running ? 0.02 + load * 0.05 + this.boost * 0.05 : 0, t, 0.08);
      this.whistle.frequency.setTargetAtTime(2600 + this.boost * 5200, t, 0.08);
      this.whistleGain.gain.setTargetAtTime(this.boost * 0.012, t, 0.1);

      // quick throttle lift with boost up: soft bypass-valve whoosh
      if (this.lastThr - load > 0.2 && this.boost > 0.35) this.whoosh(this.boost);
      this.lastThr = load;

      const v = st.speed;
      this.tyreGain.gain.setTargetAtTime(Math.min(0.32, Math.pow(v / 110, 1.2) * 0.22), t, 0.25);
      this.rumbleGain.gain.setTargetAtTime(Math.min(0.5, Math.pow(v / 110, 1.1) * 0.32), t, 0.25);
      this.windGain.gain.setTargetAtTime(Math.min(0.3, Math.pow(v / 140, 2.2) * 0.26), t, 0.3);
      this.windBP.frequency.setTargetAtTime(1200 + v * 12, t, 0.3);
    }

    whoosh(amount) {
      const ctx = this.ctx, t = ctx.currentTime;
      const n = this.noise(1);
      const bp = this.filter('bandpass', 2400, 1.1);
      bp.frequency.setValueAtTime(3200, t);
      bp.frequency.exponentialRampToValueAtTime(900, t + 0.4);
      const g = this.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06 * amount, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      n.connect(bp).connect(g).connect(this.cabin);
      n.stop(t + 0.5);
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

    welcome() {
      if (!this.ctx) return;
      this.bell(784, 0, 0.09, 1.6, [[1, 1], [2, 0.2]]);
      this.bell(1175, 0.16, 0.08, 1.8, [[1, 1], [2, 0.15]]);
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

  window.SimAudio = SimAudio;
})();
