const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 10000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin2026';
const ENTRY_PASSWORD = process.env.ENTRY_PASSWORD || 'entry2026';

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'khfm-tender-tracker-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 }, // 12 hours
}));

const PAGE_STYLE = `
  body{font-family:Arial,Helvetica,sans-serif;background:#0F2036;color:#F7F3E9;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
  .box{background:#16304D;padding:40px 36px;border-radius:8px;text-align:center;width:320px;box-shadow:0 20px 50px rgba(0,0,0,0.35);}
  h1{font-size:19px;margin:0 0 16px;font-weight:700;}
  p{font-size:13.5px;color:rgba(247,243,233,0.75);line-height:1.5;margin:0 0 20px;}
  input[type=password]{width:100%;padding:11px;border-radius:4px;border:1px solid rgba(247,243,233,0.25);margin-bottom:14px;box-sizing:border-box;background:#0F2036;color:#F7F3E9;font-size:14px;}
  input[type=password]:focus{outline:2px solid #C9962C;}
  button,.btn{display:inline-block;width:100%;padding:11px;background:#C9962C;border:none;border-radius:4px;color:#0F2036;font-weight:700;cursor:pointer;font-size:14px;text-decoration:none;box-sizing:border-box;}
  button:hover,.btn:hover{background:#D9A93B;}
  .err{color:#E08A82;font-size:12.5px;margin-bottom:12px;}
  a.plain{color:rgba(247,243,233,0.55);font-size:12.5px;display:block;margin-top:14px;}
`;

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.role) return res.redirect('/login');
  if (req.session.role !== 'admin') {
    return res.status(403).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Admins only</title><style>${PAGE_STYLE}</style></head>
<body><div class="box">
  <h1>Admins Only</h1>
  <p>This dashboard is restricted to admin accounts. You're signed in as a data-entry user.</p>
  <a class="btn" href="/add">Go to Add Tender</a>
  <a class="plain" href="/logout">Log out</a>
</div></body></html>`);
  }
  next();
}

function requireAnyRole(req, res, next) {
  if (req.session && (req.session.role === 'admin' || req.session.role === 'entry')) return next();
  return res.redirect('/login');
}

app.get('/login', (req, res) => {
  const error = req.query.error ? '<p class="err">Incorrect password. Try again.</p>' : '';
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>KHFM Tender Tracker</title><style>${PAGE_STYLE}</style></head>
<body><div class="box">
  <h1>KHFM Tender Tracker</h1>
  ${error}
  <form method="POST" action="/login">
    <input type="password" name="password" placeholder="Enter password" autofocus required>
    <button type="submit">Enter</button>
  </form>
</div></body></html>`);
});

app.post('/login', (req, res) => {
  const pw = req.body.password;
  if (pw && pw === ADMIN_PASSWORD) {
    req.session.role = 'admin';
    return res.redirect('/');
  }
  if (pw && pw === ENTRY_PASSWORD) {
    req.session.role = 'entry';
    return res.redirect('/add');
  }
  res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/api/whoami', requireAnyRole, (req, res) => {
  res.json({ role: req.session.role });
});

app.get('/', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/add', requireAnyRole, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'add.html'));
});

app.get('/app.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.js'));
});

app.get('/api/tenders', requireAdmin, async (req, res) => {
  try {
    const data = await db.getAllTenders();
    res.json(data);
  } catch (e) {
    console.error('Failed to load tenders', e);
    res.status(500).json({ error: 'Failed to load tenders' });
  }
});

app.post('/api/tenders', requireAnyRole, async (req, res) => {
  try {
    const sr = await db.addTender(req.body);
    res.json({ ok: true, sr });
  } catch (e) {
    console.error('Failed to save tender', e);
    res.status(500).json({ error: 'Failed to save tender' });
  }
});

db.ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`KHFM Tender Tracker running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
