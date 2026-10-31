'use strict';
/* Excel / CSV import-export and FinancePM backup import. Uses globals from app.js (S, helpers) at call time. */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const YN = v => v ? 'Yes' : 'No';
const isYes = v => /^(y|yes|true|1)$/i.test(String(v ?? '').trim());
const r2 = n => Math.round((+n + Number.EPSILON) * 100) / 100;
const numOf = (v, d = null) => { if (typeof v === 'number') return isFinite(v) ? v : d; const n = parseFloat(String(v ?? '').replace(/,/g, '').replace(/[^\d.\-]/g, '')); return isNaN(n) ? d : n; };

// date cell → local ms (accepts 'yyyy-mm-dd', 'dd/mm/yyyy', Excel serial numbers, Date objects)
function parseDateCell(v, timeV) {
  let y, m, d, hh = 12, mm = 0;
  if (v instanceof Date) { y = v.getFullYear(); m = v.getMonth(); d = v.getDate(); }
  else if (typeof v === 'number') { const u = new Date(Math.round((v - 25569) * 864e5)); y = u.getUTCFullYear(); m = u.getUTCMonth(); d = u.getUTCDate(); if (v % 1) { hh = u.getUTCHours(); mm = u.getUTCMinutes(); } }
  else {
    const s = String(v ?? '').trim(); let x;
    if ((x = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/))) { y = +x[1]; m = +x[2] - 1; d = +x[3]; if (x[4]) { hh = +x[4]; mm = +x[5]; } }
    else if ((x = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/))) { d = +x[1]; m = +x[2] - 1; y = +x[3]; if (x[4]) { hh = +x[4]; mm = +x[5]; } }
    else return NaN;
  }
  if (timeV !== undefined && timeV !== '') {
    if (typeof timeV === 'number') { const t = Math.round((timeV % 1) * 1440); hh = Math.floor(t / 60); mm = t % 60; }
    else { const t = String(timeV).match(/(\d{1,2}):(\d{2})/); if (t) { hh = +t[1]; mm = +t[2]; } }
  }
  const out = +new Date(y, m, d, hh, mm); return isNaN(out) ? NaN : out;
}

// ───────────────────────── export ─────────────────────────
function saveBlob(name, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime }); const file = new File([blob], name, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: name }).catch(() => { }); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

