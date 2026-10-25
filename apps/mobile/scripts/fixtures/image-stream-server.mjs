import { createServer } from 'node:http';

// Companion to EXPO_PUBLIC_VIMICATE_UI_FIXTURE=image-stream-limits. Loopback
// only, fixed synthetic bytes, no credentials or real Gateway conversation.
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const chunk = Buffer.alloc(512 * 1024);
const total = 12 * 1024 * 1024;
let sequence = 0;
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:18768');
  const kind = url.searchParams.get('source');
  if (url.pathname !== '/__openclaw__/assistant-media' || !['declared', 'chunked', 'valid'].includes(kind)) {
    response.writeHead(404); response.end(); return;
  }
  const id = ++sequence; let sent = 0; let completed = false; let timer;
  console.log(JSON.stringify({ event: 'request', id, kind, at: new Date().toISOString(), authorizationPresent: Boolean(request.headers.authorization) }));
  response.on('close', () => {
    clearTimeout(timer);
    console.log(JSON.stringify({ event: 'closed', id, kind, sent, completed, at: new Date().toISOString() }));
  });
  response.setHeader('content-type', 'image/png');
  response.setHeader('cache-control', 'no-store');
  if (kind === 'valid') {
    response.setHeader('content-length', pixel.length); sent = pixel.length; completed = true; response.end(pixel); return;
  }
  if (kind === 'declared') response.setHeader('content-length', total);
  response.flushHeaders();
  const send = () => {
    if (response.destroyed) return;
    sent += chunk.length;
    const writable = response.write(chunk);
    if (sent >= total) { completed = true; response.end(); }
    else if (writable) timer = setTimeout(send, 25);
    else response.once('drain', () => { timer = setTimeout(send, 25); });
  };
  timer = setTimeout(send, 100);
});
server.listen(18768, '127.0.0.1', () => console.log(JSON.stringify({ event: 'listening', address: '127.0.0.1:18768' })));
process.on('SIGINT', () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
