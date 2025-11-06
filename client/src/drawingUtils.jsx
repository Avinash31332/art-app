// client/src/drawingUtils.js

/* --- Catmull-Rom -> Bezier (no change) --- */
function catmullRom2bezier(points, tension = 0.5) {
  const beziers = [];
  if (!points || points.length < 2) return beziers;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const t = tension;
    const cp1x = p1.x + ((p2.x - p0.x) * t) / 6;
    const cp1y = p1.y + ((p2.y - p0.y) * t) / 6;
    const cp2x = p2.x - ((p3.x - p1.x) * t) / 6;
    const cp2y = p2.y - ((p3.y - p1.y) * t) / 6;
    beziers.push({ cp1x, cp1y, cp2x, cp2y, x: p2.x, y: p2.y });
  }
  return beziers;
}

// --- FULL PATH DRAWING (for redrawAll) ---

function _drawPen(ctx, stroke) {
  // ... (this function is unchanged) ...
  const { points, color, size, stability, opacity } = stroke;
  if (!ctx || !points || points.length === 0) return;
  ctx.globalAlpha = opacity;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = size;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  if (points.length === 1) {
    const p = points[0];
    ctx.beginPath();
    ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.closePath();
    return;
  }
  const t = Math.max(0, Math.min((stability || 0) / 10, 1)) * 0.9;
  const beziers = catmullRom2bezier(points, t);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < beziers.length; i++) {
    const b = beziers[i];
    ctx.bezierCurveTo(b.cp1x, b.cp1y, b.cp2x, b.cp2y, b.x, b.y);
  }
  ctx.stroke();
  ctx.closePath();
}

function _drawHighlighter(ctx, stroke) {
  // ... (this function is unchanged) ...
  const { points, color, size, stability, opacity } = stroke;
  if (!ctx || !points || points.length === 0) return;
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = (opacity ?? 1) * 0.5;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.lineWidth = size;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  if (points.length === 1) {
    const p = points[0];
    ctx.beginPath();
    ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    ctx.closePath();
    return;
  }
  const t = Math.max(0, Math.min((stability || 0) / 10, 1)) * 0.9;
  const beziers = catmullRom2bezier(points, t);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < beziers.length; i++) {
    const b = beziers[i];
    ctx.bezierCurveTo(b.cp1x, b.cp1y, b.cp2x, b.cp2y, b.x, b.y);
  }
  ctx.stroke();
  ctx.closePath();
}

const airbrushCache = { tip: null, size: -1, color: "" };
function _getAirbrushTip(size, color) {
  // ... (this function is unchanged) ...
  if (
    airbrushCache.tip &&
    airbrushCache.size === size &&
    airbrushCache.color === color
  ) {
    return airbrushCache.tip;
  }
  const tip = document.createElement("canvas");
  const tipCtx = tip.getContext("2d");
  const halfSize = size / 2;
  tip.width = size;
  tip.height = size;
  const gradient = tipCtx.createRadialGradient(
    halfSize,
    halfSize,
    0,
    halfSize,
    halfSize,
    halfSize
  );
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, `${color}00`);
  tipCtx.fillStyle = gradient;
  tipCtx.fillRect(0, 0, size, size);
  airbrushCache.tip = tip;
  airbrushCache.size = size;
  airbrushCache.color = color;
  return tip;
}

function _drawAirbrush(ctx, stroke) {
  // ... (this function is unchanged) ...
  const { points, color, size, opacity } = stroke;
  if (!ctx || !points || points.length === 0 || size < 1) return;
  const tip = _getAirbrushTip(size, color);
  const halfSize = size / 2;
  ctx.globalAlpha = (opacity ?? 1) * 0.1;
  ctx.globalCompositeOperation = "source-over";
  const _dist = (p1, p2) =>
    Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  const _lerp = (a, b, t) => a + (b - a) * t;
  const _stamp = (p) => {
    ctx.drawImage(tip, p.x - halfSize, p.y - halfSize);
  };
  const spacing = 2;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];
    if (!p1) {
      _stamp(p2);
      continue;
    }
    const distance = _dist(p1, p2);
    const steps = Math.max(1, distance / spacing);
    for (let j = 1; j <= steps; j++) {
      const t = j / steps;
      const x = _lerp(p1.x, p2.x, t);
      const y = _lerp(p1.y, p2.y, t);
      _stamp({ x, y });
    }
  }
}

