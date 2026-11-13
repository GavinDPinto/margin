// Copy / cut / paste of selections across pages and notes.
import { icon } from '../core/icons.js';
import { DB } from '../core/storage.js';
import { $, clamp, uid } from '../core/util.js';
import { E, pushUndo, sc, snap } from '../editor/editor.js';
import { buildTexts, commitActiveText } from '../editor/text.js';
import { setTool } from '../editor/toolbar.js';
import { strokeBB } from '../input/ink.js';
import { bindBarTap, clearSelection, pageImages, selectItems } from '../selection/selection.js';

/* clipboard (works across pages and notes) */
export function copySelection() {
  const s = E.sel; if (!s) return false;
  const p = s.v.page, b = s.bb, ox = b[0], oy = b[1];
  E.clip = {
    noteId: E.note.id, w: b[2] - b[0], h: b[3] - b[1],
    strokes: p.strokes.filter(st => s.ids.has(st.id)).map(st => { const P = st.p.slice(); for (let i = 0; i < P.length; i += 3) { P[i] -= ox; P[i + 1] -= oy; } return { ...st, p: P }; }),
    texts: p.texts.filter(t => s.tids.has(t.id)).map(t => ({ ...t, x: t.x - ox, y: t.y - oy })),
    images: pageImages(p).filter(im => s.iids.has(im.id)).map(im => ({ ...im, x: im.x - ox, y: im.y - oy })),
  };
  return true;
}
export function currentView() { const p = E.pages[E.cur]; return p && E.views.get(p.id); }
export function visibleCenter(v) {
  const r = v.el.getBoundingClientRect(), sr = sc().getBoundingClientRect();
  const cx = (Math.max(r.left, sr.left) + Math.min(r.right, sr.right)) / 2, cy = (Math.max(r.top, sr.top) + Math.min(r.bottom, sr.bottom)) / 2;
  return { x: clamp((cx - r.left) / E.s, 0, v.page.w), y: clamp((cy - r.top) / E.s, 0, v.page.h) };
}
export async function pasteClip(v, cx, cy) {
  const c = E.clip; if (!c || !v) return;
  hidePasteBar(); commitActiveText();
  if (E.tool !== 'lasso') setTool('lasso'); else clearSelection();
  if (cx == null) { const q = visibleCenter(v); cx = q.x; cy = q.y; }
  const p = v.page, ox = clamp(cx - c.w / 2, 0, Math.max(0, p.w - c.w)), oy = clamp(cy - c.h / 2, 0, Math.max(0, p.h - c.h));
  const before = snap(p), blobMap = new Map();
  if (c.noteId !== E.note.id) for (const im of c.images) {
    if (blobMap.has(im.b)) continue;
    const rec = await DB.get('blobs', im.b);
    if (rec) { const nid = uid(); await DB.put('blobs', { ...rec, id: nid }); blobMap.set(im.b, nid); E.note.blobs = [...(E.note.blobs || []), nid]; }
  }
  const ids = new Set(), tids = new Set(), iids = new Set();
  const strokes = c.strokes.map(st => { const P = st.p.slice(); for (let i = 0; i < P.length; i += 3) { P[i] += ox; P[i + 1] += oy; } const ns = { ...st, id: uid(), p: P }; ns.bb = strokeBB(ns); ids.add(ns.id); return ns; });
  const texts = c.texts.map(t => { const nt = { ...t, id: uid(), x: t.x + ox, y: t.y + oy }; tids.add(nt.id); return nt; });
  const images = c.images.map(im => { const ni = { ...im, id: uid(), b: blobMap.get(im.b) || im.b, x: im.x + ox, y: im.y + oy }; iids.add(ni.id); return ni; });
  p.strokes = p.strokes.concat(strokes); p.texts = p.texts.concat(texts); p.images = pageImages(p).concat(images);
  pushUndo({ k: 'page', id: p.id, before, after: snap(p) });
  buildTexts(v); selectItems(v, ids, tids, iids);
}
export function showPasteBar(v, x, y) {
  hidePasteBar();
  const bar = document.createElement('div'); bar.className = 'sel-bar paste-bar';
  bar.innerHTML = `<button data-pa="paste">${icon('paste')}Paste</button>`;
  bindBarTap(bar, () => pasteClip(v, x, y));
  bar.style.left = x * E.s + 'px'; bar.style.top = y * E.s - 6 + 'px';
  v.el.appendChild(bar); E.pasteBar = bar;
}
export function hidePasteBar() { if (E.pasteBar) { E.pasteBar.remove(); E.pasteBar = null; } }
