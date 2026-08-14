const { Pool } = require('pg');
const SEED = require('./seed-data.json');

const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !isLocal ? { rejectUnauthorized: false } : false,
});

async function ensureSchema() {
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
      note TEXT,
      status TEXT DEFAULT 'Pending',
      status_detail TEXT,
      created_at TIMESTAMP DEFAULT now()
    );
  `);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM tenders');
  if (rows[0].n === 0 && SEED.length) {
    for (const t of SEED) {
      await pool.query(
        `INSERT INTO tenders (sr, org, tender_id, due, work, estimate, emd, emd_type, note, status, status_detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [t.sr, t.org, t.tenderId, t.due, t.work, t.estimate, t.emd, t.emdType, t.note, t.status, t.statusDetail]
      );
    }
    console.log(`Seeded ${SEED.length} tenders into database`);
  }
}

async function getAllTenders() {
  const { rows } = await pool.query('SELECT * FROM tenders ORDER BY sr ASC, id ASC');
  return rows.map(r => ({
    sr: r.sr,
    org: r.org,
    tenderId: r.tender_id,
    due: r.due ? new Date(r.due).toISOString().slice(0, 10) : null,
    work: r.work,
    estimate: r.estimate !== null ? Number(r.estimate) : null,
    emd: r.emd !== null ? Number(r.emd) : null,
    emdType: r.emd_type,
    note: r.note,
    status: r.status || 'Pending',
    statusDetail: r.status_detail,
  }));
}

async function addTender(t) {
  const { rows } = await pool.query('SELECT COALESCE(MAX(sr), 0) + 1 AS next FROM tenders');
  const nextSr = rows[0].next;
  await pool.query(
    `INSERT INTO tenders (sr, org, tender_id, due, work, estimate, emd, emd_type, note, status, status_detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      nextSr,
      t.org || null,
      t.tenderId || null,
      t.due || null,
      t.work || null,
      t.estimate ? Number(t.estimate) : null,
      t.emd ? Number(t.emd) : null,
      t.emdType || null,
      t.note || null,
      t.status || 'Pending',
      t.statusDetail || null,
    ]
  );
  return nextSr;
}

module.exports = { pool, ensureSchema, getAllTenders, addTender };
