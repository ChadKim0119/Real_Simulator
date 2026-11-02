/* Demo wall definition shared by wall.html, the control panel and the monitor
 * test mode. Two screen modes, each a canvas 1080 high tiled into four panels:
 *   21  — 21:9, 2560x1080: two columns, each split into two rows
 *   169 — 16:9, 1920x1080: two rows, each split into two columns
 * A layout is { dir, o, i0, i1, slots }: the outer split o (x for columns,
 * y for rows), the inner splits i0 / i1 inside the first / second part, and
 * which panel sits in each cell (s00, s01 in the first part, s10, s11 in the
 * second). Moving a split grows one panel and shrinks its neighbour.
 * ideal: the panel content's own ratio, used to snap splits.
 * design: the size a page is drawn for, to estimate text size on screen. */
(function () {
  'use strict';
  const H = 1080, GAP = 10;
  const PANELS = {
    car: { src: 'index.html?stage=1&hu=1', t: '고객 차량 · 계기판 · 헤드유닛', ideal: 2300 / 941, design: [2300, 941] },
    flow: { src: 'flow.html', t: '데이터 흐름', ideal: 16 / 9, design: [1920, 1080] },
    ccw: { src: 'ccw.html?view=app&stage=1', t: 'e-Care 고객지원실 (CCW)', ideal: 2, design: [1920, 960] },
    talk: { src: 'ccw.html?view=transcript&stage=1', t: '상담 대화', ideal: null, design: null },
  };
  const MODES = {
    21: {
      W: 2560, name: '21:9', desc: '울트라와이드 2560×1080',
      // left: the car (wide) over the conversation; right: the data flow (16:9) over the CCW
      layout: { dir: 'cols', o: 1480, i0: 610, i1: 610, slots: { s00: 'car', s01: 'talk', s10: 'flow', s11: 'ccw' } },
    },
    169: {
      W: 1920, name: '16:9', desc: '일반 모니터 · TV · 프로젝터 1920×1080',
      // top: the car (wide) beside the conversation; bottom: the data flow (16:9) beside the CCW
      layout: { dir: 'rows', o: 540, i0: 1310, i1: 960, slots: { s00: 'car', s01: 'talk', s10: 'flow', s11: 'ccw' } },
    },
  };
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function mode() {
    const q = new URLSearchParams(location.search).get('mode');
    if (MODES[q]) return q;
    try { const v = JSON.parse(localStorage.getItem('wall-mode')); if (MODES[v]) return String(v); } catch (e) { /* none */ }
    return null;                                  // not chosen yet
  }
  function setMode(m) { try { localStorage.setItem('wall-mode', JSON.stringify(m)); } catch (e) { /* private mode */ } }
  function load(m) {
    try {
      const v = JSON.parse(localStorage.getItem(`wall-layout-${m}`));
      if (v && v.slots && v.dir === MODES[m].layout.dir && Object.values(v.slots).sort().join() === Object.keys(PANELS).sort().join()) return v;
    } catch (e) { /* none saved */ }
    return clone(MODES[m].layout);
  }
  function save(m, L) { try { localStorage.setItem(`wall-layout-${m}`, JSON.stringify(L)); } catch (e) { /* private mode */ } }
  /** panel -> [x, y, w, h] on the canvas, gutters taken out */
  function rects(L, m) {
    const W = MODES[m].W, g = GAP / 2;
    const c = L.dir === 'cols'
      ? { s00: [0, 0, L.o - g, L.i0 - g], s01: [0, L.i0 + g, L.o - g, H - L.i0 - g], s10: [L.o + g, 0, W - L.o - g, L.i1 - g], s11: [L.o + g, L.i1 + g, W - L.o - g, H - L.i1 - g] }
      : { s00: [0, 0, L.i0 - g, L.o - g], s01: [L.i0 + g, 0, W - L.i0 - g, L.o - g], s10: [0, L.o + g, L.i1 - g, H - L.o - g], s11: [L.i1 + g, L.o + g, W - L.i1 - g, H - L.o - g] };
    const out = {};
    for (const s in L.slots) out[L.slots[s]] = c[s].map(Math.round);
    return out;
  }
  window.WallDef = { H, GAP, PANELS, MODES, mode, setMode, load, save, rects };
})();
