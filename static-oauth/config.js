/**
 * 10xGoals — OKR Tracker Configuration
 *
 * Copy this file to config.local.js for local overrides (gitignored).
 * In production, replace these placeholder values before deploying.
 *
 * Steps to fill this in: see SETUP.md
 */
const CONFIG = {
  // From Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID
  CLIENT_ID: 'YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com',

  // The Google Sheet ID from its URL:
  // https://docs.google.com/spreadsheets/d/THIS_PART_HERE/edit
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID',

  // OAuth scope — spreadsheets gives read+write access to the sheet
  SCOPES: 'https://www.googleapis.com/auth/spreadsheets',

  // Restrict sign-in to a specific Google Workspace domain.
  // Set to '' (empty string) to allow any Google account (open SaaS mode).
  // Set to 'yourcompany.com' to restrict to that domain only.
  ALLOWED_DOMAIN: 'homelane.com',

  // App metadata
  APP_NAME: '10xGoals',
  SCHEMA_VERSION: '1',

  // Default cycle to pre-select if no recent activity is found.
  // Set to '' to prompt users to pick one.
  DEFAULT_CYCLE: '',

  // Cycle suggestions shown in the cycle picker dropdown.
  // These are appended to any cycles found in the sheet.
  SUGGESTED_CYCLES: ['Q1 FY27', 'Q2 FY27', 'Q3 FY27', 'Q4 FY27', 'H1 FY27', 'H2 FY27', 'Annual FY27'],
};
