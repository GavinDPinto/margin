// Settings dialog, backup export / restore.
import { SET, saveSettings } from '../core/config.js';
import { icon } from '../core/icons.js';
import { DB } from '../core/storage.js';
import { $, $$, now } from '../core/util.js';
import { APP_VERSION } from '../core/version.js';
import { E, live } from '../editor/editor.js';
import { refreshLib } from '../library/library.js';
import { confirmBox, fileReadyBox, modal, pickFile, progressBox, toast } from '../ui/dialogs.js';

/* =====================================================================
   SETTINGS + BACKUP
   ===================================================================== */
export function abToB64(buf) { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
export function b64ToAb(b) { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; }
export async function settingsDialog() {
  let est = '';
  try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); est = `${(e.usage / 1048576).toFixed(1)} MB used on this device`; } } catch (e) {}
  const body = document.createElement('div');
  const draw = () => {
    body.innerHTML = `
      <div class="switch-row"><div><div class="t">Draw with finger</div><div class="d">Off: Pencil draws, fingers scroll &amp; pinch. Turns off automatically when a Pencil is used.</div></div><button class="switch ${SET.fingerDraw ? 'on' : ''}" data-s="finger" aria-label="Draw with finger"></button></div>
      <div class="switch-row"><div><div class="t">Back up everything</div><div class="d">Save all folders, notes and PDFs to one file.</div></div><button class="btn" data-s="export">${icon('download')}Export</button></div>
      <div class="switch-row"><div><div class="t">Restore a backup</div><div class="d">Adds notes from a backup file.</div></div><button class="btn" data-s="import">${icon('upload')}Import</button></div>
      <p class="muted" style="margin-top:12px">${DB.mem ? '<b style="color:var(--danger)">Storage is unavailable in this browser — notes will be lost when the page closes.</b><br>' : ''}${est ? est + '. ' : ''}Margin version ${APP_VERSION}.<br>Notes live only in this browser on this device. On iPad, add Margin to your Home Screen and export a backup now and then.</p>`;
  };
  draw();
  body.addEventListener('click', async e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    if (b.dataset.s === 'finger') { SET.fingerDraw = !SET.fingerDraw; if (SET.fingerDraw) E.penSeen = false; saveSettings(); draw(); }
    if (b.dataset.s === 'export') exportBackup();
    if (b.dataset.s === 'import') importBackup();
  });
  modal({ title: 'Settings', body, wide: true, buttons: [{ label: 'Done', primary: true, value: true }] });
}
export async function exportBackup() {
  const pg = progressBox('Creating backup');
  try {
    const folders = await DB.all('folders'), notes = await DB.all('notes'), pages = await DB.all('pages'), blobs = await DB.all('blobs');
    pg.set('Packing files…', 0.5);
    const data = { app: 'margin', version: 1, exported: now(), folders, notes, pages, blobs: blobs.map(b => ({ id: b.id, type: b.type, data: abToB64(b.data) })) };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    pg.close();
    const d = new Date();
    fileReadyBox(blob, `margin-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`, 'Backup');
  } catch (e) { pg.close(); toast('Backup failed: ' + (e.message || e)); }
}
export async function importBackup() {
  const file = await pickFile($('#file-backup')); if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); if (data.app !== 'margin') throw new Error('not a Margin backup'); }
  catch (e) { toast('That isn’t a Margin backup file'); return; }
  if (!await confirmBox('Restore backup?', `Adds ${data.notes.length} note${data.notes.length === 1 ? '' : 's'} and ${data.folders.length} folder${data.folders.length === 1 ? '' : 's'}. Notes already here with the same ID will be replaced.`, 'Restore', false)) return;
  const pg = progressBox('Restoring');
  try {
    const total = data.blobs.length + data.notes.length + data.pages.length + data.folders.length; let i = 0;
    const tick = () => { i++; if (i % 10 === 0) pg.set(`${i} of ${total}`, i / total); };
    for (const b of data.blobs) { await DB.put('blobs', { id: b.id, type: b.type, data: b64ToAb(b.data) }); tick(); }
    for (const f of data.folders) { await DB.put('folders', f); tick(); }
    for (const p of data.pages) { await DB.put('pages', p); tick(); }
    for (const n of data.notes) { await DB.put('notes', n); tick(); }
    pg.close(); closeAllModals(); await refreshLib(); toast('Backup restored');
  } catch (e) { pg.close(); toast('Restore failed: ' + (e.message || e)); }
}
export function closeAllModals() { $$('.modal-back').forEach(m => m.remove()); }
