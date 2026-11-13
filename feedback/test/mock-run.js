// Runs feedback/Code.gs against mocked Google services to check the full flow. `node feedback/test/mock-run.js`
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const cacheMap = {}; const cacheStore = { get: k => cacheMap[k], put: (k, v) => { cacheMap[k] = v; } };
const props = {}, files = {}, mails = [], gh = [], sheetRows = [];
let triggers = [];
const blob = (bytes, type, name) => ({ bytes, type, name, getBytes: () => bytes, getContentType: () => type });
const range = (r, c, nr = 1, nc = 1) => ({
  setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { (sheetRows[r - 1 + i] ||= [])[c - 1 + j] = x; })); return this; },
  setFontWeight() { return this; }, setValue(x) { (sheetRows[r - 1] ||= [])[c - 1] = x; return this; },
  getValue() { return (sheetRows[r - 1] || [])[c - 1] ?? ''; },
  getValues() { return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (sheetRows[r - 1 + i] || [])[c - 1 + j] ?? '')); },
});
const sheet = { setName() {}, getRange: range, setFrozenRows() {}, setColumnWidth() {}, getLastRow: () => sheetRows.length, appendRow(v) { sheetRows.push(v.slice()); } };
const ss = { getSheets: () => [sheet], getId: () => 'SHEET1', getUrl: () => 'https://docs.google.com/spreadsheets/d/SHEET1' };
let issueState = { state: 'open', labels: [{ name: 'approved-feedback' }] };
const ctx = {
  console, JSON, Date, Math, String, Number, Object, Array, encodeURI, encodeURIComponent, RegExp, Error,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
  SpreadsheetApp: { create: () => ss, openById: () => ss },
  DriveApp: {
    createFolder: () => ({ getId: () => 'FOLDER1' }),
    getFolderById: () => ({ getUrl: () => 'https://drive/FOLDER1', createFile: b => { const id = 'F' + Object.keys(files).length; files[id] = b; return { getId: () => id }; } }),
    getFileById: id => ({ getBlob: () => files[id] }),
  },
  Utilities: {
    getUuid: () => crypto.randomUUID(), base64Decode: s => [...Buffer.from(s, 'base64')], base64Encode: b => Buffer.from(b).toString('base64'),
    newBlob: blob, formatDate: (d, tz, f) => new Date(d).toISOString().slice(0, 13),
    computeHmacSha256Signature: (v, k) => [...crypto.createHmac('sha256', k).update(v).digest()].map(x => x > 127 ? x - 256 : x),
  },
  CacheService: { getScriptCache: () => cacheStore },
  LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
  MailApp: { sendEmail: o => mails.push(o) },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/XYZ/exec' }), getProjectTriggers: () => triggers,
    newTrigger: fn => ({ timeBased: () => ({ everyHours: () => ({ create: () => triggers.push({ getHandlerFunction: () => fn }) }) }) }) },
  UrlFetchApp: { fetch(url, o) {
    const p = url.replace('https://api.github.com', ''), body = o.payload ? JSON.parse(o.payload) : null; gh.push([o.method, p, body]);
    const ok = (code, obj) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(obj) });
    if (/git\/ref\/heads\/feedback-media/.test(p)) return gh.filter(x => x[1].endsWith('/git/refs')).length ? ok(200, {}) : ok(404, { message: 'Not Found' });
    if (/git\/ref\/heads\/main/.test(p)) return ok(200, { object: { sha: 'abc' } });
    if (o.method === 'GET' && /\/repos\/[^/]+\/[^/]+$/.test(p)) return ok(200, { default_branch: 'main', full_name: 'GavinDPinto/margin', permissions: { push: true } });
    if (/\/issues\/7\/comments/.test(p)) return ok(200, [{ body: 'Shipped in Margin version 6 (commit abc).' }]);
    if (o.method === 'GET' && /\/issues\/7$/.test(p)) return ok(200, { ...issueState, html_url: 'https://github.com/GavinDPinto/margin/issues/7' });
    if (o.method === 'POST' && /\/issues$/.test(p)) return ok(201, { number: 7, html_url: 'https://github.com/GavinDPinto/margin/issues/7' });
    return ok(200, {});
  } },
  HtmlService: { createHtmlOutput: h => ({ html: h, setTitle() { return this; }, addMetaTag() { return this; } }) },
  ContentService: { createTextOutput: t => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
  Logger: { log: m => console.log('   log:', m) },
};
vm.createContext(ctx); vm.runInContext(code, ctx);
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('PASS', m); };
const run = s => vm.runInContext(s, ctx);

