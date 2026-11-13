// Library screen: folders, notes grid, search, sort, note/folder menus.
import { FOLDER_COLORS, PAPERS, SET, saveSettings } from '../core/config.js';
import { icon } from '../core/icons.js';
import { DB } from '../core/storage.js';
import { $, PAGE_H, PAGE_W, esc, now, uid } from '../core/util.js';
import { openNote } from '../editor/editor.js';
import { exportPdf } from '../editor/export-pdf.js';
import { feedbackDialog } from '../feedback/feedback.js';
import { ingestFiles, pasteFromClipboard } from '../library/import.js';
import { settingsDialog } from '../settings/settings.js';
import { askText, confirmBox, menu, modal, paperPicker, pickFiles, rememberStyle, toast } from '../ui/dialogs.js';

/* =====================================================================
   LIBRARY
   ===================================================================== */
export const L = { cwd: null, q: '', folders: [], notes: [] };

export async function refreshLib() {
  L.folders = await DB.all('folders');
  L.notes = await DB.all('notes');
  if (L.cwd && !L.folders.find(f => f.id === L.cwd)) L.cwd = null;
  renderLib();
}
export const folderById = id => L.folders.find(f => f.id === id);
export function folderPath(id) { const out = []; let f = folderById(id), guard = 0; while (f && guard++ < 50) { out.unshift(f); f = folderById(f.parentId); } return out; }
export function descendants(fid) { const out = []; const walk = id => L.folders.filter(f => f.parentId === id).forEach(f => { out.push(f); walk(f.id); }); walk(fid); return out; }
export function fmtDate(t) {
  const d = new Date(t), n = new Date();
  if (d.toDateString() === n.toDateString()) return 'Today ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' });
}
export function sortNotes(arr) {
  const s = SET.sort;
  return arr.slice().sort((a, b) => s === 'name' ? a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) : s === 'created' ? b.created - a.created : b.updated - a.updated);
}

