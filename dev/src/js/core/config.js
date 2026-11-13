// Templates, paper colours, palettes, sizes, and user settings (SET) persisted in localStorage.
import { clamp } from '../core/util.js';

/* ---------- constants ---------- */
export const TEMPLATES = [
  { id: 'lined', name: 'Lined' }, { id: 'grid', name: 'Grid' },
  { id: 'dotted', name: 'Dotted' }, { id: 'blank', name: 'Blank' },
];
export const PAPERS = { white: ['#ffffff', 'White'], cream: ['#fbf6e8', 'Cream'], yellow: ['#fdf5c4', 'Legal'], gray: ['#f0f1f3', 'Gray'] };
export const SPACING = {
  lined: { def: 32, min: 16, max: 64, presets: [[24, 'Narrow'], [32, 'Medium'], [42, 'Wide']] },
  grid: { def: 24, min: 10, max: 64, presets: [[16, 'Small'], [24, 'Medium'], [36, 'Large']] },
  dotted: { def: 24, min: 10, max: 64, presets: [[16, 'Small'], [24, 'Medium'], [36, 'Large']] },
};
export const INKS = { light: [0.55, 'Light'], normal: [1, 'Normal'], bold: [1.9, 'Bold'] };
export const spacingOf = p => (p.spacing && SPACING[p.template]) ? clamp(p.spacing, SPACING[p.template].min, SPACING[p.template].max) : (SPACING[p.template] ? SPACING[p.template].def : 24);
export const PEN_COLORS = ['#1c1c1e', '#2a5bd7', '#d1352b', '#23885a', '#7a3fc6', '#e57a00'];
export const HL_COLORS = ['#ffe14d', '#86e58f', '#7cccff', '#ff98cc', '#ffb35c', '#bda4ff'];
export const FOLDER_COLORS = ['#2d5be3', '#e5484d', '#f5a524', '#30a46c', '#8e4ec6', '#0091ff', '#d6409f', '#6e6e73'];
export const SIZE_PRESETS = { pen: [1.2, 2.2, 3.8], hl: [10, 18, 30], eraser: [10, 26, 56], text: [14, 20, 30] };
export const SIZE_RANGE = { pen: [0.5, 14, 0.1], hl: [4, 60, 1], eraser: [4, 120, 1], text: [10, 72, 1] };

/* ---------- settings ---------- */
export const DEFAULTS = {
  fingerDraw: false, template: 'lined', paper: 'white', spacing: { lined: 32, grid: 24, dotted: 24 }, ink: 'normal', sort: 'updated', tool: 'pen', shapes: true, scribble: true,
  pen: { color: '#1c1c1e', size: 2.2, kind: 'fountain', custom: '#8a5a2b' },
  hl: { color: '#ffe14d', size: 18, custom: '#ffc8a0' },
  eraser: { size: 26, mode: 'partial' },
  lasso: { mode: 'free' },
  text: { color: '#1c1c1e', size: 20, custom: '#8a5a2b' },
};
export function mergeDeep(a, b) { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') mergeDeep(a[k], b[k]); else if (b[k] !== undefined) a[k] = b[k]; } return a; }
export let SET = (() => { const d = JSON.parse(JSON.stringify(DEFAULTS)); try { return mergeDeep(d, JSON.parse(localStorage.getItem('margin.settings') || '{}')); } catch (e) { return d; } })();
export let saveSetT = 0;
export function saveSettings() { clearTimeout(saveSetT); saveSetT = setTimeout(() => { try { localStorage.setItem('margin.settings', JSON.stringify(SET)); } catch (e) {} }, 200); }
