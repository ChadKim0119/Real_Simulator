/* Outside world seen through the windshield.
 *
 * Rendered at low resolution on purpose: upscaling gives the same soft,
 * out-of-focus look the photo has (the camera focuses on the cluster).
 * Drawing coordinates are stage (photo) pixels; z is metres ahead of the car.
 */
(function () {
  'use strict';

  const TOP = -80, HEIGHT = 300, WIDTH = 1712;
  const Q = 0.3;          // backing-store resolution factor
  const F = 540;          // focal length in stage px
  const CAM_H = 1.25;     // eye height above the road, metres
  const HORIZON = 54;
  const VP_X = 905;

  const hash = (n, k) => {
    const s = Math.sin(n * 91.345 + k * 47.853) * 43758.5453;
    return s - Math.floor(s);
  };
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c, a) => a === undefined ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const HAZE = [214, 222, 228];

  class Exterior {
    constructor(canvas) {
      this.canvas = canvas;
      canvas.width = Math.round(WIDTH * Q);
      canvas.height = Math.round(HEIGHT * Q);
      this.ctx = canvas.getContext('2d');
      this.cars = [];
      this.nextCar = 2;
      this.ridge = [];
      for (let x = -400; x <= WIDTH + 400; x += 16) {
        this.ridge.push([x, 9 + 7 * Math.sin(x * 0.0042 + 1.3) + 4 * Math.sin(x * 0.013) + 2.2 * Math.sin(x * 0.037 + 2)]);
      }
    }

    static get box() { return { top: TOP, height: HEIGHT, width: WIDTH }; }

    update(st, dt) {
      const v = st.speed / 3.6;
      this.nextCar -= dt;
      if (this.nextCar <= 0) {
        const oncoming = Math.random() < 0.7;
        const palette = [[40, 42, 46], [205, 208, 212], [120, 124, 130], [150, 30, 32], [30, 52, 92], [235, 236, 238]];
        this.cars.push({
          oncoming,
          z: oncoming ? 420 : (v > 8 ? 260 : -30),
          x: oncoming ? -4.0 - (Math.random() < 0.5 ? 0 : 3.6) : 3.6,
          v: (oncoming ? 70 : 60 + Math.random() * 40) / 3.6,
          col: palette[(Math.random() * palette.length) | 0],
          tall: Math.random() < 0.25,
        });
        this.nextCar = oncoming ? 2.5 + Math.random() * 5 : 6 + Math.random() * 8;
      }
      for (const c of this.cars) c.z += (c.oncoming ? -(c.v + v) : (c.v - v)) * dt;
      this.cars = this.cars.filter((c) => c.z > 1.6 && c.z < 520 && !(c.z < 3 && !c.oncoming));
    }

    render(st) {
      const ctx = this.ctx;
      ctx.setTransform(Q, 0, 0, Q, 0, -TOP * Q);
      const hy = HORIZON + st.pitch * 9 + st.bump;
      const vp = VP_X - st.yaw * F;
      const lat = st.lateral;
      const dist = st.odoMeters;
      const P = (x, z, h) => [vp + (x - lat) * F / z, hy + (CAM_H - (h || 0)) * F / z];

      // sky
      let g = ctx.createLinearGradient(0, TOP, 0, hy);
      g.addColorStop(0, '#9fb4c8');
      g.addColorStop(1, '#e2e8ec');
      ctx.fillStyle = g;
      ctx.fillRect(0, TOP, WIDTH, hy - TOP + 1);
      g = ctx.createRadialGradient(1550, TOP + 10, 10, 1550, TOP + 10, 520);
      g.addColorStop(0, 'rgba(255,253,245,0.95)');
      g.addColorStop(1, 'rgba(255,253,245,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, TOP, WIDTH, hy - TOP);

      // distant hills, buildings and tree line
      const pan = -st.heading * F * 0.9;
      ctx.beginPath();
      ctx.moveTo(-400, hy + 1);
      for (const [x, h] of this.ridge) ctx.lineTo(x + pan % 400, hy - h);
      ctx.lineTo(WIDTH + 400, hy + 1);
      ctx.fillStyle = '#a7b2a6';
      ctx.fill();
      for (let i = 0; i < 14; i++) {
        const bx = 1180 + i * 46 + hash(i, 3) * 20 + pan * 0.6;
        const bh = 14 + hash(i, 4) * 34, bw = 26 + hash(i, 5) * 30;
        ctx.fillStyle = rgb(mix([196, 194, 186], HAZE, 0.35 + hash(i, 6) * 0.3));
        ctx.fillRect(bx, hy - bh, bw, bh + 1);
      }
      for (let x = -40; x < 760; x += 22) {
        const h = 8 + hash(x, 7) * 12;
        ctx.beginPath();
        ctx.ellipse(x + pan * 0.6 % 44, hy - h * 0.5, 16, h, 0, 0, Math.PI * 2);
        ctx.fillStyle = rgb(mix([96, 112, 88], HAZE, 0.45));
        ctx.fill();
      }

      // ground
      g = ctx.createLinearGradient(0, hy, 0, TOP + HEIGHT);
      g.addColorStop(0, '#b4b9a6');
      g.addColorStop(0.25, '#8f9a74');
      g.addColorStop(1, '#5f6b45');
      ctx.fillStyle = g;
      ctx.fillRect(0, hy, WIDTH, TOP + HEIGHT - hy);

      // road surface
      const Z0 = 1.8, Z1 = 1200;
      const quad = (xa, xb, za, zb, ha, hb) => {
        const a = P(xa, za, ha), b = P(xb, za, ha), c = P(xb, zb, hb), d = P(xa, zb, hb);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.lineTo(d[0], d[1]);
        ctx.closePath();
      };
      quad(-11.2, 8.0, Z0, Z1);
      g = ctx.createLinearGradient(0, hy, 0, TOP + HEIGHT);
      g.addColorStop(0, '#c9cccd');
      g.addColorStop(0.2, '#9a9d9f');
      g.addColorStop(1, '#5d6062');
      ctx.fillStyle = g;
      ctx.fill();

      // asphalt repairs / tyre tracks: these streaming past sell the speed
      for (let n = Math.floor(dist / 23); n < Math.floor((dist + 260) / 23); n++) {
        const z = n * 23 + hash(n, 1) * 12 - dist;
        if (z < Z0) continue;
        const x = -1.6 + hash(n, 2) * 8;
        quad(x, x + 0.8 + hash(n, 3) * 2.4, z, z + 2 + hash(n, 4) * 7);
        ctx.fillStyle = 'rgba(55,58,60,0.28)';
        ctx.fill();
      }
      for (const tx of [-0.75, 0.75]) {
        quad(tx - 0.35, tx + 0.35, Z0, 400);
        ctx.fillStyle = 'rgba(70,72,74,0.18)';
        ctx.fill();
      }

      // markings
      const stripe = (x, w, za, zb, col) => { quad(x - w / 2, x + w / 2, Math.max(za, Z0), zb); ctx.fillStyle = col; ctx.fill(); };
      stripe(7.1, 0.16, Z0, Z1, '#e9eae6');
      stripe(-10.4, 0.16, Z0, Z1, '#e9eae6');
      stripe(-1.85, 0.13, Z0, Z1, '#e3b636');
      stripe(-2.08, 0.13, Z0, Z1, '#e3b636');
      for (const lx of [1.8, -5.7]) {
        for (let n = Math.floor(dist / 20) - 1; n < Math.floor((dist + 320) / 20); n++) {
          const z = n * 20 - dist;
          if (z + 8 < Z0) continue;
          stripe(lx, 0.15, z, z + 8, '#eceee9');
        }
      }

      // median barrier (left) and guard rail (right)
      {
        const a = P(-10.9, Z0, 0), b = P(-10.9, 900, 0), c = P(-10.9, 900, 0.85), d = P(-10.9, Z0, 0.85);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
        ctx.closePath();
        ctx.fillStyle = '#c9c7bf';
        ctx.fill();
      }
      {
        const a = P(7.9, Z0, 0.55), b = P(7.9, 600, 0.55), c = P(7.9, 600, 0.78), d = P(7.9, Z0, 0.78);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
        ctx.closePath();
        ctx.fillStyle = '#c3c6c8';
        ctx.fill();
      }
      ctx.strokeStyle = '#7d8183';
      for (let n = Math.floor(dist / 4); n < Math.floor((dist + 160) / 4); n++) {
        const z = n * 4 - dist;
        if (z < Z0) continue;
        const a = P(7.95, z, 0), b = P(7.95, z, 0.75);
        ctx.lineWidth = Math.max(0.6, 0.12 * F / z);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }

      // objects sorted far → near
      const objs = [];
      for (let n = Math.floor(dist / 9); n < Math.floor((dist + 320) / 9); n++) {
        const z = n * 9 + hash(n, 11) * 6 - dist;
        if (z > Z0) objs.push({ kind: 'tree', z, x: 11 + hash(n, 12) * 22, n });
        const z2 = n * 9 + hash(n, 13) * 7 - dist;
        if (z2 > Z0 && hash(n, 14) < 0.8) objs.push({ kind: 'tree', z: z2, x: -(14.5 + hash(n, 15) * 22), n: n + 5000 });
      }
      for (let n = Math.floor(dist / 48); n < Math.floor((dist + 400) / 48); n++) {
        const z = n * 48 - dist;
        if (z > Z0) objs.push({ kind: 'pole', z, x: 8.7 });
      }
      for (const c of this.cars) objs.push({ kind: 'car', z: c.z, car: c });
      objs.sort((a, b) => b.z - a.z);

      for (const o of objs) {
        const haze = Math.min(1, o.z / 320);
        if (o.kind === 'tree') {
          const h = 5 + hash(o.n, 16) * 6, r = 1.8 + hash(o.n, 17) * 2.2;
          const base = P(o.x, o.z, 0), top = P(o.x, o.z, h);
          const pr = r * F / o.z;
          ctx.strokeStyle = rgb(mix([74, 62, 50], HAZE, haze));
          ctx.lineWidth = Math.max(0.5, 0.3 * F / o.z);
          ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(top[0], top[1] + pr * 0.6); ctx.stroke();
          const green = [[58, 84, 46], [72, 96, 52], [50, 74, 44], [86, 104, 60]][o.n % 4];
          ctx.fillStyle = rgb(mix(green, HAZE, haze * 0.85));
          ctx.beginPath();
          ctx.ellipse(top[0], top[1] + pr * 0.3, pr * 0.85, pr * 1.15, 0, 0, Math.PI * 2);
          ctx.fill();
        } else if (o.kind === 'pole') {
          const a = P(o.x, o.z, 0), b = P(o.x, o.z, 9), arm = P(o.x - 1.8, o.z, 9.1);
          ctx.strokeStyle = rgb(mix([120, 124, 126], HAZE, haze));
          ctx.lineWidth = Math.max(0.5, 0.18 * F / o.z);
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(arm[0], arm[1]); ctx.stroke();
        } else {
          const c = o.car;
          const hgt = c.tall ? 1.8 : 1.42;
          const bl = P(c.x - 0.9, c.z, 0.25), tr = P(c.x + 0.9, c.z, hgt);
          const w = tr[0] - bl[0], h = bl[1] - tr[1];
          ctx.fillStyle = rgb(mix(c.col, HAZE, haze * 0.8));
          ctx.beginPath();
          ctx.roundRect(bl[0], tr[1] + h * 0.3, w, h * 0.7, w * 0.08);
          ctx.fill();
          ctx.beginPath();
          ctx.roundRect(bl[0] + w * 0.12, tr[1], w * 0.76, h * 0.42, w * 0.1);
          ctx.fill();
          ctx.fillStyle = rgb(mix([30, 34, 40], HAZE, haze * 0.7));
          ctx.fillRect(bl[0] + w * 0.17, tr[1] + h * 0.06, w * 0.66, h * 0.3);
          const ly = tr[1] + h * 0.55;
          ctx.fillStyle = c.oncoming ? 'rgba(255,250,235,0.95)' : 'rgba(220,30,30,0.95)';
          ctx.fillRect(bl[0] + w * 0.04, ly, w * 0.16, h * 0.09);
          ctx.fillRect(bl[0] + w * 0.8, ly, w * 0.16, h * 0.09);
          ctx.fillStyle = 'rgba(20,20,22,0.85)';
          ctx.fillRect(bl[0] + w * 0.05, bl[1] - h * 0.05, w * 0.2, h * 0.18);
          ctx.fillRect(bl[0] + w * 0.75, bl[1] - h * 0.05, w * 0.2, h * 0.18);
        }
      }

      // atmospheric haze at the horizon
      g = ctx.createLinearGradient(0, hy - 30, 0, hy + 40);
      g.addColorStop(0, 'rgba(225,231,235,0)');
      g.addColorStop(0.45, 'rgba(225,231,235,0.55)');
      g.addColorStop(1, 'rgba(225,231,235,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, hy - 30, WIDTH, 70);
    }
  }

  window.Exterior = Exterior;
})();
