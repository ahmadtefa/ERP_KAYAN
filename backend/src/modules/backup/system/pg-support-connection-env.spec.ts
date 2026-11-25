import { connectionEnv } from './pg-support';

describe('connectionEnv for backup tools', () => {
  it('honours a socket host and custom port given as URL options', () => {
    const env = connectionEnv(
      'postgresql://kayan_user@localhost/kayan_db?host=/var/run/pg-sock&port=33821&schema=public',
    );
    expect(env.PGHOST).toBe('/var/run/pg-sock');
    expect(env.PGPORT).toBe('33821');
    expect(env.PGUSER).toBe('kayan_user');
    expect(env.PGDATABASE).toBe('kayan_db');
  });

  it('fails closed on an unsupported URL option instead of using a default host', () => {
    expect(() => connectionEnv('postgresql://u@localhost/db?target_session_attrs=any')).toThrow();
  });
});
