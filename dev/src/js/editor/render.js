// Drawing paper templates, strokes, text and whole pages to canvas.
import { INKS, PAPERS, SPACING, spacingOf } from '../core/config.js';
import { loadBg } from '../core/storage.js';
import { $, FONT, HL_ALPHA, TEXT_PAD_X, TEXT_PAD_Y, clamp } from '../core/util.js';
import { L } from '../library/library.js';
import { drawImageObj } from '../selection/images.js';

/* =====================================================================
   RENDERING
   ===================================================================== */
export function drawPaper(ctx, p) {
  ctx.fillStyle = (PAPERS[p.paper] || PAPERS.white)[0];
  ctx.fillRect(0, 0, p.w, p.h);
  if (p.bg || p.template === 'blank' || !SPACING[p.template]) return;
  const g = spacingOf(p), m = (INKS[p.ink] || INKS.normal)[0];
  const a = v => Math.min(1, v * m).toFixed(3);
  ctx.save();
  if (p.template === 'lined') {
    ctx.strokeStyle = `rgba(70,120,190,${a(.30)})`; ctx.lineWidth = m > 1.5 ? 1.3 : 1; ctx.beginPath();
    for (let y = 80 + g; y < p.h - 16; y += g) { ctx.moveTo(0, y); ctx.lineTo(p.w, y); }
    ctx.stroke();
    ctx.strokeStyle = `rgba(214,80,80,${a(.32)})`; ctx.beginPath(); ctx.moveTo(96, 0); ctx.lineTo(96, p.h); ctx.stroke();
  } else if (p.template === 'grid') {
    ctx.strokeStyle = `rgba(60,90,130,${a(.17)})`; ctx.lineWidth = m > 1.5 ? 1.2 : 1; ctx.beginPath();
    for (let x = g; x < p.w; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, p.h); }
    for (let y = g; y < p.h; y += g) { ctx.moveTo(0, y); ctx.lineTo(p.w, y); }
    ctx.stroke();
  } else if (p.template === 'dotted') {
    const r = clamp(g / 19, 0.9, 1.9) * (m > 1.5 ? 1.2 : 1);
    ctx.fillStyle = `rgba(60,70,90,${a(.36)})`; ctx.beginPath();
    for (let y = g; y < p.h; y += g) for (let x = g; x < p.w; x += g) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832); }
    ctx.fill();
  }
  ctx.restore();
}

export const segW = (st, P, i) => st.t === 'pen' ? st.s * (0.3 + 1.25 * P[i * 3 + 2]) : st.s;
export function drawSegs(ctx, st, P, a, b, dx, dy) {
  for (let i = a; i <= b; i++) {
    const o = i * 3;
    const sx = i === 1 ? P[0] : (P[o - 3] + P[o]) / 2, sy = i === 1 ? P[1] : (P[o - 2] + P[o + 1]) / 2;
    ctx.lineWidth = segW(st, P, i);
    ctx.beginPath(); ctx.moveTo(sx + dx, sy + dy);
    ctx.quadraticCurveTo(P[o] + dx, P[o + 1] + dy, (P[o] + P[o + 3]) / 2 + dx, (P[o + 1] + P[o + 4]) / 2 + dy);
    ctx.stroke();
  }
}
export function drawTail(ctx, st, P, n, dx, dy) {
  const L = (n - 1) * 3; let sx, sy;
  if (n > 2) { sx = (P[L - 3] + P[L]) / 2; sy = (P[L - 2] + P[L + 1]) / 2; } else { sx = P[0]; sy = P[1]; }
  ctx.lineWidth = segW(st, P, n - 1);
  ctx.beginPath(); ctx.moveTo(sx + dx, sy + dy); ctx.lineTo(P[L] + dx, P[L + 1] + dy); ctx.stroke();
}
export function drawStroke(ctx, st, dx = 0, dy = 0) {
  const P = st.p, n = P.length / 3; if (!n) return;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = st.c; ctx.fillStyle = st.c;
  if (st.t === 'hl') { ctx.globalAlpha = HL_ALPHA; ctx.globalCompositeOperation = 'multiply'; }
  if (n === 1) { ctx.beginPath(); ctx.arc(P[0] + dx, P[1] + dy, Math.max(0.4, segW(st, P, 0) / 2), 0, 6.2832); ctx.fill(); }
  else if (st.t === 'pen') { if (n > 2) drawSegs(ctx, st, P, 1, n - 2, dx, dy); drawTail(ctx, st, P, n, dx, dy); }
  else {
    ctx.lineWidth = st.s; ctx.beginPath(); ctx.moveTo(P[0] + dx, P[1] + dy);
    for (let i = 1; i < n - 1; i++) { const o = i * 3; ctx.quadraticCurveTo(P[o] + dx, P[o + 1] + dy, (P[o] + P[o + 3]) / 2 + dx, (P[o + 1] + P[o + 4]) / 2 + dy); }
    ctx.lineTo(P[(n - 1) * 3] + dx, P[(n - 1) * 3 + 1] + dy); ctx.stroke();
  }
  ctx.restore();
}
export function drawAllStrokes(ctx, strokes, exclude) {
  for (const st of strokes) if (st.t === 'hl' && !(exclude && exclude.has(st.id))) drawStroke(ctx, st);
  for (const st of strokes) if (st.t !== 'hl' && !(exclude && exclude.has(st.id))) drawStroke(ctx, st);
}
export function wrapLines(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/(\s+)/); let line = '';
    for (const w of words) {
      const test = line + w;
      if (line && ctx.measureText(test).width > maxW) { lines.push(line.replace(/\s+$/, '')); line = w.replace(/^\s+/, ''); }
      else line = test;
    }
    lines.push(line);
  }
  return lines;
}
export function drawTexts(ctx, texts) {
  for (const t of texts || []) {
    if (!t.v || !t.v.trim()) continue;
    ctx.save(); ctx.fillStyle = t.c; ctx.font = `${t.s}px ${FONT}`; ctx.textBaseline = 'middle';
    const lh = t.s * 1.3; let y = t.y + TEXT_PAD_Y + lh / 2;
    for (const line of wrapLines(ctx, t.v, t.w - TEXT_PAD_X * 2)) { ctx.fillText(line, t.x + TEXT_PAD_X, y); y += lh; }
    ctx.restore();
  }
}
export async function renderPageToCanvas(p, k) {
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(p.w * k)); c.height = Math.max(1, Math.round(p.h * k));
  const ctx = c.getContext('2d'); ctx.setTransform(k, 0, 0, k, 0, 0);
  drawPaper(ctx, p);
  if (p.bg) { const img = await loadBg(p.bg); if (img) try { ctx.drawImage(img, 0, 0, p.w, p.h); } catch (e) {} }
  for (const im of p.images || []) { const img = await loadBg(im.b); if (img) drawImageObj(ctx, im, img); }
  drawAllStrokes(ctx, p.strokes);
  drawTexts(ctx, p.texts);
  return c;
}
