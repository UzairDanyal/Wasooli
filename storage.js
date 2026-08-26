// storage.js — persistence adapter.
// Everything above this file (app.js) talks only to the functions exported
// on window.Storage. Swapping JSON-file storage for a real DB later means
// rewriting this file only; the UI never changes.

const DB_NAME = 'loan-app';
const DB_STORE = 'handles';
const HANDLE_KEY = 'dataFileHandle';
const LOCAL_KEY = 'loan-app-data';

const emptyData = () => ({ profiles: [], banks: [], transactions: [], bankTransactions: [] });

function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---- tiny IndexedDB helper, just enough to remember the file handle ----
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- backend state ----
const supportsFS = 'showOpenFilePicker' in window && window.isSecureContext !== false;
let fileHandle = null;
let mode = supportsFS ? 'fs' : 'local'; // 'fs' | 'local'
let cache = emptyData();

async function ensurePermission(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if ((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

async function readHandle(handle) {
  const file = await handle.getFile();
  const text = await file.text();
  if (!text.trim()) return emptyData();
  try {
    const parsed = JSON.parse(text);
    return { ...emptyData(), ...parsed };
  } catch (e) {
    throw new Error('data.json is not valid JSON — fix or replace it, then reload.');
  }
}

async function writeHandle(handle, data) {
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

function readLocal() {
  const raw = localStorage.getItem(LOCAL_KEY);
  if (!raw) return emptyData();
  try {
    return { ...emptyData(), ...JSON.parse(raw) };
  } catch {
    return emptyData();
  }
}

function writeLocal(data) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
}

// ---- public API ----

// Attempts silent restore (previously granted file handle, or localStorage).
// Permission for a remembered handle resets to 'prompt' after a browser
// restart and re-requesting it requires a user gesture, so this only ever
// checks the current status (queryPermission) — never requests here.
// Returns { connected: boolean, mode, needsReconnect?, fileName? }
async function init() {
  if (!supportsFS) {
    cache = readLocal();
    if (reconcileLoanLinkedBankTx()) await persist();
    return { connected: true, mode: 'local' };
  }
  try {
    const handle = await idbGet(HANDLE_KEY);
    if (handle) {
      const granted = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
      if (granted) {
        fileHandle = handle;
        cache = await readHandle(handle);
        mode = 'fs';
        if (reconcileLoanLinkedBankTx()) await persist();
        return { connected: true, mode: 'fs' };
      }
      fileHandle = handle;
      return { connected: false, mode: 'fs', needsReconnect: true, fileName: handle.name };
    }
  } catch (e) {
    console.warn('Could not restore previous file handle', e);
  }
  return { connected: false, mode: 'fs' };
}

// Re-requests permission for the remembered handle. Must be called from a
// click handler (user gesture) — that's the one thing init() can't do.
async function reconnect() {
  if (!fileHandle) throw new Error('No remembered file to reconnect to.');
  if (!(await ensurePermission(fileHandle))) throw new Error('Permission denied.');
  cache = await readHandle(fileHandle);
  mode = 'fs';
  if (reconcileLoanLinkedBankTx()) await persist();
  return cache;
}

function getFileName() {
  return fileHandle ? fileHandle.name : null;
}

async function openExisting() {
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: 'Loan App data', accept: { 'application/json': ['.json'] } }],
  });
  if (!(await ensurePermission(handle))) throw new Error('Permission denied.');
  fileHandle = handle;
  cache = await readHandle(handle);
  await idbSet(HANDLE_KEY, handle);
  mode = 'fs';
  if (reconcileLoanLinkedBankTx()) await persist();
  return cache;
}

async function createNew() {
  const handle = await window.showSaveFilePicker({
    suggestedName: 'loan-table.json',
    types: [{ description: 'Loan App data', accept: { 'application/json': ['.json'] } }],
  });
  if (!(await ensurePermission(handle))) throw new Error('Permission denied.');
  fileHandle = handle;
  cache = emptyData();
  await writeHandle(handle, cache);
  await idbSet(HANDLE_KEY, handle);
  mode = 'fs';
  return cache;
}

async function forget() {
  await idbDelete(HANDLE_KEY);
  fileHandle = null;
}

async function persist() {
  if (mode === 'fs' && fileHandle) {
    await writeHandle(fileHandle, cache);
  } else {
    writeLocal(cache);
  }
}

function getMode() {
  return mode;
}

// -- Profiles --
function listProfiles() {
  return [...cache.profiles].sort((a, b) => a.name.localeCompare(b.name));
}

async function addProfile({ name, contact, email }) {
  const profile = { id: genId(), name: name.trim(), contact: contact?.trim() || '', email: email?.trim() || '', createdAt: new Date().toISOString() };
  cache.profiles.push(profile);
  await persist();
  return profile;
}

