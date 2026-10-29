/* The mountain road seen through the windshield and the side glass.
 * Drawn in stage (photo) pixels at low resolution; upscaling plus a CSS blur
 * gives the out-of-focus look of a camera focused on the cluster. */
(function () {
  'use strict';

  const TOP = 0, HEIGHT = 240, WIDTH = 1672;      // windshield band and the side glass
  const Q = 0.36;
  const F = 540;            // focal length, stage px
  const CAM_H = 1.3;        // eye height, m
  const HORIZON = 36;
  const VP_X = 826;
  const ROAD_HALF = 3.9;

  const hash = (n, k) => {
    const s = Math.sin(n * 91.345 + k * 47.853) * 43758.5453;
    return s - Math.floor(s);
  };
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c, a) => a === undefined ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const FOG = [190, 204, 218];

  class Exterior {
    constructor(canvas) {
      this.canvas = canvas;
      canvas.width = Math.round(WIDTH * Q);
      canvas.height = Math.round(HEIGHT * Q);
      this.ctx = canvas.getContext('2d');
      this.cars = [];
      this.nextCar = 3;
      this.flakes = [];
      // clear weather: no snowfall
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
      const th0 = Road.heading(s);

      // the road `z` m ahead in the car frame: centre point and its orientation
      const at = (z) => {
        const c = Road.local(s, z, 0), d = Road.heading(s + z) - th0;
        return { u: c.u - lane, f: c.f, cd: Math.cos(d), sd: Math.sin(d), z, S: s + z };
      };
      const pt = (a, lat, h) => {
        const f = a.f - lat * a.sd;
        if (f < 0.8) return null;
        return [vp + (a.u + lat * a.cd) * F / f, hy + (CAM_H - (h || 0)) * F / f, f];
      };
      const quad = (a, b, l0, l1, h0, h1) => {
        const p0 = pt(a, l0, h0), p1 = pt(a, l1, h0), p2 = pt(b, l1, h1 === undefined ? h0 : h1), p3 = pt(b, l0, h1 === undefined ? h0 : h1);
        if (!p0 || !p1 || !p2 || !p3) return false;
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]);
        ctx.closePath();
        return true;
      };

      // overcast sky
      let g = ctx.createLinearGradient(0, TOP, 0, hy);
      g.addColorStop(0, '#86aacd');
      g.addColorStop(0.7, '#bccfe0');
      g.addColorStop(1, '#d4e0ea');
      ctx.fillStyle = g;
      ctx.fillRect(0, TOP, WIDTH, hy - TOP + 1);

      // mountains and the forest edge sit at fixed bearings, so they swing past in corners
      for (const [amp, base, col, freq] of [[30, 8, [138, 160, 188], 2.2], [16, 4, [104, 124, 118], 4.5], [9, 2, [66, 88, 60], 11]]) {
        ctx.beginPath();
        ctx.moveTo(-50, hy + 1);
        for (let x = -50; x <= WIDTH + 50; x += 8) {
          const az = th0 + (x - vp) / F;
          const h = base + amp * (0.55 + 0.45 * Math.sin(az * freq * 3.1 + freq)) * (0.6 + 0.4 * Math.sin(az * freq * 7.3 + 1));
          const jag = freq > 10 ? Math.abs(Math.sin(az * 260)) * 3 : 0;
          ctx.lineTo(x, hy - h - jag);
        }
        ctx.lineTo(WIDTH + 50, hy + 1);
        ctx.fillStyle = rgb(col);
        ctx.fill();
      }

      // snow-covered ground
      g = ctx.createLinearGradient(0, hy, 0, TOP + HEIGHT);
      g.addColorStop(0, '#9fa07c');
      g.addColorStop(1, '#8c8a5e');
      ctx.fillStyle = g;
      ctx.fillRect(0, hy, WIDTH, TOP + HEIGHT - hy);

      // road strips, far to near
      const strips = [];
      for (let z = 4; z < 650; z += Math.max(1, z * 0.055)) strips.push(at(z));
      const bank = (S) => 0.7 + 0.45 * Math.sin(S * 0.13) + 0.3 * Math.sin(S * 0.41 + 2);
      for (let i = strips.length - 2; i >= 0; i--) {
        const a = strips[i], b = strips[i + 1];
        if (b.f < 1) continue;
        const fog = Math.min(1, b.f / 420);
        for (const side of [-1, 1]) {
          const wa = bank(a.S + side * 50), wb = bank(b.S + side * 50);
          // ploughed snow bank of varying width
          const p0 = pt(a, side * ROAD_HALF, 0.05), p1 = pt(a, side * (ROAD_HALF + wa), 0.05);
          const p2 = pt(b, side * (ROAD_HALF + wb), 0.05), p3 = pt(b, side * ROAD_HALF, 0.05);
          if (p0 && p1 && p2 && p3) {
            ctx.beginPath();
            ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]);
            ctx.closePath();
            ctx.fillStyle = rgb(mix(side < 0 ? [150, 146, 104] : [138, 134, 94], FOG, fog));
            ctx.fill();
          }
        }
        if (quad(a, b, -ROAD_HALF, ROAD_HALF, 0)) {
          ctx.fillStyle = rgb(mix([88, 90, 95], FOG, fog));
          ctx.fill();
        }
        // slush texture: lighter patches between the tracks
        const tex = hash(Math.floor(a.S / 3), 3);
        if (tex > 0.55 && quad(a, b, -0.4, 0.4, 0)) {
          ctx.fillStyle = rgb(mix([104, 106, 110], FOG, fog), 0.45);
          ctx.fill();
        }
        // polished wheel tracks in both lanes
        for (const u of [-2.6, -1.0, 1.0, 2.6]) {
          if (quad(a, b, u - 0.34, u + 0.34, 0)) {
            ctx.fillStyle = rgb(mix([72, 74, 78], FOG, fog), 0.35);
            ctx.fill();
          }
        }
        // centre line (double yellow) and dashed edge lines, half buried in slush
        for (const u of [-0.08, 0.08]) {
          if (quad(a, b, u - 0.05, u + 0.05, 0)) { ctx.fillStyle = rgb(mix([236, 192, 52], FOG, fog), 0.95); ctx.fill(); }
        }
        if (Math.floor(a.S / 6) % 2 === 0) {
          for (const u of [-3.45, 3.45]) {
            if (quad(a, b, u - 0.07, u + 0.07, 0)) { ctx.fillStyle = rgb(mix([236, 238, 240], FOG, fog), 0.92); ctx.fill(); }
          }
        }
      }

      // roadside objects, placed along the road and sorted far to near
      const objs = [];
      const put = (o) => {
        const a = at(o.S - s);
        const p = pt(a, o.lat, 0);
        if (p && p[2] > 1.5 && p[2] < 520) { o.a = a; o.f = p[2]; objs.push(o); }
      };
      for (let n = Math.floor(s / 6); n < Math.floor((s + 420) / 6); n++) {
        if (hash(n, 2) < 0.75) put({ k: 'tree', S: n * 6 + hash(n, 1) * 4, lat: (hash(n, 3) < 0.5 ? -1 : 1) * (8 + hash(n, 4) * 30), n });
      }
      for (let n = Math.floor(s / 25); n < Math.floor((s + 300) / 25); n++) {
        put({ k: 'post', S: n * 25, lat: 4.9 });
        put({ k: 'post', S: n * 25 + 12, lat: -4.9 });
      }
      for (let n = Math.floor(s / 55); n < Math.floor((s + 450) / 55); n++) put({ k: 'pole', S: n * 55, lat: 6.6 });
      // corner furniture: chevron boards and guard rail on the outside, a warning sign before
      for (let n = Math.floor(s / 12); n < Math.floor((s + 320) / 12); n++) {
        const S = n * 12, k = Road.curvature(S);
        if (Math.abs(k) > 1 / 280) {
          put({ k: 'chevron', S, lat: -Math.sign(k) * 5.3, dir: Math.sign(k) });
          put({ k: 'rail', S, lat: -Math.sign(k) * 4.8 });
        }
        const kPrev = Math.abs(Road.curvature(S + 115)), kNow = Math.abs(Road.curvature(S + 103));
        if (kNow <= 1 / 350 && kPrev > 1 / 350) put({ k: 'warn', S, lat: 5.6, dir: Math.sign(Road.curvature(S + 140)) });
      }
      for (const c of this.cars) put({ k: 'car', S: c.S, lat: -1.8, car: c });
      objs.sort((a, b) => b.f - a.f);

      for (const o of objs) {
        const fog = Math.min(1, o.f / 420);
        const sc = F / o.f;
        const [bx, by] = pt(o.a, o.lat, 0);
        if (o.k === 'tree') {
          const h = 6 + hash(o.n, 5) * 10, w = h * (0.3 + hash(o.n, 6) * 0.12);
          const ty = by - h * sc, pw = w * sc;
          const dark = rgb(mix([40, 62, 44], FOG, fog * 0.9));
          const snow = rgb(mix([78, 104, 66], FOG, fog * 0.8));
          ctx.fillStyle = rgb(mix([60, 50, 42], FOG, fog));
          ctx.fillRect(bx - pw * 0.04, by - h * 0.18 * sc, pw * 0.08, h * 0.18 * sc);
          for (let tier = 0; tier < 4; tier++) {
            const t0 = ty + (by - ty) * tier * 0.2, t1 = ty + (by - ty) * (0.34 + tier * 0.21);
            const ww = pw * (0.4 + tier * 0.22);
            ctx.fillStyle = dark;
            ctx.beginPath(); ctx.moveTo(bx, t0); ctx.lineTo(bx + ww / 2, t1); ctx.quadraticCurveTo(bx, t1 - (t1 - t0) * 0.15, bx - ww / 2, t1); ctx.closePath(); ctx.fill();
            ctx.fillStyle = snow;
            ctx.beginPath(); ctx.moveTo(bx, t0); ctx.lineTo(bx + ww * 0.22, t0 + (t1 - t0) * 0.42); ctx.lineTo(bx - ww * 0.3, t0 + (t1 - t0) * 0.5); ctx.closePath(); ctx.fill();
          }
        } else if (o.k === 'post') {
          ctx.strokeStyle = rgb(mix([236, 237, 239], FOG, fog));
          ctx.lineWidth = Math.max(0.6, 0.12 * sc);
          ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by - 1.1 * sc); ctx.stroke();
          ctx.fillStyle = o.lat > 0 ? 'rgba(255,120,40,0.9)' : 'rgba(250,250,250,0.9)';
          ctx.fillRect(bx - ctx.lineWidth / 2, by - 1.1 * sc, ctx.lineWidth, Math.max(0.6, 0.15 * sc));
        } else if (o.k === 'pole') {
          ctx.strokeStyle = rgb(mix([72, 66, 60], FOG, fog));
          ctx.lineWidth = Math.max(0.6, 0.22 * sc);
          ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by - 9 * sc); ctx.stroke();
          ctx.lineWidth = Math.max(0.5, 0.1 * sc);
          ctx.beginPath(); ctx.moveTo(bx - 0.9 * sc, by - 8.7 * sc); ctx.lineTo(bx + 0.9 * sc, by - 8.7 * sc); ctx.stroke();
        } else if (o.k === 'rail') {
          // a 12 m run of W-beam rail on short posts
          const b2 = at(o.S + 12 - s);
          const p0 = pt(o.a, o.lat, 0.78), p1 = pt(b2, o.lat, 0.78), p2 = pt(b2, o.lat, 0.5), p3 = pt(o.a, o.lat, 0.5);
          if (p0 && p1 && p2 && p3) {
            ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.closePath();
            ctx.fillStyle = rgb(mix([190, 196, 202], FOG, fog));
            ctx.fill();
            ctx.strokeStyle = rgb(mix([120, 126, 132], FOG, fog));
            ctx.lineWidth = Math.max(0.5, 0.12 * sc);
            const foot = pt(o.a, o.lat, 0);
            if (foot) { ctx.beginPath(); ctx.moveTo(p3[0], p3[1]); ctx.lineTo(foot[0], foot[1]); ctx.stroke(); }
          }
        } else if (o.k === 'chevron' || o.k === 'warn') {
          const w = (o.k === 'warn' ? 0.9 : 0.6) * sc, h0 = o.k === 'warn' ? 1.5 : 1.0;
          ctx.strokeStyle = rgb(mix([90, 92, 96], FOG, fog));
          ctx.lineWidth = Math.max(0.5, 0.08 * sc);
          ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by - h0 * sc); ctx.stroke();
          const cy = by - (h0 + (o.k === 'warn' ? 0.45 : 0.3)) * sc;
          ctx.fillStyle = rgb(mix([246, 196, 30], FOG, fog * 0.8));
          ctx.beginPath();
          if (o.k === 'warn') { ctx.moveTo(bx, cy - w / 2); ctx.lineTo(bx + w / 2, cy); ctx.lineTo(bx, cy + w / 2); ctx.lineTo(bx - w / 2, cy); }
          else ctx.rect(bx - w / 2, cy - w * 0.5, w, w);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = rgb(mix([20, 20, 22], FOG, fog * 0.8));
          ctx.lineWidth = Math.max(0.4, w * 0.12);
          ctx.beginPath();
          if (o.k === 'chevron') { ctx.moveTo(bx - o.dir * w * 0.2, cy - w * 0.3); ctx.lineTo(bx + o.dir * w * 0.15, cy); ctx.lineTo(bx - o.dir * w * 0.2, cy + w * 0.3); }
          else { ctx.moveTo(bx - w * 0.08, cy + w * 0.25); ctx.quadraticCurveTo(bx - w * 0.08, cy - w * 0.1, bx + o.dir * w * 0.15, cy - w * 0.18); }
          ctx.stroke();
        } else if (o.k === 'car' && o.f > 4) {
          const car = o.car;
          const hgt = car.tall ? 1.85 : 1.45;
          const wpx = 1.8 * sc, hpx = hgt * sc, lx = bx - wpx / 2, ty = by - hpx;
          ctx.fillStyle = rgb(mix(car.col, FOG, fog * 0.8));
          ctx.beginPath(); ctx.roundRect(lx, ty + hpx * 0.32, wpx, hpx * 0.68, wpx * 0.08); ctx.fill();
          ctx.beginPath(); ctx.roundRect(lx + wpx * 0.12, ty, wpx * 0.76, hpx * 0.42, wpx * 0.1); ctx.fill();
          ctx.fillStyle = rgb(mix([26, 30, 36], FOG, fog * 0.7));
          ctx.fillRect(lx + wpx * 0.17, ty + hpx * 0.06, wpx * 0.66, hpx * 0.3);
          ctx.fillStyle = 'rgba(255,252,236,0.95)';
          const r = Math.max(0.8, wpx * 0.07);
          ctx.beginPath(); ctx.arc(lx + wpx * 0.14, ty + hpx * 0.6, r, 0, Math.PI * 2); ctx.arc(lx + wpx * 0.86, ty + hpx * 0.6, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,250,230,0.16)';
          ctx.beginPath(); ctx.ellipse(bx, ty + hpx * 0.62, wpx * 1.1, hpx * 0.45, 0, 0, Math.PI * 2); ctx.fill();
        }
      }

      // falling snow and haze
      for (const f of this.flakes) {
        ctx.fillStyle = `rgba(250,252,255,${0.35 + f.z * 0.5})`;
        const r = 0.8 + f.z * 2.2;
        ctx.fillRect(f.x - r / 2, f.y - r / 2, r, r * (1 + st.speed / 60 * f.z));
      }
      g = ctx.createLinearGradient(0, hy - 30, 0, hy + 30);
      g.addColorStop(0, 'rgba(213,220,228,0)');
      g.addColorStop(0.5, 'rgba(213,220,228,0.65)');
      g.addColorStop(1, 'rgba(213,220,228,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, hy - 30, WIDTH, 60);
    }
  }

  window.Exterior = Exterior;
})();
