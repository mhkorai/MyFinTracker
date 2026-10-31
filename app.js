'use strict';
/* Expense Tracker – offline personal finance app. All data stays on this device (IndexedDB). */

// ───────────────────────── helpers ─────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const DAY = 864e5;
const PALETTE = ['#0f766e', '#2563eb', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#65a30d', '#db2777', '#4f46e5', '#ea580c', '#059669', '#7c3aed', '#be123c', '#0369a1', '#a16207'];
const ACC_ICONS = ['💵', '💳', '🏦', '👛', '🪙', '💰', '🏠', '🚗', '🛒', '🎁', '📈', '💼', '📱', '🎟️'];
const PRESET_CUR = [['SAR', 'Saudi Riyal', 2], ['USD', 'US Dollar', 2], ['EUR', 'Euro', 2], ['GBP', 'British Pound', 2], ['AED', 'UAE Dirham', 2],
['INR', 'Indian Rupee', 2], ['PKR', 'Pakistani Rupee', 2], ['KWD', 'Kuwaiti Dinar', 3], ['QAR', 'Qatari Riyal', 2], ['BHD', 'Bahraini Dinar', 3],
['OMR', 'Omani Rial', 3], ['EGP', 'Egyptian Pound', 2], ['TRY', 'Turkish Lira', 2], ['JPY', 'Japanese Yen', 0], ['CNY', 'Chinese Yuan', 2],
['CAD', 'Canadian Dollar', 2], ['AUD', 'Australian Dollar', 2], ['CHF', 'Swiss Franc', 2]];
const DEFAULT_EXP = [["Auto", ["Auto Insurance", "Taxes/Fees", "Maintenance", "Car Purchase", "Repair", "Fuel"]], ["Bank", ["Commission", "Bank Service Fees", "Interest"]],
["Home", ["Furniture Purchase", "Dishes Purchase", "Repair", "Appliances"]], ["Pets", ["Pet Food Purchase"]], ["Other"], ["Friends"], ["Food", ["Cafe", "Lunch", "Groceries", "Restaurant"]],
["Utilities", ["Water", "Garbage Disposal", "Gas", "Land Tax", "Cable TV", "Rent", "Heating", "Home Insurance", "Phone", "Electricity"]],
["Beauty & Health", ["Dentist", "Cosmetologist", "Treatment", "Massage", "Hairdresser", "Sauna", "Life Insurance", "Health Insurance"]],
["Loans", ["Car Loan", "Housing Loan"]], ["Personal", ["Charity", "Gifts"]], ["Taxes/Fees"], ["Education"], ["Clothes"], ["Vacation", ["Hotel", "Tour"]],
["Entertainment", ["Party", "Cinema", "Club", "Concert"]], ["Family"], ["Sports", ["Pool", "Billiards", "Bowling", "Exercise Equipment Purchase", "Gym"]],
["Transport", ["Car Rental", "Public Transport", "Train", "Plane", "Taxi"]], ["Services", ["Internet", "Mobile"]]];
const DEFAULT_INC = [["Other"], ["Salary"], ["Gift"]];
const REPEATS = [['none', 'No repeat'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly'], ['yearly', 'Yearly']];

function defaultState() {
  const S = { v: 1, settings: { theme: 'auto', defCur: null, pin: null, fs: 16, compact: false, setup: false, lastBackup: 0, catAbove: false },
    currencies: [], accounts: [], categories: [], tx: [], templates: [], planned: [], budgets: [], debts: [], groups: [] };
  let order = 0;
  const add = (list, type) => list.forEach(([n, kids]) => {
    const id = uid(); S.categories.push({ id, name: n, type, parentId: null, order: order++ });
    (kids || []).forEach(k => S.categories.push({ id: uid(), name: k, type, parentId: id, order: order++ }));
  });
  add(DEFAULT_EXP, 'expense'); add(DEFAULT_INC, 'income');
  return S;
}

// ───────────────────────── storage ─────────────────────────
let S, saveTimer;
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('expense-tracker', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function idbSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function load() {
  let st = null;
  try { st = await idbGet('state'); } catch (e) { }
  if (!st) { try { const j = localStorage.getItem('state'); if (j) st = JSON.parse(j); } catch (e) { } }
  S = st || defaultState();
  if (!S.settings.theme) S.settings.theme = 'auto';
  if (!S.groups) S.groups = [];
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await idbSet('state', S); } catch (e) { try { localStorage.setItem('state', JSON.stringify(S)); } catch (e2) { toast('Could not save data!'); } }
  }, 120);
}
function flush() { return idbSet('state', S).catch(() => { }); }

// ───────────────────────── model helpers ─────────────────────────
const cur = id => S.currencies.find(c => c.id === id);
const acc = id => S.accounts.find(a => a.id === id);
const cat = id => S.categories.find(c => c.id === id);
const defCur = () => cur(S.settings.defCur) || S.currencies[0] || { id: '', short: '', dec: 2, rate: 1 };
const rateOf = id => (cur(id) || defCur()).rate || 1;
const toBase = (n, curId) => n * rateOf(curId);
function fmtNum(n, curId) { // accounting style: negatives in brackets, no minus sign
  if (U.hide) return '*****';
  const c = cur(curId) || defCur();
  const f = Math.pow(10, c.dec); const rounded = Math.round(Math.abs(n) * f) / f;
  const t = rounded.toLocaleString('en-US', { minimumFractionDigits: c.dec, maximumFractionDigits: c.dec });
  return rounded > 0 && n < 0 ? `(${t})` : t;
}
function fmt(n, curId, signed) {
  const c = cur(curId) || defCur(); const t = fmtNum(n, curId); if (U.hide) return t + ' ' + (c.short || '');
  return t.startsWith('(') ? `(${t.slice(1, -1)} ${c.short || ''})` : t + ' ' + (c.short || '');
}
const fmtB = (n, signed) => fmt(n, defCur().id, signed);
// per-currency totals (no conversion between currencies)
const addBy = (m, curId, v) => { const k = (cur(curId) || defCur()).id; m.set(k, (m.get(k) || 0) + v); return m; };
function fmtMulti(m, fb) {
  const e = [...m].filter(([, v]) => Math.abs(v) > 0.0000001).sort((a, b) => (a[0] === defCur().id ? -1 : b[0] === defCur().id ? 1 : (cur(a[0])?.short || '').localeCompare(cur(b[0])?.short || '')));
  const row = (k, v) => `<span class="mrow"><span class="mc">${esc((cur(k) || defCur()).short || '')}</span><span class="ma">${fmtNum(v, k)}</span></span>`;
  return e.length ? e.map(([k, v]) => row(k, v)).join('') : row(fb || defCur().id, 0);
}
function catPath(id) {
  const c = cat(id); if (!c) return '—';
  const p = []; let x = c, g = 0;
  while (x && g++ < 6) { p.unshift(x.name); x = x.parentId ? cat(x.parentId) : null; }
  return p.join(' › ');
}
function catDepth(c) { let d = 0, x = c; while (x && x.parentId && d < 6) { d++; x = cat(x.parentId); } return d; }
function catRoot(id) { let x = cat(id), g = 0; while (x && x.parentId && g++ < 6) x = cat(x.parentId); return x; }
function catDescendants(id) { const out = [id]; S.categories.forEach(c => { if (c.parentId === id) out.push(...catDescendants(c.id)); }); return out; }
function catSorted(type) {
  const out = [];
  const walk = (pid, d) => S.categories.filter(c => c.type === type && (c.parentId || null) === pid).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .forEach(c => { out.push(c); walk(c.id, d + 1); });
  walk(null, 0); return out;
}
function color(id) { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
function balances() {
  const m = {}, cut = {}; S.accounts.forEach(a => { m[a.id] = a.opening || 0; cut[a.id] = a.asOf || 0; });
  // transactions dated on/before an account's "balance as of" moment are history only (already inside its stored balance)
  const on = (id, t) => !(cut[id] >= t.date);
  S.tx.forEach(t => {
    if (t.type === 'income') { if (on(t.accountId, t)) m[t.accountId] = (m[t.accountId] ?? 0) + t.sum; }
    else if (t.type === 'expense') { if (!t.prepayId && !t.noBal && on(t.accountId, t)) m[t.accountId] = (m[t.accountId] ?? 0) - t.sum; }
    else if (t.type === 'prepayment') { if (on(t.accountId, t)) m[t.accountId] = (m[t.accountId] ?? 0) - t.sum; }
    else if (t.type === 'transfer') { if (on(t.accountId, t)) m[t.accountId] = (m[t.accountId] ?? 0) - t.sum; if (on(t.toAccountId, t)) m[t.toAccountId] = (m[t.toAccountId] ?? 0) + (t.toSum ?? t.sum); }
  });
  return m;
}
const prepayList = () => S.tx.filter(t => t.type === 'prepayment');
const prepay = id => S.tx.find(t => t.id === id && t.type === 'prepayment');
const prepayUsed = (id, ex) => { const e = ex instanceof Set ? ex : new Set([ex]); return S.tx.filter(t => t.prepayId === id && !e.has(t.id)).reduce((s, t) => s + t.sum, 0); };
const prepayLeft = (p, exceptTx) => p.sum - prepayUsed(p.id, exceptTx);
const resolveAcc = v => String(v || '').startsWith('pp:') ? acc(prepay(v.slice(3))?.accountId) : acc(v);
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => { d = new Date(d); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
const hm = d => { d = new Date(d); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
const dtLocal = d => ymd(d) + 'T' + hm(d);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const startOfDay = d => { d = new Date(d); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
function dayLabel(ms) {
  const d = startOfDay(ms), t = startOfDay(Date.now());
  const diff = Math.round((t - d) / DAY);
  if (diff === 0) return 'Today'; if (diff === 1) return 'Yesterday'; if (diff === -1) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
}
function addPeriod(ms, rule) {
  const d = new Date(ms);
  if (rule === 'daily') d.setDate(d.getDate() + 1);
  else if (rule === 'weekly') d.setDate(d.getDate() + 7);
  else if (rule === 'biweekly') d.setDate(d.getDate() + 14);
  else if (rule === 'monthly') { const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + 1); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
  else if (rule === 'yearly') d.setFullYear(d.getFullYear() + 1);
  return +d;
}

// period model
function rangeOf(p) {
  const r = new Date(p.ref); let a, b;
  if (p.kind === 'all') return [0, 8.64e15];
  if (p.kind === 'custom') return [+startOfDay(p.from || Date.now()), +startOfDay(p.to || Date.now()) + DAY];
  if (p.kind === 'day') { a = startOfDay(r); b = new Date(+a + DAY + 36e5); b = startOfDay(b); }
  else if (p.kind === 'week') { a = new Date(r.getFullYear(), r.getMonth(), r.getDate() - r.getDay()); b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7); }
  else if (p.kind === 'year') { a = new Date(r.getFullYear(), 0, 1); b = new Date(r.getFullYear() + 1, 0, 1); }
  else { a = new Date(r.getFullYear(), r.getMonth(), 1); b = new Date(r.getFullYear(), r.getMonth() + 1, 1); }
  return [+a, +b];
}
function periodLabel(p) {
  const r = new Date(p.ref);
  if (p.kind === 'all') return 'All time';
  if (p.kind === 'custom') return ymd(p.from || Date.now()) + ' → ' + ymd(p.to || Date.now());
  if (p.kind === 'day') return dayLabel(r);
  if (p.kind === 'year') return String(r.getFullYear());
  if (p.kind === 'week') { const [a, b] = rangeOf(p); return new Date(a).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' – ' + new Date(b - 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
  return MONTHS[r.getMonth()] + ' ' + r.getFullYear();
}
function shiftPeriod(p, dir) {
  const r = new Date(p.ref);
  if (p.kind === 'day') r.setDate(r.getDate() + dir);
  else if (p.kind === 'week') r.setDate(r.getDate() + 7 * dir);
  else if (p.kind === 'year') r.setFullYear(r.getFullYear() + dir);
  else if (p.kind === 'month') { r.setDate(1); r.setMonth(r.getMonth() + dir); }
  p.ref = +r;
}

// ───────────────────────── UI state ─────────────────────────
const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10.5 7 10.5 7a17 17 0 0 1-3.2 4M6.5 6.6C3.6 8.4 1.5 12 1.5 12S5.5 19 12 19c1.6 0 3-.4 4.3-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const U = { hide: false, tab: 'home', stack: [], ph: { kind: 'all', ref: Date.now(), from: null, to: null, sel: 'all' }, pr: { kind: 'month', ref: Date.now(), from: null, to: null },
  hf: { type: 'all', acc: '', cat: '', q: '' }, rep: { type: 'pie-exp', acc: '', leaf: false }, hideZero: true, catType: 'expense' };
const page = () => U.stack[U.stack.length - 1] || null;
function go(name, arg) { U.sortAcc = false; U.sortCat = false; U.stack.push({ name, arg }); render(); window.scrollTo(0, 0); }
function back() { U.sortAcc = false; U.sortCat = false; U.stack.pop(); render(); }
function tab(t) { U.tab = t; U.stack = []; render(); window.scrollTo(0, 0); }

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2200); }
function sheet(html) { $('#sheet-root').innerHTML = `<div class="back" id="sback"><div class="sheet">${html}</div></div>`; enhanceAccSelects(); }
// account drop-downs show the real icons: selects that only contain accounts get a custom picker
function enhanceCatSelects() {
  const sel = $('#sheet-root select#t_cat'); if (!sel) return;
  const opts = [...sel.options]; const label = () => catPath(sel.value);
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'accpick';
  const paint = () => { const c = cat(sel.value); btn.innerHTML = `<i class="sw" style="background:${c ? color(catRoot(c.id).id) : 'var(--line)'}"></i><span class="grow">${esc(c ? label() : 'Choose category')}</span><span class="mut">▾</span>`; };
  paint(); sel.style.display = 'none'; sel.parentNode.insertBefore(btn, sel);
  btn.onclick = e => {
    e.preventDefault(); const open = new Set(); const ids = opts.map(o => o.value); const kids = id => ids.filter(x => cat(x)?.parentId === id);
    const ov = document.createElement('div'); ov.className = 'pickov';
    const draw = () => {
      const roots = ids.filter(x => !cat(x)?.parentId || !ids.includes(cat(x).parentId)); const rows = [];
      const walk = (id, d) => { const k = kids(id); rows.push(`<div class="row ${id === sel.value ? 'sel' : ''}" style="padding-left:${d * 22}px">${k.length ? `<button type="button" class="catarrow" data-tg="${id}">${open.has(id) ? '▾' : '▸'}</button>` : '<span class="catarrow"></span>'}<div class="row tap grow" data-pk="${id}" style="padding:0;border:0;gap:10px"><i class="sw" style="background:${color(catRoot(id).id)}"></i><div class="grow t">${esc(cat(id).name)}${cat(id).isDefault ? ' <span class="chip">default</span>' : ''}</div></div></div>`); if (k.length && open.has(id)) k.forEach(x => walk(x, d + 1)); };
      roots.forEach(r => walk(r, 0)); ov.innerHTML = `<div class="pickbox">${rows.join('')}</div>`;
    };
    draw();
    ov.onclick = ev => {
      const tg = ev.target.closest('[data-tg]'); if (tg) { const id = tg.dataset.tg; open.has(id) ? open.delete(id) : open.add(id); const st = ov.firstChild.scrollTop; draw(); ov.firstChild.scrollTop = st; return; }
      const r = ev.target.closest('[data-pk]'); if (r) { sel.value = r.dataset.pk; sel.dispatchEvent(new Event('change', { bubbles: true })); paint(); }
      ov.remove();
    };
    document.body.appendChild(ov);
  };
}
function enhanceAccSelects() {
  enhanceCatSelects();
  $$('#sheet-root select').forEach(sel => {
    const opts = [...sel.options]; if (!opts.length || !opts.every(o => acc(o.value) || o.value.startsWith('pp:'))) return;
    const label = o => { const a = acc(o.value); return a ? `${a.name} (${cur(a.currencyId)?.short || ''})` : o.textContent.trim(); };
    const ic = o => { const a = acc(o.value); return a ? iconDot(a.icon, 32) : '<div class="dot" style="background:#9333ea;width:32px;height:32px">🅿</div>'; };
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'accpick';
    const paint = () => { const o = sel.options[sel.selectedIndex]; btn.innerHTML = `${o ? ic(o) : ''}<span class="grow">${o ? esc(label(o)) : ''}</span><span class="mut">▾</span>`; };
    paint(); sel.style.display = 'none'; sel.parentNode.insertBefore(btn, sel);
    btn.onclick = e => {
      e.preventDefault(); const ov = document.createElement('div'); ov.className = 'pickov'; const open = new Set();
      const rowHtml = (o, i, ind) => `<div class="row tap ${i === sel.selectedIndex ? 'sel' : ''}" data-i="${i}" ${ind ? 'style="padding-left:26px"' : ''}>${ic(o)}<div class="grow t">${esc(label(o))}</div></div>`;
      const draw = () => {
        const used = new Set(); let html = '';
        (S.groups || []).forEach(g => {
          const mem = opts.map((o, i) => [o, i]).filter(([o]) => acc(o.value)?.groupId === g.id); if (!mem.length) return;
          mem.forEach(([, i]) => used.add(i));
          html += `<div class="row tap" data-g="${g.id}"><span class="catarrow">${open.has(g.id) ? '▾' : '▸'}</span>${iconDot(g.icon || '📁', 32)}<div class="grow t">${esc(g.name)}</div><span class="mut" style="font-size:.8em">${mem.length}</span></div>`;
          if (open.has(g.id)) html += mem.map(([o, i]) => rowHtml(o, i, true)).join('');
        });
        html += opts.map((o, i) => used.has(i) ? '' : rowHtml(o, i, false)).join('');
        const st = ov.firstChild ? ov.firstChild.scrollTop : 0; ov.innerHTML = `<div class="pickbox">${html}</div>`; ov.firstChild.scrollTop = st;
      };
      draw();
      ov.onclick = ev => {
        const g = ev.target.closest('[data-g]'); if (g) { const id = g.dataset.g; open.has(id) ? open.delete(id) : open.add(id); draw(); return; }
        const r = ev.target.closest('[data-i]'); if (r) { sel.selectedIndex = +r.dataset.i; sel.dispatchEvent(new Event('change', { bubbles: true })); paint(); } ov.remove();
      };
      document.body.appendChild(ov);
    };
  });
}
function closeSheet() { $('#sheet-root').innerHTML = ''; }
function confirmBox(msg, onYes, yesLabel = 'Delete') {
  sheet(`<h2>${esc(msg)}</h2><div class="btns"><button class="btn sec" data-a="close">Cancel</button><button class="btn danger" id="cyes" style="background:var(--exp);color:#fff">${esc(yesLabel)}</button></div>`);
  $('#cyes').onclick = () => { closeSheet(); onYes(); };
}

// Ask whether a change should also move account balances. keep = apply change but offset opening balances so nothing else changes.
function impactBox(msg, apply, opts = {}) {
  const run = keep => {
    if (keep && opts.alt) { opts.alt(); save(); render(); return; }
    const before = balances(); apply();
    if (keep) { const after = balances(); S.accounts.forEach(a => { const d = (before[a.id] || 0) - (after[a.id] || 0); if (Math.abs(d) > 1e-9) a.opening = Math.round(((a.opening || 0) + d) * 1e6) / 1e6; }); }
    save(); render();
  };
  sheet(`<h2>${esc(msg)}</h2><p class="muted" style="margin:0 0 12px">${esc(opts.hint || 'Should your account balances change too?')}</p><div class="btns"><button class="btn" id="imp1">${esc(opts.yes || 'Yes, update account balances')}</button></div><div class="btns"><button class="btn sec" id="imp0">${esc(opts.no || 'No, keep balances as they are')}</button></div><div class="btns"><button class="btn sec" data-a="close">Cancel</button></div>`);
  $('#imp1').onclick = () => { closeSheet(); run(false); };
  $('#imp0').onclick = () => { closeSheet(); run(true); };
}

// ───────────────────────── rendering ─────────────────────────
function applyTheme() {
  document.documentElement.dataset.theme = S.settings.theme || 'auto';
  document.documentElement.style.setProperty('--fs', (S.settings.fs || 16) + 'px');
  document.body.classList.toggle('compact', !!S.settings.compact);
  const dark = S.settings.theme === 'dark' || (S.settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name=theme-color]').content = dark ? '#0b0f14' : '#0f766e';
}
function render() {
  applyTheme();
  const pg = page();
  let html;
  if (pg) html = renderPage(pg);
  else html = ({ home: viewHome, hist: viewHistory, rep: viewReports, more: viewMore })[U.tab]();
  const tabs = [['home', '🏠', 'Home'], ['hist', '🧾', 'History'], ['add', '+', ''], ['rep', '📊', 'Reports'], ['more', '☰', 'More']];
  html += `<nav class="tabbar"><div>${tabs.map(([k, i, l]) => k === 'add' ? `<button class="fab" data-a="addtx" aria-label="Add">+</button>` :
    `<button class="tab ${U.tab === k && !pg ? 'on' : ''}" data-a="tab" data-v="${k}"><span>${i}</span>${l}</button>`).join('')}</div></nav>`;
  $('#app').innerHTML = html;
  { const tp = $('#app .top'); if (tp) document.documentElement.style.setProperty('--hdrh', tp.offsetHeight + 'px'); }
  bindRender();
}
function header(title, opts = {}) {
  return `<div class="top">${opts.back ? `<button class="back" data-a="back">‹ Back</button>` : ''}<h1>${esc(title)}</h1><button class="icon-btn" data-a="eye" aria-label="${U.hide ? 'Show amounts' : 'Hide amounts'}" title="${U.hide ? 'Show amounts' : 'Hide amounts'}">${U.hide ? EYE_OFF : EYE}</button>${opts.right || ''}</div>`;
}
function emptyMsg(t) { return `<div class="empty">${t}</div>`; }

function collapse(list) {
  const seen = new Set(), out = [];
  list.forEach(t => {
    if (!t.groupId) { out.push(t); return; }
    if (seen.has(t.groupId)) return; seen.add(t.groupId);
    const parts = S.tx.filter(x => x.groupId === t.groupId).sort((a, b) => (a.gi || 0) - (b.gi || 0));
    out.push({ ...parts[0], _parts: parts });
  });
  return out;
}
function txRowHtml(t, opts = {}) {
  const a = acc(t.accountId); const c = cur(a?.currencyId);
  let title, sub, amt, cls, dot, ic;
  if (t.type === 'transfer') {
    const b = acc(t.toAccountId);
    title = t.name || 'Transfer'; sub = `${esc(a?.name)} → ${esc(b?.name)}`; cls = 'tr'; amt = fmt(t.sum, a?.currencyId); ic = '⇄'; dot = 'var(--tr)';
    if (b && b.currencyId !== a?.currencyId) amt += ` → ${fmt(t.toSum, b.currencyId)}`;
  } else if (t.type === 'prepayment') {
    title = t.name || 'Prepayment'; sub = `Prepayment · ${esc(a?.name)} · ${fmt(prepayLeft(t), a?.currencyId)} left`; cls = 'pp'; amt = fmt(-t.sum, a?.currencyId); ic = '🅿'; dot = '#9333ea';
  } else if (t.debtId) {
    const d = S.debts.find(x => x.id === t.debtId);
    const adj = t.debtId === 'adjust';
    title = t.name || (adj ? 'Balance adjustment' : d ? d.name : 'Debt'); sub = `${adj ? 'Balance adjustment' : 'Debt'} · ${esc(a?.name)}`; cls = t.type === 'income' ? 'inc' : 'exp'; amt = fmt(t.type === 'income' ? t.sum : -t.sum, a?.currencyId, true); ic = adj ? '⚖' : '🤝'; dot = adj ? '#64748b' : '#9333ea';
  } else {
    const cc = cat(t.categoryId);
    const cp = cc ? catPath(cc.id) : '—';
    title = S.settings.catAbove ? cp : (t.name || cp);
    sub = (S.settings.catAbove ? (t.name ? esc(t.name) + ' · ' : '') : (t.name ? esc(cp) + ' · ' : '')) + esc(t.prepayId ? 'Prepaid: ' + (prepay(t.prepayId)?.name || '') : a?.name) + (t.desc ? ' · ' + esc(t.desc) : '');
    cls = t.type === 'income' ? 'inc' : 'exp'; amt = fmt(t.type === 'income' ? t.sum : -t.sum, a?.currencyId, true);
    if (t._parts) {
      const same = t._parts.every(x => acc(x.accountId)?.currencyId === a?.currencyId);
      amt = same ? fmt(-t._parts.reduce((s, x) => s + x.sum, 0), a?.currencyId, true) : fmtB(-t._parts.reduce((s, x) => s + toBase(x.sum, acc(x.accountId)?.currencyId), 0), true);
      sub = (S.settings.catAbove ? (t.name ? esc(t.name) + ' · ' : '') : (t.name ? esc(cp) + ' · ' : '')) + '⑂ ' + esc(t._parts.map(x => x.prepayId ? 'Prepaid: ' + (prepay(x.prepayId)?.name || '') : acc(x.accountId)?.name).join(' + ')) + (t.desc ? ' · ' + esc(t.desc) : '');
    }
    ic = esc((cc?.name || '?').charAt(0).toUpperCase()); dot = color(catRoot(t.categoryId)?.id || t.categoryId);
  }
  return `<div class="row tap" data-a="edittx" data-v="${t.id}">${a ? iconDot(a.icon) : `<div class="dot" style="background:${dot}">${ic}</div>`}<div class="grow"><div class="t">${esc(title)}</div><div class="s">${sub}${opts.time ? ' · ' + hm(t.date) : ''}</div></div><div class="amt ${cls}">${amt}</div></div>`;
}

function sumRangeBy(from, to) {
  const inc = new Map(), exp = new Map();
  S.tx.forEach(t => {
    if (t.date < from || t.date >= to || t.type === 'transfer' || t.type === 'prepayment' || t.debtId) return;
    addBy(t.type === 'income' ? inc : exp, acc(t.accountId)?.currencyId, t.sum);
  });
  return { inc, exp };
}
function sumRange(from, to, accId) {
  let inc = 0, exp = 0;
  S.tx.forEach(t => {
    if (t.date < from || t.date >= to || t.type === 'transfer' || t.type === 'prepayment' || t.debtId) return;
    if (accId && t.accountId !== accId) return;
    const a = acc(t.accountId); if ((a?.currencyId || defCur().id) !== defCur().id) return; const v = t.sum;
    if (t.type === 'income') inc += v; else exp += v;
  });
  return { inc, exp };
}

function viewHome() {
  const bal = balances();
  const active = S.accounts.filter(a => a.active !== false);
  const total = active.reduce((m, a) => addBy(m, a.currencyId, bal[a.id] || 0), new Map());
  const now = Date.now();
  let h = header('MyFinTracker', { right: `<button class="icon-btn" data-a="go" data-v="settings" aria-label="Settings">⚙︎</button>` }) + '<div class="wrap">';
  if (S.tx.length && now - (S.settings.lastBackup || 0) > 14 * DAY) {
    h += `<div class="banner">⚠️<b>${S.settings.lastBackup ? 'Last backup was over 2 weeks ago.' : 'No backup yet.'} Your data lives only on this phone.</b><button class="btn sm" data-a="go" data-v="data" style="width:auto">Back up</button></div>`;
  }
  h += `<div class="card tap" data-a="go" data-v="accounts" style="cursor:pointer"><h3 style="display:flex;justify-content:space-between">Total balance <span class="chev" style="text-transform:none;letter-spacing:0">Accounts ›</span></h3><div class="hometot">${fmtMulti(total)}</div></div>`;
  // daily budget
  const db = S.budgets.find(b => b.period === 'daily');
  if (db) { const st = budgetStatus(db); h += `<div class="card"><h3>${st.left >= 0 ? 'Available today' : 'Overspent today'}</h3><div class="big ${st.left >= 0 ? 'inc' : 'exp'}">${fmtB(Math.abs(st.left))}</div></div>`; }
  // upcoming
  const horizon = now + 7 * DAY;
  const up = S.planned.filter(p => p.active !== false && p.date <= horizon).sort((a, b) => a.date - b.date);
  if (up.length) {
    h += `<div class="card"><h3>Upcoming operations</h3>${up.map(p => {
      const a = acc(p.accountId); const over = p.date < now;
      return `<div class="row"><div class="grow"><div class="t">${esc(p.name || (p.type === 'transfer' ? 'Transfer' : catPath(p.categoryId)))}</div>
      <div class="s">${over ? '<span class="chip w">Due</span> ' : ''}${dayLabel(p.date)} · ${esc(a?.name)}</div></div>
      <div class="amt ${p.type === 'income' ? 'inc' : p.type === 'transfer' ? 'tr' : 'exp'}">${fmt(p.type === 'income' ? p.sum : p.type === 'transfer' ? p.sum : -p.sum, a?.currencyId, p.type === 'income')}</div>
      <button class="btn sm" data-a="planok" data-v="${p.id}">✓</button><button class="btn sm sec" data-a="planskip" data-v="${p.id}">Skip</button></div>`;
    }).join('')}</div>`;
  }
  const tiles = [['accounts', '🏦', 'Accounts', '#0f766e'], ['income', '📥', 'Income', '#16a34a'], ['expense', '🧾', 'Expenses', '#dc2626'], ['transfer', '🔄', 'Transfers', '#2563eb'],
  ['debts', '🤝', 'Debts', '#d97706'], ['hist', '📒', 'Financial movements', '#7b1fa2'], ['rep', '📊', 'Reports', '#0891b2'], ['categories', '🗂️', 'Categories', '#db2777'],
  ['budgets', '🎯', 'Budgets', '#65a30d'], ['prepayments', '🅿', 'Prepayments', '#9333ea'], ['planned', '🔁', 'Planned operations', '#ea580c'], ['currencies', '💱', 'Currencies', '#0d9488'],
  ['data', '💾', 'Backup & import', '#475569'], ['settings', '⚙︎', 'Settings', '#64748b']];
  h += `<div class="tiles">${tiles.map(([k, i, l, c]) => `<button class="tile" data-a="menu" data-v="${k}"><span class="ti" style="background:${c}">${tileIcon(k, i)}</span><span class="tl">${l}</span></button>`).join('')}</div>`;
  return h + '</div>';
}

function periodBar(p, key) {
  return `<div class="pbar"><select data-a="pkind" data-k="${key}">${[['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['all', 'All'], ['custom', 'Custom']].map(([v, l]) => `<option value="${v}" ${p.kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
  ${['all', 'custom'].includes(p.kind) ? '' : `<button data-a="pshift" data-k="${key}" data-v="-1">‹</button>`}<div class="lbl">${esc(periodLabel(p))}</div>${['all', 'custom'].includes(p.kind) ? '' : `<button data-a="pshift" data-k="${key}" data-v="1">›</button>`}</div>
  ${p.kind === 'custom' ? `<div class="btns" style="margin:-4px 0 10px"><input type="date" value="${ymd(p.from || Date.now())}" data-a="pfrom" data-k="${key}"><input type="date" value="${ymd(p.to || Date.now())}" data-a="pto" data-k="${key}"></div>` : ''}`;
}

function filteredTx(p, f) {
  const [a, b] = rangeOf(p); const q = (f.q || '').toLowerCase();
  const cats = f.cat ? new Set(catDescendants(f.cat)) : null;
  return S.tx.filter(t => {
    if (t.date < a || t.date >= b) return false;
    if (f.type !== 'all' && t.type !== f.type) return false;
    if (f.acc && t.accountId !== f.acc && t.toAccountId !== f.acc) return false;
    if (cats && !cats.has(t.categoryId)) return false;
    if (q && !((t.name || '') + ' ' + (t.desc || '') + ' ' + (t.categoryId ? catPath(t.categoryId) : '')).toLowerCase().includes(q)) return false;
    return true;
  }).sort((x, y) => y.date - x.date);
}
function viewHistory() {
  const f = U.hf; const list = filteredTx(U.ph, f);
  const inc = new Map(), exp = new Map();
  list.forEach(t => { if (t.type === 'transfer' || t.type === 'prepayment' || t.debtId) return; addBy(t.type === 'income' ? inc : exp, acc(t.accountId)?.currencyId, t.sum); });
  const PER = [['all', 'All time'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['lastmonth', 'Last month'], ['year', 'This year'], ['lastyear', 'Last year'], ['custom', 'Custom dates']];
  const psel = U.ph.sel || (U.ph.kind === 'custom' ? 'custom' : 'all');
  let h = header('History') + '<div class="wrap">';
  h += `<div class="search"><input type="search" placeholder="Search name, note, category" value="${esc(f.q)}" data-a="hq"></div>
  <div class="btns" style="margin:0 0 10px"><select data-a="htype">${[['all', 'All types'], ['expense', 'Expenses'], ['income', 'Income'], ['transfer', 'Transfers'], ['prepayment', 'Prepayments']].map(([v, l]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
  <select data-a="hacc"><option value="">All accounts</option>${S.accounts.map(a => `<option value="${a.id}" ${f.acc === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
  <div class="btns" style="margin:0 0 10px"><select data-a="hper">${PER.map(([v, l]) => `<option value="${v}" ${psel === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
  ${psel === 'custom' ? `<div class="btns" style="margin:0 0 10px"><input type="date" value="${ymd(U.ph.from || Date.now())}" data-a="pfrom" data-k="ph"><input type="date" value="${ymd(U.ph.to || Date.now())}" data-a="pto" data-k="ph"></div>` : ''}
  <div class="btns" style="margin:0 0 10px"><select data-a="hcat"><option value="">All categories</option>${[...catSorted('expense'), ...catSorted('income')].map(c => `<option value="${c.id}" ${f.cat === c.id ? 'selected' : ''}>${c.type === 'income' ? '↓ ' : ''}${esc(catPath(c.id))}</option>`).join('')}</select></div>
`;
  if (!list.length) return h + emptyMsg('No transactions for this period.') + '</div>';
  const groups = new Map();
  list.forEach(t => { const k = +startOfDay(t.date); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
  groups.forEach((arr, k) => {
    const net = new Map(); arr.forEach(t => { if (t.type === 'transfer' || t.type === 'prepayment' || t.debtId) return; addBy(net, acc(t.accountId)?.currencyId, t.type === 'income' ? t.sum : -t.sum); });
    h += `<div class="dayhead"><span>${dayLabel(k)}</span><span style="text-align:right">${fmtMulti(net, true)}</span></div><div class="card" style="padding:4px 14px">${collapse(arr).map(t => txRowHtml(t, { time: true })).join('')}</div>`;
  });
  const ft = f.type, showI = ft === 'all' || ft === 'income', showE = ft === 'all' || ft === 'expense';
  const inl = m => { const e = [...m].filter(([, v]) => Math.abs(v) > 1e-7); return e.length ? e.map(([k, v]) => fmt(v, k)).join(' · ') : fmt(0, defCur().id); };
  if (showI || showE) h += `<div class="totline">${showI ? `<span>Income <b class="inc">${inl(inc)}</b></span>` : ''}${showE ? `<span>Expenses <b class="exp">${inl(exp)}</b></span>` : ''}</div>`;
  return h + '</div>';
}

// ───────────────────────── charts ─────────────────────────
function donut(items) {
  const total = items.reduce((s, i) => s + i.value, 0); if (!total) return '';
  let a0 = -Math.PI / 2; const R = 80, r = 50, cx = 100, cy = 100; let paths = '';
  items.forEach(i => {
    const frac = i.value / total; if (frac <= 0) return;
    const a1 = a0 + frac * Math.PI * 2 - (frac >= 0.9999 ? 0.0001 : 0);
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    const [x0, y0] = p(R, a0), [x1, y1] = p(R, a1), [x2, y2] = p(r, a1), [x3, y3] = p(r, a0);
    paths += `<path d="M${x0} ${y0}A${R} ${R} 0 ${big} 1 ${x1} ${y1}L${x2} ${y2}A${r} ${r} 0 ${big} 0 ${x3} ${y3}Z" fill="${i.color}"/>`;
    a0 += frac * Math.PI * 2;
  });
  return `<svg class="chart" viewBox="0 0 200 200" style="max-width:240px;margin:0 auto" role="img">${paths}</svg>`;
}
function niceMax(v) { if (v <= 0) return 1; const e = Math.pow(10, Math.floor(Math.log10(v))); const n = v / e; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * e; }
function shortNum(n) { return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n)); }
function barChart(labels, series) {
  const W = 320, H = 170, L = 34, B = 22, T = 8; const max = niceMax(Math.max(...series.flatMap(s => s.values), 0));
  const n = labels.length, gw = (W - L) / n, bw = Math.min(22, gw / (series.length + 0.6));
  let g = '';
  for (let i = 0; i <= 4; i++) { const y = T + (H - T - B) * (1 - i / 4); g += `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${L - 4}" y="${y + 3}" font-size="9" text-anchor="end" fill="var(--muted)">${shortNum(max * i / 4)}</text>`; }
  labels.forEach((lb, i) => {
    const x0 = L + gw * i + (gw - bw * series.length) / 2;
    series.forEach((s, j) => { const h = (H - T - B) * (s.values[i] / max); g += `<rect x="${x0 + j * bw}" y="${H - B - h}" width="${bw - 1}" height="${Math.max(h, 0)}" rx="2" fill="${s.color}"/>`; });
    g += `<text x="${L + gw * i + gw / 2}" y="${H - 7}" font-size="9" text-anchor="middle" fill="var(--muted)">${esc(lb)}</text>`;
  });
  const leg = series.length > 1 ? `<div style="display:flex;gap:14px;justify-content:center;font-size:.8em;color:var(--muted)">${series.map(s => `<span><i class="sw" style="display:inline-block;background:${s.color};margin-right:5px"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${g}</svg>${leg}`;
}
function lineChart(labels, values) {
  const W = 320, H = 160, L = 34, B = 22, T = 8; const max = niceMax(Math.max(...values, 0)); const n = values.length;
  let g = '';
  for (let i = 0; i <= 4; i++) { const y = T + (H - T - B) * (1 - i / 4); g += `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${L - 4}" y="${y + 3}" font-size="9" text-anchor="end" fill="var(--muted)">${shortNum(max * i / 4)}</text>`; }
  const px = i => L + (n > 1 ? (W - L - 6) * i / (n - 1) : (W - L) / 2), py = v => T + (H - T - B) * (1 - v / max);
  const pts = values.map((v, i) => `${px(i)},${py(v)}`).join(' ');
  g += `<polyline points="${pts}" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linejoin="round"/>`;
  const step = Math.ceil(n / 7); labels.forEach((l, i) => { if (i % step === 0) g += `<text x="${px(i)}" y="${H - 7}" font-size="9" text-anchor="middle" fill="var(--muted)">${esc(l)}</text>`; });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${g}</svg>`;
}

function viewReports() {
  const R = U.rep; const [a, b] = rangeOf(U.pr);
  const types = [['pie-exp', 'Pie chart – Expenses'], ['pie-inc', 'Pie chart – Income'], ['month-exp', 'Expenses by month'], ['month-inc', 'Income by month'], ['compare', 'Income vs Expenses by month'], ['daily', 'Daily amounts']];
  let h = header('Reports') + '<div class="wrap">';
  h += `<select data-a="rtype" style="margin-bottom:10px">${types.map(([v, l]) => `<option value="${v}" ${R.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const monthly = R.type.startsWith('month') || R.type === 'compare';
  if (!monthly) h += periodBar(U.pr, 'pr');
  h += `<select data-a="racc" style="margin-bottom:12px"><option value="">All accounts</option>${S.accounts.map(x => `<option value="${x.id}" ${R.acc === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
  const rc = R.cur && cur(R.cur) ? R.cur : defCur().id; const fmtR = (n, sg) => fmt(n, rc, sg);
  h += `<select data-a="rcur" style="margin-bottom:12px">${S.currencies.map(x => `<option value="${x.id}" ${rc === x.id ? 'selected' : ''}>${esc(x.short)} ${esc(x.name || '')}</option>`).join('')}</select>`;
  const base = S.tx.filter(t => t.type !== 'transfer' && t.type !== 'prepayment' && !t.debtId && (!R.acc || t.accountId === R.acc) && (acc(t.accountId)?.currencyId || defCur().id) === rc);
  const val = t => t.sum;
  if (R.type === 'pie-exp' || R.type === 'pie-inc') {
    const kind = R.type === 'pie-exp' ? 'expense' : 'income'; const map = new Map();
    base.filter(t => t.type === kind && t.date >= a && t.date < b).forEach(t => {
      const key = R.leaf ? t.categoryId : (catRoot(t.categoryId)?.id || t.categoryId); map.set(key, (map.get(key) || 0) + val(t));
    });
    const items = [...map].map(([id, value]) => ({ id, value, label: R.leaf ? catPath(id) : (cat(id)?.name || '—'), color: color(id) })).sort((x, y) => y.value - x.value);
    const total = items.reduce((s, i) => s + i.value, 0);
    h += `<label class="chk"><input type="checkbox" data-a="rleaf" ${R.leaf ? 'checked' : ''}> Show subcategories</label>`;
    if (!items.length) return h + emptyMsg('Not enough data for the chart') + '</div>';
    h += `<div class="card">${donut(items)}<div style="text-align:center;margin:6px 0 4px"><div class="mut" style="font-size:.8em">Total</div><div class="big">${fmtR(total)}</div></div></div>
    <div class="card legend">${items.map(i => `<div class="row tap" data-a="repdrill" data-v="${i.id}"><i class="sw" style="background:${i.color}"></i><div class="grow t">${esc(i.label)}</div><div class="amt">${fmtR(i.value)} <span class="mut" style="font-weight:500">${(i.value / total * 100).toFixed(1)}%</span></div></div>`).join('')}</div>`;
  } else if (monthly) {
    const y = new Date(U.pr.ref).getFullYear();
    h += `<div class="pbar"><button data-a="pyear" data-v="-1">‹</button><div class="lbl">${y}</div><button data-a="pyear" data-v="1">›</button></div>`;
    const m = Array.from({ length: 12 }, () => ({ inc: 0, exp: 0 }));
    base.forEach(t => { const d = new Date(t.date); if (d.getFullYear() !== y) return; t.type === 'income' ? m[d.getMonth()].inc += val(t) : m[d.getMonth()].exp += val(t); });
    const labels = MONTHS.map(x => x.slice(0, 3)); let ser;
    if (R.type === 'month-exp') ser = [{ name: 'Expenses', color: 'var(--exp)', values: m.map(x => x.exp) }];
    else if (R.type === 'month-inc') ser = [{ name: 'Income', color: 'var(--inc)', values: m.map(x => x.inc) }];
    else ser = [{ name: 'Income', color: 'var(--inc)', values: m.map(x => x.inc) }, { name: 'Expenses', color: 'var(--exp)', values: m.map(x => x.exp) }];
    h += `<div class="card">${barChart(labels, ser)}</div><div class="card">${m.map((x, i) => (x.inc || x.exp) ? `<div class="row"><div class="grow t">${MONTHS[i]}</div><div class="amt">${R.type !== 'month-exp' ? `<span class="inc">${fmtR(x.inc)}</span>` : ''} ${R.type !== 'month-inc' ? `<span class="exp">${fmtR(x.exp)}</span>` : ''}</div></div>` : '').join('') || emptyMsg('No data')}</div>`;
  } else {
    const days = []; for (let d = a; d < Math.min(b, a + 400 * DAY); d += DAY) days.push(d);
    if (U.pr.kind === 'all') return h + emptyMsg('Choose a shorter period') + '</div>';
    const kinds = base.filter(t => t.type === 'expense' && t.date >= a && t.date < b);
    const vals = days.map(d => kinds.filter(t => t.date >= d && t.date < d + DAY).reduce((s, t) => s + val(t), 0));
    h += `<div class="card"><h3>Expenses per day</h3>${lineChart(days.map(d => new Date(d).getDate()), vals)}<div class="mut" style="text-align:center;font-size:.85em">Total ${fmtR(vals.reduce((s, v) => s + v, 0))} · avg ${fmtR(vals.reduce((s, v) => s + v, 0) / (days.length || 1))}/day</div></div>`;
  }
  return h + '</div>';
}

function viewMore() {
  const items = [['accounts', '🏦', 'Accounts'], ['categories', '🗂️', 'Categories'], ['budgets', '🎯', 'Budgets'], ['debts', '🤝', 'Debts'], ['prepayments', '🅿', 'Prepayments'], ['planned', '🔁', 'Planned operations'],
  ['currencies', '💱', 'Currencies'], ['data', '💾', 'Backup & import / export'], ['settings', '⚙︎', 'Settings']];
  return header('More') + `<div class="wrap"><div class="card menu">${items.map(([k, i, l]) => `<div class="row tap" data-a="go" data-v="${k}"><div class="ic">${i}</div><div class="grow t">${l}</div><span class="chev">›</span></div>`).join('')}</div>
  <p class="mut" style="text-align:center;font-size:.8em">All data is stored only on this device.<br>Use Backup regularly.</p></div>`;
}

// ───────────────────────── sub pages ─────────────────────────
function renderPage(pg) {
  switch (pg.name) {
    case 'accounts': return pgAccounts();
    case 'categories': return pgCategories();
    case 'budgets': return pgBudgets();
    case 'debts': return pgDebts();
    case 'prepayments': return pgPrepayments();
    case 'debt': return pgDebt(pg.arg);
    case 'planned': return pgPlanned();
    case 'templates': return pgTemplates();
    case 'currencies': return pgCurrencies();
    case 'data': return pgData();
    case 'settings': return pgSettings();
  }
  return '';
}

const ACC_TYPES = [['account', 'Accounts'], ['card', 'Credit cards'], ['invest', 'Investments'], ['other', 'Other']];
const accType = a => ACC_TYPES.some(t => t[0] === a.type) ? a.type : 'account';
function pgAccounts() {
  const bal = balances(); const so = !!U.sortAcc; const open = U.grpOpen || (U.grpOpen = new Set()); const tclosed = U.typeClosed || (U.typeClosed = new Set());
  const grpOf = a => (S.groups || []).find(g => g.id === a.groupId);
  const typeOfGroup = g => { const m = S.accounts.find(x => x.groupId === g.id); return m ? accType(m) : 'account'; };
  const used = ACC_TYPES.filter(([t]) => S.accounts.some(x => accType(x) === t) || (S.groups || []).some(g => typeOfGroup(g) === t && !S.accounts.some(x => x.groupId === g.id)));
  const multi = used.length > 1; const anyOpen = (multi && tclosed.size < used.length) || open.size > 0;
  const acell = a => { const v = bal[a.id] || 0; return `<div class="acamt ${v < 0 ? 'exp' : ''}"><b>${fmtNum(v, a.currencyId)}</b><small>${esc(cur(a.currencyId)?.short || '')}</small></div>`; };
  const rowOf = (a, inGroup) => { const sib = S.accounts.filter(x => (x.groupId || '') === (a.groupId || '') && accType(x) === accType(a)); const k = sib.indexOf(a);
    return `<div class="row ${so ? '' : 'tap'} ${inGroup ? 'inner' : ''}" ${so ? '' : `data-a="editacc" data-v="${a.id}"`}>${iconDot(a.icon)}<div class="grow"><div class="t" style="white-space:normal">${esc(a.name)}</div>${a.active === false ? '<div class="s"><span class="chip w">inactive</span></div>' : ''}</div>${so ? `<button class="icon-btn" data-a="accmove" data-v="${a.id}" data-arg="-1" ${k === 0 ? 'disabled style="opacity:.3"' : ''}>▲</button><button class="icon-btn" data-a="accmove" data-v="${a.id}" data-arg="1" ${k === sib.length - 1 ? 'disabled style="opacity:.3"' : ''}>▼</button>` : acell(a)}</div>`; };
  let h = header('Accounts', { back: 1 }) + '<div class="wrap">';
  h += `<div class="toolbar"><button class="chipbtn pri" data-a="editacc">＋ New account</button><button class="chipbtn pri2" data-a="editgroup">＋ New group</button></div>`;
  h += `<div class="toolbar tools stick"><button class="chipbtn ${so ? 'pri' : ''}" data-a="sortacc">${so ? '✓ Done sorting' : '⇅ Sort'}</button>${multi || (S.groups || []).length ? `<button class="chipbtn" data-a="${anyOpen ? 'collapseall' : 'expandall'}">${anyOpen ? '⊟ Collapse all' : '⊞ Expand all'}</button>` : ''}</div>`;
  if (so) h += '<p class="mut" style="margin:0 0 8px;font-size:.85em">Use the arrows to move accounts up or down, then tap Done. This order is used everywhere.</p>';
  if (!S.accounts.length && !(S.groups || []).length) return h + '<div class="card">' + emptyMsg('No accounts created yet.') + '</div></div>';
  (used.length ? used : [ACC_TYPES[0]]).forEach(([t, tl]) => {
    const tshut = multi && tclosed.has(t); const mine = S.accounts.filter(x => accType(x) === t);
    const tt = new Map(); mine.filter(x => x.active !== false).forEach(x => addBy(tt, x.currencyId, bal[x.id] || 0));
    h += '<div class="card sec">';
    if (multi) h += `<div class="sechead2 tap" data-a="typetoggle" data-v="${t}"><span class="catarrow">${tshut ? '▸' : '▾'}</span><div class="grow"><div class="t">${tl}</div><div class="s">${mine.length} account${mine.length === 1 ? '' : 's'}</div></div><div class="secamt2">${fmtMulti(tt)}</div></div>`;
    if (!tshut) {
      (S.groups || []).filter(g => typeOfGroup(g) === t).forEach(g => {
        const mem = S.accounts.filter(x => x.groupId === g.id); const gt = new Map(); mem.filter(x => x.active !== false).forEach(x => addBy(gt, x.currencyId, bal[x.id] || 0)); const isOpen = open.has(g.id);
        h += `<div class="row tap grprow" data-a="grptoggle" data-v="${g.id}"><span class="catarrow">${isOpen ? '▾' : '▸'}</span>${iconDot(g.icon || '📁')}<div class="grow"><div class="t" style="white-space:normal">${esc(g.name)}</div><div class="s">${mem.length} account${mem.length === 1 ? '' : 's'}</div></div><div class="secamt2 small">${fmtMulti(gt)}</div><button class="icon-btn" data-a="editgroup" data-v="${g.id}" aria-label="Edit group" style="width:30px;height:30px;box-shadow:none;background:var(--bg);flex:none">✎</button></div>`;
        if (isOpen) h += mem.length ? mem.map(x => rowOf(x, true)).join('') : '<div class="s mut" style="padding:6px 0 6px 46px">No accounts in this group yet.</div>';
      });
      h += mine.filter(x => !x.groupId || !grpOf(x)).map(x => rowOf(x, false)).join('');
    }
    h += '</div>';
  });
  return h + '</div>';
}
const defCatId = type => S.categories.find(c => c.type === type && c.isDefault)?.id || '';
function pgCategories() {
  const t = U.catType; const open = U.catOpen || (U.catOpen = new Set());
  const kids = id => S.categories.some(c => c.parentId === id);
  const visible = catSorted(t).filter(c => { let p = c.parentId, ok = true, g = 0; while (p && g++ < 6) { if (!open.has(p)) { ok = false; break; } p = cat(p)?.parentId; } return ok; });
  const so = !!U.sortCat; const sibs = c => S.categories.filter(x => x.type === c.type && (x.parentId || null) === (c.parentId || null)).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return header('Categories', { back: 1, right: `<button class="icon-btn" data-a="sortcat" aria-label="Sort" title="Sort" style="${so ? 'background:var(--brand);color:#fff' : ''}">${so ? '✓' : '⇅'}</button><button class="icon-btn" data-a="editcat" data-t="${t}">+</button>` }) + `<div class="wrap">${so ? '<p class="mut" style="margin:0 0 8px;font-size:.85em">Use the arrows to move a category up or down among its siblings, then tap ✓. This order is used everywhere categories are chosen.</p>' : ''}<div class="seg" style="margin-bottom:12px">
  <button class="${t === 'expense' ? 'on e' : ''}" data-a="cattype" data-v="expense">Expenses</button><button class="${t === 'income' ? 'on i' : ''}" data-a="cattype" data-v="income">Income</button></div>
  <div class="card">${visible.map(c => `<div class="row" style="padding-left:${catDepth(c) * 20}px">${kids(c.id) ? `<button class="catarrow" data-a="cattoggle" data-v="${c.id}" aria-label="Show subcategories">${open.has(c.id) ? '▾' : '▸'}</button>` : '<span class="catarrow"></span>'}<div class="row ${so ? '' : 'tap '}grow" ${so ? '' : `data-a="editcat" data-v="${c.id}"`} style="padding:0;border:0;gap:12px"><i class="sw" style="background:${color(catRoot(c.id).id)}"></i><div class="grow t">${esc(c.name)}${c.isDefault ? ' <span class="chip">default</span>' : ''}</div>${so ? (() => { const sb = sibs(c), k = sb.indexOf(c); return `<button class="icon-btn" data-a="catmove" data-v="${c.id}" data-arg="-1" ${k === 0 ? 'disabled style="opacity:.3"' : ''}>▲</button><button class="icon-btn" data-a="catmove" data-v="${c.id}" data-arg="1" ${k === sb.length - 1 ? 'disabled style="opacity:.3"' : ''}>▼</button>`; })() : '<span class="chev">›</span>'}</div></div>`).join('')}</div></div>`;
}
function budgetRange(b) {
  const now = Date.now();
  if (b.period === 'daily') return rangeOf({ kind: 'day', ref: now });
  if (b.period === 'weekly') return rangeOf({ kind: 'week', ref: now });
  if (b.period === 'yearly') return rangeOf({ kind: 'year', ref: now });
  if (b.period === 'custom') return [+startOfDay(b.from), +startOfDay(b.to) + DAY];
  return rangeOf({ kind: 'month', ref: now });
}
function budgetStatus(b) {
  const [a, z] = budgetRange(b); let ids = null;
  if (b.kind === 'category') { ids = new Set((b.refs || []).flatMap(catDescendants)); }
  let spent = 0;
  S.tx.forEach(t => {
    if (t.type !== 'expense' || t.debtId || t.date < a || t.date >= z) return;
    if (b.kind === 'category' && !ids.has(t.categoryId)) return;
    if (b.kind === 'account' && !(b.refs || []).includes(t.accountId)) return;
    if ((acc(t.accountId)?.currencyId || defCur().id) !== defCur().id) return;
    spent += t.sum;
  });
  return { spent, left: b.amount - spent, pct: b.amount ? Math.min(100, spent / b.amount * 100) : 0, range: [a, z] };
}
function pgBudgets() {
  return header('Budgets', { back: 1, right: `<button class="icon-btn" data-a="editbudget">+</button>` }) + `<div class="wrap">${S.budgets.length ? S.budgets.map(b => {
    const st = budgetStatus(b); const names = b.kind === 'overall' ? 'All expenses' : b.kind === 'category' ? (b.refs || []).map(i => cat(i)?.name).join(', ') : (b.refs || []).map(i => acc(i)?.name).join(', ');
    return `<div class="card tap" data-a="editbudget" data-v="${b.id}"><div style="display:flex;justify-content:space-between"><b>${esc(b.name)}</b><span class="chip">${b.period}</span></div><div class="s mut" style="font-size:.82em;margin:2px 0 8px">${esc(names)}</div>
    <div class="bar ${st.left < 0 ? 'over' : ''}"><i style="width:${st.pct}%"></i></div><div style="display:flex;justify-content:space-between;margin-top:6px;font-size:.88em"><span>Spent ${fmtB(st.spent)} / ${fmtB(b.amount)}</span><b class="${st.left < 0 ? 'exp' : 'inc'}">${st.left < 0 ? 'Over ' : 'Left '}${fmtB(Math.abs(st.left))}</b></div></div>`;
  }).join('') : '<div class="card">' + emptyMsg('No budgets set') + '</div>'}</div>`;
}
// remaining debt per currency (each entry counts in the currency of the account it used)
function debtBy(d) { const m = new Map(); addBy(m, acc(d.accountId)?.currencyId, d.amount); (d.repayments || []).forEach(r => addBy(m, acc(r.accountId)?.currencyId, -r.sum)); return m; }
const debtOpen = d => [...debtBy(d).values()].some(v => Math.abs(v) > 0.005);
function debtRemaining(d) { return d.amount - (d.repayments || []).reduce((s, r) => s + r.sum, 0); }
// signed balance per currency from MY point of view: positive = they owe me, negative = I owe them.
// The side follows the numbers, not the label the debt started with.
function debtNet(d) { const m = new Map(); debtBy(d).forEach((v, k) => m.set(k, d.dir === 'lend' ? v : -v)); return m; }
function debtSide(d) {
  const v = [...debtNet(d).values()].filter(x => Math.abs(x) > 0.005); const pos = v.some(x => x > 0), neg = v.some(x => x < 0);
  return pos && neg ? 'both' : pos ? 'owes' : neg ? 'owe' : 'zero';
}
const debtLines = (d, big) => { const net = debtNet(d); const e = [...net].filter(([, v]) => Math.abs(v) > 0.005);
  if (!e.length) { const k = acc(d.accountId)?.currencyId; return `<span class="mrow"><span class="mc">${esc((cur(k) || defCur()).short || '')}</span><span class="ma">${fmtNum(0, k)}</span></span>`; }
  return e.map(([k, v]) => `<span class="mrow ${v > 0 ? 'inc' : 'exp'}"><span class="mc">${esc((cur(k) || defCur()).short || '')}</span><span class="ma">${fmtNum(v, k)}</span></span>`).join(''); };
function pgDebts() {
  const list = S.debts.filter(d => !U.hideZero || debtOpen(d));
  const owedToMe = new Map(), iOwe = new Map();
  S.debts.forEach(d => debtNet(d).forEach((v, k) => { if (v > 0.005) addBy(owedToMe, k, v); else if (v < -0.005) addBy(iOwe, k, -v); }));
  const side = { owes: ['Owes you', 'var(--inc)', '↗'], owe: ['You owe', 'var(--exp)', '↙'], both: ['Owes you / you owe', 'var(--tr)', '⇄'], zero: ['Settled', 'var(--muted)', '✓'] };
  return header('Debts', { back: 1, right: `<button class="icon-btn" data-a="editdebt">+</button>` }) + `<div class="wrap"><div class="card"><div class="sum3" style="margin:0"><div><small>Owed to you</small><b class="inc">${fmtMulti(owedToMe)}</b></div><div><small>You owe</small><b class="exp">${fmtMulti(iOwe)}</b></div></div></div>
  <label class="chk"><input type="checkbox" data-a="hidezero" ${U.hideZero ? 'checked' : ''}> Hide debts with zero balance</label>
  <div class="card">${list.length ? list.map(d => { const sd = side[debtSide(d)]; return `<div class="row tap" data-a="go" data-v="debt" data-arg="${d.id}"><div class="dot" style="background:${sd[1]}">${sd[2]}</div><div class="grow"><div class="t">${esc(d.name)}</div><div class="s">${sd[0]} · ${ymd(d.date)}</div></div><div class="amt" style="text-align:right">${debtLines(d)}</div></div>`; }).join('') : emptyMsg('Here you can store and manage information about debts')}</div></div>`;
}
function pgDebt(id) {
  const d = S.debts.find(x => x.id === id); if (!d) { U.stack.pop(); return viewMore(); }
  const a = acc(d.accountId); const lend = d.dir === 'lend'; const sd = debtSide(d);
  const title = { owes: 'Owes you', owe: 'You owe', both: 'Owes you / you owe', zero: 'Settled' }[sd];
  return header(d.name, { back: 1, right: `<button class="icon-btn" data-a="editdebt" data-v="${d.id}">✎</button>` }) + `<div class="wrap"><div class="card"><h3>${title}</h3><div class="big" style="font-size:1.5em">${debtLines(d)}</div>
  <div class="mut" style="font-size:.85em">Started: ${lend ? 'you lent' : 'you borrowed'} ${fmt(d.amount, a?.currencyId)} · ${ymd(d.date)}${d.desc ? ' · ' + esc(d.desc) : ''}</div><div class="btns"><button class="btn" data-a="addrepay" data-v="${d.id}">${lend ? 'They paid me back' : 'I paid back'}</button><button class="btn sec" data-a="incdebt" data-v="${d.id}">${lend ? 'I lent more' : 'I borrowed more'}</button></div></div>
  <div class="card"><h3>History</h3>${(d.repayments || []).length ? [...d.repayments].sort((x, y) => y.date - x.date).map(r => `<div class="row tap" data-a="editrepay" data-v="${d.id}" data-arg="${r.id}"><div class="grow"><div class="t">${r.sum < 0 ? 'Increase' : 'Repayment'}</div><div class="s">${ymd(r.date)} · ${r.direct ? '🧾 Expensed directly' + (r.categoryId && cat(r.categoryId) ? ' · ' + esc(cat(r.categoryId).name) : '') : esc(acc(r.accountId)?.name)}</div></div><div class="amt">${fmt(Math.abs(r.sum), acc(r.accountId)?.currencyId)}</div></div>`).join('') : emptyMsg('No repayments yet')}</div></div>`;
}
function pgPrepayments() {
  const list = prepayList().sort((a, b) => b.date - a.date);
  return header('Prepayments', { back: 1, right: `<button class="icon-btn" data-a="addprepay">+</button>` }) + `<div class="wrap">${list.length ? list.map(p => {
    const a = acc(p.accountId), used = prepayUsed(p.id), left = p.sum - used, pct = p.sum ? Math.min(100, used / p.sum * 100) : 0;
    const uses = S.tx.filter(t => t.prepayId === p.id).sort((x, y) => y.date - x.date);
    return `<div class="card"><div class="row tap" data-a="edittx" data-v="${p.id}" style="padding-top:0"><div class="dot" style="background:#9333ea">🅿</div><div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${ymd(p.date)} · paid from ${esc(a?.name)}</div></div><div class="amt">${fmt(p.sum, a?.currencyId)}</div></div>
    <div class="bar"><i style="width:${pct}%"></i></div><div style="display:flex;justify-content:space-between;margin:6px 0 4px;font-size:.88em"><span>Used ${fmt(used, a?.currencyId)}</span><b class="${left > 0.0001 ? 'inc' : 'mut'}">${left > 0.0001 ? 'Left ' + fmt(left, a?.currencyId) : 'Fully used'}</b></div>
    ${uses.map(t => txRowHtml(t)).join('')}</div>`;
  }).join('') : '<div class="card">' + emptyMsg('No prepayments yet.<br>Add one with <b>+</b> → Prepayment.') + '</div>'}</div>`;
}
function pgPlanned() {
  const list = [...S.planned].sort((a, b) => a.date - b.date);
  return header('Planned operations', { back: 1, right: `<button class="icon-btn" data-a="addplanned">+</button>` }) + `<div class="wrap"><div class="card">${list.length ? list.map(p => {
    const a = acc(p.accountId);
    return `<div class="row tap" data-a="editplanned" data-v="${p.id}"><div class="grow"><div class="t">${esc(p.name || (p.type === 'transfer' ? 'Transfer' : catPath(p.categoryId)))}</div><div class="s">${ymd(p.date)} · ${REPEATS.find(r => r[0] === p.repeat)?.[1] || ''} · ${esc(a?.name)}</div></div><div class="amt ${p.type === 'income' ? 'inc' : p.type === 'transfer' ? 'tr' : 'exp'}">${fmt(p.sum, a?.currencyId)}</div></div>`;
  }).join('') : emptyMsg('No upcoming operations scheduled')}</div></div>`;
}
function pgTemplates() {
  return header('Templates', { back: 1 }) + `<div class="wrap"><div class="card">${S.templates.length ? S.templates.map(t => `<div class="row"><div class="grow tap" data-a="usetpl" data-v="${t.id}"><div class="t">${esc(t.tplName || t.name || catPath(t.categoryId))}</div><div class="s">${t.type} · ${esc(acc(t.accountId)?.name)}</div></div><div class="amt">${fmt(t.sum, acc(t.accountId)?.currencyId)}</div><button class="btn sm sec" data-a="deltpl" data-v="${t.id}">✕</button></div>`).join('') : emptyMsg('No templates yet.<br>When adding a transaction, tick “Save as template”.')}</div></div>`;
}
function pgCurrencies() {
  return header('Currencies', { back: 1, right: `<button class="icon-btn" data-a="editcur">+</button>` }) + `<div class="wrap"><div class="card">${S.currencies.map(c => {
    const isDef = c.id === S.settings.defCur;
    return `<div class="row tap" data-a="editcur" data-v="${c.id}"><div class="grow"><div class="t">${esc(c.short)} ${isDef ? '<span class="chip">default</span>' : ''}</div><div class="s">${esc(c.name || '')}</div></div><div class="amt mut">${isDef ? '' : '1 = ' + c.rate + ' ' + esc(defCur().short)}</div></div>`;
  }).join('') || emptyMsg('No currencies')}</div></div>`;
}
function pgSettings() {
  const s = S.settings;
  return header('Settings', { back: 1 }) + `<div class="wrap"><div class="card">
  <label class="f"><span>Theme</span><select data-a="set" data-k="theme">${[['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<option value="${v}" ${s.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  <label class="f"><span>Font size</span><select data-a="set" data-k="fs" data-num="1">${[[14, 'Small'], [16, 'Normal'], [18, 'Large'], [20, 'Extra large']].map(([v, l]) => `<option value="${v}" ${s.fs === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  <label class="chk"><input type="checkbox" data-a="setchk" data-k="compact" ${s.compact ? 'checked' : ''}> Compact lists</label>
  <label class="chk"><input type="checkbox" data-a="setchk" data-k="catAbove" ${s.catAbove ? 'checked' : ''}> Show category as the title of each transaction</label></div>
  <div class="card"><h3>Passcode lock</h3><p class="mut" style="margin:0 0 10px;font-size:.88em">${s.pin ? 'A passcode is set. It is asked each time you open the app.' : 'Protect the app with a passcode. (Face ID is not available in home-screen web apps.)'}</p>
  <div class="btns"><button class="btn" data-a="setpin">${s.pin ? 'Change passcode' : 'Set passcode'}</button>${s.pin ? '<button class="btn sec" data-a="rmpin">Remove</button>' : ''}</div></div>
  <div class="card"><h3>Danger zone</h3><button class="btn danger" style="border:1px solid var(--exp)" data-a="cleardata">Selective data cleaning…</button></div></div>`;
}
function pgData() {
  const lb = S.settings.lastBackup;
  return header('Backup & import', { back: 1 }) + `<div class="wrap">
  <div class="card"><h3>Backup (Excel)</h3><p class="mut" style="margin:0 0 10px;font-size:.88em">Last backup: ${lb ? new Date(lb).toLocaleString() : 'never'}. One Excel file with everything: accounts, categories, transactions, debts, budgets. Save it to <b>Files</b> / iCloud Drive.</p>
  <button class="btn" data-a="exportxlsx">Export backup (.xlsx)</button></div>
  ${ghCard()}
  <div class="card"><h3>Export transactions (CSV)</h3><p class="mut" style="margin:0 0 10px;font-size:.88em">Only the transaction list, in a simple CSV that opens in Excel.</p><button class="btn sec" data-a="exportcsv">Export transactions (.csv)</button></div>
  <div class="card"><h3>Import</h3><p class="mut" style="margin:0 0 10px;font-size:.88em">Choose one of: an Excel backup from this app (replaces everything), a CSV or Excel list of transactions (adds to what you have), or a FinancePM backup file (replaces everything).</p>
  <input type="file" id="impfile" style="margin-bottom:10px"><button class="btn sec" data-a="doimport">Import selected file</button></div></div>`;
}

// ───────────────────────── forms ─────────────────────────
function fieldHtml(f) {
  const id = 'f_' + f.k; const v = f.value ?? '';
  let inner;
  if (f.type === 'select') inner = `<select id="${id}">${(f.options || []).map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
  else if (f.type === 'icon') return `<div class="f"><span class="mut" style="font-size:.78em;font-weight:600">${esc(f.label)}</span><input type="hidden" id="${id}" value="${esc(v)}"><button type="button" class="iconbtn" data-iconopen><span class="cur">${iconDot(v, 40)}</span><span class="mut">Tap to change ▾</span></button><div class="ipicker" hidden>${iconPicker(v)}</div></div>`;
  else if (f.type === 'textarea') inner = `<textarea id="${id}" rows="2">${esc(v)}</textarea>`;
  else if (f.type === 'checkbox') return `<label class="chk"><input type="checkbox" id="${id}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
  else if (f.type === 'multi') return `<div class="f"><span class="mut" style="font-size:.78em;font-weight:600">${esc(f.label)}</span><div class="card" style="margin:4px 0 0;padding:6px 12px;max-height:200px;overflow:auto">${f.options.map(([ov, ol, oi]) => `<label class="chk" style="margin:6px 0"><input type="checkbox" name="${id}" value="${esc(ov)}" ${(v || []).includes(ov) ? 'checked' : ''}> ${oi ? `<span class="mi">${iconDot(oi, 30)}</span>` : ''}<span>${esc(ol)}</span></label>`).join('')}</div></div>`;
  else if (f.type === 'password') inner = `<input id="${id}" type="password" value="${esc(v)}" placeholder="${esc(f.ph || '')}" autocomplete="off" autocapitalize="none">`;
  else if (f.type === 'number') inner = `<input id="${id}" type="text" inputmode="decimal" value="${v === '' ? '' : esc(v)}" placeholder="${esc(f.ph || '')}">`;
  else if (f.type === 'date') inner = `<input id="${id}" type="date" value="${esc(v)}">`;
  else if (f.type === 'datetime') inner = `<input id="${id}" type="datetime-local" value="${esc(v)}">`;
  else inner = `<input id="${id}" type="text" value="${esc(v)}" placeholder="${esc(f.ph || '')}" autocapitalize="sentences">`;
  return `<label class="f"><span>${esc(f.label)}</span>${inner}</label>`;
}
function readField(f) {
  const el = $('#f_' + f.k);
  if (f.type === 'multi') return $$(`input[name=f_${f.k}]:checked`).map(x => x.value);
  if (f.type === 'checkbox') return el.checked;
  if (f.type === 'number') { const s = el.value.trim().replace(/,/g, '.').replace(/[^\d.\-]/g, ''); const n = parseFloat(s); return isNaN(n) ? null : n; }
  if (f.type === 'date') return el.value ? +new Date(el.value + 'T00:00') : null;
  if (f.type === 'datetime') return el.value ? +new Date(el.value) : null;
  return el.value.trim();
}
function form(title, fields, onOk, opts = {}) {
  sheet(`<button class="x" data-a="close">✕</button><h2>${esc(title)}</h2><form id="theform" autocomplete="off">${fields.map(fieldHtml).join('')}
  <div class="btns"><button class="btn" type="submit">${opts.ok || 'Save'}</button></div>${opts.onDelete ? '<div class="btns"><button type="button" class="btn danger" id="fdel">Delete</button></div>' : ''}</form>${opts.extraHtml || ''}`);
  $('#theform').onsubmit = e => {
    e.preventDefault(); const v = {}; fields.forEach(f => v[f.k] = readField(f));
    const err = onOk(v); if (err) { toast(err); return; } save(); closeSheet(); render();
  };
  if (opts.onDelete) $('#fdel').onclick = () => confirmBox(opts.delMsg || 'Delete this item?', () => { opts.onDelete(); save(); render(); });
  $$('#theform [data-pick]').forEach(b => b.onclick = () => { $('#f_icon').value = b.dataset.pick; $$('#theform [data-pick]').forEach(x => x.classList.toggle('on', x === b)); const c = $('#theform .iconbtn .cur'); if (c) c.innerHTML = iconDot(b.dataset.pick, 40); $('#theform .ipicker').hidden = true; });
  const io = $('#theform [data-iconopen]'); if (io) io.onclick = () => { const pk = $('#theform .ipicker'); pk.hidden = !pk.hidden; };
  if (opts.after) opts.after();
  if (opts.onChange) $$('#theform select').forEach(s => s.onchange = () => opts.onChange());
}

function accOptions(extra) { return S.accounts.filter(a => a.active !== false || extra === a.id).map(a => [a.id, `${iconText(a.icon)} ${a.name} (${cur(a.currencyId)?.short})`]); }
function catOptions(type, selected) {
  const l = catSorted(type); return l.map(c => [c.id, '  '.repeat(catDepth(c)) + c.name]);
}
function ensureSetup(cb) {
  if (S.currencies.length && S.accounts.length) return cb();
  openSetup(cb);
}
function openSetup(cb) {
  const need = !S.currencies.length;
  form('Welcome! Let’s set up', [
    ...(need ? [{ k: 'cur', label: 'Your main currency', type: 'select', value: 'SAR', options: PRESET_CUR.map(([c, n]) => [c, `${c} – ${n}`]) }] : []),
    { k: 'name', label: 'First account name', value: 'Cash', ph: 'Cash, Bank card…' },
    { k: 'open', label: 'Current balance', type: 'number', value: 0 }], v => {
      if (!v.name) return 'Enter a name';
      if (need) { const p = PRESET_CUR.find(x => x[0] === v.cur); const id = uid(); S.currencies.push({ id, short: p[0], name: p[1], dec: p[2], rate: 1 }); S.settings.defCur = id; }
      S.accounts.push({ id: uid(), name: v.name, icon: '💵', currencyId: S.settings.defCur, opening: v.open || 0, active: true });
      S.settings.setup = true; setTimeout(cb, 50);
    }, { ok: 'Start' });
}

// transaction sheet
function openTx(init = {}, mode = 'tx') {
  ensureSetup(() => {
    const isEdit = !!init.id && mode === 'tx';
    const t = Object.assign({ type: 'expense', accountId: (S.accounts.find(a => a.active !== false && a.isDefault) || S.accounts.find(a => a.active !== false) || S.accounts[0])?.id, date: Date.now(), sum: null, name: '', desc: '', categoryId: '', toAccountId: '', toSum: null, repeat: 'none' }, init);
    if (t.prepayId) t.accountId = 'pp:' + t.prepayId;
    if (!isEdit && !t.categoryId && mode === 'tx') t.categoryId = defCatId(t.type);
    if (mode === 'planned' && !init.id) t.date = Date.now() + DAY;
    let tplSave = false, moreOpen = false;
    const exSet = new Set(init.groupId ? S.tx.filter(x => x.groupId === init.groupId).map(x => x.id) : (isEdit ? [init.id] : []));
    t._ex = exSet;
    const splitTotal = () => {
      const parts = t.parts || []; const ccs = new Set(parts.map(p => resolveAcc(p.accountId)?.currencyId));
      if (ccs.size <= 1) return fmt(parts.reduce((s, p) => s + (p.sum || 0), 0), [...ccs][0]);
      return fmtB(parts.reduce((s, p) => s + toBase(p.sum || 0, resolveAcc(p.accountId)?.currencyId), 0));
    };
    const splitHtml = () => `<div class="f"><span class="mut" style="font-size:.78em;font-weight:600">Paid from (split across accounts)</span>
      ${(t.parts || []).map((p, i) => `<div class="splitrow"><select data-pf="acc">${accountChoices({ type: 'expense', accountId: p.accountId, _ex: exSet }).map(([v, l]) => `<option value="${v}" ${v === p.accountId ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <input data-pf="sum" type="text" inputmode="decimal" placeholder="0" value="${p.sum ?? ''}"><button type="button" class="icon-btn" data-delpart="${i}" aria-label="Remove">✕</button></div>`).join('')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px"><button type="button" class="btn sm sec" data-addpart>＋ Add account</button><span>Total <b id="splitTotal">${splitTotal()}</b></span></div>
      <button type="button" class="linkbtn" data-split style="margin-top:8px">Use a single account</button></div>`;
    const saveSplit = () => {
      if (!t.categoryId) return toast('Choose a category');
      const parts = (t.parts || []).filter(x => x.accountId);
      if (parts.length < 2) return toast('Add at least two accounts');
      if (parts.some(x => !(x.sum > 0))) return toast('Enter an amount for every account');
      if (mode !== 'tx' || t.date > Date.now() + 60000) return toast('Split payments can’t be scheduled – use today’s date or earlier');
      const need = {}, recs = [], gid = init.groupId || uid();
      for (const [i, x] of parts.entries()) {
        let accountId = x.accountId, prepayId;
        if (String(accountId).startsWith('pp:')) { const pp = prepay(accountId.slice(3)); if (!pp) return toast('Prepayment not found'); need[pp.id] = (need[pp.id] || 0) + x.sum; prepayId = pp.id; accountId = pp.accountId; }
        recs.push({ id: uid(), groupId: gid, gi: i, type: 'expense', accountId, categoryId: t.categoryId, sum: x.sum, name: t.name, desc: t.desc, toAccountId: '', toSum: null, prepayId, date: t.date });
      }
      for (const id in need) { const pp = prepay(id); const left = prepayLeft(pp, exSet); if (need[id] > left + 0.0001) return toast('Exceeds the prepayment balance (' + fmt(left, acc(pp.accountId).currencyId) + ' left)'); }
      S.tx = S.tx.filter(x => !exSet.has(x.id)); S.tx.push(...recs);
      save(); closeSheet(); render();
    };
    const draw = () => {
      if (t.type !== 'expense' && t.split) { const p0 = (t.parts || [])[0]; if (p0) { t.accountId = p0.accountId; t.sum = p0.sum; } t.split = false; t.parts = null; }
      const isTr = t.type === 'transfer';
      const showMore = moreOpen || t.type === 'prepayment';
      if (t.type !== 'expense' && String(t.accountId).startsWith('pp:')) t.accountId = resolveAcc(t.accountId)?.id || S.accounts[0]?.id;
      const a = resolveAcc(t.accountId), b = acc(t.toAccountId);
      const cross = isTr && a && b && a.currencyId !== b.currencyId;
      if (!isTr && !cat(t.categoryId) || (cat(t.categoryId) && cat(t.categoryId).type !== t.type && !isTr)) t.categoryId = defCatId(t.type) || catSorted(t.type)[0]?.id || '';
      if (isTr && (!t.toAccountId || t.toAccountId === t.accountId)) t.toAccountId = S.accounts.find(x => x.id !== t.accountId)?.id || '';
      const tpls = !isEdit && mode === 'tx' ? S.templates : [];
      sheet(`<button class="x" data-a="close">✕</button><h2>${mode === 'planned' ? (init.id ? 'Edit planned operation' : 'Planned operation') : isEdit ? 'Edit transaction' : 'New transaction'}</h2>
      <div class="seg" style="margin-bottom:${showMore ? 6 : 12}px">${[['expense', 'Expense', 'e'], ['income', 'Income', 'i'], ['transfer', 'Transfer', 't']].map(([k, l, c]) => `<button type="button" class="${t.type === k ? 'on ' + c : ''}" data-ty="${k}">${l}</button>`).join('')}${t.type === 'prepayment' ? '' : `<button type="button" class="more" data-more aria-label="More types" title="Prepayment">${showMore ? '▴' : '▾'}</button>`}</div>
      ${showMore ? `<div class="seg" style="margin-bottom:12px"><button type="button" class="${t.type === 'prepayment' ? 'on p' : ''}" data-ty="prepayment">🅿 Prepayment</button></div>` : ''}
      <form id="txf" autocomplete="off">
      <label class="f" style="margin-bottom:6px"><span>${t.type === 'prepayment' ? 'Prepayment for (e.g. Annual rent)' : 'Name'}</span><input id="t_name" type="text" value="${esc(t.name)}" autocapitalize="sentences" autocomplete="off"></label><div id="namesug" class="namesug" hidden></div><div style="height:12px"></div>
      ${t.split ? splitHtml() : `<label class="f"><span>Amount ${a ? '(' + esc(cur(a.currencyId)?.short) + ')' : ''}</span><input class="amtin" id="t_sum" type="text" inputmode="decimal" placeholder="0" value="${t.sum ?? ''}"></label>
      <label class="f"><span>${isTr ? 'From account' : t.type === 'expense' ? 'Paid from' : t.type === 'prepayment' ? 'Paid from account' : 'Account'}</span><select id="t_acc">${accountChoices(t).map(([v, l]) => `<option value="${v}" ${v === t.accountId ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      ${t.type === 'expense' && mode === 'tx' ? '<button type="button" class="linkbtn" data-split>＋ Split across several accounts</button>' : ''}`}
      ${isTr ? `<label class="f"><span>To account</span><select id="t_to">${accOptions(t.toAccountId).filter(([v]) => v !== t.accountId).map(([v, l]) => `<option value="${v}" ${v === t.toAccountId ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        ${cross ? `<label class="f"><span>Amount received (${esc(cur(b.currencyId)?.short)})</span><input id="t_tosum" type="text" inputmode="decimal" value="${t.toSum ?? ''}" placeholder="auto"></label>` : ''}`
          : t.type === 'prepayment' ? '' : `<label class="f"><span>Category</span><select id="t_cat">${catOptions(t.type).map(([v, l]) => `<option value="${v}" ${v === t.categoryId ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`}
      <label class="f"><span>Note (optional)</span><input id="t_desc" type="text" value="${esc(t.desc)}"></label>
      <label class="f"><span>Date & time</span><input id="t_date" type="datetime-local" value="${dtLocal(t.date)}"></label>
      ${mode === 'planned' ? `<label class="f"><span>Repeat</span><select id="t_rep">${REPEATS.map(([v, l]) => `<option value="${v}" ${t.repeat === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}

      <div class="btns"><button class="btn" type="submit">Save</button></div>
      ${isEdit || (mode === 'planned' && init.id) ? '<div class="btns"><button type="button" class="btn danger" id="t_del">Delete</button></div>' : ''}</form>`);
      $$('[data-ty]').forEach(b => b.onclick = () => { sync(); t.type = b.dataset.ty; draw(); });
      const mb = $('[data-more]'); if (mb) mb.onclick = () => { sync(); moreOpen = !moreOpen; draw(); };
      if ($('#t_acc')) $('#t_acc').onchange = () => { sync(); draw(); };
      if ($('#t_to')) $('#t_to').onchange = () => { sync(); draw(); };
      const sp = $('[data-split]'); if (sp) sp.onclick = () => {
        sync();
        if (!t.split) { t.split = true; const first = resolveAcc(t.accountId)?.id; const second = S.accounts.find(x => x.active !== false && x.id !== first)?.id || t.accountId; t.parts = [{ accountId: t.accountId, sum: t.sum }, { accountId: second, sum: null }]; }
        else { const p0 = (t.parts || [])[0]; if (p0) { t.accountId = p0.accountId; t.sum = p0.sum; } t.split = false; t.parts = null; }
        draw();
      };
      const ap = $('[data-addpart]'); if (ap) ap.onclick = () => { sync(); t.parts.push({ accountId: S.accounts.find(x => x.active !== false)?.id, sum: null }); draw(); };
      $$('[data-delpart]').forEach(bt => bt.onclick = () => { sync(); t.parts.splice(+bt.dataset.delpart, 1); if (t.parts.length < 2) { const p0 = t.parts[0]; if (p0) { t.accountId = p0.accountId; t.sum = p0.sum; } t.split = false; t.parts = null; } draw(); });
      $$('[data-pf=sum]').forEach(el => el.oninput = () => { sync(); const tt = $('#splitTotal'); if (tt) tt.textContent = splitTotal(); });
      wireNameSuggest(t);
      if (!isEdit && !t.sum && !t.name) setTimeout(() => ($('#t_name') || $('#t_sum'))?.focus(), 80);
      if ($('#t_del')) $('#t_del').onclick = () => (mode === 'tx' && init.type === 'prepayment' && prepayUsed(init.id) > 0) ? toast('Delete the expenses paid from this prepayment first') : (mode === 'planned' ? confirmBox('Delete this planned operation?', () => { S.planned = S.planned.filter(x => x.id !== init.id); save(); render(); }) : impactBox('Delete this transaction?', () => { S.tx = S.tx.filter(x => !exSet.has(x.id)); }, { hint: 'Deleting it normally puts the amount back into the account (and removes it from income/expense totals of the account). Keep the balance as it is?', yes: 'Delete and update account balance', no: 'Delete only – leave balances unchanged' }));
      $('#txf').onsubmit = e => {
        e.preventDefault(); sync();
        if (t.split && t.type === 'expense') return saveSplit();
        if (!(t.sum > 0)) return toast('Enter a number greater than zero');
        if (!t.accountId) return toast('Choose an account');
        if (t.type === 'transfer') {
          if (!t.toAccountId || t.toAccountId === t.accountId) return toast('Transfer can only be made between different accounts');
          const aa = acc(t.accountId), bb = acc(t.toAccountId);
          if (aa.currencyId !== bb.currencyId) { if (!(t.toSum > 0)) t.toSum = +(t.sum * rateOf(aa.currencyId) / rateOf(bb.currencyId)).toFixed(cur(bb.currencyId).dec); } else t.toSum = t.sum;
        } else if (t.type === 'prepayment') {
          if (!t.name) return toast('Enter what the prepayment is for');
          const used = isEdit ? prepayUsed(init.id) : 0; if (t.sum < used - 0.0001) return toast('Less than already used (' + fmt(used, acc(t.accountId).currencyId) + ')');
        } else if (!t.categoryId) return toast('Choose a category');
        let prepayId;
        if (String(t.accountId).startsWith('pp:')) {
          const pp = prepay(t.accountId.slice(3)); if (!pp) return toast('Prepayment not found');
          const left = prepayLeft(pp, exSet); if (t.sum > left + 0.0001) return toast('Exceeds the prepayment balance (' + fmt(left, acc(pp.accountId).currencyId) + ' left)');
          prepayId = pp.id; t.accountId = pp.accountId;
        }
        const rec = { type: t.type, accountId: t.accountId, categoryId: t.type === 'transfer' ? '' : t.categoryId, sum: t.sum, name: t.name, desc: t.desc, toAccountId: t.type === 'transfer' ? t.toAccountId : '', toSum: t.type === 'transfer' ? t.toSum : null, prepayId, groupId: undefined, gi: undefined };
        if (isEdit && init.groupId) S.tx = S.tx.filter(x => x.groupId !== init.groupId || x.id === init.id);
        if (tplSave) S.templates.push({ id: uid(), tplName: t.name || (t.type === 'transfer' ? 'Transfer' : catPath(t.categoryId)), ...rec });
        const future = t.date > Date.now() + 60000;
        if (mode === 'planned' || ((t.repeat !== 'none' || future) && !isEdit)) {
          if (t.date < Date.now() - 60000 && mode === 'planned' && !init.id) return toast('Planned operation cannot be scheduled for a past date');
          const pr = { ...rec, date: t.date, repeat: t.repeat || 'none', active: true };
          if (mode === 'planned' && init.id) Object.assign(S.planned.find(x => x.id === init.id), pr); else S.planned.push({ id: uid(), ...pr });
          toast('Scheduled in planned operations');
        } else if (isEdit) Object.assign(S.tx.find(x => x.id === init.id), rec, { date: t.date });
        else S.tx.push({ id: uid(), ...rec, date: t.date });
        save(); closeSheet(); render();
      };
    };
    const sync = () => {
      const g = id => $('#' + id); const num = el => { const n = parseFloat((el.value || '').replace(/,/g, '.').replace(/[^\d.\-]/g, '')); return isNaN(n) ? null : n; };
      if (g('t_sum')) t.sum = num(g('t_sum')); if (g('t_acc')) t.accountId = g('t_acc').value; if (g('t_to')) t.toAccountId = g('t_to').value;
      if (g('t_tosum')) t.toSum = num(g('t_tosum')); if (g('t_cat')) t.categoryId = g('t_cat').value; if (g('t_name')) t.name = g('t_name').value.trim();
      if (g('t_desc')) t.desc = g('t_desc').value.trim(); if (g('t_date') && g('t_date').value) t.date = +new Date(g('t_date').value);
      if (g('t_rep')) t.repeat = g('t_rep').value;
      if (t.split) { const ac = $$('[data-pf=acc]'), su = $$('[data-pf=sum]'); if (ac.length) t.parts = ac.map((e, i) => ({ accountId: e.value, sum: num(su[i]) })); }
    };
    draw();
  });
}

function nameStats() {
  const m = new Map();
  [...S.tx, ...S.planned, ...S.templates].forEach(x => { const n = (x.name || '').trim(); if (!n) return; const k = n.toLowerCase(); const e = m.get(k) || { name: n, c: 0, last: 0, types: {} }; e.c++; if ((x.date || 0) >= e.last) { e.last = x.date || 0; e.name = n; } e.types[x.type] = 1; m.set(k, e); });
  return [...m.values()];
}
function wireNameSuggest(t) {
  const inp = $('#t_name'), box = $('#namesug'); if (!inp || !box) return;
  const stats = nameStats();
  const show = () => {
    const q = inp.value.trim().toLowerCase(); if (!q) { box.hidden = true; return; }
    const words = q.split(/\s+/).filter(Boolean); const lc = e => e.name.toLowerCase();
    const rank = e => lc(e).startsWith(q) ? 0 : lc(e).includes(q) ? 1 : 2; // exact order first, then any order
    const list = stats.filter(e => lc(e) !== q && words.every(w => lc(e).includes(w)))
      .sort((a, b) => (rank(a) - rank(b)) || ((b.types[t.type] ? 1 : 0) - (a.types[t.type] ? 1 : 0)) || b.c - a.c || b.last - a.last).slice(0, 6);
    if (!list.length) { box.hidden = true; return; }
    box.innerHTML = list.map(e => `<div class="sugrow" data-n="${esc(e.name)}">${esc(e.name)}<span class="mut"> ×${e.c}</span></div>`).join(''); box.hidden = false;
  };
  inp.addEventListener('input', show);
  inp.addEventListener('blur', () => { box.hidden = true; });
  inp.addEventListener('focus', () => { if (inp.value.trim()) show(); });
  box.addEventListener('pointerdown', e => { const r = e.target.closest('[data-n]'); if (!r) return; e.preventDefault(); inp.value = r.dataset.n; t.name = inp.value; box.hidden = true; });
  if (document.activeElement === inp) show();
}
function accountChoices(t) {
  const sel = String(t.accountId || '');
  const list = accOptions(sel.startsWith('pp:') ? resolveAcc(sel)?.id : sel);
  if (t.type === 'expense') prepayList().filter(p => prepayLeft(p, t._ex || t.id) > 0.0001 || sel === 'pp:' + p.id)
    .forEach(p => list.push(['pp:' + p.id, `🅿 Prepayment: ${p.name || 'Unnamed'} (${fmt(prepayLeft(p, t._ex || t.id), acc(p.accountId)?.currencyId)} left)`]));
  return list;
}
const accTx = id => collapse(S.tx.filter(t => t.accountId === id || t.toAccountId === id).sort((x, y) => y.date - x.date));
function editAccount(id) {
  const a = id ? acc(id) : null;
  if (!S.currencies.length) return openSetup(() => editAccount());
  form(a ? 'Edit account' : 'New account', [
    { k: 'name', label: 'Name', value: a?.name || '' },
    { k: 'icon', label: 'Icon', type: 'icon', value: a?.icon || 'svg:wallet-blue' },
    { k: 'type', label: 'Type', type: 'select', value: a ? accType(a) : 'account', options: ACC_TYPES },
    ...((S.groups || []).length ? [{ k: 'group', label: 'Group', type: 'select', value: a?.groupId || '', options: [['', '— none —'], ...S.groups.map(g => [g.id, g.name])] }] : []),
    { k: 'cur', label: 'Currency', type: 'select', value: a?.currencyId || S.settings.defCur, options: S.currencies.map(c => [c.id, c.short + ' – ' + (c.name || '')]) },
    { k: 'open', label: 'Current balance', type: 'number', value: a ? Math.round((balances()[a.id] || 0) * 100) / 100 : 0 },
    { k: 'active', label: 'Active', type: 'checkbox', value: a ? a.active !== false : true },
    { k: 'def', label: 'Use as default account', type: 'checkbox', value: !!a?.isDefault }], v => {
      if (!v.name) return 'Enter a name';
      if (v.def) S.accounts.forEach(x => x.isDefault = false);
      const rec = { type: v.type, name: v.name, icon: v.icon, currencyId: v.cur, active: v.active, isDefault: v.def };
      if (v.group) rec.groupId = v.group; else if (a) delete a.groupId;
      if (!a) { S.accounts.push({ id: uid(), ...rec, opening: v.open || 0 }); return; }
      Object.assign(a, rec);
      const cb = balances()[a.id] || 0, nb = v.open ?? 0, diff = Math.round((nb - cb) * 100) / 100;
      if (diff !== 0) setTimeout(() => impactBox('Change balance of ' + a.name + ' to ' + fmt(nb, a.currencyId) + '?', () => {
        S.tx.push({ id: uid(), type: diff > 0 ? 'income' : 'expense', accountId: a.id, categoryId: '', sum: Math.abs(diff), name: 'Balance adjustment', desc: 'Balance adjustment', date: Date.now() });
      }, { alt: () => { a.opening = Math.round(((a.opening || 0) + diff) * 1e6) / 1e6; }, hint: 'Choose how to apply it.', yes: 'Record an adjustment transaction', no: 'Just set the balance (no transaction, nothing else changes)' }), 0);
    }, a ? { extraHtml: `<div class="card" style="margin:14px 0 0"><button type="button" class="acctx" data-acctx>Transactions (${accTx(a.id).length}) <span>▾</span></button><div id="acctxlist" hidden></div></div>`, after: () => { const bt = $('[data-acctx]'); if (bt) bt.onclick = () => { const l = $('#acctxlist'); if (l.hidden && !l.dataset.done) { const list = accTx(a.id); l.innerHTML = list.length ? list.map(t => txRowHtml(t, { time: true })).join('') : emptyMsg('No transactions for this account.'); l.dataset.done = 1; } l.hidden = !l.hidden; bt.querySelector('span').textContent = l.hidden ? '▾' : '▴'; }; }, onDelete: () => { const used = S.tx.some(t => t.accountId === a.id || t.toAccountId === a.id); if (used) { a.active = false; toast('Account has transactions – marked inactive'); } else S.accounts = S.accounts.filter(x => x.id !== a.id); }, delMsg: 'Delete this account? (If it has transactions it will be hidden instead.)' } : {});
}
function editGroup(id) {
  const g = id ? (S.groups || []).find(x => x.id === id) : null;
  if (!S.accounts.length) return toast('Create an account first');
  form(g ? 'Edit group' : 'New group', [
    { k: 'name', label: 'Group name', value: g?.name || '' },
    { k: 'icon', label: 'Group icon', type: 'icon', value: g?.icon || '📁' },
    { k: 'members', label: 'Accounts in this group (accounts already in another group are hidden)', type: 'multi', value: g ? S.accounts.filter(x => x.groupId === g.id).map(x => x.id) : [], options: S.accounts.filter(x => !x.groupId || (g && x.groupId === g.id) || !(S.groups || []).some(q => q.id === x.groupId)).map(x => [x.id, `${x.name} (${cur(x.currencyId)?.short || ''})`, x.icon || '💵']) }], v => {
      if (!v.name) return 'Enter a group name';
      if (!S.groups) S.groups = [];
      let grp = g; if (!grp) { grp = { id: uid(), name: v.name, icon: v.icon }; S.groups.push(grp); } else { grp.name = v.name; grp.icon = v.icon; }
      S.accounts.forEach(x => { if (v.members.includes(x.id)) x.groupId = grp.id; else if (x.groupId === grp.id) delete x.groupId; });
      (U.grpOpen || (U.grpOpen = new Set())).delete(grp.id);
    }, g ? { onDelete: () => { S.accounts.forEach(x => { if (x.groupId === g.id) delete x.groupId; }); S.groups = S.groups.filter(x => x.id !== g.id); }, delMsg: 'Delete this group? The accounts stay, they just leave the group.' } : {});
}
function editCategory(id, type) {
  const c = id && cat(id) ? cat(id) : null; const tp = c?.type || type || U.catType;
  const parents = catSorted(tp).filter(x => !c || (!catDescendants(c.id).includes(x.id) && catDepth(x) < 2));
  form(c ? 'Edit category' : 'New category', [
    { k: 'name', label: 'Name', value: c?.name || '' },
    { k: 'parent', label: 'Parent category', type: 'select', value: c?.parentId || '', options: [['', '— none —'], ...parents.map(p => [p.id, catPath(p.id)])] },
    { k: 'def', label: `Use as the default ${tp} category`, type: 'checkbox', value: !!c?.isDefault }], v => {
      if (!v.name) return 'Enter a name';
      const nid = c ? c.id : uid();
      if (v.def) S.categories.forEach(x => { if (x.type === tp) delete x.isDefault; });
      if (c) { c.name = v.name; c.parentId = v.parent || null; if (v.def) c.isDefault = true; else delete c.isDefault; } else S.categories.push({ id: nid, isDefault: v.def || undefined, name: v.name, type: tp, parentId: v.parent || null, order: Math.max(0, ...S.categories.map(x => x.order)) + 1 });
    }, c ? {
      onDelete: () => {
        const ids = new Set(catDescendants(c.id)); let other = S.categories.find(x => x.type === c.type && x.name === 'Other' && !ids.has(x.id));
        if (!other) { other = { id: uid(), name: 'Other', type: c.type, parentId: null, order: 999 }; S.categories.push(other); }
        S.tx.forEach(t => { if (ids.has(t.categoryId)) t.categoryId = other.id; }); [...S.templates, ...S.planned].forEach(t => { if (ids.has(t.categoryId)) t.categoryId = other.id; });
        S.categories = S.categories.filter(x => !ids.has(x.id));
      }, delMsg: 'Delete this category and its subcategories? Their transactions move to “Other”.'
    } : {});
}
function editCurrency(id) {
  const c = id ? cur(id) : null; const isDef = c && c.id === S.settings.defCur;
  const presets = PRESET_CUR.filter(p => !S.currencies.some(x => x.short === p[0]));
  const fields = c ? [{ k: 'short', label: 'Code / symbol', value: c.short }, { k: 'name', label: 'Name', value: c.name }, { k: 'dec', label: 'Decimal places (0-4)', type: 'number', value: c.dec }]
    : [{ k: 'preset', label: 'Pick a common currency', type: 'select', value: '', options: [['', '— custom —'], ...presets.map(p => [p[0], p[0] + ' – ' + p[1]])] }, { k: 'short', label: 'Code / symbol (if custom)', value: '' }, { k: 'name', label: 'Name (if custom)', value: '' }, { k: 'dec', label: 'Decimal places', type: 'number', value: 2 }];
  if (!isDef) fields.push({ k: 'rate', label: `Exchange rate: 1 unit = ? ${defCur().short || 'default currency'}`, type: 'number', value: c?.rate ?? 1 });
  form(c ? 'Edit currency' : 'New currency', fields, v => {
    let short = v.short, name = v.name, dec = v.dec ?? 2;
    if (v.preset) { const p = PRESET_CUR.find(x => x[0] === v.preset); short = p[0]; name = p[1]; dec = p[2]; }
    if (!short) return 'Enter a currency code';
    dec = Math.max(0, Math.min(4, Math.round(dec)));
    const rate = isDef ? 1 : (v.rate > 0 ? v.rate : null); if (!rate) return 'Enter a valid exchange rate';
    if (c) Object.assign(c, { short, name, dec, rate }); else { const nc = { id: uid(), short, name, dec, rate }; S.currencies.push(nc); if (!S.settings.defCur) S.settings.defCur = nc.id; }
  }, c && !isDef ? { onDelete: () => { if (S.accounts.some(a => a.currencyId === c.id)) return toast('Currency is used by an account'); S.currencies = S.currencies.filter(x => x.id !== c.id); }, delMsg: 'Delete this currency?' } : {});
}
function editBudget(id) {
  const b = id ? S.budgets.find(x => x.id === id) : null;
  const draw = (cur0) => {
    const kind = cur0.kind, per = cur0.period;
    const fields = [{ k: 'name', label: 'Name', value: cur0.name || '' }, { k: 'kind', label: 'Budget type', type: 'select', value: kind, options: [['overall', 'All expenses'], ['category', 'By category'], ['account', 'By account']] },
    ...(kind === 'category' ? [{ k: 'refs', label: 'Categories', type: 'multi', value: cur0.refs, options: catSorted('expense').map(c => [c.id, catPath(c.id)]) }] : []),
    ...(kind === 'account' ? [{ k: 'refs', label: 'Accounts', type: 'multi', value: cur0.refs, options: S.accounts.map(a => [a.id, a.name]) }] : []),
    { k: 'amount', label: 'Amount (' + defCur().short + ')', type: 'number', value: cur0.amount ?? '' },
    { k: 'period', label: 'Period', type: 'select', value: per, options: [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly'], ['custom', 'Custom dates']] },
    ...(per === 'custom' ? [{ k: 'from', label: 'Start date', type: 'date', value: ymd(cur0.from || Date.now()) }, { k: 'to', label: 'End date', type: 'date', value: ymd(cur0.to || Date.now() + 30 * DAY) }] : [])];
    form(b ? 'Edit budget' : 'New budget', fields, v => {
      if (!v.name) return 'Enter a name'; if (!(v.amount > 0)) return 'Enter a number greater than zero';
      if (v.kind !== 'overall' && !(v.refs || []).length) return 'Select at least one item';
      const rec = { name: v.name, kind: v.kind, refs: v.kind === 'overall' ? [] : v.refs, amount: v.amount, period: v.period, from: v.from, to: v.to };
      if (b) Object.assign(b, rec); else S.budgets.push({ id: uid(), ...rec });
    }, { onDelete: b ? () => { S.budgets = S.budgets.filter(x => x.id !== b.id); } : null, delMsg: 'Delete this budget?', onChange: () => { const rd = k => $('#f_' + k)?.value; draw({ ...cur0, name: rd('name'), kind: rd('kind'), period: rd('period'), amount: parseFloat((rd('amount') || '').replace(',', '.')) || cur0.amount, refs: cur0.kind === rd('kind') ? $$('input[name=f_refs]:checked').map(x => x.value) : [], from: cur0.from, to: cur0.to }); } });
  };
  draw(b ? { ...b } : { name: '', kind: 'overall', period: 'monthly', refs: [], amount: null });
}
function editDebt(id) {
  ensureSetup(() => {
    const d = id ? S.debts.find(x => x.id === id) : null;
    form(d ? 'Edit debt' : 'New debt', [
      { k: 'dir', label: 'Type', type: 'select', value: d?.dir || 'lend', options: [['lend', 'I lent money (owed to me)'], ['borrow', 'I borrowed money (I owe)']] },
      { k: 'name', label: 'Person / name', value: d?.name || '' }, { k: 'amount', label: 'Amount', type: 'number', value: d?.amount ?? '' },
      { k: 'acc', label: 'Account', type: 'select', value: d?.accountId || S.accounts[0].id, options: accOptions(d?.accountId) },
      { k: 'date', label: 'Date', type: 'date', value: ymd(d?.date || Date.now()) }, { k: 'desc', label: 'Note', value: d?.desc || '' }], v => {
        if (!v.name) return 'Enter a name'; if (!(v.amount > 0)) return 'Enter a number greater than zero';
        if (d) { const chg = { dir: v.dir, name: v.name, amount: v.amount, accountId: v.acc, date: v.date, desc: v.desc }; if (chg.amount === d.amount && chg.accountId === d.accountId && chg.dir === d.dir) { Object.assign(d, chg); syncDebtTx(d); } else setTimeout(() => impactBox('Save changes to this debt?', () => { Object.assign(d, chg); syncDebtTx(d); }), 0); }
        else { const nd = { id: uid(), dir: v.dir, name: v.name, amount: v.amount, accountId: v.acc, date: v.date, desc: v.desc, repayments: [] }; S.debts.push(nd); syncDebtTx(nd); }
      }, d ? { onDelete: () => { U.stack = U.stack.filter(p => p.name !== 'debt'); S.debts = S.debts.filter(x => x.id !== d.id); setTimeout(() => impactBox('Delete this debt?', () => { S.tx = S.tx.filter(t => t.debtId !== d.id); }, { hint: 'Its payments are also removed from your accounts. Keep account balances as they are?', yes: 'Delete and update account balances', no: 'Delete only – leave balances unchanged' }), 0); }, delMsg: 'Delete this debt and all related operations?' } : {});
  });
}
function syncDebtTx(d) {
  S.tx = S.tx.filter(t => t.debtId !== d.id);
  const out = d.dir === 'lend';
  S.tx.push({ id: uid(), debtId: d.id, type: out ? 'expense' : 'income', accountId: d.accountId, categoryId: '', sum: d.amount, name: d.name, desc: d.desc || 'Debt', date: d.date + 12 * 36e5 });
  (d.repayments || []).forEach(r => S.tx.push({ id: uid(), debtId: d.id, repId: r.id, type: r.direct ? 'expense' : (r.sum > 0) === out ? 'income' : 'expense', accountId: r.accountId, categoryId: r.direct ? (r.categoryId || '') : '', noBal: r.direct ? true : undefined, sum: Math.abs(r.sum), name: d.name, desc: r.sum > 0 ? 'Repayment' : 'Increase', date: r.date + 12 * 36e5 }));
}
function editRepay(debtId, repId, increase) {
  const d = S.debts.find(x => x.id === debtId); const r = repId ? d.repayments.find(x => x.id === repId) : null; const inc = increase || (r && r.sum < 0);
  form(r ? 'Edit entry' : inc ? (d.dir === 'lend' ? 'I lent more' : 'I borrowed more') : (d.dir === 'lend' ? 'They paid me back' : 'I paid back'), [
    { k: 'sum', label: 'Amount', type: 'number', value: r ? Math.abs(r.sum) : Math.max(0, debtBy(d).get((cur(acc(d.accountId)?.currencyId) || defCur()).id) || 0) || '' },
    { k: 'acc', label: 'Account', type: 'select', value: r?.direct ? '__direct' : (r?.accountId || d.accountId), options: [...(inc ? [] : [['__direct', '🧾 No account – record directly as an expense']]), ...accOptions(r?.accountId)] },
    ...(inc ? [] : [{ k: 'cat', label: 'Expense category (only if recorded directly as an expense)', type: 'select', value: r?.categoryId || '', options: [['', '— none —'], ...catOptions('expense')] }]),
    { k: 'date', label: 'Date', type: 'date', value: ymd(r?.date || Date.now()) }], v => {
      if (!(v.sum > 0)) return 'Enter a number greater than zero';
      const direct = v.acc === '__direct';
      const rec = { sum: inc ? -v.sum : v.sum, accountId: direct ? d.accountId : v.acc, date: v.date, direct: direct || undefined, categoryId: direct ? (v.cat || '') : undefined };
      if (r) { setTimeout(() => impactBox('Save changes to this entry?', () => { Object.assign(r, rec); syncDebtTx(d); }), 0); return; }
      d.repayments.push({ id: uid(), ...rec }); syncDebtTx(d);
    }, r ? { onDelete: () => { setTimeout(() => impactBox('Delete this entry?', () => { d.repayments = d.repayments.filter(x => x.id !== r.id); syncDebtTx(d); }), 0); }, delMsg: 'Delete this entry?' } : {});
}

// ───────────────────────── data import / export ─────────────────────────
function download(name, text, mime) {
  const blob = new Blob([text], { type: mime }); const file = new File([blob], name, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: name }).catch(() => { }); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function exportJSON() {
  S.settings.lastBackup = Date.now(); save();
  download(`expense-tracker-backup-${ymd(Date.now())}.json`, JSON.stringify({ app: 'expense-tracker', version: 1, exportedAt: new Date().toISOString(), state: S }), 'application/json');
  toast('Backup created – save it to Files'); setTimeout(render, 300);
}
const csvCell = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
function exportCSV() {
  const rows = [['Date', 'Time', 'Type', 'Account', 'Category', 'Amount', 'Currency', 'To account', 'To amount', 'Name', 'Note']];
  [...S.tx].sort((a, b) => a.date - b.date).forEach(t => { const a = acc(t.accountId), b = acc(t.toAccountId); rows.push([ymd(t.date), hm(t.date), t.debtId ? 'debt-' + t.type : t.type, a?.name, t.categoryId ? catPath(t.categoryId) : '', t.sum, cur(a?.currencyId)?.short, b?.name || '', t.type === 'transfer' ? t.toSum : '', t.name, t.desc]); });
  download(`transactions-${ymd(Date.now())}.csv`, '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\n'), 'text/csv');
}
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false; text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some(x => x !== '')) rows.push(row); return rows;
}
function findOrMakeCategory(path, type) {
  const parts = path.split('›').map(s => s.trim()).filter(Boolean); let pid = null, c = null;
  parts.forEach(name => { c = S.categories.find(x => x.type === type && x.name.toLowerCase() === name.toLowerCase() && (x.parentId || null) === pid); if (!c) { c = { id: uid(), name, type, parentId: pid, order: Math.max(0, ...S.categories.map(x => x.order)) + 1 }; S.categories.push(c); } pid = c.id; });
  return c;
}
function clearData() {
  form('Selective data cleaning', [
    { k: 'tx', label: 'Transactions (including debts’ operations)', type: 'checkbox' }, { k: 'planned', label: 'Planned operations', type: 'checkbox' }, { k: 'tpl', label: 'Templates', type: 'checkbox' },
    { k: 'budgets', label: 'Budgets', type: 'checkbox' }, { k: 'debts', label: 'Debts', type: 'checkbox' }, { k: 'all', label: 'EVERYTHING (reset the app)', type: 'checkbox' }], v => {
      if (!Object.values(v).some(Boolean)) return 'Select data to remove';
      if (v.all) { const th = S.settings.theme; S = defaultState(); S.settings.theme = th; U.stack = []; return; }
      if (v.tx) S.tx = []; if (v.planned) S.planned = []; if (v.tpl) S.templates = []; if (v.budgets) S.budgets = [];
      if (v.debts) { S.debts = []; S.tx = S.tx.filter(t => !t.debtId); }
    }, { ok: 'Delete selected data' });
}

// ───────────────────────── passcode ─────────────────────────
async function sha(s) { try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('et1:' + s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); } catch (e) { return 'x' + btoa(s); } }
function keypad(title, onDone, len = 4, cancel) {
  let val = ''; const root = $('#lock-root');
  const draw = (shake) => {
    root.innerHTML = `<div class="lock"><div style="font-size:2.4em">🔒</div><h2 style="margin:0">${esc(title)}</h2><div class="dots ${shake ? 'shake' : ''}">${Array.from({ length: len }, (_, i) => `<i class="${i < val.length ? 'on' : ''}"></i>`).join('')}</div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, cancel ? '✕' : '', 0, '⌫'].map(k => k === '' ? '<span></span>' : `<button data-k="${k}">${k}</button>`).join('')}</div></div>`;
    $$('.pad button', root).forEach(b => b.onclick = async () => {
      const k = b.dataset.k; if (k === '⌫') val = val.slice(0, -1); else if (k === '✕') { root.innerHTML = ''; return; } else if (val.length < len) val += k;
      draw(); if (val.length === len) { const ok = await onDone(val); if (ok === false) { val = ''; draw(true); } else root.innerHTML = ''; }
    });
  }; draw();
}
function lockIfNeeded() { if (S.settings.pin) keypad('Enter passcode', async v => (await sha(v)) === S.settings.pin); }
function setPin() {
  let first = '';
  keypad('Choose a 4-digit passcode', async v => { first = v; setTimeout(() => keypad('Repeat the passcode', async v2 => { if (v2 !== first) { toast('Passcodes do not match'); return false; } S.settings.pin = await sha(v2); save(); toast('Passcode set'); render(); }, 4, true), 50); return true; }, 4, true);
}

// ───────────────────────── events ─────────────────────────
const actions = {
  tab: v => tab(v), go: (v, el) => go(v, el.dataset.arg), back: () => back(), close: () => closeSheet(),
  addtx: () => openTx(), addprepay: () => openTx({ type: 'prepayment' }), addplanned: () => openTx({}, 'planned'),
  edittx: v => { const t = S.tx.find(x => x.id === v); if (!t) return; if (t.debtId && t.debtId !== 'legacy' && t.debtId !== 'adjust') { const d = S.debts.find(x => x.id === t.debtId); if (d) { go('debt', d.id); } return; } if (t.groupId) { const rows = S.tx.filter(x => x.groupId === t.groupId).sort((a, b) => (a.gi || 0) - (b.gi || 0)); openTx({ ...rows[0], repeat: 'none', split: true, parts: rows.map(r => ({ accountId: r.prepayId ? 'pp:' + r.prepayId : r.accountId, sum: r.sum })) }); return; } openTx({ ...t, repeat: 'none' }); },
  editplanned: v => { const p = S.planned.find(x => x.id === v); openTx({ ...p }, 'planned'); },
  planok: v => { const p = S.planned.find(x => x.id === v); if (!p) return; S.tx.push({ id: uid(), type: p.type, accountId: p.accountId, categoryId: p.categoryId, sum: p.sum, name: p.name, desc: p.desc, toAccountId: p.toAccountId, toSum: p.toSum, prepayId: p.prepayId, date: Math.min(p.date, Date.now()) }); advancePlanned(p); save(); render(); toast('Added'); },
  planskip: v => { const p = S.planned.find(x => x.id === v); if (p) { advancePlanned(p); save(); render(); } },
  usetpl: v => { const x = S.templates.find(z => z.id === v); openTx({ type: x.type, accountId: x.accountId, categoryId: x.categoryId, sum: x.sum, name: x.name, desc: x.desc, toAccountId: x.toAccountId, toSum: x.toSum, date: Date.now() }); },
  deltpl: v => { S.templates = S.templates.filter(x => x.id !== v); save(); render(); },
  cattoggle: v => { const o = U.catOpen || (U.catOpen = new Set()); o.has(v) ? o.delete(v) : o.add(v); render(); },
  editacc: v => editAccount(v), editcat: (v, el) => editCategory(v, el.dataset.t), cattype: v => { U.catType = v; render(); },
  editcur: v => editCurrency(v), editbudget: v => editBudget(v), editdebt: v => editDebt(v),
  addrepay: v => editRepay(v), incdebt: v => editRepay(v, null, true), editrepay: (v, el) => editRepay(v, el.dataset.arg),
  menu: v => { if (['income', 'expense', 'transfer'].includes(v)) { U.hf = { type: v, acc: '', cat: '', q: '' }; U.ph = { kind: 'all', ref: Date.now(), from: null, to: null, sel: 'all' }; U.tab = 'hist'; U.stack = []; render(); } else if (v === 'hist') { U.hf = { type: 'all', acc: '', cat: '', q: '' }; U.ph = { kind: 'all', ref: Date.now(), from: null, to: null, sel: 'all' }; tab('hist'); } else if (v === 'rep') tab('rep'); else go(v); },
  eye: () => { U.hide = !U.hide; render(); },
  sortacc: () => { U.sortAcc = !U.sortAcc; render(); },
  accmove: (v, el) => { const A = S.accounts, i = A.findIndex(x => x.id === v); if (i < 0) return; const d = +el.dataset.arg; let j = i + d; while (j >= 0 && j < A.length && ((A[j].groupId || '') !== (A[i].groupId || '') || accType(A[j]) !== accType(A[i]))) j += d; if (j < 0 || j >= A.length) return; [A[i], A[j]] = [A[j], A[i]]; save(); render(); },
  typetoggle: v => { const o = U.typeClosed || (U.typeClosed = new Set()); o.has(v) ? o.delete(v) : o.add(v); render(); },
  expandall: () => { U.typeClosed = new Set(); U.grpOpen = new Set((S.groups || []).map(g => g.id)); render(); },
  collapseall: () => { U.typeClosed = new Set(ACC_TYPES.map(t => t[0])); U.grpOpen = new Set(); render(); },
  grptoggle: v => { const o = U.grpOpen || (U.grpOpen = new Set()); o.has(v) ? o.delete(v) : o.add(v); render(); },
  editgroup: (v, el) => { if (el && el.dataset && el.closest && el.closest('[data-a=grptoggle]')) { /* pencil inside group row */ } editGroup(v); },
  ghsetup: () => ghForm(), ghnow: () => ghBackup(true),
  sortcat: () => { U.sortCat = !U.sortCat; render(); },
  catmove: (v, el) => { const c = cat(v); if (!c) return; const sb = S.categories.filter(x => x.type === c.type && (x.parentId || null) === (c.parentId || null)).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)); const i = sb.indexOf(c), j = i + +el.dataset.arg; if (j < 0 || j >= sb.length) return; [sb[i], sb[j]] = [sb[j], sb[i]]; sb.forEach((x, k) => x.order = k * 10); save(); render(); },
  accfilter: v => { U.hf.acc = v; U.ph = { kind: 'all', ref: Date.now(), from: null, to: null, sel: 'all' }; U.tab = 'hist'; U.stack = []; render(); },
  repdrill: v => { U.hf = { type: U.rep.type === 'pie-inc' ? 'income' : 'expense', acc: U.rep.acc, cat: v, q: '' }; { const [ra, rb] = rangeOf(U.pr); U.ph = U.pr.kind === 'all' ? { kind: 'all', ref: Date.now(), from: null, to: null, sel: 'all' } : { kind: 'custom', ref: Date.now(), from: ra, to: rb - 1, sel: 'custom' }; } U.tab = 'hist'; U.stack = []; render(); },
  pshift: (v, el) => { shiftPeriod(U[el.dataset.k], +v); render(); },
  pyear: v => { const d = new Date(U.pr.ref); d.setFullYear(d.getFullYear() + +v); U.pr.ref = +d; render(); },
  hidezero: (v, el) => { U.hideZero = el.checked; render(); },
  rleaf: (v, el) => { U.rep.leaf = el.checked; render(); },
  setchk: (v, el) => { S.settings[el.dataset.k] = el.checked; save(); render(); },
  setpin: () => setPin(), rmpin: () => confirmBox('Remove the passcode?', () => { S.settings.pin = null; save(); render(); }, 'Remove'),
  exportxlsx: exportXLSX, exportcsv: exportCSV, doimport: doImport, cleardata: clearData,
};
function advancePlanned(p) {
  if (p.repeat && p.repeat !== 'none') { let n = addPeriod(p.date, p.repeat); let g = 0; while (n < Date.now() - DAY && g++ < 400) n = addPeriod(n, p.repeat); p.date = n; }
  else S.planned = S.planned.filter(x => x.id !== p.id);
}
const changes = {
  hper: el => {
    const v = el.value, n = Date.now(), d = new Date(n);
    const set = (kind, ref) => { U.ph = { kind, ref, from: null, to: null, sel: v }; };
    if (v === 'all') set('all', n); else if (v === 'today') set('day', n); else if (v === 'week') set('week', n); else if (v === 'month') set('month', n);
    else if (v === 'lastmonth') set('month', +new Date(d.getFullYear(), d.getMonth() - 1, 15)); else if (v === 'year') set('year', n); else if (v === 'lastyear') set('year', +new Date(d.getFullYear() - 1, 5, 15));
    else U.ph = { kind: 'custom', ref: n, from: U.ph.from || n - 30 * DAY, to: U.ph.to || n, sel: 'custom' };
    render();
  },
  pkind: (el) => { const p = U[el.dataset.k]; p.kind = el.value; if (p.kind === 'custom') { p.from = p.from || Date.now() - 30 * DAY; p.to = p.to || Date.now(); } render(); },
  pfrom: el => { U[el.dataset.k].from = +new Date(el.value + 'T00:00'); render(); }, pto: el => { U[el.dataset.k].to = +new Date(el.value + 'T00:00'); render(); },
  htype: el => { U.hf.type = el.value; render(); }, hacc: el => { U.hf.acc = el.value; render(); }, hcat: el => { U.hf.cat = el.value; render(); },
  rtype: el => { U.rep.type = el.value; render(); }, racc: el => { U.rep.acc = el.value; render(); }, rcur: el => { U.rep.cur = el.value; render(); },
  set: el => { S.settings[el.dataset.k] = el.dataset.num ? +el.value : el.value; save(); render(); },
};
function bindRender() { }
document.addEventListener('click', e => {
  if (e.target.id === 'sback') { closeSheet(); return; }
  const el = e.target.closest('[data-a]'); if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
  const fn = actions[el.dataset.a]; if (fn) fn(el.dataset.v, el);
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  if (changes[el.dataset.a]) changes[el.dataset.a](el); else if (el.type === 'checkbox' && actions[el.dataset.a]) actions[el.dataset.a](el.dataset.v, el);
});
let qTimer;
document.addEventListener('input', e => {
  if (e.target.dataset?.a === 'hq') { U.hf.q = e.target.value; clearTimeout(qTimer); qTimer = setTimeout(() => { const pos = e.target.selectionStart; render(); const n = $('[data-a=hq]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 250); }
});
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); flush(); } else { if (S?.settings.pin && Date.now() - hiddenAt > 60000) lockIfNeeded(); if (!document.hidden) render(); }
});
addEventListener('pagehide', () => flush());

// ───────────────────────── boot ─────────────────────────
(async function boot() {
  await load(); applyTheme(); render(); lockIfNeeded();
  if (!S.settings.setup && !S.accounts.length) setTimeout(() => openSetup(() => { save(); render(); }), 300);
  try { navigator.storage?.persist?.(); } catch (e) { }
  if ('serviceWorker' in navigator) {
    const had = !!navigator.serviceWorker.controller; let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js').then(r => { document.addEventListener('visibilitychange', () => { if (!document.hidden) r.update().catch(() => { }); }); }).catch(() => { });
  }
  window.__S = () => S;
})();

