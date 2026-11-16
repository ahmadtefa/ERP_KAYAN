import { currentTenantContext } from './tenant-context';
import { listCompaniesForSystemJobs, runCompanyJob } from './system-jobs';

describe('system-jobs context bridge', () => {
  it('the roster read asks for active companies only (retired companies stay out)', async () => {
    const findMany = jest.fn(async () => [
      { id: 'a', code: 'CA', nameEn: 'Company A' },
    ]);
    const rows = await listCompaniesForSystemJobs({ company: { findMany } });
    expect(rows).toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
      select: { id: true, code: true, nameEn: true },
    });
  });

  it('runCompanyJob binds a strict per-company context for the unit of work', async () => {
    const seen = await runCompanyJob('company-7', async () => currentTenantContext());
    expect(seen).toEqual({ companyId: 'company-7' });
    // Outside the call the context is gone (nothing leaks into the caller).
    expect(currentTenantContext()).toBeUndefined();
  });
});
