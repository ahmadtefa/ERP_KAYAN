import { isCorsOriginAllowed } from './cors-origin';

describe('production CORS origin policy', () => {
  const configured = ['https://erp.example.com'];

  it('allows explicitly configured production origins', () => {
    expect(isCorsOriginAllowed('https://erp.example.com', configured, true)).toBe(true);
  });

  it.each([
    'http://attacker.local',
    'http://192.168.1.20:8080',
    'https://unlisted.example.com',
  ])('rejects unconfigured production origin %s', (origin) => {
    expect(isCorsOriginAllowed(origin, configured, true)).toBe(false);
  });

  it('allows arbitrary origins only outside production for development convenience', () => {
    expect(isCorsOriginAllowed('http://localhost:52731', configured, false)).toBe(true);
  });

  it('allows requests without an Origin header for native and command-line clients', () => {
    expect(isCorsOriginAllowed(undefined, configured, true)).toBe(true);
  });
});
