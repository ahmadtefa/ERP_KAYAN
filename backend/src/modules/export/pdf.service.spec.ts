import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';
import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  PAGE_NUMBER_GEOMETRY,
  buildDevToolsArgs,
  buildDevToolsSocketArgs,
  buildPrintArgs,
  removeProfileFolder,
  stampPageNumbers,
} from './pdf.service';

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

  it('allows no network at all while a document is being printed', () => {
    // The Arabic face and the logo travel inside the page. These two flags are
    // what make that a rule instead of a hope: a stray http(s) reference would
    // resolve to nothing, and nothing else is fetched in the background.
    const args = buildPrintArgs({ ...base, legacyHeadless: false });
    expect(args).toContain('--disable-background-networking');
    expect(args).toContain('--host-resolver-rules=MAP * ~NOTFOUND');
    expect(args.join(' ')).not.toMatch(/https?:\/\//);
  });
});

/**
 * The other print route: the one that keeps a painted page design.
 *
 * The command line printer decides the paper size and the background for
 * itself, and it decides both the way a print dialog would - no background,
 * its own sheet. A quotation whose header and footer are a full-page design
 * cannot be printed that way, so it is printed through the browser's DevTools
 * pipe instead.
 */
describe('buildDevToolsArgs', () => {
  const base = {
    profile: 'C:\\Temp\\kayan-pdf-1\\devtools-profile',
    page: 'C:\\Temp\\kayan-pdf-1\\report.html',
  };

  it('talks to the browser over a pipe, not a port', () => {
    const args = buildDevToolsArgs({ ...base, legacyHeadless: false });
    // Plain --headless: the `=new` spelling is an alias a newer browser can
    // refuse, and refusing it means no file at all.
    expect(args[0]).toBe('--headless');
    expect(args).toContain('--remote-debugging-pipe');
    expect(args.join(' ')).not.toContain('--remote-debugging-port');
    expect(args).toContain(`--user-data-dir=${base.profile}`);
    // The page is opened by the protocol, after the browser is listening, so
    // nothing about it is decided by the command line.
    const withoutPage = buildDevToolsArgs({ ...base, page: '', legacyHeadless: false });
    expect(withoutPage[withoutPage.length - 1]).toBe('--remote-debugging-pipe');
    expect(args[args.length - 1]).toBe(base.page);
  });

  it('opens the page with no network available', () => {
    const args = buildDevToolsArgs({ ...base, legacyHeadless: false });
    expect(args).toContain('--host-resolver-rules=MAP * ~NOTFOUND');
    expect(args).toContain('--disable-background-networking');
    expect(args.join(' ')).not.toMatch(/https?:\/\//);
  });

  it('has a second transport for platforms that cannot hand over a pipe', () => {
    // Port zero: the browser picks one, on the loopback interface, and prints
    // it on its own error stream for this process alone.
    const args = buildDevToolsSocketArgs({ profile: base.profile, legacyHeadless: false });
    expect(args).toContain('--remote-debugging-port=0');
    expect(args).not.toContain('--remote-debugging-pipe');
    expect(args).toContain(`--user-data-dir=${base.profile}`);
    expect(args).toContain('--host-resolver-rules=MAP * ~NOTFOUND');
  });
});

describe('stampPageNumbers', () => {
  const blank = async (pages: number) => {
    const document = await PDFDocument.create();
    for (let index = 0; index < pages; index += 1) {
      document.addPage([595.28, 841.89]);
    }
    return Buffer.from(await document.save());
  };

  /// The drawing instructions of every page, decompressed. pdf-lib writes the
  /// number into a content stream of its own, appended to whatever the browser
  /// produced, so this reads the finished page the way a PDF viewer would.
  const pageDrawing = async (pdf: Buffer) => {
    const document = await PDFDocument.load(pdf);
    const decoder = new TextDecoder('latin1');
    return document.getPages().map((page) => {
      const contents = page.node.Contents();
      if (!contents) return '';
      const streams =
        contents instanceof PDFArray
          ? contents.asArray().map((reference) => document.context.lookup(reference))
          : [contents];
      return streams
        .map((stream) =>
          stream instanceof PDFRawStream
            ? decoder.decode(decodePDFRawStream(stream).decode())
            : '',
        )
        .join('\n');
    });
  };

  it('numbers every page, centred on the sheet', async () => {
    const drawing = await pageDrawing(await stampPageNumbers(await blank(3)));
    expect(drawing).toHaveLength(3);
    drawing.forEach((page, index) => {
      // pdf-lib writes the label as a hex string; this is "1 / 3" and so on.
      const label = Buffer.from(`${index + 1} / 3`, 'latin1')
        .toString('hex')
        .toUpperCase();
      expect(page).toContain(`<${label}> Tj`);
      expect(page).toContain('0.45 0.45 0.45 rg');
      expect(page).toMatch(/Helvetica-\d+ 9 Tf/);
      // Centred: x is half the difference between the sheet and the label.
      const placed = /1 0 0 1 ([\d.]+) ([\d.]+) Tm/.exec(page);
      expect(placed).not.toBeNull();
      const [, x, y] = placed as RegExpExecArray;
      expect(Number(x)).toBeGreaterThan(280);
      expect(Number(x)).toBeLessThan(300);
      expect(Number(y)).toBe(PAGE_NUMBER_GEOMETRY.y);
    });
  });

  it('draws the number where the caller asks, in the caller ink', async () => {
    const [page] = await pageDrawing(
      await stampPageNumbers(await blank(1), {
        pageNumberColor: { r: 1, g: 1, b: 1 },
        pageNumberY: 10,
      }),
    );
    expect(page).toContain('1 1 1 rg');
    const placed = /1 0 0 1 ([\d.]+) ([\d.]+) Tm/.exec(page);
    expect(Number((placed as RegExpExecArray)[2])).toBe(10);
  });
});

/**
 * The browser's profile, and what Windows does with it.
 *
 * The Windows runner found this before any customer did: the PDF was made,
 * the browser was killed, and the throwaway profile folder would not delete
 * because Windows still held the lockfile - and that complaint, raised inside
 * the `finally` of a finished render, became the failure the customer saw
 * instead of their quotation.
 */
describe('removeProfileFolder', () => {
  it('deletes a profile that the browser has let go of', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'kayan-profile-'));
    writeFileSync(join(folder, 'lockfile'), 'a lock that nobody holds');
    await expect(removeProfileFolder(folder)).resolves.toBe(true);
    expect(existsSync(folder)).toBe(false);
  });

  it('swallows a lock that Windows has not released yet', async () => {
    const locked = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("EBUSY: resource busy or locked, unlink 'lockfile'"), {
          code: 'EBUSY',
        }),
      );
    await expect(removeProfileFolder('/tmp/no-such-profile-here', locked)).resolves.toBe(false);
    expect(locked).toHaveBeenCalledTimes(1);
    // It still asks for the retries that make the race unlikely in the first place.
    expect(locked.mock.calls[0][1]).toMatchObject({ recursive: true, force: true, maxRetries: 12 });
  });

  it('does not mind a folder that is already gone', async () => {
    await expect(removeProfileFolder(join(tmpdir(), 'kayan-profile-never-made'))).resolves.toBe(
      true,
    );
  });
});
