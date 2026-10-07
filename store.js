// Shared storage for the KHFM hub: user accounts, the Report and Tracker
// data (kept as JSON documents), and Tracker bill PDFs. Everything lives in
// the same Postgres database the Tender Tracker already uses, so the combined
// app needs no Render disk.
const crypto = require('crypto');
const { pool } = require('./db');

const APPS = ['report', 'tracker', 'tenders'];
const APP_ROLES = {
  report: ['admin', 'payroll', 'procurement'],
  tracker: ['admin', 'housekeeping', 'pest_control'],
  tenders: ['admin', 'entry'],
};

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hub_users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT false,
      report_role TEXT,
      tracker_role TEXT,
      tenders_role TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_docs (
      key TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracker_bills (
      id TEXT PRIMARY KEY,
      site TEXT,
      month TEXT,
      file_name TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      uploaded_at BIGINT NOT NULL,
      data BYTEA NOT NULL
    );
  `);

  // First run: create the first admin account so someone can sign in.
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM hub_users');
  if (rows[0].n === 0) {
    const username = normUsername(process.env.ADMIN_USERNAME || 'admin');
    const password = process.env.ADMIN_PASSWORD || 'ChangeMe@2026';
    await pool.query(
      'INSERT INTO hub_users (username, name, password_hash, is_admin) VALUES ($1,$2,$3,true)',
      [username, 'Administrator', hashPassword(password)]
    );
    console.log(`Created first admin login "${username}". Change its password after signing in.`);
  }  await importTenderLogins();
  await applyPasswordResets();
}

// ---------- Passwords ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(password, stored) {
  stored = String(stored || '');
  // Logins carried over from the old apps keep their old (unsalted sha256)
  // hash until the person next signs in; the login route then re-hashes it.
  if (stored.startsWith('sha256$')) {
    const real = Buffer.from(stored.slice(7), 'hex');
    const test = crypto.createHash('sha256').update(String(password)).digest();
    return real.length === test.length && crypto.timingSafeEqual(real, test);
  }
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(password), salt, 64);
  const real = Buffer.from(hash, 'hex');
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}
function normUsername(u) {
  return String(u || '').trim().toLowerCase();
}

// ---------- Users ----------
function publicUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    username: r.username,
    name: r.name || '',
    isAdmin: !!r.is_admin,
    roles: { report: r.report_role || null, tracker: r.tracker_role || null, tenders: r.tenders_role || null },
    lastLoginAt: r.last_login_at,
  };
}
// The role a user has in one app. Hub admins are admins everywhere.
function roleFor(user, app) {
  if (!user) return null;
  if (user.isAdmin) return 'admin';
  return user.roles[app] || null;
}
function cleanRoles(roles) {
  const out = {};
  APPS.forEach(app => {
    const r = roles && roles[app];
    out[app] = APP_ROLES[app].includes(r) ? r : null;
  });
  return out;
}

// ---------- Logins carried over from the old apps ----------
// The old apps had password-only logins per department. Each one becomes a
// hub user with access to that one app only, keeping the same password.
const LEGACY_PREFIX = { report: 'report', tracker: 'tracker', tenders: 'tender' };
const APP_NAMES = { report: 'Report', tracker: 'Tracker', tenders: 'Tender Tracker' };
function legacyUsername(app, role) {
  return LEGACY_PREFIX[app] + '-' + String(role).replace(/[^a-z0-9]/gi, '').toLowerCase();
}
// Creates the login unless that username already exists (never overwrites).
async function addLegacyLogin(app, role, label, passwordHash) {
  if (!APP_ROLES[app].includes(role) || !passwordHash) return false;
  const roles = { report: null, tracker: null, tenders: null };
  roles[app] = role;
  const { rowCount } = await pool.query(
    `INSERT INTO hub_users (username, name, password_hash, is_admin, report_role, tracker_role, tenders_role)
     VALUES ($1,$2,$3,false,$4,$5,$6) ON CONFLICT (username) DO NOTHING`,
    [legacyUsername(app, role), `${APP_NAMES[app]} – ${label}`, passwordHash, roles.report, roles.tracker, roles.tenders]
  );
  return rowCount > 0;
}
// profiles: the old Report/Tracker backup's profiles [{id, label, passwordHash}]
async function importLegacyProfiles(app, profiles) {
  const created = [];
  for (const p of Array.isArray(profiles) ? profiles : []) {
    if (!p || !/^[0-9a-f]{64}$/i.test(String(p.passwordHash || ''))) continue;
    if (await addLegacyLogin(app, p.id, p.label || p.id, 'sha256$' + p.passwordHash.toLowerCase())) {
      created.push(legacyUsername(app, p.id));
    }
  }
  return created;
}
// Tender Tracker kept its two passwords in the settings table of this same
// database, so those logins are created once, on first start.
async function importTenderLogins() {
  if (await getDoc('legacy_tender_logins')) return;
  let rows = [];
  try {
    ({ rows } = await pool.query("SELECT key, value FROM settings WHERE key IN ('admin_password','entry_password')"));
  } catch (e) { return; }
  const created = [];
  for (const r of rows) {
    const role = r.key === 'admin_password' ? 'admin' : 'entry';
    const label = role === 'admin' ? 'Admin' : 'Entry';
    if (await addLegacyLogin('tenders', role, label, hashPassword(r.value))) created.push(legacyUsername('tenders', role));
  }
  await setDoc('legacy_tender_logins', { at: new Date().toISOString(), created });
  if (created.length) console.log('Created Tender Tracker logins: ' + created.join(', '));
}

// Sets passwords from the RESET_PASSWORDS environment variable, e.g.
// {"admin":"NewPass1","tender-entry":"entry2026"}. Each distinct value is
// applied once only, so people can still change their own password later.
async function applyPasswordResets() {
  const raw = process.env.RESET_PASSWORDS;
  if (!raw) return;
  let wanted;
  try { wanted = JSON.parse(raw); } catch (e) { console.error('RESET_PASSWORDS is not valid JSON.'); return; }
  const fingerprint = crypto.createHash('sha256').update(raw).digest('hex');
  const done = await getDoc('password_reset');
  if (done && done.fingerprint === fingerprint) return;
  const changed = [], missing = [];
  for (const [username, password] of Object.entries(wanted || {})) {
    const { rowCount } = await pool.query('UPDATE hub_users SET password_hash = $1 WHERE username = $2',
      [hashPassword(password), normUsername(username)]);
    (rowCount ? changed : missing).push(username);
  }
  await setDoc('password_reset', { at: new Date().toISOString(), fingerprint, changed, missing });
  console.log(`Password reset: set ${changed.join(', ') || 'none'}${missing.length ? '; not found: ' + missing.join(', ') : ''}`);
}

async function getUser(id) {
  const { rows } = await pool.query('SELECT * FROM hub_users WHERE id = $1', [id]);
  return publicUser(rows[0]);
}
async function findForLogin(username) {
  const { rows } = await pool.query('SELECT * FROM hub_users WHERE username = $1', [normUsername(username)]);
  return rows[0] || null;
}
async function markLogin(id) {
  await pool.query('UPDATE hub_users SET last_login_at = now() WHERE id = $1', [id]);
}
async function listUsers() {
  const { rows } = await pool.query('SELECT * FROM hub_users ORDER BY is_admin DESC, lower(coalesce(name, username))');
  return rows.map(publicUser);
}
async function createUser({ username, name, password, isAdmin, roles }) {
  const u = normUsername(username);
  if (!u) throw userError('Username is required.');
  if (!password || String(password).length < 6) throw userError('Password must be at least 6 characters.');
  const r = cleanRoles(roles);
  try {
    const { rows } = await pool.query(
      `INSERT INTO hub_users (username, name, password_hash, is_admin, report_role, tracker_role, tenders_role)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [u, name || null, hashPassword(password), !!isAdmin, r.report, r.tracker, r.tenders]
    );
    return publicUser(rows[0]);
  } catch (e) {
    if (e.code === '23505') throw userError('That username is already taken.');
    throw e;
  }
}
async function updateUser(id, { name, isAdmin, roles }) {
  const r = cleanRoles(roles);
  if (!isAdmin) await ensureAnotherAdmin(id);
  const { rows } = await pool.query(
    `UPDATE hub_users SET name = $1, is_admin = $2, report_role = $3, tracker_role = $4, tenders_role = $5
     WHERE id = $6 RETURNING *`,
    [name || null, !!isAdmin, r.report, r.tracker, r.tenders, id]
  );
  return publicUser(rows[0]);
}
async function setPassword(id, password) {
  if (!password || String(password).length < 6) throw userError('Password must be at least 6 characters.');
  const { rowCount } = await pool.query('UPDATE hub_users SET password_hash = $1 WHERE id = $2', [hashPassword(password), id]);
  return rowCount > 0;
}
async function deleteUser(id) {
  await ensureAnotherAdmin(id);
  const { rowCount } = await pool.query('DELETE FROM hub_users WHERE id = $1', [id]);
  return rowCount > 0;
}
// Never let the last admin be removed or demoted, or nobody could manage logins.
async function ensureAnotherAdmin(id) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM hub_users WHERE is_admin AND id <> $1', [id]);
  const { rows: me } = await pool.query('SELECT is_admin FROM hub_users WHERE id = $1', [id]);
  if (me[0] && me[0].is_admin && rows[0].n === 0) throw userError('There must always be at least one admin.');
}
function userError(message) {
  const e = new Error(message);
  e.userFacing = true;
  return e;
}

