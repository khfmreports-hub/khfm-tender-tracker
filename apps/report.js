// KHFM Report, served at /report. Same features and API as the old
// khfm-report service; sign-in now comes from the shared KHFM login and the
// data lives in Postgres (app_docs 'report') instead of db.json on a disk.
const express = require('express');
const path = require('path');
const store = require('../store');
const { appGuard, sessionsFor } = require('../auth');
const { fetchOldBackup } = require('./old-app');

const DOC_KEY = 'report';
const METRIC_KEYS = ['salary', 'profit_loss', 'vendor_expenses', 'pf', 'esic', 'bonus', 'leave_wages', 'pt', 'labour_strength', 'billing', 'gst', 'deduction', 'hold', 'special_expenses', 'subcontractor_pl'];
const PROFILES = {
  admin: { label: 'Full access', sections: 'all' },
  payroll: { label: 'Payroll access', sections: ['salary', 'pf', 'esic', 'bonus', 'leave_wages', 'pt', 'labour_strength'] },
  procurement: { label: 'Procurement access', sections: ['vendor_expenses', 'billing', 'gst', 'deduction', 'hold', 'special_expenses', 'subcontractor_pl'] },
};

function allowedSections(role) {
  const p = PROFILES[role];
  if (!p) return [];
  return p.sections === 'all' ? ['dashboard', 'site_master', ...METRIC_KEYS] : p.sections;
}
function profileFor(role) {
  return { id: role, label: PROFILES[role].label, sections: allowedSections(role) };
}

function emptyState() {
  const s = { sites: [], subcontractor_pl: [] };
  METRIC_KEYS.forEach(k => { if (!(k in s)) s[k] = {}; });
  return s;
}
// Same one-time fixes the old app applied to older data.
function migrateState(state) {
  const s = Object.assign(emptyState(), state || {});
  if (state && state.pf_esic && !state.pf) {
    s.pf = state.pf_esic;
    s.esic = state.esic || {};
  }
  delete s.pf_esic;
  if (!Array.isArray(s.sites)) s.sites = [];
  if (!Array.isArray(s.subcontractor_pl)) s.subcontractor_pl = [];
  return s;
}

function createReportApp() {
  const router = express.Router();
  const guard = appGuard('report');
  let state = emptyState();
  let saving = Promise.resolve();

  function save() {
    const snapshot = JSON.parse(JSON.stringify(state));
    saving = saving.then(() => store.setDoc(DOC_KEY, snapshot)).catch(e => console.error('Report save failed:', e));
    return saving;
  }
  function requireAdmin(req, res, next) {
    if (req.appRole !== 'admin') return res.status(403).json({ error: 'Only the full-access login can do this.' });
    next();
  }

  router.use(express.json({ limit: '10mb' }));

  router.get('/api/me', guard, (req, res) => {
    res.json({ profile: profileFor(req.appRole), user: { name: req.user.name, username: req.user.username } });
  });
  router.post('/api/logout', guard, (req, res) => res.json({ ok: true }));

  router.get('/api/state', guard, (req, res) => {
    const allowed = allowedSections(req.appRole);
    const sections = {};
    METRIC_KEYS.forEach(key => { if (allowed.includes(key)) sections[key] = state[key]; });
    res.json({ sites: state.sites, sections, canEditSites: allowed.includes('site_master') });
  });

  router.post('/api/state/section', guard, async (req, res) => {
    const { key, value } = req.body || {};
    if (!METRIC_KEYS.includes(key) || !allowedSections(req.appRole).includes(key)) {
      return res.status(403).json({ error: 'Not allowed to edit this section.' });
    }
    state[key] = value;
    await save();
    res.json({ ok: true });
  });

  router.post('/api/state/sites', guard, requireAdmin, async (req, res) => {
    const { sites } = req.body || {};
    if (!Array.isArray(sites)) return res.status(400).json({ error: 'Invalid sites payload.' });
    state.sites = sites;
    await save();
    res.json({ ok: true });
  });

  router.get('/api/admin/profiles', guard, requireAdmin, (req, res) => {
    res.json(Object.keys(PROFILES).map(profileFor));
  });
  router.get('/api/admin/sessions', guard, requireAdmin, (req, res) => {
    res.json(sessionsFor('report', req.sessionID, r => (PROFILES[r] ? PROFILES[r].label : r)));
  });
  router.post('/api/admin/set-password', guard, requireAdmin, (req, res) => {
    res.status(400).json({ error: 'Passwords are now managed on the KHFM home page, under Users & access.' });
  });
  router.get('/api/admin/backup', guard, requireAdmin, (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="khfm-report-backup.json"');
    res.json({ app: 'khfm-report', exportedAt: new Date().toISOString(), state });
  });
  router.post('/api/admin/restore', guard, requireAdmin, async (req, res) => {
    const incoming = req.body;
    if (!incoming || !incoming.state || typeof incoming.state !== 'object') {
      return res.status(400).json({ error: 'That does not look like a valid KHFM Report backup file.' });
    }
    state = migrateState(incoming.state);
    await save();
    res.json({ ok: true });
  });

  router.get(['/', '/index.html'], guard, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'report', 'index.html'));
  });
  router.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  router.get('*', guard, (req, res) => res.redirect('/report/'));

  return {
    router,
    async init() {
      const saved = await store.getDoc(DOC_KEY);
      state = migrateState(saved);
      if (!saved) await store.setDoc(DOC_KEY, state);
    },
    // Copy everything from the old khfm-report service (needs its full-access password).
    async importFromOld(baseUrl, password) {
      const old = await fetchOldBackup(baseUrl, password);
      const backup = old.backup;
      await old.logout();
      if (!backup || !backup.state) throw new Error('The old Report app did not return any data.');
      state = migrateState(backup.state);
      await save();
      return { sites: state.sites.length };
    },
  };
}

module.exports = { createReportApp };
