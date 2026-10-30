#!/usr/bin/env node
// Mutate a disposable copy so the working tree's production code stays untouched.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'wavecrest-mutations-'));
const mutations = [
  ['tag resolution', 'vmap.get(t)]).filter', '(vmap.get(t) || top[0])]).filter'],
  ['supports()', 'export function supports(claim, video) {', 'export function supports(claim, video) { return true;'],
  ['quote substring', 'v.title.includes(q)', 'true'],
  ['gap presence', 'if (present(opp))', 'if (false)'],
  ['idea duplicate', 'const near = corpusTitles.find(t => jaccard(t, title) >= 0.75);', 'const near = null;'],
  ['brand future-entity', "if (type === 'brand') { //", 'if (false) { //'],
  ['demographic scrub', 'const DEMOGRAPHIC = /', 'const DEMOGRAPHIC = /(?!)']
];
try {
  for (const path of ['lib', 'scripts/eval-live.js', 'test/eval/fixtures', 'test/eval/cases', 'test/eval/enforce-eval.test.js']) {
    mkdirSync(dirname(join(temp, path)), { recursive: true });
    cpSync(join(root, path), join(temp, path), { recursive: true });
  }
  writeFileSync(join(temp, 'package.json'), '{"type":"module"}\n');
  const target = join(temp, 'lib/analysis-enforce.js');
  const source = readFileSync(target, 'utf8');
  const run = () => spawnSync(process.execPath, ['--test', '--test-name-pattern=cited evidence', 'test/eval/enforce-eval.test.js'], { cwd: temp, encoding: 'utf8' });
  const baseline = run();
  assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
  for (const [name, before, after] of mutations) {
    assert.equal(source.split(before).length, 2, `${name}: mutation must match exactly once`);
    writeFileSync(target, source.replace(before, after));
    const result = run();
    assert.equal(result.status, 1, `${name}: mutation survived\n${result.stdout}${result.stderr}`);
    assert.match(result.stdout + result.stderr, /AssertionError/, `${name}: expected assertion failure, not a crash`);
    console.log(`PASS: ${name} mutation caught`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
