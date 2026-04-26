/**
 * sheets.js — Google Sheets API wrapper for 10xGoals
 *
 * Responsibilities:
 *  - Google Identity Services auth (token-only, never stored to localStorage)
 *  - batchGet for reading all tabs in one round-trip
 *  - append / update for writing rows
 *  - Schema validation and one-click init (tabs + headers + protections + seed)
 *  - ID generation, audit stamping, CSV generation
 *
 * No framework dependencies. Works with plain <script> tags.
 */

// ─── Tab & column definitions ────────────────────────────────────────────────

const TABS = {
  OBJECTIVES: 'Objectives',
  KEY_RESULTS: 'KeyResults',
  CHECK_INS:   'CheckIns',
  META:        '_meta',
};

// Column order MUST match the sheet's header row.
// Changing these requires a schema migration (bump SCHEMA_VERSION in config.js).
const COLS = {
  Objectives: [
    'id','title','description','owner_name','owner_email','team','cycle',
    'status','parent_objective_id','display_order',
    'created_by_name','created_by_email','created_at',
    'updated_by_name','updated_by_email','updated_at',
  ],
  KeyResults: [
    'id','objective_id','title','metric_type',
    'start_value','target_value','current_value','unit','weight',
    'created_by_name','created_by_email','created_at',
    'updated_by_name','updated_by_email','updated_at',
  ],
  CheckIns: [
    'id','key_result_id','date','new_value','confidence','note',
    'checked_in_by_name','checked_in_by_email','created_at',
  ],
  _meta: ['schema_version','last_initialized_at'],
};

// Numeric fields — parsed from string when reading from Sheets
const NUMERIC_FIELDS = new Set([
  'start_value','target_value','current_value','weight',
  'confidence','display_order','new_value',
]);

// ─── Utilities ───────────────────────────────────────────────────────────────

