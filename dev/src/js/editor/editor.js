// Editor state (E), undo/redo, saving, page views, zoom, open/close note.
import { PAPERS, SET } from '../core/config.js';
import { DB, bgCache, bgFailed, loadBg } from '../core/storage.js';
import { $, MAX_CANVAS_PX, PAGE_W, clamp, dpr, now } from '../core/util.js';
import { drawAllStrokes, drawPaper, renderPageToCanvas } from '../editor/render.js';
import { buildTexts, commitActiveText } from '../editor/text.js';
import { setTool } from '../editor/toolbar.js';
import { D } from '../input/pointer.js';
import { newPage, refreshLib } from '../library/library.js';
import { hidePasteBar } from '../selection/clipboard.js';
import { drawCrop, drawImages, positionCropUI } from '../selection/images.js';
import { clearSelection, drawSelection, positionSelBar } from '../selection/selection.js';
import { toast } from '../ui/dialogs.js';

/* =====================================================================
   EDITOR
   ===================================================================== */
export const E = {
  open: false, note: null, pages: [], views: new Map(), s: 1, cur: 0,
  tool: SET.tool || 'pen', undo: [], redo: [], dirty: false, saveT: 0,
  sel: null, io: null, penSeen: false, activeText: null, rerenderT: 0, clip: null, crop: null, pasteBar: null, pasteT: 0,
};
export const sc = () => $('#scroller');
export const live = document.createElement('canvas'); live.className = 'live';

export function snap(p) { return { strokes: p.strokes, images: p.images || [], texts: (p.texts || []).map(t => ({ ...t })), template: p.template, paper: p.paper, spacing: p.spacing, ink: p.ink }; }
export function restoreSnap(p, s) { p.strokes = s.strokes; p.images = s.images || []; p.texts = s.texts.map(t => ({ ...t })); p.template = s.template; p.paper = s.paper; p.spacing = s.spacing; p.ink = s.ink; }
export function pushUndo(en) { E.undo.push(en); if (E.undo.length > 300) E.undo.shift(); E.redo = []; updUndo(); markDirty(); }
export function updUndo() { $('#ed-undo').disabled = !E.undo.length; $('#ed-redo').disabled = !E.redo.length; }
export function applyEntry(en, which) {
  if (en.k === 'page') {
    const v = E.views.get(en.id), p = v ? v.page : E.pages.find(x => x.id === en.id); if (!p) return;
    restoreSnap(p, en[which]);
    if (v) { buildTexts(v); v.el.style.background = (PAPERS[p.paper] || PAPERS.white)[0]; if (v.canvas) renderPage(v); }
  } else if (en.k === 'pages') { E.pages = en[which].slice(); syncViews(); }
  else if (en.k === 'multi') { (which === 'before' ? en.list.slice().reverse() : en.list).forEach(x => applyEntry(x, which)); }
}
export function undo() { commitActiveText(); clearSelection(); const en = E.undo.pop(); if (!en) return; applyEntry(en, 'before'); E.redo.push(en); updUndo(); markDirty(); }
export function redo() { commitActiveText(); clearSelection(); const en = E.redo.pop(); if (!en) return; applyEntry(en, 'after'); E.undo.push(en); updUndo(); markDirty(); }

export function markDirty() { E.dirty = true; clearTimeout(E.saveT); E.saveT = setTimeout(saveNote, 700); }
export let saving = Promise.resolve();
export function saveNote() {
  clearTimeout(E.saveT);
  if (!E.note || !E.dirty) return saving;
  E.dirty = false;
  const note = E.note, pages = E.pages.map(p => ({ ...p, texts: (p.texts || []).filter(t => t.v && t.v.trim()) }));
  note.updated = now(); note.pageCount = pages.length;
  saving = saving.then(async () => { await DB.put('pages', { id: note.id, pages }); await DB.put('notes', note); })
    .catch(e => { console.error(e); E.dirty = true; toast('Couldn’t save — storage may be full'); });
  return saving;
}