run('setup()');
assert(props.SHEET_ID && props.FOLDER_ID && props.SECRET && triggers.length === 1, 'setup creates sheet, folder, secret, hourly trigger');
run('setup()'); assert(triggers.length === 1, 'setup is idempotent');
props.GITHUB_TOKEN = 'test-token';

const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
const post = d => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(d) } }).text);
const report = { id: 'abc-123', kind: 'feature', title: 'Ruler tool', description: 'Please add a ruler @someone\n~~~~ break out', email: 'kid@example.com', notify: true,
  meta: { version: '5 · x', ua: 'iPad', screen: '820x1180', standalone: true, pencil: true },
  files: [{ name: 'shot.png', type: 'image/png', data: png }, { name: 'evil.exe', type: 'application/x-msdownload', data: png }] };
assert(post(report).ok === true, 'doPost accepts a report');
assert(post(report).duplicate === true, 'duplicate report ignored');
assert(sheetRows.length === 2 && sheetRows[1][2] === 'pending' && sheetRows[1][7] === 'kid@example.com', 'row logged as pending with private email');
assert(JSON.parse(sheetRows[1][6]).length === 1, 'only image/video attachments saved');
assert(mails.length === 1 && mails[0].to === 'owner@example.com' && /Approve/.test(mails[0].htmlBody) && mails[0].inlineImages.img0, 'owner gets approval email with image preview');
assert(post({ id: 'x', title: '', description: '' }).ok === false, 'empty report rejected');

const url = /href="([^"]+)&do=approve"/.exec(mails[0].htmlBody)[1];
const q = Object.fromEntries(new URL(url).searchParams);
assert(/Approve &amp; create GitHub issue/.test(ctx.doGet({ parameter: { ...q, do: 'approve' } }).html), 'review page asks for a tap');
assert(/invalid/.test(ctx.doGet({ parameter: { ...q, sig: 'bad' } }).html), 'forged link rejected');
assert(ctx.decide(q.id, 'bad', 'approve').ok === false, 'forged decide rejected');
const r = ctx.decide(q.id, q.sig, 'approve');
assert(r.ok && r.number === 7, 'approve creates issue #7');
const issueCall = gh.find(x => x[0] === 'POST' && x[1].endsWith('/issues'));
assert(issueCall[2].labels.includes('approved-feedback') && issueCall[2].labels.includes('enhancement'), 'issue labelled approved-feedback + enhancement');
assert(!issueCall[2].body.includes('kid@example.com'), 'reporter email NOT in public issue');
assert(issueCall[2].body.includes('~~~~text') && !/\n~~~~ break out/.test(issueCall[2].body), 'user text fenced (no mentions / breakout)');
assert(gh.some(x => x[1].endsWith('/git/refs')) && gh.some(x => x[0] === 'PUT' && /contents\/media\/abc-123\/1-shot.png/.test(x[1])), 'media branch created + screenshot uploaded');
assert(/raw=true/.test(issueCall[2].body), 'issue embeds screenshot');
assert(ctx.decide(q.id, q.sig, 'approve').ok === false, 'cannot approve twice');
assert(sheetRows[1][2] === 'approved' && sheetRows[1][11] === 7, 'sheet updated with issue #');

