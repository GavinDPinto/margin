// Wires up editor buttons, pointer/touch listeners and keyboard shortcuts.
import { icon } from '../core/icons.js';
import { $, clamp } from '../core/util.js';
import { E, closeNote, fitScale, redo, saveNote, sc, scheduleRerender, setScale, undo, updIndicator, zoomAround } from '../editor/editor.js';
import { addPage, bindToolbar, editorMenu, setTool } from '../editor/toolbar.js';
import { D, endDraw, onPointerDown, onPointerMove, onPointerUp } from '../input/pointer.js';
import { copySelection, currentView, pasteClip } from '../selection/clipboard.js';
import { pickAndInsertImages } from '../selection/images.js';
import { clearSelection, selAction } from '../selection/selection.js';
import { toast } from '../ui/dialogs.js';

export function bindEditor() {
  $('#ed-back').innerHTML = icon('back') + 'Notes';
  $('#ed-undo').innerHTML = icon('undo'); $('#ed-redo').innerHTML = icon('redo');
  $('#ed-addpage').innerHTML = icon('pageplus'); $('#ed-more').innerHTML = icon('more'); $('#ed-image').innerHTML = icon('image');
  $('#ed-image').addEventListener('click', pickAndInsertImages);
  $('#ed-more').setAttribute('data-popanchor', '');
  $('#ed-back').addEventListener('click', closeNote);
  $('#ed-undo').addEventListener('click', undo); $('#ed-redo').addEventListener('click', redo);
  $('#ed-addpage').addEventListener('click', addPage);
  $('#ed-more').addEventListener('click', e => editorMenu(e.currentTarget));
  $('#ed-title').addEventListener('input', e => { if (E.note) { E.note.title = e.target.value.trim() || 'Untitled'; E.dirty = true; clearTimeout(E.saveT); E.saveT = setTimeout(saveNote, 700); } });
  $('#ed-title').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  [$('#ed-undo'), $('#ed-redo'), $('#ed-addpage')].forEach(b => b.addEventListener('pointerdown', e => e.preventDefault()));
  bindToolbar();
  const s = sc();
  s.addEventListener('pointerdown', onPointerDown);
  s.addEventListener('pointermove', onPointerMove);
  s.addEventListener('pointerup', onPointerUp);
  s.addEventListener('pointercancel', onPointerUp);
  s.addEventListener('lostpointercapture', e => { if (D.active && e.pointerId === D.pid && e.pointerType !== 'touch') endDraw(null, true); });
  // stop iOS from scrolling / magnifying under the Pencil
  const stylusGuard = e => { if (E.tool === 'text' && !D.active) return; for (const t of e.changedTouches) if (t.touchType === 'stylus') { e.preventDefault(); return; } };
  s.addEventListener('touchstart', stylusGuard, { passive: false });
  s.addEventListener('touchmove', e => { if (e.target.closest && e.target.closest('.tbox') && !D.active) return; e.preventDefault(); }, { passive: false });
  s.addEventListener('scroll', () => { requestAnimationFrame(updIndicator); }, { passive: true });
  s.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomAround(E.s * Math.exp(-clamp(e.deltaY, -25, 25) * 0.012), e.clientX, e.clientY);
  }, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(n => document.addEventListener(n, e => e.preventDefault()));
  document.addEventListener('keydown', e => {
    if (!E.open) return;
    const typing = e.target.closest && e.target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])');
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); const r = sc().getBoundingClientRect(); zoomAround(E.s * 1.2, r.left + r.width / 2, r.top + r.height / 2); return; }
    if (mod && e.key === '-') { e.preventDefault(); const r = sc().getBoundingClientRect(); zoomAround(E.s / 1.2, r.left + r.width / 2, r.top + r.height / 2); return; }
    if (mod && e.key === '0') { e.preventDefault(); setScale(fitScale()); return; }
    if (mod && !typing && e.key.toLowerCase() === 'c' && E.sel) { e.preventDefault(); copySelection(); toast('Copied'); return; }
    if (mod && !typing && e.key.toLowerCase() === 'x' && E.sel) { e.preventDefault(); selAction('cut'); return; }
    if (mod && !typing && e.key.toLowerCase() === 'v' && E.clip) { clearTimeout(E.pasteT); E.pasteT = setTimeout(() => pasteClip(currentView()), 80); return; }
    if (typing || mod) return;
    const map = { p: 'pen', h: 'hl', e: 'eraser', l: 'lasso', t: 'text' };
    if (map[e.key.toLowerCase()]) { setTool(map[e.key.toLowerCase()]); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && E.sel) { e.preventDefault(); selAction('del'); return; }
    if (e.key === 'Escape') clearSelection();
  });
  window.addEventListener('resize', () => { if (E.open) { const ns = fitScale(); if (E.s < ns * 1.02 && E.s > ns * 0.6) setScale(ns); else scheduleRerender(); } });
}
