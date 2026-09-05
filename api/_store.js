// Durable JSON blob storage via Upstash Redis's REST API (the store Vercel
// wires up when you connect an Upstash/KV integration to the project —
// env vars KV_REST_API_URL / KV_REST_API_TOKEN are injected automatically).
// Deliberately not Vercel Blob: a Blob object is reachable at a public CDN
// URL once you know its path, which would bypass the PIN gate entirely for
// financial data. Redis here is only ever read through our own authenticated
// API route, server-side, with a secret bearer token — never a public URL.
const REDIS_KEY = 'konto:loan-table';

function base() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Storage not configured (missing KV_REST_API_URL/KV_REST_API_TOKEN).');
  return { url, token };
}

async function getData() {
  const { url, token } = base();
  const res = await fetch(`${url}/get/${REDIS_KEY}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Store read failed');
  const body = await res.json();
  return body.result || null;
}

async function setData(text) {
  const { url, token } = base();
  const res = await fetch(`${url}/set/${REDIS_KEY}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body: text,
  });
  if (!res.ok) throw new Error('Store write failed');
}

module.exports = { getData, setData };
