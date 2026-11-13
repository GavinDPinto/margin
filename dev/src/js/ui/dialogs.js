// Toasts, popovers, menus, modals, file pickers, paper picker.
import { INKS, PAPERS, SET, SPACING, TEMPLATES, saveSettings } from '../core/config.js';
import { icon } from '../core/icons.js';
import { $, $$, PAGE_H, PAGE_W, clamp, dpr, esc } from '../core/util.js';
import { drawPaper } from '../editor/render.js';

/* =====================================================================
   UI helpers: toast, popovers, modals
   ===================================================================== */
export let toastT = 0;
export function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }

export let openPop = null;
export function closePop() { if (openPop) { openPop.remove(); openPop = null; } }
export function popover(anchor, content, opts = {}) {
  closePop();
  const p = document.createElement('div'); p.className = 'pop';
  if (typeof content === 'string') p.innerHTML = content; else p.appendChild(content);
  document.body.appendChild(p);
  const r = anchor.getBoundingClientRect(), pw = p.offsetWidth, ph = p.offsetHeight;
  let x = opts.alignRight ? r.right - pw : r.left + r.width / 2 - pw / 2;
  let y = r.bottom + 6;
  if (y + ph > innerHeight - 8) y = Math.max(8, r.top - ph - 6);
  p.style.left = clamp(x, 8, innerWidth - pw - 8) + 'px'; p.style.top = y + 'px';
  openPop = p;
  // keep focus in text boxes when tapping popovers
  p.addEventListener('pointerdown', e => { if (!e.target.closest('input')) e.preventDefault(); });
  return p;
}
export function menu(anchor, items, opts) {
  const wrap = document.createElement('div');
  items.forEach(it => {
    if (it === '-') { wrap.appendChild(document.createElement('hr')); return; }
    const b = document.createElement('button'); b.className = 'mi' + (it.danger ? ' danger' : '');
    b.innerHTML = (it.icon ? icon(it.icon) : '') + `<span>${esc(it.label)}</span>` + (it.right ? `<span class="r">${esc(it.right)}</span>` : '');
    b.addEventListener('click', () => { closePop(); it.fn && it.fn(); });
    wrap.appendChild(b);
  });
  return popover(anchor, wrap, opts);
}
document.addEventListener('pointerdown', e => { if (openPop && !openPop.contains(e.target) && !e.target.closest('[data-popanchor]')) closePop(); }, true);

