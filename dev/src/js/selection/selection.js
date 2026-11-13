// Lasso, selection bar, move/resize handles, selection actions.
import { HL_COLORS, PEN_COLORS, SET } from '../core/config.js';
import { icon } from '../core/icons.js';
import { $, $$, clamp, uid } from '../core/util.js';
import { E, live, pushUndo, renderPage, sc, snap } from '../editor/editor.js';
import { drawStroke } from '../editor/render.js';
import { buildTexts, textEl } from '../editor/text.js';
import { stopMomentum } from '../input/gestures.js';
import { roundPts, strokeBB } from '../input/ink.js';
import { D, attachLive, clearLive, toPage } from '../input/pointer.js';
import { L } from '../library/library.js';
import { copySelection, hidePasteBar, showPasteBar } from '../selection/clipboard.js';
import { drawCrop, drawImages, removeCropUI, startCrop } from '../selection/images.js';
import { closePop, popover, toast } from '../ui/dialogs.js';

/* lasso + selection (ink, text, images) + clipboard + resize + crop */
export function inBB(x, y, b, pad = 0) { return x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad; }
export const imgBB = im => [im.x, im.y, im.x + im.w, im.y + im.h];
export const pageImages = p => p.images || (p.images = []);
export function beginLasso(x, y) {
  if (E.crop) { D.mode = null; return; }
  if (E.sel && E.sel.v === D.v && inBB(x, y, E.sel.bb, 14 / E.s)) {
    D.mode = 'move'; D.mx = x; D.my = y; D.before = snap(D.v.page); E.sel.dx = 0; E.sel.dy = 0; setSelChrome(false); return;
  }
  clearSelection(); hidePasteBar();
  D.mode = 'lasso'; D.lp = [x, y]; D.lx0 = x; D.ly0 = y; D.lrect = SET.lasso.mode === 'rect'; D.lctx = attachLive(D.v);
}
export function queueLassoFrame() {
  if (D.raf) return;
  D.raf = requestAnimationFrame(() => {
    D.raf = 0; if (!D.active || D.mode !== 'lasso') return;
    const ctx = D.lctx, L = D.lp;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, live.width, live.height); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.moveTo(L[0], L[1]); for (let i = 2; i < L.length; i += 2) ctx.lineTo(L[i], L[i + 1]); ctx.closePath();
    ctx.fillStyle = 'rgba(45,91,227,.06)'; ctx.fill();
    ctx.setLineDash([5 / E.s, 4 / E.s]); ctx.lineWidth = 1.4 / E.s; ctx.strokeStyle = 'rgba(45,91,227,.9)'; ctx.stroke(); ctx.restore();
  });
}
export function pointInPoly(x, y, L) {
  let inside = false;
  for (let i = 0, j = L.length - 2; i < L.length; j = i, i += 2) {
    const xi = L[i], yi = L[i + 1], xj = L[j], yj = L[j + 1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
export function finishLasso() {
  const v = D.v, p = v.page, L = D.lp;
  clearLive();
  if (D.moved < 8 || L.length < 8) { lassoTap(v, L[0], L[1]); return; }
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let i = 0; i < L.length; i += 2) { bx0 = Math.min(bx0, L[i]); bx1 = Math.max(bx1, L[i]); by0 = Math.min(by0, L[i + 1]); by1 = Math.max(by1, L[i + 1]); }
  const ids = new Set(), tids = new Set(), iids = new Set();
  for (const st of p.strokes) {
    const b = st.bb || (st.bb = strokeBB(st));
    if (b[2] < bx0 || b[0] > bx1 || b[3] < by0 || b[1] > by1) continue;
    const n = st.p.length / 3, step = Math.max(1, Math.floor(n / 40)); let inn = 0, tot = 0;
    for (let i = 0; i < n; i += step) { tot++; if (pointInPoly(st.p[i * 3], st.p[i * 3 + 1], L)) inn++; }
    if (tot && inn / tot >= 0.5) ids.add(st.id);
  }
  for (const t of p.texts) { const el = textEl(v, t.id); const h = el ? el.offsetHeight : t.s * 1.3; if (pointInPoly(t.x + t.w / 2, t.y + h / 2, L)) tids.add(t.id); }
  for (const im of pageImages(p)) if (pointInPoly(im.x + im.w / 2, im.y + im.h / 2, L)) iids.add(im.id);
  if (!ids.size && !tids.size && !iids.size) return;
  selectItems(v, ids, tids, iids);
}
export function lassoTap(v, x, y) {
  const imgs = pageImages(v.page);
  for (let i = imgs.length - 1; i >= 0; i--) if (inBB(x, y, imgBB(imgs[i]))) { selectItems(v, new Set(), new Set(), new Set([imgs[i].id])); return; }
  if (E.clip) showPasteBar(v, x, y);
}
export function selectItems(v, ids, tids, iids) {
  clearSelection(); hidePasteBar();
  E.sel = { v, ids, tids, iids, bb: selBB(v, ids, tids, iids), dx: 0, dy: 0, k: 1, ax: 0, ay: 0 };
  renderPage(v); drawSelection(); showSelBar();
}
export function selBB(v, ids, tids, iids) {
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  const add = q => { b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])]; };
  for (const st of v.page.strokes) if (ids.has(st.id)) add(st.bb || strokeBB(st));
  for (const t of v.page.texts) if (tids.has(t.id)) { const el = textEl(v, t.id); const h = el ? el.offsetHeight : t.s * 1.3; add([t.x, t.y, t.x + t.w, t.y + h]); }
  for (const im of pageImages(v.page)) if (iids && iids.has(im.id)) add(imgBB(im));
  return b;
}
export const selXf = s => ({ k: s.k || 1, ax: s.ax || 0, ay: s.ay || 0, dx: s.dx || 0, dy: s.dy || 0, r: s.r || 0, rx: s.rx || 0, ry: s.ry || 0 });
export function xfPt(f, x, y) {   // scale about (ax, ay), move by (dx, dy), then turn by r about (rx, ry)
  const px = f.ax + (x - f.ax) * f.k + f.dx, py = f.ay + (y - f.ay) * f.k + f.dy;
  if (!f.r) return [px, py];
  const c = Math.cos(f.r), sn = Math.sin(f.r), ux = px - f.rx, uy = py - f.ry;
  return [f.rx + ux * c - uy * sn, f.ry + ux * sn + uy * c];
}
export function drawSelection() {
  const s = E.sel; if (!s || !s.v.canvas || E.crop) return;
  const ctx = attachLive(s.v), p = s.v.page, f = selXf(s);
  if (p.strokes.some(st => st.t === 'hl' && s.ids.has(st.id))) live.style.mixBlendMode = 'multiply';
  ctx.save();
  if (f.r) { ctx.translate(f.rx, f.ry); ctx.rotate(f.r); ctx.translate(-f.rx, -f.ry); }
  ctx.translate(f.dx, f.dy); ctx.translate(f.ax, f.ay); ctx.scale(f.k, f.k); ctx.translate(-f.ax, -f.ay);
  drawImages(ctx, p, null, s.iids, s.v);
  ctx.shadowColor = 'rgba(45,91,227,.55)'; ctx.shadowBlur = 5 * s.v.k;
  for (const st of p.strokes) if (st.t === 'hl' && s.ids.has(st.id)) drawStroke(ctx, st);
  for (const st of p.strokes) if (st.t !== 'hl' && s.ids.has(st.id)) drawStroke(ctx, st);
  ctx.restore();
  const pad = 6 / E.s, [x0, y0] = xfPt({ ...f, r: 0 }, s.bb[0], s.bb[1]), [x1, y1] = xfPt({ ...f, r: 0 }, s.bb[2], s.bb[3]), turn = { k: 1, ax: 0, ay: 0, dx: 0, dy: 0, r: f.r, rx: f.rx, ry: f.ry };
  const Q = [[x0 - pad, y0 - pad], [x1 + pad, y0 - pad], [x1 + pad, y1 + pad], [x0 - pad, y1 + pad]].map(([x, y]) => xfPt(turn, x, y));
  ctx.save(); ctx.setLineDash([5 / E.s, 4 / E.s]); ctx.lineWidth = 1.3 / E.s; ctx.strokeStyle = 'rgba(45,91,227,.95)';
  ctx.beginPath(); Q.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.stroke(); ctx.restore();
  for (const t of p.texts) {
    if (!s.tids.has(t.id)) continue; const el = textEl(s.v, t.id); if (!el) continue;
    const [nx, ny] = xfPt(f, t.x, t.y); el.style.transformOrigin = '0 0';
    el.style.transform = `translate(${nx - t.x}px,${ny - t.y}px) scale(${f.k})`;
  }
}
export function queueMoveFrame() { if (D.raf) return; D.raf = requestAnimationFrame(() => { D.raf = 0; if (E.crop) drawCrop(); else if (E.sel) drawSelection(); }); }
export function commitSelTransform(before) {
  const s = E.sel; if (!s) return;
  const f = selXf(s), p = s.v.page;
  if (Math.abs(f.k - 1) < 0.001 && Math.abs(f.dx) < 0.01 && Math.abs(f.dy) < 0.01 && Math.abs(f.r) < 0.0005) { s.k = 1; s.dx = s.dy = 0; s.r = 0; drawSelection(); showSelBar(); return; }
  p.strokes = p.strokes.map(st => {
    if (!s.ids.has(st.id)) return st;
    const P = st.p.slice(); for (let i = 0; i < P.length; i += 3) { const q = xfPt(f, P[i], P[i + 1]); P[i] = q[0]; P[i + 1] = q[1]; }
    roundPts(P); const ns = { ...st, p: P, s: Math.round(st.s * f.k * 100) / 100 }; ns.bb = strokeBB(ns); return ns;
  });
  p.texts.forEach(t => { if (!s.tids.has(t.id)) return; const q = xfPt(f, t.x, t.y); t.x = q[0]; t.y = q[1]; t.w = t.w * f.k; t.s = Math.max(6, Math.round(t.s * f.k * 10) / 10); });
  p.images = pageImages(p).map(im => { if (!s.iids.has(im.id)) return im; const q = xfPt(f, im.x, im.y); return { ...im, x: q[0], y: q[1], w: im.w * f.k, h: im.h * f.k }; });
  pushUndo({ k: 'page', id: p.id, before, after: snap(p) });
  s.k = 1; s.dx = s.dy = 0; s.ax = s.ay = 0; s.r = 0;
  buildTexts(s.v); s.bb = selBB(s.v, s.ids, s.tids, s.iids); renderPage(s.v); drawSelection(); showSelBar();
}
export function finishMove() { commitSelTransform(D.before); }

