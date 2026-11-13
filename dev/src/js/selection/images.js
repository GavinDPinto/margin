// Images on pages: insert, draw, crop.
import { icon } from '../core/icons.js';
import { DB, bgCache, bgFailed, loadBg } from '../core/storage.js';
import { $, clamp, uid } from '../core/util.js';
import { E, pushUndo, renderPage, snap } from '../editor/editor.js';
import { commitActiveText } from '../editor/text.js';
import { setTool } from '../editor/toolbar.js';
import { D, attachLive } from '../input/pointer.js';
import { canvasToBlob, isImportable } from '../library/import.js';
import { currentView, hidePasteBar, visibleCenter } from '../selection/clipboard.js';
import { bindBarTap, clearSelection, drawSelection, hideSelBar, pageImages, queueMoveFrame, selectItems } from '../selection/selection.js';
import { pickFiles, progressBox, toast } from '../ui/dialogs.js';

/* images */
export function drawImageObj(ctx, im, img) {
  const nw = img.naturalWidth, nh = img.naturalHeight;
  try { ctx.drawImage(img, im.cx * nw, im.cy * nh, im.cw * nw, im.ch * nh, im.x, im.y, im.w, im.h); } catch (e) {}
}
export function drawImages(ctx, p, exclude, only, v) {
  for (const im of p.images || []) {
    if (exclude && exclude.has(im.id)) continue;
    if (only && !only.has(im.id)) continue;
    const img = bgCache.get(im.b);
    if (img) { drawImageObj(ctx, im, img); continue; }
    ctx.save(); ctx.fillStyle = 'rgba(120,120,128,.12)'; ctx.fillRect(im.x, im.y, im.w, im.h); ctx.restore();
    if (v && !bgFailed.has(im.b)) loadBg(im.b).then(x => { if (x && v.canvas) { renderPage(v); if (E.sel && E.sel.v === v) drawSelection(); if (E.crop && E.crop.v === v) drawCrop(); } });
  }
}
export async function imageFileToBlob(file) {
  const url = URL.createObjectURL(file), img = new Image(); img.src = url;
  try { await img.decode(); } catch (e) { await new Promise((r, j) => { if (img.complete && img.naturalWidth) r(); else { img.onload = r; img.onerror = () => j(new Error('That image format isn’t supported')); } }); }
  const iw = img.naturalWidth, ih = img.naturalHeight; if (!iw) throw new Error('That image couldn’t be read');
  const s = Math.min(1, 2400 / Math.max(iw, ih), Math.sqrt(8e6 / (iw * ih)));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(iw * s)); c.height = Math.max(1, Math.round(ih * s));
  const ctx = c.getContext('2d'), alpha = /png|gif|webp/.test(file.type);
  if (!alpha) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
  const type = alpha ? 'image/png' : 'image/jpeg', blob = await canvasToBlob(c, type, 0.9);
  const id = uid(); await DB.put('blobs', { id, type, data: await blob.arrayBuffer() });
  const out = { id, nw: c.width, nh: c.height }; c.width = c.height = 0; return out;
}
export async function insertImages(files) {
  const v = currentView(); if (!v) return;
  commitActiveText(); clearSelection(); hidePasteBar();
  const p = v.page, before = snap(p), c = visibleCenter(v), iids = new Set(), adds = [];
  const pg = files.length > 1 ? progressBox('Adding images') : null;
  try {
    for (let i = 0; i < files.length; i++) {
      pg && pg.set(`Image ${i + 1} of ${files.length}`, (i + 1) / files.length);
      const r = await imageFileToBlob(files[i]);
      let w = Math.max(Math.min(p.w * 0.6, r.nw / 2, 460), Math.min(180, r.nw)), h = w * r.nh / r.nw;
      if (h > p.h * 0.55) { h = p.h * 0.55; w = h * r.nw / r.nh; }
      const off = i * 28;
      const im = { id: uid(), b: r.id, x: clamp(c.x - w / 2 + off, 0, Math.max(0, p.w - w)), y: clamp(c.y - h / 2 + off, 0, Math.max(0, p.h - h)), w, h, cx: 0, cy: 0, cw: 1, ch: 1 };
      adds.push(im); iids.add(im.id); E.note.blobs = [...(E.note.blobs || []), r.id];
    }
  } catch (e) { toast(e.message || 'Couldn’t add that image'); }
  finally { pg && pg.close(); }
  if (!adds.length) return;
  p.images = pageImages(p).concat(adds);
  pushUndo({ k: 'page', id: p.id, before, after: snap(p) });
  await Promise.all(adds.map(a => loadBg(a.b)));
  setTool('lasso'); selectItems(v, new Set(), new Set(), iids);
  toast(adds.length > 1 ? `Added ${adds.length} images` : 'Drag the corners to resize · Crop to trim · drag to move');
}
export async function pickAndInsertImages() { const files = await pickFiles($('#file-img')); if (files.length) insertImages(files.filter(isImportable)); }