/* ---------- views ---------- */
export function fitScale() { const w = sc().clientWidth - 44; return clamp(w / PAGE_W, 0.3, 1.6); }
export function makeView(p) {
  const el = document.createElement('div'); el.className = 'page'; el.dataset.id = p.id;
  const tl = document.createElement('div'); tl.className = 'tlayer'; el.appendChild(tl);
  const v = { page: p, el, textLayer: tl, canvas: null, k: 1 };
  sizeView(v); buildTexts(v);
  return v;
}
export function sizeView(v) {
  const s = E.s, p = v.page;
  v.el.style.width = p.w * s + 'px'; v.el.style.height = p.h * s + 'px';
  v.el.style.background = (PAPERS[p.paper] || PAPERS.white)[0];
  v.textLayer.style.width = p.w + 'px'; v.textLayer.style.height = p.h + 'px'; v.textLayer.style.transform = `scale(${s})`;
  if (v.canvas) { v.canvas.style.width = p.w * s + 'px'; v.canvas.style.height = p.h * s + 'px'; }
  if (live.parentNode === v.el) { live.style.width = p.w * s + 'px'; live.style.height = p.h * s + 'px'; }
}
export function syncViews() {
  const pagesEl = $('#pages'), keep = new Set(E.pages.map(p => p.id));
  for (const [id, v] of E.views) if (!keep.has(id)) { unmount(v, true); E.io.unobserve(v.el); v.el.remove(); E.views.delete(id); }
  E.pages.forEach(p => {
    let v = E.views.get(p.id);
    if (!v) { v = makeView(p); E.views.set(p.id, v); E.io.observe(v.el); } else { v.page = p; }
    pagesEl.appendChild(v.el);
  });
  updIndicator();
}
export function mount(v) {
  if (v.canvas) return;
  const c = document.createElement('canvas'); c.className = 'pc';
  v.el.insertBefore(c, v.el.firstChild); v.canvas = c; renderPage(v);
}
export function unmount(v, force) {
  if (!v.canvas) return;
  if (!force && D.active && D.v === v) return;
  if (E.sel && E.sel.v === v) clearSelection();
  if (E.pasteBar && E.pasteBar.parentNode === v.el) hidePasteBar();
  v.canvas.width = v.canvas.height = 0; v.canvas.remove(); v.canvas = null;
  if (live.parentNode === v.el) { live.remove(); live.width = live.height = 0; }
}
export function pageK(p) { let k = E.s * dpr(); if (p.w * p.h * k * k > MAX_CANVAS_PX) k = Math.sqrt(MAX_CANVAS_PX / (p.w * p.h)); return k; }
export function renderPage(v) {
  const c = v.canvas; if (!c) return;
  const p = v.page, k = pageK(p);
  const W = Math.round(p.w * k), H = Math.round(p.h * k);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  c.style.width = p.w * E.s + 'px'; c.style.height = p.h * E.s + 'px';
  v.k = k;
  const ctx = c.getContext('2d'); ctx.setTransform(k, 0, 0, k, 0, 0);
  drawPaper(ctx, p);
  if (p.bg) {
    const img = bgCache.get(p.bg);
    if (img) { try { ctx.drawImage(img, 0, 0, p.w, p.h); } catch (e) {} }
    else if (!bgFailed.has(p.bg)) { loadBg(p.bg).then(im => { if (im && v.canvas) renderPage(v); }); }
  }
  const sel = E.sel && E.sel.v === v ? E.sel : null;
  drawImages(ctx, p, sel ? sel.iids : null, null, v);
  drawAllStrokes(ctx, p.strokes, sel ? sel.ids : null);
}
export function scheduleRerender() {
  clearTimeout(E.rerenderT);
  E.rerenderT = setTimeout(() => { for (const v of E.views.values()) if (v.canvas) renderPage(v); if (E.crop) drawCrop(); else if (E.sel) drawSelection(); }, 160);
}
export function setScale(ns) {
  E.s = clamp(ns, 0.25, 5);
  for (const v of E.views.values()) sizeView(v);
  hidePasteBar();
  if (E.crop) positionCropUI(); else if (E.sel) positionSelBar();
  scheduleRerender();
}
export function zoomAround(ns, clientX, clientY, anchor) {
  const a = anchor || anchorAt(clientX, clientY); if (!a) { setScale(ns); return; }
  setScale(ns);
  const s = sc(), r = s.getBoundingClientRect();
  s.scrollLeft = a.v.el.offsetLeft + a.u * E.s - (clientX - r.left);
  s.scrollTop = a.v.el.offsetTop + a.y * E.s - (clientY - r.top);
}
export function anchorAt(cx, cy) {
  let best = null, bd = Infinity;
  for (const v of E.views.values()) {
    const r = v.el.getBoundingClientRect();
    const d = cy < r.top ? r.top - cy : cy > r.bottom ? cy - r.bottom : 0;
    if (d < bd) { bd = d; best = { v, r }; if (d === 0) break; }
  }
  if (!best) return null;
  return { v: best.v, u: (cx - best.r.left) / E.s, y: (cy - best.r.top) / E.s };
}
export function updIndicator() {
  const s = sc(); if (!E.views.size) return;
  const mid = s.scrollTop + s.clientHeight * 0.4;
  let idx = 0;
  E.pages.forEach((p, i) => { const v = E.views.get(p.id); if (v && v.el.offsetTop <= mid) idx = i; });
  E.cur = idx;
  const ind = $('#page-ind'); ind.textContent = `${idx + 1} / ${E.pages.length}`;
  ind.classList.add('show'); clearTimeout(ind._t); ind._t = setTimeout(() => ind.classList.remove('show'), 1400);
}
export function scrollToPage(i) { const p = E.pages[i]; const v = p && E.views.get(p.id); if (v) sc().scrollTop = v.el.offsetTop - 16; updIndicator(); }

