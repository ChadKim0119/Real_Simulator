/* Telltale (warning lamp) icons, drawn as vector paths on a 24x24 grid. */
(function () {
  'use strict';

  function ring(ctx, r) {
    ctx.beginPath();
    ctx.arc(12, 12, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  function parens(ctx, r) {
    ctx.beginPath();
    ctx.arc(12, 12, r, Math.PI * 0.72, Math.PI * 1.28);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(12, 12, r, -Math.PI * 0.28, Math.PI * 0.28);
    ctx.stroke();
  }

  function dot(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function line(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
  }

  function bang(ctx, y0, y1, dy) {
    line(ctx, [12, y0, 12, y1]);
    dot(ctx, 12, dy, 1.05);
  }

  const ICONS = {
    brake(ctx) {
      ring(ctx, 6.3);
      parens(ctx, 9.7);
      bang(ctx, 8.4, 12.6, 15.3);
    },
    oil(ctx) {
      ctx.beginPath();
      ctx.moveTo(4.5, 10.6);
      ctx.lineTo(13.8, 10.6);
      ctx.lineTo(21.2, 7.9);
      ctx.lineTo(16.4, 15.6);
      ctx.lineTo(5.8, 15.6);
      ctx.closePath();
      ctx.stroke();
      line(ctx, [4.5, 11.2, 1.8, 9.6, 1.8, 12.8, 4.9, 14.1]);
      line(ctx, [9.2, 10.6, 9.2, 8.4]);
      line(ctx, [7.2, 8.3, 11.2, 8.3]);
      ctx.beginPath();
      ctx.moveTo(21.6, 10.6);
      ctx.quadraticCurveTo(23.0, 12.9, 21.6, 13.6);
      ctx.quadraticCurveTo(20.2, 12.9, 21.6, 10.6);
      ctx.fill();
    },
    battery(ctx) {
      ctx.beginPath();
      ctx.roundRect(2.8, 7.4, 18.4, 11.4, 1.3);
      ctx.stroke();
      ctx.fillRect(5.6, 5.0, 3.2, 2.4);
      ctx.fillRect(15.2, 5.0, 3.2, 2.4);
      line(ctx, [5.6, 13.1, 9.2, 13.1]);
      line(ctx, [14.6, 13.1, 18.2, 13.1]);
      line(ctx, [16.4, 11.3, 16.4, 14.9]);
    },
    coolant(ctx) {
      line(ctx, [12, 2.8, 12, 13.2]);
      dot(ctx, 12, 15.0, 2.3);
      line(ctx, [12, 5.0, 15.4, 5.0]);
      line(ctx, [12, 7.8, 14.6, 7.8]);
      line(ctx, [12, 10.6, 15.4, 10.6]);
      for (const y of [19.2, 22.0]) {
        ctx.beginPath();
        for (let x = 2.5; x <= 21.5; x += 0.5) {
          const yy = y + Math.sin((x - 2.5) / 4.75 * Math.PI * 2) * 0.9;
          if (x === 2.5) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    },
    seatbelt(ctx) {
      dot(ctx, 12, 4.0, 2.3);
      ctx.beginPath();
      ctx.moveTo(6.4, 21);
      ctx.lineTo(6.4, 10.6);
      ctx.quadraticCurveTo(6.4, 7.6, 9.4, 7.6);
      ctx.lineTo(14.6, 7.6);
      ctx.quadraticCurveTo(17.6, 7.6, 17.6, 10.6);
      ctx.lineTo(17.6, 21);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 1.7;
      line(ctx, [15.6, 7.8, 7.6, 18.0]);
      ctx.restore();
      ctx.fillRect(18.6, 15.8, 2.6, 4.2);
    },
    airbag(ctx) {
      dot(ctx, 5.6, 4.6, 2.2);
      ctx.save();
      ctx.lineWidth = 2.6;
      line(ctx, [6.2, 8.4, 7.6, 14.2, 12.6, 14.2, 14.2, 20.6]);
      ctx.restore();
      line(ctx, [4.4, 10.0, 4.6, 16.4, 9.6, 19.4]);
      dot(ctx, 16.2, 8.6, 4.6);
    },
    engine(ctx) {
      ctx.beginPath();
      ctx.moveTo(6.2, 8.2);
      ctx.lineTo(9.2, 8.2);
      ctx.lineTo(9.2, 6.4);
      ctx.lineTo(13.4, 6.4);
      ctx.lineTo(13.4, 8.2);
      ctx.lineTo(16.0, 8.2);
      ctx.lineTo(17.6, 10.0);
      ctx.lineTo(19.2, 10.0);
      ctx.lineTo(19.2, 8.4);
      ctx.lineTo(21.4, 8.4);
      ctx.lineTo(21.4, 16.2);
      ctx.lineTo(19.2, 16.2);
      ctx.lineTo(19.2, 14.6);
      ctx.lineTo(17.6, 14.6);
      ctx.lineTo(15.4, 17.6);
      ctx.lineTo(8.2, 17.6);
      ctx.lineTo(6.2, 15.2);
      ctx.closePath();
      ctx.stroke();
      line(ctx, [2.6, 9.4, 2.6, 15.0]);
      line(ctx, [2.6, 12.2, 6.2, 12.2]);
    },
    tpms(ctx) {
      ctx.beginPath();
      ctx.moveTo(6.6, 18.4);
      ctx.bezierCurveTo(3.4, 15.0, 3.6, 8.8, 6.2, 5.8);
      ctx.moveTo(17.8, 5.8);
      ctx.bezierCurveTo(20.4, 8.8, 20.6, 15.0, 17.4, 18.4);
      ctx.stroke();
      line(ctx, [5.2, 20.2, 7.0, 18.6, 8.8, 20.2, 10.6, 18.6, 12.4, 20.2, 14.2, 18.6, 16.0, 20.2, 17.8, 18.6, 19.0, 20.0]);
      bang(ctx, 8.0, 12.8, 15.6);
    },
    fuel(ctx) {
      ctx.beginPath();
      ctx.roundRect(4.8, 4.0, 9.2, 16.0, 1.2);
      ctx.stroke();
      ctx.fillRect(6.6, 6.0, 5.6, 4.4);
      line(ctx, [3.2, 20.2, 15.6, 20.2]);
      ctx.beginPath();
      ctx.moveTo(14.0, 9.4);
      ctx.lineTo(17.0, 9.4);
      ctx.quadraticCurveTo(18.6, 9.4, 18.6, 11.0);
      ctx.lineTo(18.6, 16.0);
      ctx.quadraticCurveTo(18.6, 17.6, 19.7, 17.6);
      ctx.quadraticCurveTo(20.8, 17.6, 20.8, 16.2);
      ctx.lineTo(20.8, 8.6);
      ctx.lineTo(18.2, 6.0);
      ctx.stroke();
    },
    abs(ctx) {
      ring(ctx, 7.0);
      parens(ctx, 10.2);
      ctx.save();
      ctx.font = '700 6.4px "Barlow", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('ABS', 12, 12.4);
      ctx.restore();
    },
    esp(ctx) {
      ctx.beginPath();
      ctx.moveTo(4.8, 13.0);
      ctx.lineTo(6.8, 7.8);
      ctx.quadraticCurveTo(7.2, 6.8, 8.3, 6.8);
      ctx.lineTo(15.7, 6.8);
      ctx.quadraticCurveTo(16.8, 6.8, 17.2, 7.8);
      ctx.lineTo(19.2, 13.0);
      ctx.lineTo(19.2, 15.4);
      ctx.lineTo(4.8, 15.4);
      ctx.closePath();
      ctx.stroke();
      ctx.fillRect(5.6, 15.4, 2.6, 2.0);
      ctx.fillRect(15.8, 15.4, 2.6, 2.0);
      for (const s of [1, -1]) {
        const x = 12 - s * 4.6;
        ctx.beginPath();
        ctx.moveTo(x, 18.6);
        ctx.bezierCurveTo(x + s * 2.6, 19.6, x - s * 1.6, 21.2, x + s * 0.8, 23.0);
        ctx.stroke();
      }
    },
    washer(ctx) {
      ctx.beginPath();
      ctx.moveTo(3.4, 14.6);
      ctx.quadraticCurveTo(12, 10.8, 20.6, 14.6);
      ctx.lineTo(19.0, 20.4);
      ctx.quadraticCurveTo(12, 18.0, 5.0, 20.4);
      ctx.closePath();
      ctx.stroke();
      ctx.save();
      ctx.setLineDash([1.6, 1.4]);
      line(ctx, [12, 10.4, 12, 3.0]);
      line(ctx, [11.2, 10.4, 7.0, 4.0]);
      line(ctx, [12.8, 10.4, 17.0, 4.0]);
      ctx.restore();
    },
    master(ctx) {
      ctx.beginPath();
      ctx.moveTo(12, 3.0);
      ctx.lineTo(21.6, 20.0);
      ctx.lineTo(2.4, 20.0);
      ctx.closePath();
      ctx.stroke();
      bang(ctx, 8.8, 14.4, 17.2);
    },
    steer(ctx) {
      ring(ctx, 8.4);
      dot(ctx, 12, 12.6, 2.2);
      line(ctx, [3.8, 11.0, 9.8, 12.2]);
      line(ctx, [20.2, 11.0, 14.2, 12.2]);
      line(ctx, [12, 14.8, 12, 20.2]);
    },
    hold(ctx) {
      ring(ctx, 8.6);
      ctx.save();
      ctx.font = '700 9px "Barlow", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('A', 12, 12.6);
      ctx.restore();
    },
  };

  /** Draw icon `id` centred at (x, y), `size` px wide, in `color`, with optional glow. */
  function drawIcon(ctx, id, x, y, size, color, glow) {
    const fn = ICONS[id];
    if (!fn) return;
    const k = size / 24;
    ctx.save();
    ctx.translate(x - 12 * k, y - 12 * k);
    ctx.scale(k, k);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.75;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (glow) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = 7 * k * 2;
    }
    fn(ctx);
    ctx.restore();
  }

  window.SimIcons = { drawIcon };
})();