// ---------- JSON documents (Report / Tracker data) ----------
async function getDoc(key) {
  const { rows } = await pool.query('SELECT data FROM app_docs WHERE key = $1', [key]);
  return rows[0] ? rows[0].data : null;
}
async function setDoc(key, data) {
  await pool.query(
    `INSERT INTO app_docs (key, data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [key, JSON.stringify(data)]
  );
}

// ---------- Tracker bills ----------
async function listBills() {
  const { rows } = await pool.query('SELECT id, site, month, file_name, size_bytes, uploaded_at FROM tracker_bills');
  return rows.map(r => ({ id: r.id, site: r.site, month: r.month, fileName: r.file_name, size: r.size_bytes, uploadedAt: Number(r.uploaded_at) }));
}
async function addBill({ id, site, month, fileName, uploadedAt, buffer }) {
  await pool.query(
    `INSERT INTO tracker_bills (id, site, month, file_name, size_bytes, uploaded_at, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
    [id, site, month, fileName, buffer.length, uploadedAt || Date.now(), buffer]
  );
}
async function getBill(id) {
  const { rows } = await pool.query('SELECT * FROM tracker_bills WHERE id = $1', [id]);
  return rows[0] || null;
}
async function removeBill(id) {
  const { rowCount } = await pool.query('DELETE FROM tracker_bills WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = {
  importLegacyProfiles, legacyUsername,
  APPS, APP_ROLES, init, hashPassword, checkPassword, roleFor,
  getUser, findForLogin, markLogin, listUsers, createUser, updateUser, setPassword, deleteUser,
  getDoc, setDoc, listBills, addBill, getBill, removeBill,
};
