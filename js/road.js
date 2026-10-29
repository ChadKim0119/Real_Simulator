/* The road the car drives on, shared by the windshield view, the cluster map,
 * the steering wheel and the cruise speed, so every corner shows up everywhere.
 *
 * Built from a curvature profile (straights, easement spirals, arcs, S-bends)
 * and integrated into a 2D centre line. World axes: X east, Y north; heading
 * is measured clockwise from north. s = distance along the road in metres. */
(function () {
  'use strict';

  const DS = 1;                   // sample spacing (m)
  const R_MIN = 110;              // tightest corner: keeps the wheel within ~24°
  const K = [0], TH = [0], X = [0], Y = [0];

  // deterministic random sequence so the road is the same on every visit
  let seed = 20261028;
  const rnd = () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const pick = (a, b) => a + (b - a) * rnd();

  function push(k, len) {
    for (let i = 0; i < len; i++) {
      const n = K.length - 1;
      const th = TH[n] + K[n] * DS;
      K.push(typeof k === 'function' ? k(i / len) : k);
      TH.push(th);
      X.push(X[n] + Math.sin(th) * DS);
      Y.push(Y[n] + Math.cos(th) * DS);
    }
  }

  function corner(dir, R, angleDeg) {
    const k = dir / R;
    const T = Math.round(R < 200 ? pick(45, 70) : pick(60, 110));          // spiral length
    const arc = Math.max(10, Math.round(R * angleDeg * Math.PI / 180 - T));
    push((q) => k * q, T);
    push(k, arc);
    push((q) => k * (1 - q), T);
  }

  function addSection() {
    push(0, Math.round(pick(70, 220)));
    const r = rnd();
    const dir = rnd() < 0.5 ? -1 : 1;
    if (r < 0.35) corner(dir, pick(300, 650), pick(20, 45));             // sweeping bend
    else if (r < 0.7) corner(dir, pick(R_MIN, 190), pick(45, 85));       // proper corner
    else {                                                                // S-bend
      corner(dir, pick(R_MIN + 20, 220), pick(30, 55));
      push(0, Math.round(pick(25, 70)));
      corner(-dir, pick(R_MIN + 20, 220), pick(30, 55));
    }
  }

  // corners from the very start: a short straight while pulling away, then a
  // right-hander, a left-hander and an S-bend before the random sections begin
  push(0, 70);
  corner(1, 150, 55);
  push(0, 60);
  corner(-1, 135, 65);
  push(0, 90);
  corner(1, 170, 40);
  push(0, 35);
  corner(-1, 170, 40);
  function ensure(s) { while (K.length - 2 < s) addSection(); }

  function sample(arr, s) {
    if (s <= 0) return arr[0];
    ensure(s + 2);
    const i = Math.floor(s / DS), f = s / DS - i;
    return arr[i] + (arr[i + 1] - arr[i]) * f;
  }

  const Road = {
    LANE: 1.8,                     // the car keeps to the middle of the right-hand lane
    NAME: '456번 지방도',
    JUNCTION_EVERY: 1800,

    curvature: (s) => sample(K, s),
    heading: (s) => sample(TH, s),
    pos: (s) => [sample(X, s), sample(Y, s)],

    /** Point `z` m further along the road, `lat` m right of the centre line,
     *  expressed in the frame of a car at `s`: f = forward, u = right (m). */
    local(s, z, lat) {
      const th0 = Road.heading(s), th1 = Road.heading(s + z);
      const [x0, y0] = Road.pos(s), [x1, y1] = Road.pos(s + z);
      const px = x1 + Math.cos(th1) * (lat || 0) - x0;
      const py = y1 - Math.sin(th1) * (lat || 0) - y0;
      return { f: px * Math.sin(th0) + py * Math.cos(th0), u: px * Math.cos(th0) - py * Math.sin(th0) };
    },

    /** Comfortable speed (km/h) for the corner at `s` (lateral 2.3 m/s²). */
    cornerSpeed(s) {
      const k = Math.abs(Road.curvature(s));
      return k < 1e-4 ? 999 : Math.sqrt(2.3 / k) * 3.6;
    },

    /** Speed (km/h) that still lets the car brake gently for anything ahead. */
    safeSpeed(s, v) {
      let lim = 999;
      for (let z = 0; z <= 220; z += 5) {
        const vc = Road.cornerSpeed(s + z) / 3.6;
        lim = Math.min(lim, Math.sqrt(vc * vc + 2 * 1.4 * z) * 3.6);
      }
      return lim;
    },

    /** Next corner tighter than ~R 350 within `range` m: {dist, dir, R}. */
    nextCorner(s, range) {
      for (let z = 0; z <= range; z += 5) {
        const k = Road.curvature(s + z);
        if (Math.abs(k) > 1 / 350) {
          let kmax = Math.abs(k), zz = z;
          while (zz < z + 300 && Math.abs(Road.curvature(s + zz)) >= kmax * 0.98) { kmax = Math.abs(Road.curvature(s + zz)); zz += 5; }
          return { dist: z, dir: Math.sign(k), R: 1 / kmax };
        }
      }
      return null;
    },
  };

  // named junctions for turn-by-turn guidance
  const NAMES = ['진부 IC', '월정사 입구', '대관령 삼거리', '횡계 교차로', '용평 리조트', '봉평 IC', '장평 교차로', '속사 삼거리'];
  Road.nextJunction = (s) => {
    const n = Math.floor(s / Road.JUNCTION_EVERY) + 1;
    return { name: NAMES[n % NAMES.length], dist: n * Road.JUNCTION_EVERY - s, right: n % 3 !== 0 };
  };

  ensure(4000);
  window.Road = Road;
})();
