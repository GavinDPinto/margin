// Getting files in: destination picker, drag & drop, paste, share target, PDF/image → pages.
import { SET } from '../core/config.js';
import { icon } from '../core/icons.js';
import { DB } from '../core/storage.js';
import { $, PAGE_W, esc, now, uid } from '../core/util.js';
import { E, closeNote, openNote, pushUndo, saveNote, scrollToPage, syncViews } from '../editor/editor.js';
import { commitActiveText } from '../editor/text.js';
import { L, createNote, fmtDate, folderById, refreshLib } from '../library/library.js';
import { insertImages } from '../selection/images.js';
import { clearSelection } from '../selection/selection.js';
import { modal, progressBox, toast } from '../ui/dialogs.js';

/* ---------- getting files in: picker, drag & drop, paste, share target ---------- */
export const isImportable = f => !!f && (f.type === 'application/pdf' || /^image\//.test(f.type) || /\.(pdf|png|jpe?g|gif|webp|heic|heif)$/i.test(f.name || ''));
export const stripExt = n => (n || 'Imported').replace(/\.(pdf|png|jpe?g|heic|heif|webp|gif)$/i, '') || 'Imported';
export const folderLabel = id => id ? ((folderById(id) || {}).name || 'All Notes') : 'All Notes';
export function chooseDestination(files) {
  const what = files.length === 1 ? `“${files[0].name || 'file'}”` : `${files.length} files`;
  const notes = L.notes.slice().sort((a, b) => b.updated - a.updated);
  const body = document.createElement('div');
  body.innerHTML = `<button class="dest-new" data-new>${icon('plus')}<span><b>New note</b><small>in ${esc(folderLabel(L.cwd))}</small></span></button>
    <label class="lbl">Or add pages to an existing note</label>
    <input class="inp dest-q" type="search" placeholder="Search notes" autocomplete="off">
    <div class="dest-list"></div>`;
  let q = '';
  const draw = () => {
    const list = notes.filter(n => !q || (n.title || '').toLowerCase().includes(q));
    $('.dest-list', body).innerHTML = list.length ? list.map(n => `<button class="dest-row" data-id="${n.id}">${n.thumb ? `<img src="${n.thumb}" alt="">` : `<span class="pv pv-${n.template || 'lined'}"></span>`}<span class="dm"><b>${esc(n.title || 'Untitled')}</b><small>${esc(folderLabel(n.folderId))} · ${fmtDate(n.updated)}</small></span><span class="dest-add">Add</span></button>`).join('')
      : `<div class="muted" style="padding:14px">No matching notes</div>`;
  };
  draw();
  return modal({ title: `Add ${what}`, body, wide: true, buttons: [{ label: 'Cancel', value: null }], onOpen: (b, close) => {
    $('.dest-q', b).addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); draw(); });
    b.addEventListener('click', e => {
      if (e.target.closest('[data-new]')) close({ mode: 'new' });
      const r = e.target.closest('.dest-row'); if (r) close({ mode: 'existing', id: r.dataset.id });
    });
  } });
}
export let ingesting = false;
export const isPdfFile = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
export async function ingestFiles(fileList, opts = {}) {
  let files = [...fileList].filter(isImportable);
  if (opts.dest && opts.dest.mode === 'open' && E.open && !opts.asPages) {
    const imgs = files.filter(f => !isPdfFile(f)); files = files.filter(isPdfFile);
    if (imgs.length) await insertImages(imgs);
    if (!files.length) return;
  }
  if (!files.length) { toast('Margin can import PDFs and images'); return; }
  if (ingesting) return; ingesting = true;
  try {
    let dest = opts.dest;
    if (!dest) {
      L.notes = await DB.all('notes'); L.folders = await DB.all('folders');
      dest = L.notes.length ? await chooseDestination(files) : { mode: 'new' };
    }
    if (!dest) return;
    const intoOpen = E.open && (dest.mode === 'open' || (dest.mode === 'existing' && E.note && E.note.id === dest.id));
    const pg = progressBox(intoOpen || dest.mode === 'existing' ? 'Adding pages' : 'Importing');
    let pages = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i], pre = files.length > 1 ? `File ${i + 1} of ${files.length} · ` : '';
        pages = pages.concat(await fileToPages(f, (a, n) => pg.set(`${pre}page ${a} of ${n}`, (i + a / n) / files.length)));
      }
    } finally { pg.close(); }
    if (!pages.length) return;
    const blobs = pages.map(p => p.bg).filter(Boolean);
    const plural = `${pages.length} page${pages.length === 1 ? '' : 's'}`;
    if (intoOpen) { await insertIntoOpen(pages); toast(`Added ${plural}`); return; }
    if (E.open) await closeNote();
    if (dest.mode === 'new') {
      const meta = await createNote({ title: stripExt(files[0].name), template: SET.template, paper: SET.paper, pages, blobs });
      await refreshLib(); await openNote(meta.id); toast(`Created “${meta.title}”`);
    } else {
      const meta = await DB.get('notes', dest.id), rec = await DB.get('pages', dest.id);
      if (!meta) { toast('That note no longer exists'); return; }
      const existing = (rec && rec.pages) || [], at = existing.length;
      await DB.put('pages', { id: meta.id, pages: existing.concat(pages) });
      meta.blobs = [...(meta.blobs || []), ...blobs]; meta.updated = now(); await DB.put('notes', meta);
      await refreshLib(); await openNote(meta.id); scrollToPage(at);
      toast(`Added ${plural} to “${meta.title}”`);
    }
  } catch (e) {
    console.error(e);
    modal({ title: 'Couldn’t import', body: `<p>${esc(importErrorText(e))}</p>`, buttons: [{ label: 'OK', primary: true, value: true }] });
  } finally { ingesting = false; }
}
export async function insertIntoOpen(pages) {
  commitActiveText(); clearSelection();
  E.note.blobs = [...(E.note.blobs || []), ...pages.map(p => p.bg).filter(Boolean)];
  const at = Math.min(E.cur + 1, E.pages.length);
  const before = E.pages.slice(); E.pages.splice(at, 0, ...pages);
  pushUndo({ k: 'pages', before, after: E.pages.slice() }); syncViews(); await saveNote(); scrollToPage(at);
}
export async function pasteFromClipboard() {
  try {
    const items = await navigator.clipboard.read(); const files = [];
    for (const it of items) {
      const t = it.types.find(x => /^image\/|application\/pdf/.test(x));
      if (t) { const b = await it.getType(t); files.push(new File([b], t === 'application/pdf' ? 'Pasted PDF.pdf' : 'Pasted image.' + (t.split('/')[1] || 'png'), { type: t })); }
    }
    if (!files.length) { toast('Copy an image or PDF first, then paste'); return; }
    ingestFiles(files, E.open ? { dest: { mode: 'open' } } : {});
  } catch (e) { toast('Paste was blocked — try again and tap “Paste” when iOS asks'); }
}
export function bindDropAndPaste() {
  const ov = document.createElement('div'); ov.id = 'drop-ov'; ov.hidden = true; ov.innerHTML = '<span></span>'; document.body.appendChild(ov);
  const hasFiles = e => !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  let depth = 0, hoverCard = null;
  const setHover = c => { if (hoverCard === c) return; if (hoverCard) hoverCard.classList.remove('drop-hover'); hoverCard = c; if (c) c.classList.add('drop-hover'); label(); };
  const label = () => { $('span', ov).textContent = E.open ? 'Drop to add pages here' : hoverCard ? `Drop to add to “${$('.tname', hoverCard).textContent}”` : 'Drop to import — choose a new or existing note'; };
  const hide = () => { depth = 0; ov.hidden = true; setHover(null); };
  document.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; ov.hidden = false; label(); });
  document.addEventListener('dragover', e => {
    if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    setHover(!E.open && e.target.closest ? e.target.closest('.tile.note') : null);
  });
  document.addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) hide(); });
  document.addEventListener('drop', e => {
    if (!hasFiles(e)) return; e.preventDefault();
    const card = !E.open && e.target.closest ? e.target.closest('.tile.note') : null;
    const files = [...e.dataTransfer.files]; hide();
    ingestFiles(files, E.open ? { dest: { mode: 'open' } } : card ? { dest: { mode: 'existing', id: card.dataset.nid } } : {});
  });
  document.addEventListener('paste', e => {
    if (e.target.closest && e.target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return;
    const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter(isImportable);
    if (!files.length) return;
    clearTimeout(E.pasteT);
    e.preventDefault(); ingestFiles(files, E.open ? { dest: { mode: 'open' } } : {});
  });
}
export async function receiveSharedFiles() {
  const params = new URLSearchParams(location.search);
  if (!params.has('shared')) return;
  history.replaceState(null, '', location.pathname);
  try {
    const c = await caches.open('margin-share');
    const keys = (await c.keys()).sort((a, b) => a.url.localeCompare(b.url, undefined, { numeric: true }));
    const files = [];
    for (const k of keys) { const r = await c.match(k); const b = await r.blob(); files.push(new File([b], decodeURIComponent(r.headers.get('x-name') || 'Shared file'), { type: b.type })); await c.delete(k); }
    if (files.length) ingestFiles(files);
  } catch (e) { console.error(e); }
}
export function importErrorText(e) {
  const m = String(e && (e.message || e.name) || e);
  if (/password/i.test(m)) return 'This PDF is password-protected. Remove the password and try again.';
  if (/module|import|fetch|load/i.test(m)) return 'The PDF reader couldn’t load. Make sure the “lib” folder is next to index.html (see README).';
  return 'That file couldn’t be read. ' + m;
}

