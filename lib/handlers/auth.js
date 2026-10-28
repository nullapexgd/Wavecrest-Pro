// All auth routes in one function (stays under Vercel's per-deploy function limit):
//   GET  /api/auth/google            → redirect to Google consent
//   GET  /api/auth/google/callback   → exchange code, set session, redirect /app
//   GET  /api/auth/github            → redirect to GitHub consent
//   GET  /api/auth/github/callback   → exchange code, set session, redirect /app
//   GET  /api/auth/me                → current user + entitlement + usage, or 401
//   POST /api/auth/logout            → clear session cookie
//   POST /api/auth/login             → 501 (email/password not offered; OAuth only)
//
// Built as a factory so tests can inject fetch / upsertUser / getUser.
import crypto from 'node:crypto';
import {
  getUser as realGetUser, upsertUser as realUpsertUser, sessionCookie, clearSessionCookie,
  stateCookie, parseCookies
} from '../auth.js';
import { entitlementFor } from '../plans.js';
import { getUsage as realGetUsage } from '../quota.js';
import { googleVerifiedEmail, githubVerifiedEmail } from '../oauth.js';
import { isSameOrigin, noStore } from '../http.js';

class EmailNotVerified extends Error {}

export function makeAuthHandler({
  fetch: fetchImpl = globalThis.fetch,
  getUser = realGetUser,
  upsertUser = realUpsertUser,
  getUsage = realGetUsage,
  env = process.env
} = {}) {
  const baseUrl = () => env.BASE_URL || `https://${env.VERCEL_URL}`;
  const googleRedirect = () => env.GOOGLE_CALLBACK_URL || `${baseUrl()}/api/auth/google/callback`;
  const githubRedirect = () => `${baseUrl()}/api/auth/github/callback`;

  function requireMethod(req, res, method) {
    if (req.method === method) return true;
    res.setHeader('Allow', method);
    res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
    return false;
  }

  function newState(res) {
    const state = crypto.randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', stateCookie(state));
    return state;
  }

  function checkState(req, res) {
    const cookieState = parseCookies(req).wc_oauth_state;
    if (!cookieState || cookieState !== req.query.state) {
      res.status(400).json({ error: 'Invalid OAuth state — start over from /login', code: 'BAD_STATE' });
      return false;
    }
    return true;
  }

  function finishLogin(res, user) {
    res.setHeader('Set-Cookie', [sessionCookie(user.id), stateCookie('')]);
    res.redirect(302, '/app');
  }

  function startGoogle(req, res) {
    if (!requireMethod(req, res, 'GET')) return;
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: googleRedirect(),
      response_type: 'code',
      scope: 'openid email profile',
      state: newState(res)
    });
    res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }

  async function googleCallback(req, res) {
    if (!requireMethod(req, res, 'GET')) return;
    if (!checkState(req, res)) return;

    const tokenRes = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code: req.query.code || '',
        grant_type: 'authorization_code',
        redirect_uri: googleRedirect()
      })
    });
    if (!tokenRes.ok) throw new Error(`Google token exchange failed (${tokenRes.status})`);
    const { access_token } = await tokenRes.json();

    const infoRes = await fetchImpl('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    if (!infoRes.ok) throw new Error(`Google userinfo failed (${infoRes.status})`);
    const info = await infoRes.json();

    const email = googleVerifiedEmail(info);
    if (!email) throw new EmailNotVerified('Google did not verify this email');

    const user = await upsertUser({
      email,
      name: info.name || '',
      avatarUrl: info.picture || '',
      provider: 'google',
      providerId: info.sub
    });
    finishLogin(res, user);
  }

  function startGithub(req, res) {
    if (!requireMethod(req, res, 'GET')) return;
    const params = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      redirect_uri: githubRedirect(),
      scope: 'read:user user:email',
      state: newState(res)
    });
    res.redirect(302, `https://github.com/login/oauth/authorize?${params}`);
  }

  async function githubCallback(req, res) {
    if (!requireMethod(req, res, 'GET')) return;
    if (!checkState(req, res)) return;

    const tokenRes = await fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code: req.query.code || '',
        redirect_uri: githubRedirect()
      })
    });
    if (!tokenRes.ok) throw new Error(`GitHub token exchange failed (${tokenRes.status})`);
    const { access_token } = await tokenRes.json();
    if (!access_token) throw new Error('GitHub returned no access token');

    const gh = (path) => fetchImpl(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': 'wavecrest-pro' }
    });

    const userRes = await gh('/user');
    if (!userRes.ok) throw new Error(`GitHub user fetch failed (${userRes.status})`);
    const info = await userRes.json();

    // Always read the verified list; the profile's public `email` is never trusted.
    const emailsRes = await gh('/user/emails');
    if (!emailsRes.ok) throw new Error(`GitHub emails fetch failed (${emailsRes.status})`);
    const email = githubVerifiedEmail(await emailsRes.json());
    if (!email) throw new EmailNotVerified('GitHub has no verified email on this account');

    const user = await upsertUser({
      email,
      name: info.name || info.login || '',
      avatarUrl: info.avatar_url || '',
      provider: 'github',
      providerId: info.id
    });
    finishLogin(res, user);
  }

  async function me(req, res) {
    if (!requireMethod(req, res, 'GET')) return;
    noStore(res);
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not signed in', code: 'UNAUTHENTICATED' });
    const entitlement = entitlementFor(user);
    const used = await getUsage(user.id).catch(() => null);
    return res.status(200).json({
      user,
      entitlement: { plan: entitlement.plan, label: entitlement.label, limit: entitlement.limit },
      usage: { used }
    });
  }

  function logout(req, res) {
    if (!requireMethod(req, res, 'POST')) return;
    if (!isSameOrigin(req)) return res.status(403).json({ error: 'Cross-site request refused', code: 'CSRF' });
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.status(200).json({ ok: true });
  }

  return async function handler(req, res) {
    const route = [].concat(req.query.path || []).join('/');
    try {
      switch (route) {
        case 'google':          return startGoogle(req, res);
        case 'google/callback': return await googleCallback(req, res);
        case 'github':          return startGithub(req, res);
        case 'github/callback': return await githubCallback(req, res);
        case 'me':              return await me(req, res);
        case 'logout':          return logout(req, res);
        case 'login':
          return res.status(501).json({
            error: 'Email/password sign-in isn’t available — use Google or GitHub',
            code: 'NOT_IMPLEMENTED'
          });
        default:
          return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
      }
    } catch (err) {
      if (err instanceof EmailNotVerified) {
        console.warn(`[auth/${route}] refused: ${err.message}`);
        return res.redirect(302, '/login?error=email_not_verified');
      }
      console.error(`[auth/${route}]`, err.message);
      return res.status(500).json({ error: 'Authentication failed — try again', code: 'AUTH_ERROR' });
    }
  };
}
