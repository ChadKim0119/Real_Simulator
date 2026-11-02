/* Demo wall definition (21:9 = 2560x1080, the usual ultrawide signal; 63:9 = 7560x1080) shared by wall.html and the monitor test mode:
 * panels, canvas sizes and default layouts (canvas pixels, height 1080).
 *  21:9 — top row the customer side and the conversation, bottom row the two
 *         detailed screens (flow 16:9, CCW 2:1) at the larger size;
 *  63:9 — one row in story order: customer → systems → support center.
 * design: the size each page is drawn for, to estimate text size on screen. */
(function () {
  'use strict';
  const H = 1080;
  const RATIO = { 21: { w: 2560, name: '21:9' }, 63: { w: 7560, name: '63:9' } };
  const PANELS = {
    cockpit: { src: 'index.html?stage=1', t: '고객 차량 · 계기판', design: [1920, 1080] },
    hu: { src: 'hu.html', t: '헤드유닛 (HU)', design: [1920, 1080] },
    flow: { src: 'flow.html', t: '데이터 흐름', design: [1920, 1080] },
    talk: { src: 'ccw.html?view=transcript&stage=1', t: '상담 대화', design: null },
    ccw: { src: 'ccw.html?view=app&stage=1', t: 'e-Care 고객지원실 (CCW)', design: [1920, 960] },
  };
  const DEFAULTS = {
    21: { cockpit: [0, 0, 860, 472], hu: [860, 0, 860, 472], talk: [1720, 0, 840, 472], flow: [0, 472, 1280, 608], ccw: [1280, 472, 1280, 608] },
    63: { cockpit: [0, 0, 1680, 1080], hu: [1680, 0, 1440, 1080], flow: [3120, 0, 1800, 1080], ccw: [4920, 0, 1800, 1080], talk: [6720, 0, 840, 1080] },
  };
  /** the layout saved in this browser for a ratio, over the defaults */
  function layoutOf(r) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(`wall-layout-${r}`)) || {}; } catch (e) { /* none */ }
    return Object.assign({}, DEFAULTS[r], saved);
  }
  window.WallDef = { H, RATIO, PANELS, DEFAULTS, layoutOf };
})();
