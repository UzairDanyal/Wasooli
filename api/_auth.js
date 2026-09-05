// Shared session-cookie helpers for the API routes and the page gate.
// Stateless HMAC-signed cookie (payload + expiry, signed with SESSION_SECRET)
// — no server-side session store needed, verifying it is just a signature +
// expiry check.
const crypto = require('crypto');

const COOKIE_NAME = 'konto_session';
const SESSION_TTL_SECONDS = 60 * 15; // 15 minutes — user asked to re-prompt for the PIN often

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createSessionToken(secret) {
  const exp = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

function verifySessionToken(token, secret) {
  if (!token || !secret) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  if (sign(payload, secret) !== sig) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && Date.now() < exp;
  } catch {
    return false;
  }
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

function isAuthed(req) {
  return verifySessionToken(getCookie(req, COOKIE_NAME), process.env.SESSION_SECRET);
}

module.exports = { COOKIE_NAME, createSessionToken, verifySessionToken, getCookie, setSessionCookie, clearSessionCookie, isAuthed };