async function updateProfile(id, fields) {
  const p = cache.profiles.find((p) => p.id === id);
  if (!p) throw new Error('Profile not found');
  Object.assign(p, fields);
  await persist();
  return p;
}

async function deleteProfile(id) {
  const inUse = cache.transactions.some((t) => t.profileId === id);
  if (inUse) throw new Error('Cannot delete a profile that has transactions. Delete their transactions first.');
  cache.profiles = cache.profiles.filter((p) => p.id !== id);
  await persist();
}

// -- Banks --
function listBanks() {
  return [...cache.banks].sort((a, b) => a.name.localeCompare(b.name));
}

async function addBank({ name }) {
  const bank = { id: genId(), name: name.trim(), createdAt: new Date().toISOString() };
  cache.banks.push(bank);
  await persist();
  return bank;
}

async function updateBank(id, { name }) {
  const b = cache.banks.find((b) => b.id === id);
  if (!b) throw new Error('Bank not found');
  b.name = name.trim();
  await persist();
  return b;
}

async function deleteBank(id) {
  const inUse = cache.bankTransactions.some((bt) => bt.bankId === id);
  if (inUse) throw new Error('Cannot delete a bank with existing transactions. Remove them first.');
  cache.banks = cache.banks.filter((b) => b.id !== id);
  await persist();
}

// -- Bank ledger --
// Positive => money in. Negative => money out.
function bankDelta(type, amount) {
  if (type === 'deposit' || type === 'transfer_in' || type === 'loan_in') return amount;
  if (type === 'withdrawal' || type === 'transfer_out' || type === 'loan_out') return -amount;
  return 0;
}

// Which way a loan transaction moves cash through the bank it's tagged with.
function bankTxTypeForLoan(loanType) {
  if (loanType === 'lent' || loanType === 'repayment_made') return 'loan_out';
  if (loanType === 'borrowed' || loanType === 'repayment_received') return 'loan_in';
  return null;
}

function removeLinkedBankTx(loanTxId) {
  cache.bankTransactions = cache.bankTransactions.filter((bt) => bt.linkedLoanTxId !== loanTxId);
}

function addLinkedBankTx(loanTx) {
  if (!loanTx.bankId) return;
  const type = bankTxTypeForLoan(loanTx.type);
  if (!type) return;
  cache.bankTransactions.push({
    id: genId(),
    bankId: loanTx.bankId,
    date: loanTx.date,
    type,
    amount: loanTx.amount,
    notes: loanTx.notes || '',
    linkedLoanTxId: loanTx.id,
    linkedTransferId: null,
    createdAt: new Date().toISOString(),
  });
}

// Backfills bank-ledger entries for loan transactions that had a bankId set
// before this feature existed (or came from an import). Returns true if it
// added anything, so the caller knows whether to persist.
function reconcileLoanLinkedBankTx() {
  const linkedIds = new Set(cache.bankTransactions.filter((bt) => bt.linkedLoanTxId).map((bt) => bt.linkedLoanTxId));
  let changed = false;
  for (const tx of cache.transactions) {
    if (tx.bankId && !linkedIds.has(tx.id)) {
      addLinkedBankTx(tx);
      changed = true;
    }
  }
  return changed;
}

function listBankTransactions(bankId) {
  return cache.bankTransactions
    .filter((bt) => bt.bankId === bankId)
    .sort((a, b) => new Date(b.date) - new Date(a.date) || b.createdAt.localeCompare(a.createdAt));
}

function getBankBalance(bankId) {
  return cache.bankTransactions
    .filter((bt) => bt.bankId === bankId)
    .reduce((sum, bt) => sum + bankDelta(bt.type, bt.amount), 0);
}

function getAllBankBalances() {
  return cache.banks.map((b) => ({ bank: b, balance: getBankBalance(b.id) }));
}

async function addBankDeposit({ bankId, date, amount, notes }) {
  const entry = {
    id: genId(),
    bankId,
    date,
    type: 'deposit',
    amount: Number(amount),
    notes: notes?.trim() || '',
    linkedLoanTxId: null,
    linkedTransferId: null,
    createdAt: new Date().toISOString(),
  };
  cache.bankTransactions.push(entry);
  await persist();
  return entry;
}

async function addBankWithdrawal({ bankId, date, amount, notes }) {
  const entry = {
    id: genId(),
    bankId,
    date,
    type: 'withdrawal',
    amount: Number(amount),
    notes: notes?.trim() || '',
    linkedLoanTxId: null,
    linkedTransferId: null,
    createdAt: new Date().toISOString(),
  };
  cache.bankTransactions.push(entry);
  await persist();
  return entry;
}

