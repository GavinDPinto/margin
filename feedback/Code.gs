/**
 * Margin feedback service: a Google Apps Script web app that runs under your Google account.
 *
 *  1. The Margin app POSTs bug reports and feature ideas here (doPost).
 *  2. Each report is logged in a private Google Sheet. Screenshots and videos go into a private Drive folder.
 *  3. You get an email with an Approve / Reject button.
 *  4. Approve creates a GitHub issue labelled "approved-feedback", with attachments uploaded to the
 *     "feedback-media" branch. The reporter's email address is never sent to GitHub.
 *  5. Every hour (checkShipped) the script looks for approved issues that are now closed and labelled "shipped".
 *     It emails reporters who asked to be told, from your Gmail.
 *
 * One-time setup: see feedback/SETUP.md. In short: paste this file, run setup(), add GITHUB_TOKEN in
 * Script properties, then Deploy → Web app (Execute as: Me, Who has access: Anyone).
 */

const CONFIG = {
  REPO: 'GavinDPinto/margin',
  APP_URL: 'https://gavindpinto.github.io/margin/',
  MEDIA_BRANCH: 'feedback-media',
  APPROVED_LABEL: 'approved-feedback',
  SHIPPED_LABEL: 'shipped',
  MAX_REPORTS_PER_HOUR: 30,
  MAX_FILES: 6,
  MAX_TOTAL_BYTES: 25 * 1024 * 1024,
  SHEET_NAME: 'Margin feedback (private)',
  FOLDER_NAME: 'Margin feedback attachments (private)',
};

const COLS = ['ID', 'Received', 'Status', 'Type', 'Title', 'Description', 'Attachments', 'Reporter email', 'Wants email',
  'App version', 'Device', 'Issue #', 'Issue URL', 'Reporter notified', 'Decided'];
const C = Object.fromEntries(COLS.map((name, i) => [name, i + 1]));

/* ------------------------------------------------------------------ setup */

/** Run once from the editor (select "setup" → Run). Safe to run again. */
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SHEET_ID')) {
    const ss = SpreadsheetApp.create(CONFIG.SHEET_NAME);
    const sh = ss.getSheets()[0]; sh.setName('Feedback');
    sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
    sh.setFrozenRows(1); sh.setColumnWidth(C['Description'], 420);
    props.setProperty('SHEET_ID', ss.getId());
  }
  if (!props.getProperty('FOLDER_ID')) props.setProperty('FOLDER_ID', DriveApp.createFolder(CONFIG.FOLDER_NAME).getId());
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  // hourly job that emails reporters when their request ships
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'checkShipped')) {
    ScriptApp.newTrigger('checkShipped').timeBased().everyHours(1).create();
  }
  const ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
  Logger.log('✅ Sheet: ' + ss.getUrl());
  Logger.log('✅ Attachments folder: ' + DriveApp.getFolderById(props.getProperty('FOLDER_ID')).getUrl());
  Logger.log(props.getProperty('GITHUB_TOKEN') ? '✅ GITHUB_TOKEN is set' : '⚠️  Next: add GITHUB_TOKEN under Project Settings → Script properties');
  Logger.log('Then: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone) and send the /exec URL to Claude.');
}

/** Optional: run from the editor to check the GitHub token works. */
function testGitHub() {
  const r = gh_('GET', '/repos/' + CONFIG.REPO);
  Logger.log('✅ GitHub token works for ' + r.full_name + ' (push access: ' + (r.permissions && r.permissions.push) + ')');
}

/* --------------------------------------------------------------- receive */

