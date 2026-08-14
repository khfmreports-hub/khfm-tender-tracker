const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const PASSWORD = process.env.TRACKER_PASSWORD || 'khfm2026';

app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'khfm-tender-tracker-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12 } // 12 hours
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return res.redirect('/login');
}

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
  if (req.body.password === PASSWORD) {
    req.session.authenticated = true;
    return res.redirect('/');
  }
  res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.use('/', requireAuth, express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`KHFM Tender Tracker running on port ${PORT}`));
