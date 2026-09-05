// Cloudflare Worker — gates the entire static app (index.html, app.js,
// storage.js, style.css) and the /api/data read/write endpoint behind a PIN.
// Nothing — not even the app's source files — is served to a browser that
// hasn't presented a valid session cookie. That cookie is only ever handed
// out by /api/login after the correct PIN, so the source and data are both
// unreachable to anyone who just has the URL.
//
// Data itself lives in a Workers KV namespace (binding KONTO_KV, key
// "loan-table") rather than a file — KV is the durable, shared store every
// device talks to, replacing the File System Access API / localStorage
// storage.js uses for local-only runs.

const COOKIE_NAME = 'konto_session';
const SESSION_TTL_SECONDS = 60 * 15; // 15 minutes — user asked to re-prompt for the PIN often
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const LOGIN_MAX_ATTEMPTS = 6;
const LOGIN_LOCKOUT_SECONDS = 15 * 60;

const EMPTY_DATA = {
  profiles: [],
  banks: [],
  transactions: [],
  bankTransactions: [],
  places: [],
  expenseCategories: [],
  expenses: [],
  assets: [],
  settings: { rates: { USD: 1, EUR: 1 } },
};

function b64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function sign(payload, secret) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return b64urlEncode(new Uint8Array(sig));
}

async function createSessionToken(secret) {
  const exp = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify({ exp })));
  return `${payload}.${await sign(payload, secret)}`;
}

async function verifySessionToken(token, secret) {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  if ((await sign(payload, secret)) !== sig) return false;
  try {
    const { exp } = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    return typeof exp === 'number' && Date.now() < exp;
  } catch {
    return false;
  }
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

async function isAuthed(request, env) {
  return verifySessionToken(getCookie(request, COOKIE_NAME), env.SESSION_SECRET);
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
}

function withSecurityHeaders(res) {
  const headers = new Headers(res.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

async function isLockedOut(env, ip) {
  return Number((await env.KONTO_KV.get(`login-fail:${ip}`)) || '0') >= LOGIN_MAX_ATTEMPTS;
}

async function recordFailedAttempt(env, ip) {
  const key = `login-fail:${ip}`;
  const count = Number((await env.KONTO_KV.get(key)) || '0') + 1;
  await env.KONTO_KV.put(key, String(count), { expirationTtl: LOGIN_LOCKOUT_SECONDS });
}

async function clearFailedAttempts(env, ip) {
  await env.KONTO_KV.delete(`login-fail:${ip}`);
}

async function handleLogin(request, env) {
  const ip = clientIp(request);
  if (await isLockedOut(env, ip)) {
    return json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Bad request' }, { status: 400 });
  }
  const pin = typeof body.pin === 'string' ? body.pin : '';
  if (!env.APP_PIN || pin !== env.APP_PIN) {
    await recordFailedAttempt(env, ip);
    return json({ error: 'Incorrect PIN' }, { status: 401 });
  }
  await clearFailedAttempts(env, ip);
  const token = await createSessionToken(env.SESSION_SECRET);
  return json(
    { ok: true },
    { headers: { 'Set-Cookie': `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}` } }
  );
}

function handleLogout() {
  return json({ ok: true }, { headers: { 'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0` } });
}

async function handleGetData(env) {
  const stored = await env.KONTO_KV.get('loan-table');
  return new Response(stored || JSON.stringify(EMPTY_DATA), { headers: { 'Content-Type': 'application/json' } });
}

async function handlePutData(request, env) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, { status: 413 });
  try {
    JSON.parse(text);
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  await env.KONTO_KV.put('loan-table', text);
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/login' && request.method === 'POST') return withSecurityHeaders(await handleLogin(request, env));
    if (path === '/api/logout' && request.method === 'POST') return withSecurityHeaders(handleLogout());

    const authed = await isAuthed(request, env);

    if (path.startsWith('/api/')) {
      if (!authed) return withSecurityHeaders(json({ error: 'unauthorized' }, { status: 401 }));
      if (path === '/api/data' && request.method === 'GET') return withSecurityHeaders(await handleGetData(env));
      if (path === '/api/data' && request.method === 'PUT') return withSecurityHeaders(await handlePutData(request, env));
      return withSecurityHeaders(json({ error: 'Not found' }, { status: 404 }));
    }

    if (path === '/login' || path === '/login.html') {
      if (authed) return Response.redirect(`${url.origin}/`, 302);
      const assetRes = await env.ASSETS.fetch(new Request(`${url.origin}/login.html`, { method: 'GET', headers: request.headers }));
      return withSecurityHeaders(assetRes);
    }

    if (!authed) {
      const next = encodeURIComponent(path + url.search);
      return Response.redirect(`${url.origin}/login?next=${next}`, 302);
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
