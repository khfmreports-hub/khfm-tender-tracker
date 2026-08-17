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
      note TEXT,
      status TEXT NOT NULL DEFAULT 'Pending',
      status_detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

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
    `INSERT INTO tenders (sr, org, tender_id, due, work, estimate, emd, emd_type, note, status, status_detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      sr,
      data.org || null,
      data.tenderId || null,
      data.due || null,
      data.work || null,
      data.estimate ?? null,
      data.emd ?? null,
      data.emdType || null,
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
       emd = $6, emd_type = $7, note = $8, status = $9, status_detail = $10,
       updated_at = now()
     WHERE id = $11 RETURNING *`,
    [
      data.org || null,
      data.tenderId || null,
      data.due || null,
      data.work || null,
      data.estimate ?? null,
      data.emd ?? null,
      data.emdType || null,
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

module.exports = { pool, init, listTenders, createTender, updateTender, deleteTender };
