// Minimal PDF writer and "Export as PDF".
import { $ } from '../core/util.js';
import { renderPageToCanvas } from '../editor/render.js';
import { canvasToBlob } from '../library/import.js';
import { fileReadyBox, progressBox, toast } from '../ui/dialogs.js';

/* ---------- PDF export (minimal writer, JPEG pages) ---------- */
export function buildPdf(imgs) {
  const enc = new TextEncoder(), chunks = []; let off = 0; const offs = [];
  const w = x => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); off += b.length; };
  const f = v => (Math.round(v * 100) / 100).toString();
  w('%PDF-1.4\n'); w(new Uint8Array([37, 226, 227, 207, 211, 10]));
  const obj = (id, fn) => { offs[id] = off; w(`${id} 0 obj\n`); fn(); w('\nendobj\n'); };
  const n = imgs.length;
  obj(1, () => w('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => w(`<< /Type /Pages /Kids [${imgs.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${n} >>`));
  imgs.forEach((im, i) => {
    const pid = 3 + i * 3, cid = pid + 1, iid = pid + 2;
    obj(pid, () => w(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(im.wpt)} ${f(im.hpt)}] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>`));
    const cs = `q ${f(im.wpt)} 0 0 ${f(im.hpt)} 0 0 cm /Im0 Do Q`;
    obj(cid, () => { w(`<< /Length ${cs.length} >>\nstream\n`); w(cs); w('\nendstream'); });
    obj(iid, () => { w(`<< /Type /XObject /Subtype /Image /Width ${im.pw} /Height ${im.ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`); w(im.bytes); w('\nendstream'); });
  });
  const total = 3 + n * 3, xref = off;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let id = 1; id < total; id++) x += String(offs[id]).padStart(10, '0') + ' 00000 n \n';
  w(x); w(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
export async function exportPdf(pages, title) {
  if (!pages || !pages.length) { toast('Nothing to export'); return; }
  const pg = progressBox('Exporting PDF');
  try {
    const imgs = [];
    for (let i = 0; i < pages.length; i++) {
      pg.set(`Page ${i + 1} of ${pages.length}`, (i + 1) / pages.length);
      const p = pages[i];
      const k = Math.min(2, Math.sqrt(9e6 / (p.w * p.h)));
      const c = await renderPageToCanvas(p, k);
      const blob = await canvasToBlob(c, 'image/jpeg', 0.9);
      imgs.push({ bytes: new Uint8Array(await blob.arrayBuffer()), pw: c.width, ph: c.height, wpt: p.w * 0.75, hpt: p.h * 0.75 });
      c.width = c.height = 0;
      await new Promise(r => setTimeout(r, 0));
    }
    const pdf = buildPdf(imgs);
    pg.close();
    fileReadyBox(pdf, (title || 'Note').replace(/[\\/:*?"<>|]+/g, '-') + '.pdf', 'PDF');
  } catch (e) { pg.close(); console.error(e); toast('Export failed: ' + (e.message || e)); }
}