function buildWorkbook() {
  const wb = XLSX.utils.book_new(); const bal = balances();
  const add = (name, rows, widths) => { const ws = XLSX.utils.aoa_to_sheet(rows); if (widths) ws['!cols'] = widths.map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, name); };
  const accName = id => acc(id)?.name || '';
  add('Info', [['Key', 'Value'], ['App', 'MyFinTracker'], ['Format version', 2], ['Exported at', new Date().toISOString()], ['Default currency', defCur().short || '']], [22, 34]);
  add('Currencies', [['ID', 'Code', 'Name', 'Decimals', 'Rate to default currency'], ...S.currencies.map(c => [c.id, c.short, c.name || '', c.dec, c.id === S.settings.defCur ? 1 : c.rate])], [14, 10, 22, 10, 24]);
  add('Accounts', [['ID', 'Name', 'Icon', 'Currency', 'Opening balance', 'Active', 'Default', 'Current balance (info only)', 'Balance as of (ms)', 'Group', 'Type'],
  ...S.accounts.map(a => [a.id, a.name, a.icon || '', cur(a.currencyId)?.short || '', a.opening || 0, YN(a.active !== false), YN(!!a.isDefault), r2(bal[a.id] || 0), a.asOf || '', (S.groups || []).find(g => g.id === a.groupId)?.name || '', accType(a)])], [14, 34, 6, 10, 16, 8, 8, 26]);
  const cats = [...catSorted('expense'), ...catSorted('income')];
  add('Groups', [['Name', 'Icon'], ...(S.groups || []).map(g => [g.name, g.icon || ''])], [28, 10]);
  add('Categories', [['ID', 'Type', 'Name', 'Parent ID', 'Order', 'Full name (info only)'], ...cats.map(c => [c.id, c.type, c.name, c.parentId || '', c.order, catPath(c.id)])], [14, 10, 28, 14, 8, 40]);
  const tx = [...S.tx].filter(t => !t.debtId || t.debtId === 'legacy' || t.debtId === 'adjust').sort((a, b) => a.date - b.date || (a.gi || 0) - (b.gi || 0));
  add('Transactions', [['Date', 'Time', 'Type', 'Account', 'Category', 'Amount', 'Currency', 'To account', 'To amount', 'Name', 'Note', 'ID', 'Account ID', 'To account ID', 'Category ID', 'Group ID', 'Part no.', 'Prepayment ID', 'Kind'],
  ...tx.map(t => [ymd(t.date), hm(t.date), t.type, accName(t.accountId), t.categoryId ? catPath(t.categoryId) : '', t.sum, cur(acc(t.accountId)?.currencyId)?.short || '', accName(t.toAccountId), t.type === 'transfer' ? (t.toSum ?? t.sum) : '', t.name || '', t.desc || '',
  t.id, t.accountId, t.toAccountId || '', t.categoryId || '', t.groupId || '', t.gi ?? '', t.prepayId || '', t.debtId === 'legacy' ? 'legacy-debt' : t.debtId === 'adjust' ? 'adjustment' : ''])],
    [11, 7, 11, 24, 28, 12, 9, 22, 12, 24, 28, 14, 14, 14, 14, 14, 8, 14, 12]);
  add('Debts', [['ID', 'Direction', 'Name', 'Account ID', 'Account', 'Amount', 'Date', 'Note'], ...S.debts.map(d => [d.id, d.dir, d.name, d.accountId, accName(d.accountId), d.amount, ymd(d.date), d.desc || ''])], [14, 10, 26, 14, 24, 12, 11, 28]);
  add('Debt payments', [['ID', 'Debt ID', 'Date', 'Amount (+ repayment / - increase)', 'Account ID', 'Account', 'Direct expense', 'Category ID'], ...S.debts.flatMap(d => (d.repayments || []).map(r => [r.id, d.id, ymd(r.date), r.sum, r.accountId, accName(r.accountId), r.direct ? 'Yes' : '', r.categoryId || '']))], [14, 14, 11, 30, 14, 24, 14, 14]);
  add('Budgets', [['ID', 'Name', 'Kind', 'Targets (IDs, separated by |)', 'Amount', 'Period', 'From', 'To'], ...S.budgets.map(b => [b.id, b.name, b.kind, (b.refs || []).join('|'), b.amount, b.period, b.from ? ymd(b.from) : '', b.to ? ymd(b.to) : ''])], [14, 24, 10, 34, 12, 10, 11, 11]);
  add('Planned', [['ID', 'Date', 'Type', 'Account ID', 'To account ID', 'Category ID', 'Amount', 'To amount', 'Name', 'Note', 'Repeat'], ...S.planned.map(p => [p.id, ymd(p.date), p.type, p.accountId, p.toAccountId || '', p.categoryId || '', p.sum, p.toSum ?? '', p.name || '', p.desc || '', p.repeat || 'none'])], [14, 11, 10, 14, 14, 14, 12, 12, 24, 28, 10]);
  return wb;
}
function exportXLSX() {
  if (typeof XLSX === 'undefined') return toast('Excel library not loaded – open the app once with internet');
  const out = XLSX.write(buildWorkbook(), { bookType: 'xlsx', type: 'array' });
  S.settings.lastBackup = Date.now(); save();
  saveBlob(`MyFinTracker-backup-${ymd(Date.now())}.xlsx`, out, XLSX_MIME);
  toast('Excel backup created – save it to Files'); setTimeout(render, 400);
}

