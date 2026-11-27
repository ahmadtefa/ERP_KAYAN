import { gzipSync } from 'node:zlib';

/// Smaller than this the saving does not pay for the CPU and the extra header.
export const MIN_COMPRESS_BYTES = 1024;

type Req = { method?: string; headers: Record<string, string | string[] | undefined>; path?: string; url?: string };
type Res = {
  getHeader(name: string): unknown;
  setHeader(name: string, value: string | number | string[]): unknown;
  removeHeader(name: string): void;
  statusCode: number;
  end: (...args: unknown[]) => unknown;
};

const acceptsGzip = (req: Req): boolean => {
  const h = req.headers['accept-encoding'];
  const value = Array.isArray(h) ? h.join(',') : h ?? '';
  return /(^|[\s,])gzip(\s*;\s*q=(?!0(\.0+)?\b)[0-9.]+)?\s*(,|$)/i.test(value);
};

/// Compresses JSON API answers and asks the client to revalidate every read.
///
/// Compression only: it never decides what an answer says. Revalidation only:
/// `no-cache` does not let anyone reuse a stored answer without asking the
/// server first (the ETag makes that ask cheap), so a balance or a stock figure
/// can never be shown from a stale copy. Anything that is not a JSON body
/// (downloads, PDFs, files) is left exactly as it was.
export function jsonCompression() {
  return (req: Req, res: Res, next: () => void): void => {
    const isApi = (req.path ?? req.url ?? '').startsWith('/api/');
    if (isApi && req.method === 'GET' && res.getHeader('Cache-Control') === undefined) {
      res.setHeader('Cache-Control', 'private, no-cache');
    }
    if (!isApi || !acceptsGzip(req)) return next();

    const originalEnd = res.end.bind(res);
    res.end = (...args: unknown[]) => {
      const [chunk, ...rest] = args;
      const type = String(res.getHeader('Content-Type') ?? '');
      const alreadyEncoded = res.getHeader('Content-Encoding') !== undefined;
      const body = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.isBuffer(chunk) ? chunk : null;
      const bodyless = res.statusCode === 204 || res.statusCode === 304;
      if (body && !bodyless && !alreadyEncoded && /^application\/(.+\+)?json/i.test(type) && body.length >= MIN_COMPRESS_BYTES) {
        const zipped = gzipSync(body);
        if (zipped.length < body.length) {
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Vary', 'Accept-Encoding');
          res.setHeader('Content-Length', zipped.length);
          return originalEnd(zipped, ...rest);
        }
      }
      return originalEnd(...args);
    };
    next();
  };
}