export function modal({ title, body, buttons = [], onOpen, wide, dismissable = true }) {
  return new Promise(resolve => {
    closePop();
    const back = document.createElement('div'); back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${title ? `<h3>${esc(title)}</h3>` : ''}<div class="mbody"></div><div class="mbtns"></div></div>`;
    const mb = $('.mbody', back);
    if (typeof body === 'string') mb.innerHTML = body; else if (body) mb.appendChild(body);
    if (!buttons.length) $('.mbtns', back).remove();
    let done = false;
    const close = r => { if (done) return; done = true; back.remove(); document.removeEventListener('keydown', kd, true); resolve(r); };
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      btn.textContent = b.label;
      btn.addEventListener('click', () => { const r = typeof b.value === 'function' ? b.value(back) : b.value; if (r === false) return; close(r); });
      $('.mbtns', back).appendChild(btn);
    });
    const kd = e => {
      if (e.key === 'Escape' && dismissable) { e.preventDefault(); close(null); }
      else if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const p = $('.btn.primary,.btn.danger', back); if (p) { e.preventDefault(); p.click(); } }
    };
    document.addEventListener('keydown', kd, true);
    if (dismissable) back.addEventListener('pointerdown', e => { if (e.target === back) close(null); });
    document.body.appendChild(back);
    onOpen && onOpen(back, close);
  });
}
export function askText(title, value = '', placeholder = '', ok = 'Save') {
  return modal({
    title, body: `<input class="inp" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">`,
    buttons: [{ label: 'Cancel', value: null }, { label: ok, primary: true, value: b => $('.inp', b).value.trim() || (placeholder ? placeholder : false) }],
    onOpen: b => { const i = $('.inp', b); i.focus(); i.select(); },
  });
}
export function confirmBox(title, msg, ok = 'Delete', danger = true) {
  return modal({ title, body: `<p>${esc(msg)}</p>`, buttons: [{ label: 'Cancel', value: false }, { label: ok, primary: !danger, danger, value: true }] });
}
export function progressBox(title) {
  let api;
  modal({ title, dismissable: false, body: `<div class="muted pmsg">Preparing…</div><div class="progress"><i></i></div>`, onOpen: (b, close) => {
    api = { set(msg, f) { $('.pmsg', b).textContent = msg; $('.progress i', b).style.width = Math.round(clamp(f, 0, 1) * 100) + '%'; }, close: () => close(null) };
  } });
  return api;
}
export function fileReadyBox(blob, name, kind) {
  const canShare = (() => { try { return !!(navigator.canShare && navigator.canShare({ files: [new File([blob], name, { type: blob.type })] })); } catch (e) { return false; } })();
  return modal({
    title: kind + ' ready', body: `<p><b>${esc(name)}</b><br><span class="muted">${(blob.size / 1048576).toFixed(1)} MB</span></p>`,
    buttons: [{ label: 'Close', value: null }, { label: canShare ? 'Share / Save…' : 'Download', primary: true, value: () => { deliverFile(blob, name, canShare); return true; } }],
  });
}
export function deliverFile(blob, name, tryShare) {
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); };
  if (tryShare) {
    navigator.share({ files: [new File([blob], name, { type: blob.type })], title: name }).catch(err => { if (err && err.name !== 'AbortError') download(); });
  } else download();
}
export function pickFiles(input) {
  return new Promise(res => {
    input.value = '';
    const on = () => { input.removeEventListener('change', on); res(input.files ? [...input.files] : []); };
    input.addEventListener('change', on);
    input.click();
  });
}
export function pickFile(input) {
  return new Promise(res => {
    input.value = '';
    const on = () => { input.removeEventListener('change', on); res(input.files && input.files[0] || null); };
    input.addEventListener('change', on);
    input.click();
  });
}
export function paperPicker(init) {
  const el = document.createElement('div'); el.className = 'pp';
  const st = { tpl: init.tpl || 'lined', paper: init.paper || 'white', ink: init.ink || 'normal', spacing: { ...SET.spacing, ...(init.spacing || {}) } };
  const draw = () => {
    const sp = SPACING[st.tpl], val = sp ? st.spacing[st.tpl] : 0;
    el.innerHTML = `<div class="pp-ctl">
      <label class="lbl">Template</label><div class="tpl-pick">${TEMPLATES.map(t => `<button class="tpl ${t.id === st.tpl ? 'on' : ''}" data-t="${t.id}"><span class="pv pv-${t.id}" style="background-color:${PAPERS[st.paper][0]}"></span>${t.name}</button>`).join('')}</div>
      ${sp ? `<label class="lbl">${st.tpl === 'lined' ? 'Line spacing' : st.tpl === 'grid' ? 'Square size' : 'Dot spacing'}</label>
        <div class="chips">${sp.presets.map(([v, n]) => `<button class="chip ${v === val ? 'on' : ''}" data-sp="${v}">${n}</button>`).join('')}</div>
        <div class="pp-slider"><input type="range" min="${sp.min}" max="${sp.max}" step="1" value="${val}" data-sprange><output>${(val / 96 * 25.4).toFixed(1)} mm</output></div>
        <label class="lbl">Line strength</label><div class="chips">${Object.entries(INKS).map(([k, v]) => `<button class="chip ${k === st.ink ? 'on' : ''}" data-ink="${k}">${v[1]}</button>`).join('')}</div>` : ''}
      <label class="lbl">Paper colour</label><div class="chips">${Object.entries(PAPERS).map(([k, v]) => `<button class="chip ${k === st.paper ? 'on' : ''}" data-p="${k}"><i style="background:${v[0]}"></i>${v[1]}</button>`).join('')}</div>
    </div><div class="pp-prev"><canvas></canvas><span class="muted">Preview</span></div>`;
    preview();
  };
  const preview = () => {
    const c = $('.pp-prev canvas', el); if (!c) return;
    const W = 168, k = W / PAGE_W * dpr();
    c.width = Math.round(PAGE_W * k); c.height = Math.round(PAGE_H * k); c.style.width = W + 'px'; c.style.height = Math.round(W * PAGE_H / PAGE_W) + 'px';
    const ctx = c.getContext('2d'); ctx.setTransform(k, 0, 0, k, 0, 0);
    // preview a zoomed crop so spacing differences are visible
    ctx.save(); ctx.scale(2, 2);
    drawPaper(ctx, { w: PAGE_W / 2 + 1, h: PAGE_H / 2 + 1, template: st.tpl, paper: st.paper, spacing: st.spacing[st.tpl], ink: st.ink });
    ctx.restore();
  };
  draw();
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-t]'), pp = e.target.closest('[data-p]'), sp = e.target.closest('[data-sp]'), ik = e.target.closest('[data-ink]');
    if (t) st.tpl = t.dataset.t; if (pp) st.paper = pp.dataset.p; if (ik) st.ink = ik.dataset.ink;
    if (sp) st.spacing[st.tpl] = +sp.dataset.sp;
    if (t || pp || sp || ik) draw();
  });
  el.addEventListener('input', e => {
    if (!e.target.matches('[data-sprange]')) return;
    const v = +e.target.value; st.spacing[st.tpl] = v;
    $('.pp-slider output', el).textContent = (v / 96 * 25.4).toFixed(1) + ' mm';
    $$('[data-sp]', el).forEach(b => b.classList.toggle('on', +b.dataset.sp === v));
    preview();
  });
  return { el, get: () => ({ tpl: st.tpl, paper: st.paper, ink: st.ink, spacingAll: { ...st.spacing }, spacing: SPACING[st.tpl] ? st.spacing[st.tpl] : null }) };
}
export function rememberStyle(r) { SET.template = r.tpl; SET.paper = r.paper; SET.ink = r.ink; SET.spacing = { ...SET.spacing, ...r.spacingAll }; saveSettings(); }
