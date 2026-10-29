/* The snowy country road seen through the strip of windshield above the dash.
 * Drawn in stage (photo) pixels at low resolution; upscaling plus a CSS blur
 * gives the out-of-focus look of a camera focused on the cluster. */
(function () {
  'use strict';

  const TOP = -170, HEIGHT = 185, WIDTH = 1440;
  const Q = 0.42;
  const F = 420;            // focal length, stage px
  const CAM_H = 1.3;        // eye height, m
  const HORIZON = -101;
  const VP_X = 690;
  const ROAD_HALF = 3.9;

  const hash = (n, k) => {
    const s = Math.sin(n * 91.345 + k * 47.853) * 43758.5453;
    return s - Math.floor(s);
  };
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c, a) => a === undefined ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const FOG = [206, 214, 222];

  class Exterior {
    constructor(canvas) {
      this.canvas = canvas;
      canvas.width = Math.round(WIDTH * Q);
      canvas.height = Math.round(HEIGHT * Q);
      this.ctx = canvas.getContext('2d');
      this.cars = [];
      this.nextCar = 3;
      this.flakes = [];
      for (let i = 0; i < 160; i++) this.flakes.push(this.flake(true));
    }

    static get box() { return { top: TOP, height: HEIGHT, width: WIDTH }; }

    flake(anywhere) {
      return { x: Math.random() * WIDTH, y: anywhere ? TOP + Math.random() * HEIGHT : TOP - 5, z: 0.3 + Math.random() * 0.7 };
    }

    update(st, dt) {
      const v = st.speed / 3.6;
      // oncoming traffic, lights on in the snow
      this.nextCar -= dt;
      if (this.nextCar <= 0) {
        const pal = [[38, 40, 44], [200, 204, 208], [112, 116, 122], [130, 24, 28], [28, 46, 82]];
        this.cars.push({ S: st.odoMeters + 520, v: (55 + Math.random() * 25) / 3.6, col: pal[(Math.random() * pal.length) | 0], tall: Math.random() < 0.35 });
        this.nextCar = 4 + Math.random() * 9;
      }
      for (const c of this.cars) c.S -= c.v * dt;
      this.cars = this.cars.filter((c) => c.S - st.odoMeters > 4);

      const vf = Math.min(1.4, st.speed / 80);
      for (const f of this.flakes) {
        const dx = f.x - VP_X, dy = f.y - HORIZON;
        f.y += (14 + 26 * f.z) * dt + dy * vf * 2.2 * f.z * dt;
        f.x += Math.sin(f.y * 0.05 + f.z * 9) * 6 * dt + dx * vf * 2.2 * f.z * dt;
        if (f.y > TOP + HEIGHT || f.x < -10 || f.x > WIDTH + 10) {
          Object.assign(f, this.flake(false));
          if (vf > 0.1) { f.x = VP_X + (Math.random() - 0.5) * 600; f.y = HORIZON + (Math.random() - 0.5) * 50; }
        }
      }
    }

    render(st) {
      const ctx = this.ctx;
      ctx.setTransform(Q, 0, 0, Q, 0, -TOP * Q);
      const s = st.odoMeters;
      const hy = HORIZON + st.pitch * 7 + st.bump;
      const vp = VP_X - st.yawErr * F;
      const lane = Road.LANE + st.laneOffset;
      // centre-line position (car frame, m) z metres ahead
      const cz = (z) => Road.ahead(s, z) - lane;
      const P = (u, z, h) => [vp + u * F / z, hy + (CAM_H - (h || 0)) * F / z];
      const pan = -Road.heading(s) * F * 0.6;

      // overcast sky
      let g = ctx.createLinearGradient(0, TOP, 0, hy);
      g.addColorStop(0, '#9fadbb');
      g.addColorStop(1, '#d9e0e6');
      ctx.fillStyle = g;
      ctx.fillRect(0, TOP, WIDTH, hy - TOP + 1);

      // snowy mountains and the forest edge
      for (const [amp, base, col, par] of [[26, 6, [182, 194, 208], 0.3], [12, 2, [92, 104, 102], 0.7]]) {
        ctx.beginPath();
        ctx.moveTo(-50, hy + 1);
        for (let x = -50; x <= WIDTH + 50; x += 12) {
          const wx = x - pan * par;
          const h = base + amp * (0.5 + 0.5 * Math.sin(wx * 0.006 + par * 4)) * (0.6 + 0.4 * Math.sin(wx * 0.017 + 1));
          ctx.lineTo(x, hy - h - (par > 0.5 ? Math.abs(Math.sin(wx * 0.11)) * 3 : 0));
        }
        ctx.lineTo(WIDTH + 50, hy + 1);
        ctx.fillStyle = rgb(col);
        ctx.fill();
      }

      // snow-covered ground
      g = ctx.createLinearGradient(0, hy, 0, TOP + HEIGHT);
      g.addColorStop(0, '#dfe5ea');
      g.addColorStop(1, '#f1f4f7');
      ctx.fillStyle = g;
      ctx.fillRect(0, hy, WIDTH, TOP + HEIGHT - hy);

      // road surface in strips, following the curve
      const quad = (u0a, u1a, za, u0b, u1b, zb, ha, hb) => {
        const a = P(u0a, za, ha), b = P(u1a, za, ha), c = P(u1b, zb, hb), d = P(u0b, zb, hb);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
        ctx.closePath();
      };
      const strips = [];
      for (let z = 7; z < 700; z += Math.max(1.2, z * 0.07)) strips.push(z);
      for (let i = strips.length - 2; i >= 0; i--) {
        const za = strips[i], zb = strips[i + 1];
        const ca = cz(za), cb = cz(zb);
        const fog = Math.min(1, zb / 450);
        // banks of ploughed snow
        for (const side of [-1, 1]) {
          quad(ca + side * ROAD_HALF, ca + side * (ROAD_HALF + 0.9), za, cb + side * ROAD_HALF, cb + side * (ROAD_HALF + 0.9), zb, 0.1, 0.1);
          ctx.fillStyle = rgb(mix(side < 0 ? [226, 232, 238] : [212, 220, 228], FOG, fog));
          ctx.fill();
        }
        // slushy asphalt
        quad(ca - ROAD_HALF, ca + ROAD_HALF, za, cb - ROAD_HALF, cb + ROAD_HALF, zb);
        ctx.fillStyle = rgb(mix([150, 156, 162], FOG, fog));
        ctx.fill();
        // dark wet tyre tracks in both lanes
        for (const u of [-2.6, -1.0, 1.0, 2.6]) {
          quad(ca + u - 0.32, ca + u + 0.32, za, cb + u - 0.32, cb + u + 0.32, zb);
          ctx.fillStyle = rgb(mix([88, 92, 98], FOG, fog), 0.85);
          ctx.fill();
        }
        // half-buried markings
        const m = Math.floor((s + za) / 6) % 2 === 0;
        for (const u of [-0.07, 0.07]) {
          quad(ca + u - 0.05, ca + u + 0.05, za, cb + u - 0.05, cb + u + 0.05, zb);
          ctx.fillStyle = rgb(mix([214, 176, 60], FOG, fog), 0.55);
          ctx.fill();
        }
        if (m) {
          for (const u of [-3.45, 3.45]) {
            quad(ca + u - 0.06, ca + u + 0.06, za, cb + u - 0.06, cb + u + 0.06, zb);
            ctx.fillStyle = rgb(mix([235, 238, 240], FOG, fog), 0.6);
            ctx.fill();
          }
        }
      }

      // roadside objects, far to near
      const objs = [];
      for (let n = Math.floor(s / 6); n < Math.floor((s + 420) / 6); n++) {
        const S = n * 6 + hash(n, 1) * 4;
        const z = S - s;
        if (z < 8) continue;
        if (hash(n, 2) < 0.75) objs.push({ k: 'tree', z, u: (hash(n, 3) < 0.5 ? -1 : 1) * (7 + hash(n, 4) * 32), n });
      }
      for (let n = Math.floor(s / 25); n < Math.floor((s + 300) / 25); n++) {
        const z = n * 25 - s;
        if (z > 8) { objs.push({ k: 'post', z, u: 4.9 }); objs.push({ k: 'post', z: z + 12, u: -4.9 }); }
      }
      for (let n = Math.floor(s / 55); n < Math.floor((s + 500) / 55); n++) {
        const z = n * 55 - s;
        if (z > 8) objs.push({ k: 'pole', z, u: 6.4 });
      }
      for (const c of this.cars) objs.push({ k: 'car', z: c.S - s, car: c });
      objs.sort((a, b) => b.z - a.z);

      for (const o of objs) {
        const fog = Math.min(1, o.z / 420);
        const c = cz(o.z);
        if (o.k === 'tree') {
          const h = 6 + hash(o.n, 5) * 9, w = h * (0.32 + hash(o.n, 6) * 0.1);
          const [bx, by] = P(c + o.u, o.z, 0);
          const [, ty] = P(c + o.u, o.z, h);
          const pw = w * F / o.z;
          const dark = rgb(mix([34, 52, 42], FOG, fog * 0.9));
          const snow = rgb(mix([236, 240, 244], FOG, fog * 0.6));
          for (let tier = 0; tier < 3; tier++) {
            const t0 = ty + (by - ty) * tier * 0.26, t1 = ty + (by - ty) * (0.42 + tier * 0.25);
            const ww = pw * (0.45 + tier * 0.28);
            ctx.fillStyle = dark;
            ctx.beginPath(); ctx.moveTo(bx, t0); ctx.lineTo(bx + ww / 2, t1); ctx.lineTo(bx - ww / 2, t1); ctx.closePath(); ctx.fill();
            ctx.fillStyle = snow;
            ctx.beginPath(); ctx.moveTo(bx, t0); ctx.lineTo(bx + ww * 0.2, t0 + (t1 - t0) * 0.4); ctx.lineTo(bx - ww * 0.25, t0 + (t1 - t0) * 0.45); ctx.closePath(); ctx.fill();
          }
        } else if (o.k === 'post') {
          const [x0, y0] = P(c + o.u, o.z, 0), [, y1] = P(c + o.u, o.z, 1.1);
          ctx.strokeStyle = rgb(mix([235, 236, 238], FOG, fog));
          ctx.lineWidth = Math.max(0.6, 0.12 * F / o.z);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();
          ctx.fillStyle = o.u > 0 ? 'rgba(255,120,40,0.9)' : 'rgba(250,250,250,0.9)';
          ctx.fillRect(x0 - ctx.lineWidth / 2, y1, ctx.lineWidth, Math.max(0.6, 0.15 * F / o.z));
        } else if (o.k === 'pole') {
          const [x0, y0] = P(c + o.u, o.z, 0), [, y1] = P(c + o.u, o.z, 9);
          ctx.strokeStyle = rgb(mix([72, 66, 60], FOG, fog));
          ctx.lineWidth = Math.max(0.6, 0.22 * F / o.z);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke();
          ctx.lineWidth = Math.max(0.5, 0.1 * F / o.z);
          ctx.beginPath(); ctx.moveTo(x0 - 0.9 * F / o.z, y1 + 0.3 * F / o.z); ctx.lineTo(x0 + 0.9 * F / o.z, y1 + 0.3 * F / o.z); ctx.stroke();
        } else if (o.z > 4) {
          const car = o.car, u = c - 1.8;
          const hgt = car.tall ? 1.85 : 1.45;
          const [lx, by] = P(u - 0.9, o.z, 0.2), [rx, ty] = P(u + 0.9, o.z, hgt);
          const w = rx - lx, h = by - ty;
          ctx.fillStyle = rgb(mix(car.col, FOG, fog * 0.8));
          ctx.beginPath(); ctx.roundRect(lx, ty + h * 0.32, w, h * 0.68, w * 0.08); ctx.fill();
          ctx.beginPath(); ctx.roundRect(lx + w * 0.12, ty, w * 0.76, h * 0.42, w * 0.1); ctx.fill();
          ctx.fillStyle = rgb(mix([26, 30, 36], FOG, fog * 0.7));
          ctx.fillRect(lx + w * 0.17, ty + h * 0.06, w * 0.66, h * 0.3);
          ctx.fillStyle = 'rgba(255,252,236,0.95)';
          const r = Math.max(0.8, w * 0.07);
          ctx.beginPath(); ctx.arc(lx + w * 0.14, ty + h * 0.6, r, 0, Math.PI * 2); ctx.arc(lx + w * 0.86, ty + h * 0.6, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,250,230,0.18)';
          ctx.beginPath(); ctx.ellipse(lx + w / 2, ty + h * 0.62, w * 1.1, h * 0.45, 0, 0, Math.PI * 2); ctx.fill();
        }
      }

      // falling snow and haze
      for (const f of this.flakes) {
        ctx.fillStyle = `rgba(250,252,255,${0.35 + f.z * 0.5})`;
        const r = 0.8 + f.z * 2.2;
        ctx.fillRect(f.x - r / 2, f.y - r / 2, r, r * (1 + st.speed / 60 * f.z));
      }
      g = ctx.createLinearGradient(0, hy - 25, 0, hy + 25);
      g.addColorStop(0, 'rgba(215,222,229,0)');
      g.addColorStop(0.5, 'rgba(215,222,229,0.6)');
      g.addColorStop(1, 'rgba(215,222,229,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, hy - 25, WIDTH, 50);
    }
  }

  window.Exterior = Exterior;
})();
