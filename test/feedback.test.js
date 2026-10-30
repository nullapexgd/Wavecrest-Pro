import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeReq, makeRes, everythingSent } from './helpers/http.js';

process.env.SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';
const { makeFeedbackHandler } = await import('../lib/handlers/feedback.js');

const USER = { id: 'u-1', email: 'creator@example.test', plan: 'free' };
const ENV = { RESEND_API_KEY: 're_SECRET', FROM_EMAIL: 'Wavecrest <hello@example.test>', NOTIFY_EMAIL: 'owner@example.test' };
const RID = '123e4567-e89b-42d3-a456-426614174000';
function rig(over = {}) {
  const sent = [];
  const handler = makeFeedbackHandler({ getUser: async () => USER, send: async m => { sent.push(m); }, env: ENV, ...over });
  return { handler, sent };
}
const post = (body, extra = {}) => makeReq({ method: 'POST', body, userId: USER.id, ...extra });

test('signed-in feedback is emailed to the owner with the account email and report id', async () => {
  const { handler, sent } = rig();
  const res = makeRes();
  await handler(post({ useful: 'no', message: 'Missing thumbnails', reportId: RID }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'owner@example.test');
  assert.match(sent[0].html, /Not useful/);
  assert.match(sent[0].html, /creator@example\.test/);
  assert.match(sent[0].html, new RegExp(RID));
  assert.doesNotMatch(everythingSent(res), /re_SECRET|owner@example/);
});

test('message text is escaped and capped', async () => {
  const { handler, sent } = rig();
  await handler(post({ useful: 'yes', message: '<script>alert(1)</script>' + 'x'.repeat(5000) }), makeRes());
  assert.doesNotMatch(sent[0].html, /<script>/);
  assert.ok(sent[0].html.length < 1500);
});

test('anonymous, cross-site, wrong method and invalid input send nothing', async () => {
  for (const [req, status, anon] of [
    [post({ useful: 'yes' }), 401, true],
    [post({ useful: 'yes' }, { headers: { 'sec-fetch-site': 'cross-site' } }), 403],
    [makeReq({ method: 'GET', userId: USER.id }), 405],
    [post({ useful: 'maybe' }), 400],
    [post({}), 400]
  ]) {
    const { handler, sent } = rig(anon ? { getUser: async () => null } : {});
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, status);
    assert.equal(sent.length, 0);
  }
});

test('a malformed report id is dropped, not emailed; missing email config answers 503; a send failure leaks nothing', async () => {
  const a = rig(); await a.handler(post({ useful: 'yes', reportId: '<b>nope</b>' }), makeRes());
  assert.doesNotMatch(a.sent[0].html, /nope|report /);
  const b = rig({ env: { RESEND_API_KEY: 'x' } }); const rb = makeRes(); await b.handler(post({ useful: 'yes' }), rb);
  assert.equal(rb.statusCode, 503); assert.equal(b.sent.length, 0);
  const c = rig({ send: async () => { throw new Error('resend 500 key re_SECRET'); } }); const rc = makeRes(); await c.handler(post({ useful: 'yes' }), rc);
  assert.equal(rc.statusCode, 502);
  assert.doesNotMatch(everythingSent(rc), /re_SECRET|resend 500/);
});
