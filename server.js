const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 10000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin2026';
const ENTRY_PASSWORD = process.env.ENTRY_PASSWORD || 'entry2026';

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

app.post('/login', (req, res) => {
  const pw = req.body.password;
  if (pw === ADMIN_PASSWORD) {
    req.session.role = 'admin';
    return res.redirect('/');
  }
  if (pw === ENTRY_PASSWORD) {
    req.session.role = 'entry';
    return res.redirect('/');
  }
  res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/api/whoami', requireApiAuth, (req, res) => {
  res.json({ role: req.session.role });
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
