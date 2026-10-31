// POST /api/feedback { useful: 'yes'|'no', message?, reportId? }  signed-in, same-origin only.
// Emails the owner (NOTIFY_EMAIL, one address or several separated by commas) through Resend; nothing is stored. The email carries the sender's account
// email so a follow-up call can be offered; privacy.html says so.
import { getUser as realGetUser } from '../auth.js';
import { jsonBody, noStore, isSameOrigin, UUID_RE } from '../http.js';
import { reportError } from '../monitor.js';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MAX_MESSAGE = 1000;
// a bare address, or a display name in front of one: Wavecrest <dev@wavecrest.pro>
const ADDR = '[^\\s@,<>]+@[^\\s@,<>]+\\.[^\\s@,<>]+';
const EMAIL = new RegExp(`^(?:${ADDR}|[^<>@,]+<${ADDR}>)$`);
// Several recipients are a safety net: a bounce at one provider (e.g. a blocklisted shared sending IP) must not lose the feedback.
const recipients = list => String(list || '').split(',').map(a => a.trim()).filter(a => EMAIL.test(a));

async function sendViaResend({ apiKey, from, to, subject, html }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
    signal: AbortSignal.timeout(6000)
  });
  if (!r.ok) throw new Error(`resend ${r.status}`);
}

export function makeFeedbackHandler({ getUser = realGetUser, send = sendViaResend, env = process.env, db } = {}) {
  return async function handler(req, res) {
    noStore(res);
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }); }
    if (!isSameOrigin(req)) return res.status(403).json({ error: 'Cross-site request refused', code: 'FORBIDDEN' });
    try {
      const user = await getUser(req, db).catch(() => null);
      if (!user) return res.status(401).json({ error: 'Sign in to send feedback', code: 'AUTH_REQUIRED' });

      const body = jsonBody(req);
      const useful = body.useful === 'yes' || body.useful === 'no' ? body.useful : null;
      const message = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE) : '';
      const reportId = typeof body.reportId === 'string' && UUID_RE.test(body.reportId) ? body.reportId : null;
      if (!useful) return res.status(400).json({ error: 'Choose useful or not useful', code: 'INVALID_INPUT' });

      const { RESEND_API_KEY, FROM_EMAIL } = env, to = recipients(env.NOTIFY_EMAIL);
      if (!RESEND_API_KEY || !FROM_EMAIL || !to.length) {
        return res.status(503).json({ error: 'Feedback is not available right now', code: 'UNAVAILABLE' });
      }
      await send({
        apiKey: RESEND_API_KEY, from: FROM_EMAIL, to,
        subject: `Wavecrest feedback: ${useful === 'yes' ? 'useful' : 'not useful'}`,
        html: `<p><b>${useful === 'yes' ? 'Useful' : 'Not useful'}</b> from ${esc(user.email)} (plan ${esc(user.plan)})${reportId ? `, report ${esc(reportId)}` : ''}.</p>${message ? `<p style="white-space:pre-wrap">${esc(message)}</p>` : '<p>(no message)</p>'}`
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[feedback]', err.message);
      await reportError(err, 'feedback');
      return res.status(502).json({ error: 'Could not send that. Try again in a moment.', code: 'SERVER_ERROR' });
    }
  };
}
