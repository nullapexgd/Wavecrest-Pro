// Health check. Anyone gets only whether the app and database are up. Which secrets are
// configured, the deployed commit and database error text help an attacker choose targets and
// help no one else, so they are shown only to a caller presenting x-admin-secret.
import crypto from 'node:crypto';
import { getPool } from '../lib/db.js';

const REQUIRED_ENV = ['YOUTUBE_API_KEY', 'GROQ_API_KEY', 'RESEND_API_KEY', 'SESSION_SECRET'];
const DB_ENV = ['DB_URL', 'DATABASE_URL'];

function isAdmin(req) {
  const secret = process.env.ADMIN_SECRET;
  const given = String(req.headers['x-admin-secret'] || '');
  return Boolean(secret) && given.length === secret.length
    && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }
  res.setHeader('Cache-Control', 'no-store');

  const env = Object.fromEntries(REQUIRED_ENV.map(k => [k, Boolean(process.env[k])]));
  env.database = DB_ENV.some(k => Boolean(process.env[k]));
  env.kv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

  let db = false;
  let dbError;
  try {
    const r = await getPool().query('SELECT 1 AS ok');
    db = r.rows[0]?.ok === 1;
  } catch (err) {
    dbError = err.message;
    console.error('[health] DB check failed:', err.message);
  }

  const ok = db && Object.values(env).every(Boolean);
  const status = ok ? 200 : 503;
  if (!isAdmin(req)) return res.status(status).json({ ok, db });
  return res.status(status).json({
    ok, db, ...(dbError ? { dbError } : {}), env,
    deployment: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'local'
  });
}