function doPost(e) {
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const id = String(d.id || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
    if (!id) return json_({ ok: false, error: 'Missing report id' });
    const kind = d.kind === 'feature' ? 'feature' : 'bug';
    const title = clean_(d.title, 140);
    const description = clean_(d.description, 6000);
    if (!title && !description) return json_({ ok: false, error: 'Please describe the bug or feature.' });
    const email = String(d.email || '').trim().slice(0, 200);
    const validEmail = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : '';
    const wants = !!(d.notify && validEmail);
    const files = Array.isArray(d.files) ? d.files.slice(0, CONFIG.MAX_FILES) : [];
    const meta = d.meta || {};

    // rate limit (protects your inbox and Drive from floods)
    const cache = CacheService.getScriptCache(), hourKey = 'n-' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHH');
    const n = Number(cache.get(hourKey) || 0);
    if (n >= CONFIG.MAX_REPORTS_PER_HOUR) return json_({ ok: false, error: 'Too many reports right now — please try again later.' });
    cache.put(hourKey, String(n + 1), 3700);

    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const sh = sheet_();
      if (findRow_(sh, id)) return json_({ ok: true, duplicate: true }); // app retried

      const folder = DriveApp.getFolderById(prop_('FOLDER_ID'));
      let total = 0; const saved = [];
      files.forEach((f, i) => {
        const type = String(f.type || '');
        if (!/^(image|video)\//.test(type)) return;
        const bytes = Utilities.base64Decode(String(f.data || ''));
        total += bytes.length; if (total > CONFIG.MAX_TOTAL_BYTES) return;
        const name = (i + 1) + '-' + safeName_(f.name || ('file.' + type.split('/')[1]));
        const file = folder.createFile(Utilities.newBlob(bytes, type, id.slice(0, 8) + '-' + name));
        saved.push({ id: file.getId(), name, type, size: bytes.length });
      });

      const device = [meta.ua, meta.screen, meta.standalone ? 'Home Screen app' : 'browser', meta.pencil ? 'Apple Pencil used' : ''].filter(Boolean).join(' · ').slice(0, 500);
      sh.appendRow([id, new Date(), 'pending', kind, title || description.slice(0, 80), description, JSON.stringify(saved), validEmail, wants ? 'yes' : 'no',
        clean_(meta.version, 80), device, '', '', '', '']);
      sendApprovalEmail_({ id, kind, title: title || description.slice(0, 80), description, email: validEmail, wants, version: meta.version, device, files: saved });
    } finally { lock.releaseLock(); }
    return json_({ ok: true });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'The feedback service hit an error. Please try again later.' });
  }
}