/* bars + handles (work with Pencil, finger and mouse: act on pointerup) */
export function bindBarTap(bar, fn) {
  let down = null;
  bar.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); down = e.target.closest('button'); });
  bar.addEventListener('pointerup', e => { e.stopPropagation(); const b = e.target.closest('button'); if (b && b === down) fn(b); down = null; });
  bar.addEventListener('pointercancel', () => { down = null; });
  bar.addEventListener('click', e => e.stopPropagation());
}
export function showSelBar() {
  const s = E.sel; if (!s) return;
  hideSelBar();
  const single = s.iids.size === 1 && !s.ids.size && !s.tids.size;
  const bar = document.createElement('div'); bar.className = 'sel-bar';
  bar.innerHTML = (s.ids.size || s.tids.size ? `<button data-sa="color" data-popanchor>${icon('palette')}Colour</button>` : '')
    + `<button data-sa="copy">${icon('copy')}Copy</button><button data-sa="cut">${icon('scissors')}Cut</button><button data-sa="dup">${icon('dup')}Duplicate</button>`
    + (single ? `<button data-sa="crop">${icon('crop')}Crop</button>` : '')
    + `<button data-sa="del">${icon('trash')}Delete</button><button data-sa="done" aria-label="Done">${icon('check')}</button>`;
  bindBarTap(bar, b => selAction(b.dataset.sa, b));
  s.v.el.appendChild(bar); s.bar = bar;
  const hs = ['tl', 'tr', 'bl', 'br']; if (canRotate(s)) hs.push('rot');
  s.handles = hs.map(h => { const d = document.createElement('div'); d.className = 'sel-handle h-' + h; d.dataset.h = h; if (h === 'rot') { d.innerHTML = icon('rotate'); d.title = 'Drag to rotate'; } s.v.el.appendChild(d); return d; });
  positionSelBar();
}
export function positionSelBar() {
  const s = E.sel; if (!s || !s.bar) return;
  const S = E.s, pad = 6, b = s.bb;
  const bw = s.bar.offsetWidth || 400, pw = s.v.page.w * S;
  const cx = (b[0] + b[2]) / 2 * S, top = b[1] * S - pad - 8;
  s.bar.classList.toggle('below', top < 56);
  s.bar.style.left = clamp(cx, bw / 2 + 4, Math.max(bw / 2 + 4, pw - bw / 2 - 4)) + 'px';
  s.bar.style.top = (top < 56 ? b[3] * S + pad + 8 : top) + 'px';
  const pos = { tl: [b[0] * S - pad, b[1] * S - pad], tr: [b[2] * S + pad, b[1] * S - pad], bl: [b[0] * S - pad, b[3] * S + pad], br: [b[2] * S + pad, b[3] * S + pad],
    rot: [b[2] * S + pad + 30 < pw - 8 ? b[2] * S + pad + 30 : b[0] * S - pad - 30, (b[1] + b[3]) / 2 * S] };   // rotate handle: out to the right (left near the page edge), clear of the bar
  for (const h of s.handles || []) { const q = pos[h.dataset.h]; h.style.left = q[0] + 'px'; h.style.top = q[1] + 'px'; }
}
export function setSelChrome(on) { const s = E.sel; if (!s) return; if (s.bar) s.bar.style.visibility = on ? '' : 'hidden'; (s.handles || []).forEach(h => h.style.visibility = on ? '' : 'hidden'); }
export function hideSelBar() { const s = E.sel; if (s) { if (s.bar) s.bar.remove(); (s.handles || []).forEach(h => h.remove()); s.bar = null; s.handles = null; } $$('.sel-bar:not(.paste-bar), .sel-handle').forEach(x => x.remove()); }
export function clearSelection() {
  if (E.crop) { removeCropUI(); E.crop = null; }
  if (!E.sel) return;
  const v = E.sel.v; hideSelBar(); E.sel = null; clearLive();
  $$('.tbox', v.el).forEach(el => { el.style.transform = ''; });
  if (v.canvas) renderPage(v);
}
export function startHandleDrag(e, h) {
  if (D.active) return;
  const pageEl = h.closest('.page'), v = pageEl && E.views.get(pageEl.dataset.id); if (!v) return;
  e.preventDefault(); e.stopPropagation(); stopMomentum();
  Object.assign(D, { active: true, pid: e.pointerId, type: e.pointerType, v, rect: pageEl.getBoundingClientRect(), t0: performance.now(), moved: 0, sx0: e.clientX, sy0: e.clientY, h: h.dataset.h });
  try { sc().setPointerCapture(e.pointerId); } catch (err) {}
  if (h.classList.contains('crop-handle')) { D.mode = 'crop'; return; }
  const s = E.sel; if (!s) { D.active = false; return; }
  if (D.h === 'rot') {
    D.mode = 'rotate'; D.before = snap(v.page); s.k = 1; s.dx = s.dy = 0; s.r = 0;
    s.rx = (s.bb[0] + s.bb[2]) / 2; s.ry = (s.bb[1] + s.bb[3]) / 2;
    const { x, y } = toPage(e); D.a0 = Math.atan2(y - s.ry, x - s.rx);
    setSelChrome(false); return;
  }
  D.mode = 'resize'; D.before = snap(v.page);
  const b = s.bb, C = { tl: [b[0], b[1]], tr: [b[2], b[1]], bl: [b[0], b[3]], br: [b[2], b[3]] }, opp = { tl: 'br', tr: 'bl', bl: 'tr', br: 'tl' };
  D.corner = C[D.h]; s.ax = C[opp[D.h]][0]; s.ay = C[opp[D.h]][1]; s.k = 1; s.dx = s.dy = 0;
  setSelChrome(false);
}
export function moveResize(x, y) {
  const s = E.sel, vx = D.corner[0] - s.ax, vy = D.corner[1] - s.ay, l2 = vx * vx + vy * vy || 1;
  let k = ((x - s.ax) * vx + (y - s.ay) * vy) / l2;
  k = clamp(k, 14 / Math.max(1, Math.abs(vx), Math.abs(vy)), 25);
  s.k = k; queueMoveFrame();
}
/* rotate: ink-only selections get a round handle; drag it around the centre. Snaps level at every 45°. */
export const canRotate = s => s.ids.size > 0 && !s.tids.size && !s.iids.size;
export function moveRotate(x, y) {
  const s = E.sel, step = Math.PI / 4;
  let r = Math.atan2(y - s.ry, x - s.rx) - D.a0;
  r = Math.atan2(Math.sin(r), Math.cos(r));                     // keep in -180°..180°
  const near = Math.round(r / step) * step; if (Math.abs(r - near) < 3 * Math.PI / 180) r = near;
  s.r = r; queueMoveFrame();
}
export function selAction(a, btn) {
  const s = E.sel; if (!s) return;
  const v = s.v, p = v.page, before = snap(p);
  if (a === 'done') { clearSelection(); return; }
  if (a === 'copy') { copySelection(); toast('Copied — tap the page with the lasso to paste'); return; }
  if (a === 'crop') { startCrop(); return; }
  if (a === 'del' || a === 'cut') {
    if (a === 'cut') copySelection();
    p.strokes = p.strokes.filter(st => !s.ids.has(st.id)); p.texts = p.texts.filter(t => !s.tids.has(t.id)); p.images = pageImages(p).filter(im => !s.iids.has(im.id));
    hideSelBar(); E.sel = null; clearLive(); buildTexts(v); renderPage(v);
    pushUndo({ k: 'page', id: p.id, before, after: snap(p) });
    if (a === 'cut') toast('Cut — tap the page with the lasso to paste');
    return;
  }
  if (a === 'dup') {
    const off = 24, nids = new Set(), ntids = new Set(), niids = new Set();
    const adds = p.strokes.filter(st => s.ids.has(st.id)).map(st => { const P = st.p.map((q, i) => i % 3 === 2 ? q : q + off); const ns = { ...st, id: uid(), p: P }; ns.bb = strokeBB(ns); nids.add(ns.id); return ns; });
    const tadds = p.texts.filter(t => s.tids.has(t.id)).map(t => { const nt = { ...t, id: uid(), x: t.x + off, y: t.y + off }; ntids.add(nt.id); return nt; });
    const iadds = pageImages(p).filter(im => s.iids.has(im.id)).map(im => { const ni = { ...im, id: uid(), x: im.x + off, y: im.y + off }; niids.add(ni.id); return ni; });
    p.strokes = p.strokes.concat(adds); p.texts = p.texts.concat(tadds); p.images = pageImages(p).concat(iadds);
    pushUndo({ k: 'page', id: p.id, before, after: snap(p) });
    clearSelection(); buildTexts(v); selectItems(v, nids, ntids, niids); return;
  }
  if (a === 'color') {
    const cols = [...PEN_COLORS, ...HL_COLORS];
    const pop = popover(btn, `<div class="swgrid">${cols.map(c => `<button class="sw" data-c="${c}"><i style="background:${c}"></i></button>`).join('')}</div>`);
    bindBarTap(pop, b => {
      const c = b.dataset.c; if (!c) return;
      p.strokes = p.strokes.map(st => s.ids.has(st.id) ? { ...st, c } : st);
      p.texts.forEach(t => { if (s.tids.has(t.id)) t.c = c; });
      pushUndo({ k: 'page', id: p.id, before, after: snap(p) });
      buildTexts(v); drawSelection(); closePop();
    });
  }
}
