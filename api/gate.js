// Catch-all for every non-/api path. Gates the app's own source files behind
// the session cookie — an unauthenticated request never receives index.html,
// app.js, storage.js or style.css, only the PIN-entry page at /login. Static
// hosting alone can't do this (it would just serve the files to anyone with
// the URL), so everything routes through here instead (see vercel.json).
const fs = require('fs');
const path = require('path');
const { isAuthed } = require('./_auth');

const ROOT = path.join(__dirname, '..');

const FILES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'application/javascript; charset=utf-8' },
  '/storage.js': { file: 'storage.js', type: 'application/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
};

const PUBLIC_PATHS = new Set(['/login', '/login.html']);

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
}

module.exports = (req, res) => {
  const urlPath = req.url.split('?')[0];
  securityHeaders(res);

  if (PUBLIC_PATHS.has(urlPath)) {
    if (isAuthed(req)) {
      res.statusCode = 302;
      res.setHeader('Location', '/');
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(fs.readFileSync(path.join(ROOT, 'login.html'), 'utf8'));
    return;
  }

  if (!isAuthed(req)) {
    res.statusCode = 302;
    res.setHeader('Location', `/login?next=${encodeURIComponent(urlPath)}`);
    res.end();
    return;
  }

  const entry = FILES[urlPath];
  if (!entry) {
    res.status(404).send('Not found');
    return;
  }
  res.setHeader('Content-Type', entry.type);
  res.status(200).send(fs.readFileSync(path.join(ROOT, entry.file), 'utf8'));
};