function sendApprovalEmail_(r) {
  const url = reviewUrl_(r.id);
  const inline = {}; let imgs = '';
  r.files.forEach((f, i) => {
    if (/^image\//.test(f.type) && f.size < 4 * 1024 * 1024) {
      inline['img' + i] = DriveApp.getFileById(f.id).getBlob();
      imgs += `<div style="margin:10px 0"><img src="cid:img${i}" style="max-width:520px;width:100%;border:1px solid #ddd;border-radius:8px"></div>`;
    }
  });
  const fileLinks = r.files.map(f => `<li><a href="https://drive.google.com/file/d/${f.id}/view">${esc_(f.name)}</a> (${(f.size / 1048576).toFixed(1)} MB)</li>`).join('');
  const label = r.kind === 'bug' ? '🐞 Bug report' : '💡 Feature idea';
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;color:#1d1d1f">
    <p style="color:#6e6e73;margin:0 0 4px">${label} from Margin</p>
    <h2 style="margin:0 0 12px">${esc_(r.title)}</h2>
    <div style="white-space:pre-wrap;background:#f6f5f1;border-radius:10px;padding:12px 14px">${esc_(r.description) || '<i>(no description)</i>'}</div>
    ${imgs}
    ${fileLinks ? `<p style="margin:12px 0 4px"><b>Attachments</b></p><ul style="margin:0">${fileLinks}</ul>` : ''}
    <p style="color:#6e6e73;font-size:13px">Reporter: ${r.email ? esc_(r.email) + (r.wants ? ' — wants an email when it ships' : ' — no email updates') : 'anonymous'}<br>
      App: ${esc_(r.version || '?')}<br>${esc_(r.device || '')}</p>
    <p style="margin:22px 0">
      <a href="${url}&do=approve" style="background:#2d5be3;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Approve →</a>
      &nbsp;&nbsp;<a href="${url}&do=reject" style="background:#efeee9;color:#1d1d1f;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Reject</a>
    </p>
    <p style="color:#6e6e73;font-size:12.5px">Approving creates a <b>public</b> GitHub issue with the title, description and attachments (never the reporter’s email). Claude picks it up within the hour, builds it, ships it, and emails you.</p>
  </div>`;
  MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), subject: `[Margin] ${label}: ${r.title}`.slice(0, 180), htmlBody: html, inlineImages: inline, name: 'Margin feedback' });
}

/* ---------------------------------------------------------------- review */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.a !== 'review') return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">Margin feedback service is running.</p>');
  if (!validSig_(p.id, p.sig)) return page_('Link not valid', '<p>This review link is invalid or has expired.</p>');
  const sh = sheet_(), row = findRow_(sh, p.id);
  if (!row) return page_('Not found', '<p>That report no longer exists.</p>');
  const v = sh.getRange(row, 1, 1, COLS.length).getValues()[0];
  const status = v[C['Status'] - 1];
  const head = `<p class="k">${v[C['Type'] - 1] === 'bug' ? '🐞 Bug report' : '💡 Feature idea'}</p><h1>${esc_(v[C['Title'] - 1])}</h1><div class="d">${esc_(v[C['Description'] - 1])}</div>`;
  if (status !== 'pending') {
    const link = v[C['Issue URL'] - 1] ? `<p><a href="${v[C['Issue URL'] - 1]}">Open GitHub issue #${v[C['Issue #'] - 1]}</a></p>` : '';
    return page_('Already ' + status, head + `<p class="s">This report was already <b>${status}</b>.</p>` + link);
  }
  // The decision needs a tap on this page (email link scanners can't approve by just opening the link).
  const want = p.do === 'reject' ? 'reject' : 'approve';
  const body = head + `
    <div class="b">
      <button id="ok" class="${want === 'approve' ? 'pri' : ''}" onclick="go('approve')">Approve &amp; create GitHub issue</button>
      <button id="no" class="${want === 'reject' ? 'pri red' : ''}" onclick="go('reject')">Reject</button>
    </div><p id="msg" class="s"></p>
    <script>
      function go(a){ document.querySelectorAll('button').forEach(b=>b.disabled=true); document.getElementById('msg').textContent = a==='approve' ? 'Creating issue…' : 'Rejecting…';
        google.script.run.withSuccessHandler(function(r){ document.getElementById('msg').innerHTML = r.ok ? (a==='approve' ? '✅ Approved — <a target="_blank" href="'+r.url+'">issue #'+r.number+'</a> created. Claude will pick it up within the hour.' : 'Rejected.') : ('⚠️ ' + r.error); if(!r.ok) document.querySelectorAll('button').forEach(b=>b.disabled=false); })
          .withFailureHandler(function(err){ document.getElementById('msg').textContent='⚠️ '+err.message; document.querySelectorAll('button').forEach(b=>b.disabled=false); })
          .decide(${JSON.stringify(String(p.id))}, ${JSON.stringify(String(p.sig))}, a); }
    </script>`;
  return page_('Review feedback', body);
}

/** Called from the review page. */
function decide(id, sig, action) {
  if (!validSig_(id, sig)) return { ok: false, error: 'Invalid link' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = sheet_(), row = findRow_(sh, id);
    if (!row) return { ok: false, error: 'Report not found' };
    const v = sh.getRange(row, 1, 1, COLS.length).getValues()[0];
    if (v[C['Status'] - 1] !== 'pending') return { ok: false, error: 'Already ' + v[C['Status'] - 1] };
    if (action === 'reject') {
      sh.getRange(row, C['Status']).setValue('rejected'); sh.getRange(row, C['Decided']).setValue(new Date());
      return { ok: true };
    }
    const issue = createIssue_(v);
    sh.getRange(row, C['Status']).setValue('approved');
    sh.getRange(row, C['Issue #']).setValue(issue.number);
    sh.getRange(row, C['Issue URL']).setValue(issue.html_url);
    sh.getRange(row, C['Decided']).setValue(new Date());
    return { ok: true, url: issue.html_url, number: issue.number };
  } catch (err) {
    console.error(err);
    return { ok: false, error: String(err.message || err) };
  } finally { lock.releaseLock(); }
}

