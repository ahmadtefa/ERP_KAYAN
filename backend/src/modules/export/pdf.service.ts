import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile, spawn } from 'child_process';
import { pathToFileURL } from 'url';

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

  /// How the last document was printed: through the browser's own protocol, or
  /// by the command line printer it fell back to. The fallback cannot paint a
  /// page background, so the difference matters and a test pins it.
  lastRenderRoute: 'devtools' | 'command-line' | null = null;

  /// Why the browser protocol was not used, when it was not.
  lastRenderNote: string | null = null;

  /// Whether this installation can make PDFs at all. The screen asks, so a
  /// button that cannot work is never shown.
  get available(): boolean {
    return this.findBrowser() !== null;
  }

  /// A4 portrait, the sheet the quotation's `@page` rule asks for.
  ///
  /// Chromium prints the page with the size its stylesheet declares - the
  /// quotation asks for zero margins, because its design paints to the paper's
  /// edge - and this constant is kept for the callers that ask what shape the
  /// output has.
  private readonly paper = {
    width: '210mm',
    height: '297mm',
    margin: '0',
  };

  async render(html: string, options: PdfRenderOptions = {}): Promise<Buffer> {
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
    // A browser profile that exists only for this one print. Without it the
    // headless run shares the default profile: under a Windows service
    // account that profile may not be creatable at all, and when the same
    // user already has Edge/Chrome open the request is handed to the
    // running instance, which exits "successfully" without writing any
    // file. Both presented to the user as "Download PDF does nothing".
    const profile = join(folder, 'profile');

    // Whether the page was printed through the browser's own protocol, which is
    // the only route that can be told to keep the page's background artwork and
    // its own paper size. The command line printer cannot be told either, so a
    // document that needs them and falls back to it must not pretend they are
    // there.
    let fullBleed = false;

    try {
      await writeFile(page, html, 'utf8');

      if (options.fullBleed) {
        // Two transports for the same conversation: the pipe, which no other
        // process can reach, and a loopback socket for the platforms that do
        // not hand the browser its pipe handles.
        // Four ways to ask, cheapest first. The pipe costs nothing outside
        // this process; the loopback socket covers platforms that do not hand
        // the browser its pipe handles; and the second spelling of the flag
        // covers browsers that have retired the first or have not learned it
        // yet. A browser that refuses a flag exits at once, so a wrong guess
        // costs milliseconds rather than a timeout.
        const requested = process.env.KAYAN_PDF_TRANSPORT;
        const attempts: Array<{ transport: 'pipe' | 'socket'; legacyHeadless: boolean; timeout: number }> = [
          // A cold browser on a Windows machine is slow to open its debugging
          // channel - the executable is large, and a first run is scanned and
          // unpacked before it says a word - while a warm one answers in a
          // second. The budgets are for that first run.
          { transport: 'pipe', legacyHeadless: false, timeout: 30_000 },
          { transport: 'pipe', legacyHeadless: true, timeout: 30_000 },
          { transport: 'socket', legacyHeadless: false, timeout: 20_000 },
          { transport: 'socket', legacyHeadless: true, timeout: 20_000 },
        ].filter(
          (attempt) =>
            !requested || requested === attempt.transport,
        ) as typeof attempts;

        for (const attempt of attempts) {
          try {
            const printed = await printThroughDevTools(browser, {
              page,
              profile: join(folder, `devtools-${attempt.transport}-${attempt.legacyHeadless ? 'new' : 'plain'}`),
              timeout: attempt.timeout,
              transport: attempt.transport,
              legacyHeadless: attempt.legacyHeadless,
            });
            await writeFile(output, printed);
            fullBleed = true;
            break;
          } catch (error) {
            this.lastRenderNote = `${attempt.transport}${attempt.legacyHeadless ? '=new' : ''}: ${(error as Error).message}`;
            this.logger.warn(
              `The browser would not print over its ${attempt.transport} ` +
                `(${attempt.legacyHeadless ? '--headless=new' : '--headless'}): ${(error as Error).message}`,
            );
          }
        }
        if (!fullBleed) {
          this.logger.warn(
            'Falling back to the command line printer, which cannot keep the page background.',
          );
        }
      }

      if (!fullBleed) {
        await run(
          browser,
          buildPrintArgs({ output, profile, page, legacyHeadless: false }),
          60_000,
        );
      }

      if (!fullBleed && !existsSync(output)) {
        // Older browser builds reject `--headless=new`; the classic flag is
        // the same print pipeline and worth one retry before giving up.
        this.logger.warn(
          'Headless print produced no file; retrying with the classic --headless flag.',
        );
        await run(
          browser,
          buildPrintArgs({ output, profile, page, legacyHeadless: true }),
          60_000,
        );
      }

      if (!existsSync(output)) {
        throw new Error('the browser produced no file');
      }

      const pdf = await readFile(output);
      if (pdf.length === 0 || pdf.subarray(0, 4).toString('latin1') !== '%PDF') {
        throw new Error('the browser produced something that is not a PDF');
      }

      this.lastRenderRoute = fullBleed ? 'devtools' : 'command-line';

      // Page numbers, stamped across the whole document: a report printed on
      // paper has to be able to say "page 3 of 7". The digits are Western in
      // both languages, the same as everywhere else in the program.
      //
      // A document whose design survived keeps the ink its background asks
      // for. One that fell back to the command line printer has no design at
      // all, so it gets the plain grey number in the white margin instead of
      // white-on-white.
      return await stampPageNumbers(
        pdf,
        options.fullBleed && !fullBleed
          ? { pageNumberSize: PAGE_NUMBER_GEOMETRY.size, pageNumberY: PAGE_NUMBER_GEOMETRY.y }
          : options,
      );
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
      await removeProfileFolder(folder);
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

/// Where the stamped number sits, in PDF points from the bottom edge.
///
/// The quotation's bottom band is 26 mm tall and its footer text stops 10.5 mm
/// above the paper's edge, so a 9 pt number centred at 10 pt leaves a clear gap
/// under the legal line instead of crowding it. Reports that do not use the
/// quotation design keep their number in the margin the browser left free.
export const PAGE_NUMBER_GEOMETRY = { y: 12, size: 9 };

export interface PdfRenderOptions {
  /// Print the page with its own paper size, its own margins and its
  /// background artwork.
  ///
  /// The command line printer (`--print-to-pdf`) keeps neither: it lays the
  /// page out at its own default size, on white, so a design that paints to
  /// the paper's edge would simply disappear. Setting this asks the browser
  /// through its DevTools pipe instead - the route a debugger or Puppeteer
  /// uses - where "print the backgrounds" and "use the CSS page size" are
  /// explicit instructions rather than defaults nobody documents.
  fullBleed?: boolean;
  /// The colour the number is drawn in, decided by the page's own design: the
  /// quotation's band is dark and wants white, a light footer wants ink.
  pageNumberColor?: { r: number; g: number; b: number };
  /// Points from the bottom edge; defaults to {@link PAGE_NUMBER_GEOMETRY}.
  pageNumberY?: number;
  pageNumberSize?: number;
}

/// Adds "n / total" in the horizontal centre of every page.
export async function stampPageNumbers(
  pdf: Buffer,
  options: PdfRenderOptions = {},
): Promise<Buffer> {
  const document = await PDFDocument.load(pdf);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const pages = document.getPages();
  const total = pages.length;
  const size = options.pageNumberSize ?? PAGE_NUMBER_GEOMETRY.size;
  const y = options.pageNumberY ?? PAGE_NUMBER_GEOMETRY.y;
  const ink = options.pageNumberColor ?? { r: 0.45, g: 0.45, b: 0.45 };

  pages.forEach((page, index) => {
    const { width } = page.getSize();
    const label = `${index + 1} / ${total}`;
    const textWidth = font.widthOfTextAtSize(label, size);
    page.drawText(label, {
      x: (width - textWidth) / 2,
      y,
      size,
      font,
      color: rgb(ink.r, ink.g, ink.b),
    });
  });

  return Buffer.from(await document.save());
}

/**
 * The command line for one headless print. Kept as a pure function so the
 * flags that make printing work on a real Windows install — above all the
 * throwaway `--user-data-dir` profile — are pinned by a unit test instead
 * of by somebody's memory.
 */
export function buildPrintArgs(options: {
  output: string;
  profile: string;
  page: string;
  legacyHeadless: boolean;
}): string[] {
  return [
    options.legacyHeadless ? '--headless' : '--headless=new',
    // A server container has no sandbox to use; the page is our own and
    // never leaves the machine.
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    // Nothing here fetches anything: the page is self contained - fonts and
    // logo travel inside it as data URIs. These flags turn that from a hope
    // into a rule: no background networking at all, and every host name
    // resolves to nothing, so a stray http(s) reference could not load even if
    // one appeared. Rendering still works with no network on the machine.
    '--disable-background-networking',
    '--host-resolver-rules=MAP * ~NOTFOUND',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    // One print, one profile: see PdfService.render for why sharing the
    // default profile silently produces no file.
    `--user-data-dir=${options.profile}`,
    `--print-to-pdf=${options.output}`,
    '--no-pdf-header-footer',
    '--virtual-time-budget=5000',
    `file://${options.page}`,
  ];
}

/// The flags for the DevTools route. Exported so the spec can pin them.
export function buildDevToolsArgs(options: {
  profile: string;
  page: string;
  legacyHeadless: boolean;
}): string[] {
  return [
    // Plain `--headless`, not `--headless=new`: the spelling with `=new` is a
    // transitional alias, and a browser new enough to have dropped it exits
    // without printing anything. Plain `--headless` has meant "no window" in
    // every build since 2017, and the protocol below is the same in all of
    // them.
    options.legacyHeadless ? '--headless=new' : '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    // No network of any kind: the page carries its own font and logo.
    '--disable-background-networking',
    '--host-resolver-rules=MAP * ~NOTFOUND',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${options.profile}`,
    // Commands arrive on file descriptor 3 and answers leave on 4, so the
    // browser never opens a port anyone else could talk to.
    '--remote-debugging-pipe',
    ...(options.page ? [options.page] : []),
  ];
}

/// The same browser, asked for a debugging port of its own choosing: the route
/// that still works where the platform does not hand the browser its pipe
/// handles. Port zero means the browser picks one and prints it on its error
/// stream, on the loopback interface, for this process only.
export function buildDevToolsSocketArgs(options: {
  profile: string;
  legacyHeadless: boolean;
}): string[] {
  return [
    options.legacyHeadless ? '--headless=new' : '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--host-resolver-rules=MAP * ~NOTFOUND',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${options.profile}`,
    '--remote-debugging-port=0',
    'about:blank',
  ];
}

/// Deletes the browser's profile folder, and does not make a document fail
/// because it could not.
///
/// Windows keeps a killed browser's files for a moment: the lockfile it writes
/// into its profile is still held while its helper processes are going away,
/// and a recursive removal then fails with EBUSY - after the PDF was already
/// made. `fs.rm` retries EBUSY, EPERM and ENOTEMPTY on its own when asked, so
/// it is asked; and a folder that still will not go is a line in the log, not a
/// customer staring at an error instead of their quotation.
export async function removeProfileFolder(
  folder: string,
  remove: typeof rm = rm,
): Promise<boolean> {
  try {
    await remove(folder, { recursive: true, force: true, maxRetries: 12, retryDelay: 150 });
    return true;
  } catch (error) {
    new Logger('PdfService').warn(
      `Left the browser profile at ${folder}: ${(error as Error).message}`,
    );
    return false;
  }
}

/// Prints one page through the browser's own DevTools protocol.
///
/// Why not the command line printer: `--print-to-pdf` decides the paper size
/// and the background on its own, and it decides both the way the browser's
/// own print dialog would - no painted backgrounds, its own default sheet. A
/// document whose whole point is a printed design cannot live with that. What
/// a debugger asks for instead is explicit: keep the backgrounds, use the
/// page's CSS size, no margins. Chromium then writes exactly the sheet the
/// stylesheet describes, painted to its edge.
///
/// Two ways to talk: `--remote-debugging-pipe` hands the conversation to file
/// descriptors 3 and 4, which needs no port and no loopback socket; the socket
/// transport asks the browser for a port of its own choosing and speaks the
/// same protocol over a WebSocket. The pipe is tried first, because nothing
/// outside this process can reach it.
function printThroughDevTools(
  binary: string,
  options: {
    page: string;
    profile: string;
    timeout: number;
    transport: 'pipe' | 'socket';
    legacyHeadless: boolean;
  },
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const socket = options.transport === 'socket';
    const child = spawn(
      binary,
      socket
        ? buildDevToolsSocketArgs({
            profile: options.profile,
            legacyHeadless: options.legacyHeadless,
          })
        : buildDevToolsArgs({
            profile: options.profile,
            page: 'about:blank',
            legacyHeadless: options.legacyHeadless,
          }),
      {
        stdio: socket
          ? ['ignore', 'ignore', 'pipe', 'ignore', 'ignore']
          : ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
      },
    );

    // Whatever the browser says on its way out is the only clue a support call
    // would have; keep the tail of it for the warning.
    let complaints = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      complaints = (complaints + chunk.toString('utf8')).slice(-600);
    });
    // A browser that was asked to close has done what it was told; one that
    // leaves while it is still being spoken to has failed the attempt.
    let closing = false;
    const exited = new Promise<void>((done) => child.once('exit', () => done()));
    child.on('exit', (code) => {
      if (closing) return;
      stop(new Error(`the browser exited with code ${code}${complaints ? `: ${complaints.trim()}` : ''}`));
    });
    child.on('error', (error) => stop(error));

    let settled = false;
    const stop = (error: Error | null, pdf?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // The browser's own children - renderer, GPU - inherit the pipe, so the
      // handles have to be closed here instead of being left to the operating
      // system: an open handle keeps the printing process - and the test run
      // around it - alive after the browser itself was killed.
      for (const handle of [child.stdio[3], child.stdio[4]]) {
        const stream = handle as unknown as { destroy?: () => void } | null;
        try {
          stream?.destroy?.();
        } catch {
          // A handle that is already gone needs no closing.
        }
      }
      try {
        child.kill('SIGKILL');
      } catch {
        // Killing a process that has already exited is not an error here.
      }
      child.unref();
      if (error) reject(error);
      else resolve(pdf as Buffer);
    };

    const timer = setTimeout(
      () => stop(new Error(`the browser did not finish printing in ${options.timeout} ms`)),
      options.timeout,
    );

    const conversation = socket
      ? webSocketConversation(child)
      : pipeConversation(child);

    void (async () => {
      const client = await conversation;
      const pdf = await printOnePage(client, options.page);
      // Ask the browser to shut itself down before the document is handed
      // back. On Windows its profile stays locked until every one of its
      // processes is gone, and the folder that holds the profile cannot be
      // deleted while it is held. The request is not awaited - a browser that
      // is closing has no one left to answer - but the exit is.
      closing = true;
      void client.send('Browser.close').catch(() => undefined);
      let grace: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        exited,
        new Promise<void>((done) => {
          grace = setTimeout(done, 3_000);
        }),
      ]);
      if (grace) clearTimeout(grace);
      stop(null, pdf);
    })().catch((error) => stop(error as Error));
  });
}

