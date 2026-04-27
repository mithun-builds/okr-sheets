# okr-sheets

OKR tracker built on Google Sheets — no backend, no database, no hosting costs. Google Sheets is the database. Google Apps Script is the server. Your team's Google account is the login.

**Deploy in ~10 minutes. Share a URL. Done.**

---

## Features

### Objectives
- Create objectives with title, description, owner, team, and a target date (ETA)
- Edit any field at any time via a clean modal
- Progress auto-calculated from Key Results — no manual entry needed
- Filter by **Team** or **Owner**

### Key Results
- Add multiple KRs per objective
- Three metric types: **Number** (e.g. 42 studios), **Percentage** (e.g. 68%), **Boolean** (done / not done)
- Weighted KRs — mark some KRs as more important than others
- KR starts at 0% — progress only moves when a check-in is logged

### Check-ins
- Log a new value against any KR on any date
- Add a note to explain the number (blockers, context, momentum)
- Check-in history shown per KR — last 5 entries with dates and author
- Each check-in updates the KR's current value instantly

### Permissions
- Creator or objective owner can edit and delete their own data
- Ownership inherits down — objective owner can manage all KRs and check-ins under it
- Every write is attributed to the signed-in user (name + email)
- Full audit trail on every row — created by / updated by / timestamps

### Export
- One-click **Export CSV** — downloads all objectives, KRs, and check-ins
- Use in Excel or Google Sheets for end-of-cycle reviews

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

## Quick start

### 1. Create a Google Sheet

Go to [sheets.google.com](https://sheets.google.com) → blank spreadsheet → name it anything you like.

Copy the Sheet ID from the URL:
```
https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID_HERE/edit
```

### 2. Create an Apps Script project

In your Sheet: **Extensions → Apps Script**

### 3. Paste the files

In the Apps Script editor, create the following files and paste the contents from this repo:

| Apps Script file | Source file |
|---|---|
| `Code.gs` | `apps-script/Code.gs` |
| `index` (HTML) | `apps-script/index.html` |
| `app` (HTML) | `apps-script/app.html` |
| `appsscript.json` | `apps-script/appsscript.json` |

> To edit `appsscript.json`: **Project Settings (gear icon) → Show "appsscript.json" manifest file in editor**

### 4. Configure

In `Code.gs`, set these two lines:

```javascript
var SPREADSHEET_ID = 'your-sheet-id-here';   // from the Sheet URL
var ALLOWED_DOMAIN = 'yourcompany.com';       // '' = any Google account
```

### 5. Deploy

**Deploy → New deployment → Web app**

| Setting | Value |
|---|---|
| Execute as | User accessing the web app |
| Who has access | Anyone in your domain (or Anyone) |

Click **Deploy** → authorize → copy the URL.

### 6. Initialize

Open the URL in your browser → click **Initialize Sheet** → sample data loads → share the URL with your team.

---

## Full setup guide

See [`apps-script/SETUP.md`](apps-script/SETUP.md) for detailed instructions, troubleshooting, and local development with `clasp`.

---

## How data is stored

Four tabs are created automatically in your Google Sheet:

| Tab | Contents |
|---|---|
| `Objectives` | id, title, description, owner, team, eta, display_order, audit fields |
| `KeyResults` | id, objective_id, title, metric_type, start / target / current value, unit, weight, audit fields |
| `CheckIns` | id, key_result_id, date, new_value, note, checked_in_by, created_at |
| `_meta` | schema_version, last_initialized_at |

You can open the Sheet directly to view, audit, or bulk-edit data at any time.

---

## Updating after code changes

1. Paste updated files into the Apps Script editor
2. **Deploy → Manage deployments → Edit → New version → Deploy**

The URL stays the same. Users get the new version on their next page load.

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
| Separate instance per team | Each team creates their own Sheet, sets their own `SPREADSHEET_ID`, deploys their own web app |
| Rename the app | Change `APP_NAME` in `Code.gs` |

---

## Contributing

Issues and PRs welcome. The goal is simplicity — no build step, no npm, no framework. Any team should be able to deploy this in 10 minutes without a DevOps person.

---

## License

MIT — use freely, modify freely, deploy for your team or your clients.
