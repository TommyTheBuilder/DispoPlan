const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const PORT = Number(process.env.PORT || 3004);
const AUTO_CREATE_STATE_TABLE = process.env.AUTO_CREATE_STATE_TABLE !== 'false';
const STATE_TABLE = process.env.STATE_TABLE || 'app_state';

function toSqlIdentifier(value) {
  const parts = String(value).split('.');
  if (!parts.every((part) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(part))) {
    throw new Error(`Invalid STATE_TABLE identifier: ${value}`);
  }
  return parts.map((part) => `"${part}"`).join('.');
}

const STATE_TABLE_SQL = toSqlIdentifier(STATE_TABLE);

function createDbConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }

  const rawPassword = process.env.DB_PASSWORD ?? process.env.PGPASSWORD ?? '';

  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: String(rawPassword),
    database: process.env.DB_NAME || 'dispoplan',
  };
}

const dbConfig = createDbConfig();
const pool = new Pool(dbConfig);

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));

async function initDb() {
  if (!AUTO_CREATE_STATE_TABLE) return;

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${STATE_TABLE_SQL} (
        id SMALLINT PRIMARY KEY DEFAULT 1,
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT single_row CHECK (id = 1)
      )
    `);
  } catch (error) {
    if (error?.code === '42501') {
      console.warn(`No CREATE permission for table ${STATE_TABLE}. Continuing without auto-create.`);
      return;
    }
    throw error;
  }
}

async function ensureStateTableReadable() {
  try {
    await pool.query(`SELECT id FROM ${STATE_TABLE_SQL} LIMIT 1`);
  } catch (error) {
    if (error?.code === '42P01') {
      console.warn(`State table ${STATE_TABLE} does not exist. Create it manually or grant CREATE permissions.`);
      return;
    }
    if (error?.code === '42501') {
      console.warn(`Missing privileges on ${STATE_TABLE}. Grant SELECT/INSERT/UPDATE rights to DB user.`);
      return;
    }
    throw error;
  }
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, table: STATE_TABLE });
  } catch (_error) {
    res.status(500).json({ ok: false, error: 'database_unavailable' });
  }
});

app.get('/api/state', async (_req, res) => {
  try {
    const result = await pool.query(`SELECT state FROM ${STATE_TABLE_SQL} WHERE id = 1`);
    res.json(result.rows[0]?.state || null);
  } catch (error) {
    console.error('GET /api/state failed:', error.message || error);
    res.status(500).json({ error: 'failed_to_read_state' });
  }
});

app.put('/api/state', async (req, res) => {
  const nextState = req.body;
  if (!nextState || typeof nextState !== 'object') {
    return res.status(400).json({ error: 'invalid_state_payload' });
  }

  try {
    await pool.query(
      `INSERT INTO ${STATE_TABLE_SQL} (id, state, updated_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id)
       DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
      [JSON.stringify(nextState)],
    );
    return res.status(204).send();
  } catch (error) {
    console.error('PUT /api/state failed:', error.message || error);
    return res.status(500).json({ error: 'failed_to_save_state' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

initDb()
  .then(ensureStateTableReadable)
  .then(() => {
    if (dbConfig.connectionString) {
      console.log('Database config: using DATABASE_URL');
    } else {
      console.log(`Database config: ${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database} (password: ${dbConfig.password ? 'set' : 'empty'})`);
    }
    console.log(`State table: ${STATE_TABLE} (auto-create: ${AUTO_CREATE_STATE_TABLE})`);
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`DispoPlan listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Startup failed:', error);
    process.exit(1);
  });
