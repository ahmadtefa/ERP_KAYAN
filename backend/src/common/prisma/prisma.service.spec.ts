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
    expect(() => createPgAdapter()).toThrow('DATABASE_URL is not set');
  });

  it('creates a PrismaPg adapter when DATABASE_URL is provided', () => {
    process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/kayan_test';
    const adapter = createPgAdapter();
    expect(adapter).toBeDefined();
  });
});