function genId(prefix) {
  const ts  = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${ts}_${rnd}`;
}

function nowISO() {
  return new Date().toISOString();
}

function colLetter(index) {
  // 0 → A, 25 → Z, 26 → AA …
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

function tabRange(tab, includeHeader = true) {
  const cols = COLS[tab];
  return `${tab}!A1:${colLetter(cols.length - 1)}`;
}

// ─── Auth state (memory only — never persisted) ───────────────────────────────

let _tokenClient  = null;
let _accessToken  = null;
let _tokenExpiry  = null;
let _user         = null;           // { name, email, picture }
let _pendingAuth  = [];             // callbacks waiting for a valid token

const Sheets = {

  getUser()  { return _user; },
  isSignedIn() { return !!_user && _isTokenValid(); },

  /**
   * Call once on page load. Resolves when GIS is ready.
   * onSignIn(user) and onError(msg) are called asynchronously later.
   */
  initAuth({ onSignIn, onSignOut, onError }) {
    return new Promise((resolve) => {
      _tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID,
        scope:     CONFIG.SCOPES,
        // hd restricts the Google account picker UI to the domain.
        // Actual enforcement is done via token-side email check below.
        ...(CONFIG.ALLOWED_DOMAIN ? { hd: CONFIG.ALLOWED_DOMAIN } : {}),
        callback: async (response) => {
          if (response.error) {
            onError && onError(_friendlyAuthError(response.error));
            return;
          }
          _accessToken = response.access_token;
          _tokenExpiry = Date.now() + (response.expires_in * 1000);

          try {
            const info = await _fetchUserInfo(_accessToken);

            // Domain enforcement (belt-and-suspenders over hd: param)
            if (CONFIG.ALLOWED_DOMAIN && !info.email.endsWith('@' + CONFIG.ALLOWED_DOMAIN)) {
              _accessToken = null;
              _tokenExpiry = null;
              onError && onError(
                `Only @${CONFIG.ALLOWED_DOMAIN} accounts can access this app.`
              );
              return;
            }

            _user = { name: info.name, email: info.email, picture: info.picture };

            // Flush pending API calls that were waiting for auth
            const pending = [..._pendingAuth];
            _pendingAuth  = [];
            pending.forEach(cb => cb());

            onSignIn && onSignIn(_user);
          } catch (e) {
            onError && onError(e.message);
          }
        },
      });
      resolve();
    });
  },

  /** Trigger the OAuth popup / redirect */
  signIn() {
    _tokenClient.requestAccessToken({ prompt: 'select_account' });
  },

  /** Revoke token and clear local state */
  async signOut() {
    if (_accessToken) {
      google.accounts.oauth2.revoke(_accessToken, () => {});
    }
    _accessToken = null;
    _tokenExpiry = null;
    _user        = null;
  },

  // ─── Data loading ──────────────────────────────────────────────────────────

  /**
   * Load all four tabs in a single batchGet.
   * Returns { Objectives: [...], KeyResults: [...], CheckIns: [...], _meta: [...] }
   * Each record has _rowIndex (1-based sheet row, header = row 1).
   * Throws { type: 'SCHEMA_ERROR', tab, missing } if columns are wrong.
   * Throws { type: 'NOT_INITIALIZED' } if tabs are missing entirely.
   */
  async loadAllData() {
    const ranges = Object.values(TABS).map(tab => `${tab}!A1:${colLetter(COLS[tab].length - 1)}`);

    let data;
    try {
      data = await _sheetsGet(`/values:batchGet?ranges=${ranges.map(encodeURIComponent).join('&ranges=')}`);
    } catch (e) {
      if (e.status === 400 || (e.message && e.message.includes('Unable to parse range'))) {
        throw { type: 'NOT_INITIALIZED', message: 'Sheet tabs not found — click "Initialize Sheet" to set up.' };
      }
      throw e;
    }

    const result = {};

    for (const vr of (data.valueRanges || [])) {
      // Strip sheet name from range string like "'Objectives'!A1:P"
      const tabName = vr.range.split('!')[0].replace(/^'|'$/g, '');
      const rows    = vr.values || [];

      if (rows.length === 0) {
        // Tab exists but is empty — treat as uninitialized
        result[tabName] = [];
        continue;
      }

      // Validate header row
      const expectedCols = COLS[tabName];
      if (expectedCols && tabName !== '_meta') {
        const headerRow = rows[0];
        const missing   = expectedCols.filter((col, i) => headerRow[i] !== col);
        if (missing.length > 0) {
          throw { type: 'SCHEMA_ERROR', tab: tabName, missing,
                  message: `Tab "${tabName}" has unexpected columns. Missing: ${missing.join(', ')}` };
        }
      }

      result[tabName] = rows.slice(1).map((row, i) => _rowToObj(tabName, row, i + 2));
    }

    return result;
  },

  // ─── Write helpers ─────────────────────────────────────────────────────────

  /** Append a new row. Returns the record (same object, no _rowIndex yet). */
  async appendRow(tab, obj) {
    const row   = _objToRow(tab, obj);
    const range = `${tab}!A1`;
    await _sheetsPost(
      `/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values: [row] }
    );
    return obj;
  },

  /** Update an existing row by its _rowIndex. */
  async updateRow(tab, rowIndex, obj) {
    const cols   = COLS[tab];
    const endCol = colLetter(cols.length - 1);
    const range  = `${tab}!A${rowIndex}:${endCol}${rowIndex}`;
    const row    = _objToRow(tab, obj);
    await _sheetsPut(
      `/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      { values: [row] }
    );
  },

  // ─── Schema init ───────────────────────────────────────────────────────────

  /**
   * One-click sheet initialization:
   *  1. Creates missing tabs
   *  2. Writes headers
   *  3. Protects header rows (warning-only so power users can still override)
   *  4. Writes seed data
   *  5. Writes _meta row
   */
  async initializeSheet(user) {
    // 1. Discover existing sheets
    const meta          = await _sheetsGet('?fields=sheets.properties.title,sheets.properties.sheetId');
    const existing      = new Map(meta.sheets.map(s => [s.properties.title, s.properties.sheetId]));
    const tabsToCreate  = Object.values(TABS).filter(t => !existing.has(t));

    // 2. Add missing tabs
    if (tabsToCreate.length > 0) {
      const addRequests = tabsToCreate.map(title => ({ addSheet: { properties: { title } } }));
      const addResult   = await _sheetsBatchUpdate({ requests: addRequests });

      // Capture new sheetIds
      for (const reply of (addResult.replies || [])) {
        if (reply.addSheet) {
          const { title, sheetId } = reply.addSheet.properties;
          existing.set(title, sheetId);
        }
      }
    }

    // 3. Write headers (batchUpdate values)
    const headerData = Object.entries(COLS).map(([tab, cols]) => ({
      range:  `${tab}!A1:${colLetter(cols.length - 1)}1`,
      values: [cols],
    }));
    await _sheetsPost('/values:batchUpdate', { valueInputOption: 'RAW', data: headerData });

    // 4. Protect header rows (warningOnly = true so direct Sheet edits still work)
    const protectRequests = Object.values(TABS).map(tab => ({
      addProtectedRange: {
        protectedRange: {
          range: { sheetId: existing.get(tab), startRowIndex: 0, endRowIndex: 1 },
          description: 'Header row — rename columns via app re-init only',
          warningOnly: true,
        },
      },
    }));
    await _sheetsBatchUpdate({ requests: protectRequests });

    // 5. Seed data
    await _writeSeedData(user);

    // 6. _meta
    await Sheets.appendRow(TABS.META, {
      schema_version:      CONFIG.SCHEMA_VERSION,
      last_initialized_at: nowISO(),
    });
  },

  // ─── CSV export ────────────────────────────────────────────────────────────

  generateCSV(objectives, keyResults, checkIns, cycle) {
    const filteredObjs   = objectives.filter(o => o.cycle === cycle);
    const filteredObjIds = new Set(filteredObjs.map(o => o.id));

    // Include parent objectives even if in a different cycle
    const parentIds = new Set(filteredObjs.map(o => o.parent_objective_id).filter(Boolean));
    const allObjs   = objectives.filter(o => filteredObjIds.has(o.id) || parentIds.has(o.id));
    const allObjIds = new Set(allObjs.map(o => o.id));

    const filteredKRs  = keyResults.filter(kr => allObjIds.has(kr.objective_id));
    const filteredKRIds = new Set(filteredKRs.map(kr => kr.id));
    const filteredCIs  = checkIns.filter(ci => filteredKRIds.has(ci.key_result_id));

    const lines = [];

    const section = (label, cols, rows) => {
      lines.push(_csvRow([label]));
      lines.push(_csvRow(cols));
      rows.forEach(r => lines.push(_csvRow(cols.map(c => r[c] ?? ''))));
      lines.push('');
    };

    section('OBJECTIVES', COLS.Objectives, allObjs);
    section('KEY RESULTS', COLS.KeyResults, filteredKRs);
    section('CHECK-INS',  COLS.CheckIns,   filteredCIs);

    return lines.join('\n');
  },
};

// ─── Private helpers ──────────────────────────────────────────────────────────

function _isTokenValid() {
  return _accessToken && _tokenExpiry && Date.now() < _tokenExpiry - 60_000;
}

async function _fetchUserInfo(token) {
  const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error('Could not fetch your Google profile. Please sign in again.');
  return resp.json();
}

function _friendlyAuthError(code) {
  const map = {
    access_denied:       'Sign-in was cancelled or denied.',
    immediate_failed:    'Could not sign in automatically. Please click "Sign in".',
    popup_blocked:       'Sign-in popup was blocked. Please allow popups for this page.',
    popup_closed_by_user:'Sign-in window was closed before completing. Please try again.',
  };
  return map[code] || `Sign-in error: ${code}`;
}

/** Ensure there's a valid access token, refreshing silently if needed. */
async function _ensureToken() {
  if (_isTokenValid()) return;

  await new Promise((resolve, reject) => {
    const saved = _tokenClient.callback;
    _tokenClient.callback = (response) => {
      _tokenClient.callback = saved;
      if (response.error) {
        reject(new Error(_friendlyAuthError(response.error)));
      } else {
        _accessToken = response.access_token;
        _tokenExpiry = Date.now() + (response.expires_in * 1000);
        resolve();
      }
    };
    _tokenClient.requestAccessToken({ prompt: '' }); // '' = silent if session exists
  });
}

function _baseUrl() {
  return `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}`;
}

async function _request(method, path, body) {
  await _ensureToken();
  const resp = await fetch(_baseUrl() + path, {
    method,
    headers: {
      Authorization:  `Bearer ${_accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const e   = new Error(err.error?.message || `Sheets API error (${resp.status})`);
    e.status  = resp.status;
    throw e;
  }
  return resp.json();
}

