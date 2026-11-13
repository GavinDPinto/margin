// Pointer routing (Pencil / finger / mouse), live canvas, ink strokes.
import { SET, saveSettings } from '../core/config.js';
import { now } from '../core/util.js';
import { E, live, pushUndo, renderPage, restoreSnap, sc, snap } from '../editor/editor.js';
import { commitActiveText, createTextBox } from '../editor/text.js';
import { beginErase, eraseSeg, queueEraseFrame } from '../input/eraser.js';
import { onTouchDown, onTouchMove, onTouchUp, stopMomentum } from '../input/gestures.js';
import { addInkPoint, beginInk, commitInk, drawLiveInk } from '../input/ink.js';
import { disarmHold, holdMove, moveSnapped } from '../input/shapes.js';
import { drawCrop, moveCrop, positionCropUI } from '../selection/images.js';
import { beginLasso, clearSelection, drawSelection, finishLasso, finishMove, moveResize, queueLassoFrame, queueMoveFrame, showSelBar, startHandleDrag } from '../selection/selection.js';
import { toast } from '../ui/dialogs.js';

/* =====================================================================
   INPUT: drawing, erasing, lasso, text — plus touch scroll/zoom
   ===================================================================== */
export const D = { active: false, pid: null, type: null, v: null, rect: null, mode: null, st: null, segDone: 0, ps: 0.5, t0: 0, before: null, raf: 0, lctx: null, moved: 0, shape: null, holdT: 0 };
export const G = { touches: new Map(), mode: null, start: null, samples: [], tap: null, pinch: null, mom: 0 };

export function attachLive(v) {
  if (live.parentNode !== v.el) v.el.insertBefore(live, v.textLayer);
  const k = v.k, W = Math.round(v.page.w * k), H = Math.round(v.page.h * k);
  if (live.width !== W || live.height !== H) { live.width = W; live.height = H; }
  live.style.width = v.page.w * E.s + 'px'; live.style.height = v.page.h * E.s + 'px';
  const ctx = live.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.setTransform(k, 0, 0, k, 0, 0);
  live.style.mixBlendMode = '';
  return ctx;
}
export function clearLive() { if (!live.width) return; const ctx = live.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, live.width, live.height); live.style.mixBlendMode = ''; }
export const toPage = e => ({ x: (e.clientX - D.rect.left) / E.s, y: (e.clientY - D.rect.top) / E.s });
export const pressureOf = e => (e.pointerType === 'pen' && e.pressure > 0) ? e.pressure : 0.5;

