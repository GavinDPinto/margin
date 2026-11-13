// Typed text boxes.
import { SET } from '../core/config.js';
import { $, TEXT_PAD_X, clamp, uid } from '../core/util.js';
import { E, markDirty, pushUndo, snap } from '../editor/editor.js';
import { setTool } from '../editor/toolbar.js';

/* text boxes */
export function textEl(v, id) { return v.textLayer.querySelector(`[data-tid="${id}"]`); }
export function styleTextEl(el, t) { el.style.left = t.x + 'px'; el.style.top = t.y + 'px'; el.style.width = t.w + 'px'; el.style.fontSize = t.s + 'px'; el.style.color = t.c; }
export function buildTexts(v) {
  const keepFocus = E.activeText && E.activeText.v === v ? E.activeText.t.id : null;
  v.textLayer.querySelectorAll('.tbox').forEach(el => { if (el.dataset.tid !== keepFocus) el.remove(); });
  for (const t of v.page.texts) { if (t.id === keepFocus) continue; makeTextEl(v, t); }
}
export function makeTextEl(v, t) {
  const el = document.createElement('div'); el.className = 'tbox'; el.dataset.tid = t.id;
  try { el.contentEditable = 'plaintext-only'; } catch (e) { el.contentEditable = 'true'; }
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.spellcheck = true; el.textContent = t.v || '';
  styleTextEl(el, t);
  el.addEventListener('focus', () => {
    const cur = v.page.texts.find(x => x.id === t.id) || t;
    if (!el._before) el._before = snap(v.page);
    E.activeText = { el, t: cur, v };
    if (E.tool !== 'text') setTool('text');
  });
  el.addEventListener('input', () => { const cur = v.page.texts.find(x => x.id === t.id); if (cur) cur.v = el.innerText.replace(/\n$/, ''); markDirty(); });
  el.addEventListener('blur', () => finishText(v, el));
  el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); el.blur(); } e.stopPropagation(); });
  v.textLayer.appendChild(el);
  return el;
}
export function finishText(v, el) {
  const p = v.page, id = el.dataset.tid, t = p.texts.find(x => x.id === id);
  const before = el._before; el._before = null;
  if (E.activeText && E.activeText.el === el) E.activeText = null;
  if (t) { t.v = el.innerText.replace(/\n$/, ''); if (!t.v.trim()) { p.texts = p.texts.filter(x => x.id !== id); el.remove(); } }
  if (before) {
    const after = snap(p);
    if (JSON.stringify(before.texts) !== JSON.stringify(after.texts)) pushUndo({ k: 'page', id: p.id, before, after });
  }
}
export function commitActiveText() { const a = E.activeText; if (a && a.el) a.el.blur(); }
export function createTextBox(v, x, y) {
  const p = v.page;
  const before = snap(p);
  let w = Math.min(440, p.w - x - 16);
  if (w < 140) { w = Math.min(320, p.w - 32); x = Math.max(16, p.w - 16 - w); }
  const t = { id: uid(), x: Math.max(4, x - TEXT_PAD_X), y: clamp(y - SET.text.size * 0.75, 0, p.h - SET.text.size * 1.4), w, s: SET.text.size, c: SET.text.color, v: '' };
  p.texts = p.texts.concat(t);
  const el = makeTextEl(v, t);
  el._before = before;
  el.focus();
}
