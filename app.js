// app.js — UI only. All persistence goes through window.Storage (storage.js).

const TYPE_LABELS = {
  lent: 'Lent',
  borrowed: 'Borrowed',
  repayment_received: 'Repayment received',
  repayment_made: 'Repayment made',
};

const BANK_TX_LABELS = {
  deposit: 'Deposit',
  withdrawal: 'Withdraw / Transfer',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  loan_in: 'Loan — money in',
  loan_out: 'Loan — money out',
  expense_out: 'Expense',
};

// Display-only — the authoritative currency list/order is Storage.CURRENCIES.
const CURRENCY_SYMBOLS = { USD: '$', PKR: 'Rs', EUR: '€' };

// Inline SVGs (no icon font/CDN) — stroke uses currentColor so they inherit
// the button's text color in both themes automatically.
const ICON_EDIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const ICON_DELETE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
const ICON_HISTORY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>';
const ICON_ADD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const ICON_SAVE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const ICON_REMIND = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';

// Pakistani-style local numbers ("0300-1234567") need the country code for a
// wa.me link; a number that already has one (or is some other country's,
// entered with its own code) is left as-is — only a leading 0 gets swapped.
function toWhatsAppNumber(contact) {
  const digits = (contact || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.startsWith('0') ? `92${digits.slice(1)}` : digits;
}

function reminderMessage(name, amount) {
  const formatted = Math.round(amount).toLocaleString();
  // *text* is WhatsApp's own bold-formatting syntax — rendered as bold once
  // it lands in the chat, not literal asterisks.
  return `Hi *${name}*, hope you're doing well! Just a friendly reminder that you currently owe PKR ${formatted}. Whenever it's convenient, please send it over. Thanks!\n\n*Sent via Konto*`;
}

// One template per loan type. `accountLabel` follows the direction of the
// cash: "From account" when the money left our bank, "Into account" when it
// landed there — so the profile reads it the same way we recorded it.
const LOAN_MESSAGE_RULES = {
  lent: {
    accountLabel: 'From account',
    lead: (amt) => `I've sent you *PKR ${amt}* as a loan. 🤝`,
  },
  borrowed: {
    accountLabel: 'Into account',
    lead: (amt) => `Thank you — I've received *PKR ${amt}* from you as a loan. 🙏`,
  },
  repayment_received: {
    accountLabel: 'Into account',
    lead: (amt) => `Payment received, thank you! ✅ Your repayment of *PKR ${amt}* has been recorded.`,
  },
  repayment_made: {
    accountLabel: 'From account',
    lead: (amt) => `I've sent you *PKR ${amt}* against what I owe you. ✅`,
  },
};

// Storage.getBalance is positive when the profile owes us, negative when we
// owe them — spell that direction out rather than sending a bare signed number.
function balanceLine(balance) {
  const amt = Math.round(Math.abs(balance)).toLocaleString();
  if (balance > 0.004) return `*Total balance:* PKR ${amt} (you owe me)`;
  if (balance < -0.004) return `*Total balance:* PKR ${amt} (I owe you)`;
  return `*Total balance:* PKR 0 — we're all settled ✅`;
}

function loanEntryMessage({ type, name, amount, bankName, notes, date, balance }) {
  const rule = LOAN_MESSAGE_RULES[type];
  if (!rule) return null;
  const lines = [`Hi *${name}*,`, '', rule.lead(Math.round(amount).toLocaleString()), ''];
  // Account and description are only in the message when they were filled in.
  if (bankName) lines.push(`*${rule.accountLabel}:* ${bankName}`);
  if (notes) lines.push(`*Description:* ${notes}`);
  lines.push(`*Date:* ${formatDate(date)}`, '', balanceLine(balance), '', '*Sent via Konto*');
  return lines.join('\n');
}

function whatsAppSendUrl(number, message) {
  return `https://web.whatsapp.com/send?phone=${number}&text=${encodeURIComponent(message)}`;
}

// Logo mark — rounded badge + "K" monogram, same line-icon style as the ICON_* set above.
const LOGO_MARK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="6"/><path d="M9 6v12M9 12l6-6M9 12l6 6"/></svg>';

// Primary submit button for an add/edit form: swaps icon+label by editing state.
function submitBtn(isEditing, addLabel, disabled) {
  const label = isEditing ? 'Save changes' : addLabel;
  const icon = isEditing ? ICON_SAVE : ICON_ADD;
  return `<button class="btn btn-primary" type="submit" title="${label}" ${disabled ? 'disabled' : ''}>${icon} ${label}</button>`;
}

const money = (n) => {
  const abs = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '-' : ''}${abs}`;
};

// Dashboard figures only — rounded to whole units. The trailing ".00" on every
// tile is noise at a glance; the ledgers keep money() and its exact paise.
const moneyWhole = (n) => {
  const abs = Math.round(Math.abs(n)).toLocaleString();
  return `${n <= -0.5 ? '-' : ''}${abs}`;
};

// Indian/Pakistani numbering (lac, crore) spelled out — used as a hover
// tooltip on dashboard figures since the grouped digits alone are hard to
// eyeball at a glance (e.g. is 4,800,000 forty-eight lac or four crore?).
const ONES_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS_WORDS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitWords(n) {
  if (n < 20) return ONES_WORDS[n];
  const t = Math.floor(n / 10);
  const r = n % 10;
  return TENS_WORDS[t] + (r ? `-${ONES_WORDS[r]}` : '');
}

function threeDigitWords(n) {
  if (n === 0) return '';
  const h = Math.floor(n / 100);
  const r = n % 100;
  let out = h ? `${ONES_WORDS[h]} Hundred` : '';
  if (r) out += (out ? ' ' : '') + twoDigitWords(r);
  return out;
}

function moneyWords(n) {
  let num = Math.round(Math.abs(n));
  if (num === 0) return 'Zero';
  const crore = Math.floor(num / 1e7); num %= 1e7;
  const lac = Math.floor(num / 1e5); num %= 1e5;
  const thousand = Math.floor(num / 1e3); num %= 1e3;
  const rest = num;

  const parts = [];
  if (crore) parts.push(`${threeDigitWords(crore)} Crore`);
  if (lac) parts.push(`${twoDigitWords(lac)} Lac`);
  if (thousand) parts.push(`${twoDigitWords(thousand)} Thousand`);
  if (rest) parts.push(threeDigitWords(rest));

  return (n < 0 ? '- ' : '') + parts.join(' ');
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let currentView = 'dashboard';
let editingTxId = null;
let editingProfileId = null;
let editingBankId = null;
let viewingBankId = null;
let editingAssetId = null;
let editingExpenseId = null;
let editingPlaceId = null;
let editingCategoryId = null;
let expenseBreakdownBy = 'placeId'; // 'placeId' | 'categoryId'

// Place/category filters on the Expenses view accept several picks at once; an
// empty set means "all", so no selection still shows everything. Held here
// rather than read off the DOM because a full render() (after adding an
// expense, say) rebuilds the filter bar and would otherwise drop the picks.
const expenseFilter = { places: new Set(), categories: new Set() };

// ---------------- Pagination ----------------
// One page-state slot per table; shared helpers slice the list and render a
// footer bar. Tables with a live client-side filter (transactions/banks/
// expenses) paginate the *filtered* list, so page-size/prev/next re-run that
// table's filter function instead of a full render() — a full render() would
// also reset the filter inputs back to their defaults.
const pagination = {
  transactions: { page: 1, pageSize: 10 },
  profiles: { page: 1, pageSize: 10 },
  banks: { page: 1, pageSize: 10 },
  bankDetail: { page: 1, pageSize: 10 },
  expenses: { page: 1, pageSize: 10 },
  assets: { page: 1, pageSize: 10 },
};

function paginateList(key, items) {
  const state = pagination[key];
  const totalPages = Math.max(1, Math.ceil(items.length / state.pageSize));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * state.pageSize;
  return { pageItems: items.slice(start, start + state.pageSize), total: items.length, page: state.page, totalPages };
}

function paginationBar(key, total, page, totalPages) {
  if (!total) return '';
  return `
    <div class="pagination">
      <span class="pagination-info">${total} ${total === 1 ? 'entry' : 'entries'}</span>
      <select class="pagination-size" data-page-key="${key}">
        <option value="10" ${pagination[key].pageSize === 10 ? 'selected' : ''}>10 / page</option>
        <option value="20" ${pagination[key].pageSize === 20 ? 'selected' : ''}>20 / page</option>
        <option value="50" ${pagination[key].pageSize === 50 ? 'selected' : ''}>50 / page</option>
      </select>
      <button class="btn btn-sm" data-page-key="${key}" data-page-action="prev" ${page <= 1 ? 'disabled' : ''}>&larr;</button>
      <span class="pagination-page">${page} / ${totalPages}</span>
      <button class="btn btn-sm" data-page-key="${key}" data-page-action="next" ${page >= totalPages ? 'disabled' : ''}>&rarr;</button>
    </div>`;
}

function optionsHtml(items, selectedId) {
  return items.map((i) => `<option value="${i.id}" ${i.id === selectedId ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
}

function currencyOptionsHtml(selected) {
  return Storage.CURRENCIES.map((c) => `<option value="${c}" ${c === selected ? 'selected' : ''}>${c} (${CURRENCY_SYMBOLS[c]})</option>`).join('');
}

// Reference-only lookup shown next to the Settings rate fields — the saved
// rate is still whatever the user typed and clicked Save on; this never
// writes anything. A free no-key API since the app otherwise makes no
// network calls at all; failures (offline, API down) degrade silently.
async function fetchLiveRate(currency) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://open.er-api.com/v6/latest/${currency}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.rates?.PKR === 'number' ? data.rates.PKR : null;
  } catch {
    return null;
  }
}

// ---------------- Multi-select filter ----------------
// A button + checkbox panel rather than <select multiple>: the native control
// needs ctrl/cmd-click to pick more than one, and can't show an "all" state.