/// One command channel to the browser: a NUL-terminated JSON stream over the
/// pipe, or the same messages as WebSocket frames.
interface CdpClient {
  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<Record<string, unknown>>;
  when(method: string): Promise<void>;
}

function pipeConversation(child: ReturnType<typeof spawn>): Promise<CdpClient> {
  return new Promise((resolve) => {
    const commands = child.stdio[3] as NodeJS.WritableStream;
    const answers = child.stdio[4] as NodeJS.ReadableStream;
    const pending = new Map<
      number,
      { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
    >();
    const waiting: Array<{ method: string; resolve: () => void }> = [];
    let received = Buffer.alloc(0);
    let nextId = 0;

    const dispatch = (message: Record<string, unknown>) => {
      const id = message.id as number | undefined;
      if (id !== undefined && pending.has(id)) {
        const request = pending.get(id)!;
        pending.delete(id);
        const failure = message.error as { message?: string } | undefined;
        if (failure) request.reject(new Error(failure.message ?? 'the browser refused the request'));
        else request.resolve((message.result ?? {}) as Record<string, unknown>);
        return;
      }
      const method = message.method as string | undefined;
      const index = method ? waiting.findIndex((entry) => entry.method === method) : -1;
      if (index >= 0) waiting.splice(index, 1)[0].resolve();
    };

    answers.on('data', (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      let end = received.indexOf(0);
      while (end !== -1) {
        const frame = received.subarray(0, end).toString('utf8');
        received = received.subarray(end + 1);
        if (frame.trim()) {
          try {
            dispatch(JSON.parse(frame) as Record<string, unknown>);
          } catch {
            // A frame that is not JSON is not part of the protocol; skip it.
          }
        }
        end = received.indexOf(0);
      }
    });
    answers.on('error', () => undefined);

    resolve({
      send: (method, params = {}, session) =>
        new Promise<Record<string, unknown>>((accept, refuse) => {
          const id = ++nextId;
          pending.set(id, { resolve: accept, reject: refuse });
          const message = session
            ? { id, method, params, sessionId: session }
            : { id, method, params };
          commands.write(`${JSON.stringify(message)}\0`);
        }),
      when: (method) =>
        new Promise<void>((accept) => waiting.push({ method, resolve: accept })),
    });
  });
}

/// The same conversation over the address the browser prints on its error
/// stream when it is asked for a debugging port of its own.
function webSocketConversation(child: ReturnType<typeof spawn>): Promise<CdpClient> {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket !== 'function') {
      reject(new Error('this Node.js build has no WebSocket client'));
      return;
    }
    let output = '';
    let opened = false;

    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      const found = /DevTools listening on (ws:\/\/[^\s]+)/.exec(output);
      if (!found || opened) return;
      opened = true;

      const socket = new WebSocket(found[1]);
      const pending = new Map<
        number,
        { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
      >();
      const waiting: Array<{ method: string; resolve: () => void }> = [];
      let nextId = 0;

      const dispatch = (message: Record<string, unknown>) => {
        const id = message.id as number | undefined;
        if (id !== undefined && pending.has(id)) {
          const request = pending.get(id)!;
          pending.delete(id);
          const failure = message.error as { message?: string } | undefined;
          if (failure) request.reject(new Error(failure.message ?? 'the browser refused the request'));
          else request.resolve((message.result ?? {}) as Record<string, unknown>);
          return;
        }
        const method = message.method as string | undefined;
        const index = method ? waiting.findIndex((entry) => entry.method === method) : -1;
        if (index >= 0) waiting.splice(index, 1)[0].resolve();
      };

      socket.addEventListener('message', (event: { data: unknown }) => {
        try {
          dispatch(JSON.parse(String(event.data)) as Record<string, unknown>);
        } catch {
          // Not part of the protocol.
        }
      });
      socket.addEventListener('error', () =>
        reject(new Error('the debugging socket refused the connection')),
      );
      socket.addEventListener('open', () =>
        resolve({
          send: (method, params = {}, session) =>
            new Promise<Record<string, unknown>>((accept, refuse) => {
              const id = ++nextId;
              pending.set(id, { resolve: accept, reject: refuse });
              socket.send(
                JSON.stringify(
                  session ? { id, method, params, sessionId: session } : { id, method, params },
                ),
              );
            }),
          when: (method) =>
            new Promise<void>((accept) => waiting.push({ method, resolve: accept })),
        }),
      );
    });
  });
}

