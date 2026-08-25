const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenders (
      id SERIAL PRIMARY KEY,
      sr INTEGER,
      org TEXT,
      tender_id TEXT,
      due DATE,
      work TEXT,
      estimate NUMERIC,
      emd NUMERIC,
      emd_type TEXT,
      emd_due DATE,
      emd_paid BOOLEAN NOT NULL DEFAULT false,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'Pending',
      status_detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Migrate older deployments that created the table before these columns existed.
  await pool.query(`ALTER TABLE tenders ADD COLUMN IF NOT EXISTS emd_due DATE;`);
  await pool.query(`ALTER TABLE tenders ADD COLUMN IF NOT EXISTS emd_paid BOOLEAN NOT NULL DEFAULT false;`);
  await pool.query(`ALTER TABLE tenders ADD COLUMN IF NOT EXISTS entered_date DATE;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS attachments (
      id SERIAL PRIMARY KEY,
      tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      data BYTEA NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Seed password settings from env vars on first run only.
  // After this, the database is the source of truth so passwords can be
  // changed at runtime from the Manage page without redeploying.
  const { rows: existing } = await pool.query(
    "SELECT key FROM settings WHERE key IN ('admin_password','entry_password')"
  );
  const have = new Set(existing.map(r => r.key));
  if (!have.has('admin_password')) {
    await pool.query('INSERT INTO settings (key, value) VALUES ($1,$2)', [
      'admin_password', process.env.ADMIN_PASSWORD || 'admin2026',
    ]);
  }
  if (!have.has('entry_password')) {
    await pool.query('INSERT INTO settings (key, value) VALUES ($1,$2)', [
      'entry_password', process.env.ENTRY_PASSWORD || 'entry2026',
    ]);
  }

  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM tenders');
  if (rows[0].n === 0) {
    const seedPath = path.join(__dirname, 'seed_data.json');
    if (fs.existsSync(seedPath)) {
      const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
      for (const r of seed) {
        await pool.query(
          `INSERT INTO tenders (sr, org, tender_id, due, work, estimate, emd, emd_type, note, status, status_detail)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [r.sr, r.org, r.tenderId, r.due, r.work, r.estimate, r.emd, r.emdType, r.note, r.status, r.statusDetail]
        );
      }
      console.log(`Seeded ${seed.length} tenders.`);
    }
  }
}

async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : null;
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1,$2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
}

function rowToApi(r) {
  return {
    id: r.id,
    sr: r.sr,
    org: r.org,
    tenderId: r.tender_id,
    due: r.due ? new Date(r.due).toISOString().slice(0, 10) : null,
    work: r.work,
    estimate: r.estimate !== null ? Number(r.estimate) : null,
    emd: r.emd !== null ? Number(r.emd) : null,
    emdType: r.emd_type,
    emdDue: r.emd_due ? new Date(r.emd_due).toISOString().slice(0, 10) : null,
    emdPaid: !!r.emd_paid,
    enteredDate: r.entered_date ? new Date(r.entered_date).toISOString().slice(0, 10) : null,
    note: r.note,
    status: r.status,
    statusDetail: r.status_detail,
  };
}

async function listTenders() {
  const { rows } = await pool.query('SELECT * FROM tenders ORDER BY sr NULLS LAST, id');
  return rows.map(rowToApi);
}

async function nextSr() {
  const { rows } = await pool.query('SELECT COALESCE(MAX(sr),0)::int + 1 AS n FROM tenders');
  return rows[0].n;
}

async function createTender(data) {
  const sr = await nextSr();
  const { rows } = await pool.query(
    `INSERT INTO tenders (sr, org, tender_id, due, work, estimate, emd, emd_type, emd_due, emd_paid, entered_date, note, status, status_detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      sr,
      data.org || null,
      data.tenderId || null,
      data.due || null,
      data.work || null,
      data.estimate ?? null,
      data.emd ?? null,
      data.emdType || null,
      data.emdDue || null,
      !!data.emdPaid,
      data.enteredDate || null,
      data.note || null,
      data.status || 'Pending',
      data.statusDetail || null,
    ]
  );
  return rowToApi(rows[0]);
}

async function updateTender(id, data) {
  const { rows } = await pool.query(
    `UPDATE tenders SET
       org = $1, tender_id = $2, due = $3, work = $4, estimate = $5,
       emd = $6, emd_type = $7, emd_due = $8, emd_paid = $9, entered_date = $10, note = $11, status = $12, status_detail = $13,
       updated_at = now()
     WHERE id = $14 RETURNING *`,
    [
      data.org || null,
      data.tenderId || null,
      data.due || null,
      data.work || null,
      data.estimate ?? null,
      data.emd ?? null,
      data.emdType || null,
      data.emdDue || null,
      !!data.emdPaid,
      data.enteredDate || null,
      data.note || null,
      data.status || 'Pending',
      data.statusDetail || null,
      id,
    ]
  );
  return rows[0] ? rowToApi(rows[0]) : null;
}

async function deleteTender(id) {
  const { rowCount } = await pool.query('DELETE FROM tenders WHERE id = $1', [id]);
  return rowCount > 0;
}

// ---------- Attachments ----------
async function listAttachments(tenderId) {
  const { rows } = await pool.query(
    'SELECT id, tender_id, filename, mimetype, size_bytes, uploaded_at FROM attachments WHERE tender_id = $1 ORDER BY uploaded_at DESC',
    [tenderId]
  );
  return rows.map(r => ({
    id: r.id,
    tenderId: r.tender_id,
    filename: r.filename,
    mimetype: r.mimetype,
    sizeBytes: r.size_bytes,
    uploadedAt: r.uploaded_at,
  }));
}

async function addAttachment(tenderId, file) {
  const { rows } = await pool.query(
    `INSERT INTO attachments (tender_id, filename, mimetype, size_bytes, data)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, tender_id, filename, mimetype, size_bytes, uploaded_at`,
    [tenderId, file.originalname, file.mimetype, file.size, file.buffer]
  );
  const r = rows[0];
  return {
    id: r.id, tenderId: r.tender_id, filename: r.filename,
    mimetype: r.mimetype, sizeBytes: r.size_bytes, uploadedAt: r.uploaded_at,
  };
}

async function getAttachmentFile(attId) {
  const { rows } = await pool.query('SELECT * FROM attachments WHERE id = $1', [attId]);
  return rows[0] || null;
}

async function deleteAttachment(attId) {
  const { rowCount } = await pool.query('DELETE FROM attachments WHERE id = $1', [attId]);
  return rowCount > 0;
}

module.exports = {
  pool, init, listTenders, createTender, updateTender, deleteTender, getSetting, setSetting,
  listAttachments, addAttachment, getAttachmentFile, deleteAttachment,
};
