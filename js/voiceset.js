/* Voice sets for the call scripts: the presenter drops one recording per
 * speaker (or one of the whole conversation) and it is cut into lines at the
 * longest pauses. Cuts can be moved by hand before they are applied.
 *
 * Storage: through the LAN relay the line files are written into
 * assets/audio/user/ and every screen plays them; without the relay they are
 * kept in this browser (IndexedDB, 'idb:' paths), which is enough when the
 * call center screen runs in the same browser. */
(function () {
  'use strict';

  let ctx = null;
  const ac = () => ctx || (ctx = new (window.AudioContext || window.webkitAudioContext)());

  async function decode(arrayBuffer) {
    const buf = await ac().decodeAudioData(arrayBuffer);
    const n = buf.length, ch = buf.numberOfChannels;
    const mono = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
    // loudness per 10 ms frame, in dB
    const hop = Math.round(buf.sampleRate / 100);
    const db = new Float32Array(Math.ceil(n / hop));
    for (let f = 0; f < db.length; f++) {
      let s = 0; const a = f * hop, b = Math.min(n, a + hop);
      for (let i = a; i < b; i++) s += mono[i] * mono[i];
      db[f] = 10 * Math.log10(s / Math.max(1, b - a) + 1e-10);
    }
    const sorted = Array.from(db).sort((x, y) => x - y);
    const floor = sorted[Math.floor(sorted.length * 0.1)], peak = sorted[Math.floor(sorted.length * 0.97)];
    const thr = Math.max(floor + 0.5 * (peak - floor), peak - 30);
    return { buf, mono, sr: buf.sampleRate, hop, db, thr, dur: n / buf.sampleRate };
  }

  const loud = (a, f) => a.db[f] > a.thr;

  /** n lines -> n-1 cuts in the middle of the n-1 longest pauses (seconds). */
  function autoCuts(a, n) {
    const F = a.db.length;
    let first = 0, last = F - 1;
    while (first < F && !loud(a, first)) first++;
    while (last > first && !loud(a, last)) last--;
    const gaps = [];
    for (let f = first; f <= last; f++) {
      if (loud(a, f)) continue;
      const s = f;
      while (f <= last && !loud(a, f)) f++;
      gaps.push({ len: f - s, mid: (s + f) / 2 });
    }
    // ignore breaths shorter than 120 ms
    const pick = gaps.filter((g) => g.len >= 12).sort((x, y) => y.len - x.len).slice(0, Math.max(0, n - 1));
    return { cuts: pick.map((g) => (g.mid * a.hop) / a.sr).sort((x, y) => x - y), found: pick.length };
  }

  /** Segment between two cuts with its leading and trailing silence trimmed. */
  function segment(a, from, to) {
    let s = Math.floor((from * a.sr) / a.hop), e = Math.min(a.db.length - 1, Math.ceil((to * a.sr) / a.hop));
    while (s < e && !loud(a, s)) s++;
    while (e > s && !loud(a, e)) e--;
    const t0 = Math.max(from, (s * a.hop) / a.sr - 0.06), t1 = Math.min(to, ((e + 1) * a.hop) / a.sr + 0.15);
    return { start: t0, end: Math.max(t0 + 0.1, t1) };
  }
  function segments(a, cuts) {
    const b = [0].concat(cuts, [a.dur]);
    return b.slice(0, -1).map((x, i) => segment(a, x, b[i + 1]));
  }

  /** 16-bit mono WAV of a part of the recording. */
  function wav(a, seg) {
    const s = Math.floor(seg.start * a.sr), e = Math.min(a.mono.length, Math.ceil(seg.end * a.sr));
    const n = e - s, out = new DataView(new ArrayBuffer(44 + n * 2));
    const str = (o, t) => { for (let i = 0; i < t.length; i++) out.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
    out.setUint32(24, a.sr, true); out.setUint32(28, a.sr * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
    str(36, 'data'); out.setUint32(40, n * 2, true);
    const fade = Math.min(n / 2, Math.round(a.sr * 0.01));
    for (let i = 0; i < n; i++) {
      let v = a.mono[s + i];
      if (i < fade) v *= i / fade; else if (i > n - fade) v *= (n - i) / fade;
      out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true);
    }
    return new Blob([out], { type: 'audio/wav' });
  }

  let playing = null;
  function preview(a, seg) {
    stop();
    const c = ac();
    if (c.state === 'suspended') c.resume();
    const src = c.createBufferSource();
    src.buffer = a.buf;
    src.connect(c.destination);
    src.start(0, seg.start, seg.end - seg.start);
    playing = src;
  }
  function stop() { if (playing) { try { playing.stop(); } catch (e) { /* ended */ } playing = null; } }

  function draw(canvas, a, cuts, segs, colors) {
    const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = '#0b1220'; g.fillRect(0, 0, w, h);
    const x = (t) => (t / a.dur) * w;
    segs.forEach((s, i) => { g.fillStyle = colors[i] + '33'; g.fillRect(x(s.start), 0, x(s.end) - x(s.start), h); });
    g.fillStyle = '#9fb6d6';
    const step = a.mono.length / w;
    for (let px = 0; px < w; px++) {
      let m = 0; const s = Math.floor(px * step), e = Math.floor((px + 1) * step);
      for (let i = s; i < e; i += 4) m = Math.max(m, Math.abs(a.mono[i]));
      const y = Math.max(1, m * h * 0.46);
      g.fillRect(px, h / 2 - y, 1, y * 2);
    }
    segs.forEach((s, i) => { g.fillStyle = colors[i]; g.font = '600 12px Pretendard, sans-serif'; g.fillText(String(i + 1), x(s.start) + 4, 14); });
    cuts.forEach((t) => {
      g.fillStyle = '#ffcf4a'; g.fillRect(x(t) - 1, 0, 2, h);
      g.beginPath(); g.moveTo(x(t) - 6, h); g.lineTo(x(t) + 6, h); g.lineTo(x(t), h - 9); g.fill();
    });
  }

  /* ---------- storage ---------- */
  const DB = 'ecare-voice', STORE = 'lines';
  const idb = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  async function idbPut(key, blob) {
    const d = await idb();
    await new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(blob, key); t.oncomplete = res; t.onerror = () => rej(t.error); });
  }
  async function idbGet(key) {
    const d = await idb();
    return new Promise((res, rej) => { const r = d.transaction(STORE).objectStore(STORE).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }

  /** Saves one line file; returns the path to put in the script. */
  async function store(name, blob) {
    if (window.Link && Link.transport === 'lan') {
      const r = await fetch(`/__relay/audio?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
      if (r.ok) return (await r.json()).path;
    }
    await idbPut(name, blob);
    return `idb:${name}`;
  }

  const urls = {};
  /** Playable URL for a script path ('idb:' paths come from this browser). */
  async function url(path) {
    if (!path || !path.startsWith('idb:')) return path;
    if (urls[path]) return urls[path];
    const blob = await idbGet(path.slice(4));
    if (!blob) return null;
    return (urls[path] = URL.createObjectURL(blob));
  }

  window.VoiceSet = { decode, autoCuts, segments, wav, preview, stop, draw, store, url };
})();
