// Minimal static server to serve the sidepanel UI as a website (no proxy)
// LLM calls still go to http://localhost:8080 as defined in sidepanel/index.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5173;
const ROOT = __dirname;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveFile(filePath, res) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  // Redirect root to /sidepanel/ so relative paths in HTML resolve correctly
  if (url === '/' || url === '') {
    res.statusCode = 302;
    res.setHeader('Location', '/sidepanel/');
    res.end();
    return;
  }

  // Normalize /sidepanel to /sidepanel/
  if (url === '/sidepanel') {
    res.statusCode = 302;
    res.setHeader('Location', '/sidepanel/');
    res.end();
    return;
  }

  // Serve sidepanel directory; default to index.html when directory is requested
  if (url.startsWith('/sidepanel/')) {
    const reqPath = path.join(ROOT, url);
    try {
      const stat = fs.statSync(reqPath);
      if (stat.isDirectory()) {
        return serveFile(path.join(reqPath, 'index.html'), res);
      }
      return serveFile(reqPath, res);
    } catch (_) {
      // fall-through to 404 below
    }
  }

  // Allow direct access to built bundle and images
  if (url.startsWith('/dist/')) {
    return serveFile(path.join(ROOT, url), res);
  }
  if (url.startsWith('/images/')) {
    return serveFile(path.join(ROOT, url), res);
  }

  // Special-case: when loaded from '/', HTML may reference /index.css
  if (url === '/index.css') {
    return serveFile(path.join(ROOT, 'sidepanel', 'index.css'), res);
  }

  // Fallback 404
  res.statusCode = 404;
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`Sidepanel dev server running at http://localhost:${PORT}`);
  console.log('Open / to load sidepanel (serves sidepanel/index.html)');
});