function createIssue_(v) {
  const id = v[C['ID'] - 1], kind = v[C['Type'] - 1];
  const files = JSON.parse(v[C['Attachments'] - 1] || '[]');
  // upload attachments to the media branch so the issue can show them
  let media = '';
  if (files.length) {
    ensureMediaBranch_();
    files.forEach(f => {
      const path = `media/${id}/${f.name}`;
      const blob = DriveApp.getFileById(f.id).getBlob();
      gh_('PUT', `/repos/${CONFIG.REPO}/contents/${encodeURI(path)}`, { message: `Feedback ${id.slice(0, 8)}: ${f.name}`, content: Utilities.base64Encode(blob.getBytes()), branch: CONFIG.MEDIA_BRANCH });
      const url = `https://github.com/${CONFIG.REPO}/blob/${CONFIG.MEDIA_BRANCH}/${encodeURI(path)}?raw=true`;
      media += /^image\//.test(f.type) ? `![${f.name}](${url})\n\n` : `🎬 [${f.name}](${url})\n\n`;
    });
  }
  const fence = '~~~~';
  const desc = String(v[C['Description'] - 1] || '').replace(/~{4,}/g, '~~~');
  const body = [
    `**Type:** ${kind === 'bug' ? 'Bug report' : 'Feature request'} · submitted in the app ${Utilities.formatDate(new Date(v[C['Received'] - 1]), 'America/Toronto', 'yyyy-MM-dd')} · approved by the owner`,
    `**App version:** ${v[C['App version'] - 1] || 'unknown'}`,
    `**Device:** ${String(v[C['Device'] - 1] || 'unknown').replace(/[<>]/g, '')}`,
    '', '### What the user wrote', '', fence + 'text', desc || '(no description)', fence, '',
    media ? '### Attachments\n\n' + media : '',
    '---',
    `Feedback ID \`${id}\`. The reporter's contact details are kept privately and are never posted here.`,
    `<!-- margin-feedback-id:${id} -->`,
  ].join('\n');
  const title = `${kind === 'bug' ? '[Bug]' : '[Feature]'} ${String(v[C['Title'] - 1]).replace(/[\r\n]+/g, ' ')}`.slice(0, 150);
  return gh_('POST', `/repos/${CONFIG.REPO}/issues`, { title, body, labels: [CONFIG.APPROVED_LABEL, kind === 'bug' ? 'bug' : 'enhancement'] });
}

function ensureMediaBranch_() {
  try { gh_('GET', `/repos/${CONFIG.REPO}/git/ref/heads/${CONFIG.MEDIA_BRANCH}`); return; } catch (e) { if (!/404/.test(String(e))) throw e; }
  const repo = gh_('GET', `/repos/${CONFIG.REPO}`);
  const main = gh_('GET', `/repos/${CONFIG.REPO}/git/ref/heads/${repo.default_branch}`);
  gh_('POST', `/repos/${CONFIG.REPO}/git/refs`, { ref: 'refs/heads/' + CONFIG.MEDIA_BRANCH, sha: main.object.sha });
}

/* ---------------------------------------------- tell reporters it shipped */

/** Runs hourly (trigger created by setup). Emails reporters who opted in once their issue is closed + labelled "shipped". */
function checkShipped() {
  const sh = sheet_(), last = sh.getLastRow(); if (last < 2) return;
  const rows = sh.getRange(2, 1, last - 1, COLS.length).getValues();
  rows.forEach((v, i) => {
    if (v[C['Status'] - 1] !== 'approved' || !v[C['Issue #'] - 1]) return;
    let issue;
    try { issue = gh_('GET', `/repos/${CONFIG.REPO}/issues/${v[C['Issue #'] - 1]}`); } catch (e) { console.error(e); return; }
    if (issue.state !== 'closed' || !issue.labels.some(l => l.name === CONFIG.SHIPPED_LABEL)) return;
    const row = i + 2;
    sh.getRange(row, C['Status']).setValue('shipped');
    if (v[C['Wants email'] - 1] === 'yes' && v[C['Reporter email'] - 1] && !v[C['Reporter notified'] - 1]) {
      const version = shippedVersion_(v[C['Issue #'] - 1]);
      sendShippedEmail_(v[C['Reporter email'] - 1], v[C['Type'] - 1], v[C['Title'] - 1], version, issue.html_url);
      sh.getRange(row, C['Reporter notified']).setValue(new Date());
    }
  });
}

