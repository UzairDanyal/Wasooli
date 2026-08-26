// app.js — UI only. All persistence goes through window.Storage (storage.js).

const TYPE_LABELS = {
  lent: 'Lent',
  borrowed: 'Borrowed',
  repayment_received: 'Repayment received',
  repayment_made: 'Repayment made',
};

const money = (n) => {
  const abs = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '-' : ''}${abs}`;
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let currentView = 'dashboard';
let editingTxId = null;
let editingProfileId = null;
let editingBankId = null;

function optionsHtml(items, selectedId) {
  return items.map((i) => `<option value="${i.id}" ${i.id === selectedId ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
}

function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  document.body.appendChild(el);
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
      <h1>Loan Tracker</h1>
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
        <h1>Loan Tracker</h1>
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
      <h1>Loan Tracker</h1>
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
  render();
}

function updateStorageModeFooter() {
  const fileName = Storage.getFileName?.();
  $('#storage-mode').textContent =
    Storage.getMode() === 'fs' ? `Saving to ${fileName || 'local file'}` : 'Saving to browser storage';
}

// ---------------- Navigation ----------------

function setView(view) {
  currentView = view;
  editingTxId = null;
  editingProfileId = null;
  editingBankId = null;
  $$('nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  render();
}

function render() {
  const main = $('#view-root');
  if (currentView === 'dashboard') main.innerHTML = renderDashboard();
  else if (currentView === 'transactions') main.innerHTML = renderTransactions();
  else if (currentView === 'profiles') main.innerHTML = renderProfiles();
  else if (currentView === 'banks') main.innerHTML = renderBanks();
  else if (currentView === 'export') main.innerHTML = renderExport();
  else if (currentView === 'settings') main.innerHTML = renderSettings();
  attachViewHandlers();
}

// ---------------- Dashboard ----------------

function renderDashboard() {
  const balances = Storage.getAllBalances();
  const owedToMe = balances.filter((b) => b.balance > 0).reduce((s, b) => s + b.balance, 0);
  const iOwe = balances.filter((b) => b.balance < 0).reduce((s, b) => s + -b.balance, 0);

  const cards = balances.length
    ? balances
        .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
        .map(({ profile, balance }) => {
          const cls = balance > 0.004 ? 'owes-me' : balance < -0.004 ? 'i-owe' : 'settled';
          const status = balance > 0.004 ? 'owes you' : balance < -0.004 ? 'you owe' : 'settled up';
          return `
          <div class="balance-card ${cls}">
            <div class="name">${esc(profile.name)}</div>
            <div class="amount">${money(Math.abs(balance))}</div>
            <div class="status">${status}</div>
          </div>`;
        })
        .join('')
    : `<div class="empty-state">No profiles yet. Add one in the Profiles tab.</div>`;

  return `
    <div class="view">
      <h2>Dashboard</h2>
      <p class="view-sub">Net balances across everyone you lend to or borrow from.</p>
      <div class="summary-row">
        <div class="summary-card green"><div class="label">Owed to you</div><div class="value">${money(owedToMe)}</div></div>
        <div class="summary-card red"><div class="label">You owe</div><div class="value">${money(iOwe)}</div></div>
        <div class="summary-card"><div class="label">Net position</div><div class="value">${money(owedToMe - iOwe)}</div></div>
      </div>
      <div class="balance-grid">${cards}</div>
    </div>`;
}

// ---------------- Transactions ----------------

function renderTransactions() {
  const profiles = Storage.listProfiles();
  const banks = Storage.listBanks();
  const txs = Storage.listTransactions();
  const editingTx = editingTxId ? txs.find((t) => t.id === editingTxId) : null;

  const profileOptions = optionsHtml(profiles, editingTx?.profileId);
  const bankOptions = optionsHtml(banks, editingTx?.bankId);

  const filterProfileOptions = `<option value="">All profiles</option>` + profiles.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  const filterTypeOptions =
    `<option value="">All types</option>` +
    Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

  const rows = txs.length
    ? txs
        .map((t) => {
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
              <button class="btn btn-sm" data-action="edit-tx" data-id="${t.id}">Edit</button>
              <button class="btn btn-sm btn-danger" data-action="delete-tx" data-id="${t.id}">Delete</button>
            </td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="7"><div class="empty-state">No transactions yet.</div></td></tr>`;

  return `
    <div class="view">
      <h2>Transactions</h2>
      <p class="view-sub">Every lend, borrow, and repayment.</p>

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
          <button class="btn btn-primary" type="submit" ${profiles.length ? '' : 'disabled'}>${editingTx ? 'Save changes' : 'Add transaction'}</button>
          ${editingTx ? '<button type="button" class="btn" id="btn-cancel-tx-edit">Cancel</button>' : ''}
        </form>
      </div>

      <div class="filters">
        <select id="filter-profile">${filterProfileOptions}</select>
        <select id="filter-type">${filterTypeOptions}</select>
      </div>

      <div class="card">
        <table>
          <thead><tr><th>Date</th><th>Profile</th><th>Type</th><th>Amount</th><th>Bank</th><th>Notes</th><th></th></tr></thead>
          <tbody id="tx-rows">${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ---------------- Profiles ----------------

function renderProfiles() {
  const profiles = Storage.listProfiles();
  const editingProfile = editingProfileId ? profiles.find((p) => p.id === editingProfileId) : null;
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
              <button class="btn btn-sm" data-action="edit-profile" data-id="${p.id}">Edit</button>
              <button class="btn btn-sm btn-danger" data-action="delete-profile" data-id="${p.id}">Delete</button>
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
          <button class="btn btn-primary" type="submit">${editingProfile ? 'Save changes' : 'Add profile'}</button>
          ${editingProfile ? '<button type="button" class="btn" id="btn-cancel-profile-edit">Cancel</button>' : ''}
        </form>
      </div>

      <div class="card">
        <table>
          <thead><tr><th>Name</th><th>Contact</th><th>Email</th><th>Balance</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ---------------- Banks ----------------

function renderBanks() {
  const banks = Storage.listBanks();
  const editingBank = editingBankId ? banks.find((b) => b.id === editingBankId) : null;
  const rows = banks.length
    ? banks
        .map(
          (b) => `
          <tr>
            <td>${esc(b.name)}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-sm" data-action="edit-bank" data-id="${b.id}">Edit</button>
              <button class="btn btn-sm btn-danger" data-action="delete-bank" data-id="${b.id}">Delete</button>
            </td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="2"><div class="empty-state">No banks yet.</div></td></tr>`;

  return `
    <div class="view">
      <h2>Banks</h2>
      <p class="view-sub">Accounts used to send or receive money — picked from a dropdown when logging a transaction.</p>

      <div class="card" style="margin-bottom:20px;">
        <form id="bank-form">
          <div class="form-grid">
            <div class="field"><label>Bank name</label><input type="text" name="name" required placeholder="e.g. HBL, Meezan, Cash" value="${editingBank ? esc(editingBank.name) : ''}"></div>
          </div>
          <button class="btn btn-primary" type="submit">${editingBank ? 'Save changes' : 'Add bank'}</button>
          ${editingBank ? '<button type="button" class="btn" id="btn-cancel-bank-edit">Cancel</button>' : ''}
        </form>
      </div>

      <div class="card">
        <table>
          <thead><tr><th>Name</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
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

  $$('[data-action="edit-tx"]').forEach((btn) =>
    btn.addEventListener('click', () => {
      editingTxId = btn.dataset.id;
      render();
    })
  );

  $$('[data-action="delete-tx"]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this transaction?')) return;
      await Storage.deleteTransaction(btn.dataset.id);
      toast('Transaction deleted.');
      render();
    })
  );

  const filterProfile = $('#filter-profile');
  const filterType = $('#filter-type');
  const applyFilters = () => {
    const pid = filterProfile?.value;
    const type = filterType?.value;
    $$('#tx-rows tr[data-id]').forEach((row) => {
      const id = row.dataset.id;
      const tx = Storage.listTransactions().find((t) => t.id === id);
      if (!tx) return;
      const matchP = !pid || tx.profileId === pid;
      const matchT = !type || tx.type === type;
      row.style.display = matchP && matchT ? '' : 'none';
    });
  };
  filterProfile?.addEventListener('change', applyFilters);
  filterType?.addEventListener('change', applyFilters);

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

  $$('[data-action="edit-bank"]').forEach((btn) =>
    btn.addEventListener('click', () => {
      editingBankId = btn.dataset.id;
      render();
    })
  );

  $$('[data-action="delete-bank"]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this bank?')) return;
      try {
        await Storage.deleteBank(btn.dataset.id);
        toast('Bank deleted.');
        render();
      } catch (err) {
        toast(err.message, true);
      }
    })
  );

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

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ---------------- Init ----------------

document.addEventListener('DOMContentLoaded', () => {
  $$('nav button').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));
  boot();
});
