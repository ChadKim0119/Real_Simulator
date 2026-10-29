/* Synthesised sound for a luxury SUV (Web Audio, no samples): a smooth V8
 * heard through a well-insulated cabin, a short refined starter, soft road,
 * tyre and wind noise, and the cluster's chimes. */
(function () {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  class SimAudio {
    constructor() {
      this.ctx = null;
      this.enabled = true;
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
      const body = this.filter('peaking', 85, 1.0);
      body.gain.value = 6;                         // chassis resonance: felt more than heard
      const sum = this.gain(0.42);
      sum.connect(shaper).connect(body).connect(this.engLP).connect(this.engBus).connect(this.cabin);

      this.orders = [[0.5, 0.32, 'sine'], [1, 1.0, 'sine'], [1.5, 0.22, 'sine'], [2, 0.36, 'triangle'], [3, 0.08, 'sine'], [4, 0.04, 'sine']].map(([mul, amp, type]) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = 26 * mul;
        o.detune.value = (Math.random() - 0.5) * 6;
        const g = this.gain(amp);
        o.connect(g).connect(sum);
        o.start();
        return { o, mul };
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
      if (this.ctx) this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
      if (!on) this.stopRepeat();
    }

    /* Starter: a short, muted whir with a soft compression rhythm, then the
     * engine catches with a low thump. Well damped, as in a luxury car. */
    crank(seconds) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const env = this.gain(0);
      env.connect(this.cabin);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.22, t + 0.08);
      env.gain.setValueAtTime(0.22, t + seconds - 0.15);
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
      tg.gain.linearRampToValueAtTime(0.32, t + seconds + 0.02);
      tg.gain.exponentialRampToValueAtTime(0.001, t + seconds + 0.6);
      thump.connect(tg).connect(this.master);
      thump.start(t + seconds - 0.05);
      thump.stop(t + seconds + 0.65);
    }

    update(st, dt) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const rpm = Math.max(st.rpm, 1);
      const fire = rpm / 60 * 4;                 // V8, four-stroke: 4 pulses per rev
      for (const { o, mul } of this.orders) o.frequency.setTargetAtTime(fire * mul, t, 0.03);
      const running = st.rpm > 150;
      const load = clamp(st.throttle, 0, 1);

      // quiet at idle and cruise, a refined swell under load
      this.engLP.frequency.setTargetAtTime(260 + rpm * 0.1 + load * 700, t, 0.08);
      const lvl = running ? 0.07 + load * 0.15 + (rpm / 6000) * 0.08 : 0;
      this.engBus.gain.setTargetAtTime(lvl, t, running ? 0.08 : 0.35);
      this.roughAmt.gain.setTargetAtTime(running ? lvl * 0.12 : 0, t, 0.1);
      this.intakeBP.frequency.setTargetAtTime(380 + rpm * 0.18, t, 0.12);
      this.intakeGain.gain.setTargetAtTime(running ? 0.006 + load * 0.03 : 0, t, 0.12);

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

    /* rising, shimmering arpeggio under the welcome words */
    welcome() {
      if (!this.ctx) return;
      [[523.3, 0], [659.3, 0.14], [784, 0.28], [1046.5, 0.46], [1318.5, 0.72]].forEach(([f, at], i) =>
        this.bell(f, at, 0.06 + i * 0.008, 2.2, [[1, 1], [2, 0.18], [3.01, 0.05]]));
      this.bell(2093, 1.5, 0.035, 2.4, [[1, 1], [1.5, 0.3]]);   // sparkle as the subtitle lands
    }

    /* soft falling farewell at switch-off */
    goodbye() {
      if (!this.ctx) return;
      [[1046.5, 0], [784, 0.2], [659.3, 0.42], [523.3, 0.68]].forEach(([f, at]) =>
        this.bell(f, at, 0.06, 1.8, [[1, 1], [2, 0.15]]));
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
