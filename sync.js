// Automatic backup to a private GitHub repository (optional). Token/passphrase stay on this device only.
const GH_KEY = 'mft-gh';
const GH_MAGIC = [77, 70, 84, 69, 78, 67, 49]; // "MFTENC1"
const ghCfg = () => { try { return JSON.parse(localStorage.getItem(GH_KEY) || '{}'); } catch (e) { return {}; } };
const ghSet = c => { try { localStorage.setItem(GH_KEY, JSON.stringify(c)); } catch (e) { } };
async function ghKey(pass, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function ghEncrypt(bytes, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await ghKey(pass, salt), bytes));
  const out = new Uint8Array(7 + 16 + 12 + ct.length); out.set(GH_MAGIC, 0); out.set(salt, 7); out.set(iv, 23); out.set(ct, 35); return out;
}
async function ghDecrypt(u8, pass) {
  const salt = u8.slice(7, 23), iv = u8.slice(23, 35), ct = u8.slice(35);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await ghKey(pass, salt), ct));
}
const ghIsEnc = u8 => GH_MAGIC.every((b, i) => u8[i] === b);
function ghB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
let ghBusy = false;
async function ghBackup(manual) {
  const c = ghCfg(); if (ghBusy) return;
  if (!c.repo || !c.token) { if (manual) toast('Set up GitHub backup first'); return; }
  if (!S.accounts.length && !S.tx.length) { if (manual) toast('Nothing to back up yet'); return; }
  if (typeof XLSX === 'undefined') { if (manual) toast('Excel library not loaded'); return; }
  ghBusy = true; if (manual) toast('Backing up…');
  try {
    let bytes = new Uint8Array(XLSX.write(buildWorkbook(), { type: 'array', bookType: 'xlsx' }));
    if (c.pass) bytes = await ghEncrypt(bytes, c.pass);
    const path = 'backups/MyFinTracker-latest.xlsx' + (c.pass ? '.enc' : '');
    const url = `https://api.github.com/repos/${c.repo}/contents/${path}`;
    const h = { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    let sha; const g = await fetch(url, { headers: h });
    if (g.ok) sha = (await g.json()).sha; else if (g.status !== 404) throw new Error('GitHub says ' + g.status + (g.status === 401 ? ' – token is wrong or expired' : g.status === 403 ? ' – token lacks permission' : ''));
    const r = await fetch(url, { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Backup ' + new Date().toISOString(), content: ghB64(bytes), ...(sha ? { sha } : {}) }) });
    if (!r.ok) throw new Error('GitHub says ' + r.status + (r.status === 404 ? ' – repository not found (check name and token access)' : r.status === 403 || r.status === 401 ? ' – token lacks permission' : ''));
    ghSet({ ...ghCfg(), last: Date.now(), err: '' }); if (manual) toast('Backed up to GitHub ✓');
  } catch (e) {
    ghSet({ ...ghCfg(), err: String(e.message || e) }); if (manual) toast('Backup failed: ' + (e.message || e));
  } finally { ghBusy = false; try { if (typeof page === 'function' && page()?.name === 'data') render(); } catch (e) { } }
}
function ghAuto() {
  try {
    const c = ghCfg(); if (!c.on || !c.repo || !c.token || document.hidden || !navigator.onLine) return;
    if (!c.last || Date.now() - c.last > 20 * 3600e3) ghBackup(false);
  } catch (e) { }
}
function ghCard() {
  const c = ghCfg(); const st = c.repo && c.token ? (c.on ? 'On' : 'Off') : 'Not set up';
  return `<div class="card"><h3>Automatic backup to GitHub</h3><p class="mut" style="margin:0 0 10px;font-size:.88em">Status: <b>${st}</b>${c.repo ? ' · ' + esc(c.repo) : ''}${c.pass ? ' · encrypted' : ''}.<br>Last upload: ${c.last ? new Date(c.last).toLocaleString() : 'never'}.${c.err ? `<br><span class="exp">Last error: ${esc(c.err)}</span>` : ''}<br>Uploads once a day, the first time you open the app after 20 hours.</p>
  <div class="btns"><button class="btn sec" data-a="ghsetup">Set up</button><button class="btn" data-a="ghnow">Back up now</button></div></div>`;
}
function ghForm() {
  const c = ghCfg();
  form('GitHub backup', [
    { k: 'repo', label: 'Private repository (owner/name)', value: c.repo || 'mhkorai/MyFinTracker-Data', ph: 'mhkorai/MyFinTracker-Data' },
    { k: 'token', label: c.token ? 'Access token (saved – leave empty to keep)' : 'Access token (fine-grained, Contents: read and write)', type: 'password', value: '' },
    { k: 'pass', label: 'Encryption passphrase (optional – keep it safe, it cannot be recovered)', type: 'password', value: c.pass || '' },
    { k: 'on', label: 'Back up automatically', type: 'checkbox', value: c.on !== false }], v => {
      const repo = v.repo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return 'Enter the repository as owner/name';
      const token = v.token || c.token; if (!token) return 'Paste your access token';
      ghSet({ ...c, repo, token, pass: v.pass || '', on: v.on, err: '' });
      setTimeout(() => ghBackup(true), 200);
    }, { ok: 'Save and back up now' });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(ghAuto, 1500); });
window.addEventListener('load', () => setTimeout(ghAuto, 4000));
