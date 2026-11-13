// In-app feedback form → owner approval → GitHub.
import { icon } from '../core/icons.js';
import { $, $$, dpr, esc, uid } from '../core/util.js';
import { APP_VERSION, FEEDBACK_URL } from '../core/version.js';
import { E } from '../editor/editor.js';
import { renderPageToCanvas } from '../editor/render.js';
import { commitActiveText } from '../editor/text.js';
import { canvasToBlob } from '../library/import.js';
import { abToB64 } from '../settings/settings.js';
import { modal } from '../ui/dialogs.js';

/* =====================================================================
   FEEDBACK (bug reports & feature requests → owner approval → GitHub)
   ===================================================================== */
export const FB_MAX_FILES = 6, FB_MAX_BYTES = 24 * 1048576, FB_MAX_VIDEO = 18 * 1048576;
export async function fileToB64(blob) { return abToB64(await blob.arrayBuffer()); }
export async function shrinkImage(file) {
  // keep screenshots readable but small
  try {
    const url = URL.createObjectURL(file), img = new Image(); img.src = url; await img.decode();
    const s = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
    if (s >= 1 && file.size < 1.5 * 1048576) { URL.revokeObjectURL(url); return file; }
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const b = await canvasToBlob(c, 'image/jpeg', 0.85); c.width = c.height = 0;
    return new File([b], (file.name || 'image').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch (e) { return file; }
}
export async function feedbackDialog() {
  if (!FEEDBACK_URL) { modal({ title: 'Feedback isn’t set up yet', body: '<p>The developer hasn’t connected the feedback service yet. Please check back soon.</p>', buttons: [{ label: 'OK', primary: true, value: true }] }); return; }
  let saved = {}; try { saved = JSON.parse(localStorage.getItem('margin.fb') || '{}'); } catch (e) {}
  // each type keeps its own draft, so switching starts blank and switching back restores it
  const st = { kind: 'bug', files: [], page: E.open, drafts: { bug: { title: '', desc: '', files: [] }, feature: { title: '', desc: '', files: [] } } };
  const body = document.createElement('div'); body.className = 'fb-form';
  body.innerHTML = `
    <div class="seg fb-kind"><button data-k="bug" class="on">${icon('bug')}Report a bug</button><button data-k="feature">${icon('bulb')}Suggest a feature</button></div>
    <label class="lbl">Short title</label><input class="inp fb-title" maxlength="120" placeholder="e.g. Eraser misses fast strokes" autocomplete="off">
    <label class="lbl fb-dlbl">What happened? What did you expect?</label><textarea class="inp fb-desc" rows="5" maxlength="5000" placeholder="Steps to reproduce help a lot"></textarea>
    <label class="lbl">Screenshots or videos <span class="opt">optional</span></label>
    <div class="fb-files"></div>
    <div class="fb-add-row"><button class="btn fb-add" type="button">${icon('image')}Add photos or videos</button>${E.open ? `<label class="fb-check"><input type="checkbox" class="fb-page" checked> Include a picture of this page</label>` : ''}</div>
    <label class="lbl">Your email <span class="opt">optional</span></label><input class="inp fb-email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="${esc(saved.email || '')}">
    <label class="fb-check"><input type="checkbox" class="fb-notify" ${saved.notify ? 'checked' : ''}> Email me updates about this request</label>
    <p class="muted fb-tip">💡 One idea or bug per report gets it built fastest. Several things at once are fine too: each one is built separately.</p>
    <p class="muted fb-note">Your email is only seen by the developer and is never posted publicly. If approved, your title, description and attachments become a public GitHub issue.</p>
    <p class="fb-err" hidden></p>`;
  const drawFiles = () => {
    $('.fb-files', body).innerHTML = st.files.map((f, i) => `<span class="fb-chip">${icon(/^video/.test(f.type) ? 'video' : 'image')}<span>${esc(f.name || 'file')}</span><small>${(f.size / 1048576).toFixed(1)} MB</small><button data-rm="${i}" aria-label="Remove">${icon('x')}</button></span>`).join('');
  };
  const setKind = k => {
    if (k !== st.kind) {
      const t = $('.fb-title', body), d = $('.fb-desc', body);
      st.drafts[st.kind] = { title: t.value, desc: d.value, files: st.files };
      const n = st.drafts[k]; t.value = n.title; d.value = n.desc; st.files = n.files; drawFiles(); err('');
    }
    st.kind = k; $$('.fb-kind button', body).forEach(b => b.classList.toggle('on', b.dataset.k === k));
    $('.fb-dlbl', body).textContent = k === 'bug' ? 'What happened? What did you expect?' : 'What would you like Margin to do?';
    $('.fb-desc', body).placeholder = k === 'bug' ? 'Steps to reproduce help a lot' : 'Describe the feature and how you’d use it'; };
  const err = m => {
    const e = $('.fb-err', body); e.textContent = m || ''; e.hidden = !m;
    if (m) { try { e.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (x) {} }
  };
  body.addEventListener('click', async e => {
    const k = e.target.closest('[data-k]'); if (k) { setKind(k.dataset.k); return; }
    const rm = e.target.closest('[data-rm]'); if (rm) { st.files.splice(+rm.dataset.rm, 1); drawFiles(); return; }
    if (e.target.closest('.fb-add')) {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*,video/*'; inp.multiple = true;
      inp.onchange = async () => {
        for (const f of [...inp.files]) {
          if (st.files.length >= FB_MAX_FILES) { err(`Up to ${FB_MAX_FILES} files`); break; }
          if (/^video\//.test(f.type)) { if (f.size > FB_MAX_VIDEO) { err(`“${f.name}” is over ${FB_MAX_VIDEO / 1048576} MB — try a shorter clip`); continue; } st.files.push(f); }
          else if (/^image\//.test(f.type)) st.files.push(await shrinkImage(f));
        }
        drawFiles();
      };
      inp.click();
    }
  });
  const send = async (b, close) => {
    err('');
    const title = $('.fb-title', b).value.trim(), desc = $('.fb-desc', b).value.trim();
    const email = $('.fb-email', b).value.trim(), notify = $('.fb-notify', b).checked;
    if (!desc && !title) { err('Please describe the bug or feature.'); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err('That email doesn’t look right.'); return; }
    if (notify && !email) { err('Add your email to get notified, or untick the box.'); return; }
    const btn = $('.mbtns .btn.primary', b); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const files = st.files.slice();
      const pg = $('.fb-page', b);
      if (pg && pg.checked && E.open && E.pages[E.cur]) {
        commitActiveText();
        const p = E.pages[E.cur], c = await renderPageToCanvas(p, Math.min(1.5, 1600 / p.w));
        files.unshift(new File([await canvasToBlob(c, 'image/jpeg', 0.85)], `page-${E.cur + 1}.jpg`, { type: 'image/jpeg' })); c.width = c.height = 0;
      }
      const total = files.reduce((a, f) => a + f.size, 0);
      if (total > FB_MAX_BYTES) throw new Error(`Attachments are ${(total / 1048576).toFixed(1)} MB — please keep them under ${FB_MAX_BYTES / 1048576} MB.`);
      const payload = {
        id: uid(), kind: st.kind, title: title || desc.slice(0, 80), description: desc, email: email || '', notify: !!(notify && email),
        meta: { version: APP_VERSION, ua: navigator.userAgent, screen: `${screen.width}×${screen.height} @${dpr()}x`, standalone: !!(navigator.standalone || matchMedia('(display-mode: standalone)').matches), pencil: !!E.penSeen, url: location.origin + location.pathname },
        files: await Promise.all(files.map(async f => ({ name: f.name || 'file', type: f.type || 'application/octet-stream', data: await fileToB64(f) }))),
      };
      try { localStorage.setItem('margin.fb', JSON.stringify({ email, notify })); } catch (e) {}
      await postFeedback(payload);
      close(true);
      modal({ title: 'Thanks!', body: `<p>Your ${st.kind === 'bug' ? 'bug report' : 'idea'} was sent. The developer will review it${payload.notify ? ', and you’ll get an email when it’s done' : ''}.</p>`, buttons: [{ label: 'Done', primary: true, value: true }] });
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Send';
      err(navigator.onLine === false ? 'You’re offline — connect to the internet and try again.' : (e.message || 'Couldn’t send — please try again.'));
    }
  };
  modal({ title: 'Send feedback', body, wide: true, buttons: [{ label: 'Cancel', value: null }, { label: 'Send', primary: true, value: () => false }],
    onOpen: (b, close) => { $('.mbtns .btn.primary', b).addEventListener('click', () => send(b, close)); $('.fb-title', b).focus(); } });
}
export async function postFeedback(payload) {
  const body = JSON.stringify(payload);
  try {
    const r = await fetch(FEEDBACK_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, redirect: 'follow' });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (j && j.ok === false) throw Object.assign(new Error(j.error || 'The feedback service refused the report.'), { server: true });
    return;
  } catch (e) {
    if (e.server) throw e;
    // Response unreadable (CORS) — send again without reading it; the server ignores duplicate ids.
    await fetch(FEEDBACK_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body });
  }
}
