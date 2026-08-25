const express = require('express');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const db = require('./db');

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

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'khfm-tender-tracker-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 } // 12 hours
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.role) return next();
  return res.redirect('/login');
}
function requireApiAuth(req, res, next) {
  if (req.session && req.session.role) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}
function requireAdminApi(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin only' });
}
// Both admin and entry can add/edit; only admin can delete.
function requireWriteApi(req, res, next) {
  if (req.session && (req.session.role === 'admin' || req.session.role === 'entry')) return next();
  return res.status(403).json({ error: 'Not permitted' });
}

// ---------- Auth ----------
app.get('/login', (req, res) => {
  const error = req.query.error ? '<p class="err">Incorrect password. Try again.</p>' : '';
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>KHFM Tender Tracker</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;background:#0F2036;color:#F7F3E9;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
  .box{background:#16304D;padding:40px 36px;border-radius:8px;text-align:center;width:300px;box-shadow:0 20px 50px rgba(0,0,0,0.35);}
  h1{font-size:19px;margin:0 0 22px;font-weight:700;}
  input[type=password]{width:100%;padding:11px;border-radius:4px;border:1px solid rgba(247,243,233,0.25);margin-bottom:14px;box-sizing:border-box;background:#0F2036;color:#F7F3E9;font-size:14px;}
  input[type=password]:focus{outline:2px solid #C9962C;}
  button{width:100%;padding:11px;background:#C9962C;border:none;border-radius:4px;color:#0F2036;font-weight:700;cursor:pointer;font-size:14px;}
  button:hover{background:#D9A93B;}
  .err{color:#E08A82;font-size:12.5px;margin-bottom:12px;}
</style></head>
<body>
  <div class="box">
    <h1>KHFM Tender Tracker</h1>
    ${error}
    <form method="POST" action="/login">
      <input type="password" name="password" placeholder="Enter password" autofocus required>
      <button type="submit">Enter</button>
    </form>
  </div>
</body></html>`);
});

app.post('/login', async (req, res) => {
  const pw = req.body.password;
  try {
    const adminPw = await db.getSetting('admin_password');
    const entryPw = await db.getSetting('entry_password');
    if (pw === adminPw) {
      req.session.role = 'admin';
      return res.redirect('/');
    }
    if (pw === entryPw) {
      req.session.role = 'entry';
      return res.redirect('/');
    }
    res.redirect('/login?error=1');
  } catch (e) {
    console.error(e);
    res.redirect('/login?error=1');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/api/whoami', requireApiAuth, (req, res) => {
  res.json({ role: req.session.role });
});

// ---------- Manage (admin only) ----------
function requireAdminPage(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  return res.redirect('/login');
}

app.get('/manage', requireAdminPage, (req, res) => {
  const msg = req.query.saved ? '<p class="ok">Passwords updated.</p>' : '';
  const err = req.query.error ? '<p class="err">Both fields are required, and they must be different from each other.</p>' : '';
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Manage — KHFM Tender Tracker</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;background:#0F2036;color:#F7F3E9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;}
  .box{background:#16304D;padding:36px;border-radius:8px;width:100%;max-width:420px;box-shadow:0 20px 50px rgba(0,0,0,0.35);}
  h1{font-size:19px;margin:0 0 6px;font-weight:700;}
  .sub{font-size:12.5px;color:rgba(247,243,233,0.55);margin:0 0 22px;}
  label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:rgba(247,243,233,0.55);margin-bottom:5px;margin-top:16px;}
  input[type=text],input[type=password]{width:100%;padding:10px;border-radius:4px;border:1px solid rgba(247,243,233,0.25);box-sizing:border-box;background:#0F2036;color:#F7F3E9;font-size:14px;}
  input:focus{outline:2px solid #C9962C;}
  button{width:100%;padding:11px;background:#C9962C;border:none;border-radius:4px;color:#0F2036;font-weight:700;cursor:pointer;font-size:14px;margin-top:22px;}
  button:hover{background:#D9A93B;}
  .ok{color:#79C295;font-size:12.5px;margin:0 0 8px;}
  .err{color:#E08A82;font-size:12.5px;margin:0 0 8px;}
  .back{display:inline-block;margin-top:16px;color:rgba(247,243,233,0.55);font-size:12.5px;text-decoration:none;}
  .back:hover{color:#F7F3E9;}
</style></head>
<body>
  <div class="box">
    <h1>Manage Access</h1>
    <p class="sub">Set the passwords for the two tracker logins.</p>
    ${msg}${err}
    <form method="POST" action="/manage/update-passwords">
      <label>Admin Password</label>
      <input type="text" name="adminPassword" required>
      <label>Entry Password</label>
      <input type="text" name="entryPassword" required>
      <button type="submit">Save Passwords</button>
    </form>
    <a class="back" href="/">&larr; Back to dashboard</a>
  </div>
</body></html>`);
});

app.post('/manage/update-passwords', requireAdminPage, async (req, res) => {
  const { adminPassword, entryPassword } = req.body;
  if (!adminPassword || !entryPassword || adminPassword === entryPassword) {
    return res.redirect('/manage?error=1');
  }
  try {
    await db.setSetting('admin_password', adminPassword);
    await db.setSetting('entry_password', entryPassword);
    res.redirect('/manage?saved=1');
  } catch (e) {
    console.error(e);
    res.redirect('/manage?error=1');
  }
});

// ---------- Tender API ----------
app.get('/api/tenders', requireApiAuth, async (req, res) => {
  try {
    const tenders = await db.listTenders();
    res.json(tenders);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load tenders' });
  }
});

app.post('/api/tenders', requireWriteApi, async (req, res) => {
  try {
    const created = await db.createTender(req.body || {});
    res.status(201).json(created);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create tender' });
  }
});

app.put('/api/tenders/:id', requireWriteApi, async (req, res) => {
  try {
    const updated = await db.updateTender(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update tender' });
  }
});

app.patch('/api/tenders/:id/emd-paid', requireWriteApi, async (req, res) => {
  try {
    const tenders = await db.listTenders();
    const existing = tenders.find(t => String(t.id) === String(req.params.id));
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const updated = await db.updateTender(req.params.id, { ...existing, emdPaid: !!req.body.emdPaid });
    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update EMD status' });
  }
});

app.delete('/api/tenders/:id', requireAdminApi, async (req, res) => {
  try {
    const ok = await db.deleteTender(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete tender' });
  }
});

// ---------- Price bid attachments (PDF / Excel) ----------
app.get('/api/tenders/:id/attachments', requireApiAuth, async (req, res) => {
  try {
    const list = await db.listAttachments(req.params.id);
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load attachments' });
  }
});

app.post('/api/tenders/:id/attachments', requireWriteApi, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const saved = await db.addAttachment(req.params.id, req.file);
      res.status(201).json(saved);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to save attachment' });
    }
  });
});

app.get('/api/attachments/:attId/download', requireApiAuth, async (req, res) => {
  try {
    const file = await db.getAttachmentFile(req.params.attId);
    if (!file) return res.status(404).send('Not found');
    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
    res.send(file.data);
  } catch (e) {
    console.error(e);
    res.status(500).send('Failed to download file');
  }
});

app.delete('/api/attachments/:attId', requireWriteApi, async (req, res) => {
  try {
    const ok = await db.deleteAttachment(req.params.attId);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

// ---------- Static app ----------
app.use('/', requireAuth, express.static(path.join(__dirname, 'public')));

db.init()
  .then(() => {
    app.listen(PORT, () => console.log(`KHFM Tender Tracker running on port ${PORT}`));
  })
  .catch((e) => {
    console.error('Failed to initialize database:', e);
    process.exit(1);
  });
