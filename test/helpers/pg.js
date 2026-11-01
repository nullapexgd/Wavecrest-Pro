// A throwaway Postgres for integration tests: private temp directory, unix socket only
// (no TCP listener), fsync off, destroyed afterwards. It never reads DATABASE_URL, DB_URL
// or .env.local, so a test can never reach a real database.
//
// Needs the Postgres server binaries (`brew install postgresql@16`). Without them the
// integration tests are SKIPPED and say so; they do not silently pass.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANDIDATES = [
  process.env.PG_BIN_DIR,
  '/opt/homebrew/opt/postgresql@16/bin',
  '/opt/homebrew/opt/postgresql@17/bin',
  '/usr/local/opt/postgresql@16/bin',
  '/usr/lib/postgresql/16/bin',
  '/usr/bin' // Arch and other distros that install the server binaries on the PATH
].filter(Boolean);

export function findPgBin() {
  return CANDIDATES.find(d => existsSync(join(d, 'initdb')) && existsSync(join(d, 'pg_ctl'))) || null;
}

export const PG_SKIP = findPgBin() ? false : 'postgres server binaries not found (brew install postgresql@16)';

// macOS: the postmaster aborts ("became multithreaded during startup") without a valid locale.
const ENV = { ...process.env, LC_ALL: 'en_US.UTF-8' };

function run(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8', env: ENV });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

/** Starts the server, applies every migration in order, returns { pool, stop }. */
export async function startTempPostgres({ migrate = true, max = 40 } = {}) {
  const bin = findPgBin();
  if (!bin) throw new Error(PG_SKIP);
  const dir = mkdtempSync(join(tmpdir(), 'wc-pg-'));
  const data = join(dir, 'data');
  run(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'test', '-E', 'UTF8', '--locale=C', '--no-sync']);
  run(join(bin, 'pg_ctl'), [
    '-D', data, '-l', join(dir, 'log'), '-w', 'start',
    '-o', `-k ${dir} -c listen_addresses= -c fsync=off -c synchronous_commit=off -c max_connections=200`
  ]);

  const admin = new pg.Pool({ host: dir, user: 'test', database: 'postgres', max: 1 });
  await admin.query('CREATE DATABASE app');
  await admin.end();

  const pool = new pg.Pool({ host: dir, user: 'test', database: 'app', max });
  if (migrate) {
    const files = readdirSync(join(ROOT, 'migrations')).filter(f => f.endsWith('.sql')).sort();
    for (const f of files) await pool.query(readFileSync(join(ROOT, 'migrations', f), 'utf8'));
  }

  return {
    pool,
    options: { host: dir, user: 'test', database: 'app' }, // for tests that need their own pool
    async stop() {
      await pool.end().catch(() => {});
      spawnSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { env: ENV });
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

let seq = 0;
export async function makeUser(pool, plan = 'free') {
  const n = ++seq;
  const r = await pool.query(
    `INSERT INTO users (email, name, provider, provider_id, plan) VALUES ($1,$2,'github',$3,$4)
     RETURNING id, email, plan`,
    [`user${n}-${Date.now()}@example.test`, `User ${n}`, `gh-${n}-${Date.now()}`, plan]
  );
  return r.rows[0];
}

export async function makeReport(pool, { userId = null, visibility, name = 'Example Studio' } = {}) {
  const cols = visibility ? ', visibility' : '';
  const vals = visibility ? ',$6' : '';
  const params = ['UCtest' + Math.random().toString(36).slice(2, 10), name, '@example', 1234, userId];
  if (visibility) params.push(visibility);
  const r = await pool.query(
    `INSERT INTO reports (channel_id, channel_name, channel_handle, subscriber_count, user_id, video_count, analysis${cols})
     VALUES ($1,$2,$3,$4,$5, 50, '{"hooks":{"primaryPattern":"secret strategy"}}'::jsonb${vals}) RETURNING id`,
    params
  );
  return r.rows[0].id;
}
