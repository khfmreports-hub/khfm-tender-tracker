// KHFM Tracker (Housekeeping & Pest Control), served at /tracker. Same
// features and API as the old khfm-tracker service; sign-in comes from the
// shared KHFM login, records live in Postgres (app_docs 'tracker') and bill
// PDFs in the tracker_bills table instead of files on a disk.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const store = require('../store');
const { appGuard, sessionsFor } = require('../auth');
const { fetchOldBackup } = require('./old-app');

const DOC_KEY = 'tracker';
const MAX_BILL_BYTES = 8 * 1024 * 1024; // 8MB raw file cap, same as before
const RECORD_KEYS = ['hk_enquiries', 'hk_daily_services', 'hk_active_sites', 'pc_enquiries', 'pc_daily_services'];
const PROFILES = {
  admin: { label: 'Dashboard (Full access)', sections: 'all' },
  housekeeping: { label: 'Housekeeping', sections: ['hk_enquiries', 'hk_daily_services', 'hk_active_sites', 'hk_bills'] },
  pest_control: { label: 'Pest Control', sections: ['pc_enquiries', 'pc_daily_services'] },
};

function allowedSections(role) {
  const p = PROFILES[role];
  if (!p) return [];
  return p.sections === 'all' ? ['dashboard', ...RECORD_KEYS, 'hk_bills'] : p.sections;
}
function profileFor(role) {
  return { id: role, label: PROFILES[role].label, sections: allowedSections(role) };
}
function uid() {
  return crypto.randomBytes(6).toString('hex');
}

function emptyState() {
  const s = {};
  RECORD_KEYS.forEach(k => { s[k] = []; });
  return s;
}
// Same one-time fixes the old app applied to older data.
function migrateState(old) {
  const s = emptyState();
  const src = old || {};
  if ((src.enquiries || src.daily_services) && !src.hk_enquiries && !src.pc_enquiries) {
    const oldEnq = src.enquiries || [];
    const oldSvc = src.daily_services || [];
    s.hk_enquiries = oldEnq.filter(e => e.service === 'Housekeeping' || e.service === 'Both');
    s.pc_enquiries = oldEnq.filter(e => e.service === 'Pest Control' || e.service === 'Both');
    s.hk_daily_services = oldSvc.filter(x => x.service === 'Housekeeping');
    s.pc_daily_services = oldSvc.filter(x => x.service === 'Pest Control');
  } else {
    RECORD_KEYS.forEach(k => { if (Array.isArray(src[k])) s[k] = src[k]; });
  }
  ['hk_daily_services', 'pc_daily_services'].forEach(k => {
    s[k].forEach(r => { if (r.amount === undefined) r.amount = 0; });
  });
  return s;
}

