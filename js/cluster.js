/* Digital instrument cluster renderer.
 *
 * Draws only the emissive part of the display (graphics, needles, lamps, map).
 * The canvas is composited with `mix-blend-mode: screen` over the photographed
 * black glass, so an empty canvas looks like a switched-off panel.
 * All coordinates below are in source-photo pixels (1712 x 1152).
 */
(function () {
  'use strict';

  const OX = 330, OY = 170, CW = 1070, CH = 430;
  const DEG = Math.PI / 180;
  const NUM = '"Barlow", "Helvetica Neue", Arial, sans-serif';
  const KR = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

  const SPEEDO = { cx: 540, cy: 380, R: 172, max: 260, a0: 140 * DEG, sweep: 260 * DEG };
  const TACHO = { cx: 1197, cy: 380, R: 172, max: 8000, a0: 140 * DEG, sweep: 260 * DEG };

  const MAP = { x: 690, y: 222, w: 356, h: 198 };
  const MAP_TD = { w: 480, h: 330, k: 1.15, carV: 0.88 };

  const RED_SLOTS = [785, 820, 855, 890, 925, 960];
  const AMBER_SLOTS = [772, 808, 844, 880, 916, 952];
  const RED = '#ff2b25', RED_GLOW = 'rgba(255,45,30,0.95)';
  const AMBER = '#ffad18', AMBER_GLOW = 'rgba(255,160,20,0.9)';

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
  const ang = (g, v) => g.a0 + g.sweep * clamp(v / g.max, 0, 1);
  const hash = (i, j, k) => {
    const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };

  class Cluster {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.face = document.createElement('canvas');
      this.td = document.createElement('canvas');
      this.mapCanvas = document.createElement('canvas');
      this.scale = 0;
      this.setScale(1);
    }

    static get rect() { return { x: OX, y: OY, w: CW, h: CH }; }

    setScale(s) {
      if (Math.abs(s - this.scale) < 0.01) return;
      this.scale = s;
      this.canvas.width = Math.round(CW * s);
      this.canvas.height = Math.round(CH * s);
      this.face.width = this.canvas.width;
      this.face.height = this.canvas.height;
      const ms = Math.min(s, 2.2);
      this.mapScale = ms;
      this.td.width = Math.round(MAP_TD.w * ms);
      this.td.height = Math.round(MAP_TD.h * ms);
      this.mapCanvas.width = Math.round(MAP.w * ms);
      this.mapCanvas.height = Math.round(MAP.h * ms);
      this.buildFace();
    }

    /* ---------- static artwork (rebuilt only when resolution changes) ---------- */
    buildFace() {
      const s = this.scale;
      const c = this.face.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.face.width, this.face.height);
      c.setTransform(s, 0, 0, s, -OX * s, -OY * s);

      // Assistant panel (occludes the map behind it)
      c.save();
      c.beginPath();
      c.moveTo(722, 545);
      c.lineTo(722, 432);
      c.arcTo(722, 418, 736, 418, 14);
      c.lineTo(998, 418);
      c.arcTo(1012, 418, 1012, 432, 14);
      c.lineTo(1012, 545);
      c.closePath();
      c.fillStyle = '#060708';
      c.fill();
      const edge = c.createLinearGradient(722, 0, 1012, 0);
      edge.addColorStop(0, 'rgba(200,206,216,0.05)');
      edge.addColorStop(0.5, 'rgba(215,220,230,0.6)');
      edge.addColorStop(1, 'rgba(200,206,216,0.05)');
      c.beginPath();
      c.moveTo(722, 470);
      c.lineTo(722, 432);
      c.arcTo(722, 418, 736, 418, 14);
      c.lineTo(998, 418);
      c.arcTo(1012, 418, 1012, 432, 14);
      c.lineTo(1012, 470);
      c.strokeStyle = edge;
      c.lineWidth = 1.4;
      c.stroke();
      c.restore();

      for (const cx of [792, 944]) {
        c.beginPath();
        c.arc(cx, 491, 33, 0, Math.PI * 2);
        c.strokeStyle = 'rgba(255,255,255,0.13)';
        c.lineWidth = 3;
        c.stroke();
        for (let i = 0; i < 24; i++) {
          const a = i / 24 * Math.PI * 2;
          c.beginPath();
          c.moveTo(cx + Math.cos(a) * 37, 491 + Math.sin(a) * 37);
          c.lineTo(cx + Math.cos(a) * 39.5, 491 + Math.sin(a) * 39.5);
          c.strokeStyle = 'rgba(255,255,255,0.18)';
          c.lineWidth = 1;
          c.stroke();
        }
      }

      this.drawDial(c, SPEEDO, true);
      this.drawDial(c, TACHO, false);

      c.font = `600 14px ${NUM}`;
      c.fillStyle = '#c4c8ce';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      if ('letterSpacing' in c) c.letterSpacing = '1px';
      c.fillText('POWER', 393, 556);
      if ('letterSpacing' in c) c.letterSpacing = '0px';

      // fuel scale under the tachometer
      c.strokeStyle = 'rgba(255,255,255,0.32)';
      c.lineWidth = 3;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(1140, 517);
      c.lineTo(1254, 517);
      c.stroke();
      c.lineWidth = 1.4;
      for (const x of [1140, 1197, 1254]) {
        c.beginPath();
        c.moveTo(x, 510);
        c.lineTo(x, 524);
        c.strokeStyle = 'rgba(255,255,255,0.55)';
        c.stroke();
      }
      c.font = `italic 400 13px ${NUM}`;
      c.fillStyle = '#d4d8dd';
      c.fillText('0', 1140, 536);
      c.fillText('1/2', 1197, 536);
      c.fillText('1', 1254, 536);
      SimIcons.drawIcon(c, 'fuel', 1118, 516, 17, '#d4d8dd');
    }

    drawDial(c, g, isSpeed) {
      const { cx, cy, R } = g;
      // inner disc: occludes the map and gives the glass a little depth
      const disc = c.createRadialGradient(cx, cy - 30, 10, cx, cy, R);
      disc.addColorStop(0, '#0d0f12');
      disc.addColorStop(0.75, '#07080a');
      disc.addColorStop(1, '#040506');
      c.beginPath();
      c.arc(cx, cy, R, 0, Math.PI * 2);
      c.fillStyle = disc;
      c.fill();

      // chrome-like outer ring with soft bloom
      c.save();
      c.shadowColor = 'rgba(190,215,255,0.55)';
      c.shadowBlur = 9;
      const rg = c.createLinearGradient(cx, cy - R, cx, cy + R);
      rg.addColorStop(0, '#f4f7fb');
      rg.addColorStop(0.5, '#c9ced6');
      rg.addColorStop(1, '#eef2f6');
      c.beginPath();
      c.arc(cx, cy, R, 0, Math.PI * 2);
      c.strokeStyle = rg;
      c.lineWidth = 2.6;
      c.stroke();
      c.restore();
      c.beginPath();
      c.arc(cx, cy, R - 5, 0, Math.PI * 2);
      c.strokeStyle = 'rgba(255,255,255,0.07)';
      c.lineWidth = 1;
      c.stroke();

      const max = g.max;
      const step = isSpeed ? 5 : 250;
      const majorEvery = isSpeed ? 20 : 1000;
      const midEvery = isSpeed ? 10 : 500;
      const redFrom = isSpeed ? Infinity : 6500;

      if (!isSpeed) {
        c.save();
        c.shadowColor = 'rgba(255,40,40,0.8)';
        c.shadowBlur = 6;
        c.beginPath();
        c.arc(cx, cy, R - 7, ang(g, redFrom), ang(g, max));
        c.strokeStyle = 'rgba(228,32,42,0.95)';
        c.lineWidth = 4;
        c.stroke();
        c.restore();
      }

      c.lineCap = 'butt';
      for (let v = 0; v <= max + 0.001; v += step) {
        const a = ang(g, v);
        let len, lw, col;
        if (v % majorEvery === 0) { len = 16; lw = 3.2; col = '#f5f7fa'; }
        else if (v % midEvery === 0) { len = 10; lw = 2.0; col = '#d9dde3'; }
        else { len = 6; lw = 1.2; col = 'rgba(215,220,228,0.65)'; }
        if (v >= redFrom) col = v % majorEvery === 0 ? '#ff3b3b' : '#e0262f';
        const r0 = R - 11, r1 = r0 - len;
        c.save();
        c.shadowColor = v >= redFrom ? 'rgba(255,40,40,0.7)' : 'rgba(220,235,255,0.45)';
        c.shadowBlur = 4;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        c.strokeStyle = col;
        c.lineWidth = lw;
        c.stroke();
        c.restore();
      }

      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.save();
      c.shadowColor = 'rgba(220,235,255,0.35)';
      c.shadowBlur = 5;
      if (isSpeed) {
        c.font = `italic 400 22px ${NUM}`;
        for (let v = 0; v <= max; v += 20) {
          const a = ang(g, v), r = R - 46;
          c.fillStyle = '#eef1f5';
          c.fillText(String(v), cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
      } else {
        c.font = `italic 400 30px ${NUM}`;
        for (let v = 0; v <= 8; v++) {
          const a = ang(g, v * 1000), r = R - 46;
          c.fillStyle = v >= 7 ? '#ff4a44' : '#eef1f5';
          c.fillText(String(v), cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
      }
      c.restore();

      c.font = `italic 400 15px ${NUM}`;
      c.fillStyle = '#c9cdd3';
      c.fillText(isSpeed ? 'km/h' : '1/min x 1000', cx, cy - 54);
    }

    /* ---------- navigation map ---------- */
    drawMap(ctx, st) {
      const ms = this.mapScale;
      const td = this.td.getContext('2d');
      const { w: tw, h: th, k } = MAP_TD;
      td.setTransform(ms, 0, 0, ms, 0, 0);
      td.fillStyle = '#54585e';
      td.fillRect(0, 0, tw, th);

      const dist = st.odoMeters;
      td.save();
      td.translate(tw / 2, th * MAP_TD.carV);
      td.scale(k, k);
      td.translate(0, dist);

      const G = 55;
      const halfW = tw / 2 / k + G;
      const i0 = Math.floor(-halfW / G), i1 = Math.ceil(halfW / G);
      const yTop = -dist - th * MAP_TD.carV / k - G, yBot = -dist + th * (1 - MAP_TD.carV) / k + G;
      const j0 = Math.floor(yTop / G), j1 = Math.ceil(yBot / G);
      const node = (i, j) => [
        i === 0 ? 0 : i * G + (hash(i, j, 1) - 0.5) * G * 0.55,
        j * G + (hash(i, j, 2) - 0.5) * G * 0.5,
      ];

      // land use: parks, water, built-up blocks
      for (let i = i0; i < i1; i++) {
        for (let j = j0; j < j1; j++) {
          const h = hash(i, j, 5);
          let col = null;
          if (h < 0.07 && i !== 0 && i !== -1) col = '#4a5d6e';
          else if (h < 0.17) col = '#58665b';
          else if (h < 0.55) col = '#5e6268';
          if (!col) continue;
          const a = node(i, j), b = node(i + 1, j), c2 = node(i + 1, j + 1), d = node(i, j + 1);
          td.beginPath();
          const inset = 0.16;
          const cxm = (a[0] + b[0] + c2[0] + d[0]) / 4, cym = (a[1] + b[1] + c2[1] + d[1]) / 4;
          for (const p of [a, b, c2, d]) {
            td.lineTo(p[0] + (cxm - p[0]) * inset, p[1] + (cym - p[1]) * inset);
          }
          td.closePath();
          td.fillStyle = col;
          td.fill();
        }
      }

      const segs = [];
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const p = node(i, j);
          if (hash(i, j, 3) < 0.74 || j % 4 === 0) {
            segs.push([p, node(i + 1, j), (j % 4 === 0) ? 1 : 0, hash(i, j, 7)]);
          }
          if (i === 0) segs.push([p, node(i, j + 1), 2, 0.5]);
          else if (hash(i, j, 4) < 0.74 || i % 4 === 0) {
            segs.push([p, node(i, j + 1), (i % 4 === 0) ? 1 : 0, hash(i, j, 8)]);
          }
        }
      }
      const widths = [[5.4, 3.0], [7.2, 4.6], [9.0, 6.2]];
      const fills = ['#c2c6cb', '#dfe2e6', '#f3f5f7'];
      for (let pass = 0; pass < 2; pass++) {
        for (const [a, b, type, bend] of segs) {
          td.beginPath();
          td.moveTo(a[0], a[1]);
          if (type === 2) td.lineTo(b[0], b[1]);
          else {
            const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const off = (bend - 0.5) * 0.35;
            td.quadraticCurveTo(mx - dy * off, my + dx * off, b[0], b[1]);
          }
          td.lineWidth = widths[type][pass === 0 ? 0 : 1] / k;
          td.strokeStyle = pass === 0 ? '#3a3d42' : fills[type];
          td.lineCap = 'round';
          td.stroke();
        }
      }
      td.restore();

      // perspective "3D" projection by horizontal slices
      const mc = this.mapCanvas.getContext('2d');
      const mw = this.mapCanvas.width, mh = this.mapCanvas.height;
      mc.setTransform(1, 0, 0, 1, 0, 0);
      mc.globalCompositeOperation = 'source-over';
      mc.clearRect(0, 0, mw, mh);
      const N = 96;
      const gF = (v) => v * (1.5 - 0.5 * v);
      const tdw = this.td.width, tdh = this.td.height;
      for (let n = 0; n < N; n++) {
        const v0 = n / N, v1 = (n + 1) / N;
        const sw = tdw * (1 - 0.42 * (v0 + v1) / 2);
        const sy0 = tdh * gF(v0), sy1 = tdh * gF(v1);
        mc.drawImage(this.td, (tdw - sw) / 2, sy0, sw, Math.max(1, sy1 - sy0),
          0, Math.floor(v0 * mh), mw, Math.ceil((v1 - v0) * mh) + 1);
      }
      mc.globalCompositeOperation = 'destination-in';
      let gr = mc.createLinearGradient(0, 0, mw, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(0.2, 'rgba(0,0,0,1)');
      gr.addColorStop(0.8, 'rgba(0,0,0,1)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      mc.fillStyle = gr;
      mc.fillRect(0, 0, mw, mh);
      gr = mc.createLinearGradient(0, 0, 0, mh);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(0.3, 'rgba(0,0,0,0.92)');
      gr.addColorStop(1, 'rgba(0,0,0,1)');
      mc.fillStyle = gr;
      mc.fillRect(0, 0, mw, mh);
      mc.globalCompositeOperation = 'source-over';

      ctx.drawImage(this.mapCanvas, MAP.x, MAP.y, MAP.w, MAP.h);
    }

    drawArrow(ctx) {
      const x = 867.5, y = 382;
      ctx.save();
      ctx.shadowColor = 'rgba(40,140,255,0.7)';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(x, y - 27);
      ctx.lineTo(x + 16, y + 11);
      ctx.lineTo(x, y + 2);
      ctx.closePath();
      ctx.fillStyle = '#1767d4';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(x, y - 27);
      ctx.lineTo(x - 16, y + 11);
      ctx.lineTo(x, y + 2);
      ctx.closePath();
      const g = ctx.createLinearGradient(x - 16, y, x, y);
      g.addColorStop(0, '#2f8cf6');
      g.addColorStop(1, '#62b4ff');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, y - 27);
      ctx.lineTo(x + 16, y + 11);
      ctx.lineTo(x, y + 2);
      ctx.lineTo(x - 16, y + 11);
      ctx.closePath();
      ctx.strokeStyle = 'rgba(205,230,255,0.85)';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.restore();
    }

    /* ---------- dynamic elements ---------- */
    needle(ctx, g, v) {
      const a = ang(g, v);
      const r1 = 50, r2 = g.R - 15;
      const ca = Math.cos(a), sa = Math.sin(a);
      const px = -sa, py = ca;
      const w0 = 2.7, w1 = 0.9;
      const bx = g.cx + ca * r1, by = g.cy + sa * r1;
      const tx = g.cx + ca * r2, ty = g.cy + sa * r2;
      ctx.save();
      ctx.shadowColor = 'rgba(255,40,30,0.85)';
      ctx.shadowBlur = 12;
      const gr = ctx.createLinearGradient(bx, by, tx, ty);
      gr.addColorStop(0, '#b3121d');
      gr.addColorStop(0.55, '#f0302c');
      gr.addColorStop(1, '#ff5b46');
      ctx.beginPath();
      ctx.moveTo(bx + px * w0, by + py * w0);
      ctx.lineTo(tx + px * w1, ty + py * w1);
      ctx.lineTo(tx - px * w1, ty - py * w1);
      ctx.lineTo(bx - px * w0, by - py * w0);
      ctx.closePath();
      ctx.fillStyle = gr;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(g.cx + ca * (r1 + 14), g.cy + sa * (r1 + 14));
      ctx.lineTo(g.cx + ca * (r2 - 6), g.cy + sa * (r2 - 6));
      ctx.strokeStyle = 'rgba(255,190,175,0.75)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.restore();
    }

    text(ctx, str, x, y, font, color, align) {
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textAlign = align || 'center';
      ctx.fillText(str, x, y);
    }

    miniGauge(ctx, cx, value, frac, color) {
      if (frac > 0.001) {
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(cx, 491, 33, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(frac, 0, 1));
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();
      }
      this.text(ctx, value, cx, 487, `italic 400 27px ${NUM}`, '#f2f4f7');
      this.text(ctx, 'km/h', cx, 512, `400 13px ${NUM}`, '#b9bec5');
    }

    lamps(ctx, st, t) {
      const all = st.bulbCheck;
      const blink = (Math.sin(t * Math.PI * 2 * 1.4) > -0.2);
      SimData.RED.forEach((w, i) => {
        if (all || st.redActive.has(w.id)) {
          const on = all || blink || !w.blink;
          if (on) SimIcons.drawIcon(ctx, w.id, RED_SLOTS[i], 207, 25, RED, RED_GLOW);
        }
      });
      SimData.AMBER.forEach((w, i) => {
        if (all || st.amberActive.has(w.id)) {
          SimIcons.drawIcon(ctx, w.id, AMBER_SLOTS[i], 558, 25, AMBER, AMBER_GLOW);
        }
      });
    }

    popup(ctx, st, t) {
      const p = st.popup;
      if (!p) return;
      const age = t - p.t0;
      const a = age < 0.25 ? age / 0.25 : age > p.dur - 0.5 ? Math.max(0, (p.dur - age) / 0.5) : 1;
      if (a <= 0) return;
      const red = p.level === 'red';
      const col = red ? RED : AMBER;
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.beginPath();
      ctx.roundRect(712, 240, 312, 170, 12);
      ctx.fillStyle = 'rgba(9,10,12,0.96)';
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = red ? 'rgba(255,60,50,0.85)' : 'rgba(255,175,30,0.85)';
      ctx.stroke();
      const pulse = 0.75 + 0.25 * Math.sin(age * Math.PI * 2 * 1.3);
      ctx.globalAlpha *= red ? pulse : 1;
      SimIcons.drawIcon(ctx, p.item.id, 868, 288, 52, col, red ? RED_GLOW : AMBER_GLOW);
      ctx.globalAlpha = a * (st.backlight || 1);
      ctx.textBaseline = 'middle';
      this.text(ctx, p.item.title, 868, 342, `600 19px ${KR}`, '#ffffff');
      this.text(ctx, p.item.desc, 868, 368, `400 14px ${KR}`, '#c6cad0');
      this.text(ctx, red ? 'WARNING' : 'CAUTION', 868, 393, `600 11px ${NUM}`, col);
      ctx.restore();
    }

    render(st, t) {
      const ctx = this.ctx;
      const s = this.scale;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (st.backlight <= 0.002) return;

      ctx.setTransform(s, 0, 0, s, -OX * s, -OY * s);
      ctx.globalAlpha = st.backlight;
      ctx.textBaseline = 'middle';

      this.drawMap(ctx, st);
      ctx.drawImage(this.face, OX, OY, CW, CH);
      this.drawArrow(ctx);

      const speedShown = st.sweep >= 0 ? st.sweep * SPEEDO.max : st.speedNeedle;
      const rpmShown = st.sweep >= 0 ? st.sweep * TACHO.max : st.rpm;

      // speedometer centre
      this.text(ctx, String(Math.round(st.speed)), 540, 384, `italic 300 52px ${NUM}`, '#ffffff');
      this.text(ctx, 'km/h', 541, 417, `italic 400 14px ${NUM}`, '#b8bdc4');
      this.text(ctx, st.trip.toFixed(1), 536, 502, `italic 300 30px ${NUM}`, '#f2f4f7');
      this.text(ctx, 'km', 574, 507, `italic 400 12px ${NUM}`, '#aeb3ba', 'left');
      this.text(ctx, Math.floor(st.odo).toLocaleString('en-US') + ' km', 540, 530, `400 11px ${NUM}`, '#9aa0a8');

      // tachometer centre: gear + engine speed
      const gearBig = st.gear === 'D' ? 'D' : st.gear;
      this.text(ctx, gearBig, st.gear === 'D' ? 1190 : 1197, 384, `italic 300 52px ${NUM}`, '#ffffff');
      if (st.gear === 'D') this.text(ctx, String(st.gearNum), 1214, 398, `italic 400 20px ${NUM}`, '#cfd3d9', 'left');
      this.text(ctx, `${Math.round(rpmShown / 10) * 10} rpm`, 1197, 417, `italic 400 14px ${NUM}`, '#b8bdc4');

      // fuel level
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = st.fuel < 0.12 ? AMBER : '#f2f4f7';
      ctx.shadowColor = 'rgba(230,240,255,0.5)';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(1140, 517);
      ctx.lineTo(1140 + 114 * st.fuel, 517);
      ctx.stroke();
      ctx.restore();

      // top bar
      this.text(ctx, st.clock, 727, 207, `italic 400 23px ${NUM}`, '#eef1f5');
      this.text(ctx, '20 °C', 1010, 207, `italic 400 23px ${NUM}`, '#eef1f5');
      this.text(ctx, st.gear, 1082, 207, `italic 400 23px ${NUM}`, '#eef1f5');

      // bottom bar
      this.text(ctx, `Range ${Math.round(st.range)} km`, 673, 557, `400 19px ${NUM}`, '#e4e7eb');
      this.text(ctx, `${st.outside}°C`, 1075, 557, `400 19px ${NUM}`, '#e4e7eb');

      // driver assistance panel
      const active = st.cruise;
      this.text(ctx, 'Assistant', 790, 437, `500 17px ${NUM}`, '#eef1f5');
      this.text(ctx, active ? 'Active' : 'Ready', 962, 437, `500 17px ${NUM}`, active ? '#5fe08f' : '#eef1f5');
      this.miniGauge(ctx, 792, String(st.setSpeed), st.speed / st.setSpeed, '#e9eef5');
      this.miniGauge(ctx, 944, String(st.limit), active ? 1 : 0, '#3fd27f');
      SimIcons.drawIcon(ctx, 'steer', 870, 523, 17, active ? '#4fd788' : '#6c7178', active ? 'rgba(60,220,130,0.6)' : null);
      SimIcons.drawIcon(ctx, 'hold', 1007, 521, 17, st.gear === 'D' && st.speed < 0.5 ? '#4fd788' : '#6c7178');

      this.needle(ctx, SPEEDO, speedShown);
      this.needle(ctx, TACHO, rpmShown);
      this.lamps(ctx, st, t);
      this.popup(ctx, st, t);
    }
  }

  window.Cluster = Cluster;
})();