export function onPointerDown(e) {
  if (!E.open) return;
  const h = e.target.closest('.sel-handle, .crop-handle');
  if (h) { if (e.pointerType === 'pen') penDetected(); startHandleDrag(e, h); return; }
  if (e.target.closest('.tbox, .sel-bar')) return;
  if (e.pointerType === 'touch') { onTouchDown(e); return; }
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (e.pointerType === 'pen') penDetected();
  if (D.active) return;
  if (e.pointerType === 'pen') palmReject();
  stopMomentum();
  startDraw(e);
}
export function penDetected() {
  if (E.penSeen) return; E.penSeen = true;
  if (SET.fingerDraw) { SET.fingerDraw = false; saveSettings(); toast('Apple Pencil detected — fingers now scroll and zoom'); }
}
export function palmReject() {
  if (G.mode === 'pan' && G.start) { const s = sc(); s.scrollLeft = G.start.l; s.scrollTop = G.start.t; }
  for (const t of G.touches.values()) t.ign = true;
  G.mode = null; G.tap = null; stopMomentum();
}
export function startDraw(e) {
  const pageEl = e.target.closest ? e.target.closest('.page') : null;
  if (!pageEl) { if (E.tool === 'lasso') clearSelection(); if (E.tool === 'text') commitActiveText(); return false; }
  const v = E.views.get(pageEl.dataset.id); if (!v || !v.canvas) return false;
  e.preventDefault();
  Object.assign(D, { active: true, pid: e.pointerId, type: e.pointerType, v, rect: pageEl.getBoundingClientRect(), t0: performance.now(), moved: 0, sx0: e.clientX, sy0: e.clientY });
  try { sc().setPointerCapture(e.pointerId); } catch (err) {}
  const { x, y } = toPage(e);
  switch (E.tool) {
    case 'pen': case 'hl': beginInk(e, x, y); break;
    case 'eraser': beginErase(x, y); break;
    case 'lasso': beginLasso(x, y); break;
    case 'text': D.mode = 'text'; D.tx = x; D.ty = y; break;
  }
  return true;
}
export function onPointerMove(e) {
  if (e.pointerType === 'touch' && G.touches.has(e.pointerId) && !(D.active && D.pid === e.pointerId)) { onTouchMove(e); return; }
  if (!D.active || e.pointerId !== D.pid) return;
  e.preventDefault();
  D.moved = Math.max(D.moved, Math.hypot(e.clientX - D.sx0, e.clientY - D.sy0));
  const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
  const list = evs.length ? evs : [e];
  if (D.mode === 'ink') {
    if (D.shape) moveSnapped(list[list.length - 1]);
    else { for (const ev of list) addInkPoint(ev); drawLiveInk(); holdMove(e); }
  }
  else if (D.mode === 'erase') { for (const ev of list) { const { x, y } = toPage(ev); eraseSeg(D.ex, D.ey, x, y); D.ex = x; D.ey = y; } queueEraseFrame(); }
  else if (D.mode === 'lasso') {
    const { x, y } = toPage(e);
    if (D.lrect) { const x0 = D.lx0, y0 = D.ly0; D.lp = [x0, y0, x, y0, x, y, x0, y]; }   // rectangle lasso: drag diagonally, corner to corner
    else D.lp.push(x, y);
    queueLassoFrame();
  }
  else if (D.mode === 'move') { const { x, y } = toPage(e); E.sel.dx = x - D.mx; E.sel.dy = y - D.my; queueMoveFrame(); }
  else if (D.mode === 'resize') { const { x, y } = toPage(e); moveResize(x, y); }
  else if (D.mode === 'crop') { const { x, y } = toPage(e); moveCrop(x, y); }
}
export function onPointerUp(e) {
  if (e.pointerType === 'touch' && G.touches.has(e.pointerId) && !(D.active && D.pid === e.pointerId)) { onTouchUp(e, e.type === 'pointercancel'); return; }
  if (D.active && e.pointerId === D.pid) { endDraw(e, e.type === 'pointercancel'); if (e.pointerType === 'touch') G.touches.delete(e.pointerId); }
}

export function cancelDraw() {
  if (!D.active) return;
  if (D.mode === 'erase' && D.changed) { restoreSnap(D.v.page, D.before); renderPage(D.v); }
  if ((D.mode === 'move' || D.mode === 'resize') && E.sel) { E.sel.dx = E.sel.dy = 0; E.sel.k = 1; drawSelection(); showSelBar(); }
  else if (D.mode === 'crop') { drawCrop(); }
  else clearLive();
  if (D.raf) { cancelAnimationFrame(D.raf); D.raf = 0; }
  try { sc().releasePointerCapture(D.pid); } catch (e) {}
  D.active = false; D.mode = null; D.v = null;
}
export function endDraw(e, cancelled) {
  if (!D.active) return;
  if (D.raf) { cancelAnimationFrame(D.raf); D.raf = 0; }
  disarmHold();
  try { sc().releasePointerCapture(D.pid); } catch (err) {}
  const v = D.v;
  switch (D.mode) {
    case 'ink': disarmHold(); if (e && !cancelled && !D.shape) addInkPoint(e, true); commitInk(); D.shape = null; break;
    case 'erase': clearLive(); if (D.needRender) { D.needRender = false; renderPage(v); } if (D.changed) pushUndo({ k: 'page', id: v.page.id, before: D.before, after: snap(v.page) }); break;
    case 'lasso': finishLasso(); break;
    case 'move': case 'resize': finishMove(); break;
    case 'crop': drawCrop(); positionCropUI(); break;
    case 'text': if (!cancelled && D.moved < 10) { if (E.activeText) commitActiveText(); else createTextBox(v, D.tx, D.ty); } break;
  }
  D.active = false; D.mode = null; D.v = null; D.st = null;
}
