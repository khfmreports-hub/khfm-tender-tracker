// KHFM — one app for Report, Tracker and Tender Tracker.
//   /login     one sign-in page for everyone (User or Admin)
//   /          home: the apps you can open, plus Users & access for admins
//   /report    KHFM Report
//   /tracker   KHFM Tracker (Housekeeping & Pest Control)
//   /tenders   KHFM Tender Tracker
// All data is kept in the one Postgres database (DATABASE_URL).
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const store = require('./store');
const { loadUser, forgetSession } = require('./auth');
const { createReportApp } = require('./apps/report');
const { createTrackerApp } = require('./apps/tracker');
const { createTendersApp } = require('./apps/tenders');

const app = express();
const PORT = process.env.PORT || 10000;
const HUB = path.join(__dirname, 'public', 'hub');

if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET is not set. Set it in Render > Environment so logins stay secure.');
}
app.set('trust proxy', 1); // Render sits in front of the app
app.disable('x-powered-by');
app.use(session({
  store: new PgSession({ pool: db.pool, tableName: 'hub_sessions', createTableIfMissing: true }),
  name: 'khfm.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { maxAge: 1000 * 60 * 60 * 12, httpOnly: true, sameSite: 'lax', secure: 'auto' }, // 12 hours of inactivity
}));
app.use(loadUser);

const report = createReportApp();
const tracker = createTrackerApp();
const tenders = createTendersApp();

// ---------- Sign in / out ----------
const failedLogins = new Map(); // ip -> { count, until }
function tooManyAttempts(ip) {
  const f = failedLogins.get(ip);
  return f && f.count >= 10 && f.until > Date.now();
}
function noteFailure(ip) {
  const f = failedLogins.get(ip);
  if (!f || f.until < Date.now()) failedLogins.set(ip, { count: 1, until: Date.now() + 15 * 60 * 1000 });
  else f.count++;
}

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.sendFile(path.join(HUB, 'login.html'));
});
app.get('/logo.gif', (req, res) => res.sendFile(path.join(HUB, 'logo.gif')));

app.post('/api/hub/login', express.json(), async (req, res) => {
  const { username, password, mode } = req.body || {};
  if (tooManyAttempts(req.ip)) return res.status(429).json({ error: 'Too many wrong attempts. Wait 15 minutes and try again.' });
  if (!username || !password) return res.status(400).json({ error: 'Enter your username and password.' });
  try {
    const row = await store.findForLogin(username);
    if (!row || !store.checkPassword(password, row.password_hash)) {
      noteFailure(req.ip);
      return res.status(401).json({ error: 'Wrong username or password.' });
    }
    if (mode === 'admin' && !row.is_admin) {
      return res.status(403).json({ error: 'This login is not an admin. Use the User tab.' });
    }
    failedLogins.delete(req.ip);
    // A login carried over from an old app: swap its old hash for a strong one.
    if (String(row.password_hash).startsWith('sha256$')) {
      try { await store.setPassword(row.id, password); } catch (e) { console.error(e); }
    }
    req.session.regenerate(async (err) => {
      if (err) return res.status(500).json({ error: 'Could not sign in. Try again.' });
      req.session.userId = row.id;
      req.session.loginAt = Date.now();
      await store.markLogin(row.id);
      const want = req.body.next;
      const next = typeof want === 'string' && /^\/((report|tracker|tenders)(\/[\w\-.]*)*)?\/?$/.test(want) ? want : '/';
      res.json({ ok: true, next });
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not sign in. Try again.' });
  }
});

app.get('/logout', (req, res) => {
  forgetSession(req.sessionID);
  req.session.destroy(() => {
    res.clearCookie('khfm.sid');
    res.redirect('/login');
  });
});

// ---------- Home ----------
function requireUserApi(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not logged in.' });
  next();
}
function requireHubAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: 'Admins only.' });
  next();
}
function sendError(res, e) {
  if (e.userFacing) return res.status(400).json({ error: e.message });
  console.error(e);
  res.status(500).json({ error: 'Something went wrong. Try again.' });
}

app.get('/', (req, res) => {
  if (!req.user) return res.redirect('/login');
  res.sendFile(path.join(HUB, 'index.html'));
});

app.get('/api/hub/me', requireUserApi, (req, res) => {
  const u = req.user;
  res.json({
    user: { id: u.id, username: u.username, name: u.name, isAdmin: u.isAdmin },
    roles: { report: store.roleFor(u, 'report'), tracker: store.roleFor(u, 'tracker'), tenders: store.roleFor(u, 'tenders') },
  });
});

