// KHFM Tender Tracker, served at /tenders. Same tender API and pages as the
// old khfm-tender-tracker service and the SAME database tables, so all
// existing tenders and price-bid files are there from day one.
// Roles: admin (add, edit, delete) and entry (add and edit, no delete).
const express = require('express');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { appGuard } = require('../auth');

const ALLOWED_MIMETYPES = new Set([
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMETYPES.has(file.mimetype)) return cb(null, true);
    cb(new Error('Only PDF and Excel (.xls/.xlsx) files are allowed'));
  },
});

function createTendersApp() {
  const router = express.Router();
  const guard = appGuard('tenders');

  function requireAdminApi(req, res, next) {
    if (req.appRole === 'admin') return next();
    return res.status(403).json({ error: 'Admin only' });
  }
  function requireWriteApi(req, res, next) {
    if (req.appRole === 'admin' || req.appRole === 'entry') return next();
    return res.status(403).json({ error: 'Not permitted' });
  }

  router.use(express.json());
  router.use(express.urlencoded({ extended: true }));
  router.use(guard);

  router.get('/api/whoami', (req, res) => res.json({ role: req.appRole, name: req.user.name || req.user.username }));

  router.get('/api/tenders', async (req, res) => {
    try { res.json(await db.listTenders()); }
    catch (e) { console.error(e); res.status(500).json({ error: 'Failed to load tenders' }); }
  });
  router.post('/api/tenders', requireWriteApi, async (req, res) => {
    try { res.status(201).json(await db.createTender(req.body || {})); }
    catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create tender' }); }
  });
  router.put('/api/tenders/:id', requireWriteApi, async (req, res) => {
    try {
      const updated = await db.updateTender(req.params.id, req.body || {});
      if (!updated) return res.status(404).json({ error: 'Not found' });
      res.json(updated);
    } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to update tender' }); }
  });
  router.patch('/api/tenders/:id/emd-paid', requireWriteApi, async (req, res) => {
    try {
      const tenders = await db.listTenders();
      const existing = tenders.find(t => String(t.id) === String(req.params.id));
      if (!existing) return res.status(404).json({ error: 'Not found' });
      res.json(await db.updateTender(req.params.id, { ...existing, emdPaid: !!(req.body && req.body.emdPaid) }));
    } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to update EMD status' }); }
  });
  router.delete('/api/tenders/:id', requireAdminApi, async (req, res) => {
    try {
      const ok = await db.deleteTender(req.params.id);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to delete tender' }); }
  });

  // Price bid attachments (PDF / Excel)
  router.get('/api/tenders/:id/attachments', async (req, res) => {
    try { res.json(await db.listAttachments(req.params.id)); }
    catch (e) { console.error(e); res.status(500).json({ error: 'Failed to load attachments' }); }
  });
  router.post('/api/tenders/:id/attachments', requireWriteApi, (req, res) => {
    upload.single('file')(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      try { res.status(201).json(await db.addAttachment(req.params.id, req.file)); }
      catch (e) { console.error(e); res.status(500).json({ error: 'Failed to save attachment' }); }
    });
  });
  router.get('/api/attachments/:attId/download', async (req, res) => {
    try {
      const file = await db.getAttachmentFile(req.params.attId);
      if (!file) return res.status(404).send('Not found');
      res.setHeader('Content-Type', file.mimetype);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
      res.send(file.data);
    } catch (e) { console.error(e); res.status(500).send('Failed to download file'); }
  });
  router.delete('/api/attachments/:attId', requireWriteApi, async (req, res) => {
    try {
      const ok = await db.deleteAttachment(req.params.attId);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to delete attachment' }); }
  });
  router.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // Passwords are managed on the KHFM home page now.
  router.get('/manage', (req, res) => res.redirect('/'));

  router.use(express.static(path.join(__dirname, '..', 'public', 'tenders'), { extensions: ['html'] }));

  return { router };
}

module.exports = { createTendersApp };
