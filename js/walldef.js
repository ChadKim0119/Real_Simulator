/* Demo wall definition shared by wall.html, the control panel and the monitor
 * test mode. Three screen modes, each a canvas 1080 high tiled into five panels:
 *   21  — 21:9, 2560x1080   169 — 16:9, 1920x1080   63 — 63:9 (7:1), 7560x1080
 * A layout is a tree of splits: { v: 2, tree } where a node is
 *   { d: 'x' | 'y', at, a, b }  — a cut at `at` (canvas px) across x or y, `a`
 *                                  before it and `b` after it
 *   { p: 'car' }                — a panel
 * The conversation is drawn tall and narrow; at 63:9 every panel gets its own
 * full-height column. Moving a cut grows one side and shrinks the other.
 * swap() exchanges two panels and then re-solves the cuts so every panel keeps
 * the ratio (and roughly the size) it had before.
 * ideal: the panel content's own ratio, used to snap cuts.
 * design: the size a page is drawn for, to estimate text size on screen. */
(function () {
  'use strict';
  const H = 1080, GAP = 10, MINW = 160;
  const PANELS = {
    car: { src: 'index.html?stage=1&hu=1', t: '고객 차량 · 계기판 · 헤드유닛', ideal: 2300 / 941, design: [2300, 941] },
    flow: { src: 'flow.html', t: '데이터 흐름', ideal: 16 / 9, design: [1920, 1080] },
    ccw: { src: 'ccw.html?view=office&stage=1', t: 'e-Care 고객지원실 (CCW)', ideal: 2, design: [1920, 960] },
    talk: { src: 'ccw.html?view=transcript&stage=1', t: '상담 대화', ideal: null, design: null },
    dms: { src: 'dms.html?stage=1', t: '서비스센터 DMS', ideal: 16 / 9, design: [1920, 1080] },
  };
  const X = (at, a, b) => ({ d: 'x', at, a, b }), Y = (at, a, b) => ({ d: 'y', at, a, b }), P = (p) => ({ p });
  const MODES = {
    21: {
      W: 2560, name: '21:9', desc: '울트라와이드 2560×1080',
      // car over the CCW | data flow over the DMS | the conversation, tall and narrow
      layout: { v: 2, tree: X(1250, Y(512, P('car'), P('ccw')), X(2120, Y(490, P('flow'), P('dms')), P('talk'))) },
    },
    169: {
      W: 1920, name: '16:9', desc: '일반 모니터 · TV · 프로젝터 1920×1080',
      // car over (data flow | CCW) | DMS over the conversation, tall and narrow
      layout: { v: 2, tree: X(1520, Y(623, P('car'), X(812, P('flow'), P('ccw'))), Y(232, P('dms'), P('talk'))) },
    },
    63: {
      W: 7560, name: '63:9', desc: '초광폭 LED 월 7560×1080',
      // every panel in its own column: car | data flow | CCW | DMS | conversation
      layout: { v: 2, tree: X(2135, P('car'), X(3691, P('flow'), X(5441, P('ccw'), X(6997, P('dms'), P('talk'))))) },
    },
  };
  const clone = (v) => JSON.parse(JSON.stringify(v));

  /* ---------------- the tree ---------------- */
  const leaves = (n, out = []) => { if (n.p) out.push(n.p); else { leaves(n.a, out); leaves(n.b, out); } return out; };
  const nodes = (n, out = []) => { if (!n.p) { out.push(n); nodes(n.a, out); nodes(n.b, out); } return out; };
  function clampAt(n, [x0, y0, x1, y1]) {
    const a0 = n.d === 'x' ? x0 : y0, a1 = n.d === 'x' ? x1 : y1;
    const lo = a0 + MINW, hi = a1 - MINW;
    return lo > hi ? (a0 + a1) / 2 : Math.max(lo, Math.min(hi, n.at));
  }
  /** walk the tree with each node's region [x0, y0, x1, y1]; cuts kept inside their regions */
  function walk(n, r, fn) {
    if (n.p) { fn(n, r); return; }
    const [x0, y0, x1, y1] = r;
    const at = clampAt(n, r);
    fn(n, r, at);
    walk(n.a, n.d === 'x' ? [x0, y0, at, y1] : [x0, y0, x1, at], fn);
    walk(n.b, n.d === 'x' ? [at, y0, x1, y1] : [x0, at, x1, y1], fn);
  }
  /** keep every cut inside its region (after a parent moved) */
  function normalize(L, m) {
    walk(L.tree, [0, 0, MODES[m].W, H], (n, r, at) => { if (!n.p) n.at = Math.round(at); });
    return L;
  }
  /** panel -> [x, y, w, h] on the canvas, gutters taken out */
  function rects(L, m) {
    const W = MODES[m].W, g = GAP / 2, out = {};
    walk(L.tree, [0, 0, W, H], (n, r) => {
      if (!n.p) return;
      let [x0, y0, x1, y1] = r;
      if (x0 > 0) x0 += g; if (x1 < W) x1 -= g; if (y0 > 0) y0 += g; if (y1 < H) y1 -= g;
      out[n.p] = [x0, y0, x1 - x0, y1 - y0].map(Math.round);
    });
    return out;
  }
  /** every cut with its id (path), axis, region and position — for the split handles */
  function cuts(L, m) {
    const out = [];
    const rec = (n, r, id) => {
      if (n.p) return;
      const [x0, y0, x1, y1] = r;
      const lo = (n.d === 'x' ? x0 : y0) + MINW, hi = (n.d === 'x' ? x1 : y1) - MINW;
      const at = clampAt(n, r);
      out.push({ id, node: n, d: n.d, at, lo, hi, r });
      rec(n.a, n.d === 'x' ? [x0, y0, at, y1] : [x0, y0, x1, at], id + 'a');
      rec(n.b, n.d === 'x' ? [at, y0, x1, y1] : [x0, at, x1, y1], id + 'b');
    };
    rec(L.tree, [0, 0, MODES[m].W, H], 'n');
    return out;
  }

  /** swap two panels, then move the cuts so each panel keeps the ratio and
   *  (more loosely) the size it had before — coordinate descent over the cuts */
  function swap(L, m, p, q) {
    const before = rects(L, m);
    const T = clone(L);
    for (const n of (function all(n, o = []) { o.push(n); if (!n.p) { all(n.a, o); all(n.b, o); } return o; })(T.tree)) {
      if (n.p === p) n.p = q; else if (n.p === q) n.p = p;
    }
    const want = {};
    for (const k in before) { const [, , w, h] = before[k]; want[k] = { r: Math.log(w / h), a: Math.log(w * h) }; }
    const cost = () => {
      const R = rects(T, m);
      let c = 0;
      for (const k in R) { const [, , w, h] = R[k]; c += (Math.log(w / h) - want[k].r) ** 2 + 0.15 * (Math.log(w * h) - want[k].a) ** 2; }
      return c;
    };
    const ns = nodes(T.tree);
    const get = () => ns.map((n) => n.at), put = (v) => ns.forEach((n, i) => { n.at = v[i]; });
    for (let pass = 0; pass < 5; pass++) {
      for (const n of ns) {
        const c = cuts(T, m).find((x) => x.node === n);
        const keep = get();
        let best = keep, bc = Infinity;
        for (let v = c.lo; v <= c.hi; v += 10) {
          put(keep); n.at = v; normalize(T, m);
          const cc = cost();
          if (cc < bc) { bc = cc; best = get(); }
        }
        put(best);
      }
    }
    for (const n of ns) n.at = Math.round(n.at / 10) * 10;
    return normalize(T, m);
  }

  /* ---------------- persistence ---------------- */
  function mode() {
    const q = new URLSearchParams(location.search).get('mode');
    if (MODES[q]) return q;
    try { const v = JSON.parse(localStorage.getItem('wall-mode')); if (MODES[v]) return String(v); } catch (e) { /* none */ }
    return null;                                  // not chosen yet
  }
  function setMode(m) { try { localStorage.setItem('wall-mode', JSON.stringify(m)); } catch (e) { /* private mode */ } }
  const valid = (v) => !!(v && v.v === 2 && v.tree && leaves(v.tree).sort().join() === Object.keys(PANELS).sort().join());
  function load(m) {
    try {
      const v = JSON.parse(localStorage.getItem(`wall-layout-${m}`));
      if (valid(v)) return normalize(v, m);
    } catch (e) { /* none saved */ }
    return clone(MODES[m].layout);
  }
  function save(m, L) { try { localStorage.setItem(`wall-layout-${m}`, JSON.stringify(L)); } catch (e) { /* private mode */ } }
  window.WallDef = { H, GAP, MINW, PANELS, MODES, mode, setMode, load, save, rects, cuts, swap, normalize, valid };
})();
