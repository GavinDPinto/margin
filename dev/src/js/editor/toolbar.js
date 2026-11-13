// Tool bar (pens, colours, sizes), editor ⋯ menu and page operations.
import { HL_COLORS, PEN_COLORS, SET, SIZE_PRESETS, SIZE_RANGE, SPACING, saveSettings } from '../core/config.js';
import { icon } from '../core/icons.js';
import { $, $$, PAGE_H, PAGE_W, uid } from '../core/util.js';
import { E, anchorAt, fitScale, markDirty, pushUndo, renderPage, sc, scrollToPage, setScale, sizeView, snap, syncViews, undo } from '../editor/editor.js';
import { exportPdf } from '../editor/export-pdf.js';
import { commitActiveText, styleTextEl } from '../editor/text.js';
import { feedbackDialog } from '../feedback/feedback.js';
import { ingestFiles, pasteFromClipboard } from '../library/import.js';
import { L, newPage } from '../library/library.js';
import { currentView, pasteClip } from '../selection/clipboard.js';
import { pickAndInsertImages } from '../selection/images.js';
import { clearSelection } from '../selection/selection.js';
import { closePop, confirmBox, menu, modal, paperPicker, pickFiles, popover, rememberStyle, toast } from '../ui/dialogs.js';

/* ---------- toolbar ---------- */
export function toolCfg(t = E.tool) { return SET[t]; }
export function renderToolbar() {
  const t = E.tool;
  $('#tb-tools').innerHTML = [['pen', 'Pen (P)'], ['hl', 'Highlighter (H)'], ['eraser', 'Eraser (E)'], ['lasso', 'Lasso (L)'], ['text', 'Text (T)']]
    .map(([id, title]) => {
      const dot = id === 'pen' || id === 'hl' ? `<span class="dot" style="background:${SET[id].color}"></span>` : '';
      return `<button class="tool ${t === id ? 'on' : ''}" data-tool="${id}" title="${title}" aria-label="${title}">${icon(id)}${dot}</button>`;
    }).join('');
  const cfg = toolCfg();
  const hasColor = t === 'pen' || t === 'hl' || t === 'text';
  const hasSize = t !== 'lasso';
  $('#tb-colors').hidden = $('#tb-div2').hidden = !hasColor;
  $('#tb-sizes').hidden = $('#tb-div3').hidden = !hasSize;
  if (hasColor) {
    const pal = t === 'hl' ? HL_COLORS : PEN_COLORS;
    const isCustom = !pal.includes(cfg.color);
    $('#tb-colors').innerHTML = pal.map(c => `<button class="sw ${c === cfg.color ? 'on' : ''}" data-color="${c}" aria-label="Colour ${c}"><i style="background:${c}"></i></button>`).join('')
      + `<button class="sw custom ${isCustom ? 'on' : ''}" data-color="custom" title="Custom colour" aria-label="Custom colour"><i ${isCustom ? `style="background:${cfg.color}"` : ''}></i></button>`;
  }
  if (hasSize) {
    const pre = SIZE_PRESETS[t];
    $('#tb-sizes').innerHTML = pre.map((s, i) => {
      const on = Math.abs(cfg.size - s) < 0.01 ? 'on' : '';
      if (t === 'text') return `<button class="sz tx ${on}" data-size="${s}" style="font-size:${11 + i * 4}px">A</button>`;
      if (t === 'eraser') { const d = 7 + i * 6; return `<button class="sz er ${on}" data-size="${s}"><b style="width:${d}px;height:${d}px"></b></button>`; }
      const d = t === 'hl' ? 6 + i * 5 : 3 + i * 3.5;
      return `<button class="sz ${on}" data-size="${s}"><b style="width:${d}px;height:${d}px;${t === 'hl' ? `background:${cfg.color};opacity:.8;border-radius:3px` : `background:${t === 'pen' ? cfg.color : '#2c2c2e'}`}"></b></button>`;
    }).join('') + `<button class="szval" data-act="size" data-popanchor title="Exact size">${icon('sliders')}${fmtSize(cfg.size)}</button>`;
  }
  let o = '';
  const shp = `<button class="shp ${SET.shapes ? 'on' : ''}" data-act="shapes" aria-pressed="${SET.shapes ? 'true' : 'false'}" title="Draw a line, rectangle or ellipse and hold still at the end to straighten it">${icon('shapes')}Hold to snap shapes</button>`;
  const scr = `<button class="shp ${SET.scribble ? 'on' : ''}" data-act="scribble" aria-pressed="${SET.scribble ? 'true' : 'false'}" title="Scribble back and forth over ink with the pen to erase it">${icon('scribble')}Scribble to erase</button>`;
  if (t === 'pen') o = `<div class="seg"><button data-kind="fountain" class="${cfg.kind !== 'ball' ? 'on' : ''}">Fountain</button><button data-kind="ball" class="${cfg.kind === 'ball' ? 'on' : ''}">Ballpoint</button></div>${shp}${scr}`;
  else if (t === 'eraser') o = `<div class="seg"><button data-emode="partial" class="${cfg.mode !== 'stroke' ? 'on' : ''}">Precise</button><button data-emode="stroke" class="${cfg.mode === 'stroke' ? 'on' : ''}">Whole stroke</button></div>`;
  else if (t === 'lasso') { const rect = cfg.mode === 'rect'; o = `<div class="seg"><button data-lmode="free" class="${rect ? '' : 'on'}">Freeform</button><button data-lmode="rect" class="${rect ? 'on' : ''}">Rectangle</button></div><span class="hint">${rect ? 'Drag corner to corner' : 'Circle'} or tap to select · drag to move · tap empty space to paste</span>`; }
  else if (t === 'text') o = `<span class="hint">Tap the page to type</span>`;
  else if (t === 'hl') o = `${shp}<span class="hint">Highlights sit under your ink</span>`;
  $('#tb-opts').innerHTML = o;
}
export const fmtSize = s => (s < 10 ? (Math.round(s * 10) / 10).toFixed(1) : Math.round(s)) + '';
export function setTool(t) {
  if (t !== 'lasso') clearSelection();
  if (t !== 'text') { commitActiveText(); if (document.activeElement && document.activeElement.classList.contains('tbox')) document.activeElement.blur(); }
  E.tool = t; SET.tool = t; saveSettings();
  $('#editor').classList.toggle('tool-text', t === 'text');
  renderToolbar();
}
export function applyToActiveText() {
  const a = E.activeText; if (!a) return;
  a.t.c = SET.text.color; a.t.s = SET.text.size; styleTextEl(a.el, a.t); markDirty();
}
export function openColorPicker(anchor) {
  const t = E.tool, cfg = toolCfg(), inp = $('#color-input');
  const r = anchor.getBoundingClientRect();
  inp.style.left = r.left + 'px'; inp.style.top = r.bottom + 'px';
  inp.value = /^#[0-9a-f]{6}$/i.test(cfg.custom) ? cfg.custom : '#8a5a2b';
  inp.oninput = () => { cfg.custom = inp.value; cfg.color = inp.value; saveSettings(); renderToolbar(); if (t === 'text') applyToActiveText(); };
  inp.onchange = inp.oninput;
  // tap again on an active custom swatch -> picker; first tap selects saved custom colour
  if (cfg.color !== cfg.custom) { cfg.color = cfg.custom; saveSettings(); renderToolbar(); if (t === 'text') applyToActiveText(); }
  try { inp.showPicker ? inp.showPicker() : inp.click(); } catch (e) { inp.click(); }
}
export function sizePopover(anchor) {
  const t = E.tool, cfg = toolCfg(), [mn, mx, st] = SIZE_RANGE[t];
  const p = popover(anchor, `<div class="slider"><input type="range" min="${mn}" max="${mx}" step="${st}" value="${cfg.size}"><output>${fmtSize(cfg.size)}</output></div>`);
  const r = $('input', p), out = $('output', p);
  r.addEventListener('input', () => { cfg.size = parseFloat(r.value); out.textContent = fmtSize(cfg.size); saveSettings(); if (t === 'text') applyToActiveText(); const b = $('#tb-sizes .szval'); if (b) b.innerHTML = icon('sliders') + fmtSize(cfg.size); $$('#tb-sizes .sz').forEach(x => x.classList.toggle('on', Math.abs(parseFloat(x.dataset.size) - cfg.size) < 0.01)); });
}
export function bindToolbar() {
  const tb = $('#toolbar');
  tb.addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault(); }); // keep text focus
  tb.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const cfg = toolCfg();
    if (b.dataset.tool) {
      if (b.dataset.tool === E.tool && (E.tool === 'pen' || E.tool === 'hl')) { quickPalette(b); return; }
      setTool(b.dataset.tool); return;
    }
    if (b.dataset.color) {
      if (b.dataset.color === 'custom') { openColorPicker(b); return; }
      cfg.color = b.dataset.color; saveSettings(); renderToolbar(); if (E.tool === 'text') applyToActiveText(); return;
    }
    if (b.dataset.size) { cfg.size = parseFloat(b.dataset.size); saveSettings(); renderToolbar(); if (E.tool === 'text') applyToActiveText(); return; }
    if (b.dataset.act === 'size') { sizePopover(b); return; }
    if (b.dataset.act === 'scribble') { SET.scribble = !SET.scribble; saveSettings(); renderToolbar(); toast(SET.scribble ? 'Scribble to erase on — scribble over ink with the pen to erase it' : 'Scribble to erase off'); return; }
    if (b.dataset.act === 'shapes') { SET.shapes = !SET.shapes; saveSettings(); renderToolbar(); toast(SET.shapes ? 'Shapes on — draw, then hold still to straighten' : 'Shape snapping off'); return; }
    if (b.dataset.kind) { cfg.kind = b.dataset.kind; saveSettings(); renderToolbar(); return; }
    if (b.dataset.emode) { cfg.mode = b.dataset.emode; saveSettings(); renderToolbar(); return; }
    if (b.dataset.lmode) { cfg.mode = b.dataset.lmode; saveSettings(); renderToolbar(); }
  });
}
export function quickPalette(anchor) {
  const t = E.tool, pal = t === 'hl' ? HL_COLORS : PEN_COLORS, cfg = toolCfg();
  const extra = t === 'hl' ? ['#fff176', '#c5f27a', '#9ff0e6', '#ffc1e0', '#ffd6a5', '#d9ccff'] : ['#5b5b60', '#0a7ea4', '#b0005b', '#5f7d1f', '#8b4513', '#c9a400'];
  const p = popover(anchor, `<div class="swgrid">${[...pal, ...extra].map(c => `<button class="sw ${c === cfg.color ? 'on' : ''}" data-c="${c}"><i style="background:${c}"></i></button>`).join('')}</div>`);
  p.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; cfg.color = cfg.custom = b.dataset.c; saveSettings(); renderToolbar(); closePop(); });
}

