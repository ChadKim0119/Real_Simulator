/* Synthesised engine, starter, road/wind noise and cluster chimes (Web Audio). */
(function () {
  'use strict';

  class SimAudio {
    constructor() {
      this.ctx = null;
      this.enabled = true;
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
      this.master.gain.value = this.enabled ? 0.9 : 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);

      // engine: firing-frequency sawtooths through a soft clipper and low-pass
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineLP = ctx.createBiquadFilter();
      this.engineLP.type = 'lowpass';
      this.engineLP.Q.value = 2.2;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        const x = i / 512 - 1;
        curve[i] = Math.tanh(x * 2.4);
      }
      shaper.curve = curve;
      const sum = ctx.createGain();
      sum.gain.value = 0.35;
      sum.connect(shaper).connect(this.engineLP).connect(this.engineGain).connect(this.master);
      this.oscs = [
        { type: 'sawtooth', mul: 1, gain: 0.9 },
        { type: 'sawtooth', mul: 2, gain: 0.45, detune: 7 },
        { type: 'square', mul: 0.5, gain: 0.35 },
        { type: 'sine', mul: 4, gain: 0.12 },
      ].map((o) => {
        const osc = ctx.createOscillator();
        osc.type = o.type;
        osc.frequency.value = 25 * o.mul;
        if (o.detune) osc.detune.value = o.detune;
        const g = ctx.createGain();
        g.gain.value = o.gain;
        osc.connect(g).connect(sum);
        osc.start();
        return { osc, mul: o.mul };
      });

      // shared noise source
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let b = 0;
      for (let i = 0; i < d.length; i++) {
        b = 0.97 * b + 0.03 * (Math.random() * 2 - 1);
        d[i] = b * 6;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      noise.start();

      this.roadGain = ctx.createGain();
      this.roadGain.gain.value = 0;
      const roadLP = ctx.createBiquadFilter();
      roadLP.type = 'lowpass';
      roadLP.frequency.value = 420;
      noise.connect(roadLP).connect(this.roadGain).connect(this.master);

      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      const windBP = ctx.createBiquadFilter();
      windBP.type = 'bandpass';
      windBP.frequency.value = 900;
      windBP.Q.value = 0.4;
      noise.connect(windBP).connect(this.windGain).connect(this.master);

      // starter motor: noise chopped by a fast square LFO
      this.starterGain = ctx.createGain();
      this.starterGain.gain.value = 0;
      const starterBP = ctx.createBiquadFilter();
      starterBP.type = 'bandpass';
      starterBP.frequency.value = 260;
      starterBP.Q.value = 1.2;
      const chop = ctx.createGain();
      chop.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 13;
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = 0.5;
      lfo.connect(lfoAmt).connect(chop.gain);
      lfo.start();
      noise.connect(starterBP).connect(chop).connect(this.starterGain).connect(this.master);
    }

    setEnabled(on) {
      this.enabled = on;
      if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
    }

    crank(seconds) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const g = this.starterGain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(0.55, t + 0.06);
      g.setValueAtTime(0.55, t + seconds - 0.1);
      g.linearRampToValueAtTime(0, t + seconds);
    }

    update(st) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const fire = Math.max(st.rpm, 1) / 60 * 2; // 4-cylinder, 4-stroke
      for (const o of this.oscs) o.osc.frequency.setTargetAtTime(fire * o.mul, t, 0.03);
      const running = st.rpm > 120;
      const load = st.throttle;
      this.engineLP.frequency.setTargetAtTime(180 + st.rpm * 0.12 + load * 900, t, 0.05);
      this.engineGain.gain.setTargetAtTime(running ? 0.16 + load * 0.22 + st.rpm / 8000 * 0.12 : 0, t, running ? 0.06 : 0.25);
      const v = st.speed;
      this.roadGain.gain.setTargetAtTime(Math.min(0.5, Math.pow(v / 120, 1.3) * 0.38), t, 0.2);
      this.windGain.gain.setTargetAtTime(Math.min(0.35, Math.pow(v / 140, 2.2) * 0.3), t, 0.3);
    }

    chime(level) {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const tones = level === 'red' ? [[1318.5, 0], [987.8, 0.22], [1318.5, 0.6], [987.8, 0.82]] : [[1174.7, 0], [880, 0.2]];
      for (const [f, dt] of tones) {
        const t0 = ctx.currentTime + dt;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.22, t0 + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0008, t0 + 1.1);
        g.connect(this.master);
        for (const [mul, amp] of [[1, 1], [2.76, 0.18], [5.4, 0.05]]) {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = f * mul;
          const og = ctx.createGain();
          og.gain.value = amp;
          o.connect(og).connect(g);
          o.start(t0);
          o.stop(t0 + 1.2);
        }
      }
    }

    click() {
      if (!this.ctx) return;
      const ctx = this.ctx, t0 = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(1900, t0);
      o.frequency.exponentialRampToValueAtTime(600, t0 + 0.03);
      g.gain.setValueAtTime(0.12, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
      o.connect(g).connect(this.master);
      o.start(t0);
      o.stop(t0 + 0.06);
    }
  }

  window.SimAudio = SimAudio;
})();
