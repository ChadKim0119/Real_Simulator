/* Lexus GX-style 12.3" digital cluster renderer.
 *
 * Centre: heading-up navigation mini map that follows the shared road model.
 * Design coordinates are the pixel coordinates of the close-up reference photo
 * (assets/gx_cluster.jpg); the display occupies x 245..1150, y 118..455 there.
 * The canvas is placed over the black glass of the wide interior photo.
 */
(function () {
  'use strict';

  const X0 = 245, Y0 = 118, CW = 905, CH = 337;
  const PLACE = { x: 585.5, y: 189.5, k: 0.5022 };   // the display's glass, measured on the photo
  const DEG = Math.PI / 180;
  const FONT = '"Barlow", "Helvetica Neue", Arial, sans-serif';
  const KR = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

  const TACH = { cx: 490, cy: 305, r: 192, a0: 148, a1: 218, max: 8000, red: 6000 };
  const MODE_ARC = { cx: 900, cy: 305, r: 192, a0: -40, a1: 32 };
  const MAP = { x: 430, y: 130, w: 520, h: 262 };
  const MAP_TD = { w: 620, h: 420, carV: 0.85 };

  const RED_X = [352, 386, 420, 454, 488, 522];
  const AMBER_X = [868, 902, 936, 970, 1004, 1038];
  const LAMP_Y = 141;
  const RED = '#ff3527', RED_GLOW = 'rgba(255,50,30,0.9)';
  const AMBER = '#ffb21e', AMBER_GLOW = 'rgba(255,165,20,0.85)';
  const GREEN = '#3ee07a', GREEN_GLOW = 'rgba(60,230,120,0.7)';

  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      r = Math.min(typeof r === 'number' ? r : 0, w / 2, h / 2);
      this.moveTo(x + r, y);
      this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r);
      this.closePath();
    };
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const hash = (i, j, k) => {
    const v = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
    return v - Math.floor(v);
  };

  class Cluster {
    constructor(canvas, hero) {
      this.canvas = canvas;
      this.hero = hero;
      this.ctx = canvas.getContext('2d');
      this.td = document.createElement('canvas');        // top-down map
      this.mapCanvas = document.createElement('canvas'); // after perspective tilt
      this.mapZoom = 1;
      this.scale = 0;
      this.setScale(1);
    }

    static get rect() { return { x: PLACE.x, y: PLACE.y, w: CW * PLACE.k, h: CH * PLACE.k }; }
    static get designWidth() { return CW; }

    setScale(s) {
      if (Math.abs(s - this.scale) < 0.01) return;
      this.scale = s;
      this.canvas.width = Math.round(CW * s);
      this.canvas.height = Math.round(CH * s);
      const ms = Math.min(s, 2.4);
      this.mapScale = ms;
      this.td.width = Math.round(MAP_TD.w * ms);
      this.td.height = Math.round(MAP_TD.h * ms);
      this.mapCanvas.width = Math.round(MAP.w * ms);
      this.mapCanvas.height = Math.round(MAP.h * ms);
    }

    glow(px) { return px * this.scale; }

    drawBackground(ctx) {
      const g = ctx.createLinearGradient(0, Y0, 0, Y0 + CH);
      g.addColorStop(0, '#03060c');
      g.addColorStop(1, '#08101b');
      ctx.fillStyle = g;
      ctx.fillRect(X0, Y0, CW, CH);
      const r = ctx.createRadialGradient(690, 300, 10, 690, 300, 430);
      r.addColorStop(0, 'rgba(40,95,180,0.22)');
      r.addColorStop(1, 'rgba(40,95,180,0)');
      ctx.fillStyle = r;
      ctx.fillRect(X0, Y0, CW, CH);
    }

    /* ---------- navigation mini map (heading-up, tilted) ---------- */
    drawMap(ctx, st, dt) {
      const ms = this.mapScale;
      const td = this.td.getContext('2d');
      const { w: tw, h: th, carV } = MAP_TD;
      // zoom out as speed rises, like a real navigation display
      const targetZoom = 1.05 - 0.55 * clamp(st.speed / 100, 0, 1);
      this.mapZoom += (targetZoom - this.mapZoom) * (1 - Math.exp(-dt / 1.5));
      const k = this.mapZoom;
      const s = st.odoMeters;
      td.setTransform(ms, 0, 0, ms, 0, 0);
      td.fillStyle = '#0a1019';
      td.fillRect(0, 0, tw, th);

      td.save();
      td.translate(tw / 2, th * carV);
      td.rotate(-Road.heading(s) - st.yawErr);
      td.scale(k, k);
      const [cx0, cy0] = Road.pos(s);
      td.translate(-cx0, cy0);
      const s0 = s - (th * (1 - carV)) / k - 150, s1 = s + (th * carV) / k + 250;
      // world (X east, Y north) -> map canvas (y down)
      const P = (S) => { const p = Road.pos(S); return [p[0], -p[1]]; };
      const frame = (S) => {
        const th = Road.heading(S);
        return { t: [Math.sin(th), -Math.cos(th)], r: [Math.cos(th), Math.sin(th)] };
      };
      const line = (pts, w, col) => {
        td.beginPath();
        td.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) td.lineTo(pts[i][0], pts[i][1]);
        td.lineWidth = w / k;
        td.strokeStyle = col;
        td.lineCap = 'round';
        td.lineJoin = 'round';
        td.stroke();
      };

      // forests and lakes
      for (let n = Math.floor(s0 / 140); n <= Math.floor(s1 / 140); n++) {
        const S = n * 140 + hash(n, 1, 9) * 100;
        if (hash(n, 2, 9) > 0.55) continue;
        const side = hash(n, 3, 9) < 0.5 ? -1 : 1;
        const { r } = frame(S);
        const d = 70 + hash(n, 4, 9) * 220;
        const [x, y] = P(S);
        td.beginPath();
        td.ellipse(x + r[0] * d * side, y + r[1] * d * side, 50 + hash(n, 5, 9) * 110, 40 + hash(n, 6, 9) * 80, hash(n, 7, 9) * 3, 0, Math.PI * 2);
        td.fillStyle = hash(n, 8, 9) < 0.15 ? '#0d2238' : '#0e1f19';
        td.fill();
      }
      // a river now and then (the road crosses it on a bridge)
      for (let n = Math.floor(s0 / 2600); n <= Math.floor(s1 / 2600); n++) {
        const S = n * 2600 + 900;
        const [cx, cy] = P(S);
        const pts = [];
        for (let x = -700; x <= 700; x += 25) pts.push([cx + x, cy + Math.sin(x / 140 + n) * 45 + x * 0.15]);
        line(pts, 26 * k, '#0f2740');
      }

      // side roads, crossroads and small villages
      const roads = [];
      for (let n = Math.floor(s0 / 230); n <= Math.floor(s1 / 230); n++) {
        const S = n * 230 + hash(n, 1, 3) * 140;
        const { t, r } = frame(S);
        const [x, y] = P(S);
        const sides = hash(n, 2, 3) < 0.3 ? [-1, 1] : [hash(n, 3, 3) < 0.5 ? -1 : 1];
        for (const side of sides) {
          const a = (70 + hash(n, 4, 3) * 40) * DEG;
          const dx = r[0] * side * Math.sin(a) + t[0] * Math.cos(a);
          const dy = r[1] * side * Math.sin(a) + t[1] * Math.cos(a);
          const len = 140 + hash(n + side, 5, 3) * 480;
          const bend = (hash(n + side, 6, 3) - 0.5) * 0.9;
          const pts = [];
          for (let i = 0; i <= 12; i++) {
            const q = i / 12, ang = bend * q;
            const cx = dx * Math.cos(ang) - dy * Math.sin(ang), cy = dx * Math.sin(ang) + dy * Math.cos(ang);
            pts.push([x + cx * len * q, y + cy * len * q]);
          }
          roads.push({ pts, major: false });
        }
      }
      for (let n = Math.floor(s0 / Road.JUNCTION_EVERY); n <= Math.floor(s1 / Road.JUNCTION_EVERY) + 1; n++) {
        const S = n * Road.JUNCTION_EVERY;
        const { t, r } = frame(S);
        const [x, y] = P(S);
        const side = n % 3 !== 0 ? 1 : -1;
        roads.push({ pts: [[x, y], [x + r[0] * side * 260 + t[0] * 120, y + r[1] * side * 260 + t[1] * 120], [x + r[0] * side * 700 + t[0] * 200, y + r[1] * side * 700 + t[1] * 200]], major: true });
        // village grid beside the junction
        const ox = x + r[0] * side * 160 - t[0] * 60, oy = y + r[1] * side * 160 - t[1] * 60;
        for (let i = -2; i <= 2; i++) {
          roads.push({ pts: [[ox + t[0] * i * 45 - r[0] * 90, oy + t[1] * i * 45 - r[1] * 90], [ox + t[0] * i * 45 + r[0] * 90, oy + t[1] * i * 45 + r[1] * 90]], major: false });
          roads.push({ pts: [[ox + r[0] * i * 45 - t[0] * 90, oy + r[1] * i * 45 - t[1] * 90], [ox + r[0] * i * 45 + t[0] * 90, oy + r[1] * i * 45 + t[1] * 90]], major: false });
        }
      }
      for (const rd of roads) line(rd.pts, rd.major ? 7.5 : 5, '#1b2430');
      for (const rd of roads) line(rd.pts, rd.major ? 4.6 : 2.6, rd.major ? '#6d7888' : '#3e4959');

      // route: travelled part dimmed, the road ahead highlighted
      const back = [], ahead = [];
      for (let S = s0; S <= s; S += 6) back.push(P(S));
      back.push(P(s));
      for (let S = s; S <= s1; S += 6) ahead.push(P(S));
      line(back, 8, '#1b2430');
      line(back, 5, '#5e6a7a');
      line(ahead, 16, 'rgba(40,140,255,0.22)');
      line(ahead, 7.5, '#2a86f5');
      line(ahead, 2.2, '#a6d6ff');
      td.restore();

      // perspective tilt by horizontal slices
      const mc = this.mapCanvas.getContext('2d');
      const mw = this.mapCanvas.width, mh = this.mapCanvas.height;
      mc.setTransform(1, 0, 0, 1, 0, 0);
      mc.globalCompositeOperation = 'source-over';
      mc.clearRect(0, 0, mw, mh);
      const N = 90;
      const gF = (v) => v * (1.5 - 0.5 * v);
      const tdw = this.td.width, tdh = this.td.height;
      for (let n = 0; n < N; n++) {
        const v0 = n / N, v1 = (n + 1) / N;
        const sw = tdw * (1 - 0.45 * (v0 + v1) / 2);
        const sy0 = tdh * gF(v0), sy1 = tdh * gF(v1);
        mc.drawImage(this.td, (tdw - sw) / 2, sy0, sw, Math.max(1, sy1 - sy0), 0, Math.floor(v0 * mh), mw, Math.ceil((v1 - v0) * mh) + 1);
      }
      mc.globalCompositeOperation = 'destination-in';
      let gr = mc.createLinearGradient(0, 0, mw, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(0.16, 'rgba(0,0,0,1)');
      gr.addColorStop(0.84, 'rgba(0,0,0,1)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      mc.fillStyle = gr;
      mc.fillRect(0, 0, mw, mh);
      gr = mc.createLinearGradient(0, 0, 0, mh);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(0.38, 'rgba(0,0,0,0.95)');
      gr.addColorStop(0.74, 'rgba(0,0,0,1)');
      gr.addColorStop(0.9, 'rgba(0,0,0,0)');
      mc.fillStyle = gr;
      mc.fillRect(0, 0, mw, mh);
      mc.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.mapCanvas, MAP.x, MAP.y, MAP.w, MAP.h);
    }

    drawArrow(ctx) {
      const x = MAP.x + MAP.w / 2, y = MAP.y + MAP.h * 0.758;
      ctx.save();
      ctx.shadowColor = 'rgba(60,150,255,0.8)';
      ctx.shadowBlur = this.glow(10);
      ctx.beginPath();
      ctx.moveTo(x, y - 17);
      ctx.lineTo(x + 11, y + 9);
      ctx.lineTo(x, y + 3);
      ctx.lineTo(x - 11, y + 9);
      ctx.closePath();
      const g = ctx.createLinearGradient(x - 11, y, x + 11, y);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.5, '#ffffff');
      g.addColorStop(0.5, '#cfe4ff');
      g.addColorStop(1, '#cfe4ff');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#2a86f5';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    }

    guidance(ctx, st) {
      const j = Road.nextJunction(st.odoMeters);
      const x = 446, y = 236, w = 172, h = 56;
      const bend = Road.nextCorner(st.odoMeters, 350);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 8);
      ctx.fillStyle = 'rgba(8,13,22,0.82)';
      ctx.fill();
      ctx.strokeStyle = bend ? 'rgba(255,178,40,0.6)' : 'rgba(120,170,240,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (bend) {
        // curve warning: bent arrow, distance and the advised speed
        ctx.strokeStyle = AMBER;
        ctx.fillStyle = AMBER;
        ctx.lineWidth = 3.2;
        ctx.lineCap = 'round';
        const ax = x + 24, ay = y + 46, d = bend.dir;
        ctx.beginPath();
        ctx.moveTo(ax - d * 4, ay);
        ctx.bezierCurveTo(ax - d * 4, ay - 16, ax + d * 8, ay - 18, ax + d * 9, ay - 26);
        ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ax + d * 11, ay - 34); ctx.lineTo(ax + d * 15, ay - 23); ctx.lineTo(ax + d * 3, ay - 25); ctx.closePath(); ctx.fill();
        ctx.restore();
        const dist = bend.dist < 10 ? '커브 진입' : `${Math.round(bend.dist / 10) * 10}`;
        this.text(ctx, dist, x + 50, y + 22, bend.dist < 10 ? 16 : 21, '#ffffff', { weight: 500, align: 'left', kr: bend.dist < 10 });
        if (bend.dist >= 10) {
          ctx.font = `500 21px ${FONT}`;
          this.text(ctx, 'm', x + 54 + ctx.measureText(dist).width, y + 25, 11.5, 'rgba(220,230,245,0.85)', { align: 'left' });
        }
        const adv = Math.max(30, Math.floor(Math.sqrt(2.3 * bend.R) * 3.6 / 10) * 10);
        this.text(ctx, `${bend.R < 200 ? '급커브' : '커브'} · 권장 ${adv} km/h`, x + 50, y + 44, 11, 'rgba(255,214,140,0.95)', { kr: true, align: 'left' });
        this.roadInfo(ctx, st);
        return;
      }
      // manoeuvre arrow
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = '#ffffff';
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const ax = x + 24, ay = y + 44;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      if (j.right) {
        ctx.lineTo(ax, ay - 16);
        ctx.quadraticCurveTo(ax, ay - 24, ax + 8, ay - 24);
        ctx.lineTo(ax + 10, ay - 24);
        ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ax + 16, ay - 24); ctx.lineTo(ax + 8, ay - 30); ctx.lineTo(ax + 8, ay - 18); ctx.closePath(); ctx.fill();
      } else {
        ctx.lineTo(ax, ay - 24);
        ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ax, ay - 32); ctx.lineTo(ax - 6, ay - 23); ctx.lineTo(ax + 6, ay - 23); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      const d = j.dist >= 1000 ? `${(j.dist / 1000).toFixed(1)}` : `${Math.max(0, Math.round(j.dist / 10) * 10)}`;
      const unit = j.dist >= 1000 ? 'km' : 'm';
      this.text(ctx, d, x + 50, y + 22, 21, '#ffffff', { weight: 500, align: 'left' });
      ctx.font = `500 21px ${FONT}`;
      this.text(ctx, unit, x + 54 + ctx.measureText(d).width, y + 25, 11.5, 'rgba(220,230,245,0.85)', { align: 'left' });
      this.text(ctx, j.name, x + 50, y + 44, 11.5, 'rgba(215,226,242,0.9)', { kr: true, align: 'left' });

      this.roadInfo(ctx, st);
    }

    roadInfo(ctx, st) {
      // current road name and the speed limit
      const name = Road.NAME;
      ctx.font = `500 10.5px ${KR}`;
      const nw = ctx.measureText(name).width + 18;
      ctx.beginPath();
      ctx.roundRect(MAP.x + MAP.w / 2 - nw / 2, 352, nw, 17, 8.5);
      ctx.fillStyle = 'rgba(8,13,22,0.8)';
      ctx.fill();
      this.text(ctx, name, MAP.x + MAP.w / 2, 361, 10.5, 'rgba(225,233,245,0.92)', { kr: true, weight: 500 });
      ctx.beginPath();
      ctx.arc(624, 361, 12, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 3.4;
      ctx.strokeStyle = '#e1251b';
      ctx.stroke();
      this.text(ctx, String(st.limit), 624, 362, 11, '#111111', { weight: 700 });
    }

    shade(ctx) {
      let g = ctx.createLinearGradient(X0, 0, X0 + 210, 0);
      g.addColorStop(0, 'rgba(2,5,12,0.86)');
      g.addColorStop(1, 'rgba(2,5,12,0)');
      ctx.fillStyle = g;
      ctx.fillRect(X0, Y0, 210, CH);
      g = ctx.createLinearGradient(885, 0, 960, 0);
      g.addColorStop(0, 'rgba(2,5,12,0)');
      g.addColorStop(1, 'rgba(2,5,12,0.9)');
      ctx.fillStyle = g;
      ctx.fillRect(885, Y0, X0 + CW - 885, CH);
      g = ctx.createLinearGradient(0, Y0, 0, Y0 + 110);
      g.addColorStop(0, 'rgba(1,3,9,0.7)');
      g.addColorStop(1, 'rgba(1,3,9,0)');
      ctx.fillStyle = g;
      ctx.fillRect(X0, Y0, CW, 110);
      g = ctx.createLinearGradient(0, 372, 0, Y0 + CH);
      g.addColorStop(0, 'rgba(1,3,9,0)');
      g.addColorStop(1, 'rgba(1,3,9,0.8)');
      ctx.fillStyle = g;
      ctx.fillRect(X0, 372, CW, Y0 + CH - 372);
    }

    text(ctx, s, x, y, size, color, opt) {
      opt = opt || {};
      ctx.font = `${opt.weight || 400} ${size}px ${opt.kr ? KR : FONT}`;
      ctx.fillStyle = color;
      ctx.textAlign = opt.align || 'center';
      ctx.textBaseline = 'middle';
      if (opt.glow) {
        ctx.save();
        ctx.shadowColor = opt.glow;
        ctx.shadowBlur = this.glow(6);
        ctx.fillText(s, x, y);
        ctx.restore();
      } else ctx.fillText(s, x, y);
    }

    arcPt(g, deg, r) {
      return [g.cx + Math.cos(deg * DEG) * (r || g.r), g.cy + Math.sin(deg * DEG) * (r || g.r)];
    }

    drawTach(ctx, rpm) {
      const g = TACH;
      const ang = (v) => g.a0 + (g.a1 - g.a0) * clamp(v / g.max, 0, 1);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.r, g.a0 * DEG, g.a1 * DEG);
      ctx.strokeStyle = 'rgba(210,222,240,0.35)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.r + 3, ang(g.red) * DEG, g.a1 * DEG);
      ctx.strokeStyle = 'rgba(235,45,45,0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();
      for (let v = 0; v <= g.max; v += 500) {
        const major = v % 1000 === 0;
        const [x0, y0] = this.arcPt(g, ang(v), g.r - 3);
        const [x1, y1] = this.arcPt(g, ang(v), g.r - (major ? 11 : 7));
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = v >= g.red ? '#ff4b45' : major ? 'rgba(235,242,255,0.85)' : 'rgba(235,242,255,0.45)';
        ctx.lineWidth = major ? 1.8 : 1.1;
        ctx.stroke();
        if (major) {
          const [lx, ly] = this.arcPt(g, ang(v), g.r - 22);
          this.text(ctx, String(v / 1000), lx, ly, 12.5, v >= g.red ? '#ff6159' : 'rgba(225,233,245,0.85)');
        }
      }
      // live bar
      const a = ang(rpm);
      if (rpm > 20) {
        const grd = ctx.createLinearGradient(...this.arcPt(g, g.a0), ...this.arcPt(g, g.a1));
        grd.addColorStop(0, 'rgba(70,150,255,0.95)');
        grd.addColorStop(1, 'rgba(210,235,255,1)');
        ctx.shadowColor = 'rgba(80,160,255,0.9)';
        ctx.shadowBlur = this.glow(8);
        ctx.beginPath();
        ctx.arc(g.cx, g.cy, g.r, g.a0 * DEG, a * DEG);
        ctx.strokeStyle = grd;
        ctx.lineWidth = 4.2;
        ctx.stroke();
        const [px, py] = this.arcPt(g, a);
        ctx.beginPath();
        ctx.arc(px, py, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
      ctx.restore();
      const [tx, ty] = this.arcPt(g, g.a1, g.r - 2);
      this.text(ctx, 'x1000 r/min', tx + 30, ty - 6, 10, 'rgba(200,210,225,0.7)', { align: 'left' });
    }

    /* ---------- right panel: GX top view with live front-wheel steering ---------- */
    drawTopView(ctx, st, t) {
      const g = MODE_ARC;
      // framing arc on the right, as on the real cluster
      ctx.save();
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.r, g.a0 * DEG, g.a1 * DEG);
      ctx.strokeStyle = 'rgba(210,222,240,0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      const cx = 1020, cy = 287;           // car centre
      const L = 118, Wd = 52;              // body length and width (design px)
      const pxm = L / 4.95;                // GX length 4.95 m
      const fy = cy - 0.30 * L, ry = cy + 0.31 * L, track = Wd / 2 - 2.5;
      const steer = st.wheel || 0;                         // steering-wheel angle, degrees
      const roadWheel = steer / 16;                        // actual front-wheel angle
      const shown = clamp(roadWheel * 6, -16, 16);         // drawn 6x so it can be seen

      ctx.save();
      // predicted path from the front wheels, following the current curvature
      const kappa = Math.tan(roadWheel * DEG) / 2.85;      // 1/m
      if (st.gear === 'D') {
        for (const side of [-1, 1]) {
          ctx.beginPath();
          for (let i = 0; i <= 14; i++) {
            const d = i * 0.75;                            // metres ahead
            const lat = 0.5 * kappa * d * d * 6;           // same visual gain as the wheels
            const x = cx + side * track + lat * pxm, y = fy - d * pxm * 0.42;
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          const gr = ctx.createLinearGradient(0, fy, 0, fy - 14 * 0.75 * pxm * 0.42);
          gr.addColorStop(0, 'rgba(90,190,255,0.75)');
          gr.addColorStop(1, 'rgba(90,190,255,0)');
          ctx.strokeStyle = gr;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      }

      // ground shadow
      const sh = ctx.createRadialGradient(cx, cy, 10, cx, cy, L * 0.62);
      sh.addColorStop(0, 'rgba(60,140,255,0.22)');
      sh.addColorStop(1, 'rgba(60,140,255,0)');
      ctx.fillStyle = sh;
      ctx.fillRect(cx - L, cy - L, 2 * L, 2 * L);

      // wheels (under the body)
      const wheel = (x, y, ang, front) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang * DEG);
        ctx.beginPath();
        ctx.roundRect(-5, -11, 10, 22, 3);
        ctx.fillStyle = front ? 'rgba(10,24,44,0.95)' : 'rgba(10,16,26,0.9)';
        ctx.fill();
        ctx.strokeStyle = front ? 'rgba(120,205,255,0.95)' : 'rgba(150,175,205,0.55)';
        ctx.lineWidth = 1.1;
        if (front) { ctx.shadowColor = 'rgba(80,180,255,0.9)'; ctx.shadowBlur = this.glow(6); }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(160,190,225,0.35)';
        ctx.lineWidth = 0.7;
        const roll = ((st.odoMeters || 0) * pxm * 0.5) % 4;
        for (let ty = -10 + roll; ty < 11; ty += 4) {
          ctx.beginPath(); ctx.moveTo(-4, ty); ctx.lineTo(4, ty); ctx.stroke();
        }
        ctx.restore();
      };

      // body silhouette (boxy GX: flat sides, squared nose and tail, flared arches)
      const hw = Wd / 2, top = cy - L / 2, bot = cy + L / 2;
      const body = new Path2D();
      body.moveTo(cx - hw + 7, top + 2);
      body.quadraticCurveTo(cx, top - 2, cx + hw - 7, top + 2);
      body.quadraticCurveTo(cx + hw, top + 4, cx + hw, top + 14);
      body.lineTo(cx + hw + 1.5, fy - 12); body.lineTo(cx + hw + 1.5, fy + 12);   // front arch flare
      body.lineTo(cx + hw, fy + 16); body.lineTo(cx + hw, ry - 16);
      body.lineTo(cx + hw + 1.5, ry - 12); body.lineTo(cx + hw + 1.5, ry + 12);   // rear arch flare
      body.lineTo(cx + hw, ry + 16);
      body.lineTo(cx + hw, bot - 6);
      body.quadraticCurveTo(cx + hw, bot, cx + hw - 6, bot);
      body.lineTo(cx - hw + 6, bot);
      body.quadraticCurveTo(cx - hw, bot, cx - hw, bot - 6);
      body.lineTo(cx - hw, ry + 16); body.lineTo(cx - hw - 1.5, ry + 12); body.lineTo(cx - hw - 1.5, ry - 12);
      body.lineTo(cx - hw, ry - 16); body.lineTo(cx - hw, fy + 16);
      body.lineTo(cx - hw - 1.5, fy + 12); body.lineTo(cx - hw - 1.5, fy - 12);
      body.lineTo(cx - hw, top + 14);
      body.quadraticCurveTo(cx - hw, top + 4, cx - hw + 7, top + 2);
      body.closePath();
      const fill = ctx.createLinearGradient(cx - hw, 0, cx + hw, 0);
      fill.addColorStop(0, 'rgba(30,52,86,0.62)');
      fill.addColorStop(0.5, 'rgba(48,82,128,0.55)');
      fill.addColorStop(1, 'rgba(30,52,86,0.62)');
      ctx.fillStyle = fill;
      ctx.fill(body);
      // wheels show through the translucent body; the fronts turn with the steering
      wheel(cx - track, fy, shown, true);
      wheel(cx + track, fy, shown, true);
      wheel(cx - track, ry, 0, false);
      wheel(cx + track, ry, 0, false);

      // mesh: longitudinal and transverse lines clipped to the body
      ctx.save();
      ctx.clip(body);
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = 'rgba(140,200,255,0.32)';
      for (let i = 1; i < 8; i++) {
        const x = cx - hw + Wd * i / 8;
        const bulge = Math.sin(Math.PI * i / 8) * 2.5;
        ctx.beginPath(); ctx.moveTo(x, top); ctx.quadraticCurveTo(x + (i < 4 ? -bulge : i > 4 ? bulge : 0), cy, x, bot); ctx.stroke();
      }
      for (let y = top + 6; y < bot; y += 8.5) {
        ctx.beginPath(); ctx.moveTo(cx - hw, y); ctx.quadraticCurveTo(cx, y - 2.5, cx + hw, y); ctx.stroke();
      }
      // a scan line sweeping along the body
      const scan = top + ((t * 38) % (L + 40)) - 20;
      const sg = ctx.createLinearGradient(0, scan - 10, 0, scan + 10);
      sg.addColorStop(0, 'rgba(120,210,255,0)');
      sg.addColorStop(0.5, 'rgba(120,210,255,0.22)');
      sg.addColorStop(1, 'rgba(120,210,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(cx - hw, scan - 10, Wd, 20);
      ctx.restore();

      // glass and roof
      ctx.fillStyle = 'rgba(8,16,30,0.9)';
      ctx.beginPath();                                           // windscreen
      ctx.moveTo(cx - hw + 6, top + 33); ctx.lineTo(cx + hw - 6, top + 33);
      ctx.lineTo(cx + hw - 9, top + 45); ctx.lineTo(cx - hw + 9, top + 45); ctx.closePath(); ctx.fill();
      ctx.beginPath();                                           // rear glass
      ctx.moveTo(cx - hw + 8, bot - 12); ctx.lineTo(cx + hw - 8, bot - 12);
      ctx.lineTo(cx + hw - 6, bot - 8); ctx.lineTo(cx - hw + 6, bot - 8); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(170,215,255,0.55)';
      ctx.lineWidth = 0.9;
      for (const s of [-1, 1]) {                                 // roof rails
        ctx.beginPath(); ctx.moveTo(cx + s * (hw - 8), top + 49); ctx.lineTo(cx + s * (hw - 8), bot - 16); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(cx - hw + 4, top + 30); ctx.quadraticCurveTo(cx, top + 26, cx + hw - 4, top + 30); ctx.stroke();  // hood line
      // mirrors
      ctx.fillStyle = 'rgba(48,82,128,0.95)';
      ctx.fillRect(cx - hw - 6, top + 35, 6, 4);
      ctx.fillRect(cx + hw, top + 35, 6, 4);
      // outline glow
      ctx.shadowColor = 'rgba(90,180,255,0.9)';
      ctx.shadowBlur = this.glow(7);
      ctx.strokeStyle = 'rgba(150,215,255,0.95)';
      ctx.lineWidth = 1.2;
      ctx.stroke(body);
      ctx.shadowBlur = 0;
      // headlights and tail lights
      ctx.fillStyle = st.ign === 'off' ? 'rgba(200,220,255,0.3)' : 'rgba(225,240,255,0.95)';
      ctx.fillRect(cx - hw + 3, top + 1, 12, 2);
      ctx.fillRect(cx + hw - 15, top + 1, 12, 2);
      ctx.fillStyle = st.accel < -0.6 ? 'rgba(255,60,50,1)' : 'rgba(220,40,40,0.75)';   // brake lights
      ctx.fillRect(cx - hw + 2, bot - 2.5, Wd - 4, 2);
      ctx.restore();

      // tyre pressures beside each wheel (psi), warming slowly while driving
      const warm = clamp((st.odo - 4236.2) * 0.4, 0, 2);
      const tp = [35 + warm, 35 + warm, 34 + warm, 34 + warm];
      const tl = [[cx - track - 24, fy], [cx + track + 24, fy], [cx - track - 24, ry], [cx + track + 24, ry]];
      tl.forEach(([x, y], i) => {
        this.text(ctx, tp[i].toFixed(0), x, y - 3, 13, '#eef4fb', { weight: 500 });
        this.text(ctx, 'psi', x, y + 9, 8.5, 'rgba(190,205,225,0.75)');
      });

      // headings: drive mode, steering angle
      this.text(ctx, `${st.modeTitle}  ${st.modes[st.modeIndex]}`, cx, 207, 11, 'rgba(215,226,242,0.9)', { weight: 500 });
      const dir = Math.abs(steer) < 0.5 ? '' : steer > 0 ? ' R' : ' L';
      this.text(ctx, `핸들 ${Math.abs(steer).toFixed(0)}°${dir}`, cx - 4, 362, 11, '#ffffff', { weight: 500, kr: true });
      this.text(ctx, `바퀴 ${Math.abs(roadWheel).toFixed(1)}°`, cx - 4, 375, 9, 'rgba(190,205,225,0.8)', { kr: true });
    }

    /* small G-meter: lateral from speed and curvature, longitudinal from acceleration */
    drawG(ctx, st) {
      const x = 1116, y = 298, r = 12;
      const v = st.speed / 3.6;
      const gx = clamp(v * v * Road.curvature(st.odoMeters) / 9.81, -0.6, 0.6);
      const gy = clamp(-(st.accel || 0) / 9.81, -0.6, 0.6);
      st.gLat = (st.gLat || 0) + (gx - (st.gLat || 0)) * 0.15;
      st.gLon = (st.gLon || 0) + (gy - (st.gLon || 0)) * 0.15;
      ctx.save();
      ctx.strokeStyle = 'rgba(190,210,235,0.45)';
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r / 2, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
      ctx.fillStyle = '#7fd2ff';
      ctx.shadowColor = 'rgba(90,190,255,0.9)';
      ctx.shadowBlur = this.glow(5);
      ctx.beginPath(); ctx.arc(x + st.gLat / 0.6 * r, y + st.gLon / 0.6 * r, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      const gt = Math.hypot(st.gLat, st.gLon);
      this.text(ctx, `${gt.toFixed(2)} G`, x, y + r + 9, 9.5, 'rgba(200,215,235,0.85)');
    }

    /* ---------- ignition ceremony: "Welcome to Global South 개발 진척 보고회" ---------- */
    sparks() {
      if (!this.sparkSet) {
        this.sparkSet = [];
        for (let i = 0; i < 90; i++) {
          this.sparkSet.push({
            a: Math.random() * Math.PI * 2,
            v: 70 + Math.random() * 260,
            r: 0.6 + Math.random() * 1.6,
            d: Math.random() * 0.5,
            gold: Math.random() < 0.35,
          });
        }
      }
      return this.sparkSet;
    }

    // letters of `str` rise into place one by one, blurred then sharp
    stagger(ctx, str, x, y, size, weight, font, t0, step, color, glow) {
      ctx.font = `${weight} ${size}px ${font}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const chars = [...str];
      const widths = chars.map((c) => ctx.measureText(c).width);
      let cx = x - widths.reduce((a, b) => a + b, 0) / 2;
      chars.forEach((c, i) => {
        const p = clamp((this.cerT - t0 - i * step) / 0.45, 0, 1);
        if (p > 0) {
          const e = ease(p);
          ctx.save();
          ctx.globalAlpha *= e;
          ctx.fillStyle = color;
          ctx.shadowColor = glow;
          ctx.shadowBlur = this.glow(4 + 14 * (1 - e));
          ctx.fillText(c, cx, y + (1 - e) * size * 0.55);
          ctx.restore();
        }
        cx += widths[i];
      });
      return widths.reduce((a, b) => a + b, 0);
    }

    ceremony(ctx, k) {
      if (k > 3.3) return;
      this.cerT = k;
      const fade = 1 - smooth(2.55, 3.2, k);
      const cx = 700, cy = 286;
      ctx.save();
      ctx.globalAlpha *= fade;

      // background: deep blue bloom that breathes in
      const bloom = ctx.createRadialGradient(cx, cy, 10, cx, cy, 420);
      bloom.addColorStop(0, `rgba(60,120,230,${0.42 * smooth(0, 0.8, k)})`);
      bloom.addColorStop(0.5, `rgba(30,60,140,${0.22 * smooth(0, 0.8, k)})`);
      bloom.addColorStop(1, 'rgba(5,10,30,0)');
      ctx.fillStyle = bloom;
      ctx.fillRect(X0, Y0, CW, CH);

      // perspective light lanes racing toward the centre
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 14; i++) {
        const side = i % 2 ? 1 : -1;
        const yy = cy - 60 + (i * 37) % 130;
        const ph = ((k * 1.6 + i * 0.137) % 1);
        const x0 = cx + side * (520 - ph * 520);
        const len = 60 + 140 * ph;
        const g = ctx.createLinearGradient(x0, 0, x0 - side * len, 0);
        g.addColorStop(0, `rgba(140,200,255,${0.35 * (1 - ph) * smooth(0.1, 0.6, k)})`);
        g.addColorStop(1, 'rgba(140,200,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(Math.min(x0, x0 - side * len), yy, len, 1.2);
      }
      ctx.restore();

      // horizon line opening from the centre
      const lw = CW * ease(clamp(k / 0.7, 0, 1));
      const hl = ctx.createLinearGradient(cx - lw / 2, 0, cx + lw / 2, 0);
      hl.addColorStop(0, 'rgba(120,180,255,0)');
      hl.addColorStop(0.5, 'rgba(240,248,255,0.95)');
      hl.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.fillStyle = hl;
      ctx.shadowColor = 'rgba(120,190,255,1)';
      ctx.shadowBlur = this.glow(14);
      ctx.fillRect(cx - lw / 2, cy + 34, lw, 1.3);
      ctx.shadowBlur = 0;

      // spark burst from the centre, gold and ice blue
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of this.sparks()) {
        const tt = k - 0.35 - p.d;
        if (tt <= 0 || tt > 1.8) continue;
        const dist = p.v * (1 - Math.exp(-tt * 2.2));
        const x = cx + Math.cos(p.a) * dist * 1.6, y = cy + Math.sin(p.a) * dist * 0.55;
        const al = (1 - tt / 1.8);
        ctx.fillStyle = p.gold ? `rgba(255,214,140,${al})` : `rgba(170,215,255,${al})`;
        ctx.beginPath();
        ctx.arc(x, y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // the words
      this.stagger(ctx, 'Welcome to', cx, cy - 48, 15, 300, FONT, 0.35, 0.04, 'rgba(220,232,250,0.95)', 'rgba(120,180,255,0.9)');
      const gw = this.stagger(ctx, 'Global South', cx, cy - 8, 46, 300, FONT, 0.7, 0.055, '#ffffff', 'rgba(130,190,255,1)');
      // shimmer sweeping across "Global South"
      const sp = smooth(1.5, 2.3, k);
      if (sp > 0 && sp < 1) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.font = `300 46px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const sx = cx - gw / 2 - 60 + (gw + 120) * sp;
        const sg = ctx.createLinearGradient(sx - 40, 0, sx + 40, 0);
        sg.addColorStop(0, 'rgba(255,230,170,0)');
        sg.addColorStop(0.5, 'rgba(255,236,190,0.95)');
        sg.addColorStop(1, 'rgba(255,230,170,0)');
        ctx.fillStyle = sg;
        ctx.fillText('Global South', cx, cy - 8);
        ctx.restore();
      }
      // subtitle with a gold rule either side
      const ta = smooth(1.35, 2.0, k);
      if (ta > 0) {
        ctx.save();
        ctx.globalAlpha *= ta;
        ctx.font = `500 15px ${KR}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if ('letterSpacing' in ctx) ctx.letterSpacing = `${2 + 8 * (1 - ta)}px`;
        ctx.fillStyle = '#ffe2a8';
        ctx.shadowColor = 'rgba(255,190,90,0.8)';
        ctx.shadowBlur = this.glow(8);
        ctx.fillText('개발 진척 보고회', cx, cy + 34 + 18);
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
        ctx.shadowBlur = 0;
        const rw = 70 * ease(ta);
        const rg = (x0, x1) => { const g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, 'rgba(255,210,140,0)'); g.addColorStop(1, 'rgba(255,210,140,0.9)'); return g; };
        ctx.fillStyle = rg(cx - 82 - rw, cx - 82);
        ctx.fillRect(cx - 82 - rw, cy + 51.5, rw, 1);
        ctx.fillStyle = rg(cx + 82 + rw, cx + 82);
        ctx.fillRect(cx + 82, cy + 51.5, rw, 1);
        ctx.restore();
      }
      // a white flash as the gauges take over
      const fl = smooth(2.5, 2.65, k) * (1 - smooth(2.65, 3.0, k));
      if (fl > 0) {
        ctx.fillStyle = `rgba(210,230,255,${0.14 * fl})`;
        ctx.fillRect(X0, Y0, CW, CH);
      }
      ctx.restore();
    }

    /* ---------- ignition off: the gauges dissolve, a farewell, the line collapses ---------- */
    farewell(ctx, k) {
      const cx = 700, cy = 286;
      ctx.save();
      const a = smooth(0.25, 0.7, k) * (1 - smooth(1.7, 2.3, k));
      if (a > 0) {
        ctx.globalAlpha *= a;
        const bloom = ctx.createRadialGradient(cx, cy, 10, cx, cy, 380);
        bloom.addColorStop(0, 'rgba(50,100,200,0.32)');
        bloom.addColorStop(1, 'rgba(5,10,30,0)');
        ctx.fillStyle = bloom;
        ctx.fillRect(X0, Y0, CW, CH);
        ctx.font = `300 30px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if ('letterSpacing' in ctx) ctx.letterSpacing = `${4 + 10 * smooth(0.3, 2.2, k)}px`;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(130,190,255,0.9)';
        ctx.shadowBlur = this.glow(10);
        ctx.fillText('See you soon', cx, cy - 14);
        ctx.font = `500 12px ${KR}`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,226,168,0.9)';
        ctx.fillText('Global South 개발 진척 보고회', cx, cy + 18);
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      }
      ctx.globalAlpha = 1;
      // the horizon line shrinks to a point, flares and goes out
      const lk = smooth(1.6, 2.5, k);
      const lw = CW * 0.8 * (1 - lk);
      const la = smooth(0.2, 0.6, k) * (1 - smooth(2.5, 2.9, k));
      if (la > 0) {
        const hl = ctx.createLinearGradient(cx - lw / 2 - 1, 0, cx + lw / 2 + 1, 0);
        hl.addColorStop(0, 'rgba(120,180,255,0)');
        hl.addColorStop(0.5, `rgba(240,248,255,${la})`);
        hl.addColorStop(1, 'rgba(120,180,255,0)');
        ctx.fillStyle = hl;
        ctx.shadowColor = 'rgba(120,190,255,1)';
        ctx.shadowBlur = this.glow(12);
        ctx.fillRect(cx - lw / 2 - 1, cy + 40, lw + 2, 1.3);
        const dot = smooth(2.2, 2.5, k) * (1 - smooth(2.5, 2.9, k));
        if (dot > 0) {
          ctx.fillStyle = `rgba(235,245,255,${dot})`;
          ctx.beginPath(); ctx.arc(cx, cy + 40.6, 2.5 + 3 * dot, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    }

    /* ---------- now playing ---------- */
    cover() {
      if (this.coverArt) return this.coverArt;
      // a stand-in cover drawn in code (no album art is bundled)
      const c = document.createElement('canvas');
      c.width = c.height = 160;
      const g = c.getContext('2d');
      const bg = g.createLinearGradient(0, 0, 160, 160);
      bg.addColorStop(0, '#1a0638');
      bg.addColorStop(0.55, '#3b0a5e');
      bg.addColorStop(1, '#06213f');
      g.fillStyle = bg;
      g.fillRect(0, 0, 160, 160);
      for (let i = 0; i < 6; i++) {
        g.strokeStyle = i % 2 ? 'rgba(0,240,255,0.55)' : 'rgba(255,60,200,0.55)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(80, 170, 40 + i * 22, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke();
      }
      g.font = '700 38px "Barlow", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = '#ff3fd2';
      g.shadowBlur = 16;
      g.fillStyle = '#ffd6f6';
      g.fillText('NEON', 80, 70);
      g.shadowColor = '#00eaff';
      g.shadowBlur = 8;
      g.font = '600 14px "Barlow", Arial, sans-serif';
      g.fillStyle = '#c8fbff';
      g.fillText('A2O LITE', 80, 104);
      this.coverArt = c;
      return c;
    }

    nowPlaying(ctx, st, t) {
      const m = st.music;
      if (!m) return;
      const x = 446, y = 298, w = 172, h = 46;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 8);
      ctx.fillStyle = 'rgba(8,13,22,0.82)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,90,210,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.drawImage(this.cover(), x + 5, y + 5, 36, 36);
      // title and artist scroll as a marquee inside the panel
      const tx = x + 48, tw = w - 54;
      ctx.save();
      ctx.beginPath();
      ctx.rect(tx, y + 3, tw, 26);
      ctx.clip();
      const line = `${m.title}  ·  ${m.artist}  ·  ${m.single}`;
      ctx.font = `600 12px ${FONT}`;
      const lw = ctx.measureText(line).width + 40;
      const off = (t * 28) % lw;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(line, tx - off, y + 15);
      ctx.fillText(line, tx - off + lw, y + 15);
      ctx.restore();
      // edge fades so the marquee runs out softly
      for (const [fx, dir] of [[tx, 1], [tx + tw, -1]]) {
        const g = ctx.createLinearGradient(fx, 0, fx + dir * 10, 0);
        g.addColorStop(0, 'rgba(8,13,22,1)');
        g.addColorStop(1, 'rgba(8,13,22,0)');
        ctx.fillStyle = g;
        ctx.fillRect(dir > 0 ? fx : fx - 10, y + 3, 10, 26);
      }
      // progress
      const p = m.pos / m.len;
      ctx.fillStyle = 'rgba(200,212,230,0.25)';
      ctx.fillRect(tx, y + 32, tw - 40, 2);
      const pg = ctx.createLinearGradient(tx, 0, tx + tw - 40, 0);
      pg.addColorStop(0, '#ff4fd8');
      pg.addColorStop(1, '#3fe4ff');
      ctx.fillStyle = pg;
      ctx.fillRect(tx, y + 32, (tw - 40) * p, 2);
      const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      this.text(ctx, `${fmt(m.pos)} / ${fmt(m.len)}`, x + w - 6, y + 34, 8.5, 'rgba(205,215,232,0.85)', { align: 'right' });
      // little equaliser beside the cover
      for (let i = 0; i < 3; i++) {
        const hh = 3 + 5 * Math.abs(Math.sin(t * (5 + i * 1.7) + i));
        ctx.fillStyle = 'rgba(63,228,255,0.9)';
        ctx.fillRect(x + 7 + i * 4, y + 39 - hh, 2.4, hh);
      }
      ctx.restore();
    }

    bar(ctx, x0, x1, y, frac, warn) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(200,212,230,0.35)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.strokeStyle = warn ? AMBER : '#f2f6fb';
      ctx.shadowColor = warn ? AMBER_GLOW : 'rgba(200,225,255,0.6)';
      ctx.shadowBlur = this.glow(4);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + (x1 - x0) * clamp(frac, 0.02, 1), y);
      ctx.stroke();
      ctx.restore();
      const mid = (x0 + x1) / 2;
      ctx.fillStyle = 'rgba(220,228,240,0.6)';
      ctx.fillRect(mid - 0.5, y - 5, 1, 4);
    }

    lamps(ctx, st, t) {
      const all = st.bulbCheck;
      const blink = Math.sin(t * Math.PI * 2 * 1.5) > -0.3;
      SimData.RED.forEach((w, i) => {
        if (all || (st.redActive.has(w.id) && (!w.blink || blink))) {
          SimIcons.drawIcon(ctx, w.id, RED_X[i], LAMP_Y, 24, RED, RED_GLOW);
        }
      });
      SimData.AMBER.forEach((w, i) => {
        if (all || st.amberActive.has(w.id)) SimIcons.drawIcon(ctx, w.id, AMBER_X[i], LAMP_Y, 24, AMBER, AMBER_GLOW);
      });
      if (all || st.cruise) SimIcons.drawIcon(ctx, 'acc', 266, 262, 24, GREEN, GREEN_GLOW);
      if (all || st.cruise) SimIcons.drawIcon(ctx, 'cruise', 266, 296, 22, GREEN, GREEN_GLOW);
    }

    popup(ctx, st, t) {
      const p = st.popup;
      if (!p) return;
      const age = t - p.t0;
      const a = age < 0.25 ? age / 0.25 : age > p.dur - 0.5 ? Math.max(0, (p.dur - age) / 0.5) : 1;
      if (a <= 0) return;
      const red = p.level === 'red';
      const col = red ? RED : AMBER;
      const x = 505, y = 248, w = 380, h = 104;
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.translate(0, (1 - ease(age / 0.3)) * 8);
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 10);
      ctx.fillStyle = 'rgba(6,9,16,0.9)';
      ctx.fill();
      ctx.strokeStyle = red ? 'rgba(255,70,55,0.75)' : 'rgba(255,180,40,0.75)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillRect(x + 1, y + 12, 2.4, h - 24);
      const pulse = red ? 0.7 + 0.3 * Math.sin(age * Math.PI * 2 * 1.5) : 1;
      ctx.globalAlpha *= pulse;
      SimIcons.drawIcon(ctx, p.item.id, x + 52, y + h / 2, 46, col, red ? RED_GLOW : AMBER_GLOW);
      ctx.globalAlpha /= pulse;
      this.text(ctx, p.item.title, x + 98, y + 36, 18, '#ffffff', { kr: true, weight: 600, align: 'left' });
      this.text(ctx, p.item.desc, x + 98, y + 62, 12.5, 'rgba(210,218,230,0.9)', { kr: true, align: 'left' });
      this.text(ctx, red ? '경고' : '주의', x + 98, y + 84, 11, col, { kr: true, weight: 600, align: 'left' });
      ctx.restore();
    }

    welcome(ctx, k) {
      if (k > 1.4) return;
      const a = 1 - smooth(0.7, 1.4, k);
      const w = CW * ease(k / 0.55);
      const cx = X0 + CW / 2, cy = 300;
      ctx.save();
      ctx.globalAlpha *= a;
      const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
      g.addColorStop(0, 'rgba(120,180,255,0)');
      g.addColorStop(0.5, 'rgba(235,245,255,1)');
      g.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.fillStyle = g;
      ctx.shadowColor = 'rgba(120,190,255,1)';
      ctx.shadowBlur = this.glow(18);
      ctx.fillRect(cx - w / 2, cy - 0.8, w, 1.6);
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, 260);
      halo.addColorStop(0, 'rgba(90,150,255,0.25)');
      halo.addColorStop(1, 'rgba(90,150,255,0)');
      ctx.shadowBlur = 0;
      ctx.fillStyle = halo;
      ctx.fillRect(X0, Y0, CW, CH);
      ctx.restore();
    }

    render(st, t, dt) {
      const ctx = this.ctx;
      const s = this.scale;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (st.backlight <= 0.002) return;

      ctx.setTransform(s, 0, 0, s, -X0 * s, -Y0 * s);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(X0 + 1, Y0 + 1, CW - 2, CH - 2, 14);
      ctx.clip();
      ctx.globalAlpha = st.backlight;
      const k = st.bootT;                      // seconds since the display woke up
      const boot = st.ceremony ? 2.6 : 0;        // the start-up ceremony plays first
      const offA = st.ign === 'off' ? 1 - smooth(0, 0.5, st.ignT) : 1;   // gauges dissolve at switch-off
      const mapA = smooth(0.35 + boot, 1.2 + boot, k) * offA;
      const uiA = smooth(0.9 + boot * 0.85, 1.7 + boot * 0.85, k) * offA;

      this.drawBackground(ctx);
      ctx.globalAlpha = st.backlight * mapA;
      this.drawMap(ctx, st, dt);
      this.drawArrow(ctx);
      ctx.globalAlpha = st.backlight;
      this.shade(ctx);
      if (st.ceremony) this.ceremony(ctx, k);
      else this.welcome(ctx, k);
      if (st.ign === 'off') {                   // ignition off: gauges dissolve into the farewell
        ctx.globalAlpha = 1;
        this.farewell(ctx, st.ignT);
        ctx.globalAlpha = st.backlight;
      }

      ctx.globalAlpha = st.backlight * uiA;
      const rpm = st.sweep >= 0 ? st.sweep * TACH.max : st.rpm;
      this.drawTach(ctx, rpm);
      this.drawTopView(ctx, st, t);
      this.drawG(ctx, st);
      this.guidance(ctx, st);
      this.nowPlaying(ctx, st, t);
      // live engine speed under the tachometer scale
      this.text(ctx, Math.round(rpm / 10 * 10).toLocaleString('en-US'), 392, 366, 19, '#ffffff', { weight: 500 });
      this.text(ctx, 'rpm', 392, 382, 9.5, 'rgba(200,212,230,0.8)');

      // top centre: speed, unit, gear
      this.text(ctx, String(Math.round(st.speed)), 695, 180, 64, '#ffffff', { weight: 300, glow: 'rgba(180,215,255,0.35)' });
      this.text(ctx, 'km/h', 695, 207, 11.5, 'rgba(225,232,242,0.9)', { weight: 500 });
      ctx.fillStyle = 'rgba(225,232,242,0.75)';
      ctx.fillRect(652, 206.5, 26, 1.1);
      ctx.fillRect(712, 206.5, 26, 1.1);
      // gear: D plus the gear actually engaged; flashes briefly on each shift
      if (st.gear === 'D') {
        if (st.gearNum !== this.lastGear) { this.shiftAt = t; this.shiftUp = st.gearNum > (this.lastGear || 0); this.lastGear = st.gearNum; }
        const flash = 1 - smooth(0, 0.6, t - (this.shiftAt || -9));
        this.text(ctx, 'D', 689, 229, 23, '#ffffff', { weight: 500 });
        this.text(ctx, String(st.gearNum), 703, 233, 14, flash > 0.02 ? `rgba(120,205,255,${0.6 + 0.4 * flash})` : 'rgba(220,230,244,0.95)', { weight: 600, align: 'left', glow: flash > 0.02 ? 'rgba(90,180,255,0.9)' : null });
        if (flash > 0.02) this.text(ctx, this.shiftUp ? '▲' : '▼', 722, 229, 8, `rgba(120,205,255,${flash})`);
      } else {
        this.lastGear = 0;
        this.text(ctx, st.gear, 695, 229, 23, '#ffffff', { weight: 500 });
      }
      this.text(ctx, `${st.outside}°C`, 540, 174, 25, '#f1f4f8', { weight: 400 });
      this.text(ctx, st.clock, 845, 174, 25, '#f1f4f8', { weight: 400 });
      ctx.font = `400 25px ${FONT}`;
      this.text(ctx, st.ampm, 849 + ctx.measureText(st.clock).width / 2, 179, 10, 'rgba(210,220,236,0.85)', { align: 'left', weight: 500 });
      // compass heading of the road ahead
      const hd = ((Road.heading(st.odoMeters) / DEG) % 360 + 360) % 360;
      const pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      this.text(ctx, pts[Math.round(hd / 45) % 8], 600, 214, 12, 'rgba(225,232,242,0.95)', { weight: 600 });
      this.text(ctx, `${Math.round(hd)}°`, 600, 228, 9.5, 'rgba(200,212,230,0.75)');
      SimIcons.drawIcon(ctx, 'lane', 800, 212, 17, st.cruise ? GREEN : 'rgba(225,232,242,0.75)', st.cruise ? GREEN_GLOW : null);

      // bottom: eco, coolant, odometer | fuel, range
      if (st.eco) this.text(ctx, 'ECO', 287, 416, 12.5, GREEN, { weight: 700, glow: GREEN_GLOW });
      this.text(ctx, 'C', 332, 417, 12, 'rgba(225,232,242,0.85)');
      this.text(ctx, 'H', 458, 417, 12, 'rgba(225,232,242,0.85)');
      this.bar(ctx, 342, 448, 417, (st.coolant - 40) / 90, st.coolant > 118);
      SimIcons.drawIcon(ctx, 'therm', 395, 402, 13, 'rgba(225,232,242,0.85)');
      this.text(ctx, `${Math.floor(st.odo).toLocaleString('en-US')} km`, 395, 434, 12.5, 'rgba(232,238,246,0.92)');
      this.text(ctx, 'E', 944, 417, 12, 'rgba(225,232,242,0.85)');
      this.text(ctx, 'F', 1077, 417, 12, 'rgba(225,232,242,0.85)');
      this.bar(ctx, 956, 1066, 417, st.fuel, st.fuel < 0.12);
      SimIcons.drawIcon(ctx, 'fuel', 962, 402, 13, 'rgba(225,232,242,0.9)');
      this.text(ctx, `${Math.round(st.range)}`, 1022, 403, 16, '#ffffff', { weight: 500, align: 'right' });
      this.text(ctx, 'km', 1026, 405, 10.5, 'rgba(225,232,242,0.85)', { align: 'left' });

      ctx.globalAlpha = st.backlight * Math.max(uiA, st.bulbCheck ? 1 : 0);
      this.lamps(ctx, st, t);
      ctx.globalAlpha = st.backlight;
      this.popup(ctx, st, t);

      // panel edge: the backlight falls off toward the bezel
      ctx.globalAlpha = 1;
      const edgeG = (x0, y0, x1, y1) => {
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, 'rgba(0,0,0,0.75)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        return g;
      };
      ctx.fillStyle = edgeG(0, Y0 + CH, 0, Y0 + CH - 26);
      ctx.fillRect(X0, Y0 + CH - 26, CW, 26);
      ctx.fillStyle = edgeG(0, Y0, 0, Y0 + 12);
      ctx.fillRect(X0, Y0, CW, 12);
      ctx.fillStyle = edgeG(X0, 0, X0 + 14, 0);
      ctx.fillRect(X0, Y0, 14, CH);
      ctx.fillStyle = edgeG(X0 + CW, 0, X0 + CW - 14, 0);
      ctx.fillRect(X0 + CW - 14, Y0, 14, CH);
      ctx.globalAlpha = st.backlight;

      // glass sheen
      const sheen = ctx.createLinearGradient(X0, Y0, X0 + 420, Y0 + 260);
      sheen.addColorStop(0, 'rgba(255,255,255,0.05)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(X0, Y0, CW, CH);
      ctx.restore();
    }
  }

  window.Cluster = Cluster;
})();