/* ---------- editor menu ---------- */
export function editorMenu(anchor) {
  const cp = E.pages[E.cur];
  menu(anchor, [
    { label: 'Page style…', icon: 'page', fn: pageStyleDialog },
    { label: 'Insert image…', icon: 'image', fn: pickAndInsertImages },
    { label: 'Insert PDF pages…', icon: 'import', fn: insertFile },
    ...(E.clip ? [{ label: 'Paste selection', icon: 'paste', fn: () => pasteClip(currentView()) }] : []),
    { label: 'Paste image or PDF', icon: 'copy', fn: pasteFromClipboard },
    { label: 'Duplicate page', icon: 'dup', fn: duplicatePage },
    { label: 'Delete page', icon: 'trash', danger: true, fn: deletePage },
    '-',
    { label: 'Fit to width', icon: 'fit', fn: () => { const a = anchorAt(innerWidth / 2, sc().getBoundingClientRect().top + 10); setScale(fitScale()); if (a) sc().scrollTop = a.v.el.offsetTop + a.y * E.s - 10; } },
    { label: 'Draw with finger', icon: 'finger', right: SET.fingerDraw ? 'On' : 'Off', fn: () => { SET.fingerDraw = !SET.fingerDraw; saveSettings(); toast(SET.fingerDraw ? 'Finger drawing on — use two fingers to scroll' : 'Finger drawing off — fingers scroll, Pencil draws'); } },
    '-',
    { label: 'Export as PDF', icon: 'share', fn: () => { commitActiveText(); exportPdf(E.pages, E.note.title); } },
    '-',
    { label: 'Send feedback', icon: 'feedback', fn: feedbackDialog },
  ], { alignRight: true });
  void cp;
}
export function addPage() {
  commitActiveText(); clearSelection();
  const cur = E.pages[E.cur];
  const tpl = cur && !cur.bg ? cur.template : (E.note.template || SET.template);
  const paper = cur && !cur.bg ? cur.paper : (E.note.paper || SET.paper);
  const np = newPage(tpl, paper, PAGE_W, PAGE_H, cur && !cur.bg ? { spacing: cur.spacing, ink: cur.ink } : { spacing: E.note.spacing, ink: E.note.ink });
  const before = E.pages.slice();
  E.pages.splice(E.cur + 1, 0, np);
  pushUndo({ k: 'pages', before, after: E.pages.slice() });
  syncViews(); scrollToPage(E.cur + 1);
}
export function duplicatePage() {
  const cur = E.pages[E.cur]; if (!cur) return;
  const np = { ...cur, id: uid(), strokes: cur.strokes.slice(), texts: cur.texts.map(t => ({ ...t, id: uid() })), images: (cur.images || []).map(im => ({ ...im, id: uid() })) };
  const before = E.pages.slice(); E.pages.splice(E.cur + 1, 0, np);
  pushUndo({ k: 'pages', before, after: E.pages.slice() }); syncViews(); scrollToPage(E.cur + 1); toast('Page duplicated');
}
export async function deletePage() {
  if (E.pages.length <= 1) { toast('A note needs at least one page'); return; }
  const i = E.cur;
  if (!await confirmBox('Delete page?', `Page ${i + 1} will be removed. You can undo this.`)) return;
  clearSelection(); commitActiveText();
  const before = E.pages.slice(); E.pages.splice(i, 1);
  pushUndo({ k: 'pages', before, after: E.pages.slice() }); syncViews(); scrollToPage(Math.min(i, E.pages.length - 1));
}
export async function pageStyleDialog() {
  const cur = E.pages[E.cur];
  const base = cur && !cur.bg ? cur : { template: E.note.template || SET.template, paper: cur ? cur.paper : 'white', spacing: E.note.spacing, ink: E.note.ink };
  const sp = { ...SET.spacing }; if (base.spacing && SPACING[base.template]) sp[base.template] = base.spacing;
  const pp = paperPicker({ tpl: base.template, paper: base.paper, ink: base.ink || 'normal', spacing: sp });
  const body = document.createElement('div'); body.appendChild(pp.el);
  if (E.pages.some(p => p.bg)) { const n = document.createElement('p'); n.className = 'muted'; n.style.marginTop = '14px'; n.textContent = 'Imported PDF pages keep their own content.'; body.appendChild(n); }
  const r = await modal({ title: 'Page style', body, wide: true, buttons: [{ label: 'Cancel', value: null }, { label: 'This page', value: () => ({ ...pp.get(), all: false }) }, { label: 'All pages', primary: true, value: () => ({ ...pp.get(), all: true }) }] });
  if (!r) return;
  const targets = r.all ? E.pages : [cur];
  const list = [];
  for (const p of targets) {
    const before = snap(p);
    if (!p.bg) { p.template = r.tpl; p.spacing = r.spacing; p.ink = r.ink; }
    p.paper = r.paper;
    list.push({ k: 'page', id: p.id, before, after: snap(p) });
    const v = E.views.get(p.id); if (v) { sizeView(v); if (v.canvas) renderPage(v); }
  }
  if (r.all) { E.note.template = r.tpl; E.note.paper = r.paper; E.note.spacing = r.spacing; E.note.ink = r.ink; }
  rememberStyle(r);
  pushUndo({ k: 'multi', list });
}
export async function insertFile() {
  const files = await pickFiles($('#file-pdf')); if (!files.length) return;
  ingestFiles(files, { dest: { mode: 'open' }, asPages: true });
}
