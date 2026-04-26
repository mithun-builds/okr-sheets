# 10xGoals — Setup Guide

Single-file OKR tracker backed by Google Sheets. No server. No database. No build step.

---

## Prerequisites

- A Google account (or Google Workspace account for domain-restricted deployments)
- A GitHub account (for hosting on GitHub Pages) — or any static host (Netlify, Vercel, Cloudflare Pages)

---

## Step 1 — Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click **Select a project → New Project**
3. Name it `10xGoals` (or anything you like) → **Create**
4. Make sure the new project is selected in the top dropdown

---

## Step 2 — Enable APIs

1. In the left sidebar: **APIs & Services → Library**
2. Search for **Google Sheets API** → Enable it
3. Search for **Google Identity** (or **Google Identity Services**) — this is loaded via CDN, no separate enable needed, but confirm Sheets API is enabled

---

## Step 3 — Configure the OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. Choose user type:
   - **Internal** → only Google Workspace users in your org can sign in *(recommended for company-wide tools; requires Google Workspace admin)*
   - **External** → any Google account can attempt sign-in *(domain restriction enforced in-app via `ALLOWED_DOMAIN` in config.js)*
3. Fill in:
   - App name: `10xGoals`
   - User support email: your email
   - Developer contact: your email
4. Scopes: click **Add or Remove Scopes** → add `https://www.googleapis.com/auth/spreadsheets`
5. Save and continue through the wizard

> **For External apps:** Google will show a "This app isn't verified" warning to users until you complete Google's verification process. For an internal team, click **Advanced → Go to [app] (unsafe)** to proceed. For production use with external users, complete verification.

---

## Step 4 — Create an OAuth 2.0 Client ID

1. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
2. Application type: **Web application**
3. Name: `10xGoals Web`
4. **Authorized JavaScript origins** — add the exact URL(s) where the app will be hosted:
   - For local testing: `http://localhost:8080` (or whatever port you use)
   - For GitHub Pages: `https://your-username.github.io`
   - For Netlify: `https://your-site-name.netlify.app`
   - For a custom domain: `https://okr.yourcompany.com`

   > ⚠️ No trailing slash. Protocol must match exactly (https vs http).

5. **Authorized redirect URIs** — leave empty (we use the token flow, not redirect flow)
6. Click **Create** → copy the **Client ID** (looks like `xxx.apps.googleusercontent.com`)

---

## Step 5 — Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) → **Blank spreadsheet**
2. Name it `10xGoals OKR Tracker` (or anything)
3. Copy the **Spreadsheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/THIS_IS_YOUR_SHEET_ID/edit
   ```
4. Share the sheet with your team so they can view/edit it directly if needed

> **Tip for teams:** Create the sheet in a **Shared Drive** owned by the org rather than your personal Drive. This way it survives any individual leaving the team.

---

## Step 6 — Configure the App

Open `config.js` in a text editor and fill in your values:

```javascript
const CONFIG = {
  CLIENT_ID:      'PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com',
  SPREADSHEET_ID: 'PASTE_YOUR_SHEET_ID_HERE',
  SCOPES:         'https://www.googleapis.com/auth/spreadsheets',

  // Domain restriction — set to '' to allow any Google account
  ALLOWED_DOMAIN: 'yourcompany.com',   // e.g. 'homelane.com' or ''

  APP_NAME:       '10xGoals',
  SCHEMA_VERSION: '1',
  DEFAULT_CYCLE:  '',   // e.g. 'Q1 FY27' to pre-select on load
  SUGGESTED_CYCLES: ['Q1 FY27', 'Q2 FY27', 'H1 FY27', 'Annual FY27'],
};
```

---

## Step 7 — Initialize the Sheet

1. Open the app (see hosting options below)
2. Sign in with Google
3. You'll see a **"Initialize Sheet"** button — click it
4. The app will:
   - Create 4 tabs: `Objectives`, `KeyResults`, `CheckIns`, `_meta`
   - Write the correct headers
   - Protect the header rows (warning-only)
   - Seed the sheet with sample objectives and KRs
5. Delete the sample data from Google Sheets directly whenever you're ready

---

## Hosting Options

### Option A — GitHub Pages (free, recommended)

```bash
# 1. Create a repo (e.g. "10xgoals")
# 2. Push these files to the repo:
git init
git add .
git commit -m "Initial 10xGoals setup"
git remote add origin https://github.com/YOUR_USERNAME/10xgoals.git
git push -u origin main

