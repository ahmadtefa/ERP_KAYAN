import { gunzipSync } from 'node:zlib';

import { jsonCompression, MIN_COMPRESS_BYTES } from './json-compression';

function run(opts: { method?: string; path?: string; accept?: string; type?: string; status?: number; body: string | Buffer; headers?: Record<string, string> }) {
  const headers: Record<string, unknown> = { ...(opts.type === undefined ? { 'content-type': 'application/json; charset=utf-8' } : opts.type ? { 'content-type': opts.type } : {}), ...(opts.headers ?? {}) };
  let written: unknown;
  const res = {
    statusCode: opts.status ?? 200,
    getHeader: (n: string) => headers[n.toLowerCase()],
    setHeader: (n: string, v: unknown) => { headers[n.toLowerCase()] = v; },
    removeHeader: (n: string) => { delete headers[n.toLowerCase()]; },
    end: (chunk?: unknown) => { written = chunk; },
  };
  const req = { method: opts.method ?? 'GET', path: opts.path ?? '/api/v1/items', headers: opts.accept === undefined ? {} : { 'accept-encoding': opts.accept } };
  jsonCompression()(req, res as never, () => undefined);
  res.end(opts.body);
  return { headers, written: written as Buffer | string };
}

const big = JSON.stringify({ rows: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `item ${i}`, balance: '100.0000' })) });

describe('json compression and revalidation', () => {
  it('compresses a large JSON answer for a client that accepts gzip, and the body is unchanged', () => {
    const { headers, written } = run({ accept: 'gzip, deflate', body: big });
    expect(headers['content-encoding']).toBe('gzip');
    expect(headers['vary']).toBe('Accept-Encoding');
    expect(Number(headers['content-length'])).toBe((written as Buffer).length);
    expect((written as Buffer).length).toBeLessThan(big.length);
    expect(gunzipSync(written as Buffer).toString()).toBe(big);
  });

  it('leaves small answers, non-JSON bodies and clients without gzip alone', () => {
    expect(run({ accept: 'gzip', body: '{"a":1}' }).headers['content-encoding']).toBeUndefined();
    expect(run({ accept: 'gzip', type: 'application/pdf', body: Buffer.alloc(MIN_COMPRESS_BYTES * 2, 1) }).headers['content-encoding']).toBeUndefined();
    expect(run({ accept: 'identity', body: big }).headers['content-encoding']).toBeUndefined();
    expect(run({ accept: 'gzip;q=0', body: big }).headers['content-encoding']).toBeUndefined();
    expect(run({ body: big }).written).toBe(big);
  });

  it('does not touch an answer that is already encoded, bodyless, or outside the API', () => {
    expect(run({ accept: 'gzip', body: big, headers: { 'content-encoding': 'br' } }).headers['content-encoding']).toBe('br');
    expect(run({ accept: 'gzip', status: 304, body: '' }).headers['content-encoding']).toBeUndefined();
    expect(run({ accept: 'gzip', path: '/index.html', body: big }).headers['content-encoding']).toBeUndefined();
  });

  it('asks every API read to revalidate, never to be reused unchecked, and keeps an explicit header', () => {
    expect(run({ body: big }).headers['cache-control']).toBe('private, no-cache');
    expect(run({ method: 'POST', body: big }).headers['cache-control']).toBeUndefined();
    expect(run({ path: '/index.html', body: big }).headers['cache-control']).toBeUndefined();
    expect(run({ body: big, headers: { 'cache-control': 'no-store' } }).headers['cache-control']).toBe('no-store');
  });
});
