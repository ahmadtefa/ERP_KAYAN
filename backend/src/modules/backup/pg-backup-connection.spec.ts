import { pgBackupConnectionEnv } from './pg-backup-connection';

describe('pgBackupConnectionEnv', () => {
  it('uses query host, credentials and port overrides', () => {
    const env = pgBackupConnectionEnv('postgresql://u:p@localhost:5432/books?host=%2Ftmp%2Fsocket&port=6543&user=other&password=second&schema=public', {});
    expect(env).toMatchObject({ PGHOST: '/tmp/socket', PGPORT: '6543', PGUSER: 'other', PGPASSWORD: 'second', PGDATABASE: 'books' });
  });

  it('passes certificate paths and strengthens weaker libpq modes to verified TLS', () => {
    for (const mode of ['prefer', 'require', 'verify-ca', 'verify-full']) {
      const env = pgBackupConnectionEnv(`postgresql://u:p@db.example/books?sslmode=${mode}&sslrootcert=%2Ftmp%2Fca.pem&sslcert=%2Ftmp%2Fclient.pem&sslkey=%2Ftmp%2Fclient.key`, {});
      expect(env).toMatchObject({ PGSSLMODE: 'verify-full', PGSSLROOTCERT: '/tmp/ca.pem', PGSSLCERT: '/tmp/client.pem', PGSSLKEY: '/tmp/client.key' });
    }
    expect(pgBackupConnectionEnv('postgresql://u:p@db.example/books?ssl=true', {}).PGSSLMODE).toBe('verify-full');
  });

  it('rejects unsupported or conflicting options without exposing credentials', () => {
    for (const query of ['sslmode=no-verify', 'uselibpqcompat=true', 'sslmode=disable&ssl=true', 'sslmode=require&sslmode=disable', 'sslnegotiation=direct', 'hostaddr=1.2.3.4', 'ssl=unknown', 'ssl=false']) {
      let error: unknown;
      try { pgBackupConnectionEnv(`postgresql://u:private@db.example/books?${query}`, {}); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('private');
    }
  });

  it('does not downgrade inherited SSL settings and preserves driver defaults', () => {
    expect(pgBackupConnectionEnv('postgresql://db.example/books', { PGSSLMODE: 'require' }).PGSSLMODE).toBe('verify-full');
    expect(pgBackupConnectionEnv('postgresql://db.example/books?sslmode=verify-full', { PGSSLMODE: 'disable' }).PGSSLMODE).toBe('verify-full');
    expect(() => pgBackupConnectionEnv('postgresql://db.example/books', { PGSSLMODE: 'no-verify' })).toThrow('unsupported');
    const env = pgBackupConnectionEnv('postgresql:///books?host=%2Ftmp%2Fsocket', { PGUSER: 'from-env', PGPASSWORD: 'from-env', PGPORT: '6543' });
    expect(env).toMatchObject({ PGUSER: 'from-env', PGPASSWORD: 'from-env', PGPORT: '6543' });
  });
});
