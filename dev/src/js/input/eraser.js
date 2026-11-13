// Precise and whole-stroke eraser.
import { SET } from '../core/config.js';
import { uid } from '../core/util.js';
import { E, live, renderPage, snap } from '../editor/editor.js';
import { strokeBB } from '../input/ink.js';
import { D, attachLive } from '../input/pointer.js';

/* eraser */
export function distPtSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qy = ay + t * dy - py; return Math.sqrt(qx * qx + qy * qy);
}
export function densify(P, maxD) {
  const out = [P[0], P[1], P[2]];
  for (let i = 3; i < P.length; i += 3) {
    const ax = P[i - 3], ay = P[i - 2], ap = P[i - 1], bx = P[i], by = P[i + 1], bp = P[i + 2];
    const d = Math.hypot(bx - ax, by - ay), steps = Math.floor(d / maxD);
    for (let s = 1; s <= steps; s++) { const t = s / (steps + 1); out.push(ax + (bx - ax) * t, ay + (by - ay) * t, ap + (bp - ap) * t); }
    out.push(bx, by, bp);
  }
  return out;
}
export function beginErase(x, y) {
  D.mode = 'erase'; D.before = snap(D.v.page); D.changed = false; D.needRender = false; D.ex = x; D.ey = y;
  D.lctx = attachLive(D.v); eraseSeg(x, y, x, y); queueEraseFrame();
}
export function eraseSeg(ax, ay, bx, by) {
  const p = D.v.page, r = SET.eraser.size / 2, partial = SET.eraser.mode !== 'stroke';
  const mnx = Math.min(ax, bx) - r, mxx = Math.max(ax, bx) + r, mny = Math.min(ay, by) - r, mxy = Math.max(ay, by) + r;
  let changed = false; const out = [];
  for (const st of p.strokes) {
    const b = st.bb || (st.bb = strokeBB(st));
    if (b[2] < mnx || b[0] > mxx || b[3] < mny || b[1] > mxy) { out.push(st); continue; }
    const rr = r + (st.t === 'pen' ? st.s * 0.5 : st.s / 2) * 0.7;
    const P = st.p.length > 3 ? densify(st.p, Math.max(1, Math.min(4, rr * 0.4))) : st.p;
    const n = P.length / 3;
    if (!partial) {
      let hit = false;
      for (let i = 0; i < n && !hit; i++) if (distPtSeg(P[i * 3], P[i * 3 + 1], ax, ay, bx, by) < rr) hit = true;
      if (hit) changed = true; else out.push(st);
      continue;
    }
    let any = false; const keep = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const k = distPtSeg(P[i * 3], P[i * 3 + 1], ax, ay, bx, by) >= rr; keep[i] = k ? 1 : 0; if (!k) any = true; }
    if (!any) { out.push(st); continue; }
    changed = true;
    let run = [];
    const flush = () => { if (run.length >= 6) { const ns = { id: uid(), t: st.t, c: st.c, s: st.s, p: run }; ns.bb = strokeBB(ns); out.push(ns); } run = []; };
    for (let i = 0; i < n; i++) { if (keep[i]) run.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); else flush(); }
    flush();
  }
  if (changed) { p.strokes = out; D.changed = true; D.needRender = true; }
}
export function queueEraseFrame() {
  if (D.raf) return;
  D.raf = requestAnimationFrame(() => {
    D.raf = 0; if (!D.active || D.mode !== 'erase') return;
    if (D.needRender) { D.needRender = false; renderPage(D.v); }
    const ctx = D.lctx; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, live.width, live.height); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(D.ex, D.ey, SET.eraser.size / 2, 0, 6.2832);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill(); ctx.lineWidth = 1 / E.s; ctx.strokeStyle = 'rgba(60,60,67,.55)'; ctx.stroke(); ctx.restore();
  });
}
