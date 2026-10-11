import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Builds the PostgreSQL driver adapter the client runs on.
 *
 * The client is generated with the engine-less `queryCompiler` runtime, so it
 * needs a driver adapter instead of the native query engine. That removes a
 * binary that used to be copied (and sometimes lost by antivirus software)
 * next to the program, and it is exactly the same `pg` driver the engine used
 * underneath. The connection string is read once, from the environment, and
 * never logged.
 */
export function createPgAdapter(): PrismaPg {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Point it at the PostgreSQL database this ' +
        'installation should use, for example ' +
        'postgresql://user:password@localhost:5432/kayan',
    );
  }
  return new PrismaPg({ connectionString });
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
