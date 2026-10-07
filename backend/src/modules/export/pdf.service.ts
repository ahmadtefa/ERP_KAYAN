import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';

/// Turns a report page into a PDF file.
///
/// The page is already built - the same one the print button opens - and this
/// hands it to a browser in the background, which is the only thing on the
/// machine that knows how to lay out Arabic properly: right to left, with the
/// letters joined and in the right shapes. A PDF library would have to be
/// taught all of that and would get the fonts wrong; a browser already has it.
///
/// Which browser is found on the machine is not something the program decides:
/// it looks for the ones that exist, in the order they are likely to be there.
/// On Windows that is almost always Edge, which ships with the system.
@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  /// The browser is looked for once and remembered: the search walks the disk.
  private binary: string | null | undefined;

  /// Whether this installation can make PDFs at all. The screen asks, so a
  /// button that cannot work is never shown.
  get available(): boolean {
    return this.findBrowser() !== null;
  }

  /// A4 landscape, which is the shape a report with six money columns needs.
  private readonly paper = {
    width: '297mm',
    height: '210mm',
    margin: '10mm',
  };

  async render(html: string): Promise<Buffer> {
    const browser = this.findBrowser();
    if (!browser) {
      throw new UnprocessableEntityException(
        'This server has no browser installed, so it cannot make a PDF by itself. ' +
          'Use the print button instead and choose "Save as PDF" - the result is the same file.',
      );
    }

    const folder = await mkdtemp(join(tmpdir(), 'kayan-pdf-'));
    const page = join(folder, 'report.html');
    const output = join(folder, 'report.pdf');

    try {
      await writeFile(page, html, 'utf8');

      const args = [
        '--headless=new',
        // A server container has no sandbox to use; the page is our own and
        // never leaves the machine.
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        // Nothing here fetches anything: the page is self contained.
        '--disable-extensions',
        '--no-first-run',
        `--print-to-pdf=${output}`,
        '--no-pdf-header-footer',
        '--virtual-time-budget=5000',
        `file://${page}`,
      ];

      await run(browser, args, 60_000);

      if (!existsSync(output)) {
        throw new Error('the browser produced no file');
      }

      const pdf = await readFile(output);
      if (pdf.length === 0 || pdf.subarray(0, 4).toString('latin1') !== '%PDF') {
        throw new Error('the browser produced something that is not a PDF');
      }

      return pdf;
    } catch (error) {
      this.logger.error(
        `PDF rendering failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new UnprocessableEntityException(
        'The report could not be turned into a PDF on this machine. ' +
          'Use the print button instead and choose "Save as PDF".',
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  /// Where a browser might be. Windows first, because that is where this runs
  /// for real; Edge is part of Windows itself.
  private readonly candidates: string[] = [
    // Windows
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    // Linux
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];

  private findBrowser(): string | null {
    if (this.binary !== undefined) return this.binary;

    // An explicit choice wins over any guess.
    const chosen = process.env.KAYAN_PDF_BROWSER?.trim();
    if (chosen) {
      if (existsSync(chosen)) {
        this.logger.log(`Making PDFs with ${chosen}`);
        this.binary = chosen;
        return this.binary;
      }
      this.logger.warn(
        `KAYAN_PDF_BROWSER points at "${chosen}", which does not exist. Looking for another browser.`,
      );
    }

    for (const candidate of this.candidates) {
      if (existsSync(candidate)) {
        this.logger.log(`Making PDFs with ${candidate}`);
        this.binary = candidate;
        return this.binary;
      }
    }

    for (const name of ['msedge', 'chrome', 'chromium', 'chromium-browser', 'google-chrome']) {
      const found = which(name);
      if (found) {
        this.logger.log(`Making PDFs with ${found}`);
        this.binary = found;
        return this.binary;
      }
    }

    this.logger.warn(
      'No browser found on this machine, so reports cannot be turned into PDFs here. ' +
        'The print button still works and the browser can save the page as a PDF.',
    );
    this.binary = null;
    return this.binary;
  }

  /// Kept next to the service so the paper size can be adjusted from one place
  /// if a report ever needs a different shape.
  get pageSetup() {
    return this.paper;
  }
}

/// Runs a command and resolves when it exits cleanly.
function run(command: string, args: string[], timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (error) => {
      // The print-to-pdf flag makes some builds exit with a warning code even
      // though the file was written; the caller checks the file itself, so a
      // non-zero code is only reported when there is no file to show for it.
      if (error && (error as NodeJS.ErrnoException).code !== '0') {
        if ((error as { killed?: boolean }).killed) {
          reject(new Error(`the browser was still running after ${timeout} ms`));
          return;
        }
      }
      resolve();
    });
  });
}

/// The PATH lookup, without pulling in a dependency for one function.
function which(name: string): string | null {
  const paths = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':');
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const folder of paths) {
    if (!folder) continue;
    for (const extension of extensions) {
      const candidate = join(folder, name + extension);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}
