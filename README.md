# Wasooli Bhai — Loan Tracker

A browser-based app for tracking money lent to and borrowed from people you know — no server, no account, no cloud. Data is stored as a single JSON file on your own machine (or in browser local storage as a fallback).

## Status

Early stage, single-user, local-only. Broader plan / roadmap to be added as the project grows — this document tracks what's actually implemented today.

## Tech stack

- Plain HTML/CSS/JS, no framework, no build step
- [storage.js](storage.js) — persistence layer (File System Access API + IndexedDB for the file handle, or `localStorage` fallback)
- [app.js](app.js) — UI rendering and event handling, talks only to `window.Storage`
- [index.html](index.html) / [style.css](style.css) — shell and styling

## Features

### Storage & data connection
- On first load, choose to **create a new loan table** (JSON file) or **open an existing one** via the browser's native file picker (File System Access API — Chrome/Edge/Brave)
- Previously connected file is **remembered** across sessions (handle stored in IndexedDB) and silently reconnected on reload, with permission re-confirmation
- **Automatic fallback** to browser `localStorage` on browsers without File System Access API support (e.g. Firefox, Safari)
- All writes are auto-persisted immediately after every change — no manual save step

### Dashboard
- Net balance summary: **Owed to you**, **You owe**, **Net position**
- Per-person balance cards showing who owes you, who you owe, and who's settled up

### Profiles (people)
- Add / edit / delete profiles with name, contact, and email
- Delete is blocked if the profile has existing transactions (must remove those first)
- Per-profile running balance shown in the profiles table

### Banks (accounts)
- Add / edit / delete named accounts/banks (e.g. "HBL", "Meezan", "Cash") used to tag which account a transaction went through
- Delete is blocked if the bank is referenced by existing transactions

### Transactions
- Log a transaction with: date, amount, profile, type, bank (optional), notes (optional)
- Four transaction types:
  - **Lent** — you gave money
  - **Borrowed** — you received money
  - **Repayment received** — they paid you back
  - **Repayment made** — you paid them back
- Edit or delete any transaction
- Filter transaction list by profile and/or type
- Balances are computed automatically from transaction history (no manual balance entry)

### Export & backup
- **Download JSON** — full data snapshot
- **Download CSV** — transaction list (date, profile, type, amount, bank, notes)
- **Import JSON** — restore/replace data from a JSON file (available in local-storage mode)

### Other
- Toast notifications for success/error feedback
- Confirmation prompts before destructive actions (delete transaction/profile/bank)
- HTML-escaping on all rendered user input (XSS-safe rendering)

## Data model

Stored as one JSON object with three arrays: `profiles`, `banks`, `transactions`. See [storage.js](storage.js) for the exact shape.

## Running locally

```bash
python3 -m http.server 8934
```
Then open `http://localhost:8934` (also configured in `.claude/launch.json` for local debugging).

## Not yet implemented

- Multi-user / auth / cloud sync
- Interest calculation or due dates
- Search
- Mobile-specific UI
