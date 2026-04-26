/**
 * app.js — Alpine.js UI logic for 10xGoals
 *
 * All state lives in one Alpine.data('app') component.
 * Sheets.js handles API calls; this file handles everything the user sees.
 *
 * Views: 'signin' | 'loading' | 'error' | 'objectives' | 'detail' | 'alignment'
 */

document.addEventListener('alpine:init', () => {

  Alpine.data('app', () => ({

    // ── Auth & bootstrap ────────────────────────────────────────────────────
    view:       'signin',   // current top-level view
    user:       null,       // { name, email, picture }
    authError:  '',
    initError:  null,       // { message, type } — schema/not-initialized errors

    // ── Raw data (source of truth, mirrors the sheet) ───────────────────────
    objectives: [],
    keyResults: [],
    checkIns:   [],

    // ── UI state ────────────────────────────────────────────────────────────
    selectedCycle:    '',
    availableCycles:  [],
    filters: { team: '', owner: '', status: '' },

    selectedObjectiveId: null,
    expandedKRId:        null,   // only one KR expanded at a time in detail view

    // Modals
    modal: {
      type:    null,   // 'newObjective' | 'newKR' | 'checkIn' | 'csv'
      data:    {},     // form fields
      saving:  false,
      error:   '',
    },

    // Toast
    toast: null,  // { msg, kind: 'success'|'error' }
    _toastTimer: null,

    // ── Initialise ──────────────────────────────────────────────────────────
    async init() {
      // GIS is loaded via CDN; wait for it
      await this._waitForGIS();

      await Sheets.initAuth({
        onSignIn:  async (user) => {
          this.user = user;
          await this._loadData();
        },
        onSignOut: () => {
          this.user = null;
          this.view = 'signin';
        },
        onError: (msg) => {
          this.authError = msg;
          this.view = 'signin';
        },
      });
    },

    _waitForGIS() {
      return new Promise(resolve => {
        if (typeof google !== 'undefined' && google.accounts) return resolve();
        const interval = setInterval(() => {
          if (typeof google !== 'undefined' && google.accounts) {
            clearInterval(interval);
            resolve();
          }
        }, 100);
      });
    },

    signIn() {
      this.authError = '';
      Sheets.signIn();
    },

    async signOut() {
      await Sheets.signOut();
      this.user        = null;
      this.objectives  = [];
      this.keyResults  = [];
      this.checkIns    = [];
      this.view        = 'signin';
    },

    // ── Data loading ────────────────────────────────────────────────────────
    async _loadData() {
      this.view      = 'loading';
      this.initError = null;
      try {
        const data         = await Sheets.loadAllData();
        this.objectives    = data['Objectives']  || [];
        this.keyResults    = data['KeyResults']  || [];
        this.checkIns      = data['CheckIns']    || [];
        this._computeCycles();
        this.view          = 'objectives';
      } catch (e) {
        if (e.type === 'NOT_INITIALIZED' || e.type === 'SCHEMA_ERROR') {
          this.initError = e;
          this.view      = 'error';
        } else {
          this.initError = { message: e.message || 'Failed to load data from Google Sheets.' };
          this.view      = 'error';
        }
      }
    },

    async refreshData() {
      await this._loadData();
    },

    async initializeSheet() {
      this.view = 'loading';
      try {
        await Sheets.initializeSheet(this.user);
        await this._loadData();
        this._toast('Sheet initialized with sample data!', 'success');
      } catch (e) {
        this.initError = { message: e.message || 'Initialization failed.' };
        this.view      = 'error';
      }
    },

    // ── Cycle management ────────────────────────────────────────────────────
    _computeCycles() {
      const cycleMap = {};
      const thirtyDaysAgo = Date.now() - 30 * 86_400_000;

      for (const obj of this.objectives) {
        if (!obj.cycle) continue;
        if (!cycleMap[obj.cycle]) cycleMap[obj.cycle] = { count: 0, recentCount: 0 };
        cycleMap[obj.cycle].count++;
        const updatedAt = obj.updated_at ? new Date(obj.updated_at).getTime() : 0;
        if (updatedAt > thirtyDaysAgo) cycleMap[obj.cycle].recentCount++;
      }

      // Sort by recent activity desc, then total desc
      const sorted = Object.entries(cycleMap)
        .sort(([, a], [, b]) => b.recentCount - a.recentCount || b.count - a.count)
        .map(([c]) => c);

      // Merge with CONFIG suggestions, deduped
      const suggested = (CONFIG.SUGGESTED_CYCLES || []).filter(c => !cycleMap[c]);
      this.availableCycles = [...sorted, ...suggested];

      // Auto-select most recently active cycle
      if (!this.selectedCycle) {
        this.selectedCycle = sorted[0] || CONFIG.DEFAULT_CYCLE || '';
      }
    },

    // ── Computed: filtered objectives ───────────────────────────────────────
    get filteredObjectives() {
      return this.objectives.filter(obj => {
        if (this.selectedCycle && obj.cycle !== this.selectedCycle) return false;
        if (this.filters.team   && obj.team   !== this.filters.team)   return false;
        if (this.filters.owner  && obj.owner_email !== this.filters.owner) return false;
        if (this.filters.status && obj.status !== this.filters.status)  return false;
        return true;
      }).sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    },

    get selectedObjective() {
      return this.objectives.find(o => o.id === this.selectedObjectiveId) || null;
    },

    get filterTeams() {
      return [...new Set(this.objectives.map(o => o.team).filter(Boolean))].sort();
    },

    get filterOwners() {
      return [...new Map(
        this.objectives.map(o => [o.owner_email, o.owner_name])
      ).entries()].map(([email, name]) => ({ email, name }));
    },

    // ── Progress computation ────────────────────────────────────────────────
    krProgress(kr) {
      if (!kr) return 0;
      if (kr.metric_type === 'boolean') {
        return Number(kr.current_value) ? 100 : 0;
      }
      const start  = Number(kr.start_value  ?? 0);
      const target = Number(kr.target_value ?? 0);
      const curr   = Number(kr.current_value ?? start);
      const range  = target - start;
      if (range === 0) return curr >= target ? 100 : 0;
      // Handle inverse KRs (lower is better, e.g. TAT days)
      const pct = ((curr - start) / range) * 100;
      return Math.min(100, Math.max(0, pct));
    },

    objectiveProgress(obj) {
      const krs = this.keyResults.filter(kr => kr.objective_id === obj.id);
      if (!krs.length) return 0;
      const totalWeight = krs.reduce((s, kr) => s + (Number(kr.weight) || 1), 0);
      if (totalWeight === 0) return 0;
      return krs.reduce((s, kr) => s + this.krProgress(kr) * (Number(kr.weight) || 1), 0) / totalWeight;
    },

    objectiveKRs(obj) {
      return this.keyResults.filter(kr => kr.objective_id === obj.id);
    },

    krCheckIns(kr) {
      return this.checkIns
        .filter(ci => ci.key_result_id === kr.id)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    },

    latestCheckIn(kr) {
      return this.krCheckIns(kr)[0] || null;
    },

    meceWarning(obj) {
      const count = this.keyResults.filter(kr => kr.objective_id === obj.id).length;
      return count <= 1;
    },

    progressColor(pct) {
      if (pct >= 70) return 'bg-emerald-500';
      if (pct >= 40) return 'bg-amber-400';
      return 'bg-rose-500';
    },

    statusColor(status) {
      const map = {
        'on-track':  'bg-emerald-100 text-emerald-700',
        'at-risk':   'bg-amber-100  text-amber-700',
        'off-track': 'bg-rose-100   text-rose-700',
        'done':      'bg-slate-100  text-slate-600',
      };
      return map[status] || 'bg-slate-100 text-slate-500';
    },

    // ── Alignment view ──────────────────────────────────────────────────────
    get alignmentTree() {
      const cycleObjs = this.selectedCycle
        ? this.objectives.filter(o => o.cycle === this.selectedCycle)
        : this.objectives;

      const roots    = cycleObjs.filter(o => !o.parent_objective_id);
      const childMap = {};
      for (const o of cycleObjs) {
        if (o.parent_objective_id) {
          if (!childMap[o.parent_objective_id]) childMap[o.parent_objective_id] = [];
          childMap[o.parent_objective_id].push(o);
        }
      }

      const build = (nodes, depth = 0) =>
        nodes.flatMap(node => [
          { ...node, _depth: depth },
          ...build(childMap[node.id] || [], depth + 1),
        ]);

      return build(roots);
    },

    // ── Navigation ──────────────────────────────────────────────────────────
    openObjective(id) {
      this.selectedObjectiveId = id;
      this.expandedKRId        = null;
      this.view                = 'detail';
    },

    backToList() {
      this.view                = 'objectives';
      this.selectedObjectiveId = null;
    },

    toggleKR(krId) {
      this.expandedKRId = this.expandedKRId === krId ? null : krId;
    },

    // ── Modals ──────────────────────────────────────────────────────────────
    openNewObjectiveModal() {
      this.modal = {
        type:   'newObjective',
        saving: false,
        error:  '',
        data: {
          title:               '',
          description:         '',
          owner_name:          this.user.name,
          owner_email:         this.user.email,
          team:                '',
          cycle:               this.selectedCycle || '',
          status:              'on-track',
          parent_objective_id: '',
        },
      };
    },

    openNewKRModal(objectiveId) {
      this.modal = {
        type:   'newKR',
        saving: false,
        error:  '',
        data: {
          objective_id:  objectiveId,
          title:         '',
          metric_type:   'number',
          start_value:   0,
          target_value:  100,
          current_value: 0,
          unit:          '',
          weight:        1,
        },
      };
    },

    openCheckInModal(kr) {
      this.modal = {
        type:   'checkIn',
        saving: false,
        error:  '',
        data: {
          kr,
          new_value:  kr.current_value ?? 0,
          confidence: 7,
          note:       '',
          date:       new Date().toISOString().split('T')[0],
        },
      };
    },

    closeModal() {
      if (this.modal.saving) return;
      this.modal = { type: null, data: {}, saving: false, error: '' };
    },

    // ── Saves ────────────────────────────────────────────────────────────────
    async saveNewObjective() {
      const d = this.modal.data;
      if (!d.title.trim())  { this.modal.error = 'Title is required.'; return; }
      if (!d.cycle.trim())  { this.modal.error = 'Cycle is required.';  return; }

      this.modal.saving = true;
      this.modal.error  = '';

      const id  = genId('obj');
      const now = nowISO();
      const obj = {
        id,
        title:               d.title.trim(),
        description:         d.description.trim(),
        owner_name:          d.owner_name,
        owner_email:         d.owner_email,
        team:                d.team,
        cycle:               d.cycle,
        status:              d.status,
        parent_objective_id: d.parent_objective_id || '',
        display_order:       this.objectives.length + 1,
        created_by_name:     this.user.name,
        created_by_email:    this.user.email,
        created_at:          now,
        updated_by_name:     this.user.name,
        updated_by_email:    this.user.email,
        updated_at:          now,
        _rowIndex:           null, // will be set after reload
      };

      // Optimistic add
      this.objectives.push(obj);
      this._computeCycles();
      this.closeModal();

      try {
        await Sheets.appendRow('Objectives', obj);
        this._toast('Objective created.', 'success');
        // Reload to get the real _rowIndex
        await this._silentReload();
      } catch (e) {
        // Revert
        this.objectives = this.objectives.filter(o => o.id !== id);
        this._toast('Could not save objective: ' + e.message, 'error');
      }
    },

    async saveNewKR() {
      const d = this.modal.data;
      if (!d.title.trim()) { this.modal.error = 'Title is required.'; return; }

      this.modal.saving = true;
      this.modal.error  = '';

      const id  = genId('kr');
      const now = nowISO();
      const kr  = {
        id,
        objective_id:    d.objective_id,
        title:           d.title.trim(),
        metric_type:     d.metric_type,
        start_value:     Number(d.start_value),
        target_value:    Number(d.target_value),
        current_value:   Number(d.current_value),
        unit:            d.unit,
        weight:          Number(d.weight) || 1,
        created_by_name: this.user.name,
        created_by_email:this.user.email,
        created_at:      now,
        updated_by_name: this.user.name,
        updated_by_email:this.user.email,
        updated_at:      now,
        _rowIndex:       null,
      };

      this.keyResults.push(kr);
      this.closeModal();

      try {
        await Sheets.appendRow('KeyResults', kr);
        this._toast('Key Result added.', 'success');
        await this._silentReload();
      } catch (e) {
        this.keyResults = this.keyResults.filter(r => r.id !== id);
        this._toast('Could not save KR: ' + e.message, 'error');
      }
    },

    async saveCheckIn() {
      const d  = this.modal.data;
      const kr = d.kr;

      this.modal.saving = true;
      this.modal.error  = '';

      const now    = nowISO();
      const ciId   = genId('ci');
      const newVal = Number(d.new_value);

      const ci = {
        id:                  ciId,
        key_result_id:       kr.id,
        date:                d.date,
        new_value:           newVal,
        confidence:          Number(d.confidence),
        note:                d.note.trim(),
        checked_in_by_name:  this.user.name,
        checked_in_by_email: this.user.email,
        created_at:          now,
      };

      // Optimistic update — update KR's current_value in-place
      const prevValue  = kr.current_value;
      const krInState  = this.keyResults.find(r => r.id === kr.id);
      const prevUpdBy  = krInState ? { updated_by_name: krInState.updated_by_name, updated_by_email: krInState.updated_by_email, updated_at: krInState.updated_at } : {};

      if (krInState) {
        krInState.current_value    = newVal;
        krInState.updated_by_name  = this.user.name;
        krInState.updated_by_email = this.user.email;
        krInState.updated_at       = now;
      }
      this.checkIns.push(ci);
      this.closeModal();

      try {
        // Write check-in row
        await Sheets.appendRow('CheckIns', ci);

        // Update KR's current_value in the sheet
        if (krInState && krInState._rowIndex) {
          await Sheets.updateRow('KeyResults', krInState._rowIndex, krInState);
        }
        this._toast('Check-in saved.', 'success');
      } catch (e) {
        // Revert
        this.checkIns = this.checkIns.filter(c => c.id !== ciId);
        if (krInState) {
          krInState.current_value    = prevValue;
          Object.assign(krInState, prevUpdBy);
        }
        this._toast('Check-in failed: ' + e.message, 'error');
      }
    },

    // ── Inline objective edit ────────────────────────────────────────────────
    async updateObjectiveField(obj, field, value) {
      const prev = obj[field];
      if (prev === value) return;

      // Optimistic
      obj[field]          = value;
      obj.updated_by_name  = this.user.name;
      obj.updated_by_email = this.user.email;
      obj.updated_at       = nowISO();

      try {
        if (obj._rowIndex) {
          await Sheets.updateRow('Objectives', obj._rowIndex, obj);
        } else {
          await this._silentReload();
        }
        this._toast('Saved.', 'success');
      } catch (e) {
        // Revert
        obj[field]           = prev;
        obj.updated_by_name  = obj._prevUpdBy || obj.updated_by_name;
        this._toast('Could not save: ' + e.message, 'error');
      }
    },

    // ── CSV Export ───────────────────────────────────────────────────────────
    exportCSV() {
      if (!this.selectedCycle) {
        this._toast('Please select a cycle before exporting.', 'error');
        return;
      }
      const csv      = Sheets.generateCSV(this.objectives, this.keyResults, this.checkIns, this.selectedCycle);
      const blob     = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement('a');
      a.href         = url;
      a.download     = `10xgoals_${this.selectedCycle.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      this._toast('CSV downloaded.', 'success');
    },

    // ── Silent reload (after writes, to sync _rowIndexes) ──────────────────
    async _silentReload() {
      try {
        const data      = await Sheets.loadAllData();
        this.objectives = data['Objectives'] || [];
        this.keyResults = data['KeyResults'] || [];
        this.checkIns   = data['CheckIns']   || [];
        this._computeCycles();
      } catch (e) {
        console.warn('Silent reload failed:', e);
      }
    },

    // ── Toast ────────────────────────────────────────────────────────────────
    _toast(msg, kind = 'success') {
      clearTimeout(this._toastTimer);
      this.toast = { msg, kind };
      this._toastTimer = setTimeout(() => { this.toast = null; }, 3500);
    },

    // ── Utility: relative time ───────────────────────────────────────────────
    relativeTime(isoString) {
      if (!isoString) return '';
      const diff = Date.now() - new Date(isoString).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1)   return 'just now';
      if (mins < 60)  return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs  < 24)  return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      if (days < 7)   return `${days}d ago`;
      return new Date(isoString).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    },

    formatDate(dateStr) {
      if (!dateStr) return '';
      return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    },

    formatValue(kr, value) {
      if (value === null || value === undefined) return '—';
      if (kr.metric_type === 'boolean') return Number(value) ? 'Done ✓' : 'Not yet';
      if (kr.metric_type === 'percentage') return `${value}%`;
      return `${value}${kr.unit ? ' ' + kr.unit : ''}`;
    },

    // Parent objective candidates (same cycle, not self)
    parentCandidates(selfId) {
      const cycle = this.modal?.data?.cycle || this.selectedCycle;
      return this.objectives.filter(o => o.id !== selfId && o.cycle === cycle);
    },

  })); // end Alpine.data

}); // end alpine:init

// ── Helpers exposed to app.js scope (used in Sheets.js too) ─────────────────

function genId(prefix) {
  const ts  = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${ts}_${rnd}`;
}

function nowISO() {
  return new Date().toISOString();
}