function shippedVersion_(num) {
  try {
    const comments = gh_('GET', `/repos/${CONFIG.REPO}/issues/${num}/comments?per_page=50`);
    for (let i = comments.length - 1; i >= 0; i--) { const m = /Margin version (\d+)/i.exec(comments[i].body || ''); if (m) return m[1]; }
  } catch (e) {}
  return '';
}

function sendShippedEmail_(to, kind, title, version, issueUrl) {
  const what = kind === 'bug' ? 'The bug you reported' : 'The feature you suggested';
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;color:#1d1d1f;line-height:1.5">
    <h2 style="margin:0 0 10px">It’s live in Margin 🎉</h2>
    <p>${what}, <b>“${esc_(title)}”</b>, is now ${kind === 'bug' ? 'fixed' : 'available'}${version ? ` in Margin version ${esc_(version)}` : ''}. Thank you for helping make Margin better!</p>
    <p><b>To see it:</b></p>
    <ol>
      <li>Open Margin from your Home Screen (or go to <a href="${CONFIG.APP_URL}">${CONFIG.APP_URL}</a>).</li>
      <li>If you don’t see the change yet, close Margin completely (swipe it away in the app switcher) and open it again.</li>
      <li>${version ? `Tap the ⚙︎ Settings button — it should say <b>Margin version ${esc_(version)}</b>.` : 'Tap the ⚙︎ Settings button to check you have the latest version.'}</li>
    </ol>
    <p style="color:#6e6e73;font-size:13px">Details: <a href="${issueUrl}">${issueUrl}</a><br>You’re getting this because you asked to be told when your feedback was done. We won’t email you again about it.</p>
  </div>`;
  MailApp.sendEmail({ to, subject: `Your Margin ${kind === 'bug' ? 'bug report' : 'idea'} is live: ${title}`.slice(0, 180), htmlBody: html, name: 'Margin' });
}

/* ---------------------------------------------------------------- helpers */

function gh_(method, path, body) {
  const token = prop_('GITHUB_TOKEN', true);
  const res = UrlFetchApp.fetch('https://api.github.com' + path, {
    method, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'margin-feedback' },
    payload: body ? JSON.stringify(body) : undefined,
  });
  const code = res.getResponseCode(), text = res.getContentText();
  if (code >= 300) throw new Error(`GitHub ${method} ${path.split('?')[0]} failed (${code}): ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}
function prop_(k, required) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v && required !== false) throw new Error(k === 'GITHUB_TOKEN' ? 'GITHUB_TOKEN is missing — add it under Project Settings → Script properties.' : `Run setup() first (missing ${k}).`);
  return v;
}
function sheet_() { return SpreadsheetApp.openById(prop_('SHEET_ID')).getSheets()[0]; }
function findRow_(sh, id) {
  const last = sh.getLastRow(); if (last < 2) return 0;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}
function sig_(id) { return Utilities.computeHmacSha256Signature(String(id), prop_('SECRET')).map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join(''); }
function validSig_(id, sig) { return !!id && !!sig && sig_(id) === String(sig); }
function reviewUrl_(id) { return ScriptApp.getService().getUrl() + '?a=review&id=' + encodeURIComponent(id) + '&sig=' + sig_(id); }
function clean_(s, max) { return String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max); }
function safeName_(n) { return String(n).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+/, '').slice(0, 60) || 'file'; }
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function page_(title, inner) {
  return HtmlService.createHtmlOutput(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:32px auto;padding:0 18px;color:#1d1d1f;background:#f6f5f1}
    h1{font-size:22px;margin:4px 0 12px}.k{color:#6e6e73;margin:0}.d{white-space:pre-wrap;background:#fff;border-radius:12px;padding:14px;border:1px solid #e4e2db}
    .b{display:flex;gap:10px;margin:22px 0 8px}button{font:inherit;font-weight:600;padding:12px 18px;border-radius:10px;border:1px solid #d6d3ca;background:#fff;cursor:pointer}
    button.pri{background:#2d5be3;color:#fff;border-color:#2d5be3}button.red{background:#d0362b;border-color:#d0362b}button:disabled{opacity:.5}.s{color:#3a3a3c}a{color:#2d5be3}
  </style></head><body>${inner}</body></html>`).setTitle(title).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
