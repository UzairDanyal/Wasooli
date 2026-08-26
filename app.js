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
let editingExpenseId = null;
let editingPlaceId = null;
let editingCategoryId = null;
let expenseBreakdownBy = 'categoryId'; // 'categoryId' | 'placeId'

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
  const fileName = Storage.getFileName?.();
  $('#storage-mode').textContent =
    Storage.getMode() === 'fs' ? `Saving to ${fileName || 'local file'}` : 'Saving to browser storage';
}

// ---------------- Navigation ----------------
// The current view lives in location.hash (e.g. "#banks/dev-b1"), not just
// in-memory state. That way any reload — a stray form submit, F5, a
// bookmark — lands back on the exact page instead of resetting to the
// dashboard; navigation always goes through the hash, never a bare render().

const VALID_VIEWS = ['dashboard', 'transactions', 'profiles', 'banks', 'expenses', 'export', 'settings'];

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
  else if (currentView === 'expenses') main.innerHTML = renderExpenses();
  else if (currentView === 'export') main.innerHTML = renderExport();
  else if (currentView === 'settings') main.innerHTML = renderSettings();
  attachViewHandlers();
}

// ---------------- Dashboard ----------------

function renderDashboard() {
  const balances = Storage.getAllBalances();
  const owedToMe = balances.filter((b) => b.balance > 0).reduce((s, b) => s + b.balance, 0);
  const iOwe = balances.filter((b) => b.balance < 0).reduce((s, b) => s + -b.balance, 0);
  const totalBankBalance = Storage.getAllBankBalances().reduce((s, b) => s + b.balance, 0);
  const thisMonth = todayISO().slice(0, 7);
  const expensesThisMonth = Storage.listExpenses()
    .filter((e) => e.date.slice(0, 7) === thisMonth)
    .reduce((s, e) => s + e.amount, 0);

  const cards = balances.length
    ? balances
        .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
        .map(({ profile, balance }) => {
          const cls = balance > 0.004 ? 'owes-me' : balance < -0.004 ? 'i-owe' : 'settled';
          const status = balance > 0.004 ? 'owes you' : balance < -0.004 ? 'you owe' : 'settled up';
          const remindBtn = balance > 0.004
            ? `<button class="btn btn-sm btn-icon remind-btn" data-action="remind-profile" data-id="${profile.id}" title="Send WhatsApp reminder">${ICON_REMIND}</button>`
            : '';
          return `
          <div class="balance-card ${cls}">
            ${remindBtn}
            <div class="name">${esc(profile.name)}</div>
            <div class="amount" title="${moneyWords(balance)}">${money(Math.abs(balance))}</div>
            <div class="status">${status}</div>
          </div>`;
        })
        .join('')
    : `<div class="empty-state">No profiles yet. Add one in the Profiles tab.</div>`;

  return `
    <div class="view">
      <h2>Dashboard</h2>
      <p class="view-sub">Net balances across everyone you lend to or borrow from.</p>

      <h3 class="dash-section-title">Loan</h3>
      <div class="summary-row">
        <div class="summary-card green" title="Total across everyone who owes you money."><div class="label">Owed to you</div><div class="value" title="${moneyWords(owedToMe)}">${money(owedToMe)}</div></div>
        <div class="summary-card red" title="Total across everyone you owe money to."><div class="label">You owe</div><div class="value" title="${moneyWords(iOwe)}">${money(iOwe)}</div></div>
      </div>
      <div class="balance-grid">${cards}</div>

      <hr class="dash-divider">

      <h3 class="dash-section-title">Bank</h3>
      <div class="summary-row">
        <div class="summary-card" title="Combined balance across all your bank accounts."><div class="label">Bank balance</div><div class="value" title="${moneyWords(totalBankBalance)}">${money(totalBankBalance)}</div></div>
        <div class="summary-card" title="Bank balance + Owed to you − You owe — what you'd be left holding if every loan settled today."><div class="label">Net position</div><div class="value" title="${moneyWords(totalBankBalance + owedToMe - iOwe)}">${money(totalBankBalance + owedToMe - iOwe)}</div></div>
      </div>

      <hr class="dash-divider">

      <h3 class="dash-section-title">Expense</h3>
      <div class="summary-row">
        <div class="summary-card red" title="Total expenses logged so far this calendar month."><div class="label">Expenses this month</div><div class="value" title="${moneyWords(expensesThisMonth)}">${money(expensesThisMonth)}</div></div>
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
  const banks = Storage.listBanks();
  const allTxs = Storage.listTransactions();
  const editingTx = editingTxId ? allTxs.find((t) => t.id === editingTxId) : null;

  const profileOptions = optionsHtml(profiles, editingTx?.profileId);
  const bankOptions = optionsHtml(banks, editingTx?.bankId);

  const filterProfileOptions = `<option value="">All profiles</option>` + profiles.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const filterTypeOptions =
    `<option value="">All types</option>` +
    Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

  const { pageItems: txs, total, page, totalPages } = paginateList('transactions', allTxs);
  const rows = txs.length ? txs.map((t) => renderTxRow(t, profiles, banks)).join('') : `<tr><td colspan="7"><div class="empty-state">No transactions yet.</div></td></tr>`;

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
            <div class="field"><label>Bank</label><select name="bankId"><option value="">— none —</option>${bankOptions}</select></div>
            <div class="field" style="grid-column: 1 / -1;"><label>Notes</label><input type="text" name="notes" placeholder="Optional" value="${editingTx ? esc(editingTx.notes || '') : ''}"></div>
          </div>
          ${submitBtn(!!editingTx, 'Add transaction', !profiles.length)}
          ${editingTx ? '<button type="button" class="btn" id="btn-cancel-tx-edit">Cancel</button>' : ''}
        </form>
      </div>

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
  return `
    <tr data-id="${b.id}">
      <td>${esc(b.name)}</td>
      <td class="${bal > 0.004 ? 'type-borrowed' : bal < -0.004 ? 'type-lent' : ''}">${money(bal)}</td>
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
  const rows = banks.length ? banks.map(renderBankRow).join('') : `<tr><td colspan="3"><div class="empty-state">No banks yet.</div></td></tr>`;

  return `
    <div class="view">
      <h2>Banks</h2>
      <p class="view-sub">Accounts used to send or receive money — each one keeps its own balance and history.</p>

      <div class="card" style="margin-bottom:20px;">
        <form id="bank-form">
          <div class="form-grid">
            <div class="field"><label>Bank name</label><input type="text" name="name" required placeholder="e.g. HBL, Meezan, Cash" value="${editingBank ? esc(editingBank.name) : ''}"></div>
          </div>
          ${submitBtn(!!editingBank, 'Add bank', false)}
          ${editingBank ? '<button type="button" class="btn" id="btn-cancel-bank-edit">Cancel</button>' : ''}
        </form>
      </div>

      <div class="filters">
        <input type="search" id="filter-bank-search" placeholder="Search by bank name...">
      </div>

      <div class="card">
        <table>
          <thead><tr><th>Name</th><th>Balance</th><th></th></tr></thead>
          <tbody id="bank-rows">${rows}</tbody>
        </table>
        <div id="bank-pagination">${paginationBar('banks', total, page, totalPages)}</div>
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
  const otherBanks = Storage.listBanks().filter((b) => b.id !== bankId);
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
            <td class="${colorCls}">${positive ? '+' : '-'}${money(e.amount)}</td>
            <td>${esc(e.notes || '')}${e.linkedLoanTxId ? ' <em>(from loan entry)</em>' : e.linkedExpenseId ? ' <em>(from expense)</em>' : ''}</td>
            <td style="white-space:nowrap;">${e.linkedLoanTxId || e.linkedExpenseId ? '' : `<button class="btn btn-sm btn-icon btn-danger" data-action="delete-bank-tx" data-id="${e.id}" title="Delete entry">${ICON_DELETE}</button>`}</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="5"><div class="empty-state">No activity yet.</div></td></tr>`;

  return `
    <div class="view">
      <button class="btn btn-sm" id="btn-back-to-banks" style="margin-bottom:16px;">&larr; All banks</button>
      <h2>${esc(bank.name)}</h2>
      <p class="view-sub">Balance: <strong>${money(balance)}</strong></p>

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
        <p class="connect-note" style="margin:0 0 12px;">Move money between your own accounts — pick which of your other banks it's going to.</p>
        <form id="bank-transfer-form" data-bank-id="${bankId}">
          <div class="form-grid">
            <div class="field"><label>Date</label><input type="date" name="date" required value="${todayISO()}"></div>
            <div class="field"><label>To bank</label><select name="toBankId" required>${otherBanks.length ? toBankOptions : '<option value="">Add another bank first</option>'}</select></div>
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
  const banks = Storage.listBanks();
  const expenses = Storage.listExpenses();

  const editingPlace = editingPlaceId ? places.find((h) => h.id === editingPlaceId) : null;
  const editingCategory = editingCategoryId ? categories.find((c) => c.id === editingCategoryId) : null;
  const editingExpense = editingExpenseId ? expenses.find((e) => e.id === editingExpenseId) : null;

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
  const bankOptions = optionsHtml(banks, editingExpense?.bankId);
  const canAddExpense = places.length && categories.length;

  const filterPlaceOptions = `<option value="">All places</option>` + places.map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join('');
  const filterCategoryOptions = `<option value="">All categories</option>` + categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

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
            <div class="field"><label>Bank</label><select name="bankId"><option value="">— none —</option>${bankOptions}</select></div>
            <div class="field" style="grid-column: 1 / -1;"><label>Notes</label><input type="text" name="notes" placeholder="Optional" value="${editingExpense ? esc(editingExpense.notes || '') : ''}"></div>
          </div>
          ${submitBtn(!!editingExpense, 'Add expense', !canAddExpense)}
          ${editingExpense ? '<button type="button" class="btn" id="btn-cancel-expense-edit">Cancel</button>' : ''}
        </form>
      </div>

      <div class="filters">
        <input type="search" id="filter-expense-search" placeholder="Search by notes...">
        <select id="filter-place">${filterPlaceOptions}</select>
        <select id="filter-category">${filterCategoryOptions}</select>
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
        ${Storage.getMode() === 'local' ? '<label class="btn" style="margin:0;">Import JSON<input type="file" id="import-json" accept="application/json" class="hidden"></label>' : ''}
      </div>
    </div>`;
}

