// Entry point: opens storage, wires up the app.
import { SET } from './core/config.js';
import { DB } from './core/storage.js';
import { $ } from './core/util.js';
import { bindEditor } from './editor/bindings.js';
import { E, closeNote, openNote, saveNote } from './editor/editor.js';
import { buildPdf, exportPdf } from './editor/export-pdf.js';
import { setTool } from './editor/toolbar.js';
import { isScribble, recognizeShape } from './input/shapes.js';
import { bindDropAndPaste, fileToPages, ingestFiles, receiveSharedFiles } from './library/import.js';
import { L, bindLibrary, refreshLib } from './library/library.js';
import { toast } from './ui/dialogs.js';

/* =====================================================================
   BOOT
   ===================================================================== */
async function boot() {
  const ok = await DB.open();
  bindLibrary(); bindEditor(); bindDropAndPaste();
  await refreshLib();
  if (!ok) toast('This browser blocked storage — notes won’t be saved', 5000);
  await receiveSharedFiles();
  const m = location.hash.match(/^#note-(.+)$/);
  if (m) { const n = L.notes.find(x => x.id.replace(/[^A-Za-z0-9-]/g, '') === m[1]); if (n) openNote(n.id); }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNote(); });
  window.addEventListener('pagehide', () => saveNote());
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(reg => { reg.update().catch(() => {}); }).catch(() => {});
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      if (!E.open) { reloading = true; location.reload(); return; }
      window.__marginUpdateReady = true; toast('Margin was updated — go back to your notes to load it', 5000);
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {}); });
  }
  window.__margin = { E, L, DB, SET, recognizeShape, isScribble, openNote, closeNote, setTool, exportPdf, buildPdf, fileToPages, ingestFiles };
}

boot();