/* crop */
export function startCrop() {
  const s = E.sel; if (!s) return;
  const id = [...s.iids][0], im = pageImages(s.v.page).find(i => i.id === id); if (!im) return;
  const fw = im.w / im.cw, fh = im.h / im.ch;
  hideSelBar();
  E.crop = { v: s.v, id, b: im.b, full: { x: im.x - im.cx * fw, y: im.y - im.cy * fh, w: fw, h: fh }, r: { x: im.x, y: im.y, w: im.w, h: im.h } };
  const bar = document.createElement('div'); bar.className = 'sel-bar crop-bar';
  bar.innerHTML = `<button data-ca="reset">Reset</button><button data-ca="cancel">Cancel</button><button data-ca="done" class="accent">${icon('check')}Done</button>`;
  bindBarTap(bar, b => b.dataset.ca === 'reset' ? (E.crop.r = { ...E.crop.full }, drawCrop(), positionCropUI()) : exitCrop(b.dataset.ca === 'done'));
  s.v.el.appendChild(bar); E.crop.bar = bar;
  E.crop.handles = ['tl', 'tr', 'bl', 'br'].map(h => { const d = document.createElement('div'); d.className = 'crop-handle h-' + h; d.dataset.h = h; s.v.el.appendChild(d); return d; });
  drawCrop(); positionCropUI();
}
export function positionCropUI() {
  const c = E.crop; if (!c) return; const S = E.s, r = c.r;
  const top = r.y * S - 14;
  c.bar.classList.toggle('below', top < 56);
  c.bar.style.left = (r.x + r.w / 2) * S + 'px'; c.bar.style.top = (top < 56 ? (r.y + r.h) * S + 14 : top) + 'px';
  const pos = { tl: [r.x, r.y], tr: [r.x + r.w, r.y], bl: [r.x, r.y + r.h], br: [r.x + r.w, r.y + r.h] };
  c.handles.forEach(h => { const q = pos[h.dataset.h]; h.style.left = q[0] * S + 'px'; h.style.top = q[1] * S + 'px'; });
}
export function removeCropUI() { const c = E.crop; if (!c) return; c.bar && c.bar.remove(); (c.handles || []).forEach(h => h.remove()); }
export function drawCrop() {
  const c = E.crop; if (!c || !c.v.canvas) return;
  const ctx = attachLive(c.v), img = bgCache.get(c.b), f = c.full, r = c.r;
  if (!img) { loadBg(c.b).then(x => x && drawCrop()); return; }
  ctx.save(); ctx.globalAlpha = 0.35; ctx.drawImage(img, f.x, f.y, f.w, f.h); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip(); ctx.drawImage(img, f.x, f.y, f.w, f.h);
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1 / E.s; ctx.beginPath();
  for (let i = 1; i < 3; i++) { ctx.moveTo(r.x + r.w * i / 3, r.y); ctx.lineTo(r.x + r.w * i / 3, r.y + r.h); ctx.moveTo(r.x, r.y + r.h * i / 3); ctx.lineTo(r.x + r.w, r.y + r.h * i / 3); }
  ctx.stroke(); ctx.restore();
  ctx.save(); ctx.lineWidth = 2 / E.s; ctx.strokeStyle = '#fff'; ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.lineWidth = 1 / E.s; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.strokeRect(r.x - 1.5 / E.s, r.y - 1.5 / E.s, r.w + 3 / E.s, r.h + 3 / E.s); ctx.restore();
}
export function moveCrop(x, y) {
  const c = E.crop, f = c.full, r = c.r, MIN = 16;
  let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
  if (D.h.includes('l')) x0 = clamp(x, f.x, x1 - MIN);
  if (D.h.includes('r')) x1 = clamp(x, x0 + MIN, f.x + f.w);
  if (D.h.includes('t')) y0 = clamp(y, f.y, y1 - MIN);
  if (D.h.includes('b')) y1 = clamp(y, y0 + MIN, f.y + f.h);
  c.r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; positionCropUI(); queueMoveFrame();
}
export function exitCrop(apply) {
  const c = E.crop; if (!c) return;
  removeCropUI(); E.crop = null;
  const v = c.v, p = v.page;
  if (apply) {
    const before = snap(p), f = c.full, r = c.r;
    p.images = pageImages(p).map(im => im.id !== c.id ? im : { ...im, x: r.x, y: r.y, w: r.w, h: r.h, cx: (r.x - f.x) / f.w, cy: (r.y - f.y) / f.h, cw: r.w / f.w, ch: r.h / f.h });
    pushUndo({ k: 'page', id: p.id, before, after: snap(p) });
  }
  selectItems(v, new Set(), new Set(), new Set([c.id]));
}
