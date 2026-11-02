/* Demo wall definition shared by wall.html, the control panel and the monitor
 * test mode: a 2560x1080 (21:9) canvas tiled into four panels.
 *
 * The layout is two columns split at cx; each column has two rows split at
 * ly (left) and ry (right); slots say which panel sits where. Moving a split
 * grows one panel and shrinks its neighbour, so panels never overlap.
 * ideal: the panel content's own ratio, used to snap the splits.
 * design: the size a page is drawn for, to estimate text size on screen. */
(function () {
  'use strict';
  const W = 2560, H = 1080, GAP = 10;
  const PANELS = {
    car: { src: 'index.html?stage=1&hu=1', t: '고객 차량 · 계기판 · 헤드유닛', ideal: 2300 / 941, design: [2300, 941] },
    flow: { src: 'flow.html', t: '데이터 흐름', ideal: 16 / 9, design: [1920, 1080] },
    ccw: { src: 'ccw.html?view=app&stage=1', t: 'e-Care 고객지원실 (CCW)', ideal: 2, design: [1920, 960] },
    talk: { src: 'ccw.html?view=transcript&stage=1', t: '상담 대화', ideal: null, design: null },
  };
  /* default: the car (wide) with the conversation under it on the left — the
   * customer's side; the data flow (16:9) over the support center on the right */
  const DEFAULT = { cx: 1480, ly: 610, ry: 610, slots: { lt: 'car', lb: 'talk', rt: 'flow', rb: 'ccw' } };
  const KEY = 'wall-layout-v3';

  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY));
      if (v && v.slots && Object.values(v.slots).sort().join() === Object.keys(PANELS).sort().join()) return v;
    } catch (e) { /* none saved */ }
    return JSON.parse(JSON.stringify(DEFAULT));
  }
  function save(L) { try { localStorage.setItem(KEY, JSON.stringify(L)); } catch (e) { /* private mode */ } }
  /** panel -> [x, y, w, h] on the canvas, gutters taken out */
  function rects(L) {
    const g = GAP / 2;
    const cell = { lt: [0, 0, L.cx - g, L.ly - g], lb: [0, L.ly + g, L.cx - g, H - L.ly - g], rt: [L.cx + g, 0, W - L.cx - g, L.ry - g], rb: [L.cx + g, L.ry + g, W - L.cx - g, H - L.ry - g] };
    const out = {};
    for (const s in L.slots) out[L.slots[s]] = cell[s].map(Math.round);
    return out;
  }
  window.WallDef = { W, H, GAP, PANELS, DEFAULT, load, save, rects };
})();