// ───────────────────────── Excel full restore ─────────────────────────
function restoreFromWorkbook(wb) {
  const get = n => { const k = wb.SheetNames.find(x => x.toLowerCase() === n.toLowerCase()); return k ? XLSX.utils.sheet_to_json(wb.Sheets[k], { defval: '', raw: true }) : []; };
  const col = (r, ...names) => { for (const n of names) { if (r[n] !== undefined && r[n] !== '') return r[n]; } return ''; };
  const N = { v: 1, settings: { ...S.settings, setup: true }, currencies: [], accounts: [], categories: [], tx: [], templates: [], planned: [], budgets: [], debts: [], groups: [] };
  const warn = [];
  const info = Object.fromEntries(get('Info').map(r => [String(r.Key), r.Value]));
  get('Currencies').forEach(r => { const short = String(col(r, 'Code')).trim(); if (!short) return; N.currencies.push({ id: String(col(r, 'ID') || uid()), short, name: String(col(r, 'Name')), dec: Math.max(0, Math.min(4, numOf(col(r, 'Decimals'), 2))), rate: numOf(col(r, 'Rate to default currency'), 1) || 1 }); });
  const defCode = String(info['Default currency'] || ''); N.settings.defCur = (N.currencies.find(c => c.short === defCode) || N.currencies.find(c => c.rate === 1) || N.currencies[0])?.id || null;
  const curByCode = code => N.currencies.find(c => c.short === String(code).trim());
  get('Groups').forEach(r => { const gn = String(col(r, 'Name')).trim(); if (gn && !N.groups.find(x => x.name === gn)) N.groups.push({ id: uid(), name: gn, icon: String(col(r, 'Icon') || '📁') }); });
  get('Accounts').forEach(r => {
    const name = String(col(r, 'Name')).trim(); if (!name) return;
    let c = curByCode(col(r, 'Currency')); if (!c) { c = { id: uid(), short: String(col(r, 'Currency') || 'CUR'), name: '', dec: 2, rate: 1 }; N.currencies.push(c); }
    N.accounts.push({ id: String(col(r, 'ID') || uid()), name, icon: String(col(r, 'Icon') || '💵'), currencyId: c.id, opening: numOf(col(r, 'Opening balance'), 0), active: col(r, 'Active') === '' ? true : isYes(col(r, 'Active')), isDefault: isYes(col(r, 'Default')), asOf: numOf(col(r, 'Balance as of (ms)'), 0) || 0, type: (['account', 'card', 'invest', 'other'].includes(String(col(r, 'Type'))) ? String(col(r, 'Type')) : 'account'), ...(() => { const gn = String(col(r, 'Group')).trim(); if (!gn) return {}; let g = N.groups.find(x => x.name === gn); if (!g) { g = { id: uid(), name: gn }; N.groups.push(g); } return { groupId: g.id }; })() });
  });
  if (!N.settings.defCur) N.settings.defCur = N.currencies[0]?.id || null;
  get('Categories').forEach(r => { const name = String(col(r, 'Name')).trim(); if (!name) return; N.categories.push({ id: String(col(r, 'ID') || uid()), name, type: /inc/i.test(col(r, 'Type')) ? 'income' : 'expense', parentId: col(r, 'Parent ID') ? String(col(r, 'Parent ID')) : null, order: numOf(col(r, 'Order'), 0) }); });
  const accById = id => N.accounts.find(a => a.id === String(id));
  const accByName = n => N.accounts.find(a => a.name.toLowerCase() === String(n).trim().toLowerCase() && a.active) || N.accounts.find(a => a.name.toLowerCase() === String(n).trim().toLowerCase());
  const catByPath = (path, type) => {
    const parts = String(path).split('›').map(s => s.trim()).filter(Boolean); let pid = null, c = null;
    parts.forEach(nm => { c = N.categories.find(x => x.type === type && x.name.toLowerCase() === nm.toLowerCase() && (x.parentId || null) === pid); if (!c) { c = { id: uid(), name: nm, type, parentId: pid, order: 999 }; N.categories.push(c); } pid = c.id; });
    return c;
  };
  let skipped = 0;
  get('Transactions').forEach(r => {
    const type = String(col(r, 'Type')).toLowerCase().trim(); if (!['expense', 'income', 'transfer', 'prepayment'].includes(type)) { skipped++; return; }
    const a = accById(col(r, 'Account ID')) || accByName(col(r, 'Account')); const sum = Math.abs(numOf(col(r, 'Amount'), 0)); const date = parseDateCell(col(r, 'Date'), col(r, 'Time'));
    if (!a || !(sum > 0) || isNaN(date)) { skipped++; return; }
    const rec = { id: String(col(r, 'ID') || uid()), type, accountId: a.id, sum, name: String(col(r, 'Name')), desc: String(col(r, 'Note')), date, categoryId: '', toAccountId: '', toSum: null };
    if (type === 'transfer') { const b = accById(col(r, 'To account ID')) || accByName(col(r, 'To account')); if (!b) { skipped++; return; } rec.toAccountId = b.id; rec.toSum = numOf(col(r, 'To amount'), sum) || sum; }
    else if (type !== 'prepayment') {
      if (String(col(r, 'Kind')) === 'legacy-debt') rec.debtId = 'legacy';
      else if (String(col(r, 'Kind')) === 'adjustment') rec.debtId = 'adjust';
      else { const cid = String(col(r, 'Category ID')); const c = N.categories.find(x => x.id === cid && x.type === type) || (col(r, 'Category') ? catByPath(col(r, 'Category'), type) : catByPath('Other', type)); rec.categoryId = c.id; }
    }
    if (col(r, 'Group ID') !== '') { rec.groupId = String(col(r, 'Group ID')); rec.gi = numOf(col(r, 'Part no.'), 0); }
    if (col(r, 'Prepayment ID') !== '') rec.prepayId = String(col(r, 'Prepayment ID'));
    N.tx.push(rec);
  });
  get('Debts').forEach(r => {
    const a = accById(col(r, 'Account ID')) || accByName(col(r, 'Account')); const date = parseDateCell(col(r, 'Date')); const amount = Math.abs(numOf(col(r, 'Amount'), 0));
    if (!a || !(amount > 0) || isNaN(date)) { skipped++; return; }
    N.debts.push({ id: String(col(r, 'ID') || uid()), dir: /borrow/i.test(col(r, 'Direction')) ? 'borrow' : 'lend', name: String(col(r, 'Name')), amount, accountId: a.id, date: +startOfDay(date), desc: String(col(r, 'Note')), repayments: [] });
  });
  get('Debt payments').forEach(r => {
    const d = N.debts.find(x => x.id === String(col(r, 'Debt ID'))); const a = accById(col(r, 'Account ID')) || accByName(col(r, 'Account')); const date = parseDateCell(col(r, 'Date')); const sum = numOf(col(r, 'Amount (+ repayment / - increase)', 'Amount'), 0);
    if (!d || !a || !sum || isNaN(date)) { skipped++; return; } d.repayments.push({ id: String(col(r, 'ID') || uid()), sum, accountId: a.id, date: +startOfDay(date), ...(/^y/i.test(String(col(r, 'Direct expense') || '')) ? { direct: true, categoryId: String(col(r, 'Category ID') || '') } : {}) });
  });
  get('Budgets').forEach(r => { const amount = numOf(col(r, 'Amount'), 0); if (!(amount > 0)) return; N.budgets.push({ id: String(col(r, 'ID') || uid()), name: String(col(r, 'Name')), kind: String(col(r, 'Kind') || 'overall'), refs: String(col(r, 'Targets (IDs, separated by |)')).split('|').filter(Boolean), amount, period: String(col(r, 'Period') || 'monthly'), from: col(r, 'From') ? parseDateCell(col(r, 'From')) : null, to: col(r, 'To') ? parseDateCell(col(r, 'To')) : null }); });
  get('Planned').forEach(r => {
    const a = accById(col(r, 'Account ID')); const date = parseDateCell(col(r, 'Date')); const sum = numOf(col(r, 'Amount'), 0); if (!a || !(sum > 0) || isNaN(date)) { skipped++; return; }
    N.planned.push({ id: String(col(r, 'ID') || uid()), type: String(col(r, 'Type') || 'expense'), accountId: a.id, toAccountId: String(col(r, 'To account ID')), categoryId: String(col(r, 'Category ID')), sum, toSum: numOf(col(r, 'To amount')), name: String(col(r, 'Name')), desc: String(col(r, 'Note')), repeat: String(col(r, 'Repeat') || 'none'), date, active: true });
  });
  return { N, skipped, summary: `${N.accounts.length} accounts, ${N.tx.length} transactions, ${N.debts.length} debts, ${N.categories.length} categories` };
}
function applyRestoredState(N) {
  S = N; if (!S.groups) S.groups = []; S.debts.forEach(d => syncDebtTx(d)); S.settings.lastBackup = Date.now();
  if (!S.categories.length) S.categories = defaultState().categories;
  save(); applyTheme(); U.stack = []; U.tab = 'home'; render();
}

