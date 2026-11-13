// Hold-to-snap shapes and scribble-to-erase.
import { SET } from '../core/config.js';
import { clamp } from '../core/util.js';
import { live } from '../editor/editor.js';
import { drawStroke } from '../editor/render.js';
import { distPtSeg } from '../input/eraser.js';
import { strokeBB } from '../input/ink.js';
import { D, toPage } from '../input/pointer.js';
import { pointInPoly } from '../selection/selection.js';

/* shape snap: draw a line, rectangle or ellipse, keep the pen still at the end, and it straightens */
export const HOLD_MS = 500, HOLD_SLOP = 6;           // ms still, screen px of allowed wobble
export function armHold(e) { disarmHold(); if (!SET.shapes) return; D.hx = e.clientX; D.hy = e.clientY; D.holdT = setTimeout(onHold, HOLD_MS); }
export function disarmHold() { if (D.holdT) { clearTimeout(D.holdT); D.holdT = 0; } }
export function holdMove(e) { if (SET.shapes && Math.hypot(e.clientX - D.hx, e.clientY - D.hy) > HOLD_SLOP) armHold(e); }
export function onHold() {
  D.holdT = 0;
  if (!D.active || D.mode !== 'ink' || D.shape || !SET.shapes) return;
  const sh = recognizeShape(D.st.p); if (!sh) return;
  D.shape = sh; D.st.p = sh.p; redrawLiveInk();
}
export function redrawLiveInk() {
  if (D.raf) { cancelAnimationFrame(D.raf); D.raf = 0; }
  const ctx = D.lctx; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, live.width, live.height); ctx.restore();
  drawStroke(ctx, D.st);
}
export function moveSnappedLine(ev) {
  const { x, y } = toPage(ev), sh = D.shape;
  const end = snapAngle(sh.ax, sh.ay, x, y);
  sh.p = shapeLine(sh.ax, sh.ay, end[0], end[1], sh.pr); D.st.p = sh.p; redrawLiveInk();
}
export function snapAngle(ax, ay, bx, by) {  // within 3° of horizontal / vertical -> exactly level
  const dx = bx - ax, dy = by - ay, t = Math.tan(3 * Math.PI / 180);
  if (Math.abs(dy) <= Math.abs(dx) * t) return [bx, ay];
  if (Math.abs(dx) <= Math.abs(dy) * t) return [ax, by];
  return [bx, by];
}
export function shapeLine(ax, ay, bx, by, pr) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4)), out = [];
  for (let i = 0; i <= n; i++) out.push(ax + (bx - ax) * i / n, ay + (by - ay) * i / n, pr);
  return out;
}
export function shapeRect(x0, y0, x1, y1, pr) {
  const C = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], out = [];
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = C[k], [bx, by] = C[k + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
    out.push(ax, ay, pr);                     // corner twice -> crisp corner
    for (let i = 0; i < n; i++) out.push(ax + (bx - ax) * i / n, ay + (by - ay) * i / n, pr);
  }
  out.push(x0, y0, pr, x0, y0, pr);
  return out;
}
export function shapeEllipse(cx, cy, rx, ry, a0, pr) {
  const per = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const n = clamp(Math.round(per / 4), 24, 360), out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + i / n * Math.PI * 2; out.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a), pr); }
  return out;
}
// Returns {kind:'line'|'rect'|'ellipse', p:[x,y,pr,...], ...} or null when the stroke isn't a clear shape.
export function recognizeShape(P) {
  const n = P.length / 3; if (n < 3) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, len = 0, psum = 0;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1]; psum += P[i * 3 + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (i) len += Math.hypot(x - P[i * 3 - 3], y - P[i * 3 - 2]);
  }
  const w = x1 - x0, h = y1 - y0, size = Math.max(w, h), pr = Math.round(psum / n * 1000) / 1000;
  if (len < 24 || size < 16) return null;
  const ax = P[0], ay = P[1], bx = P[(n - 1) * 3], by = P[(n - 1) * 3 + 1], chord = Math.hypot(bx - ax, by - ay);
  // straight line: every point close to the start→end chord
  if (chord >= 20 && len < chord * 2) {
    let dev = 0;
    for (let i = 0; i < n; i++) dev = Math.max(dev, distPtSeg(P[i * 3], P[i * 3 + 1], ax, ay, bx, by));
    if (dev <= Math.max(5, chord * 0.07)) { const e = snapAngle(ax, ay, bx, by); return { kind: 'line', ax, ay, pr, p: shapeLine(ax, ay, e[0], e[1], pr) }; }
    return null;
  }
  // closed shapes: ends meet, the shape has real width and height, and it goes all the way round
  let close = chord;                                              // overshooting the start still counts as closed
  for (let i = Math.floor(n * 0.6); i < n; i++) close = Math.min(close, Math.hypot(P[i * 3] - ax, P[i * 3 + 1] - ay));
  if (close > size * 0.25 || Math.min(w, h) < 12 || Math.min(w, h) < size * 0.12 || len < size * 2) return null;
  // try every tilt (shapes repeat every 90°) and keep the best rectangle and the best ellipse
  const deg = Math.PI / 180; let bestR = null, bestE = null;
  for (let a = -45; a < 45; a++) {
    const f = fitClosed(P, n, a * deg);
    if (!bestR || f.eR < bestR.eR) bestR = f;
    if (!bestE || f.eE < bestE.eE) bestE = f;
  }
  let kind = bestR.eR < bestE.eE ? 'rect' : 'ellipse', f = kind === 'rect' ? bestR : bestE;
  if (Math.abs(f.th) <= 5 * deg || (kind === 'ellipse' && Math.abs(f.w - f.h) <= Math.max(f.w, f.h) * 0.12)) f = fitClosed(P, n, 0);   // nearly level -> level
  const err = kind === 'rect' ? f.eR : f.eE;
  if (f.oct !== 255 || err > Math.min(f.w, f.h) * 0.075 + 1.5) return null;
  let W = f.w, H = f.h;
  if (Math.abs(W - H) <= Math.max(W, H) * 0.12) W = H = (W + H) / 2;   // nearly square / round -> exactly
  const loc = kind === 'rect' ? shapeRect(-W / 2, -H / 2, W / 2, H / 2, pr) : shapeEllipse(0, 0, W / 2, H / 2, f.a0, pr);
  const c = Math.cos(f.th), sn = Math.sin(f.th);
  for (let i = 0; i < loc.length; i += 3) { const x = loc[i], y = loc[i + 1]; loc[i] = f.cx + x * c - y * sn; loc[i + 1] = f.cy + x * sn + y * c; }
  return { kind, pr, p: loc };
}
// Fit a box/ellipse to the points in a frame tilted by th; mean distance of the points from each outline.
export function fitClosed(P, n, th) {
  const c = Math.cos(th), sn = Math.sin(th), X = new Float64Array(n), Y = new Float64Array(n);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], u = x * c + y * sn, v = -x * sn + y * c; X[i] = u; Y[i] = v;
    if (u < x0) x0 = u; if (u > x1) x1 = u; if (v < y0) y0 = v; if (v > y1) y1 = v;
  }
  const lx = (x0 + x1) / 2, ly = (y0 + y1) / 2, rx = Math.max(1, (x1 - x0) / 2), ry = Math.max(1, (y1 - y0) / 2);
  let oct = 0, eE = 0, eR = 0;
  for (let i = 0; i < n; i++) {
    const dx = X[i] - lx, dy = Y[i] - ly, d = Math.hypot(dx, dy), r = Math.hypot(dx / rx, dy / ry);
    oct |= 1 << (Math.floor((Math.atan2(dy / ry, dx / rx) + Math.PI) / (Math.PI / 4)) & 7);
    eE += r ? Math.abs(1 - 1 / r) * d : Math.min(rx, ry);
    eR += Math.min(dx + rx, rx - dx, dy + ry, ry - dy);
  }
  return { th, eE: eE / n, eR: eR / n, oct, w: rx * 2, h: ry * 2, cx: lx * c - ly * sn, cy: lx * sn + ly * c, a0: Math.atan2((Y[0] - ly) / ry, (X[0] - lx) / rx) };
}