ctx.checkShipped(); assert(mails.length === 1, 'no reporter email while issue open');
const ping1 = JSON.parse(ctx.doGet({ parameter: { a: 'check' } }).text);
assert(ping1.ok && ping1.notified === 0, 'ping endpoint runs the check (nothing shipped yet)');
const ping2 = JSON.parse(ctx.doGet({ parameter: { a: 'check' } }).text);
assert(ping2.skipped, 'ping is rate-limited to once a minute');
delete cacheMap['check-ping'];
issueState = { state: 'closed', labels: [{ name: 'shipped' }] };
const ping3 = JSON.parse(ctx.doGet({ parameter: { a: 'check' } }).text);
assert(ping3.notified === 1, 'ping emails the reporter as soon as it ships');
assert(mails.length === 2 && mails[1].to === 'kid@example.com' && /version 6/.test(mails[1].htmlBody), 'reporter emailed once shipped (with version + steps)');
ctx.checkShipped(); assert(mails.length === 2, 'reporter emailed only once');

// reject with a reason → polite email to a reporter who opted in
post({ id: 'rej-2', kind: 'feature', title: 'Sync with friends', description: 'collab', email: 'pal@example.com', notify: true });
const u3 = new URL(/href="([^"]+)&do=approve"/.exec(mails[mails.length - 1].htmlBody)[1]).searchParams;
const page = ctx.doGet({ parameter: { a: 'review', id: u3.get('id'), sig: u3.get('sig'), do: 'reject' } }).html;
assert(/Reject with a reason/.test(page) && /Email preview/.test(page) && /Thank you so much/.test(page), 'reject page shows reason box + email preview');
if (process.env.DUMP_REVIEW) fs.writeFileSync(process.env.DUMP_REVIEW, page.replace('<script>', '<script>window.google={script:{run:{withSuccessHandler(){return this},withFailureHandler(){return this},decide(){}}}};'));
const scriptJs = /<script>([\s\S]*?)<\/script>/.exec(page)[1];
try { new Function(scriptJs); assert(true, 'review page script is valid JS'); } catch (e) { assert(false, 'review page script is valid JS: ' + e.message); }
const before = mails.length;
const rr = ctx.decide(u3.get('id'), u3.get('sig'), 'reject', 'Thanks! Notes stay <on your device>, so syncing isn\'t possible yet.', true);
const rm = mails[mails.length - 1];
assert(rr.ok && rr.emailed && mails.length === before + 1 && rm.to === 'pal@example.com', 'reject emails the reporter');
assert(/Thank you so much/.test(rm.htmlBody) && /decided not to add this/.test(rm.htmlBody) && /&lt;on your device&gt;/.test(rm.htmlBody) && /About your Margin idea/.test(rm.subject), 'rejection email is polite and includes the (escaped) note');
const rrow = sheetRows.find(r => r[0] === u3.get('id'));
assert(rrow[2] === 'rejected' && /syncing/.test(rrow[15]) && rrow[13], 'sheet stores status, owner note, notified time');
assert(ctx.decide(u3.get('id'), u3.get('sig'), 'reject', 'again', true).ok === false && mails.length === before + 1, 'no second rejection email');
post({ id: 'rej-1', kind: 'bug', title: 'meh', description: 'x', email: '', notify: true });
const u2 = new URL(/href="([^"]+)&do=approve"/.exec(mails.find(m => /meh/.test(m.subject)).htmlBody)[1]).searchParams;
const nm = mails.length;
const rj = ctx.decide(u2.get('id'), u2.get('sig'), 'reject', 'not now', true);
assert(rj.ok && !rj.emailed && mails.length === nm && sheetRows.find(r => r[0] === 'rej-1')[2] === 'rejected', 'reject without opted-in email sends nothing');
assert(sheetRows.find(r => r[0] === 'rej-1')[8] === 'no', 'notify ignored without email');
console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nAll checks passed');