const _sheetsGet         = (path)       => _request('GET',  path);
const _sheetsPost        = (path, body) => _request('POST', path, body);
const _sheetsPut         = (path, body) => _request('PUT',  path, body);
const _sheetsBatchUpdate = (body)       => _sheetsPost(':batchUpdate', body);

function _rowToObj(tab, row, rowIndex) {
  const cols = COLS[tab];
  const obj  = { _rowIndex: rowIndex };
  cols.forEach((col, i) => {
    let val = row[i] ?? '';
    if (NUMERIC_FIELDS.has(col)) {
      val = val === '' ? null : Number(val);
    }
    obj[col] = val;
  });
  return obj;
}

function _objToRow(tab, obj) {
  return COLS[tab].map(col => {
    const v = obj[col];
    if (v === null || v === undefined) return '';
    return v;
  });
}

function _csvRow(cells) {
  return cells.map(cell => {
    const s = String(cell ?? '');
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  }).join(',');
}

// ─── Seed data ────────────────────────────────────────────────────────────────

async function _writeSeedData(user) {
  const ts  = nowISO();
  const audit = (extra = {}) => ({
    created_by_name: user.name, created_by_email: user.email, created_at: ts,
    updated_by_name: user.name, updated_by_email: user.email, updated_at: ts,
    ...extra,
  });

  // Sample objectives — realistic but generic enough for any org
  const objSeeds = [
    {
      title: 'Grow core market revenue 30% this cycle',
      description: 'Drive higher throughput and conversion in our primary sales channel.',
      owner_name: user.name, owner_email: user.email,
      team: 'Revenue', cycle: 'Q1 FY27', status: 'on-track', parent_objective_id: '',
    },
    {
      title: 'Launch 2 new product lines',
      description: 'Enter adjacent segments with distinct SKUs and go-to-market plans.',
      owner_name: 'Priya Nair', owner_email: 'priya.n@' + (CONFIG.ALLOWED_DOMAIN || 'example.com'),
      team: 'Product', cycle: 'Q1 FY27', status: 'at-risk', parent_objective_id: '',
    },
    {
      title: 'Reduce average delivery cycle time by 35%',
      description: 'Operational excellence to improve NPS and reduce cost-to-serve.',
      owner_name: 'Arjun Mehta', owner_email: 'arjun.m@' + (CONFIG.ALLOWED_DOMAIN || 'example.com'),
      team: 'Operations', cycle: 'Q1 FY27', status: 'on-track', parent_objective_id: '',
    },
    {
      title: 'Raise customer NPS to 65',
      description: 'Customer delight as a sustainable growth driver.',
      owner_name: 'Sneha Kapoor', owner_email: 'sneha.k@' + (CONFIG.ALLOWED_DOMAIN || 'example.com'),
      team: 'CX', cycle: 'Q1 FY27', status: 'off-track', parent_objective_id: '',
    },
  ];

  const objIds = [];
  for (let i = 0; i < objSeeds.length; i++) {
    const id = genId('obj');
    objIds.push(id);
    await Sheets.appendRow(TABS.OBJECTIVES, { id, display_order: i + 1, ...objSeeds[i], ...audit() });
  }

  // KR seeds — indexed to their parent objective
  const krSeeds = [
    // Obj 0: Revenue
    { objIdx: 0, title: 'Active revenue-generating units per month', metric_type: 'number',     start_value: 8,  target_value: 15, current_value: 11, unit: 'units',   weight: 1 },
    { objIdx: 0, title: 'Conversion rate (lead → close)',           metric_type: 'percentage', start_value: 22, target_value: 30, current_value: 26, unit: '%',       weight: 2 },
    { objIdx: 0, title: 'Repeat / referral customer ratio',         metric_type: 'percentage', start_value: 5,  target_value: 12, current_value: 7,  unit: '%',       weight: 1 },
    // Obj 1: Product lines
    { objIdx: 1, title: 'Line A GTM fully launched',                metric_type: 'boolean',    start_value: 0,  target_value: 1,  current_value: 1,  unit: '',        weight: 1 },
    { objIdx: 1, title: 'Line B SKUs live in catalogue',            metric_type: 'boolean',    start_value: 0,  target_value: 1,  current_value: 0,  unit: '',        weight: 1 },
    { objIdx: 1, title: 'Orders booked across new lines',           metric_type: 'number',     start_value: 0,  target_value: 100,current_value: 34, unit: 'orders',  weight: 2 },
    // Obj 2: Delivery
    { objIdx: 2, title: 'Median delivery TAT',                      metric_type: 'number',     start_value: 32, target_value: 21, current_value: 27, unit: 'days',    weight: 2 },
    { objIdx: 2, title: '% projects delivered on schedule',         metric_type: 'percentage', start_value: 60, target_value: 85, current_value: 72, unit: '%',       weight: 1 },
    // Obj 3: NPS
    { objIdx: 3, title: 'Post-delivery NPS score',                  metric_type: 'number',     start_value: 52, target_value: 65, current_value: 55, unit: 'NPS',     weight: 2 },
    { objIdx: 3, title: 'Survey response rate',                     metric_type: 'percentage', start_value: 30, target_value: 60, current_value: 38, unit: '%',       weight: 1 },
  ];

  const krIds = [];
  for (const seed of krSeeds) {
    const id = genId('kr');
    krIds.push(id);
    const { objIdx, ...rest } = seed;
    await Sheets.appendRow(TABS.KEY_RESULTS, {
      id, objective_id: objIds[objIdx], ...rest, ...audit(),
    });
  }

  // A handful of check-ins to show the history panel
  const ciSeeds = [
    { krIdx: 0, new_value: 9,  confidence: 7, note: 'Slow start but pipeline building',   daysAgo: 20 },
    { krIdx: 0, new_value: 11, confidence: 8, note: 'Month-end push paying off',           daysAgo: 5  },
    { krIdx: 1, new_value: 24, confidence: 6, note: 'Conversion up after team training',   daysAgo: 15 },
    { krIdx: 1, new_value: 26, confidence: 7, note: 'Steady — targeting 28 next week',     daysAgo: 3  },
    { krIdx: 6, new_value: 30, confidence: 5, note: 'Supply delays from vendor',           daysAgo: 12 },
    { krIdx: 6, new_value: 27, confidence: 6, note: 'Better contractor coordination',       daysAgo: 2  },
    { krIdx: 8, new_value: 53, confidence: 5, note: 'Below target — root cause in review', daysAgo: 10 },
    { krIdx: 8, new_value: 55, confidence: 5, note: 'Minor uptick; process changes pending', daysAgo: 1 },
  ];

  for (const ci of ciSeeds) {
    const ciDate = new Date(Date.now() - ci.daysAgo * 86_400_000).toISOString().split('T')[0];
    await Sheets.appendRow(TABS.CHECK_INS, {
      id: genId('ci'),
      key_result_id:       krIds[ci.krIdx],
      date:                ciDate,
      new_value:           ci.new_value,
      confidence:          ci.confidence,
      note:                ci.note,
      checked_in_by_name:  user.name,
      checked_in_by_email: user.email,
      created_at:          nowISO(),
    });
  }
}
