// Original, generic account icons (no brand logos). Used as "svg:<kind>-<color>".
const ICON_COLORS = { grey: '#4a4744', blue: '#283593', orange: '#e07000', green: '#27a830', pink: '#e91e63', red: '#c40000', teal: '#0f766e', purple: '#7b1fa2' };
const ICON_KINDS = ['wallet', 'card', 'cardwave', 'piggy', 'bank', 'deposit', 'bills', 'chart', 'phone'];
const W = 'fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"';
const ICON_ART = {
  wallet: c => `<rect x="5" y="13" width="48" height="40" rx="9" fill="${c}"/><rect x="9" y="17" width="40" height="6" rx="3" fill="#fff" opacity=".25"/><rect x="38" y="27" width="22" height="15" rx="7.5" fill="${c}" stroke="#0004" stroke-width="2.2"/><circle cx="47" cy="34.5" r="3.2" fill="#fff" opacity=".85"/>`,
  card: c => `<rect x="3" y="11" width="58" height="42" rx="7" fill="${c}"/><rect x="9" y="19" width="11" height="9" rx="2" fill="#ffd54f"/><rect x="9" y="34" width="34" height="4" rx="2" fill="#fff" opacity=".9"/><rect x="9" y="42" width="20" height="3.5" rx="1.7" fill="#fff" opacity=".7"/>`,
  cardwave: c => `<rect x="3" y="11" width="58" height="42" rx="7" fill="${c}"/><rect x="3" y="20" width="58" height="8" fill="#000" opacity=".35"/><rect x="9" y="35" width="30" height="4" rx="2" fill="#fff" opacity=".9"/><path d="M45 38q4 4 0 8M50 36q6 6 0 12" ${W} stroke-width="2.6"/>`,
  piggy: c => `<rect width="64" height="64" rx="15" fill="${c}"/><g ${W}><path d="M14 38c0-9 8-15 18-15s18 6 18 15c0 5-3 8-7 10v5h-6v-3H27v3h-6v-5c-5-2-7-5-7-10z"/><path d="M50 34l4-1v7l-4-1"/><path d="M24 24l-1-6 7 3"/><circle cx="32" cy="12" r="4.5"/></g><circle cx="42" cy="33" r="1.8" fill="#fff"/>`,
  bank: c => `<rect width="64" height="64" rx="15" fill="${c}"/><g ${W}><path d="M12 25L32 13l20 12z"/><path d="M17 29v16M27 29v16M37 29v16M47 29v16M12 50h40"/></g>`,
  deposit: c => `<rect width="64" height="64" rx="15" fill="${c}"/><g ${W}><path d="M32 10v26M22 27l10 10 10-10"/><path d="M12 40v10h40V40"/></g>`,
  bills: c => `<rect x="3" y="14" width="58" height="36" rx="6" fill="${c}"/><circle cx="32" cy="32" r="9" fill="none" stroke="#fff" stroke-width="3"/><circle cx="12" cy="32" r="2.5" fill="#fff"/><circle cx="52" cy="32" r="2.5" fill="#fff"/><path d="M32 27v10M29.5 30c0-2.5 5-2.5 5 0s-5 2.5-5 5 5 2.5 5 0" stroke="#fff" stroke-width="2" fill="none"/>`,
  chart: c => `<rect width="64" height="64" rx="15" fill="${c}"/><g ${W}><path d="M12 48l12-14 9 8 17-22"/><path d="M40 20h10v10"/></g>`,
  phone: c => `<rect width="64" height="64" rx="15" fill="${c}"/><g ${W}><rect x="21" y="10" width="22" height="44" rx="5"/><path d="M29 47h6"/></g>`,
  coins: () => `<g fill="#f2b705" stroke="#8a6200" stroke-width="2"><ellipse cx="32" cy="46" rx="22" ry="8"/><ellipse cx="32" cy="36" rx="22" ry="8"/><ellipse cx="32" cy="26" rx="22" ry="8"/><ellipse cx="32" cy="16" rx="22" ry="8" fill="#ffd54f"/></g><ellipse cx="32" cy="16" rx="12" ry="3.5" fill="none" stroke="#8a6200" stroke-width="2"/>`,
  safe: () => `<rect x="6" y="8" width="52" height="46" rx="7" fill="#4a4744"/><rect x="12" y="14" width="40" height="34" rx="4" fill="#6b6762"/><circle cx="32" cy="31" r="9" fill="none" stroke="#fff" stroke-width="3"/><path d="M32 25v6l4 2" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round"/><rect x="14" y="54" width="8" height="4" fill="#333"/><rect x="42" y="54" width="8" height="4" fill="#333"/>`
};
const ICON_NAMES = [].concat(ICON_KINDS.map(k => Object.keys(ICON_COLORS).map(c => k + '-' + c)), [['coins', 'safe']]);
const ICON_TEXT = { wallet: '👛', card: '💳', cardwave: '💳', piggy: '🐷', bank: '🏦', deposit: '📥', bills: '💵', chart: '📈', phone: '📱', coins: '🪙', safe: '🔒' };
function iconSvg(name) {
  const [k, c] = name.split('-'); const art = ICON_ART[k]; if (!art) return '';
  return `<svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">${art(ICON_COLORS[c] || ICON_COLORS.blue)}</svg>`;
}
function iconText(icon) { icon = icon || '💵'; return icon.startsWith('svg:') ? (ICON_TEXT[icon.slice(4).split('-')[0]] || '💵') : icon; }
function iconDot(icon, size) {
  icon = icon || '💵';
  if (icon.startsWith('svg:')) return `<div class="dot" style="background:none;padding:0;${size ? 'width:' + size + 'px;height:' + size + 'px;' : ''}">${iconSvg(icon.slice(4))}</div>`;
  return `<div class="dot" style="background:var(--brand-l)">${icon}</div>`;
}
function iconPicker(selected) {
  const cell = (val, inner) => `<button type="button" class="ipick ${val === selected ? 'on' : ''}" data-pick="${val}">${inner}</button>`;
  return ICON_NAMES.map(row => `<div class="iprow">${row.map(n => cell('svg:' + n, iconSvg(n))).join('')}</div>`).join('') +
    `<div class="iprow">${['📁', '🗂️', '👪', '🏢', '🧳', '💵', '💳', '🏦', '👛', '💰', '🏠', '🚗', '🛒', '🎁', '📈', '💼', '📱', '🎟️', '🪙'].map(e => cell(e, `<span style="font-size:26px">${e}</span>`)).join('')}</div>`;
}