// ───────────────────────── CSV / sheet rows (append transactions) ─────────────────────────
function importRows(rows) {
  rows = rows.filter(r => r.some(x => String(x ?? '').trim() !== ''));
  if (rows.length < 2) return toast('The file looks empty');
  const head = rows[0].map(h => String(h ?? '').trim().toLowerCase()); const ix = n => head.indexOf(n);
  if (['date', 'type', 'account', 'amount'].some(n => ix(n) < 0)) return toast('Columns needed: Date, Type, Account, Category, Amount');
  ensureSetup(() => {
    let n = 0, bad = 0;
    rows.slice(1).forEach(r => {
      const raw = k => (ix(k) >= 0 ? r[ix(k)] : ''); const g = k => String(raw(k) ?? '').trim();
      const rawType = g('type').toLowerCase(); const isDebt = rawType.startsWith('debt-'); const type = rawType.replace('debt-', ''); if (!['expense', 'income', 'transfer', 'prepayment'].includes(type)) { bad++; return; }
      const sum = Math.abs(numOf(raw('amount'), 0)); const date = parseDateCell(raw('date'), ix('time') >= 0 ? raw('time') : undefined);
      if (!(sum > 0) || isNaN(date)) { bad++; return; }
      let a = S.accounts.find(x => x.name.toLowerCase() === g('account').toLowerCase()); if (!a) { a = { id: uid(), name: g('account') || 'Imported', icon: '💵', currencyId: S.settings.defCur, opening: 0, active: true }; S.accounts.push(a); }
      const rec = { id: uid(), type, accountId: a.id, sum, name: g('name'), desc: g('note') || g('description'), date, categoryId: '', toAccountId: '', toSum: null };
      if (type === 'transfer') { const b = S.accounts.find(x => x.name.toLowerCase() === g('to account').toLowerCase()); if (!b) { bad++; return; } rec.toAccountId = b.id; rec.toSum = numOf(raw('to amount'), sum) || sum; }
      else if (isDebt) rec.debtId = 'legacy';
      else if (type !== 'prepayment') rec.categoryId = findOrMakeCategory(g('category') || 'Other', type).id;
      S.tx.push(rec); n++;
    });
    save(); render(); toast(`Imported ${n} transactions${bad ? ` (${bad} rows skipped)` : ''}`);
  });
}