export function renderLib() {
  // crumbs
  const cr = $('#crumbs');
  if (L.q) cr.innerHTML = `<button data-crumb="">Search results</button>`;
  else {
    const path = folderPath(L.cwd);
    let h = `<button data-crumb="" class="${path.length ? 'up' : ''}">All Notes</button>`;
    path.forEach((f, i) => { h += `<span class="chev">›</span><button data-crumb="${f.id}" class="${i < path.length - 1 ? 'up' : ''}">${esc(f.name)}</button>`; });
    cr.innerHTML = h;
  }
  const g = $('#grid');
  let folders, notes;
  if (L.q) {
    const q = L.q.toLowerCase();
    folders = L.folders.filter(f => f.name.toLowerCase().includes(q));
    notes = L.notes.filter(n => (n.title || '').toLowerCase().includes(q));
  } else {
    folders = L.folders.filter(f => (f.parentId || null) === L.cwd);
    notes = L.notes.filter(n => (n.folderId || null) === L.cwd);
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  notes = sortNotes(notes);
  let h = '';
  if (folders.length) {
    h += `<div class="sec-h">Folders</div><div class="tiles folders">` + folders.map(f => {
      const nc = L.notes.filter(n => n.folderId === f.id).length, fc = L.folders.filter(x => x.parentId === f.id).length;
      const sub = [nc ? `${nc} note${nc > 1 ? 's' : ''}` : '', fc ? `${fc} folder${fc > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') || 'Empty';
      return `<div class="tile folder" data-fid="${f.id}"><div class="ficon" style="background:${f.color}1f;color:${f.color}">${icon('folder')}</div><div class="tmeta"><div class="tname">${esc(f.name)}</div><div class="tsub">${sub}</div></div><button class="more" data-fmenu="${f.id}" data-popanchor aria-label="Folder options">${icon('more')}</button></div>`;
    }).join('') + `</div>`;
  }
  if (notes.length) {
    h += `<div class="sec-h">${folders.length ? 'Notes' : (L.q ? 'Notes' : 'Notes')}</div><div class="tiles">` + notes.map(n => {
      const where = L.q && n.folderId ? ` · ${esc((folderById(n.folderId) || {}).name || '')}` : '';
      const th = n.thumb ? `<img src="${n.thumb}" alt="" loading="lazy">` : `<div class="pv pv-${n.template || 'lined'}" style="width:100%;height:100%;background-color:${(PAPERS[n.paper] || PAPERS.white)[0]}"></div>`;
      return `<div class="tile note" data-nid="${n.id}"><div class="thumb">${th}</div><div class="tmeta"><div class="tname">${esc(n.title || 'Untitled')}</div><div class="tsub">${fmtDate(n.updated)}${where}</div></div><button class="more" data-nmenu="${n.id}" data-popanchor aria-label="Note options">${icon('more')}</button></div>`;
    }).join('') + `</div>`;
  }
  if (!folders.length && !notes.length) {
    h = L.q ? `<div class="empty"><div class="big">No matches</div>Nothing found for “${esc(L.q)}”.</div>`
      : `<div class="empty"><div class="big">${L.cwd ? 'This folder is empty' : 'No notes yet'}</div>Create a note, add a folder, or import a PDF to mark up.<br><button class="btn primary" data-act="new-note">${icon('plus')}New Note</button></div>`;
  }
  g.innerHTML = h;
}

export function bindLibrary() {
  $('#btn-settings').innerHTML = icon('gear');
  $('#btn-feedback').innerHTML = icon('feedback');
  $('#btn-feedback').addEventListener('click', () => feedbackDialog());
  $('#btn-new-folder').innerHTML = icon('folderplus') + '<span>New Folder</span>';
  $('#btn-import').innerHTML = icon('import') + '<span>Import</span>';
  $('#btn-new-note').innerHTML = icon('plus') + '<span>New Note</span>';
  $('#sort').value = SET.sort;
  $('#sort').addEventListener('change', e => { SET.sort = e.target.value; saveSettings(); renderLib(); });
  $('#search').addEventListener('input', e => { L.q = e.target.value.trim(); renderLib(); });
  $('#btn-new-folder').addEventListener('click', () => newFolderDialog());
  $('#btn-new-note').addEventListener('click', () => newNoteDialog());
  $('#btn-import').setAttribute('data-popanchor', '');
  $('#btn-import').addEventListener('click', e => menu(e.currentTarget, [
    { label: 'Choose from Files…', icon: 'import', fn: importToNewNote },
    { label: 'Paste image or PDF', icon: 'copy', fn: pasteFromClipboard },
  ]));
  $('#btn-settings').addEventListener('click', () => settingsDialog());
  $('#crumbs').addEventListener('click', e => { const b = e.target.closest('[data-crumb]'); if (!b) return; if (L.q) { L.q = ''; $('#search').value = ''; } L.cwd = b.dataset.crumb || null; renderLib(); });
  $('#grid').addEventListener('click', e => {
    const fm = e.target.closest('[data-fmenu]'), nm = e.target.closest('[data-nmenu]');
    if (fm) { e.stopPropagation(); folderMenu(fm, fm.dataset.fmenu); return; }
    if (nm) { e.stopPropagation(); noteMenu(nm, nm.dataset.nmenu); return; }
    if (e.target.closest('[data-act="new-note"]')) { newNoteDialog(); return; }
    const f = e.target.closest('[data-fid]'); if (f) { L.cwd = f.dataset.fid; L.q = ''; $('#search').value = ''; renderLib(); $('#grid').scrollTop = 0; return; }
    const n = e.target.closest('[data-nid]'); if (n) openNote(n.dataset.nid);
  });
}

export async function newFolderDialog(existing) {
  let color = existing ? existing.color : FOLDER_COLORS[(L.folders.length) % FOLDER_COLORS.length];
  const body = document.createElement('div');
  const draw = () => { body.innerHTML = `<input class="inp" type="text" placeholder="Folder name" value="${esc(existing ? existing.name : '')}" autocomplete="off"><label class="lbl">Colour</label><div class="chips">${FOLDER_COLORS.map(c => `<button class="chip dotonly ${c === color ? 'on' : ''}" data-c="${c}"><i style="background:${c}"></i></button>`).join('')}</div>`; };
  draw();
  body.addEventListener('click', e => { const c = e.target.closest('[data-c]'); if (!c) return; const v = $('.inp', body).value; color = c.dataset.c; draw(); $('.inp', body).value = v; });
  const name = await modal({
    title: existing ? 'Edit folder' : 'New folder', body,
    buttons: [{ label: 'Cancel', value: null }, { label: existing ? 'Save' : 'Create', primary: true, value: b => $('.inp', b).value.trim() || false }],
    onOpen: b => $('.inp', b).focus(),
  });
  if (!name) return;
  if (existing) { existing.name = name; existing.color = color; await DB.put('folders', existing); }
  else await DB.put('folders', { id: uid(), name, color, parentId: L.cwd, created: now() });
  await refreshLib();
}

export async function pickFolder(title, disabledIds = new Set(), current = null) {
  const list = [{ id: null, name: 'All Notes', depth: 0 }];
  const walk = (pid, d) => L.folders.filter(f => (f.parentId || null) === pid).sort((a, b) => a.name.localeCompare(b.name)).forEach(f => { list.push({ id: f.id, name: f.name, depth: d, color: f.color }); walk(f.id, d + 1); });
  walk(null, 1);
  let sel = current;
  const body = document.createElement('div'); body.className = 'radio-list';
  const draw = () => { body.innerHTML = list.map(f => `<button data-id="${f.id || ''}" class="${(f.id || null) === sel ? 'on' : ''}" ${disabledIds.has(f.id) ? 'disabled' : ''} style="padding-left:${10 + f.depth * 18}px"><span style="color:${f.color || 'var(--muted)'}">${icon('folder')}</span>${esc(f.name)}</button>`).join(''); };
  draw();
  body.addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (!b || b.disabled) return; sel = b.dataset.id || null; draw(); });
  const r = await modal({ title, body, buttons: [{ label: 'Cancel', value: null }, { label: 'Move here', primary: true, value: () => ({ id: sel }) }] });
  return r;
}

export function folderMenu(anchor, fid) {
  const f = folderById(fid); if (!f) return;
  menu(anchor, [
    { label: 'Rename & colour', icon: 'rename', fn: () => newFolderDialog(f) },
    { label: 'Move to…', icon: 'move', fn: async () => {
      const dis = new Set([f.id, ...descendants(f.id).map(d => d.id)]);
      const r = await pickFolder(`Move “${f.name}”`, dis, f.parentId || null); if (!r) return;
      f.parentId = r.id; await DB.put('folders', f); await refreshLib(); toast('Folder moved');
    } },
    '-',
    { label: 'Delete folder', icon: 'trash', danger: true, fn: async () => {
      const subs = descendants(f.id), ids = new Set([f.id, ...subs.map(s => s.id)]);
      const notes = L.notes.filter(n => ids.has(n.folderId));
      const ok = await confirmBox('Delete folder?', `“${f.name}”${subs.length ? `, ${subs.length} subfolder${subs.length > 1 ? 's' : ''}` : ''} and ${notes.length} note${notes.length === 1 ? '' : 's'} inside will be permanently deleted.`);
      if (!ok) return;
      for (const n of notes) await deleteNoteData(n.id);
      for (const id of ids) await DB.del('folders', id);
      await refreshLib(); toast('Folder deleted');
    } },
  ], { alignRight: true });
}

export function noteMenu(anchor, nid) {
  const n = L.notes.find(x => x.id === nid); if (!n) return;
  menu(anchor, [
    { label: 'Rename', icon: 'rename', fn: async () => { const t = await askText('Rename note', n.title); if (!t) return; n.title = t; await DB.put('notes', n); renderLib(); } },
    { label: 'Move to…', icon: 'move', fn: async () => { const r = await pickFolder(`Move “${n.title}”`, new Set(), n.folderId || null); if (!r) return; n.folderId = r.id; await DB.put('notes', n); await refreshLib(); toast('Note moved'); } },
    { label: 'Duplicate', icon: 'dup', fn: async () => { await duplicateNote(n.id); await refreshLib(); toast('Note duplicated'); } },
    { label: 'Export as PDF', icon: 'share', fn: async () => { const rec = await DB.get('pages', n.id); exportPdf(rec ? rec.pages : [], n.title); } },
    '-',
    { label: 'Delete note', icon: 'trash', danger: true, fn: async () => { if (!await confirmBox('Delete note?', `“${n.title}” will be permanently deleted.`)) return; await deleteNoteData(n.id); await refreshLib(); toast('Note deleted'); } },
  ], { alignRight: true });
}

export function newPage(template, paper, w = PAGE_W, h = PAGE_H, style = {}) { const t = template || 'lined'; return { id: uid(), template: t, paper: paper || 'white', spacing: style.spacing || (SET.spacing && SET.spacing[t]) || null, ink: style.ink || SET.ink || 'normal', bg: null, w, h, strokes: [], texts: [] }; }

export async function createNote({ title, template, paper, pages, blobs, spacing, ink }) {
  const t = now();
  const meta = { id: uid(), title: title || 'Untitled', folderId: L.cwd, created: t, updated: t, template, paper, spacing, ink, blobs: blobs || [], thumb: null };
  await DB.put('pages', { id: meta.id, pages: pages || [newPage(template, paper, PAGE_W, PAGE_H, { spacing, ink })] });
  await DB.put('notes', meta);
  return meta;
}

export async function newNoteDialog() {
  const pp = paperPicker({ tpl: SET.template, paper: SET.paper, ink: SET.ink, spacing: SET.spacing });
  const body = document.createElement('div');
  body.innerHTML = `<label class="lbl">Title</label><input class="inp" type="text" placeholder="Untitled" autocomplete="off">`;
  body.appendChild(pp.el);
  const r = await modal({
    title: 'New note', body, wide: true,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Create', primary: true, value: b => ({ title: $('.inp', b).value.trim(), ...pp.get() }) }],
    onOpen: b => $('.inp', b).focus(),
  });
  if (!r) return;
  rememberStyle(r);
  const meta = await createNote({ title: r.title || defaultTitle(), template: r.tpl, paper: r.paper, spacing: r.spacing, ink: r.ink });
  await refreshLib();
  openNote(meta.id);
}
export function defaultTitle() { const d = new Date(); return 'Note ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }

export async function deleteNoteData(id) {
  const meta = await DB.get('notes', id), rec = await DB.get('pages', id);
  const blobs = new Set((meta && meta.blobs) || []);
  if (rec) rec.pages.forEach(p => { if (p.bg) blobs.add(p.bg); (p.images || []).forEach(im => blobs.add(im.b)); });
  for (const b of blobs) await DB.del('blobs', b);
  await DB.del('pages', id); await DB.del('notes', id);
}
export async function duplicateNote(id) {
  const meta = await DB.get('notes', id), rec = await DB.get('pages', id);
  if (!meta) return;
  const map = new Map(), newBlobs = [];
  const pages = (rec ? rec.pages : []).map(p => ({ ...p, id: uid(), strokes: p.strokes.slice(), texts: (p.texts || []).map(t => ({ ...t, id: uid() })), images: (p.images || []).map(im => ({ ...im, id: uid() })) }));
  const remap = async id => {
    if (!map.has(id)) { const b = await DB.get('blobs', id); if (b) { const nid = uid(); await DB.put('blobs', { ...b, id: nid }); map.set(id, nid); newBlobs.push(nid); } }
    return map.get(id) || id;
  };
  for (const p of pages) { if (p.bg) p.bg = await remap(p.bg); for (const im of p.images) im.b = await remap(im.b); }
  const t = now();
  const m2 = { ...meta, id: uid(), title: meta.title + ' copy', created: t, updated: t, blobs: newBlobs };
  await DB.put('pages', { id: m2.id, pages }); await DB.put('notes', m2);
}

export async function importToNewNote() {
  const files = await pickFiles($('#file-pdf')); if (!files.length) return;
  ingestFiles(files);
}
