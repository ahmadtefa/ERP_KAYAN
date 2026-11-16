import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { resolveDatabaseConnection } from './database-connection';
import { TenantPrismaPg } from './tenant-prisma-pg';

/**
 * Builds the PostgreSQL driver adapter the client runs on.
 *
 * The client is generated with the engine-less `queryCompiler` runtime, so it
 * needs a driver adapter instead of the native query engine. Local Windows
 * installs continue to use DATABASE_URL. A cloud deployment opts in explicitly
 * with DATABASE_PROFILE=supabase and reads its server-only URL from
 * SUPABASE_DATABASE_URL. Connection strings are never logged.
 *
 * The adapter (TenantPrismaPg) also binds the verified tenant context into
 * every transaction so row-level security can scope each row to one company.
 */
export function createPgAdapter(): TenantPrismaPg {
  const { connectionString } = resolveDatabaseConnection();
  return new TenantPrismaPg({ connectionString });
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({ adapter: createPgAdapter() });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