// ───────────────────────── FinancePM backup → app state ─────────────────────────
const PM_SYMBOLS = { '$': 'USD', '€': 'EUR', '£': 'GBP', '₽': 'RUB', '¥': 'JPY', 'грн': 'UAH' };
const PM_RATES_SAR = { SAR: 1, USD: 3.75, AED: 1.0211, PKR: 0.0134, EUR: 4.35, GBP: 5.0, INR: 0.0447, KWD: 12.2, QAR: 1.03, BHD: 9.95, OMR: 9.74, EGP: 0.077, TRY: 0.09, CNY: 0.52, JPY: 0.025 };
function pmType(name) { const n = name.toLowerCase(); if (/credit card|\bcard\b/.test(n)) return 'card'; if (/prize|bond|invest|binance|mexc|bybit|crypto|stock|gold/.test(n)) return 'invest'; return 'account'; }
function pmIcon(name) {
  const n = name.toLowerCase();
  if (/credit card|card/.test(n)) return 'svg:card-blue'; if (/^cash/.test(n)) return 'svg:bills-green'; if (/prize|bond/.test(n)) return 'svg:deposit-orange';
  if (/invest/.test(n)) return 'svg:chart-purple'; if (/binance|mexc|bybit|crypto/.test(n)) return 'svg:chart-orange'; if (/pay|stc|jazz|wallet/.test(n)) return 'svg:phone-pink';
  if (/saving|reserve/.test(n)) return 'svg:piggy-green'; return 'svg:bank-teal';
}
function financePMToState(d) {
  const N = { v: 1, settings: { ...S.settings, defCur: null, setup: true }, currencies: [], accounts: [], categories: [], tx: [], templates: [], planned: [], budgets: [], debts: [] };
  const rep = { skippedZero: 0, absorbed: 0, legacy: 0, transfers: 0, debts: 0, notes: [], stored: {}, rateGuess: [] };
  const T = new Map(d.transactions.map(t => [String(t.id), t]));
  const conv = (ms, idn) => { const u = new Date(+ms); return +new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), 12, 0, 0) + (parseInt(idn, 10) || 0) % 86400; };
  const dayStart = ms => { const u = new Date(+ms); return +new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()); };
  // currencies: the ones used by accounts; default = most common
  const usage = {}; d.accounts.forEach(a => usage[a.currencyId] = (usage[a.currencyId] || 0) + 1);
  const defFileId = +Object.entries(usage).sort((a, b) => b[1] - a[1])[0]?.[0];
  const curMap = {};
  d.currencies.filter(c => usage[c.id]).forEach(c => {
    const short = PM_SYMBOLS[c.shortName] || c.shortName; const id = uid(); curMap[c.id] = id;
    const rate = c.id === defFileId ? 1 : (PM_RATES_SAR[short] ?? 1); if (c.id !== defFileId) rep.rateGuess.push(`${short} = ${rate}`);
    N.currencies.push({ id, short, name: c.name, dec: 2, rate });
    if (c.id === defFileId) N.settings.defCur = id;
  });
  const defShort = N.currencies.find(c => c.id === N.settings.defCur)?.short;
  if (defShort !== 'SAR') { N.currencies.forEach(c => { if (c.id !== N.settings.defCur) c.rate = 1; }); rep.rateGuess = ['rates need to be set']; }
  // accounts
  const accMap = {};
  [...d.accounts].sort((a, b) => (a.orderId || 0) - (b.orderId || 0) || a.id - b.id).forEach(a => {
    const id = uid(); accMap[a.id] = id;
    N.accounts.push({ id, name: a.name, icon: pmIcon(a.name), type: pmType(a.name), currencyId: curMap[a.currencyId], opening: r2(a.balance), active: a.active === 1, isDefault: a.isDef === 1 });
  });
  // categories (available or used, plus ancestors)
  const catById = new Map(d.categories.map(c => [c.id, c])); const need = new Set();
  d.transactions.forEach(t => { if (t.categoryId) need.add(t.categoryId); });
  d.categories.forEach(c => { if (c.available === 1) need.add(c.id); });
  [...need].forEach(id => { let c = catById.get(id), g = 0; while (c && c.parentId && g++ < 8) { need.add(c.parentId); c = catById.get(c.parentId); } });
  const catMap = {};
  d.categories.filter(c => need.has(c.id)).sort((a, b) => a.orderId - b.orderId || a.id - b.id).forEach(c => { catMap[c.id] = uid(); });
  d.categories.filter(c => need.has(c.id)).forEach(c => N.categories.push({ id: catMap[c.id], name: c.name, type: c.type === 1 ? 'income' : 'expense', parentId: c.parentId ? catMap[c.parentId] || null : null, order: c.orderId || 0 }));
  const otherCat = type => { let c = N.categories.find(x => x.type === type && x.name === 'Other' && !x.parentId); if (!c) { c = { id: uid(), name: 'Other', type, parentId: null, order: 999 }; N.categories.push(c); } return c.id; };
  const used = new Set();
  // transfers (two linked legs)
  d.transfers.forEach(tr => {
    const f = T.get(String(tr.transactionIdFrom)), t = T.get(String(tr.transactionIdTo)); if (!f || !t) return;
    used.add(String(f.id)); used.add(String(t.id));
    const fs = r2(f.sum), ts = r2(t.sum); if (!(fs > 0) || !(ts > 0)) { rep.skippedZero++; return; }
    N.tx.push({ id: uid(), type: 'transfer', accountId: accMap[f.accountId], toAccountId: accMap[t.accountId], sum: fs, toSum: ts, name: tr.name || f.name || '', desc: f.description || '', categoryId: '', date: conv(f.date, f.id) });
    rep.transfers++;
  });
  // debts (arrears) and their linked operations: source 2 = loan, 3 = repayment, 4 = increase
  const rel = new Map(); d.arrear_transaction_relations.forEach(r => { const k = String(r.arrearId); if (!rel.has(k)) rel.set(k, new Set()); rel.get(k).add(String(r.transactionId)); });
  d.arrears.filter(a => a.available !== 0).forEach(a => {
    const txs = [...(rel.get(String(a.id)) || [])].map(i => T.get(i)).filter(t => t && !used.has(String(t.id))).sort((x, y) => (+x.date - +y.date) || (+x.id - +y.id));
    const init = txs.find(t => t.source === 2); if (!init) return;
    const debt = { id: uid(), dir: init.type === 2 ? 'lend' : 'borrow', name: a.name, amount: r2(init.sum), accountId: accMap[init.accountId], date: dayStart(init.date), desc: a.description || '', repayments: [] };
    if (!(debt.amount > 0)) return;
    const outType = init.type;   // money moving the same way as the original loan = increase; the opposite way = repayment
    txs.forEach(t => {
      used.add(String(t.id)); if (t === init) return;
      const s = r2(t.sum); if (!(s > 0)) { rep.skippedZero++; return; }
      debt.repayments.push({ id: uid(), sum: t.type === outType ? -s : s, accountId: accMap[t.accountId], date: dayStart(t.date) });
    });
    N.debts.push(debt); rep.debts++;
  });
  // everything else
  d.transactions.forEach(t => {
    if (used.has(String(t.id))) return;
    const s = r2(t.sum); if (!(s > 0)) { rep.skippedZero++; return; }
    const type = t.type === 1 ? 'income' : 'expense';
    const rec = { id: uid(), type, accountId: accMap[t.accountId], sum: s, name: t.name || '', desc: t.description || '', categoryId: '', toAccountId: '', toSum: null, date: conv(t.date, t.id) };
    if (t.source === 5) { rec.debtId = 'adjust'; rep.absorbed++; }
    else if (t.source === 2 || t.source === 3 || t.source === 4) { rec.debtId = 'legacy'; rep.legacy++; }
    else rec.categoryId = catMap[t.categoryId] || otherCat(type);
    N.tx.push(rec);
  });
  ['plan_operations', 'limits', 'patterns'].forEach(k => { if ((d[k] || []).length) rep.notes.push(`${d[k].length} ${k.replace('_', ' ')} not imported`); });
  return { N, rep };
}
function finalizeFinancePM(o) {
  const keep = S; S = o.N; o.N.debts.forEach(d => syncDebtTx(d));
  const b = balances(); const rem = o.N.debts.flatMap(d => [...debtBy(d)].map(([k, v]) => [d.name, d.dir, r2(v), cur(k)?.short])).filter(x => x[2] > 0.005);
  o.rep.balances = o.N.accounts.filter(x => x.active).map(x => [x.name, r2(b[x.id] || 0), cur(x.currencyId)?.short]); o.rep.openDebts = rem; S = keep; return o;
}