/* ---------- open / close ---------- */
export async function openNote(id) {
  const meta = await DB.get('notes', id); if (!meta) { toast('Note not found'); return; }
  const rec = await DB.get('pages', id);
  E.note = meta;
  E.pages = (rec && rec.pages && rec.pages.length ? rec.pages : [newPage(meta.template, meta.paper)]).map(p => ({ ...p, texts: p.texts || [], strokes: p.strokes || [], images: p.images || [] }));
  E.undo = []; E.redo = []; E.dirty = false; E.sel = null; E.views.clear();
  $('#library').hidden = true; $('#editor').hidden = false; E.open = true;
  $('#ed-title').value = meta.title || '';
  $('#pages').innerHTML = '';
  E.io = new IntersectionObserver(ents => {
    for (const en of ents) { const v = E.views.get(en.target.dataset.id); if (!v) continue; if (en.isIntersecting) mount(v); else unmount(v); }
  }, { root: sc(), rootMargin: '70% 0px 70% 0px' });
  E.s = fitScale();
  syncViews();
  sc().scrollTop = 0; sc().scrollLeft = 0;
  setTool(E.tool); updUndo();
  history.replaceState(null, '', '#' + 'note-' + id.replace(/[^A-Za-z0-9-]/g, ''));
}
export async function closeNote() {
  if (!E.open) return;
  commitActiveText(); clearSelection();
  await saveNote(); await saving;
  const note = E.note, pages = E.pages;
  // thumbnail
  try {
    const p0 = pages[0]; const c = await renderPageToCanvas(p0, 320 / p0.w);
    note.thumb = c.toDataURL('image/jpeg', 0.82); c.width = c.height = 0;
  } catch (e) {}
  // orphaned backgrounds (from deleted pages)
  const used = new Set(pages.map(p => p.bg).filter(Boolean)); pages.forEach(p => (p.images || []).forEach(im => used.add(im.b)));
  const all = new Set([...(note.blobs || []), ...used]);
  for (const b of all) if (!used.has(b)) { try { await DB.del('blobs', b); } catch (e) {} }
  note.blobs = [...used];
  await DB.put('notes', note);
  for (const v of E.views.values()) unmount(v, true);
  E.io && E.io.disconnect(); E.views.clear(); $('#pages').innerHTML = '';
  E.open = false; E.note = null; E.pages = []; E.undo = []; E.redo = []; hidePasteBar();
  $('#editor').hidden = true; $('#library').hidden = false;
  history.replaceState(null, '', location.pathname + location.search);
  await refreshLib();
  if (window.__marginUpdateReady) location.reload();
}
