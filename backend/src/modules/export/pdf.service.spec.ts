import { buildPrintArgs } from './pdf.service';

/**
 * The flags, not the browser: the real end-to-end render is covered by
 * quotation-pdf.spec.ts where a browser exists. These assertions pin the
 * two behaviours that decided whether "Download PDF" produced a file on a
 * real Windows install:
 *  * a throwaway profile per print (`--user-data-dir`), so a running
 *    Edge/Chrome instance — or a service account without a usable default
 *    profile — cannot swallow the job and exit without writing anything;
 *  * the classic `--headless` fallback for browser builds that reject
 *    `--headless=new`.
 */
describe('buildPrintArgs', () => {
  const base = {
    output: 'C:\\Temp\\kayan-pdf-1\\report.pdf',
    profile: 'C:\\Temp\\kayan-pdf-1\\profile',
    page: 'C:\\Temp\\kayan-pdf-1\\report.html',
  };

  it('prints through a dedicated per-job browser profile', () => {
    const args = buildPrintArgs({ ...base, legacyHeadless: false });
    expect(args).toContain(`--user-data-dir=${base.profile}`);
    expect(args).toContain(`--print-to-pdf=${base.output}`);
    expect(args).toContain('--no-sandbox');
    expect(args[0]).toBe('--headless=new');
    expect(args[args.length - 1]).toBe(`file://${base.page}`);
  });

  it('can fall back to the classic headless flag for older browsers', () => {
    const args = buildPrintArgs({ ...base, legacyHeadless: true });
    expect(args[0]).toBe('--headless');
    expect(args).toContain(`--user-data-dir=${base.profile}`);
  });
});
