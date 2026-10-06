// Shared sign-in helpers: who is signed in, and which role they have in
// each app. Every app's pages and API go through appGuard().
const store = require('./store');

const APP_LABELS = { report: 'KHFM Report', tracker: 'KHFM Tracker', tenders: 'KHFM Tender Tracker' };

// Recent activity per app, for each app's "Who's logged in" list.
// key: `${app}:${sessionId}` -> { name, role, loginAt, lastActive }
const activity = new Map();
setInterval(() => {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [k, a] of activity.entries()) if (a.lastActive < cutoff) activity.delete(k);
}, 60 * 60 * 1000).unref();

async function loadUser(req, res, next) {
  try {
    if (req.session && req.session.userId) {
      req.user = await store.getUser(req.session.userId);
      if (!req.user) delete req.session.userId;
    }
    next();
  } catch (e) {
    next(e);
  }
}

function wantsJson(req) {
  return req.path.startsWith('/api/') || req.xhr || (req.headers.accept || '').includes('application/json');
}

function appGuard(app) {
  return (req, res, next) => {
    if (!req.user) {
      if (wantsJson(req)) return res.status(401).json({ error: 'Not logged in.' });
      return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    }
    const role = store.roleFor(req.user, app);
    if (!role) {
      if (wantsJson(req)) return res.status(403).json({ error: `You don't have access to ${APP_LABELS[app]}.` });
      return res.status(403).send(noAccessPage(APP_LABELS[app]));
    }
    req.appRole = role;
    const key = `${app}:${req.sessionID}`;
    const now = Date.now();
    const prev = activity.get(key);
    activity.set(key, {
      name: req.user.name || req.user.username,
      role,
      loginAt: req.session.loginAt || (prev && prev.loginAt) || now,
      lastActive: now,
    });
    next();
  };
}

function sessionsFor(app, currentSessionId, labelForRole) {
  const now = Date.now();
  const out = [];
  for (const [k, a] of activity.entries()) {
    if (!k.startsWith(app + ':')) continue;
    out.push({
      label: `${a.name} (${labelForRole(a.role)})`,
      loginAt: a.loginAt,
      lastActive: a.lastActive,
      secondsSinceActive: Math.round((now - a.lastActive) / 1000),
      isThisSession: k === `${app}:${currentSessionId}`,
    });
  }
  return out.sort((x, y) => y.lastActive - x.lastActive);
}

function forgetSession(sessionId) {
  for (const k of activity.keys()) if (k.endsWith(':' + sessionId)) activity.delete(k);
}

function noAccessPage(label) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>No access</title><style>body{margin:0;font-family:system-ui,sans-serif;background:#F4F2EE;color:#0F1B2D;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
.box{background:#fff;border:1px solid #E1DCD2;border-radius:14px;padding:32px;max-width:420px}a{display:inline-block;margin-top:16px;background:#1B3E6F;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600}</style></head>
<body><div class="box"><h1 style="margin:0 0 8px;font-size:22px">No access to ${label}</h1><p style="margin:0;color:#4A5568">Ask a KHFM admin to give your login access to this app.</p><a href="/">Back to all apps</a></div></body></html>`;
}

module.exports = { APP_LABELS, loadUser, appGuard, sessionsFor, forgetSession };
