# 10xGoals — Apps Script Setup Guide

Zero GCP Console setup. No OAuth Client ID. No authorized origins.
Google hosts the app and handles auth automatically.

**Total time: ~10 minutes.**

---

## What you need before starting

- A Google account (or Google Workspace account)
- A blank Google Sheet (you create this in Step 1)
- The files in this folder

---

## Step 1 — Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) → **Blank spreadsheet**
2. Name it `10xGoals OKR Tracker`
3. Copy the **Sheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/THIS_IS_YOUR_SHEET_ID/edit
   ```
4. Keep this tab open — you'll need it in a moment

---

## Step 2 — Create the Apps Script project

**Option A: Bound to the sheet (recommended)**
1. In the Google Sheet, go to **Extensions → Apps Script**
2. This opens the Apps Script editor, already linked to your sheet
3. The script will use your sheet automatically

**Option B: Standalone project**
1. Go to [script.google.com](https://script.google.com) → **New project**
2. You'll need to paste the Sheet ID into `Code.gs` (Step 3)

> Option A is simpler. Option B gives you a project that's not tied to one specific sheet file.

---

## Step 3 — Copy the files in

In the Apps Script editor, you'll see a default file called `Code.gs`.

### 3a. Replace Code.gs

- Click on `Code.gs` in the left sidebar
- Select all and delete the default content
- Paste the contents of `Code.gs` from this folder
- **Edit line 7:** replace `YOUR_SPREADSHEET_ID` with your actual Sheet ID
- **Edit line 8:** set `ALLOWED_DOMAIN` (e.g. `'homelane.com'` or `''` for any Google account)

```javascript
var SPREADSHEET_ID = 'your-sheet-id-here';
var ALLOWED_DOMAIN = 'homelane.com';
```

### 3b. Add index.html

- Click **+** next to "Files" → **HTML**
- Name it `index` (exactly, no extension — Apps Script adds `.html`)
- Delete the default content, paste contents of `index.html` from this folder

### 3c. Add app.html

- Click **+** → **HTML**
- Name it `app`
- Paste contents of `app.html` from this folder

### 3d. Update the manifest

- Click **Project Settings** (gear icon) → check **"Show appsscript.json manifest file in editor"**
- Click on `appsscript.json` in the left sidebar
- Replace its contents with the `appsscript.json` from this folder

> The manifest sets `executeAs: USER_ACCESSING` (script runs as the signed-in user)
> and `access: DOMAIN` (only your Google Workspace domain can use the app).
>
> For open access (any Google account), change `access` to `"ANYONE"`.

---

## Step 4 — Deploy as Web App

1. Click **Deploy → New deployment**
2. Click the gear icon next to "Select type" → choose **Web app**
3. Fill in:
   - Description: `10xGoals v1`
   - Execute as: **User accessing the web app**
   - Who has access: **Anyone in [your domain]**  ← or "Anyone" for open access
4. Click **Deploy**
5. **Authorize** the permissions when prompted (Sheets access + user identity)
6. Copy the **Web app URL** — this is your app's permanent URL

> The URL looks like:
> `https://script.google.com/macros/s/AKfycbxXXXXXX/exec`

---

## Step 5 — Initialize the sheet

1. Open the Web App URL in your browser
2. Sign in with Google if prompted
3. You'll see a **"Initialize Sheet"** button — click it
4. The app creates all tabs, headers, protections, and sample data
5. Done

---

## Step 6 — Share with your team

Just share the URL. That's it.

Anyone in your Google Workspace domain who clicks the link:
- Is automatically authenticated by Google
- Doesn't need to install anything
- Doesn't need to create an account
- Can start using the app immediately

---

## Updating the app (after code changes)

When you change `Code.gs`, `index.html`, or `app.html`:

1. Click **Deploy → Manage deployments**
2. Click the pencil (edit) icon on your deployment
3. Change version to **"New version"**
4. Click **Deploy**

> The URL stays the same. Users don't need to do anything — they'll get
> the new version on their next page load.

---

## Using clasp (optional — for local development with git)

`clasp` lets you edit files locally and push to Apps Script.

```bash
# Install clasp
npm install -g @google/clasp

# Login
clasp login

# Clone your existing project (get Script ID from Project Settings)
clasp clone YOUR_SCRIPT_ID

# After editing locally, push changes
clasp push

# Open the editor in browser
clasp open
```

Add a `.claspignore` to exclude non-script files:
```
SETUP.md
.git/
node_modules/
```

---

## Scaling beyond your org

| Goal | Change |
|---|---|
| Open to any Google account | In `appsscript.json`: `"access": "ANYONE"` |
| Open to any Google account | In `Code.gs`: `ALLOWED_DOMAIN = ''` |
| Different sheet per team | Each team creates their own Sheet, pastes their Sheet ID into their own copy of `Code.gs`, deploys their own web app |
| Rename the app | Change `APP_NAME` in `Code.gs` and `<title>` in `index.html` |

No backend. No hosting costs. Each team self-serves in ~10 minutes.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Could not read your Google identity" | The `executeAs` setting may not have your domain's Workspace licence. Switch to `"USER_DEPLOYING"` in `appsscript.json` and redeploy. |
| "Only @domain accounts" error | You're signed in with the wrong Google account. Open an Incognito window and sign in with the right account. |
| App loads but sheet operations fail | Check that `SPREADSHEET_ID` in `Code.gs` is correct (no spaces, no extra characters). |
| "Tab not found" error | Click "Initialize Sheet" — the blank sheet needs tabs created first. |
| Changes not showing after deploy | You must create a **New version** in Manage Deployments — editing existing code doesn't auto-update. |
| Script runs as wrong user | Check `executeAs` in `appsscript.json`. `USER_ACCESSING` = runs as visitor. `USER_DEPLOYING` = runs as you. |

---

## File structure

```
apps-script/
├── Code.gs          ← server-side JS (edit SPREADSHEET_ID here)
├── index.html       ← HTML template (served by Google)
├── app.html         ← client-side Alpine.js logic
├── appsscript.json  ← deployment manifest
└── SETUP.md         ← this file
```

---

## Comparison with static-oauth version

| | static-oauth/ | apps-script/ |
|---|---|---|
| **Setup time** | ~20 min (GCP Console) | ~10 min (just this guide) |
| **Hosting** | Netlify / GitHub Pages | Google's servers |
| **Auth setup** | OAuth Client ID + authorized origins | One dropdown at deploy time |
| **Share by** | Sharing a URL + adding authorized origin | Sharing the URL alone |
| **Update process** | Push to git / redeploy | New version in Manage Deployments |
| **Local dev** | `python3 -m http.server` | `clasp push` |
