const { createSessionToken, setSessionCookie } = require('./_auth');

// Best-effort throttle: an in-memory Map only survives on a warm serverless
// instance (resets on cold start, not shared across concurrent instances).
// Acceptable here because the PIN itself is an 11-digit number (~10^11
// combinations) — impractical to brute force even without this.
const MAX_ATTEMPTS = 6;
const LOCKOUT_MS = 15 * 60 * 1000;
const attempts = new Map();

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const ip = clientIp(req);
  const entry = attempts.get(ip);
  if (entry && entry.count >= MAX_ATTEMPTS && Date.now() - entry.first < LOCKOUT_MS) {
    res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const pin = typeof body?.pin === 'string' ? body.pin : '';

  if (!process.env.APP_PIN || pin !== process.env.APP_PIN) {
    attempts.set(ip, entry ? { count: entry.count + 1, first: entry.first } : { count: 1, first: Date.now() });
    res.status(401).json({ error: 'Incorrect PIN' });
    return;
  }

  attempts.delete(ip);
  setSessionCookie(res, createSessionToken(process.env.SESSION_SECRET));
  res.status(200).json({ ok: true });
};
