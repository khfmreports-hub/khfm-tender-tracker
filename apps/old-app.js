// Talks to the OLD khfm-report / khfm-tracker services once, to copy their
// data into the combined app. Uses each old app's own login + backup API.
function normalizeBase(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (e) { throw new Error('Enter the full address of the old app, e.g. https://khfm-report.onrender.com'); }
  if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
    throw new Error('The old app address must start with https://');
  }
  return u.origin;
}

async function readJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { return { error: text.slice(0, 200) }; }
}

async function fetchOldBackup(rawBase, password) {
  const base = normalizeBase(rawBase);
  let res;
  try {
    res = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch (e) {
    throw new Error(`Could not reach ${base}. Is the old app still running?`);
  }
  const login = await readJson(res);
  if (!res.ok || !login.token) throw new Error('The old app rejected that password: ' + (login.error || res.status));
  if (!login.profile || login.profile.id !== 'admin') {
    throw new Error('Use the old app\'s full-access (admin) password, not a department password.');
  }
  const headers = { Authorization: 'Bearer ' + login.token };
  const backupRes = await fetch(base + '/api/admin/backup', { headers });
  const backup = await readJson(backupRes);
  if (!backupRes.ok) throw new Error('Could not download the old app\'s data: ' + (backup.error || backupRes.status));

  async function download(pathname) {
    const r = await fetch(base + pathname, { headers });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  }
  async function logout() {
    try { await fetch(base + '/api/logout', { method: 'POST', headers }); } catch (e) { /* ignore */ }
  }
  return { backup, download, logout };
}

module.exports = { fetchOldBackup, normalizeBase };
