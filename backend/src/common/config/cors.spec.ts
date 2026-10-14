import { allowsOrigin, configuredOrigins, PRIVATE_ORIGIN } from './cors';

describe('which pages may call the API', () => {
  const none: string[] = [];

  it('lets in a request that carries no Origin header at all', () => {
    // Native apps, curl and the mobile build are not pages, so CORS does
    // not apply to them and refusing them would be a bug.
    expect(allowsOrigin(undefined, none, true)).toBe(true);
    expect(allowsOrigin('', none, true)).toBe(true);
  });

  it('lets in an origin the operator named, whatever it looks like', () => {
    const configured = ['https://erp.example.com'];
    expect(allowsOrigin('https://erp.example.com', configured, true)).toBe(true);
  });

  it('lets in this machine, and the network it is standing on', () => {
    // The ordinary case: the program runs on a desk and is opened from a
    // tablet, a phone or another desk on the same network.
    for (const origin of [
      'http://localhost:3000',
      'http://127.0.0.1:8080',
      'http://10.0.0.7:5000',
      'http://192.168.1.42',
      'http://192.168.100.9:57341',
      'http://172.16.4.3:8000',
      'http://172.31.255.1:8000',
      'http://kayan-office.local',
      'https://192.168.1.42:443',
    ]) {
      expect(allowsOrigin(origin, none, true)).toBe(true);
    }
  });

  it('refuses an address outside those ranges in production', () => {
    for (const origin of [
      'http://172.32.0.1:8000',
      'http://11.0.0.1:8000',
      'http://193.168.1.1:8000',
      'https://evil.example.org',
      'http://192.168.1.42.evil.example.org',
    ]) {
      expect(allowsOrigin(origin, none, true)).toBe(false);
    }
  });

  it('is permissive while developing, so a dev server on any port works', () => {
    expect(allowsOrigin('http://localhost:54321', none, false)).toBe(true);
    expect(allowsOrigin('https://anything.example.com', none, false)).toBe(true);
  });

  it('reads the operator’s list without tripping over stray spaces', () => {
    expect(
      configuredOrigins(' https://a.example.com , https://b.example.com ,, '),
    ).toEqual(['https://a.example.com', 'https://b.example.com']);
    expect(configuredOrigins(undefined)).toEqual([]);
    expect(configuredOrigins('   ')).toEqual([]);
  });

  it('does not mistake a lookalike hostname for a local one', () => {
    // The pattern is anchored at both ends; without that, a host that merely
    // contains a private address would be let through.
    expect(PRIVATE_ORIGIN.test('http://192.168.1.42.attacker.test')).toBe(false);
    expect(PRIVATE_ORIGIN.test('http://notlocalhost')).toBe(false);
    expect(PRIVATE_ORIGIN.test('http://192.168.1.42')).toBe(true);
  });
});