async function transferFunds({ fromBankId, toBankId, date, amount, notes }) {
  if (fromBankId === toBankId) throw new Error('Choose two different banks to transfer between.');
  const linkedTransferId = genId();
  const trimmedNotes = notes?.trim() || '';
  const amt = Number(amount);
  cache.bankTransactions.push(
    { id: genId(), bankId: fromBankId, date, type: 'transfer_out', amount: amt, notes: trimmedNotes, linkedLoanTxId: null, linkedTransferId, createdAt: new Date().toISOString() },
    { id: genId(), bankId: toBankId, date, type: 'transfer_in', amount: amt, notes: trimmedNotes, linkedLoanTxId: null, linkedTransferId, createdAt: new Date().toISOString() }
  );
  await persist();
}

async function deleteBankTransaction(id) {
  const entry = cache.bankTransactions.find((bt) => bt.id === id);
  if (!entry) return;
  if (entry.linkedLoanTxId) throw new Error('This entry is linked to a loan transaction — edit or delete it from the Transactions tab.');
  if (entry.linkedTransferId) {
    cache.bankTransactions = cache.bankTransactions.filter((bt) => bt.linkedTransferId !== entry.linkedTransferId);
  } else {
    cache.bankTransactions = cache.bankTransactions.filter((bt) => bt.id !== id);
  }
  await persist();
}

// -- Transactions --
function listTransactions() {
  return [...cache.transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function addTransaction({ date, amount, profileId, type, bankId, notes }) {
  const tx = {
    id: genId(),
    date,
    amount: Number(amount),
    profileId,
    type, // 'lent' | 'borrowed' | 'repayment_received' | 'repayment_made'
    bankId: bankId || null,
    notes: notes?.trim() || '',
    createdAt: new Date().toISOString(),
  };
  cache.transactions.push(tx);
  addLinkedBankTx(tx);
  await persist();
  return tx;
}

async function updateTransaction(id, { date, amount, profileId, type, bankId, notes }) {
  const tx = cache.transactions.find((t) => t.id === id);
  if (!tx) throw new Error('Transaction not found');
  Object.assign(tx, {
    date,
    amount: Number(amount),
    profileId,
    type,
    bankId: bankId || null,
    notes: notes?.trim() || '',
  });
  removeLinkedBankTx(id);
  addLinkedBankTx(tx);
  await persist();
  return tx;
}

async function deleteTransaction(id) {
  cache.transactions = cache.transactions.filter((t) => t.id !== id);
  removeLinkedBankTx(id);
  await persist();
}

// -- Balances --
// Positive => profile owes the user. Negative => user owes the profile.
function getBalance(profileId) {
  return cache.transactions
    .filter((t) => t.profileId === profileId)
    .reduce((sum, t) => {
      if (t.type === 'lent') return sum + t.amount;
      if (t.type === 'repayment_received') return sum - t.amount;
      if (t.type === 'borrowed') return sum - t.amount;
      if (t.type === 'repayment_made') return sum + t.amount;
      return sum;
    }, 0);
}

function getAllBalances() {
  return cache.profiles.map((p) => ({ profile: p, balance: getBalance(p.id) }));
}

function exportJSON() {
  return JSON.stringify(cache, null, 2);
}

function exportCSV() {
  const rows = [['Date', 'Profile', 'Type', 'Amount', 'Bank', 'Notes']];
  for (const t of listTransactions()) {
    const profile = cache.profiles.find((p) => p.id === t.profileId);
    const bank = cache.banks.find((b) => b.id === t.bankId);
    rows.push([
      t.date,
      profile ? profile.name : '',
      t.type,
      t.amount,
      bank ? bank.name : '',
      (t.notes || '').replace(/"/g, '""'),
    ]);
  }
  return rows.map((r) => r.map((cell) => `"${cell}"`).join(',')).join('\n');
}

async function importJSON(jsonText) {
  const parsed = JSON.parse(jsonText);
  cache = { ...emptyData(), ...parsed };
  reconcileLoanLinkedBankTx();
  await persist();
  return cache;
}

window.Storage = {
  supportsFS,
  init,
  openExisting,
  createNew,
  reconnect,
  forget,
  getMode,
  getFileName,
  listProfiles,
  addProfile,
  updateProfile,
  deleteProfile,
  listBanks,
  addBank,
  updateBank,
  deleteBank,
  listBankTransactions,
  getBankBalance,
  getAllBankBalances,
  addBankDeposit,
  addBankWithdrawal,
  transferFunds,
  deleteBankTransaction,
  listTransactions,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  getBalance,
  getAllBalances,
  exportJSON,
  exportCSV,
  importJSON,
};
