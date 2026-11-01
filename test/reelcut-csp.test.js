import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const csp = source => cfg.headers.find(h => h.source === source)?.headers.find(x => x.key === 'Content-Security-Policy')?.value;
const directive = (policy, name) => policy.split(';').map(s => s.trim()).find(s => s.startsWith(name + ' '));

test('the strict policy no longer matches /reelcut, and still has no outside hosts', () => {
  const generic = cfg.headers.find(h => h.headers.some(x => x.key === 'Content-Security-Policy' && h.source !== '/reelcut'));
  const re = new RegExp(`^${generic.source}$`);
  assert.equal(re.test('/reelcut'), false);
  for (const p of ['/', '/app', '/login', '/pricing', '/privacy', '/sample']) assert.equal(re.test(p), true, p);
  assert.equal(directive(csp(generic.source), 'connect-src'), "connect-src 'self'");
  assert.doesNotMatch(csp(generic.source), /wasm-unsafe-eval|huggingface|worker-src/);
});

test('/reelcut allows on-device transcription and nothing broader', () => {
  const p = csp('/reelcut');
  assert.match(directive(p, 'script-src'), /'wasm-unsafe-eval'/);
  assert.doesNotMatch(p, /'unsafe-eval'|\*\s|jsdelivr|unpkg|cdnjs/); // no CDN scripts, no eval; the runtime is self-hosted
  assert.equal(directive(p, 'connect-src'), "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co");
  assert.equal(directive(p, 'worker-src'), "worker-src 'self' blob:");
  for (const keep of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"]) assert.ok(p.includes(keep), keep);
});

test('every inline script on the built Reelcut page is hashed in its policy (needs web/dist)', { skip: !existsSync(new URL('../web/dist/reelcut.html', import.meta.url)) && 'run the web build first' }, () => {
  const html = readFileSync(new URL('../web/dist/reelcut.html', import.meta.url), 'utf8');
  const p = csp('/reelcut');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(inline.length > 0);
  for (const body of inline) assert.ok(p.includes(`'sha256-${createHash('sha256').update(body).digest('base64')}'`), 'inline script not covered');
});
