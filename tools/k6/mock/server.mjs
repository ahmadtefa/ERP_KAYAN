// Tiny stand-in API used ONLY to check the scripts run. Not the real ERP_KAYAN.
import http from 'node:http';
const rows = [{ id: 'a1' }, { id: 'b2' }];
http.createServer((req, res) => {
  const url = req.url.replace('/api/v1', '').split('?')[0];
  const send = (c, b) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (url === '/auth/login') return send(201, { accessToken: 'mock' });
  if (url === '/health') return send(200, { status: 'ok' });
  if (req.method === 'POST') return send(201, { id: 'c3' });
  if (req.headers.authorization !== 'Bearer mock') return send(401, {});
  if (/\/(customers|items|invoices)$/.test(url)) return send(200, rows);
  send(200, {});
}).listen(3999);
