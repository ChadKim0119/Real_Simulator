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
  const PLACE = { x: 405, y: 95, k: 0.567 };   // display position in the interior photo
  const DEG = Math.PI / 180;
  const FONT = '"Barlow", "Helvetica Neue", Arial, sans-serif';
  const KR = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

  const TACH = { cx: 490, cy: 305, r: 192, a0: 148, a1: 218, max: 8000, red: 6000 };
  const MODE_ARC = { cx: 900, cy: 305, r: 192, a0: -40, a1: 32 };
  const MODE_Y = [253, 274, 295, 316, 337];
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
    constructor(canvas) {
      this.canvas = canvas;
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
      const x = 446, y = 240, w = 172, h = 58;
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
      ctx.arc(470, 338, 15, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 3.4;
      ctx.strokeStyle = '#e1251b';
      ctx.stroke();
      this.text(ctx, String(st.limit), 470, 339, 13, '#111111', { weight: 700 });
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

    drawModes(ctx, st) {
      const g = MODE_ARC;
      ctx.save();
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.r, g.a0 * DEG, g.a1 * DEG);
      ctx.strokeStyle = 'rgba(210,222,240,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const sel = st.modeIndex;
      const y = MODE_Y[sel];
      const deg = Math.asin(clamp((y - g.cy) / g.r, -1, 1)) / DEG;
      ctx.shadowColor = 'rgba(90,170,255,0.95)';
      ctx.shadowBlur = this.glow(8);
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.r, (deg - 4.5) * DEG, (deg + 4.5) * DEG);
      ctx.strokeStyle = '#8fd0ff';
      ctx.lineWidth = 3.2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      const [ax] = this.arcPt(g, deg);
      const bar = ctx.createLinearGradient(943, 0, ax, 0);
      bar.addColorStop(0, 'rgba(70,140,255,0.5)');
      bar.addColorStop(1, 'rgba(70,140,255,0.08)');
      ctx.fillStyle = bar;
      ctx.fillRect(943, y - 10, ax - 943, 20);
      ctx.fillStyle = 'rgba(160,205,255,0.85)';
      ctx.fillRect(943, y + 10, ax - 943, 1.2);
      ctx.restore();
      this.text(ctx, st.modeTitle, 1012, 222, 15, '#e9eef6', { weight: 500 });
      st.modes.forEach((m, i) => {
        this.text(ctx, m, 948, MODE_Y[i], 13.5, i === sel ? '#ffffff' : 'rgba(215,224,238,0.72)', { align: 'left', weight: i === sel ? 600 : 400 });
      });
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
      const mapA = smooth(0.35, 1.2, k);
      const uiA = smooth(0.9, 1.7, k);

      this.drawBackground(ctx);
      ctx.globalAlpha = st.backlight * mapA;
      this.drawMap(ctx, st, dt);
      this.drawArrow(ctx);
      ctx.globalAlpha = st.backlight;
      this.shade(ctx);
      this.welcome(ctx, k);

      ctx.globalAlpha = st.backlight * uiA;
      const rpm = st.sweep >= 0 ? st.sweep * TACH.max : st.rpm;
      this.drawTach(ctx, rpm);
      this.drawModes(ctx, st);
      this.guidance(ctx, st);

      // top centre: speed, unit, gear
      this.text(ctx, String(Math.round(st.speed)), 695, 180, 64, '#ffffff', { weight: 300, glow: 'rgba(180,215,255,0.35)' });
      this.text(ctx, 'km/h', 695, 207, 11.5, 'rgba(225,232,242,0.9)', { weight: 500 });
      ctx.fillStyle = 'rgba(225,232,242,0.75)';
      ctx.fillRect(652, 206.5, 26, 1.1);
      ctx.fillRect(712, 206.5, 26, 1.1);
      this.text(ctx, st.gear, 695, 229, 23, '#ffffff', { weight: 500 });
      this.text(ctx, `${st.outside}°C`, 540, 174, 25, '#f1f4f8', { weight: 400 });
      this.text(ctx, st.clock, 845, 174, 25, '#f1f4f8', { weight: 400 });
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
