import {
  advertisedHost,
  assertSafeExposure,
  exposureWarning,
  forwardedProtocol,
} from './exposure';

describe('network exposure rules', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('never reports the wildcard bind address as somewhere to open', () => {
    expect(advertisedHost('0.0.0.0', {}, '192.168.1.20')).toBe('192.168.1.20');
    expect(advertisedHost('0.0.0.0', { host: 'erp.example.com' }, undefined)).toBe(
      'erp.example.com',
    );
    expect(advertisedHost('0.0.0.0', {}, undefined)).toBe('localhost');
    expect(advertisedHost('127.0.0.1', {}, undefined)).toBe('127.0.0.1');
  });

  it('believes a forwarded host only when a proxy was declared', () => {
    const headers = { 'x-forwarded-host': 'erp.example.com' };
    delete process.env.KAYAN_TRUST_PROXY;
    expect(advertisedHost('0.0.0.0', headers, '192.168.1.20')).toBe('192.168.1.20');
    process.env.KAYAN_TRUST_PROXY = 'loopback';
    expect(advertisedHost('0.0.0.0', headers, '192.168.1.20')).toBe(
      'erp.example.com',
    );
  });

  it('reads the forwarded protocol without trusting it by itself', () => {
    expect(forwardedProtocol({ 'x-forwarded-proto': 'https, http' })).toBe('https');
    expect(forwardedProtocol({ 'x-forwarded-proto': 'HTTPS' })).toBe('https');
    expect(forwardedProtocol({})).toBeNull();
  });

  it('warns about a LAN server and says nothing about a loopback one', () => {
    expect(
      exposureWarning({ exposed: true, published: false, hasTlsTerminator: false }),
    ).toContain('private network');
    expect(
      exposureWarning({ exposed: false, published: false, hasTlsTerminator: false }),
    ).toBeNull();
    expect(
      exposureWarning({ exposed: true, published: true, hasTlsTerminator: true }),
    ).toBeNull();
  });

  it('refuses to publish plain HTTP, and allows it behind a TLS proxy', () => {
    expect(() =>
      assertSafeExposure({ exposed: true, published: true, hasTlsTerminator: false }),
    ).toThrow(/HTTPS/);

    expect(() =>
      assertSafeExposure({ exposed: true, published: true, hasTlsTerminator: true }),
    ).not.toThrow();

    // A LAN installation is not "published": it starts, with a warning in the
    // log, because that is the normal company-network case.
    expect(() =>
      assertSafeExposure({ exposed: true, published: false, hasTlsTerminator: false }),
    ).not.toThrow();

    // Loopback, the desktop installation: nothing to say.
    expect(() =>
      assertSafeExposure({ exposed: false, published: true, hasTlsTerminator: false }),
    ).not.toThrow();
  });
});
