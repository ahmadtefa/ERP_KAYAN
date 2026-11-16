import { createPgAdapter } from './prisma.service';

describe('PrismaService & createPgAdapter', () => {
  const originalUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalUrl !== undefined) {
      process.env.DATABASE_URL = originalUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  it('throws an error if DATABASE_URL is not set', () => {
    delete process.env.DATABASE_URL;
    // Same message the connection-profile layer raises (see
    // database-connection.spec.ts); this pin predates that wording and was
    // stale after the guarded-profile change.
    expect(() => createPgAdapter()).toThrow(
      'DATABASE_URL is required for the selected database profile.',
    );
  });

  it('creates a PrismaPg adapter when DATABASE_URL is provided', () => {
    process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/kayan_test';
    const adapter = createPgAdapter();
    expect(adapter).toBeDefined();
  });
});