// ---------------- Settings ----------------

function renderSettings() {
  const mode = Storage.getMode();
  const fileName = Storage.getFileName?.();

  return `
    <div class="view">
      <h2>Settings</h2>
      <p class="view-sub">Manage where your loan data is stored.</p>
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

function attachViewHandlers() {
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
    const url = `https://web.whatsapp.com/send?phone=${number}&text=${encodeURIComponent(reminderMessage(profile.name, balance))}`;
    window.open(url, '_blank', 'noopener');
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
      try {
        if (editingTxId) {
          await Storage.updateTransaction(editingTxId, fields);
          toast('Transaction updated.');
        } else {
          await Storage.addTransaction(fields);
          toast('Transaction added.');
        }
        editingTxId = null;
        render();
      } catch (err) {
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
      if (!name) return;
      try {
        if (editingBankId) {
          await Storage.updateBank(editingBankId, { name });
          toast('Bank updated.');
        } else {
          await Storage.addBank({ name });
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
    if (bankRows) bankRows.innerHTML = pageItems.length ? pageItems.map(renderBankRow).join('') : `<tr><td colspan="3"><div class="empty-state">No banks match.</div></td></tr>`;
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

  $('#btn-back-to-banks')?.addEventListener('click', () => setView('banks'));

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
  const filterPlace = $('#filter-place');
  const filterCategory = $('#filter-category');
  const filterDateFrom = $('#filter-date-from');
  const filterDateTo = $('#filter-date-to');
  const applyExpenseFilters = (resetPage) => {
    if (resetPage) pagination.expenses.page = 1;
    const q = expenseSearch?.value.trim().toLowerCase();
    const placeId = filterPlace?.value;
    const categoryId = filterCategory?.value;
    const from = filterDateFrom?.value;
    const to = filterDateTo?.value;
    const places = Storage.listPlaces();
    const categories = Storage.listExpenseCategories();
    const banks = Storage.listBanks();
    const filtered = Storage.listExpenses().filter((ex) => {
      const matchQ = !q || (ex.notes || '').toLowerCase().includes(q);
      const matchPlace = !placeId || ex.placeId === placeId;
      const matchCategory = !categoryId || ex.categoryId === categoryId;
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
  filterPlace?.addEventListener('change', () => applyExpenseFilters(true));
  filterCategory?.addEventListener('change', () => applyExpenseFilters(true));
  filterDateFrom?.addEventListener('change', () => applyExpenseFilters(true));
  filterDateTo?.addEventListener('change', () => applyExpenseFilters(true));

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
    else if (key === 'expenses') applyExpenseFilters();
    else render();
  };

  // Delegated on each pagination bar's own wrapper (not #view-root — that
  // node persists across every render() call, so a listener bound there
  // would re-attach on every render() and accumulate instead of replacing).
  // Each wrapper below is recreated fresh whenever its view (re)renders —
  // for transactions/banks/expenses that also includes every live-filter
  // innerHTML swap, which is exactly what orphaned a directly-bound listener.
  ['tx-pagination', 'profile-pagination', 'bank-pagination', 'bankDetail-pagination', 'expense-pagination'].forEach((id) => {
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
  boot();
});
