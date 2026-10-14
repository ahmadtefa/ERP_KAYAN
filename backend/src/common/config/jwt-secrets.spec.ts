import { ServiceUnavailableException } from '@nestjs/common';

import {
  ACCESS_SECRET_VARIABLE,
  REFRESH_SECRET_VARIABLE,
  accessSecret,
  accessTtlSeconds,
  missingSecretVariables,
  refreshSecret,
  refreshTtlSeconds,
  secretsProblem,
} from './jwt-secrets';

describe('the signing keys', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  function withSecrets(access?: string, refresh?: string) {
    if (access === undefined) delete process.env[ACCESS_SECRET_VARIABLE];
    else process.env[ACCESS_SECRET_VARIABLE] = access;
    if (refresh === undefined) delete process.env[REFRESH_SECRET_VARIABLE];
    else process.env[REFRESH_SECRET_VARIABLE] = refresh;
  }

  it('hands over the key when it has been set', () => {
    withSecrets('access-key', 'refresh-key');
    expect(accessSecret()).toBe('access-key');
    expect(refreshSecret()).toBe('refresh-key');
    expect(missingSecretVariables()).toEqual([]);
    expect(secretsProblem()).toBeNull();
  });

  it('says which variable is missing, rather than letting the library speak', () => {
    withSecrets(undefined, 'refresh-key');
    expect(missingSecretVariables()).toEqual([ACCESS_SECRET_VARIABLE]);
    expect(secretsProblem()).toContain(ACCESS_SECRET_VARIABLE);
  });

  it('treats an empty value as no value at all', () => {
    withSecrets('   ', 'refresh-key');
    expect(missingSecretVariables()).toEqual([ACCESS_SECRET_VARIABLE]);
  });

  it('refuses to sign with a key it does not have, in words a person can act on', () => {
    withSecrets(undefined, undefined);
    expect(() => accessSecret()).toThrow(ServiceUnavailableException);
    try {
      accessSecret();
    } catch (error) {
      const body = (error as ServiceUnavailableException).getResponse() as {
        message: string;
      };
      expect(body.message).toContain(ACCESS_SECRET_VARIABLE);
      expect(body.message).toContain(REFRESH_SECRET_VARIABLE);
      // The one thing it must never be is the library's own complaint:
      // "secretOrPrivateKey must have a value".
      expect(body.message).not.toContain('secretOrPrivateKey');
    }
  });

  it('falls back to a sane lifetime rather than signing an unusable token', () => {
    withSecrets('access-key', 'refresh-key');
    delete process.env.JWT_ACCESS_TTL;
    delete process.env.JWT_REFRESH_TTL;
    expect(accessTtlSeconds()).toBe(900);
    expect(refreshTtlSeconds()).toBe(604800);

    process.env.JWT_ACCESS_TTL = '';
    expect(accessTtlSeconds()).toBe(900);

    process.env.JWT_ACCESS_TTL = '15m';
    expect(accessTtlSeconds()).toBe(900);

    process.env.JWT_ACCESS_TTL = '1200';
    expect(accessTtlSeconds()).toBe(1200);
  });
});
