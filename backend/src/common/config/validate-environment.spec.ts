import { validateEnvironment } from './validate-environment';

describe('production environment validation', () => {
  it('does not constrain development secrets', () => {
    const config = {
      NODE_ENV: 'development',
      JWT_ACCESS_SECRET: 'replace-with-a-long-random-value',
      JWT_REFRESH_SECRET: 'replace-with-a-different-long-random-value',
    };
    expect(validateEnvironment(config)).toBe(config);
  });

  it('rejects missing production JWT secrets', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'production' })).toThrow(
      'JWT_ACCESS_SECRET',
    );
  });

  it('rejects example placeholder secrets in production', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'replace-with-a-long-random-value',
        JWT_REFRESH_SECRET: 'a-different-random-secret-that-is-long-enough',
      }),
    ).toThrow('JWT_ACCESS_SECRET');
  });

  it('rejects short production secrets', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'short',
        JWT_REFRESH_SECRET: 'a-different-random-secret-that-is-long-enough',
      }),
    ).toThrow('JWT_ACCESS_SECRET');
  });

  it('requires different access and refresh secrets', () => {
    const secret = 'a-random-production-secret-that-is-at-least-32-characters';
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: secret,
        JWT_REFRESH_SECRET: secret,
      }),
    ).toThrow('must be different');
  });

  it('accepts distinct production secrets of sufficient length', () => {
    const config = {
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'a-random-access-secret-that-is-at-least-32-characters',
      JWT_REFRESH_SECRET: 'a-random-refresh-secret-that-is-at-least-32-characters',
    };
    expect(validateEnvironment(config)).toBe(config);
  });
});