/* scribble to erase: a pen stroke that zig-zags back and forth (5+ turns) over ink erases the strokes it covers */
export function isScribble(P) {
  const n = P.length / 3; if (n < 16) return false;
  let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += P[i * 3]; my += P[i * 3 + 1]; } mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0, len = 0;
  for (let i = 0; i < n; i++) {
    const dx = P[i * 3] - mx, dy = P[i * 3 + 1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    if (i) len += Math.hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 1] - P[i * 3 - 2]);
  }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  for (const [c, sn] of [[Math.cos(th), Math.sin(th)], [-Math.sin(th), Math.cos(th)]]) {   // along the main axis, then across it
    const a = new Float64Array(n); let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { a[i] = P[i * 3] * c + P[i * 3 + 1] * sn; if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; }
    const range = hi - lo; if (range < 10 || len < range * 5) continue;
    const h = Math.max(4, range * 0.35); let dir = 0, ext = a[0], turns = 0;
    for (let i = 1; i < n; i++) {
      const q = a[i];
      if (dir === 0) { if (Math.abs(q - ext) > h) { dir = q > ext ? 1 : -1; ext = q; } }
      else if ((q - ext) * dir > 0) ext = q;
      else if (Math.abs(q - ext) > h) { turns++; dir = -dir; ext = q; }
    }
    if (turns >= 5) return true;
  }
  return false;
}
export function convexHull(P) {   // flat [x,y,...] polygon
  const pts = []; for (let i = 0; i < P.length; i += 3) pts.push([P[i], P[i + 1]]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of pts) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1)).flat();
}
export function scribbleTargets(p, P) {   // ids of strokes with at least half their points inside the scribble's outline
  const H = convexHull(P), out = new Set(); if (H.length < 6) return out;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < H.length; i += 2) { x0 = Math.min(x0, H[i]); x1 = Math.max(x1, H[i]); y0 = Math.min(y0, H[i + 1]); y1 = Math.max(y1, H[i + 1]); }
  for (const st of p.strokes) {
    const b = st.bb || (st.bb = strokeBB(st));
    if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) continue;
    const n = st.p.length / 3, step = Math.max(1, Math.floor(n / 40)); let inn = 0, tot = 0;
    for (let i = 0; i < n; i += step) { tot++; if (pointInPoly(st.p[i * 3], st.p[i * 3 + 1], H)) inn++; }
    if (tot && inn / tot >= 0.5) out.add(st.id);
  }
  // the covered ink must fill a fair part of the scribble, so writing zig-zaggy letters near a stray dot doesn't erase it
  let u = [Infinity, Infinity, -Infinity, -Infinity];
  for (const st of p.strokes) if (out.has(st.id)) { const q = st.bb; u = [Math.min(u[0], q[0]), Math.min(u[1], q[1]), Math.max(u[2], q[2]), Math.max(u[3], q[3])]; }
  if (out.size && (Math.min(u[2], x1) - Math.max(u[0], x0)) * (Math.min(u[3], y1) - Math.max(u[1], y0)) < (x1 - x0) * (y1 - y0) * 0.2) out.clear();
  return out;
}