function createTrackerApp() {
  const router = express.Router();
  const guard = appGuard('tracker');
  let state = emptyState();
  let saving = Promise.resolve();

  function save() {
    const snapshot = JSON.parse(JSON.stringify(state));
    saving = saving.then(() => store.setDoc(DOC_KEY, snapshot)).catch(e => console.error('Tracker save failed:', e));
    return saving;
  }
  function requireAdmin(req, res, next) {
    if (req.appRole !== 'admin') return res.status(403).json({ error: 'Only the Dashboard login can do this.' });
    next();
  }
  function requireBillsAccess(req, res, next) {
    if (!allowedSections(req.appRole).includes('hk_bills')) return res.status(403).json({ error: 'Not allowed to access bills.' });
    next();
  }

  router.use(express.json({ limit: '12mb' }));

  router.get('/api/me', guard, (req, res) => {
    res.json({ profile: profileFor(req.appRole), user: { name: req.user.name, username: req.user.username } });
  });
  router.post('/api/logout', guard, (req, res) => res.json({ ok: true }));

  router.get('/api/state', guard, (req, res) => {
    const allowed = allowedSections(req.appRole);
    const records = {};
    RECORD_KEYS.forEach(key => { if (allowed.includes(key)) records[key] = state[key]; });
    res.json({ records });
  });

  router.post('/api/state/records', guard, async (req, res) => {
    const { key, value } = req.body || {};
    if (!RECORD_KEYS.includes(key) || !allowedSections(req.appRole).includes(key)) {
      return res.status(403).json({ error: 'Not allowed to edit this section.' });
    }
    if (!Array.isArray(value)) return res.status(400).json({ error: 'Invalid records payload.' });
    state[key] = value;
    await save();
    res.json({ ok: true });
  });

  router.get('/api/admin/profiles', guard, requireAdmin, (req, res) => {
    res.json(Object.keys(PROFILES).map(profileFor));
  });
  router.get('/api/admin/sessions', guard, requireAdmin, (req, res) => {
    res.json(sessionsFor('tracker', req.sessionID, r => (PROFILES[r] ? PROFILES[r].label : r)));
  });
  router.post('/api/admin/set-password', guard, requireAdmin, (req, res) => {
    res.status(400).json({ error: 'Passwords are now managed on the KHFM home page, under Users & access.' });
  });
  // Backups hold the records; bill PDFs stay safely in the database.
  router.get('/api/admin/backup', guard, requireAdmin, (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="khfm-tracker-backup.json"');
    res.json({ app: 'khfm-tracker', exportedAt: new Date().toISOString(), state });
  });
  router.post('/api/admin/restore', guard, requireAdmin, async (req, res) => {
    const incoming = req.body;
    if (!incoming || !incoming.state || typeof incoming.state !== 'object') {
      return res.status(400).json({ error: 'That does not look like a valid backup file.' });
    }
    state = migrateState(incoming.state);
    await save();
    res.json({ ok: true });
  });

  // ---------- Bills ----------
  router.get('/api/bills', guard, requireBillsAccess, async (req, res) => {
    res.json(await store.listBills());
  });
  router.post('/api/bills/upload', guard, requireBillsAccess, async (req, res) => {
    const { site, month, fileName, fileData } = req.body || {};
    if (!site || !month || !fileName || !fileData) {
      return res.status(400).json({ error: 'Site, month, and a file are required.' });
    }
    if (!/\.pdf$/i.test(String(fileName))) return res.status(400).json({ error: 'Only PDF files are allowed.' });
    const base64 = String(fileData).includes(',') ? String(fileData).split(',')[1] : fileData;
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length === 0) return res.status(400).json({ error: 'File is empty.' });
    if (buffer.length > MAX_BILL_BYTES) return res.status(400).json({ error: 'File is too large (max 8MB).' });
    if (buffer.slice(0, 4).toString('ascii') !== '%PDF') {
      return res.status(400).json({ error: 'That file does not look like a valid PDF.' });
    }
    const id = uid();
    const safeName = String(fileName).replace(/[^a-zA-Z0-9_.\- ]/g, '_').slice(0, 120);
    await store.addBill({ id, site, month, fileName: safeName, uploadedAt: Date.now(), buffer });
    res.json({ ok: true, id });
  });
  router.get('/api/bills/:id/download', guard, requireBillsAccess, async (req, res) => {
    const bill = await store.getBill(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(bill.file_name)}"`);
    res.send(bill.data);
  });
  router.post('/api/bills/:id/remove', guard, requireBillsAccess, async (req, res) => {
    const ok = await store.removeBill(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Bill not found.' });
    res.json({ ok: true });
  });

  router.get(['/', '/index.html'], guard, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'tracker', 'index.html'));
  });
  router.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  router.get('*', guard, (req, res) => res.redirect('/tracker/'));

  return {
    router,
    async init() {
      const saved = await store.getDoc(DOC_KEY);
      state = migrateState(saved);
      if (!saved) await store.setDoc(DOC_KEY, state);
    },
    // Copy records AND every bill PDF from the old khfm-tracker service.
    async importFromOld(baseUrl, password) {
      const old = await fetchOldBackup(baseUrl, password);
      const backup = old.backup;
      if (!backup || !backup.state) throw new Error('The old Tracker app did not return any data.');
      const bills = Array.isArray(backup.state.hk_bills) ? backup.state.hk_bills : [];
      let copied = 0;
      const failed = [];
      for (const b of bills) {
        const buffer = await old.download('/api/bills/' + encodeURIComponent(b.id) + '/download');
        if (!buffer || buffer.length === 0) { failed.push(b.fileName || b.id); continue; }
        await store.addBill({ id: b.id, site: b.site, month: b.month, fileName: b.fileName || 'bill.pdf', uploadedAt: b.uploadedAt, buffer });
        copied++;
      }
      await old.logout();
      state = migrateState(backup.state);
      await save();
      const counts = {};
      RECORD_KEYS.forEach(k => { counts[k] = state[k].length; });
      const logins = await store.importLegacyProfiles('tracker', backup.profiles);
      return { records: counts, billsCopied: copied, billsFailed: failed, logins };
    },
  };
}

module.exports = { createTrackerApp };
