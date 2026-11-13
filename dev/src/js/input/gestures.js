// Touch pan/pinch with momentum, palm rejection, ending strokes, editor event wiring.
import { SET } from '../core/config.js';
import { E, anchorAt, sc, scheduleRerender, zoomAround } from '../editor/editor.js';
import { commitActiveText, createTextBox } from '../editor/text.js';
import { D, G, cancelDraw, startDraw } from '../input/pointer.js';
import { hidePasteBar } from '../selection/clipboard.js';
import { clearSelection, inBB, lassoTap } from '../selection/selection.js';

/* touch gestures: pan with momentum, pinch zoom, palm rejection */
export function activeTouches() { return [...G.touches.entries()].filter(([, t]) => !t.ign && !t.drawing); }
export function onTouchDown(e) {
  stopMomentum();
  const tt = { x: e.clientX, y: e.clientY, ign: false, drawing: false, t0: performance.now() };
  G.touches.set(e.pointerId, tt);
  if (D.active && D.type === 'pen') { tt.ign = true; return; }
  if (D.active && D.type === 'touch') {
    if (performance.now() - D.t0 < 350 && D.mode !== 'move') { cancelDraw(); const f = G.touches.get(D.pidPrev); if (f) f.drawing = false; startGesture(); }
    else tt.ign = true;
    return;
  }
  if (D.active) { tt.ign = true; return; }
  if (E.tool === 'lasso' && E.sel && !E.crop && activeTouches().length === 1) {
    const r = E.sel.v.el.getBoundingClientRect();
    if (inBB((e.clientX - r.left) / E.s, (e.clientY - r.top) / E.s, E.sel.bb, 14 / E.s) && startDraw(e)) { tt.drawing = true; D.pidPrev = e.pointerId; return; }
  }
  if (SET.fingerDraw && !E.penSeen && activeTouches().length === 1 && E.tool !== 'text') {
    if (startDraw(e)) { tt.drawing = true; D.pidPrev = e.pointerId; return; }
  }
  startGesture();
}
export function startGesture() {
  const act = activeTouches(); const s = sc();
  if (act.length === 1) {
    const [, t] = act[0];
    G.mode = 'pan'; G.start = { l: s.scrollLeft, t: s.scrollTop }; G.samples = [{ t: performance.now(), x: t.x, y: t.y }];
    G.tap = { x: t.x, y: t.y, t: performance.now(), moved: false };
  } else if (act.length >= 2) {
    const [a, b] = [act[0][1], act[1][1]];
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    G.mode = 'pinch'; G.tap = null; G.didPinch = true;
    G.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: E.s, anchor: anchorAt(cx, cy), ids: [act[0][0], act[1][0]] };
  } else G.mode = null;
}
export function onTouchMove(e) {
  const t = G.touches.get(e.pointerId); if (!t) return;
  const px = t.x, py = t.y; t.x = e.clientX; t.y = e.clientY;
  if (t.ign || t.drawing) return;
  e.preventDefault();
  const s = sc();
  if (G.mode === 'pan') {
    s.scrollLeft -= t.x - px; s.scrollTop -= t.y - py;
    const nowT = performance.now(); G.samples.push({ t: nowT, x: t.x, y: t.y }); while (G.samples.length > 2 && nowT - G.samples[0].t > 100) G.samples.shift();
    if (G.tap && Math.hypot(t.x - G.tap.x, t.y - G.tap.y) > 9) G.tap.moved = true;
  } else if (G.mode === 'pinch') {
    const a = G.touches.get(G.pinch.ids[0]), b = G.touches.get(G.pinch.ids[1]); if (!a || !b) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    zoomAround(G.pinch.s0 * d / G.pinch.d0, cx, cy, G.pinch.anchor);
  }
}
export function onTouchUp(e, cancelled) {
  const t = G.touches.get(e.pointerId); G.touches.delete(e.pointerId);
  if (!t || t.ign) { if (!G.touches.size) G.didPinch = false; return; }
  if (G.mode === 'pan') {
    if (!cancelled && G.tap && !G.tap.moved && performance.now() - G.tap.t < 400) handleTap(e);
    else if (!cancelled) startMomentum();
    G.mode = null;
  } else if (G.mode === 'pinch') {
    scheduleRerender();
    const rest = activeTouches();
    if (rest.length === 1) { startGesture(); G.tap = null; } else if (rest.length >= 2) startGesture(); else G.mode = null;
  }
  if (!G.touches.size) G.didPinch = false;
}
export function handleTap(e) {
  const pageEl = document.elementFromPoint(e.clientX, e.clientY);
  const pg = pageEl && pageEl.closest && pageEl.closest('.page');
  if (E.tool === 'lasso') {
    if (E.crop) return;
    if (!pg) { clearSelection(); hidePasteBar(); return; }
    const v = E.views.get(pg.dataset.id), r = pg.getBoundingClientRect(), x = (e.clientX - r.left) / E.s, y = (e.clientY - r.top) / E.s;
    if (E.sel && E.sel.v === v && inBB(x, y, E.sel.bb, 14 / E.s)) return;
    clearSelection(); hidePasteBar(); if (v) lassoTap(v, x, y);
    return;
  }
  if (E.tool === 'text') {
    if (E.activeText) { commitActiveText(); return; }
    if (!pg) return;
    const v = E.views.get(pg.dataset.id); if (!v) return;
    const r = pg.getBoundingClientRect();
    createTextBox(v, (e.clientX - r.left) / E.s, (e.clientY - r.top) / E.s);
  }
}
export function startMomentum() {
  const S = G.samples; if (S.length < 2) return;
  const a = S[0], b = S[S.length - 1], dt = b.t - a.t; if (dt <= 0 || performance.now() - b.t > 60) return;
  let vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
  if (Math.hypot(vx, vy) < 0.15) return;
  let last = performance.now();
  const s = sc();
  const step = tm => {
    const d = Math.min(40, tm - last); last = tm;
    s.scrollLeft -= vx * d; s.scrollTop -= vy * d;
    const f = Math.pow(0.9955, d); vx *= f; vy *= f;
    if (Math.hypot(vx, vy) > 0.02) G.mom = requestAnimationFrame(step); else G.mom = 0;
  };
  G.mom = requestAnimationFrame(step);
}
export function stopMomentum() { if (G.mom) { cancelAnimationFrame(G.mom); G.mom = 0; } }