export function drawStroke(ctx, stroke) {
  // ... (this function is unchanged) ...
  if (!stroke) return;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  switch (stroke.brush) {
    case "highlighter":
      _drawHighlighter(ctx, stroke);
      break;
    case "airbrush":
      _drawAirbrush(ctx, stroke);
      break;
    case "pen":
    default:
      _drawPen(ctx, stroke);
      break;
  }
  ctx.restore();
}

// --- INCREMENTAL/LIVE DRAWING (FOR OUR OWN STROKE) ---

/**
 * --- (NEW) Live Pen/Highlighter Segment ---
 * Draws only the *last segment* of a stroke for high performance.
 */
function _drawLivePathSegment(ctx, stroke) {
  const { points, color, size, stability, opacity, brush } = stroke;
  const len = points.length;
  if (len === 0) return;

  ctx.save();

  // Set brush properties
  ctx.globalAlpha = opacity;
  ctx.lineWidth = size;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  if (brush === "highlighter") {
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = (opacity ?? 1) * 0.5;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
  } else {
    // Pen
    ctx.globalCompositeOperation = "source-over";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  // --- Draw the segment ---

  if (len === 1) {
    // Just draw a single dot/square
    const p = points[0];
    ctx.beginPath();
    if (brush === "highlighter") {
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    } else {
      ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.closePath();
    ctx.restore();
    return;
  }

  // Get the last 4 points to calculate the new Bezier segment
  // p1 and p2 are the segment we want to draw (from p1 to p2)
  const p0 = points[len - 4] || points[len - 3] || points[len - 2];
  const p1 = points[len - 3] || points[len - 2];
  const p2 = points[len - 2];
  const p3 = points[len - 1];

  const t = Math.max(0, Math.min((stability || 0) / 10, 1)) * 0.9;

  // Calculate the control points for *only* the segment p1 -> p2
  const cp1x = p1.x + ((p2.x - p0.x) * t) / 6;
  const cp1y = p1.y + ((p2.y - p0.y) * t) / 6;
  const cp2x = p2.x - ((p3.x - p1.x) * t) / 6;
  const cp2y = p2.y - ((p3.y - p1.y) * t) / 6;

  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  ctx.stroke();
  ctx.closePath();

  ctx.restore();
}

/**
 * --- (NEW) Live Airbrush Segment ---
 * Stamps only at the *newest point* for high performance.
 */
function _drawLiveAirbrushSegment(ctx, stroke) {
  const { points, color, size, opacity } = stroke;
  const len = points.length;
  if (len === 0 || size < 1) return;

  const tip = _getAirbrushTip(size, color);
  const halfSize = size / 2;

  ctx.save();
  ctx.globalAlpha = (opacity ?? 1) * 0.1;
  ctx.globalCompositeOperation = "source-over";

  const _dist = (p1, p2) =>
    Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  const _lerp = (a, b, t) => a + (b - a) * t;
  const _stamp = (p) => {
    ctx.drawImage(tip, p.x - halfSize, p.y - halfSize);
  };

  const spacing = 2;
  const p1 = points[len - 2];
  const p2 = points[len - 1]; // The new point

  if (!p1) {
    // First point
    _stamp(p2);
    ctx.restore();
    return;
  }

  // Interpolate between p1 and p2
  const distance = _dist(p1, p2);
  const steps = Math.max(1, distance / spacing);

  for (let j = 1; j <= steps; j++) {
    const t = j / steps;
    const x = _lerp(p1.x, p2.x, t);
    const y = _lerp(p1.y, p2.y, t);
    _stamp({ x, y });
  }

  ctx.restore();
}

/**
 * --- (NEW) MASTER LIVE DRAW FUNCTION ---
 * This is called by continueDrawing for our *own* stroke.
 * It clears nothing and only draws the new segment.
 */
export function drawLiveSegment(ctx, stroke) {
  if (!ctx || !stroke) return;

  // Note: Eraser is handled by redrawTopCanvas,
  // so this function only worries about brushes.

  switch (stroke.brush) {
    case "highlighter":
    case "pen":
      _drawLivePathSegment(ctx, stroke);
      break;
    case "airbrush":
      _drawLiveAirbrushSegment(ctx, stroke);
      break;
    default:
      _drawLivePathSegment(ctx, stroke); // Default to pen
      break;
  }
}