# 3. In GitHub repo settings → Pages → Source: Deploy from branch → main → / (root)
# 4. Your app URL: https://YOUR_USERNAME.github.io/10xgoals/
```

Add that URL to the **Authorized JavaScript origins** in Google Cloud (Step 4).

### Option B — Netlify (free tier)

1. Drag-and-drop the project folder onto [netlify.com/drop](https://netlify.com/drop)
2. Netlify gives you a URL like `https://happy-name-12345.netlify.app`
3. Add that URL to **Authorized JavaScript origins** in Google Cloud

### Option C — Local (for development)

```bash
# Python (comes pre-installed on macOS/Linux)
python3 -m http.server 8080

# Then open: http://localhost:8080
```

> ⚠️ **You cannot open `index.html` directly as a `file://` URL** — Google's OAuth requires an `http://` or `https://` origin.

---

## Scalability Notes (for teams beyond your org)

`config.js` is the only file you need to change to deploy this for a different organization:

| Setting | For single org | For multi-org SaaS |
|---|---|---|
| `ALLOWED_DOMAIN` | `'yourcompany.com'` | `''` (allow all Google accounts) |
| `SPREADSHEET_ID` | One shared sheet | Each team creates their own sheet, pastes their ID |
| `CLIENT_ID` | One OAuth client | Can be the same or per-deployment |
| Hosting | One URL | Each team can self-host or use separate Netlify sites |

For true multi-tenant SaaS, each team would:
1. Create their own Google Sheet
2. Deploy their own copy of the app (GitHub Pages takes 2 minutes)
3. Paste their Sheet ID into their copy of `config.js`

No backend required.

---

## Security Notes

- **Access tokens are never stored** — they live in memory only and are cleared on page reload or sign-out
- **Domain restriction** is enforced both client-side (`hd` parameter) and server-side (email check against `ALLOWED_DOMAIN` after token exchange)
- **Header rows are protected** in the sheet (warning-only, so power users can still bulk-edit data rows directly)
- **Audit fields** (`updated_by_name`, `updated_by_email`, `updated_at`) are stamped from the verified OAuth identity — users cannot spoof them through the UI

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Sign-in popup blocked" | Allow popups for the app's domain in your browser |
| "Only @domain accounts" error | You signed in with the wrong Google account |
| "Sheet tabs not found" | Click "Initialize Sheet" — the blank sheet needs tabs created first |
| "Sheets API error 403" | Check that the Google Sheets API is enabled in your Cloud project |
| "Sheets API error 400" | Check that `SPREADSHEET_ID` in config.js is correct (no extra spaces) |
| Columns mismatch error | Someone renamed a header in the sheet — click "Initialize Sheet" to repair |
| OAuth "redirect_uri_mismatch" | The URL in your browser doesn't match what's in Authorized JavaScript Origins |
| Nothing loads after sign-in | Open browser console (F12) — look for API errors, check `CLIENT_ID` |

---

## File Structure

```
10xGoals/
├── index.html    # All markup + Alpine.js directives
├── app.js        # UI logic: views, modals, progress, optimistic updates
├── sheets.js     # Google Sheets API wrapper + auth + seed data
├── config.js     # Your Client ID, Sheet ID, domain — edit this file
└── SETUP.md      # This file
```

No `node_modules`. No build step. No server. Just open the URL.
