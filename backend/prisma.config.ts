import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * The project runs on the engine-less client (`engineType = "client"` with the
 * query compiler and the pg driver adapter), so no native query-engine binary
 * is shipped. The matching choice for schema work is the JavaScript (WASM)
 * schema engine: it needs no download from binaries.prisma.sh, which keeps
 * `prisma validate`, `generate` and migrations working in locked-down/offline
 * CI and on customer machines.
 *
 * Prisma 6.19.x reads `engine`/`adapter` from the TOP LEVEL of defineConfig
 * (the nested `schemaEngine: { engine: 'js' }` shape belongs to later Prisma
 * releases and is silently ignored here, which makes the CLI fall back to
 * downloading the native schema-engine binary). `experimental.adapter` is the
 * 6.19 gate that enables the driver-adapter-backed JS schema engine.
 *
 * The adapter is instantiated lazily: pure validation/generation never opens
 * a socket, so no DATABASE_URL is needed for those commands.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  engine: 'js',
  experimental: {
    adapter: true,
  },
  adapter: async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is required for database-touching Prisma commands.',
      );
    }
    return new PrismaPg({ connectionString });
  },
});
