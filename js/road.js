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


  /* ---------- the town the road runs through ----------
   * Deterministic city blocks laid out in the road's own frame (distance along
   * the road, metres right of the centre line), so the cluster map and the
   * windshield view show the same buildings. Towns alternate with countryside. */
  const hash2 = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
  const BLOCK = 72, STREET = 14, SETBACK = 11;
  const LANDMARKS = [
    { name: '강남 서비스센터', sub: 'SERVICE · DMS', band: '#2ee6cf' },
    { name: 'e-Care 상담센터', sub: 'CONTACT CENTER', band: '#ff3b4a', tall: true },
    { name: '서초 서비스센터', sub: 'SERVICE · DMS', band: '#2ee6cf' },
    { name: 'VEP 데이터센터', sub: 'TSP · KOREA', band: '#59a8ff' },
  ];
  const blockCache = new Map();
  Road.BLOCK = BLOCK;
  Road.STREET = STREET;
  Road.isUrban = (S) => { const n = Math.floor(S / BLOCK); return n >= 0 && ((n * BLOCK) % 1700) < 1080; };

  function block(n) {
    if (blockCache.has(n)) return blockCache.get(n);
    const out = [];
    const S0 = n * BLOCK + STREET / 2, S1 = (n + 1) * BLOCK - STREET / 2;
    if (Road.isUrban(n * BLOCK) && Road.isUrban((n + 1) * BLOCK - 1)) {
      for (const side of [-1, 1]) {
        const r = hash2(n, side + 3);
        const depth = 34 + hash2(n, side + 7) * 22;
        if (r < 0.16) {                                  // park with trees
          const trees = [];
          for (let i = 0; i < 9; i++) {
            trees.push({ S: S0 + 4 + hash2(n * 9 + i, side) * (S1 - S0 - 8), lat: side * (SETBACK + 3 + hash2(n * 9 + i, side + 1) * (depth - 6)), h: 6 + hash2(i, n) * 5 });
          }
          out.push({ kind: 'park', side, S0, S1, l0: side * SETBACK, l1: side * (SETBACK + depth), trees });
          continue;
        }
        if (r > 0.93) {                                  // landmark with its sign
          const lm = LANDMARKS[(n * 7 + (side > 0 ? 1 : 0)) % LANDMARKS.length];
          out.push({ kind: 'bldg', id: n * 10 + side, side, S0: S0 + 3, S1: S1 - 3, l0: side * (SETBACK + 2), l1: side * (SETBACK + depth - 4),
            h: lm.tall ? 46 : 13, lm, lit: 0.55 });
          continue;
        }
        // one to three buildings per block side, some with a stepped tower
        const lots = 1 + Math.floor(hash2(n, side + 11) * 3);
        for (let i = 0; i < lots; i++) {
          const a = S0 + (S1 - S0) * i / lots, b = S0 + (S1 - S0) * (i + 1) / lots;
          const inset = 1.5 + hash2(n * 3 + i, side) * 2.5;
          const d = depth * (0.55 + 0.45 * hash2(n * 5 + i, side + 2));
          const tall = hash2(n * 11 + i, side + 5);
          const h = tall > 0.88 ? 48 + tall * 30 : 8 + tall * 26;
          out.push({ kind: 'bldg', id: n * 10 + side * 3 + i, side, S0: a + inset, S1: b - inset,
            l0: side * (SETBACK + 1 + hash2(i, n) * 2), l1: side * (SETBACK + 1 + d), h, lit: 0.22 + 0.3 * hash2(n, i + 9),
            cool: hash2(n * 13 + i, side) < 0.3 });
        }
      }
    }
    blockCache.set(n, out);
    if (blockCache.size > 400) blockCache.delete(blockCache.keys().next().value);
    return out;
  }

  /** Buildings and parks between distances s0 and s1. */
  Road.city = (s0, s1) => {
    const out = [];
    for (let n = Math.floor(s0 / BLOCK); n <= Math.floor(s1 / BLOCK); n++) out.push(...block(n));
    return out;
  };
  /** Side streets (distance along the road of each crossing) between s0 and s1. */
  Road.streets = (s0, s1) => {
    const out = [];
    for (let n = Math.ceil(s0 / BLOCK); n <= Math.floor(s1 / BLOCK); n++) if (Road.isUrban(n * BLOCK)) out.push(n * BLOCK);
    return out;
  };
  /** World position of the point `lat` m right of the centre line at distance S. */
  Road.at = (S, lat) => {
    const th = Road.heading(S), p = Road.pos(S);
    return [p[0] + Math.cos(th) * lat, p[1] - Math.sin(th) * lat];
  };

  ensure(4000);
  window.Road = Road;
})();
