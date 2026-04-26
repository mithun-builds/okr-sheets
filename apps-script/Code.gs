// ─────────────────────────────────────────────────────────────────────────────
// Code.gs — 10xGoals Apps Script backend
//
// Runs on Google's servers. Accesses the Sheet directly via SpreadsheetApp.
// No OAuth tokens. No API keys. No GCP Console setup.
//
// Deployed as a Web App:
//   Execute as: User accessing the web app  (runs as each signed-in user)
//   Who has access: Anyone in [your domain]
// ─────────────────────────────────────────────────────────────────────────────

// ── Config (only thing you edit) ─────────────────────────────────────────────

var SPREADSHEET_ID  = 'YOUR_SPREADSHEET_ID';   // ← paste your Sheet ID here
var ALLOWED_DOMAIN  = 'homelane.com';           // '' = any Google account
var APP_NAME        = '10xGoals';
var SCHEMA_VERSION  = '1';

// (no suggested cycles — objectives use a free-form ETA date instead)

// ── Column definitions (must match sheet headers exactly) ────────────────────

var COLS = {
  Objectives: [
    'id','title','description','owner_name','owner_email','team','eta',
    'status','display_order',
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
    'id','key_result_id','date','new_value','note',
    'checked_in_by_name','checked_in_by_email','created_at',
  ],
  _meta: ['schema_version','last_initialized_at'],
};

var NUMERIC_FIELDS = ['start_value','target_value','current_value','weight',
                      'display_order','new_value'];

// ── Web App entry point ───────────────────────────────────────────────────────

function doGet() {
  return HtmlService
    .createTemplateFromFile('index')
    .evaluate()
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Called from index.html to inline other html files during template evaluation
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function getCurrentUser() {
  var email = Session.getActiveUser().getEmail();

  if (!email) {
    throw new Error('Could not read your Google identity. Make sure you are signed in.');
  }

  if (ALLOWED_DOMAIN && !email.endsWith('@' + ALLOWED_DOMAIN)) {
    throw new Error('Only @' + ALLOWED_DOMAIN + ' accounts can access this app.');
  }

  // Derive display name from email (mithun.s@homelane.com → "Mithun S")
  // Cached in user properties so it can be overridden later
  var props = PropertiesService.getUserProperties();
  var name  = props.getProperty('displayName');

  if (!name) {
    var local = email.split('@')[0];               // "mithun.s"
    name = local
      .split(/[._-]/)                              // split on . _ -
      .map(function(p) {
        return p.charAt(0).toUpperCase() + p.slice(1);
      })
      .join(' ');                                  // "Mithun S"
    props.setProperty('displayName', name);
  }

  return { email: email, name: name };
}

// Allow user to update their display name
function updateDisplayName(name) {
  if (!name || !name.trim()) throw new Error('Name cannot be empty.');
  PropertiesService.getUserProperties().setProperty('displayName', name.trim());
  return name.trim();
}

// ── Data loading ──────────────────────────────────────────────────────────────

function loadAllData() {
  _checkAuth();
  var ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  var result = {};

  for (var tabName in COLS) {
    var sheet = ss.getSheetByName(tabName);

    if (!sheet) {
      // Throw a real Error — plain object throws are serialized as [object Object]
      // by Apps Script's failure handler. Encode type as a pipe-delimited prefix.
      throw new Error('NOT_INITIALIZED|Sheet tabs not found — click "Initialize Sheet" to set up.');
    }

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();

    if (lastRow < 1 || lastCol < 1) {
      result[tabName] = [];
      continue;
    }

    // Use getDisplayValues() — returns everything as strings.
    // getValues() returns Date objects for date-formatted cells; Date objects
    // fail to serialize across the google.script.run bridge and return null.
    var values  = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    var headers = values[0];

    // Validate headers
    if (tabName !== '_meta') {
      var expected = COLS[tabName];
      var missing  = expected.filter(function(col, i) { return headers[i] !== col; });
      if (missing.length > 0) {
        throw new Error('SCHEMA_ERROR|Column mismatch in "' + tabName + '". Re-initialize to repair.');
      }
    }

    result[tabName] = values.slice(1).map(function(row, i) {
      return _rowToObj(headers, row, i + 2);
    });
  }

  Logger.log('loadAllData returning %s objectives, %s KRs, %s check-ins',
    result['Objectives'] ? result['Objectives'].length : 'ERR',
    result['KeyResults'] ? result['KeyResults'].length : 'ERR',
    result['CheckIns']   ? result['CheckIns'].length   : 'ERR');

  return result;
}

// ── Write operations ──────────────────────────────────────────────────────────

function appendRow(tabName, rowData) {
  _checkAuth();
  var sheet   = _getSheet(tabName);
  var headers = _getHeaders(sheet);
  var row     = headers.map(function(h) {
    var v = rowData[h];
    return (v === null || v === undefined) ? '' : v;
  });
  sheet.appendRow(row);
}

function updateRow(tabName, rowIndex, rowData) {
  _checkAuth();
  var sheet   = _getSheet(tabName);
  var headers = _getHeaders(sheet);
  var row     = headers.map(function(h) {
    var v = rowData[h];
    return (v === null || v === undefined) ? '' : v;
  });
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
}

// ── Sheet initialisation ──────────────────────────────────────────────────────

function initializeSheet() {
  _checkAuth();
  var user = getCurrentUser();
  var ss   = SpreadsheetApp.openById(SPREADSHEET_ID);

  // 1. Create any missing tabs and write headers
  for (var tabName in COLS) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) sheet = ss.insertSheet(tabName);

    var cols = COLS[tabName];

    // Write header row
    sheet.getRange(1, 1, 1, cols.length).setValues([cols]);

    // Style header: bold, light grey background
    var headerRange = sheet.getRange(1, 1, 1, cols.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#f3f4f6');

    // Freeze header row
    sheet.setFrozenRows(1);

    // Protect header row (warning-only so power users can still edit)
    var existing = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    if (existing.length === 0) {
      var protection = headerRange.protect();
      protection.setDescription('Header row — do not edit column names');
      protection.setWarningOnly(true);
    }
  }

  // 2. Write seed data
  _writeSeedData(ss, user);

  // 3. Write _meta
  var metaSheet = ss.getSheetByName('_meta');
  metaSheet.appendRow([SCHEMA_VERSION, new Date().toISOString()]);

  // Force all pending sheet writes to commit before loadAllData reads them
  SpreadsheetApp.flush();

  return { success: true };
}

