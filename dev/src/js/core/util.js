// Small DOM / string / id helpers and app-wide constants like page size.

/* =====================================================================
   Margin — a local-first handwritten notes app
   ===================================================================== */

export const PAGE_W = 816, PAGE_H = 1056;          // page units (Letter @ 96dpi)
export const HL_ALPHA = 0.36;
export const MAX_CANVAS_PX = 9.5e6;                // per-canvas pixel cap (iOS safe)
export const FONT = '-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,Helvetica,Arial,sans-serif';
export const TEXT_PAD_X = 4, TEXT_PAD_Y = 2;

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => { try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) {} return Date.now().toString(36) + Math.random().toString(36).slice(2, 12); };
export const now = () => Date.now();
export const dpr = () => window.devicePixelRatio || 1;
