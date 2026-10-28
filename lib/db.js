import pg from 'pg';
const { Pool } = pg;

let pool;
export function getPool() {
  if (!pool) {
    const connectionString = process.env.DB_URL || process.env.DATABASE_URL;
    if (!connectionString) throw new Error('No DB_URL or DATABASE_URL set');
    pool = new Pool({
      connectionString,
      ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: true }
    });
    // An idle client dropped by the server must not crash the function.
    pool.on('error', err => console.error('[db] idle client error:', err.message));
  }
  return pool;
}

// Schema lives only in migrations/ (npm run migrate). The request-time CREATE/ALTER that
// used to live here is gone: it hid missing migrations and ran DDL on a user's request.
// Reports are written and read only through lib/reports.js.