/// Everything one print needs to say to the browser, in order.
async function printOnePage(client: CdpClient, page: string): Promise<Buffer> {
  // The browser answers the first command once it is listening, so this
  // doubles as "is it up yet".
  await client.send('Browser.getVersion');
  const target = await client.send('Target.createTarget', { url: 'about:blank' });
  const attached = await client.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  const session = attached.sessionId as string;

  await client.send('Page.enable', {}, session);
  const loaded = client.when('Page.loadEventFired');
  await client.send('Page.navigate', { url: pathToFileURL(page).href }, session);
  await loaded;

  // The Arabic face is embedded in the page as a data URI, but the layout is
  // measured the moment the font arrives: printing before that is how a
  // quotation ends up in a fallback face, or with the wrong line breaks.
  await client.send(
    'Runtime.evaluate',
    {
      expression:
        'document.fonts.ready.then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))',
      awaitPromise: true,
      returnByValue: true,
    },
    session,
  );

  const printed = await client.send(
    'Page.printToPDF',
    {
      // The design is painted with the page's own colours; without this
      // Chromium prints it blank.
      printBackground: true,
      // A4 and a zero margin, as the stylesheet writes them.
      preferCSSPageSize: true,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
      scale: 1,
      transferMode: 'ReturnAsBase64',
    },
    session,
  );

  const data = printed.data as string | undefined;
  if (!data) throw new Error('the browser returned no PDF');
  const pdf = Buffer.from(data, 'base64');
  if (pdf.subarray(0, 4).toString('latin1') !== '%PDF') {
    throw new Error('the browser returned something that is not a PDF');
  }
  return pdf;
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
