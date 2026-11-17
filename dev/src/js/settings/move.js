// Moving notes from an old address (gavindpinto.github.io/margin) to Margin's home at margin.gavinpinto.ca.
// Notes live in the browser per web address, so they're carried over with a backup file: save on the old
// address, then "Bring my notes over" on the new one. Nothing is ever deleted automatically.
import { icon } from '../core/icons.js';
import { $ } from '../core/util.js';
import { HOME_URL, OLD_HOSTS } from '../core/version.js';
import { modal } from '../ui/dialogs.js';
import { exportBackup, importBackup } from './settings.js';

const flag = k => { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } }; // test hooks
export const homeHost = () => new URL(HOME_URL).host;
export const isOldHome = () => OLD_HOSTS.includes(location.hostname) || flag('margin.testOldHome');
export const isNewHome = () => location.host === homeHost() || flag('margin.testNewHome');

/** True once the new address is actually serving Margin (so we never point people at a page that isn't there yet). */
export async function newHomeReady() {
  if (flag('margin.testMoveReady')) return true;
  try {
    const r = await fetch(HOME_URL + 'manifest.webmanifest', { cache: 'no-store' });
    return r.ok && (await r.text()).includes('"Margin"');
  } catch (e) { return false; }
}
export async function checkMove() {
  if (!isOldHome()) return;
  if (await newHomeReady()) showMoveBanner();
}
export function showMoveBanner() {
  if ($('#move-banner')) return;
  const b = document.createElement('div'); b.id = 'move-banner'; b.className = 'move-banner';
  b.innerHTML = `<span>🏠 <b>Margin has a new home: ${homeHost()}</b><br>Your notes are still safe here. Move them over in a couple of taps.</span><button class="btn primary" data-move>Move my notes</button>`;
  b.querySelector('[data-move]').addEventListener('click', moveDialog);
  const lib = $('#library'), bar = $('.lib-bar', lib);
  lib.insertBefore(b, bar);
}
export function moveDialog() {
  const body = document.createElement('div');
  body.innerHTML = `<ol class="move-steps">
      <li><b>Save your notes</b> to one backup file. When iPad asks, choose <b>Save to Files</b>.<br><button class="btn primary" data-a="save">${icon('download')}Save my notes</button></li>
      <li><b>Open the new Margin</b> at <a href="${HOME_URL}" target="_blank" rel="noopener">${homeHost()}</a>, tap <b>Bring my notes over</b>, and pick the backup file you just saved.</li>
      <li><b>Add the new Margin to your Home Screen</b> (Share → Add to Home Screen). Once your notes show up there, you can remove the old icon.</li>
    </ol>
    <p class="muted">Nothing is deleted here. Your notes stay on this old address until you remove it yourself.</p>`;
  body.addEventListener('click', e => { if (e.target.closest('[data-a="save"]')) exportBackup(); });
  modal({ title: 'Move your notes to the new Margin', body, wide: true, buttons: [{ label: 'Close', value: null }] });
}
/** Button shown on the new address when it has no notes yet. */
export const bringNotesButton = () => `<button class="btn" data-act="bring-notes">${icon('upload')}Bring my notes over</button>`;
export function bringNotesOver() { importBackup(); }