const ICON_CHEVRON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

function multiSelectLabel(key, items, selected) {
  const allLabel = key === 'places' ? 'All places' : 'All categories';
  if (!selected.size) return allLabel;
  if (selected.size === 1) return items.find((i) => selected.has(i.id))?.name || allLabel;
  return `${selected.size} ${key}`;
}

function multiSelectHtml(key, items, selected) {
  const opts = items
    .map((i) => `<label class="ms-option"><input type="checkbox" value="${i.id}" ${selected.has(i.id) ? 'checked' : ''}><span>${esc(i.name)}</span></label>`)
    .join('');
  return `
    <div class="multiselect ${selected.size ? 'active' : ''}" data-ms="${key}">
      <button type="button" class="ms-toggle" aria-expanded="false">
        <span class="ms-label">${esc(multiSelectLabel(key, items, selected))}</span>${ICON_CHEVRON}
      </button>
      <div class="ms-panel" hidden>
        ${items.length ? opts : '<div class="ms-empty">Nothing to filter by yet.</div>'}
        <button type="button" class="ms-clear" ${selected.size ? '' : 'disabled'}>Clear</button>
      </div>
    </div>`;
}

function syncMultiSelect(ms) {
  const key = ms.dataset.ms;
  const selected = expenseFilter[key];
  const items = key === 'places' ? Storage.listPlaces() : Storage.listExpenseCategories();
  $('.ms-label', ms).textContent = multiSelectLabel(key, items, selected);
  $('.ms-clear', ms).disabled = !selected.size;
  ms.classList.toggle('active', selected.size > 0);
}

function closeMultiSelects() {
  $$('.multiselect').forEach((ms) => {
    $('.ms-panel', ms).hidden = true;
    $('.ms-toggle', ms).setAttribute('aria-expanded', 'false');
  });
}

