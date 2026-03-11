require("dotenv").config();

const password = process.env.DB_PASSWORD;
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const PORT = Number(process.env.PORT || 3004);

function createDbConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
    };
  }

  const host = process.env.DB_HOST || '127.0.0.1';
  const port = Number(process.env.DB_PORT || 5432);
  const user = process.env.DB_USER || 'paletten_user';
  const database = process.env.DB_NAME || 'dispoplan';

  // SCRAM in node-postgres requires a string password value.
  // Coerce explicitly so accidental non-string env assignment cannot break startup.
  const rawPassword = process.env.DB_PASSWORD ?? process.env.PGPASSWORD ?? '';
  const password = String(DEIN_PASSWORT);

  return {
    host,
    port,
    user,
    password,
    database,
  };
}

const dbConfig = createDbConfig();
const pool = new Pool(dbConfig);

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT single_row CHECK (id = 1)
    )
  `);
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'database_unavailable' });
  }
});

app.get('/api/state', async (_req, res) => {
  try {
    const result = await pool.query('SELECT state FROM app_state WHERE id = 1');
    res.json(result.rows[0]?.state || null);
  } catch (error) {
    console.error('GET /api/state failed:', error);
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
      `INSERT INTO app_state (id, state, updated_at)
       VALUES (1, $1::jsonb, NOW())
       ON CONFLICT (id)
       DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
      [JSON.stringify(nextState)],
    );
    return res.status(204).send();
  } catch (error) {
    console.error('PUT /api/state failed:', error);
    return res.status(500).json({ error: 'failed_to_save_state' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

initDb()
  .then(() => {
    if (dbConfig.connectionString) {
      console.log('Database config: using DATABASE_URL');
    } else {
      console.log(`Database config: ${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database} (password: ${dbConfig.password ? 'set' : 'empty'})`);
    }
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`DispoPlan listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Startup failed:', error);
    process.exit(1);
  });