// ───────────────────────── entry point for the Import button ─────────────────────────
async function doImport() {
  const f = $('#impfile')?.files[0]; if (!f) return toast('Choose a file first');
  return importBuffer(await f.arrayBuffer());
}
async function importBuffer(buf) {
  let u8 = new Uint8Array(buf);
  if (typeof ghIsEnc === 'function' && ghIsEnc(u8)) {
    return form('Encrypted backup', [{ k: 'p', label: 'Passphrase', type: 'password', value: '' }], v => {
      setTimeout(async () => { try { const out = await ghDecrypt(u8, v.p); importBuffer(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)); } catch (e) { toast('Wrong passphrase or damaged file'); } }, 150);
    }, { ok: 'Decrypt' });
  }
  const isZip = u8[0] === 0x50 && u8[1] === 0x4B;
  if (isZip) {
    if (typeof XLSX === 'undefined') return toast('Excel library not loaded – open the app once with internet');
    let wb; try { wb = XLSX.read(buf, { type: 'array', raw: true }); } catch (e) { return toast('Could not read this Excel file'); }
    const has = n => wb.SheetNames.some(x => x.toLowerCase() === n);
    if (has('accounts') && has('transactions')) {
      const res = restoreFromWorkbook(wb);
      return confirmBox(`Replace ALL current data with this Excel backup? (${res.summary})`, () => { applyRestoredState(res.N); toast('Backup restored' + (res.skipped ? ` – ${res.skipped} rows skipped` : '')); }, 'Replace');
    }
    return importRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true }));
  }
  let text = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '');
  const t0 = text.trim();
  if (t0.startsWith('{') || t0.startsWith('[')) {
    let data; try { data = JSON.parse(t0); } catch (e) { return toast('Could not read this file'); }
    if (data && Array.isArray(data.accounts) && Array.isArray(data.transactions) && Array.isArray(data.categories) && data.currencies) {
      const { N, rep } = finalizeFinancePM(financePMToState(data));
      return confirmBox(`Replace ALL current data with your FinancePM backup? ${N.accounts.length} accounts, ${N.tx.length} transactions (${rep.transfers} transfers), ${rep.debts} debts. Account balances are taken as your current balances.`, () => {
        applyRestoredState(N); save();
        sheet(`<button class="x" data-a="close">✕</button><h2>Import finished ✓</h2><p style="margin:0 0 8px">${N.accounts.length} accounts, ${N.tx.length} transactions, ${N.debts.length} debts and ${N.categories.length} categories were imported.</p>
          <p class="mut" style="font-size:.88em;margin:0 0 8px"><b>Please check two things:</b><br>1. Exchange rates in <b>More → Currencies</b> (${esc(rep.rateGuess.join(', '))} – approximate, they are not in your backup).<br>2. Your account balances on the Home screen against what you expect.</p>
          ${rep.openDebts.length ? `<p class="mut" style="font-size:.85em;margin:0 0 8px">Debts still open: ${rep.openDebts.map(x => esc(x[0]) + ' ' + x[2].toLocaleString('en-US') + ' ' + esc(x[3] || '')).join(', ')}.</p>` : ''}
          <div class="btns"><button class="btn" data-a="close">Done</button></div>`);
      }, 'Replace');
    }
    if (data && data.app === 'expense-tracker' && data.state) return confirmBox('Replace ALL current data with this backup?', () => { S = data.state; save(); applyTheme(); render(); toast('Backup restored'); }, 'Replace');
    return toast('Unrecognised file – use an Excel backup from this app or a FinancePM backup');
  }
  if (text.startsWith('SQLite format')) return toast('Database files are not supported – use FinancePM’s backup/export file');
  return importRows(parseCSV(text));
}