app.post('/api/hub/my-password', requireUserApi, express.json(), async (req, res) => {
  const { current, password } = req.body || {};
  try {
    const row = await store.findForLogin(req.user.username);
    if (!row || !store.checkPassword(current || '', row.password_hash)) {
      return res.status(400).json({ error: 'Your current password is wrong.' });
    }
    await store.setPassword(req.user.id, password);
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

// ---------- Users & access (admins) ----------
app.use('/api/hub/users', requireHubAdmin, express.json());
app.get('/api/hub/users', async (req, res) => {
  try { res.json(await store.listUsers()); } catch (e) { sendError(res, e); }
});
app.post('/api/hub/users', async (req, res) => {
  try { res.status(201).json(await store.createUser(req.body || {})); } catch (e) { sendError(res, e); }
});
app.put('/api/hub/users/:id', async (req, res) => {
  try {
    const u = await store.updateUser(Number(req.params.id), req.body || {});
    if (!u) return res.status(404).json({ error: 'User not found.' });
    res.json(u);
  } catch (e) { sendError(res, e); }
});
app.post('/api/hub/users/:id/password', async (req, res) => {
  try {
    const ok = await store.setPassword(Number(req.params.id), (req.body || {}).password);
    if (!ok) return res.status(404).json({ error: 'User not found.' });
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});
app.delete('/api/hub/users/:id', async (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'You cannot delete your own login.' });
  try {
    const ok = await store.deleteUser(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'User not found.' });
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

// ---------- One-time import from the old Render services (admins) ----------
app.post('/api/hub/import/:app', requireHubAdmin, express.json(), async (req, res) => {
  const { url, password } = req.body || {};
  const target = { report, tracker }[req.params.app];
  if (!target) return res.status(404).json({ error: 'Unknown app.' });
  if (!url || !password) return res.status(400).json({ error: 'Enter the old app address and its full-access password.' });
  try {
    const result = await target.importFromOld(url, password);
    await store.setDoc('import_' + req.params.app, { at: new Date().toISOString(), from: url, by: req.user.username, result });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Import failed.' });
  }
});
app.get('/api/hub/import-status', requireHubAdmin, async (req, res) => {
  try {
    res.json({ report: await store.getDoc('import_report'), tracker: await store.getDoc('import_tracker') });
  } catch (e) { sendError(res, e); }
});

// ---------- The three apps ----------
app.use('/report', report.router);
app.use('/tracker', tracker.router);
app.use('/tenders', tenders.router);

// Old Tender Tracker links (/add, /dashboard, /manage) still land somewhere sensible.
app.get(['/add', '/dashboard'], (req, res) => res.redirect('/tenders' + req.path));
app.get('/manage', (req, res) => res.redirect('/'));
app.get('/healthz', (req, res) => res.send('ok'));
app.use((req, res) => res.status(404).send('Not found. <a href="/">Go to KHFM home</a>'));

// One-time copy from the old services, run by the server itself when
// IMPORT_<APP>_PASSWORD is set (same as the admin's "Copy … data" button).
// Never runs twice for the same IMPORT_RUN_ID (or with none set).
async function autoImport() {
  const jobs = [
    ['report', report, process.env.IMPORT_REPORT_URL || 'https://khfm-report.onrender.com', process.env.IMPORT_REPORT_PASSWORD],
    ['tracker', tracker, process.env.IMPORT_TRACKER_URL || 'https://khfm-tracker.onrender.com', process.env.IMPORT_TRACKER_PASSWORD],
  ];
  for (const [name, target, url, password] of jobs) {
    if (!password) continue;
    try {
      // IMPORT_RUN_ID lets one deliberate re-copy happen (e.g. after the old
      // apps are switched to redirect here); the same ID never runs twice.
      const runId = process.env.IMPORT_RUN_ID || null;
      const prev = await store.getDoc('import_' + name);
      if (prev && (prev.runId || null) === runId) { console.log(`Auto-import ${name}: already copied, skipped.`); continue; }
      const result = await target.importFromOld(url, password);
      await store.setDoc('import_' + name, { at: new Date().toISOString(), from: url, by: 'auto-import', runId: process.env.IMPORT_RUN_ID || null, result });
      console.log(`Auto-import ${name}: done ${JSON.stringify(result)}`);
    } catch (e) {
      console.error(`Auto-import ${name} failed: ${e.message}`);
    }
  }
}

(async () => {
  try {
    await db.init();     // tender tables (already exist on your database)
    await store.init();  // hub users, Report/Tracker data, bills
    await report.init();
    await tracker.init();
    app.listen(PORT, () => console.log(`KHFM running on port ${PORT}`));
    autoImport();
  } catch (e) {
    console.error('Failed to start:', e);
    process.exit(1);
  }
})();
