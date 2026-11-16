import {
  resolveDatabaseConnection,
  resolveMigrationDatabaseConnection,
} from './database-connection';

const poolerUrl = (username = 'kayan_runtime.yyaodengmthijrqxyczf', port = 5432, sslmode = 'require') =>
  `postgresql://${username}:secret@aws-0-eu-central-1.pooler.supabase.com:${port}/postgres?sslmode=${sslmode}`;

describe('resolveDatabaseConnection', () => {
  it('keeps local PostgreSQL as the default and ignores the cloud URL', () => {
    const result = resolveDatabaseConnection({
      DATABASE_URL: 'postgresql://local:secret@127.0.0.1:5432/kayan',
      SUPABASE_DATABASE_URL: poolerUrl(),
    } as NodeJS.ProcessEnv);

    expect(result).toEqual({
      profile: 'local',
      connectionString: 'postgresql://local:secret@127.0.0.1:5432/kayan',
    });
  });

  it('uses the dedicated Supabase session-pooler URL only when selected', () => {
    const cloudUrl = poolerUrl();
    const result = resolveDatabaseConnection({
      DATABASE_PROFILE: 'supabase',
      DATABASE_URL: 'postgresql://local:secret@127.0.0.1:5432/kayan',
      SUPABASE_DATABASE_URL: cloudUrl,
    } as NodeJS.ProcessEnv);

    expect(result).toEqual({ profile: 'supabase', connectionString: cloudUrl });
  });

  it('requires an explicit Supabase runtime URL in cloud mode', () => {
    expect(() =>
      resolveDatabaseConnection({ DATABASE_PROFILE: 'supabase' } as NodeJS.ProcessEnv),
    ).toThrow('SUPABASE_DATABASE_URL is required');
  });

  it.each(['postgres.yyaodengmthijrqxyczf', 'service_role.yyaodengmthijrqxyczf'])(
    'rejects the privileged runtime role %s',
    (username) => {
      expect(() =>
        resolveDatabaseConnection({
          DATABASE_PROFILE: 'supabase',
          SUPABASE_DATABASE_URL: poolerUrl(username),
        } as NodeJS.ProcessEnv),
      ).toThrow('must use a dedicated non-privileged Supabase role');
    },
  );

  it.each(['disable', 'prefer', ''])('requires TLS mode, rejects sslmode=%s', (sslmode) => {
    expect(() =>
      resolveDatabaseConnection({
        DATABASE_PROFILE: 'supabase',
        SUPABASE_DATABASE_URL: poolerUrl(
          'kayan_runtime.yyaodengmthijrqxyczf',
          5432,
          sslmode,
        ),
      } as NodeJS.ProcessEnv),
    ).toThrow('sslmode=require, verify-ca, or verify-full');
  });

  it('rejects transaction pooling for the persistent NestJS backend', () => {
    expect(() =>
      resolveDatabaseConnection({
        DATABASE_PROFILE: 'supabase',
        SUPABASE_DATABASE_URL: poolerUrl(
          'kayan_runtime.yyaodengmthijrqxyczf',
          6543,
        ),
      } as NodeJS.ProcessEnv),
    ).toThrow('port 5432');
  });

  it('uses a separate TLS migration URL in cloud Prisma CLI mode', () => {
    const migrationUrl = 'postgresql://kayan_migrator:secret@db.yyaodengmthijrqxyczf.supabase.co:5432/postgres?sslmode=require';
    const result = resolveMigrationDatabaseConnection({
      DATABASE_PROFILE: 'supabase',
      SUPABASE_DATABASE_URL: poolerUrl(),
      SUPABASE_MIGRATION_DATABASE_URL: migrationUrl,
    } as NodeJS.ProcessEnv);

    expect(result).toEqual({ profile: 'supabase', connectionString: migrationUrl });
  });

  it('refuses cloud migrations when the separate migration secret is missing', () => {
    expect(() =>
      resolveMigrationDatabaseConnection({
        DATABASE_PROFILE: 'supabase',
        SUPABASE_DATABASE_URL: poolerUrl(),
      } as NodeJS.ProcessEnv),
    ).toThrow('SUPABASE_MIGRATION_DATABASE_URL is required');
  });
});
