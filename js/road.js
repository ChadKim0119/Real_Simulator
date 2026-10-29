/* The road the car drives on, shared by the windshield view, the cluster map
 * and the steering wheel so that every curve shows up everywhere at once.
 * s = distance along the road (m); x(s) = lateral offset of the centre line (m). */
(function () {
  'use strict';

  const A1 = 70, L1 = 420, A2 = 22, L2 = 150, P2 = 1.3;

  const Road = {
    x(s) { return A1 * Math.sin(s / L1) + A2 * Math.sin(s / L2 + P2); },
    slope(s) { return A1 / L1 * Math.cos(s / L1) + A2 / L2 * Math.cos(s / L2 + P2); },
    curvature(s) { return -A1 / (L1 * L1) * Math.sin(s / L1) - A2 / (L2 * L2) * Math.sin(s / L2 + P2); },
    heading(s) { return Math.atan(Road.slope(s)); },
    /** Lateral offset (m) of the centre line `z` metres ahead, in the car's frame. */
    ahead(s, z) {
      const c = Math.cos(Road.heading(s));
      return (Road.x(s + z) - Road.x(s) - Road.slope(s) * z) * c;
    },
    LANE: 1.8,           // the car keeps to the middle of the right-hand lane
  };

  // named junctions for turn-by-turn guidance
  const NAMES = ['진부 IC', '월정사 입구', '대관령 삼거리', '횡계 교차로', '용평 리조트', '봉평 IC', '장평 교차로', '속사 삼거리'];
  Road.JUNCTION_EVERY = 1800;
  Road.nextJunction = (s) => {
    const n = Math.floor(s / Road.JUNCTION_EVERY) + 1;
    return { name: NAMES[n % NAMES.length], dist: n * Road.JUNCTION_EVERY - s, right: n % 3 !== 0 };
  };
  Road.NAME = '456번 지방도';

  window.Road = Road;
})();
