# 10xGoals — OKR Tracker on Google Sheets

A lightweight OKR tracker for teams of 10–100 people. No backend. No database. No hosting costs. Google Sheets is the database. Google Apps Script is the server. Your team's Google account is the login.

**Deploy in ~10 minutes. Share a URL. Done.**

---

## What it looks like

> Red navbar · objective cards with progress bars · inline KR check-ins · edit modals for everything

---

## Features

### Objectives
- Create objectives with title, description, owner, team, and a target date (ETA)
- Set status: **On track · At risk · Off track · Done**
- Nest objectives under a parent (for team-level goals under a company-level goal)
- Edit any field at any time via a clean modal
- Progress auto-calculated from Key Results — no manual entry

### Key Results
- Add multiple KRs per objective
- Three metric types: **Number** (e.g. 42 studios), **Percentage** (e.g. 68%), **Boolean** (done / not done)
- Set start, target, and current value — progress bar updates automatically
- Weighted KRs — mark some KRs as more important than others
- Edit KR details at any time

### Check-ins
- Log a new value against any KR on any date
- Add a note to explain the number (blockers, context, momentum)
- Check-in history shown per KR — last 5 entries with dates and author
- Each check-in updates the KR's current value instantly (optimistic update)

### Team & Filters
- Filter objectives by **Team**, **Owner**, or **Status**
- Every write is attributed to the signed-in user (name + email)
- Full audit trail on every row — created by / updated by / timestamps

### Export
- One-click **Export CSV** — downloads all objectives, KRs, and check-ins as a `.csv` file
- Use in Excel, Google Sheets, or slide decks for reviews

### Auth & Access
- Zero login screen — Google handles authentication before the page loads
- Restrict to your Google Workspace domain (e.g. `@yourcompany.com`) or open to any Google account
- Each user's writes are attributed to their Google identity automatically

---

## Tech stack

| Layer | What's used |
|---|---|
| **UI** | Alpine.js (CDN) + Tailwind CSS (CDN) |
| **Font** | Poppins (Google Fonts) |
| **Server** | Google Apps Script |
| **Database** | Google Sheets (4 tabs) |
| **Auth** | Google Workspace SSO (built-in) |
| **Hosting** | Google's servers |
| **Build step** | None |

---

## Two versions

```
10xGoals/
├── apps-script/     ← Recommended. Hosted by Google. ~10 min setup.
└── static-oauth/    ← Alternative. Self-hosted (Netlify/GitHub Pages). ~20 min setup.
```

### `apps-script/` — Recommended
- Hosted entirely on Google's infrastructure
- Auth is automatic — no GCP Console, no OAuth Client ID
- Share by sending a URL
- Setup time: ~10 minutes

### `static-oauth/`
- Deploy to any static host (Netlify, GitHub Pages, Vercel)
- Requires GCP OAuth Client ID setup
- More control over hosting
- Setup time: ~20 minutes

**Start with `apps-script/` unless you have a specific reason to self-host.**

---

## Quick start (Apps Script)

### 1. Create a Google Sheet

Go to [sheets.google.com](https://sheets.google.com) → blank spreadsheet → name it `10xGoals`.

Copy the Sheet ID from the URL:
```
https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID_HERE/edit
```

### 2. Create an Apps Script project

In the Sheet: **Extensions → Apps Script**

### 3. Paste the files

| Apps Script file | Source file |
|---|---|
| `Code.gs` | `apps-script/Code.gs` |
| `index` (HTML) | `apps-script/index.html` |
| `app` (HTML) | `apps-script/app.html` |
| `appsscript.json` | `apps-script/appsscript.json` |

To see `appsscript.json`: **Project Settings → Show manifest file in editor**

### 4. Configure

In `Code.gs`, set two variables:

```javascript
var SPREADSHEET_ID = 'your-sheet-id-here';
var ALLOWED_DOMAIN = 'yourcompany.com'; // or '' for any Google account
```

### 5. Deploy

**Deploy → New deployment → Web app**

- Execute as: `User accessing the web app`
- Who has access: `Anyone in [your domain]`

Copy the URL. Open it. Click **Initialize Sheet**. Done.

---

## Full setup guide

See [`apps-script/SETUP.md`](apps-script/SETUP.md) for step-by-step instructions including local development with `clasp`.

---

## How the data is stored

Four tabs in your Google Sheet:

| Tab | What's in it |
|---|---|
| `Objectives` | id, title, description, owner, team, eta, status, parent_objective_id, display_order, audit fields |
| `KeyResults` | id, objective_id, title, metric_type, start/target/current value, unit, weight, audit fields |
| `CheckIns` | id, key_result_id, date, new_value, note, checked_in_by, created_at |
| `_meta` | schema_version, last_initialized_at |

You can open the Sheet directly to view, audit, or bulk-edit data at any time.

---

## Updating the app

After editing code locally:

1. Paste updated files into Apps Script editor
2. **Deploy → Manage deployments → Edit → New version → Deploy**

The URL stays the same. Users get the new version on next page load.

### Local development with clasp

```bash
npm install -g @google/clasp
clasp login
clasp clone YOUR_SCRIPT_ID   # Script ID from Project Settings
# edit files locally
clasp push
```

---

## Scaling

| Goal | What to change |
|---|---|
| Open to any Google account | `ALLOWED_DOMAIN = ''` in `Code.gs` + `"access": "ANYONE"` in `appsscript.json` |
| Different sheet per team | Each team creates their own Sheet, sets their own `SPREADSHEET_ID`, deploys their own web app |
| Rename the app | Change `APP_NAME` in `Code.gs` |
| Multiple orgs | Fork this repo. Each org configures their own deployment. |

---

## Contributing

Issues and PRs welcome. Keep it simple — no build step, no npm, no framework. The goal is a tool any team can deploy in 10 minutes without a DevOps person.

---

## License

MIT — use freely, modify freely, deploy for your team or your clients.