// ── CSV Export ────────────────────────────────────────────────────────────────
// Note: CSV is generated client-side in app.html for speed.
// This function is here if you ever want a server-side download link instead.

function exportCSVData(cycle) {
  _checkAuth();
  var data = loadAllData();
  return {
    objectives: data['Objectives'],
    keyResults: data['KeyResults'],
    checkIns:   data['CheckIns'],
    cycle:      cycle,
  };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _checkAuth() {
  getCurrentUser(); // throws if not signed in or wrong domain
}

function _getSheet(tabName) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(tabName);
  if (!sheet) throw new Error('Tab "' + tabName + '" not found. Re-initialize the sheet.');
  return sheet;
}

function _getHeaders(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function _rowToObj(headers, row, rowIndex) {
  var obj = { _rowIndex: rowIndex };
  headers.forEach(function(h, j) {
    var val = row[j];
    if (NUMERIC_FIELDS.indexOf(h) !== -1) {
      if (val === '' || val === null || val === undefined) {
        val = null;
      } else {
        // getDisplayValues() may return "26%" for percentage-formatted cells;
        // strip the trailing % sign before converting.
        var stripped = String(val).replace(/%$/, '').replace(/,/g, '').trim();
        var n = Number(stripped);
        val = isNaN(n) ? null : n;
      }
    }
    obj[h] = (val === undefined) ? '' : val;
  });
  return obj;
}

function _genId(prefix) {
  var ts  = new Date().getTime().toString(36);
  var rnd = Math.random().toString(36).slice(2, 6);
  return prefix + '_' + ts + '_' + rnd;
}

function _nowISO() {
  // Store timestamps in IST so the Sheet shows readable Indian times
  return Utilities.formatDate(new Date(), 'Asia/Kolkata', "yyyy-MM-dd'T'HH:mm:ss");
}

// ── Seed data ─────────────────────────────────────────────────────────────────

function _writeSeedData(ss, user) {
  var ts    = _nowISO();
  var audit = {
    created_by_name:  user.name,
    created_by_email: user.email,
    created_at:       ts,
    updated_by_name:  user.name,
    updated_by_email: user.email,
    updated_at:       ts,
  };

  var domain = ALLOWED_DOMAIN || 'example.com';

  var objSeeds = [
    { title: 'Grow core market revenue 30% this quarter',
      description: 'Drive higher throughput and conversion in our primary channel.',
      owner_name: user.name, owner_email: user.email,
      team: 'Revenue', eta: '2026-06-30', status: 'on-track' },
    { title: 'Launch 2 new product lines',
      description: 'Enter adjacent segments with distinct SKUs and GTM plans.',
      owner_name: 'Priya Nair', owner_email: 'priya.n@' + domain,
      team: 'Product', eta: '2026-06-30', status: 'at-risk' },
    { title: 'Reduce average delivery cycle time by 35%',
      description: 'Operational excellence to improve NPS and reduce cost-to-serve.',
      owner_name: 'Arjun Mehta', owner_email: 'arjun.m@' + domain,
      team: 'Operations', eta: '2026-06-30', status: 'on-track' },
    { title: 'Raise customer NPS to 65',
      description: 'Customer delight as a sustainable growth driver.',
      owner_name: 'Sneha Kapoor', owner_email: 'sneha.k@' + domain,
      team: 'CX', eta: '2026-06-30', status: 'off-track' },
  ];

  var objSheet = ss.getSheetByName('Objectives');
  var objIds   = [];

  for (var i = 0; i < objSeeds.length; i++) {
    var id = _genId('obj');
    objIds.push(id);
    var cols = COLS['Objectives'];
    var obj  = Object.assign({ id: id, display_order: i + 1 }, objSeeds[i], audit);
    objSheet.appendRow(cols.map(function(c) { return obj[c] !== undefined ? obj[c] : ''; }));
  }

  var krSeeds = [
    { objIdx: 0, title: 'Active revenue-generating units/month', metric_type: 'number',     start_value: 8,  target_value: 15,  current_value: 11, unit: 'units',  weight: 1 },
    { objIdx: 0, title: 'Conversion rate (lead → close)',        metric_type: 'percentage', start_value: 22, target_value: 30,  current_value: 26, unit: '%',      weight: 2 },
    { objIdx: 0, title: 'Repeat / referral customer ratio',      metric_type: 'percentage', start_value: 5,  target_value: 12,  current_value: 7,  unit: '%',      weight: 1 },
    { objIdx: 1, title: 'Line A GTM fully launched',             metric_type: 'boolean',    start_value: 0,  target_value: 1,   current_value: 1,  unit: '',       weight: 1 },
    { objIdx: 1, title: 'Line B SKUs live in catalogue',         metric_type: 'boolean',    start_value: 0,  target_value: 1,   current_value: 0,  unit: '',       weight: 1 },
    { objIdx: 1, title: 'Orders booked across new lines',        metric_type: 'number',     start_value: 0,  target_value: 100, current_value: 34, unit: 'orders', weight: 2 },
    { objIdx: 2, title: 'Median delivery TAT',                   metric_type: 'number',     start_value: 32, target_value: 21,  current_value: 27, unit: 'days',   weight: 2 },
    { objIdx: 2, title: '% projects delivered on schedule',      metric_type: 'percentage', start_value: 60, target_value: 85,  current_value: 72, unit: '%',      weight: 1 },
    { objIdx: 3, title: 'Post-delivery NPS score',               metric_type: 'number',     start_value: 52, target_value: 65,  current_value: 55, unit: 'NPS',    weight: 2 },
    { objIdx: 3, title: 'Survey response rate',                  metric_type: 'percentage', start_value: 30, target_value: 60,  current_value: 38, unit: '%',      weight: 1 },
  ];

  var krSheet = ss.getSheetByName('KeyResults');
  var krIds   = [];
  var krCols  = COLS['KeyResults'];

  for (var k = 0; k < krSeeds.length; k++) {
    var kSeed = krSeeds[k];
    var krId  = _genId('kr');
    krIds.push(krId);
    var kr = Object.assign(
      { id: krId, objective_id: objIds[kSeed.objIdx] },
      kSeed, audit
    );
    delete kr.objIdx;
    krSheet.appendRow(krCols.map(function(c) { return kr[c] !== undefined ? kr[c] : ''; }));
  }

  var ciSeeds = [
    { krIdx: 0, new_value: 9,  note: 'Slow start but pipeline building',    daysAgo: 20 },
    { krIdx: 0, new_value: 11, note: 'Month-end push paying off',            daysAgo: 5  },
    { krIdx: 1, new_value: 24, note: 'Conversion up after team training',    daysAgo: 15 },
    { krIdx: 1, new_value: 26, note: 'Steady — targeting 28 next week',      daysAgo: 3  },
    { krIdx: 6, new_value: 30, note: 'Supply delays from vendor',            daysAgo: 12 },
    { krIdx: 6, new_value: 27, note: 'Better contractor coordination',        daysAgo: 2  },
  ];

  var ciSheet = ss.getSheetByName('CheckIns');
  var ciCols  = COLS['CheckIns'];

  for (var c = 0; c < ciSeeds.length; c++) {
    var cSeed  = ciSeeds[c];
    var ciDate = new Date(Date.now() - cSeed.daysAgo * 86400000);
    var ci = {
      id:                  _genId('ci'),
      key_result_id:       krIds[cSeed.krIdx],
      date:                Utilities.formatDate(ciDate, 'Asia/Kolkata', 'yyyy-MM-dd'),
      new_value:           cSeed.new_value,
      note:                cSeed.note,
      checked_in_by_name:  user.name,
      checked_in_by_email: user.email,
      created_at:          ts,
    };
    ciSheet.appendRow(ciCols.map(function(col) { return ci[col] !== undefined ? ci[col] : ''; }));
  }
}
