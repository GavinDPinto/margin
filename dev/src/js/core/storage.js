// IndexedDB wrapper (DB) and cached background/image loading.

/* =====================================================================
   Storage (IndexedDB with in-memory fallback)
   ===================================================================== */
export const DB = {
  db: null, mem: null,
  async open() {
    try {
      if (!window.indexedDB) throw new Error('no indexedDB');
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open('margin-notes', 1);
        r.onupgradeneeded = () => { const d = r.result; for (const n of ['folders', 'notes', 'pages', 'blobs']) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' }); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
      });
    } catch (e) {
      this.mem = { folders: new Map(), notes: new Map(), pages: new Map(), blobs: new Map() };
      return false;
    }
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    return true;
  },
  _tx(store, mode, fn) {
    return new Promise((res, rej) => {
      let t; try { t = this.db.transaction(store, mode); } catch (e) { rej(e); return; }
      const r = fn(t.objectStore(store));
      t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted'));
    });
  },
  get(s, id) { if (this.mem) return Promise.resolve(this.mem[s].get(id)); return this._tx(s, 'readonly', os => os.get(id)); },
  all(s) { if (this.mem) return Promise.resolve([...this.mem[s].values()]); return this._tx(s, 'readonly', os => os.getAll()); },
  put(s, v) { if (this.mem) { this.mem[s].set(v.id, v); return Promise.resolve(); } return this._tx(s, 'readwrite', os => { os.put(v); }); },
  del(s, id) { if (this.mem) { this.mem[s].delete(id); return Promise.resolve(); } return this._tx(s, 'readwrite', os => { os.delete(id); }); },
};

/* background images (PDF pages / imported images) */
export const bgCache = new Map(), bgLoading = new Map(), bgFailed = new Set();
export function loadBg(id) {
  if (bgCache.has(id)) { const v = bgCache.get(id); bgCache.delete(id); bgCache.set(id, v); return Promise.resolve(v); }
  if (bgLoading.has(id)) return bgLoading.get(id);
  const p = (async () => {
    const rec = await DB.get('blobs', id);
    if (!rec) { bgFailed.add(id); return null; }
    const url = URL.createObjectURL(new Blob([rec.data], { type: rec.type || 'image/jpeg' }));
    const img = new Image(); img.src = url;
    try { await img.decode(); } catch (e) { await new Promise(r => { if (img.complete) r(); else { img.onload = r; img.onerror = r; } }); }
    if (!img.naturalWidth) { bgFailed.add(id); URL.revokeObjectURL(url); return null; }
    img._url = url; bgCache.set(id, img);
    while (bgCache.size > 40) { const k = bgCache.keys().next().value; const old = bgCache.get(k); bgCache.delete(k); try { URL.revokeObjectURL(old._url); } catch (e) {} }
    return img;
  })();
  bgLoading.set(id, p);
  p.finally(() => bgLoading.delete(id));
  return p;
}
