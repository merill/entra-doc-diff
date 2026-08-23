#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('../src/config');

const root = path.resolve(process.env.WEBSITE_DIR || 'website');
const args = process.argv.slice(2);
const valueAfter = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const port = Number(valueAfter('--port') || process.env.PORT || 4173);
const host = valueAfter('--host') || process.env.HOST || '127.0.0.1';
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.wasm':'application/wasm', '.xml':'application/xml; charset=utf-8', '.txt':'text/plain; charset=utf-8' };

http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
  let target = path.resolve(root, `.${pathname}`);
  if (!target.startsWith(root)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  if (pathname.endsWith('/')) target = path.join(target, 'index.html');
  fs.stat(target, (error, stat) => {
    if (!error && stat.isDirectory()) target = path.join(target, 'index.html');
    fs.readFile(target, (readError, data) => {
      if (readError) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      response.writeHead(200, { 'content-type': mime[path.extname(target)] || 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(data);
    });
  });
}).listen(port, host, () => console.log(`${getConfig().site.name} preview: http://${host}:${port}/`));
