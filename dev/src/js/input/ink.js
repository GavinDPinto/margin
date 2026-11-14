// Pen and highlighter strokes: capture, smoothing, live drawing, commit.
import { SET } from '../core/config.js';
import { uid } from '../core/util.js';
import { E, live, pushUndo, renderPage, snap } from '../editor/editor.js';
import { drawSegs, drawStroke, drawTail, segW } from '../editor/render.js';
import { D, attachLive, clearLive, pressureOf, toPage } from '../input/pointer.js';
import { armHold, isScribble, scribbleTargets } from '../input/shapes.js';
import { L } from '../library/library.js';
import { toast } from '../ui/dialogs.js';

/* ink */
export function beginInk(e, x, y) {
  const cfg = E.tool === 'hl' ? SET.hl : SET.pen;
  D.mode = 'ink'; D.before = snap(D.v.page);
  const pr = pressureOf(e); D.ps = pr;
  D.st = { id: uid(), t: E.tool === 'hl' ? 'hl' : (cfg.kind === 'ball' ? 'ball' : 'pen'), c: cfg.color, s: cfg.size, p: [x, y, pr] };
  D.segDone = 0; D.shape = null;
  D.lctx = attachLive(D.v);
  if (D.st.t === 'hl') live.style.mixBlendMode = 'multiply';
  drawLiveInk();
  armHold(e);
}
export function addInkPoint(ev, final) {
  const { x: rx, y: ry } = toPage(ev);
  const P = D.st.p, L = P.length - 3, lx = P[L], ly = P[L + 1];
  const raw = ev.pointerType === 'pen' ? ev.pressure : 0.5;
  const pr = raw > 0 ? raw : D.ps;
  D.ps += (pr - D.ps) * 0.3;
  const d = Math.hypot(rx - lx, ry - ly);
  if (d < (final ? 0.2 : 0.45)) return;
  const k = final ? 1 : (D.st.t === 'hl' ? 0.5 : 0.62);
  P.push(lx + (rx - lx) * k, ly + (ry - ly) * k, D.ps);
}
export function drawLiveInk() {
  const st = D.st, P = st.p, n = P.length / 3, ctx = D.lctx;
  if (st.t === 'hl') {
    if (D.raf) return;
    D.raf = requestAnimationFrame(() => { D.raf = 0; if (!D.active || D.mode !== 'ink') return; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, live.width, live.height); ctx.restore(); drawStroke(ctx, st); });
    return;
  }
  ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = st.c; ctx.fillStyle = st.c;
  if (n === 1) { ctx.beginPath(); ctx.arc(P[0], P[1], segW(st, P, 0) / 2, 0, 6.2832); ctx.fill(); }
  else { if (n - 2 >= D.segDone + 1) { drawSegs(ctx, st, P, D.segDone + 1, n - 2, 0, 0); D.segDone = n - 2; } drawTail(ctx, st, P, n, 0, 0); }
  ctx.restore();
}
export function strokeBB(st) {
  const P = st.p; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) { if (P[i] < x0) x0 = P[i]; if (P[i] > x1) x1 = P[i]; if (P[i + 1] < y0) y0 = P[i + 1]; if (P[i + 1] > y1) y1 = P[i + 1]; }
  const pad = (st.t === 'pen' ? st.s * 1.6 : st.s) / 2 + 1;
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}
export function roundPts(P) { for (let i = 0; i < P.length; i += 3) { P[i] = Math.round(P[i] * 100) / 100; P[i + 1] = Math.round(P[i + 1] * 100) / 100; P[i + 2] = Math.round(P[i + 2] * 1000) / 1000; } return P; }
export function commitInk() {
  const st = D.st, v = D.v, p = v.page;
  roundPts(st.p); st.bb = strokeBB(st);
  if (st.t !== 'hl' && SET.scribble && !D.shape && isScribble(st.p)) {   // scribble over ink -> erase what's under it
    const hit = scribbleTargets(p, st.p);
    if (hit.size) {
      // two undo steps: first Undo brings back the ink with the scribble still drawn over it, the next removes the scribble
      p.strokes = p.strokes.concat(st);
      const drawn = snap(p);
      pushUndo({ k: 'page', id: p.id, before: D.before, after: drawn });
      p.strokes = p.strokes.filter(x => !hit.has(x.id) && x.id !== st.id);
      pushUndo({ k: 'page', id: p.id, before: drawn, after: snap(p) });
      clearLive(); renderPage(v); toast('Scribbled out — tap Undo to bring it back', 1800);
      return;
    }
  }
  p.strokes = p.strokes.concat(st);
  pushUndo({ k: 'page', id: p.id, before: D.before, after: snap(p) });
  clearLive();
  if (st.t === 'hl') renderPage(v);
  else if (v.canvas) { const ctx = v.canvas.getContext('2d'); ctx.setTransform(v.k, 0, 0, v.k, 0, 0); drawStroke(ctx, st); }
}