/* ---------- PDF / image import ---------- */
export let pdfjsP = null;
export function getPdfjs() {
  if (!pdfjsP) pdfjsP = import(new URL('lib/pdf.min.mjs', location.href).href).then(m => { m.GlobalWorkerOptions.workerSrc = new URL('lib/pdf.worker.min.mjs', location.href).href; return m; }).catch(e => { pdfjsP = null; throw e; });
  return pdfjsP;
}
export const canvasToBlob = (c, type, q) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('encode failed')), type, q));
export async function storeBgFromCanvas(c) {
  const blob = await canvasToBlob(c, 'image/jpeg', 0.88);
  const id = uid(); await DB.put('blobs', { id, type: 'image/jpeg', data: await blob.arrayBuffer() });
  return id;
}
export async function fileToPages(file, onProgress) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const out = [];
  if (isPdf) {
    const pdfjs = await getPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const n = doc.numPages;
    for (let i = 1; i <= n; i++) {
      onProgress && onProgress(i, n);
      const pg = await doc.getPage(i);
      const vp1 = pg.getViewport({ scale: 1 });
      const w = PAGE_W, h = Math.round(PAGE_W * vp1.height / vp1.width);
      const scale = Math.min(2000 / vp1.width, Math.sqrt(9e6 / (vp1.width * vp1.height)));
      const vp = pg.getViewport({ scale });
      const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const id = await storeBgFromCanvas(c);
      c.width = c.height = 0; pg.cleanup();
      out.push({ id: uid(), template: 'blank', paper: 'white', bg: id, w, h, strokes: [], texts: [] });
    }
    await doc.destroy();
  } else if (/^image\//.test(file.type) || /\.(png|jpe?g|gif|webp|heic)$/i.test(file.name)) {
    onProgress && onProgress(1, 1);
    const url = URL.createObjectURL(file);
    const img = new Image(); img.src = url;
    await img.decode().catch(() => new Promise((r, j) => { img.onload = r; img.onerror = () => j(new Error('unsupported image')); }));
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const s = Math.min(1, 2000 / iw, Math.sqrt(9e6 / (iw * ih)));
    const c = document.createElement('canvas'); c.width = Math.round(iw * s); c.height = Math.round(ih * s);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const id = await storeBgFromCanvas(c); c.width = c.height = 0;
    out.push({ id: uid(), template: 'blank', paper: 'white', bg: id, w: PAGE_W, h: Math.round(PAGE_W * ih / iw), strokes: [], texts: [] });
  } else throw new Error('Choose a PDF or an image file.');
  return out;
}
