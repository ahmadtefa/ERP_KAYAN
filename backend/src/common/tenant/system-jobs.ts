import {
  runWithTenantContext,
} from './tenant-context';

/**
 * The reviewed bridge between system jobs (schedulers, background workers)
 * and tenant row-level security.
 *
 * Background work runs outside an HTTP request, so there is no verified
 * principal and therefore no company context - and with no context every
 * tenant policy denies. Two narrow helpers make background work possible
 * WITHOUT weakening that default:
 *
 *   * [listCompaniesForSystemJobs] runs the single roster read a scheduler
 *     needs in the reviewed `jobs` mode. The RLS policy for `companies`
 *     allows SELECT in that mode and nothing else is readable or writable
 *     through it (proved by the tenant-rls integration suite).
 *   * [runCompanyJob] runs one company's unit of work inside a STRICT
 *     per-company context, exactly like an authenticated request. Everything
 *     the job touches - reads and writes - is scoped to that one company by
 *     RLS, so a bug in a job cannot cross into another company.
 *
 * Nothing else in the program may use `mode: 'jobs'`; the mode carries no
 * user identity and must never wrap user-facing work.
 */

interface RosterCompany {
  id: string;
  code: string;
  nameEn: string;
}

interface RosterReader {
  company: {
    findMany(args: {
      where: { deletedAt: null };
      select: { id: true; code: true; nameEn: true };
    }): Promise<RosterCompany[]>;
  };
}

/** The company roster a system job needs, and nothing more. */
export function listCompaniesForSystemJobs(
  prisma: RosterReader,
): Promise<RosterCompany[]> {
  return runWithTenantContext({ companyId: null, mode: 'jobs' }, () =>
    prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true, code: true, nameEn: true },
    }),
  );
}

/** Runs `fn` as the given company - the same isolation an API request gets. */
export function runCompanyJob<T>(
  companyId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithTenantContext({ companyId }, fn);
}