function toast(msg, isError = false) {
  let container = $('#toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.innerHTML = `<span class="toast-icon">${isError ? '✕' : '✓'}</span><span>${esc(msg)}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ---------------- Connect screen ----------------

async function boot() {
  const result = await Storage.init();
  if (result.connected) {
    startApp();
  } else if (result.needsReconnect) {
    showReconnectScreen(result.fileName);
  } else {
    showConnectScreen();
  }
}

function showReconnectScreen(fileName) {
  $('#connect-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
  $('#connect-screen').innerHTML = `
    <div class="connect-card">
      <h1 class="brand-heading">${LOGO_MARK}<span>Konto</span></h1>
      <p>Reconnect to <strong>${esc(fileName || 'your loan table')}</strong> to continue where you left off.</p>
      <div class="connect-actions">
        <button class="btn btn-primary" id="btn-reconnect">Reconnect</button>
        <button class="btn" id="btn-use-different">Use a different file</button>
      </div>
    </div>`;
  $('#btn-reconnect').onclick = async () => {
    try {
      await Storage.reconnect();
      startApp();
    } catch (e) {
      toast(e.message, true);
    }
  };
  $('#btn-use-different').onclick = () => showConnectScreen();
}

function showConnectScreen() {
  $('#connect-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');

  if (!Storage.supportsFS) {
    $('#connect-screen').innerHTML = `
      <div class="connect-card">
        <h1 class="brand-heading">${LOGO_MARK}<span>Konto</span></h1>
        <p>Your browser doesn't support saving directly to a file, so data will be kept in this browser's local storage instead. Use Export regularly to back up.</p>
        <div class="connect-actions">
          <button class="btn btn-primary" id="btn-use-local">Continue</button>
        </div>
      </div>`;
    $('#btn-use-local').onclick = startApp;
    return;
  }

  $('#connect-screen').innerHTML = `
    <div class="connect-card">
      <h1 class="brand-heading">${LOGO_MARK}<span>Konto</span></h1>
      <p>Choose where to store your loan table (a JSON file). It stays on your machine — nothing is uploaded anywhere.</p>
      <div class="connect-actions">
        <button class="btn btn-primary" id="btn-create-new">Create new loan table</button>
        <button class="btn" id="btn-open-existing">Open existing loan table</button>
      </div>
      <p class="connect-note"><strong>First time:</strong> when the save dialog opens, navigate into this app's own folder (the one containing <code>index.html</code>) and save as <code>loan-table.json</code> there — keeps the app and its data together in one place.</p>
      <p class="connect-note">Works in Chrome / Edge / Brave. On first use your browser will ask you to confirm file access.</p>
    </div>`;

  $('#btn-create-new').onclick = async () => {
    try {
      await Storage.createNew();
      startApp();
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, true);
    }
  };
  $('#btn-open-existing').onclick = async () => {
    try {
      await Storage.openExisting();
      startApp();
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, true);
    }
  };
}

function startApp() {
  $('#connect-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  updateStorageModeFooter();
  applyHash();
}

function updateStorageModeFooter() {
  const mode = Storage.getMode();
  const el = $('#storage-mode');
  if (mode === 'remote') {
    el.innerHTML = 'Synced (Konto Cloud) &middot; <a href="#" id="btn-sign-out">Sign out</a>';
    $('#btn-sign-out').onclick = (e) => {
      e.preventDefault();
      Storage.logout();
    };
    return;
  }
  const fileName = Storage.getFileName?.();
  el.textContent = mode === 'fs' ? `Saving to ${fileName || 'local file'}` : 'Saving to browser storage';
}

// ---------------- Navigation ----------------
// The current view lives in location.hash (e.g. "#banks/dev-b1"), not just
// in-memory state. That way any reload — a stray form submit, F5, a
// bookmark — lands back on the exact page instead of resetting to the
// dashboard; navigation always goes through the hash, never a bare render().

const VALID_VIEWS = ['dashboard', 'transactions', 'profiles', 'banks', 'assets', 'expenses', 'export', 'settings'];

function setView(view) {
  if (location.hash.replace(/^#/, '') === view) {
    applyHash();
  } else {
    location.hash = view;
  }
}

function goToBank(bankId) {
  pagination.bankDetail.page = 1;
  location.hash = `banks/${bankId}`;
}

function applyHash() {
  const [view, subId] = location.hash.replace(/^#/, '').split('/');
  currentView = VALID_VIEWS.includes(view) ? view : 'dashboard';
  editingTxId = null;
  editingProfileId = null;
  editingBankId = null;
  editingExpenseId = null;
  editingPlaceId = null;
  editingCategoryId = null;
  editingAssetId = null;
  viewingBankId = currentView === 'banks' && subId ? subId : null;
  $$('nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === currentView));
  render();
}

window.addEventListener('hashchange', applyHash);

// render() fully rebuilds #view-root on every add/edit/delete, not just on
// tab switches — so the .view entrance animation (style.css) is only allowed
// to play when the visible screen actually changed (view or bank-detail
// target); a same-screen data refresh gets a plain, animation-free swap.
let lastRenderKey = null;

function render() {
  const main = $('#view-root');
  const renderKey = `${currentView}/${viewingBankId || ''}`;
  main.classList.toggle('animate-view', renderKey !== lastRenderKey);
  lastRenderKey = renderKey;
  if (currentView === 'dashboard') main.innerHTML = renderDashboard();
  else if (currentView === 'transactions') main.innerHTML = renderTransactions();
  else if (currentView === 'profiles') main.innerHTML = renderProfiles();
  else if (currentView === 'banks') main.innerHTML = renderBanks();
  else if (currentView === 'assets') main.innerHTML = renderAssets();
  else if (currentView === 'expenses') main.innerHTML = renderExpenses();
  else if (currentView === 'export') main.innerHTML = renderExport();
  else if (currentView === 'settings') main.innerHTML = renderSettings();
  attachViewHandlers();
}

// ---------------- Dashboard ----------------

// Per-profile net balance cards. Lives on the Loans page — the dashboard keeps
// only the "Owed to you" / "You owe" totals, which is the altitude it wants.
function renderBalanceCards() {
  const balances = Storage.getAllBalances();
  if (!balances.length) return `<div class="empty-state">No profiles yet. Add one in the Profiles tab.</div>`;
  // A settled profile carries no information, so it's dropped entirely rather
  // than shown as a "0 / settled up" card taking up a slot in the grid.
  const open = balances.filter(({ balance }) => Math.abs(balance) > 0.004);
  if (!open.length) return `<div class="empty-state">All settled up — no outstanding balances.</div>`;
  return open
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
    .map(({ profile, balance }) => {
      const cls = balance > 0 ? 'owes-me' : 'i-owe';
      const status = balance > 0 ? 'owes you' : 'you owe';
      const remindBtn = balance > 0
        ? `<button class="btn btn-sm btn-icon remind-btn" data-action="remind-profile" data-id="${profile.id}" title="Send WhatsApp reminder">${ICON_REMIND}</button>`
        : '';
      return `
      <div class="balance-card ${cls}">
        ${remindBtn}
        <div class="name">${esc(profile.name)}</div>
        <div class="amount" title="${moneyWords(balance)}">${moneyWhole(Math.abs(balance))}</div>
        <div class="status">${status}</div>
      </div>`;
    })
    .join('');
}

function renderDashboard() {
  const balances = Storage.getAllBalances();
  const owedToMe = balances.filter((b) => b.balance > 0).reduce((s, b) => s + b.balance, 0);
  const iOwe = balances.filter((b) => b.balance < 0).reduce((s, b) => s + -b.balance, 0);
  const totalBankBalancePKR = Storage.getTotalBankBalancePKR();
  const totalAssetsWorth = Storage.getTotalAssetsWorth();
  const netWorth = owedToMe + totalBankBalancePKR + totalAssetsWorth - iOwe;
  const thisMonth = todayISO().slice(0, 7);
  const expensesThisMonth = Storage.listExpenses()
    .filter((e) => e.date.slice(0, 7) === thisMonth)
    .reduce((s, e) => s + e.amount, 0);

  return `
    <div class="view">
      <h2>Dashboard</h2>
      <p class="view-sub">Your money at a glance — banks, assets, loans and spending.</p>

      <div class="net-worth-card" title="Owed to you + Bank balance (converted to PKR) + Assets worth − You owe">
        <div class="label">Net worth</div>
        <div class="value" title="${moneyWords(netWorth)}">${moneyWhole(netWorth)}</div>
      </div>

      <h3 class="dash-section-title">Bank</h3>
      <div class="summary-row">
        <div class="summary-card featured ${totalBankBalancePKR < -0.004 ? 'neg' : 'pos'}" data-nav="banks" title="Combined balance across all your bank accounts, converted to PKR at the configured rates. Double-click to open Banks."><div class="label">Bank balance</div><div class="value" title="${moneyWords(totalBankBalancePKR)}">${moneyWhole(totalBankBalancePKR)}</div></div>
      </div>

      <hr class="dash-divider">

      <h3 class="dash-section-title">Assets</h3>
      <div class="summary-row">
        <div class="summary-card" data-nav="assets" title="Combined worth of everything logged in the Assets tab. Double-click to open Assets."><div class="label">Assets worth</div><div class="value" title="${moneyWords(totalAssetsWorth)}">${moneyWhole(totalAssetsWorth)}</div></div>
      </div>

      <hr class="dash-divider">

      <h3 class="dash-section-title">Loan</h3>
      <div class="summary-row">
        <div class="summary-card green" data-nav="transactions" title="Total across everyone who owes you money. Double-click to open Loans."><div class="label">Owed to you</div><div class="value" title="${moneyWords(owedToMe)}">${moneyWhole(owedToMe)}</div></div>
        <div class="summary-card red" data-nav="transactions" title="Total across everyone you owe money to. Double-click to open Loans."><div class="label">You owe</div><div class="value" title="${moneyWords(iOwe)}">${moneyWhole(iOwe)}</div></div>
      </div>

      <hr class="dash-divider">

      <h3 class="dash-section-title">Expense</h3>
      <div class="summary-row">
        <div class="summary-card red" data-nav="expenses" title="Total expenses logged so far this calendar month. Double-click to open Expenses."><div class="label">Expenses this month</div><div class="value" title="${moneyWords(expensesThisMonth)}">${moneyWhole(expensesThisMonth)}</div></div>
      </div>
    </div>`;
}

// ---------------- Transactions ----------------

function renderTxRow(t, profiles, banks) {
  const profile = profiles.find((p) => p.id === t.profileId);
  const bank = banks.find((b) => b.id === t.bankId);
  return `
    <tr data-id="${t.id}">
      <td>${formatDate(t.date)}</td>
      <td>${profile ? esc(profile.name) : '<em>deleted</em>'}</td>
      <td><span class="pill type-${t.type}">${TYPE_LABELS[t.type]}</span></td>
      <td>${money(t.amount)}</td>
      <td>${bank ? esc(bank.name) : '—'}</td>
      <td>${esc(t.notes || '')}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-sm btn-icon" data-action="edit-tx" data-id="${t.id}" title="Edit transaction">${ICON_EDIT}</button>
        <button class="btn btn-sm btn-icon btn-danger" data-action="delete-tx" data-id="${t.id}" title="Delete transaction">${ICON_DELETE}</button>
      </td>
    </tr>`;
}

function renderTransactions() {
  const profiles = Storage.listProfiles();
  const allBanks = Storage.listBanks();
  const allTxs = Storage.listTransactions();
  const editingTx = editingTxId ? allTxs.find((t) => t.id === editingTxId) : null;

  // Loans are PKR-only, but a bank already linked to this transaction stays
  // selectable even if its currency was since changed — otherwise reopening
  // the form to edit an unrelated field (e.g. Notes) would silently drop
  // the bank link.
  const pkrBanks = allBanks.filter((b) => b.currency === 'PKR' || b.id === editingTx?.bankId);

  const profileOptions = optionsHtml(profiles, editingTx?.profileId);
  const bankOptions = optionsHtml(pkrBanks, editingTx?.bankId);

  const filterProfileOptions = `<option value="">All profiles</option>` + profiles.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const filterTypeOptions =
    `<option value="">All types</option>` +
    Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

  const { pageItems: txs, total, page, totalPages } = paginateList('transactions', allTxs);
  const rows = txs.length ? txs.map((t) => renderTxRow(t, profiles, allBanks)).join('') : `<tr><td colspan="7"><div class="empty-state">No transactions yet.</div></td></tr>`;

  return `
    <div class="view">
      <h2>Loans</h2>
      <p class="view-sub">Every loan you gave or received, and its repayments.</p>

      <div class="card" style="margin-bottom:20px;">
        <form id="tx-form">
          <div class="form-grid">
            <div class="field"><label>Date</label><input type="date" name="date" required value="${editingTx ? editingTx.date : todayISO()}"></div>
            <div class="field"><label>Amount</label><input type="number" name="amount" step="0.01" min="0.01" required placeholder="0.00" value="${editingTx ? editingTx.amount : ''}"></div>
            <div class="field"><label>Profile</label><select name="profileId" required>${profiles.length ? profileOptions : '<option value="">Add a profile first</option>'}</select></div>
            <div class="field"><label>Type</label>
              <select name="type" required>
                <option value="lent" ${editingTx?.type === 'lent' ? 'selected' : ''}>Lent (I gave money)</option>
                <option value="borrowed" ${editingTx?.type === 'borrowed' ? 'selected' : ''}>Borrowed (I received money)</option>
                <option value="repayment_received" ${editingTx?.type === 'repayment_received' ? 'selected' : ''}>Repayment received (they paid me back)</option>
                <option value="repayment_made" ${editingTx?.type === 'repayment_made' ? 'selected' : ''}>Repayment made (I paid them back)</option>
              </select>
            </div>
            <div class="field"><label>Bank</label><select name="bankId" title="Only PKR accounts are shown."><option value="">— none —</option>${bankOptions}</select></div>
            <div class="field" style="grid-column: 1 / -1;"><label>Notes</label><input type="text" name="notes" placeholder="Optional" value="${editingTx ? esc(editingTx.notes || '') : ''}"></div>
            ${
              editingTx
                ? ''
                : `<div class="field field-check" style="grid-column: 1 / -1;">
                     <label><input type="checkbox" name="notify" checked> Send a WhatsApp confirmation to the profile</label>
                   </div>`
            }
          </div>
          ${submitBtn(!!editingTx, 'Add transaction', !profiles.length)}
          ${editingTx ? '<button type="button" class="btn" id="btn-cancel-tx-edit">Cancel</button>' : ''}
        </form>
      </div>

      <h3 class="dash-section-title">Balance by profile</h3>
      <div class="balance-grid" style="margin-bottom:24px;">${renderBalanceCards()}</div>

      <hr class="dash-divider">

      <div class="filters">
        <input type="search" id="filter-search" placeholder="Search by profile or notes...">
        <select id="filter-profile">${filterProfileOptions}</select>
        <select id="filter-type">${filterTypeOptions}</select>
      </div>

      <div class="card">
        <table>
          <thead><tr><th>Date</th><th>Profile</th><th>Type</th><th>Amount</th><th>Bank</th><th>Notes</th><th></th></tr></thead>
          <tbody id="tx-rows">${rows}</tbody>
        </table>
        <div id="tx-pagination">${paginationBar('transactions', total, page, totalPages)}</div>
      </div>
    </div>`;
}

// ---------------- Profiles ----------------

function renderProfiles() {
  const allProfiles = Storage.listProfiles();
  const editingProfile = editingProfileId ? allProfiles.find((p) => p.id === editingProfileId) : null;
  const { pageItems: profiles, total, page, totalPages } = paginateList('profiles', allProfiles);
  const rows = profiles.length
    ? profiles
        .map((p) => {
          const bal = Storage.getBalance(p.id);
          return `
          <tr>
            <td>${esc(p.name)}</td>
            <td>${esc(p.contact || '—')}</td>
            <td>${esc(p.email || '—')}</td>
            <td class="${bal > 0.004 ? 'type-borrowed' : bal < -0.004 ? 'type-lent' : ''}">${money(bal)}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-sm btn-icon" data-action="edit-profile" data-id="${p.id}" title="Edit profile">${ICON_EDIT}</button>
              <button class="btn btn-sm btn-icon btn-danger" data-action="delete-profile" data-id="${p.id}" title="Delete profile">${ICON_DELETE}</button>
            </td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="5"><div class="empty-state">No profiles yet.</div></td></tr>`;

  return `
    <div class="view">
      <h2>Profiles</h2>
      <p class="view-sub">People you lend to or borrow from.</p>

      <div class="card" style="margin-bottom:20px;">
        <form id="profile-form">
          <div class="form-grid">
            <div class="field"><label>Name</label><input type="text" name="name" required placeholder="e.g. Ziaf" value="${editingProfile ? esc(editingProfile.name) : ''}"></div>
            <div class="field"><label>Contact</label><input type="text" name="contact" placeholder="Phone (optional)" value="${editingProfile ? esc(editingProfile.contact || '') : ''}"></div>
            <div class="field"><label>Email</label><input type="email" name="email" placeholder="Optional" value="${editingProfile ? esc(editingProfile.email || '') : ''}"></div>
          </div>
          ${submitBtn(!!editingProfile, 'Add profile', false)}
          ${editingProfile ? '<button type="button" class="btn" id="btn-cancel-profile-edit">Cancel</button>' : ''}
        </form>
      </div>

      <div class="card">
        <table>
          <thead><tr><th>Name</th><th>Contact</th><th>Email</th><th>Balance</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div id="profile-pagination">${paginationBar('profiles', total, page, totalPages)}</div>
      </div>
    </div>`;
}

// ---------------- Banks ----------------

function renderBankRow(b) {
  const bal = Storage.getBankBalance(b.id);
  // PKR rows get the usual lac/crore spellout; a foreign-currency row is more
  // useful showing what its balance is actually worth in PKR on hover.
  const balTitle = b.currency === 'PKR' ? moneyWords(bal) : `≈ Rs ${money(Storage.convertToPKR(bal, b.currency))} at the current rate`;
  return `
    <tr data-id="${b.id}">
      <td>${esc(b.name)}</td>
      <td><span class="pill currency">${b.currency}</span></td>
      <td class="${bal > 0.004 ? 'type-borrowed' : bal < -0.004 ? 'type-lent' : ''}" title="${balTitle}">${CURRENCY_SYMBOLS[b.currency]} ${money(bal)}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-sm btn-icon" data-action="view-bank" data-id="${b.id}" title="View history">${ICON_HISTORY}</button>
        <button class="btn btn-sm btn-icon" data-action="edit-bank" data-id="${b.id}" title="Edit bank">${ICON_EDIT}</button>
        <button class="btn btn-sm btn-icon btn-danger" data-action="delete-bank" data-id="${b.id}" title="Delete bank">${ICON_DELETE}</button>
      </td>
    </tr>`;
}

function renderBanks() {
  if (viewingBankId) return renderBankDetail(viewingBankId);

  const allBanks = Storage.listBanks();
  const editingBank = editingBankId ? allBanks.find((b) => b.id === editingBankId) : null;
  const { pageItems: banks, total, page, totalPages } = paginateList('banks', allBanks);
  const rows = banks.length ? banks.map(renderBankRow).join('') : `<tr><td colspan="4"><div class="empty-state">No banks yet.</div></td></tr>`;
  const currencyTotals = Storage.getBalancesByCurrency();

  return `
    <div class="view">
      <h2>Banks</h2>
      <p class="view-sub">Accounts used to send or receive money — each one keeps its own balance and history.</p>

      <div class="card" style="margin-bottom:20px;">
        <form id="bank-form">
          <div class="form-grid">
            <div class="field"><label>Bank name</label><input type="text" name="name" required placeholder="e.g. HBL, Meezan, Cash" value="${editingBank ? esc(editingBank.name) : ''}"></div>
            <div class="field"><label>Currency</label><select name="currency">${currencyOptionsHtml(editingBank?.currency || 'PKR')}</select></div>
          </div>
          ${submitBtn(!!editingBank, 'Add bank', false)}
          ${editingBank ? '<button type="button" class="btn" id="btn-cancel-bank-edit">Cancel</button>' : ''}
        </form>
      </div>

      ${
        currencyTotals.length
          ? `<div class="summary-row" style="margin-bottom:20px;">
              ${currencyTotals
                .map(
                  ({ currency, total }) => `
                <div class="summary-card">
                  <div class="label">${currency} total</div>
                  <div class="value" title="${moneyWords(total)}">${CURRENCY_SYMBOLS[currency]} ${moneyWhole(total)}</div>
                </div>`
                )
                .join('')}
            </div>`
          : ''
      }

      <div class="filters">
        <input type="search" id="filter-bank-search" placeholder="Search by bank name...">
      </div>

      <div class="card">
        <table>
          <thead><tr><th>Name</th><th>Currency</th><th>Balance</th><th></th></tr></thead>
          <tbody id="bank-rows">${rows}</tbody>
        </table>
        <div id="bank-pagination">${paginationBar('banks', total, page, totalPages)}</div>
      </div>
    </div>`;
}

// ---------------- Assets ----------------

function renderAssetRow(a) {
  return `
    <tr data-id="${a.id}">
      <td>${esc(a.name)}</td>
      <td title="${moneyWords(a.worth)}">${money(a.worth)}</td>
      <td>${esc(a.notes)}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-sm btn-icon" data-action="edit-asset" data-id="${a.id}" title="Edit asset">${ICON_EDIT}</button>
        <button class="btn btn-sm btn-icon btn-danger" data-action="delete-asset" data-id="${a.id}" title="Delete asset">${ICON_DELETE}</button>
      </td>
    </tr>`;
}

function renderAssets() {
  const allAssets = Storage.listAssets();
  const editingAsset = editingAssetId ? allAssets.find((a) => a.id === editingAssetId) : null;
  const { pageItems: assets, total, page, totalPages } = paginateList('assets', allAssets);
  const rows = assets.length ? assets.map(renderAssetRow).join('') : `<tr><td colspan="4"><div class="empty-state">No assets yet.</div></td></tr>`;
  const totalWorth = allAssets.reduce((s, a) => s + a.worth, 0);

  return `
    <div class="view">
      <h2>Assets</h2>
      <p class="view-sub">Things you own that hold value — property, vehicles, gold, investments.</p>

      <div class="card" style="margin-bottom:20px;">
        <form id="asset-form">
          <div class="form-grid">
            <div class="field"><label>Asset name</label><input type="text" name="name" required placeholder="e.g. Car, Gold, Plot" value="${editingAsset ? esc(editingAsset.name) : ''}"></div>
            <div class="field"><label>Worth</label><input type="number" name="worth" step="0.01" min="0" required placeholder="0.00" value="${editingAsset ? editingAsset.worth : ''}"></div>
            <div class="field" style="grid-column: 1 / -1;"><label>Notes</label><input type="text" name="notes" required placeholder="e.g. 2020 Honda Civic, white" value="${editingAsset ? esc(editingAsset.notes || '') : ''}"></div>
          </div>
          ${submitBtn(!!editingAsset, 'Add asset', false)}
          ${editingAsset ? '<button type="button" class="btn" id="btn-cancel-asset-edit">Cancel</button>' : ''}
        </form>
      </div>

      <div class="filters">
        <input type="search" id="filter-asset-search" placeholder="Search by asset name...">
      </div>

      <div class="card">
        <table>
          <thead><tr><th>Name</th><th>Worth</th><th>Notes</th><th></th></tr></thead>
          <tbody id="asset-rows">${rows}</tbody>
          ${assets.length ? `<tfoot><tr><td>Total</td><td class="total-value" title="${moneyWords(totalWorth)}">${money(totalWorth)}</td><td></td><td></td></tr></tfoot>` : ''}
        </table>
        <div id="asset-pagination">${paginationBar('assets', total, page, totalPages)}</div>
      </div>
    </div>`;
}

function renderBankDetail(bankId) {
  const bank = Storage.listBanks().find((b) => b.id === bankId);
  if (!bank) {
    viewingBankId = null;
    return renderBanks();
  }

  const balance = Storage.getBankBalance(bankId);
  const symbol = CURRENCY_SYMBOLS[bank.currency];
  const otherBanks = Storage.listBanks().filter((b) => b.id !== bankId && b.currency === bank.currency);
  const toBankOptions = optionsHtml(otherBanks);
  const allEntries = Storage.listBankTransactions(bankId);
  const { pageItems: entries, total: entryTotal, page: entryPage, totalPages: entryTotalPages } = paginateList('bankDetail', allEntries);

  const rows = entries.length
    ? entries
        .map((e) => {
          const positive = ['deposit', 'transfer_in', 'loan_in'].includes(e.type);
          const colorCls = positive ? 'type-borrowed' : 'type-lent';
          return `
          <tr>
            <td>${formatDate(e.date)}</td>
            <td><span class="pill type-${e.type}">${BANK_TX_LABELS[e.type]}</span></td>
            <td class="${colorCls}">${positive ? '+' : '-'}${symbol}${money(e.amount)}</td>
            <td>${esc(e.notes || '')}${e.linkedLoanTxId ? ' <em>(from loan entry)</em>' : e.linkedExpenseId ? ' <em>(from expense)</em>' : ''}</td>
            <td style="white-space:nowrap;">${e.linkedLoanTxId || e.linkedExpenseId ? '' : `<button class="btn btn-sm btn-icon btn-danger" data-action="delete-bank-tx" data-id="${e.id}" title="Delete entry">${ICON_DELETE}</button>`}</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="5"><div class="empty-state">No activity yet.</div></td></tr>`;

  return `
    <div class="view">
      <button class="btn btn-sm" id="btn-back-to-banks" style="margin-bottom:16px;">&larr; All banks</button>
      <h2>${esc(bank.name)} <span class="pill currency">${bank.currency}</span></h2>
      <p class="view-sub">Balance: <strong>${symbol} ${money(balance)}</strong></p>

      <div class="summary-row" style="margin-bottom:20px;">
        <div class="card" style="flex:1; min-width:220px;">
          <h3 style="margin-top:0;">Add balance</h3>
          <form id="bank-deposit-form" data-bank-id="${bankId}">
            <div class="form-grid">
              <div class="field"><label>Date</label><input type="date" name="date" required value="${todayISO()}"></div>
              <div class="field"><label>Amount</label><input type="number" name="amount" step="0.01" min="0.01" required placeholder="0.00"></div>
              <div class="field" style="grid-column:1/-1;"><label>Notes</label><input type="text" name="notes" placeholder="Optional"></div>
            </div>
            <button class="btn btn-primary" type="submit" title="Add balance">${ICON_ADD} Add balance</button>
          </form>
        </div>

        <div class="card" style="flex:1; min-width:220px;">
          <h3 style="margin-top:0;">Withdraw / Transfer</h3>
          <p class="connect-note" style="margin:0 0 12px;">Money leaving this account with no linked expense or loan — e.g. cash withdrawn or sent outside the app.</p>
          <form id="bank-withdraw-form" data-bank-id="${bankId}">
            <div class="form-grid">
              <div class="field"><label>Date</label><input type="date" name="date" required value="${todayISO()}"></div>
              <div class="field"><label>Amount</label><input type="number" name="amount" step="0.01" min="0.01" required placeholder="0.00"></div>
              <div class="field" style="grid-column:1/-1;"><label>Notes</label><input type="text" name="notes" placeholder="Optional"></div>
            </div>
            <button class="btn btn-primary" type="submit" title="Withdraw / Transfer">${ICON_ADD} Withdraw / Transfer</button>
          </form>
        </div>
      </div>

      <div class="card" style="margin-bottom:20px;">
        <h3 style="margin-top:0;">Interbank Transfer</h3>
        <p class="connect-note" style="margin:0 0 12px;">Move money between your own accounts — pick which of your other ${bank.currency} accounts it's going to. Only same-currency accounts can transfer to each other.</p>
        <form id="bank-transfer-form" data-bank-id="${bankId}">
          <div class="form-grid">
            <div class="field"><label>Date</label><input type="date" name="date" required value="${todayISO()}"></div>
            <div class="field"><label>To bank</label><select name="toBankId" required>${otherBanks.length ? toBankOptions : `<option value="">No other ${bank.currency} accounts yet</option>`}</select></div>
            <div class="field"><label>Amount</label><input type="number" name="amount" step="0.01" min="0.01" required placeholder="0.00"></div>
            <div class="field" style="grid-column:1/-1;"><label>Notes</label><input type="text" name="notes" placeholder="Optional"></div>
          </div>
          <button class="btn btn-primary" type="submit" ${otherBanks.length ? '' : 'disabled'} title="Transfer">${ICON_ADD} Transfer</button>
        </form>
      </div>

      <div class="card">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Notes</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div id="bankDetail-pagination">${paginationBar('bankDetail', entryTotal, entryPage, entryTotalPages)}</div>
      </div>
    </div>`;
}

// ---------------- Expenses ----------------
// Place and category are two independent, flat filters (not a category/
// subcategory tree) so "all Mardan expenses" and "all Water bills across
// every place" are both a single filter selection, not a lookup per place.

// Donut chart of the currently-filtered expenses, grouped by whichever of the
// two independent dimensions (category/place) is selected. Rebuilt from
// scratch on every filter change (see applyExpenseFilters) so it always
// reflects exactly what the table below it shows.
function renderExpenseOverviewContent(filtered) {
  const total = filtered.reduce((s, e) => s + e.amount, 0);
  const toggle = `
    <div class="breakdown-toggle">
      <button class="btn btn-sm ${expenseBreakdownBy === 'categoryId' ? 'active' : ''}" data-breakdown="categoryId">By category</button>
      <button class="btn btn-sm ${expenseBreakdownBy === 'placeId' ? 'active' : ''}" data-breakdown="placeId">By place</button>
    </div>`;

  if (!filtered.length || total <= 0) {
    return `
      <div class="overview-header">
        <div><h3 style="margin:0 0 4px;">Overview</h3><div class="overview-total">${money(0)}</div></div>
        ${toggle}
      </div>
      <div class="empty-state">No expenses in this range.</div>`;
  }

  const items = expenseBreakdownBy === 'placeId' ? Storage.listPlaces() : Storage.listExpenseCategories();
  let slices = [...filtered.reduce((map, e) => {
    const key = e[expenseBreakdownBy] || 'none';
    map.set(key, (map.get(key) || 0) + e.amount);
    return map;
  }, new Map())]
    .map(([id, amount]) => ({ name: items.find((i) => i.id === id)?.name || 'Uncategorized', amount }))
    .sort((a, b) => b.amount - a.amount);

  const MAX_SLICES = 7;
  if (slices.length > MAX_SLICES) {
    const other = slices.slice(MAX_SLICES).reduce((s, x) => s + x.amount, 0);
    slices = [...slices.slice(0, MAX_SLICES), { name: 'Other', amount: other }];
  }

  const R = 60, STROKE = 24, C = 2 * Math.PI * R, GAP = 2;
  const CENTER = R + STROKE / 2; // ring's outer edge = R + STROKE/2 from center — box must span 2x that or it clips
  const BOX = CENTER * 2;
  let offset = 0;
  const paths = slices
    .map((s, i) => {
      const frac = s.amount / total;
      const len = Math.max(frac * C - GAP, 0);
      const dashoffset = -offset;
      offset += frac * C;
      return `<circle class="pie-slice" cx="${CENTER}" cy="${CENTER}" r="${R}" fill="none" stroke="var(--cat-${i + 1})" stroke-width="${STROKE}" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${dashoffset}"><title>${esc(s.name)}: ${money(s.amount)} (${(frac * 100).toFixed(1)}%)</title></circle>`;
    })
    .join('');

  const legend =
    slices.length > 1
      ? `<div class="overview-legend">${slices
          .map(
            (s, i) => `
        <div class="legend-row">
          <span class="legend-swatch" style="background:var(--cat-${i + 1})"></span>
          <span class="legend-name">${esc(s.name)}</span>
          <span class="legend-value">${money(s.amount)} <span class="legend-pct">(${((s.amount / total) * 100).toFixed(1)}%)</span></span>
        </div>`
          )
          .join('')}</div>`
      : '';

  return `
    <div class="overview-header">
      <div><h3 style="margin:0 0 4px;">Overview</h3><div class="overview-total">${money(total)}</div></div>
      ${toggle}
    </div>
    <div class="overview-body">
      <div class="overview-chart">
        <svg viewBox="0 0 ${BOX} ${BOX}" width="${BOX}" height="${BOX}" role="img" aria-label="Expense breakdown ${expenseBreakdownBy === 'placeId' ? 'by place' : 'by category'}">
          <circle cx="${CENTER}" cy="${CENTER}" r="${R}" fill="none" stroke="var(--border)" stroke-width="${STROKE}"></circle>
          <g transform="rotate(-90 ${CENTER} ${CENTER})">${paths}</g>
        </svg>
      </div>
      ${legend}
    </div>`;
}

function renderExpenseRow(e, places, categories, banks) {
  const place = places.find((h) => h.id === e.placeId);
  const category = categories.find((c) => c.id === e.categoryId);
  const bank = banks.find((b) => b.id === e.bankId);
  return `
    <tr data-id="${e.id}">
      <td>${formatDate(e.date)}</td>
      <td>${place ? esc(place.name) : '<em>deleted</em>'}</td>
      <td>${category ? esc(category.name) : '<em>deleted</em>'}</td>
      <td class="type-lent">${money(e.amount)}</td>
      <td>${bank ? esc(bank.name) : '—'}</td>
      <td>${esc(e.notes || '')}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-sm btn-icon" data-action="edit-expense" data-id="${e.id}" title="Edit expense">${ICON_EDIT}</button>
        <button class="btn btn-sm btn-icon btn-danger" data-action="delete-expense" data-id="${e.id}" title="Delete expense">${ICON_DELETE}</button>
      </td>
    </tr>`;
}

function renderExpenses() {
  const places = Storage.listPlaces();
  const categories = Storage.listExpenseCategories();
  const allBanks = Storage.listBanks();
  const expenses = Storage.listExpenses();

  const editingPlace = editingPlaceId ? places.find((h) => h.id === editingPlaceId) : null;
  const editingCategory = editingCategoryId ? categories.find((c) => c.id === editingCategoryId) : null;
  const editingExpense = editingExpenseId ? expenses.find((e) => e.id === editingExpenseId) : null;

  // Expenses are PKR-only, but a bank already linked to this expense stays
  // selectable even if its currency was since changed — otherwise reopening
  // the form to edit an unrelated field would silently drop the bank link.
  const pkrBanks = allBanks.filter((b) => b.currency === 'PKR' || b.id === editingExpense?.bankId);

  const placeRows = places.length
    ? places
        .map(
          (h) => `
          <tr>
            <td>${esc(h.name)}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-sm btn-icon" data-action="edit-place" data-id="${h.id}" title="Edit place">${ICON_EDIT}</button>
              <button class="btn btn-sm btn-icon btn-danger" data-action="delete-place" data-id="${h.id}" title="Delete place">${ICON_DELETE}</button>
            </td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="2"><div class="empty-state">No places yet.</div></td></tr>`;

  const categoryRows = categories.length
    ? categories
        .map(
          (c) => `
          <tr>
            <td>${esc(c.name)}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-sm btn-icon" data-action="edit-category" data-id="${c.id}" title="Edit category">${ICON_EDIT}</button>
              <button class="btn btn-sm btn-icon btn-danger" data-action="delete-category" data-id="${c.id}" title="Delete category">${ICON_DELETE}</button>
            </td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="2"><div class="empty-state">No categories yet.</div></td></tr>`;

  const placeOptions = optionsHtml(places, editingExpense?.placeId);
  const categoryOptions = optionsHtml(categories, editingExpense?.categoryId);
  const bankOptions = optionsHtml(pkrBanks, editingExpense?.bankId);
  const canAddExpense = places.length && categories.length;

  // A place/category deleted while it was filtered on would otherwise sit in
  // the set forever, silently matching nothing.
  expenseFilter.places.forEach((id) => places.some((p) => p.id === id) || expenseFilter.places.delete(id));
  expenseFilter.categories.forEach((id) => categories.some((c) => c.id === id) || expenseFilter.categories.delete(id));

  // Table rows and pagination are populated by applyExpenseFilters(), called
  // unconditionally right after this view attaches (see attachViewHandlers) —
  // it's the single source of truth for what "filtered" means here, so the
  // initial paint doesn't duplicate that logic just to have it overwritten.

  return `
    <div class="view">
      <h2>Expenses</h2>
      <p class="view-sub">Money spent, tagged by place and category — filter by either independently.</p>

      <div class="card" style="margin-bottom:20px;">
        <form id="expense-form">
          <div class="form-grid">
            <div class="field"><label>Date</label><input type="date" name="date" required value="${editingExpense ? editingExpense.date : todayISO()}"></div>
            <div class="field"><label>Amount</label><input type="number" name="amount" step="0.01" min="0.01" required placeholder="0.00" value="${editingExpense ? editingExpense.amount : ''}"></div>
            <div class="field"><label>Place</label><select name="placeId" required>${places.length ? placeOptions : '<option value="">Add a place first</option>'}</select></div>
            <div class="field"><label>Category</label><select name="categoryId" required>${categories.length ? categoryOptions : '<option value="">Add a category first</option>'}</select></div>
            <div class="field"><label>Bank</label><select name="bankId" title="Only PKR accounts are shown."><option value="">— none —</option>${bankOptions}</select></div>
            <div class="field" style="grid-column: 1 / -1;"><label>Notes</label><input type="text" name="notes" placeholder="Optional" value="${editingExpense ? esc(editingExpense.notes || '') : ''}"></div>
          </div>
          ${submitBtn(!!editingExpense, 'Add expense', !canAddExpense)}
          ${editingExpense ? '<button type="button" class="btn" id="btn-cancel-expense-edit">Cancel</button>' : ''}
        </form>
      </div>

      <div class="filters">
        <input type="search" id="filter-expense-search" placeholder="Search by notes...">
        ${multiSelectHtml('places', places, expenseFilter.places)}
        ${multiSelectHtml('categories', categories, expenseFilter.categories)}
        <input type="date" id="filter-date-from" title="From date" value="${firstOfMonthISO()}">
        <input type="date" id="filter-date-to" title="To date" value="${todayISO()}">
      </div>

      <div class="card" id="expense-overview" style="margin-bottom:20px;"></div>

      <div class="card" style="margin-bottom:20px;">
        <table>
          <thead><tr><th>Date</th><th>Place</th><th>Category</th><th>Amount</th><th>Bank</th><th>Notes</th><th></th></tr></thead>
          <tbody id="expense-rows"></tbody>
        </table>
        <div id="expense-pagination"></div>
      </div>

      <div class="summary-row">
        <div class="card" style="flex:1; min-width:220px;">
          <h3 style="margin-top:0;">Places</h3>
          <form id="place-form">
            <div class="form-grid">
              <div class="field"><label>Name</label><input type="text" name="name" required placeholder="e.g. Place - Islamabad" value="${editingPlace ? esc(editingPlace.name) : ''}"></div>
            </div>
            ${submitBtn(!!editingPlace, 'Add place', false)}
            ${editingPlace ? '<button type="button" class="btn" id="btn-cancel-place-edit">Cancel</button>' : ''}
          </form>
          <div class="list-scroll" style="margin-top:14px;">
            <table>
              <thead><tr><th>Name</th><th></th></tr></thead>
              <tbody>${placeRows}</tbody>
            </table>
          </div>
        </div>

        <div class="card" style="flex:1; min-width:220px;">
          <h3 style="margin-top:0;">Categories</h3>
          <form id="category-form">
            <div class="form-grid">
              <div class="field"><label>Name</label><input type="text" name="name" required placeholder="e.g. Water, Electricity" value="${editingCategory ? esc(editingCategory.name) : ''}"></div>
            </div>
            ${submitBtn(!!editingCategory, 'Add category', false)}
            ${editingCategory ? '<button type="button" class="btn" id="btn-cancel-category-edit">Cancel</button>' : ''}
          </form>
          <div class="list-scroll" style="margin-top:14px;">
            <table>
              <thead><tr><th>Name</th><th></th></tr></thead>
              <tbody>${categoryRows}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

// ---------------- Export ----------------

function renderExport() {
  return `
    <div class="view">
      <h2>Export &amp; Backup</h2>
      <p class="view-sub">Download a copy of your data. ${Storage.getMode() === 'fs' ? 'Your data is already auto-saved to the file you selected.' : 'Since your browser is using local storage, export regularly to avoid losing data.'}</p>
      <div class="card" style="display:flex; gap:10px; flex-wrap:wrap;">
        <button class="btn btn-primary" id="btn-export-json">Download JSON</button>
        <button class="btn" id="btn-export-csv">Download CSV</button>
        ${['local', 'remote'].includes(Storage.getMode()) ? '<label class="btn" style="margin:0;">Import JSON<input type="file" id="import-json" accept="application/json" class="hidden"></label>' : ''}
      </div>
    </div>`;
}

// ---------------- Settings ----------------

function renderSettings() {
  const mode = Storage.getMode();
  const fileName = Storage.getFileName?.();
  const { rates } = Storage.getSettings();

  return `
    <div class="view">
      <h2>Settings</h2>
      <p class="view-sub">Manage where your loan data is stored and how foreign-currency banks convert to PKR.</p>

      <div class="card" style="margin-bottom:20px;">
        <h3 style="margin-top:0;">Currency rates</h3>
        <p class="connect-note" style="margin:0 0 12px;">How many PKR one unit of each currency is worth — used to convert USD/EUR bank balances into the Dashboard's PKR totals. PKR itself needs no rate.</p>
        <form id="settings-rates-form">
          <div class="form-grid">
            <div class="field"><label>USD &rarr; PKR rate <span class="live-rate" id="live-rate-USD">(fetching live rate&hellip;)</span></label><input type="number" name="USD" step="0.01" min="0.01" required value="${rates.USD}"></div>
            <div class="field"><label>EUR &rarr; PKR rate <span class="live-rate" id="live-rate-EUR">(fetching live rate&hellip;)</span></label><input type="number" name="EUR" step="0.01" min="0.01" required value="${rates.EUR}"></div>
          </div>
          <button class="btn btn-primary" type="submit" title="Save rates">${ICON_SAVE} Save rates</button>
        </form>
      </div>

      <div class="card">
        <p><strong>Current storage:</strong> ${mode === 'fs' ? `Local file — ${esc(fileName || 'unknown')}` : 'Browser local storage'}</p>
        ${
          Storage.supportsFS
            ? `<div class="connect-actions" style="margin-top:12px;">
                <button class="btn btn-primary" id="btn-settings-new">Create new loan table</button>
                <button class="btn" id="btn-settings-open">Open a different loan table</button>
              </div>`
            : `<p class="connect-note">Your browser doesn't support saving directly to a file. Use Export &amp; Backup regularly to avoid losing data.</p>`
        }
      </div>
    </div>`;
}

// ---------------- Handlers ----------------

// Points the tab pre-opened by the loan form at WhatsApp, with the message for
// this entry's type filled in. The balance quoted is the one *after* the entry,
// so it matches what the Loans tab now shows.
function openLoanEntryMessage(tab, tx) {
  const profile = Storage.listProfiles().find((p) => p.id === tx.profileId);
  const number = profile && toWhatsAppNumber(profile.contact);
  if (!number) {
    tab?.close();
    toast(`Saved — but ${profile ? profile.name : 'this profile'} has no phone number to message.`, true);
    return;
  }
  const message = loanEntryMessage({
    type: tx.type,
    name: profile.name,
    amount: tx.amount,
    bankName: Storage.listBanks().find((b) => b.id === tx.bankId)?.name,
    notes: tx.notes,
    date: tx.date,
    balance: Storage.getBalance(tx.profileId),
  });
  if (!message) {
    tab?.close();
    return;
  }
  const url = whatsAppSendUrl(number, message);
  // tab is null only if a popup blocker refused it — try once more directly.
  if (tab) tab.location.href = url;
  else window.open(url, '_blank', 'noopener');
}

function attachViewHandlers() {
  // Double-click a dashboard tile to open the module behind it — same idiom as
  // double-clicking a row in the Banks table. Bound to .view rather than the
  // stable #view-root: this runs after every render, and only a node that gets
  // replaced each time drops its old listener with it.
  $('.view')?.addEventListener('dblclick', (e) => {
    const card = e.target.closest('[data-nav]');
    if (card) setView(card.dataset.nav);
  });

  $('.balance-grid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="remind-profile"]');
    if (!btn) return;
    const profile = Storage.listProfiles().find((p) => p.id === btn.dataset.id);
    if (!profile) return;
    const number = toWhatsAppNumber(profile.contact);
    if (!number) {
      toast(`Add a phone number for ${profile.name} first.`, true);
      return;
    }
    const balance = Storage.getBalance(profile.id);
    // web.whatsapp.com/send opens WhatsApp Web directly with the chat and
    // message pre-filled; wa.me instead shows an intermediate landing page
    // ("Open app" / "Continue to WhatsApp Web") before getting there.
    window.open(whatsAppSendUrl(number, reminderMessage(profile.name, balance)), '_blank', 'noopener');
  });

  const txForm = $('#tx-form');
  if (txForm) {
    txForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(txForm);
      const fields = {
        date: fd.get('date'),
        amount: fd.get('amount'),
        profileId: fd.get('profileId'),
        type: fd.get('type'),
        bankId: fd.get('bankId'),
        notes: fd.get('notes'),
      };
      // Opened up-front, while the submit gesture is still live: once the
      // await below breaks the user-gesture chain browsers block window.open.
      // (No 'noopener' here — that makes window.open return null, and the tab
      // handle is what we redirect to WhatsApp after the save succeeds.)
      const notify = !editingTxId && fd.get('notify') === 'on';
      const waTab = notify ? window.open('', '_blank') : null;
      try {
        if (editingTxId) {
          await Storage.updateTransaction(editingTxId, fields);
          toast('Transaction updated.');
        } else {
          const tx = await Storage.addTransaction(fields);
          toast('Transaction added.');
          if (notify) openLoanEntryMessage(waTab, tx);
        }
        editingTxId = null;
        render();
      } catch (err) {
        waTab?.close();
        toast(err.message, true);
      }
    });
  }

  $('#btn-cancel-tx-edit')?.addEventListener('click', () => {
    editingTxId = null;
    render();
  });

  // Delegated on the stable #tx-rows tbody — applyFilters() below replaces
  // its innerHTML on every search/filter/pagination change, which would
  // detach listeners bound directly to the row buttons.
  $('#tx-rows')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-action="edit-tx"]');
    if (editBtn) {
      editingTxId = editBtn.dataset.id;
      render();
      return;
    }
    const deleteBtn = e.target.closest('[data-action="delete-tx"]');
    if (deleteBtn) {
      if (!confirm('Delete this transaction?')) return;
      await Storage.deleteTransaction(deleteBtn.dataset.id);
      toast('Transaction deleted.');
      render();
    }
  });

  const filterSearch = $('#filter-search');
  const filterProfile = $('#filter-profile');
  const filterType = $('#filter-type');
  const applyFilters = (resetPage) => {
    if (resetPage) pagination.transactions.page = 1;
    const q = filterSearch?.value.trim().toLowerCase();
    const pid = filterProfile?.value;
    const type = filterType?.value;
    const profiles = Storage.listProfiles();
    const banks = Storage.listBanks();
    const filtered = Storage.listTransactions().filter((tx) => {
      const profileName = profiles.find((p) => p.id === tx.profileId)?.name || '';
      const matchQ = !q || profileName.toLowerCase().includes(q) || (tx.notes || '').toLowerCase().includes(q);
      const matchP = !pid || tx.profileId === pid;
      const matchT = !type || tx.type === type;
      return matchQ && matchP && matchT;
    });
    const { pageItems, total, page, totalPages } = paginateList('transactions', filtered);
    const txRows = $('#tx-rows');
    if (txRows) txRows.innerHTML = pageItems.length ? pageItems.map((t) => renderTxRow(t, profiles, banks)).join('') : `<tr><td colspan="7"><div class="empty-state">No transactions match.</div></td></tr>`;
    const bar = $('#tx-pagination');
    if (bar) bar.innerHTML = paginationBar('transactions', total, page, totalPages);
  };
  filterSearch?.addEventListener('input', () => applyFilters(true));
  filterProfile?.addEventListener('change', () => applyFilters(true));
  filterType?.addEventListener('change', () => applyFilters(true));

  const profileForm = $('#profile-form');
  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(profileForm);
      const name = fd.get('name').trim();
      if (!name) return;
      const fields = { name, contact: fd.get('contact'), email: fd.get('email') };
      try {
        if (editingProfileId) {
          await Storage.updateProfile(editingProfileId, fields);
          toast('Profile updated.');
        } else {
          await Storage.addProfile(fields);
          toast('Profile added.');
        }
        editingProfileId = null;
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  $('#btn-cancel-profile-edit')?.addEventListener('click', () => {
    editingProfileId = null;
    render();
  });

  $$('[data-action="edit-profile"]').forEach((btn) =>
    btn.addEventListener('click', () => {
      editingProfileId = btn.dataset.id;
      render();
    })
  );

  $$('[data-action="delete-profile"]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this profile?')) return;
      try {
        await Storage.deleteProfile(btn.dataset.id);
        toast('Profile deleted.');
        render();
      } catch (err) {
        toast(err.message, true);
      }
    })
  );

  const bankForm = $('#bank-form');
  if (bankForm) {
    bankForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(bankForm);
      const name = fd.get('name').trim();
      const currency = fd.get('currency');
      if (!name) return;
      try {
        if (editingBankId) {
          await Storage.updateBank(editingBankId, { name, currency });
          toast('Bank updated.');
        } else {
          await Storage.addBank({ name, currency });
          toast('Bank added.');
        }
        editingBankId = null;
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  $('#btn-cancel-bank-edit')?.addEventListener('click', () => {
    editingBankId = null;
    render();
  });

  const bankSearch = $('#filter-bank-search');
  const applyBankFilters = (resetPage) => {
    if (resetPage) pagination.banks.page = 1;
    const q = bankSearch?.value.trim().toLowerCase();
    const filtered = Storage.listBanks().filter((b) => !q || b.name.toLowerCase().includes(q));
    const { pageItems, total, page, totalPages } = paginateList('banks', filtered);
    const bankRows = $('#bank-rows');
    if (bankRows) bankRows.innerHTML = pageItems.length ? pageItems.map(renderBankRow).join('') : `<tr><td colspan="4"><div class="empty-state">No banks match.</div></td></tr>`;
    const bar = $('#bank-pagination');
    if (bar) bar.innerHTML = paginationBar('banks', total, page, totalPages);
  };
  bankSearch?.addEventListener('input', () => applyBankFilters(true));

  // Delegated on the stable #bank-rows tbody — applyBankFilters() above
  // replaces its innerHTML on every search/pagination change, which would
  // detach listeners bound directly to the row buttons.
  $('#bank-rows')?.addEventListener('click', async (e) => {
    const viewBtn = e.target.closest('[data-action="view-bank"]');
    if (viewBtn) {
      goToBank(viewBtn.dataset.id);
      return;
    }
    const editBtn = e.target.closest('[data-action="edit-bank"]');
    if (editBtn) {
      editingBankId = editBtn.dataset.id;
      render();
      return;
    }
    const deleteBtn = e.target.closest('[data-action="delete-bank"]');
    if (deleteBtn) {
      if (!confirm('Delete this bank?')) return;
      try {
        await Storage.deleteBank(deleteBtn.dataset.id);
        toast('Bank deleted.');
        render();
      } catch (err) {
        toast(err.message, true);
      }
    }
  });

  $('#bank-rows')?.addEventListener('dblclick', (e) => {
    if (e.target.closest('button')) return;
    const row = e.target.closest('tr[data-id]');
    if (row) goToBank(row.dataset.id);
  });

  $('#btn-back-to-banks')?.addEventListener('click', () => setView('banks'));

  const assetForm = $('#asset-form');
  if (assetForm) {
    assetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(assetForm);
      const name = fd.get('name').trim();
      const worth = fd.get('worth');
      const notes = fd.get('notes').trim();
      if (!name || !notes) return;
      try {
        if (editingAssetId) {
          await Storage.updateAsset(editingAssetId, { name, worth, notes });
          toast('Asset updated.');
        } else {
          await Storage.addAsset({ name, worth, notes });
          toast('Asset added.');
        }
        editingAssetId = null;
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  $('#btn-cancel-asset-edit')?.addEventListener('click', () => {
    editingAssetId = null;
    render();
  });

  const assetSearch = $('#filter-asset-search');
  const applyAssetFilters = (resetPage) => {
    if (resetPage) pagination.assets.page = 1;
    const q = assetSearch?.value.trim().toLowerCase();
    const filtered = Storage.listAssets().filter((a) => !q || a.name.toLowerCase().includes(q));
    const { pageItems, total, page, totalPages } = paginateList('assets', filtered);
    const assetRows = $('#asset-rows');
    if (assetRows) assetRows.innerHTML = pageItems.length ? pageItems.map(renderAssetRow).join('') : `<tr><td colspan="4"><div class="empty-state">No assets match.</div></td></tr>`;
    const bar = $('#asset-pagination');
    if (bar) bar.innerHTML = paginationBar('assets', total, page, totalPages);
  };
  assetSearch?.addEventListener('input', () => applyAssetFilters(true));

  // Delegated on the stable #asset-rows tbody — applyAssetFilters() above
  // replaces its innerHTML on every search/pagination change, which would
  // detach listeners bound directly to the row buttons.
  $('#asset-rows')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-action="edit-asset"]');
    if (editBtn) {
      editingAssetId = editBtn.dataset.id;
      render();
      return;
    }
    const deleteBtn = e.target.closest('[data-action="delete-asset"]');
    if (deleteBtn) {
      if (!confirm('Delete this asset?')) return;
      try {
        await Storage.deleteAsset(deleteBtn.dataset.id);
        toast('Asset deleted.');
        render();
      } catch (err) {
        toast(err.message, true);
      }
    }
  });

  const depositForm = $('#bank-deposit-form');
  if (depositForm) {
    depositForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(depositForm);
      try {
        await Storage.addBankDeposit({
          bankId: depositForm.dataset.bankId,
          date: fd.get('date'),
          amount: fd.get('amount'),
          notes: fd.get('notes'),
        });
        toast('Balance added.');
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  const withdrawForm = $('#bank-withdraw-form');
  if (withdrawForm) {
    withdrawForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(withdrawForm);
      try {
        await Storage.addBankWithdrawal({
          bankId: withdrawForm.dataset.bankId,
          date: fd.get('date'),
          amount: fd.get('amount'),
          notes: fd.get('notes'),
        });
        toast('Withdrawal recorded.');
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  const transferForm = $('#bank-transfer-form');
  if (transferForm) {
    transferForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(transferForm);
      try {
        await Storage.transferFunds({
          fromBankId: transferForm.dataset.bankId,
          toBankId: fd.get('toBankId'),
          date: fd.get('date'),
          amount: fd.get('amount'),
          notes: fd.get('notes'),
        });
        toast('Transfer recorded.');
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  $$('[data-action="delete-bank-tx"]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this entry?')) return;
      try {
        await Storage.deleteBankTransaction(btn.dataset.id);
        toast('Entry deleted.');
        render();
      } catch (err) {
        toast(err.message, true);
      }
    })
  );

  const placeForm = $('#place-form');
  if (placeForm) {
    placeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(placeForm);
      const name = fd.get('name').trim();
      if (!name) return;
      try {
        if (editingPlaceId) {
          await Storage.updatePlace(editingPlaceId, { name });
          toast('Place updated.');
        } else {
          await Storage.addPlace({ name });
          toast('Place added.');
        }
        editingPlaceId = null;
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  $('#btn-cancel-place-edit')?.addEventListener('click', () => {
    editingPlaceId = null;
    render();
  });

  $$('[data-action="edit-place"]').forEach((btn) =>
    btn.addEventListener('click', () => {
      editingPlaceId = btn.dataset.id;
      render();
    })
  );

  $$('[data-action="delete-place"]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this place?')) return;
      try {
        await Storage.deletePlace(btn.dataset.id);
        toast('Place deleted.');
        render();
      } catch (err) {
        toast(err.message, true);
      }
    })
  );

  const categoryForm = $('#category-form');
  if (categoryForm) {
    categoryForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(categoryForm);
      const name = fd.get('name').trim();
      if (!name) return;
      try {
        if (editingCategoryId) {
          await Storage.updateExpenseCategory(editingCategoryId, { name });
          toast('Category updated.');
        } else {
          await Storage.addExpenseCategory({ name });
          toast('Category added.');
        }
        editingCategoryId = null;
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  $('#btn-cancel-category-edit')?.addEventListener('click', () => {
    editingCategoryId = null;
    render();
  });

  $$('[data-action="edit-category"]').forEach((btn) =>
    btn.addEventListener('click', () => {
      editingCategoryId = btn.dataset.id;
      render();
    })
  );

  $$('[data-action="delete-category"]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this category?')) return;
      try {
        await Storage.deleteExpenseCategory(btn.dataset.id);
        toast('Category deleted.');
        render();
      } catch (err) {
        toast(err.message, true);
      }
    })
  );

  const expenseForm = $('#expense-form');
  if (expenseForm) {
    expenseForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(expenseForm);
      const fields = {
        date: fd.get('date'),
        amount: fd.get('amount'),
        placeId: fd.get('placeId'),
        categoryId: fd.get('categoryId'),
        bankId: fd.get('bankId'),
        notes: fd.get('notes'),
      };
      try {
        if (editingExpenseId) {
          await Storage.updateExpense(editingExpenseId, fields);
          toast('Expense updated.');
        } else {
          await Storage.addExpense(fields);
          toast('Expense added.');
        }
        editingExpenseId = null;
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  $('#btn-cancel-expense-edit')?.addEventListener('click', () => {
    editingExpenseId = null;
    render();
  });

  // Delegated on the stable #expense-rows tbody, not the row buttons
  // themselves — rows are populated later by applyExpenseFilters() (see
  // below), so a direct per-button listener attached here would find none.
  $('#expense-rows')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-action="edit-expense"]');
    if (editBtn) {
      editingExpenseId = editBtn.dataset.id;
      render();
      return;
    }
    const deleteBtn = e.target.closest('[data-action="delete-expense"]');
    if (deleteBtn) {
      if (!confirm('Delete this expense?')) return;
      await Storage.deleteExpense(deleteBtn.dataset.id);
      toast('Expense deleted.');
      render();
    }
  });

  const expenseSearch = $('#filter-expense-search');
  const filterDateFrom = $('#filter-date-from');
  const filterDateTo = $('#filter-date-to');
  const applyExpenseFilters = (resetPage) => {
    if (resetPage) pagination.expenses.page = 1;
    const q = expenseSearch?.value.trim().toLowerCase();
    const from = filterDateFrom?.value;
    const to = filterDateTo?.value;
    const places = Storage.listPlaces();
    const categories = Storage.listExpenseCategories();
    const banks = Storage.listBanks();
    const filtered = Storage.listExpenses().filter((ex) => {
      const matchQ = !q || (ex.notes || '').toLowerCase().includes(q);
      // An empty set is "all" — otherwise it's an OR across the ticked boxes.
      const matchPlace = !expenseFilter.places.size || expenseFilter.places.has(ex.placeId);
      const matchCategory = !expenseFilter.categories.size || expenseFilter.categories.has(ex.categoryId);
      const matchFrom = !from || ex.date >= from;
      const matchTo = !to || ex.date <= to;
      return matchQ && matchPlace && matchCategory && matchFrom && matchTo;
    });
    // Chart/total reflect the whole filtered set; the table shows one page of it.
    const { pageItems, total, page, totalPages } = paginateList('expenses', filtered);
    const expenseRows = $('#expense-rows');
    if (expenseRows) expenseRows.innerHTML = pageItems.length ? pageItems.map((e) => renderExpenseRow(e, places, categories, banks)).join('') : `<tr><td colspan="7"><div class="empty-state">No expenses match.</div></td></tr>`;
    const bar = $('#expense-pagination');
    if (bar) bar.innerHTML = paginationBar('expenses', total, page, totalPages);
    const overview = $('#expense-overview');
    if (overview) overview.innerHTML = renderExpenseOverviewContent(filtered);
  };
  expenseSearch?.addEventListener('input', () => applyExpenseFilters(true));
  filterDateFrom?.addEventListener('change', () => applyExpenseFilters(true));
  filterDateTo?.addEventListener('change', () => applyExpenseFilters(true));

  // Each .multiselect is rebuilt by render(), so its listeners go with it — only
  // the document-level outside-click/Escape pair (bound once at init) persists.
  $$('.multiselect').forEach((ms) => {
    const selected = expenseFilter[ms.dataset.ms];
    const panel = $('.ms-panel', ms);
    const toggle = $('.ms-toggle', ms);
    toggle.addEventListener('click', () => {
      const wasOpen = !panel.hidden;
      closeMultiSelects();
      if (wasOpen) return;
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
    });
    panel.addEventListener('change', (e) => {
      const cb = e.target.closest('input[type="checkbox"]');
      if (!cb) return;
      if (cb.checked) selected.add(cb.value);
      else selected.delete(cb.value);
      syncMultiSelect(ms);
      applyExpenseFilters(true);
    });
    $('.ms-clear', ms).addEventListener('click', () => {
      selected.clear();
      $$('input[type="checkbox"]', panel).forEach((cb) => (cb.checked = false));
      syncMultiSelect(ms);
      applyExpenseFilters(true);
    });
  });

  // Delegated on the stable #expense-overview container (not the toggle
  // buttons themselves — applyExpenseFilters replaces their innerHTML on
  // every filter change, which would detach a listener bound directly to them).
  $('#expense-overview')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-breakdown]');
    if (!btn) return;
    expenseBreakdownBy = btn.dataset.breakdown;
    applyExpenseFilters();
  });

  if ($('#expense-overview')) applyExpenseFilters();

  const settingsRatesForm = $('#settings-rates-form');
  settingsRatesForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(settingsRatesForm);
    try {
      await Storage.updateSettings({ rates: { USD: fd.get('USD'), EUR: fd.get('EUR') } });
      toast('Currency rates updated.');
      render();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Fires once per Settings visit, purely to populate the reference labels —
  // never touches the saved rate or the input values themselves.
  for (const currency of ['USD', 'EUR']) {
    const label = $(`#live-rate-${currency}`);
    if (!label) continue;
    fetchLiveRate(currency).then((rate) => {
      const el = $(`#live-rate-${currency}`); // re-query: view may have re-rendered by the time this resolves
      if (!el) return;
      el.textContent = rate != null ? `(live: ${rate.toFixed(2)})` : '(live rate unavailable)';
    });
  }

  $('#btn-settings-new')?.addEventListener('click', async () => {
    try {
      await Storage.createNew();
      toast('Switched to a new loan table.');
      updateStorageModeFooter();
      render();
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, true);
    }
  });

  $('#btn-settings-open')?.addEventListener('click', async () => {
    try {
      await Storage.openExisting();
      toast('Switched loan table.');
      updateStorageModeFooter();
      render();
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, true);
    }
  });

  $('#btn-export-json')?.addEventListener('click', () => downloadFile('loan-table.json', Storage.exportJSON(), 'application/json'));
  $('#btn-export-csv')?.addEventListener('click', () => downloadFile('transactions.csv', Storage.exportCSV(), 'text/csv'));
  $('#import-json')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      await Storage.importJSON(text);
      toast('Data imported.');
      render();
    } catch (err) {
      toast('Invalid JSON file.', true);
    }
  });

  // Shared across every paginated table (data-page-key names the slot in the
  // `pagination` state). Tables with a live filter re-run that filter's
  // apply function so rows/chart stay in sync; the rest just re-render.
  const refreshAfterPagination = (key) => {
    if (key === 'transactions') applyFilters();
    else if (key === 'banks') applyBankFilters();
    else if (key === 'assets') applyAssetFilters();
    else if (key === 'expenses') applyExpenseFilters();
    else render();
  };

  // Delegated on each pagination bar's own wrapper (not #view-root — that
  // node persists across every render() call, so a listener bound there
  // would re-attach on every render() and accumulate instead of replacing).
  // Each wrapper below is recreated fresh whenever its view (re)renders —
  // for transactions/banks/expenses that also includes every live-filter
  // innerHTML swap, which is exactly what orphaned a directly-bound listener.
  ['tx-pagination', 'profile-pagination', 'bank-pagination', 'bankDetail-pagination', 'asset-pagination', 'expense-pagination'].forEach((id) => {
    const bar = $(`#${id}`);
    if (!bar) return;
    bar.addEventListener('change', (e) => {
      const sel = e.target.closest('.pagination-size');
      if (!sel) return;
      const key = sel.dataset.pageKey;
      pagination[key].pageSize = Number(sel.value);
      pagination[key].page = 1;
      refreshAfterPagination(key);
    });
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-page-action]');
      if (!btn) return;
      const key = btn.dataset.pageKey;
      pagination[key].page += btn.dataset.pageAction === 'next' ? 1 : -1;
      if (pagination[key].page < 1) pagination[key].page = 1;
      refreshAfterPagination(key);
    });
  });
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ---------------- Init ----------------

function closeMobileSidebar() {
  $('#sidebar')?.classList.remove('open');
  $('#sidebar-backdrop')?.classList.remove('open');
}

document.addEventListener('DOMContentLoaded', () => {
  $$('nav button').forEach((btn) =>
    btn.addEventListener('click', () => {
      setView(btn.dataset.view);
      closeMobileSidebar();
    })
  );
  $('#btn-sidebar-toggle')?.addEventListener('click', () => {
    $('#sidebar')?.classList.toggle('open');
    $('#sidebar-backdrop')?.classList.toggle('open');
  });
  $('#sidebar-backdrop')?.addEventListener('click', closeMobileSidebar);
  // Bound once, not per render: a click inside the dropdown reaches here too,
  // hence the .multiselect check — otherwise opening one would shut it again.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.multiselect')) closeMultiSelects();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMultiSelects();
  });
  boot();
});
