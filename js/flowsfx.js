/* Soft sounds for the data flow (Final_Dataflow simple view and its detail board).
 *   send(f)   one message (or one burst sent at once): a quiet two-note glass tone when it
 *             leaves, a softer one when it lands — each message once, never repeated
 *   field(f)  a vehicle moved (the tow): a slow, low air swell
 *   setCall(on)  while a call is up (customer ↔ agent, dealer ↔ customer): a calm, low
 *             breathing pad under it, fading in and out
 * All of it sits well under the voices; the end of the demo (scene "end") silences it. */
(function () {
  'use strict';
  let ctx = null, out = null, pad = null, muted = false;
  const heard = new Set();
  function ac() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    out = ctx.createGain(); out.gain.value = muted ? 0 : 0.55;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    out.connect(lp).connect(ctx.destination);
    return ctx;
  }
  ['pointerdown', 'keydown'].forEach((e) => addEventListener(e, () => ac(), { passive: true }));
  // a soft sine with a slow attack and a long tail (no clicks)
  function tone(f, at, level, len) {
    const c = ac(); if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = f;
    o2.type = 'sine'; o2.frequency.value = f * 2.005;      // a faint glassy partial
    const g2 = c.createGain(); g2.gain.value = 0.18;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); o2.connect(g2).connect(g); g.connect(out);
    o.start(t); o2.start(t); o.stop(t + len + 0.05); o2.stop(t + len + 0.05);
  }
  // the pitch says where it goes: up to the people (car · phone), level to the servers, warm to the desks
  const NOTE = { car: 987.8, phone: 987.8, vdp: 659.3, vep: 659.3, cti: 740, ccw: 784, dms: 698.5, rescue: 523.3 };
  const key = (f) => `${f.t}|${f.api}|${f.from}|${f.burst || f.to}`;
  // once: a live message is heard a single time however often it is shown; play() is for a
  // replay the presenter asked for (the detail board)
  function send(f, travelMs) {
    if (!f || muted) return;
    const k = key(f);
    if (heard.has(k)) return;
    heard.add(k);
    if (heard.size > 600) heard.delete(heard.values().next().value);
    play(f, travelMs);
  }
  function play(f, travelMs) {
    if (!f || muted) return;
    if (f.field) return field();
    const n = NOTE[f.to] || 660;
    tone(n, 0, 0.05, 0.55);
    tone(n * 1.5, 0.07, 0.03, 0.5);                         // a fifth above: "sent"
    if (f.from !== f.to) tone(n * 0.75, (travelMs || 1400) / 1000, 0.028, 0.7);   // softly lands
  }
  function field() {
    const c = ac(); if (!c) return;
    const t = c.currentTime, len = 1.6;
    const b = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(); s.buffer = b;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(220, t); bp.frequency.linearRampToValueAtTime(520, t + len);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.6); g.gain.linearRampToValueAtTime(0, t + len);
    s.connect(bp).connect(g).connect(out); s.start(t);
  }
  function setCall(on) {
    const c = on ? ac() : ctx;
    if (!c) return;
    if (on && !pad && !muted) {
      const g = c.createGain(); g.gain.value = 0;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.35; lg.gain.value = 0.006;
      const osc = [196, 293.7, 392.4].map((f, i) => { const o = c.createOscillator(); o.type = i ? 'sine' : 'triangle'; o.frequency.value = f; const og = c.createGain(); og.gain.value = [0.6, 0.35, 0.18][i]; o.connect(og).connect(lp); o.start(); return o; });
      lfo.connect(lg).connect(g.gain); lfo.start();
      lp.connect(g).connect(out);
      g.gain.setTargetAtTime(0.014, c.currentTime, 0.8);
      pad = { g, osc, lfo };
    } else if (!on && pad) {
      const p = pad; pad = null;
      p.g.gain.cancelScheduledValues(c.currentTime);
      p.g.gain.setTargetAtTime(0, c.currentTime, 0.6);
      setTimeout(() => { try { p.osc.forEach((o) => o.stop()); p.lfo.stop(); } catch (e) { /* stopped */ } }, 4000);
    }
  }
  function mute(on) {
    muted = !!on;
    if (on) setCall(false);
    if (ctx && out) out.gain.setTargetAtTime(on ? 0 : 0.55, ctx.currentTime, 0.2);
  }
  function reset() { heard.clear(); setCall(false); }
  if (window.Link) Link.on('stage', (d) => { if (d && d.scene) mute(d.scene === 'end'); });
  window.FlowSfx = { send, play, setCall, mute, reset };
})();
