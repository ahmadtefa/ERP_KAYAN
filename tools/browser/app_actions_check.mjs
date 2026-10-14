#!/usr/bin/env node
/**
 * Drives the real KAYAN ERP web app in a real browser and checks the four
 * things a person does with a file: download an export, print a report,
 * choose a spreadsheet to import, and take a full backup.
 *
 * What it asserts comes from the browser itself, not from pixels: the files
 * that arrive (CDP download events), the tabs that open (their URLs), and the
 * requests the app sends. The screen is only clicked — through Flutter's
 * accessibility labels (`--force-renderer-accessibility`), so the script
 * follows the wording of the buttons rather than their coordinates.
 *
 *   node tools/browser/app_actions_check.mjs [appUrl]
 *
 * Environment:
 *   CHROME_PATH        the browser to drive (default: the usual install paths)
 *   ADMIN_USERNAME     sign-in name   (default: admin)
 *   ADMIN_PASSWORD     sign-in secret (default: Admin@12345 - the dev seed)
 *   OUT_DIR            where screenshots, downloads and the report go
 *                      (default: /tmp/kayan-e2e)
 *
 * Exit code 0 means every check passed. Each check prints PASS/FAIL with what
 * it saw, so a failure in CI says which promise was broken and how.
 *
 * When a button cannot be found, the script writes down every label the page
 * did publish — `labels-*.json` next to the screenshots — because a click
 * that finds nothing is almost always a wording change, and the fix is to
 * read the real wording rather than to guess at it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const requireFromHere = createRequire(import.meta.url);

const APP_URL = process.argv[2] || process.env.APP_URL || 'http://127.0.0.1:3000';
const USERNAME = process.env.ADMIN_USERNAME || 'admin';
const PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@12345';
const OUT_DIR = process.env.OUT_DIR || '/tmp/kayan-e2e';

// ─────────────────────────────────────────────────────────────── the results

const results = [];
const consoleLines = [];

/**
 * Writes a line to the log, and does not lose it.
 *
 * `console.log` to a pipe is asynchronous in Node: when a process ends with
 * `process.exit()`, whatever it had not flushed yet simply disappears. That
 * is how a run can end with no verdict at the bottom of its own log - the
 * lines were written, they were just not on their way out yet. Writing
 * synchronously means the last line of a failing run is the one that says
 * why.
 */
const log = (line) => {
  consoleLines.push(String(line));
  try {
    writeSync(1, `${line}\n`);
  } catch {
    // stdout is gone (the pipe closed); there is nowhere left to say it.
  }
};

function check(name, ok, detail) {
  results.push({ name, ok, detail: detail ?? null });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  save();
}

function save() {
  try {
    writeFileSync(
      join(OUT_DIR, 'browser-check.json'),
      JSON.stringify(
        { appUrl: APP_URL, ok: results.every((r) => r.ok), results, consoleLines },
        null,
        2,
      ),
    );
    const passed = results.filter((r) => r.ok).length;
    writeFileSync(
      join(OUT_DIR, 'summary.txt'),
      `${passed}/${results.length} checks passed\n` +
        results
          .map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` - ${r.detail}` : ''}`)
          .join('\n') +
        '\n',
    );
  } catch {
    /* the report is a courtesy; never let it mask the real failure */
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ───────────────────────────────────────────────────────────────── the browser

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].find(existsSync);
}

function loadPuppeteer() {
  try {
    return requireFromHere('puppeteer-core');
  } catch {
    // Installed on demand where the tool runs (CI job or a dev machine).
    const install = spawnSync(
      'npm',
      ['install', '--no-save', '--prefix', here, 'puppeteer-core'],
      { stdio: 'inherit' },
    );
    if (install.status !== 0) {
      throw new Error('puppeteer-core could not be installed — see the npm output above');
    }
    return requireFromHere('puppeteer-core');
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const downloadDir = join(OUT_DIR, 'downloads');
  mkdirSync(downloadDir, { recursive: true });

  const executablePath = chromePath();
  if (!executablePath) {
    check(
      'a browser is installed for the check to drive',
      false,
      'no Chrome or Chromium was found; set CHROME_PATH to one',
    );
    return 1;
  }

  const puppeteer = loadPuppeteer();
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      // The one flag that matters: with it, Flutter web publishes its
      // accessibility tree into the DOM and the buttons can be found by
      // name rather than by pixel.
      '--force-renderer-accessibility',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-popup-blocking',
      // The program is Arabic-first. Asking the browser for Arabic means
      // what is clicked is what a user in Cairo would read, which is also
      // the harder of the two cases: RTL layout and Arabic filenames.
      '--lang=ar-EG',
      '--accept-lang=ar-EG,ar',
    ],
  });

  browser.on('disconnected', () => log('DIED the browser went away'));

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(45000);
    await page.setViewport({ width: 1440, height: 900 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ar-EG,ar;q=0.9' });

    // A Flutter web page that runs out of memory or hits a fatal engine
    // error closes the page underneath the check; without this, the run
    // simply stops and the exit code is all there is to go on.
    page.on('error', (error) => log(`DIED the page crashed: ${error.message}`));
    page.on('close', () => log('DIED the page was closed'));

    const consoleErrors = [];
    page.on('pageerror', (error) => {
      consoleErrors.push(`pageerror: ${error.message}`);
      consoleLines.push(`pageerror: ${error.message}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(`console: ${message.text()}`);
        consoleLines.push(`console: ${message.text()}`);
      }
    });

    // Observe downloads through the browser's own download manager.
    const cdp = await page.createCDPSession();
    const downloads = [];
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allowAndName',
      downloadPath: downloadDir,
      eventsEnabled: true,
    });
    cdp.on('Browser.downloadWillBegin', (event) => {
      downloads.push({
        url: event.url,
        suggested: event.suggestedFilename,
        guid: event.guid,
        done: false,
      });
    });
    cdp.on('Browser.downloadProgress', (event) => {
      const entry = downloads.find((item) => item.guid === event.guid);
      if (entry) entry.done = event.state === 'completed';
    });

    const network = [];
    page.on('request', (request) =>
      network.push({
        url: request.url(),
        method: request.method(),
        post: request.postData(),
      }),
    );

    // Anything the server could not do or rejected.
    const serverErrors = [];
    page.on('response', async (response) => {
      if (response.status() < 400) return;
      let body = '';
      try {
        body = (await response.text()).replace(/\s+/g, ' ').slice(0, 300);
      } catch {
        body = '(the body was gone before it could be read)';
      }
      if (response.status() >= 500) {
        serverErrors.push(`${response.status()} ${response.url()} ${body}`);
      }
      log(`SERVER ${response.status()} ${response.url()} ${body}`);
    });

    // What the server answered. The one response that matters most is the
    // sign-in: if the screen does not move, the reason is in that status
    // code and not in the clicking.
    const responses = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (!/\/auth\/(login|refresh|download-ticket)/.test(url)) return;
      let body = '';
      try {
        body = (await response.text()).slice(0, 300);
      } catch {
        body = '(the body was gone before it could be read)';
      }
      responses.push({ url, status: response.status(), body });
      log(`LOGIN ${response.status()} ${url.split('/api/v1')[1] ?? url} ${body}`);
    });

    const shot = async (name) => {
      const path = join(OUT_DIR, `${name}.png`);
      await page.screenshot({ path }).catch(() => {});
      return path;
    };

    /**
     * Every label the page publishes, so a click that finds nothing can say
     * what was there instead of just that it found nothing.
     */
    const publishedLabels = () =>
      page.evaluate(() =>
        Array.from(
          document.querySelectorAll(
            'flt-semantics, [role="button"], [role="menuitem"], [role="tab"], [role="textbox"], [role="link"]',
          ),
        )
          .map((node) => ({
            label: (node.getAttribute('aria-label') || '').trim(),
            text: (node.textContent || '').trim().slice(0, 60),
            role: node.getAttribute('role') || node.tagName.toLowerCase(),
          }))
          .filter((node) => node.label || node.text),
      );

    /**
     * Everything the page will admit to, printed into the log.
     *
     * CI artifacts are a luxury a failing run does not always get read, so
     * what a stuck click needs to say has to reach the log itself. Each
     * line is prefixed so the workflow can lift them into annotations.
     */
    async function describe(step) {
      try {
        const labels = await publishedLabels();
        writeFileSync(
          join(OUT_DIR, `labels-${step}.json`),
          JSON.stringify(labels, null, 2),
        );
        const names = labels
          .map((node) => `${node.label || node.text}[${node.role}]`)
          .filter(Boolean);
        for (let index = 0; index < names.length; index += 6) {
          log(`LABELS ${step}: ${names.slice(index, index + 6).join(' | ')}`);
        }
        const inputs = await page.$$eval('input', (nodes) =>
          nodes.map((node) => ({
            type: node.type,
            hidden: node.hidden,
            aria: node.getAttribute('aria-label') || '',
            rect: (() => {
              const r = node.getBoundingClientRect();
              return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
            })(),
          })),
        );
        writeFileSync(join(OUT_DIR, `inputs-${step}.json`), JSON.stringify(inputs, null, 2));
        log(`INPUTS ${step}: ${inputs.length} input element(s)`);
        for (const input of inputs.slice(0, 6)) {
          log(
            `INPUTS ${step}: type=${input.type} hidden=${input.hidden} ` +
              `at ${input.rect.x},${input.rect.y} aria="${input.aria}"`,
          );
        }
        const visible = await page.evaluate(() =>
          (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
        );
        log(`SCREEN ${step}: ${visible}`);
      } catch (error) {
        log(`LABELS ${step}: could not be read - ${error.message}`);
      }
    }

    /**
     * The centre of the smallest Flutter semantic node whose name includes
     * one of [names].
     *
     * Smallest, not first: the accessibility tree is nested, and the outer
     * node of the login screen carries the same words as the button inside
     * it because it contains that button. Taking the first match clicks the
     * middle of the whole screen. Taking the smallest clicks the control the
     * words belong to.
     */
    async function findNode(names, roles) {
      const found = await findAllNodes(names, roles);
      return found.length > 0 ? found[0] : null;
    }

    /** Every matching node, smallest first. */
    async function findAllNodes(names, roles) {
      const wanted = names.map((name) => name.toLowerCase());
      return page.evaluate(
        (needles, roleList) => {
          const selector =
            roleList.length > 0
              ? roleList.map((role) => `[role="${role}"]`).join(', ')
              : 'flt-semantics, [role="button"], [role="menuitem"], [role="tab"], [role="textbox"], [role="link"]';
          const matches = [];
          for (const node of Array.from(document.querySelectorAll(selector))) {
            const label = `${node.getAttribute('aria-label') || ''} ${node.textContent || ''}`;
            const lower = label.toLowerCase();
            if (!needles.some((needle) => lower.includes(needle))) continue;
            const rect = node.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            const role = node.getAttribute('role') || '';
            matches.push({
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              area: rect.width * rect.height,
              isControl: /^(button|menuitem|tab|link|textbox|checkbox|switch|radio)$/i.test(role),
              role,
              label: label.trim().slice(0, 40),
            });
          }
          // A screen can say the same words twice - the login screen has a
          // heading "Sign in" and a button "Sign in". The one that can be
          // pressed says so, so the controls are preferred over the plain
          // text before the smallest is chosen.
          const controls = matches.filter((match) => match.isControl);
          const pool = controls.length > 0 ? controls : matches;
          pool.sort((a, b) => a.area - b.area);
          return pool;
        },
        wanted,
        roles,
      );
    }

    /**
     * Clicks the first control whose label contains one of [names].
     *
     * Two languages are offered because the app follows the browser's
     * language: a check that only knows the Arabic wording breaks the day
     * somebody opens it in English, and vice versa.
     */
    async function clickNamed(names, { timeoutMs = 10000, step = 'click' } = {}) {
      const list = Array.isArray(names) ? names : [names];
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const at = await findNode(list, []);
        if (at) {
          log(`CLICK ${step}: "${at.label}" at ${Math.round(at.x)},${Math.round(at.y)}`);
          await page.mouse.click(at.x, at.y);
          return true;
        }
        await wait(250);
      }
      log(`LABELS missed: nothing labelled ${list.join(' / ')} was found at step ${step}`);
      await describe(step);
      return false;
    }

    const clickField = (names, step) =>
      clickNamed(names, { timeoutMs: 10000, step });

    async function waitForDownload(previousCount, timeoutMs = 30000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const fresh = downloads.slice(previousCount);
        if (fresh.length && fresh.every((item) => item.done)) return fresh;
        await wait(250);
      }
      return downloads.slice(previousCount);
    }

    const bytesOf = (entry) => {
      const byGuid = join(downloadDir, entry.guid);
      const byName = join(downloadDir, entry.suggested);
      const path = existsSync(byGuid) ? byGuid : existsSync(byName) ? byName : null;
      return path ? readFileSync(path) : Buffer.alloc(0);
    };

    // ───────────────────────────────────────────────────── 1. sign in
    // `a11y=1` is the program's own switch: on the web Flutter only
    // publishes the tree of button names when something asks for it, and
    // these checks follow names rather than pixels.
    const separator = APP_URL.includes('?') ? '&' : '?';
    await page.goto(`${APP_URL}${separator}a11y=1`, {
      waitUntil: 'networkidle2',
      timeout: 90000,
    });
    await wait(6000); // Flutter's first paint
    await shot('01-login');

    const published = await publishedLabels();
    check(
      'the program publishes the names of its controls',
      published.length > 3 &&
        !published.every((node) => /enable accessibility/i.test(node.label || '')),
      `${published.length} named control(s)` +
        (published.length <= 3
          ? ` - only: ${published.map((node) => node.label || node.text).join(' | ')}`
          : ''),
    );
    if (published.length <= 3) return 1;

    // Flutter web keeps a real <input> element for each text field, so the
    // credentials are typed into those rather than into a guessed point on
    // the screen. The labelled-node route stays as the fallback.
    /** Every value the text fields currently hold, empty ones left out. */
    const fieldValues = () =>
      page.$$eval('input', (nodes) =>
        nodes.map((node) => node.value ?? '').filter((value) => value !== ''),
      );

    /**
     * Puts one value into the field at [box].
     *
     * Typing into a canvas-drawn field loses the first keystroke often
     * enough to matter - the click that focuses the field is still being
     * handled when the first character arrives. So each attempt starts by
     * emptying the field, types slowly, and then reads the value back: what
     * is asserted is not that keys were pressed but that the field holds
     * what it should.
     */
    async function typeIntoField(box, value) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.mouse.click(box.x, box.y);
        await wait(300);
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await wait(120);
        await page.keyboard.type(value, { delay: 40 });
        await wait(150);
        const values = await fieldValues();
        if (values.includes(value)) return true;
        log(
          `INPUTS attempt ${attempt + 1} put ${JSON.stringify(values)} in the fields, not "${value}"`,
        );
      }
      return false;
    }

    async function typeIntoFields(values) {
      const inputs = await page.$$('input');
      const usable = [];
      for (const input of inputs) {
        const box = await input.evaluate((node) => {
          if (node.hidden || node.type === 'hidden') return null;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return null;
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        });
        if (box) usable.push({ input, box });
      }
      if (usable.length < values.length) return false;
      for (let index = 0; index < values.length; index += 1) {
        // Flutter's text fields are drawn on the canvas; the <input> is a
        // real element sitting on top of them, and a synthetic click on it
        // does not always land. Clicking where it is does.
        const ok = await typeIntoField(usable[index].box, values[index]);
        if (!ok) return false;
      }
      log(`INPUTS typed: ${JSON.stringify(await fieldValues())}`);
      return true;
    }

    let typed =
      (await typeIntoFields([USERNAME, PASSWORD]).catch(() => false)) === true;
    if (!typed) {
      const typedUser = await clickField(['اسم المستخدم', 'Username'], 'user-field');
      await page.keyboard.type(USERNAME);
      const typedPassword = await clickField(['كلمة المرور', 'Password'], 'password-field');
      await page.keyboard.type(PASSWORD);
      typed = typedUser && typedPassword;
    }
    await shot('02-credentials');
    await wait(500);

    const beforeLoginResponse = responses.length;
    await clickNamed(['تسجيل الدخول', 'Sign in'], { step: 'signin-button' });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (!/login|signin|setup/.test(page.url())) break;
      await wait(1000);
    }
    if (/login|signin|setup/.test(page.url())) {
      // A form that is filled in usually submits on Enter too. Trying it is
      // cheaper than a run that reports a sign-in it never attempted.
      log('LOGIN the button did not move the page; trying Enter');
      await page.keyboard.press('Enter');
      for (let attempt = 0; attempt < 12; attempt += 1) {
        if (!/login|signin|setup/.test(page.url())) break;
        await wait(1000);
      }
    }
    const loginResponse = responses
      .slice(beforeLoginResponse)
      .find((entry) => /\/auth\/login/.test(entry.url));
    if (loginResponse) {
      log(`LOGIN sign-in answered ${loginResponse.status}`);
    }
    await wait(9000);
    await shot('03-after-signin');
    const at = page.url();
    check(
      'sign in opens the workspace',
      typed && !/login|signin|setup/.test(at),
      `now at ${at}` +
        (loginResponse ? `, sign-in answered ${loginResponse.status}` : ''),
    );
    if (/login|signin|setup/.test(at)) {
      await describe('after-signin');
      return 1;
    }

    // Verify the company identity is visible on the dashboard:
    const dashboardLabels = await publishedLabels();
    const hasCompanyIdentity = dashboardLabels.some(
      (node) =>
        /شركة|كيان|kayan|company|code/i.test(node.label) ||
        /شركة|كيان|kayan|company|code/i.test(node.text),
    );
    check(
      'the dashboard displays the company identity and name',
      hasCompanyIdentity,
      'company information rendered in dashboard banner',
    );

    // ───────────────────────────────────────────── 2. export download
    const before = downloads.length;
    const wentToReports = await clickNamed(['التقارير', 'Reports'], { step: 'nav-reports' });
    await wait(5000);
    await shot('04-reports');
    check('the reports entry opens', wentToReports, `at ${page.url()}`);

    // A period has to be chosen before a report has anything to show.
    await clickNamed(['عرض التقرير', 'ميزان المراجعة', 'Trial balance', 'Show report'], {
      timeoutMs: 6000,
      step: 'report-choose',
    }).catch(() => false);
    await wait(3000);

    const clickedExcel = await clickNamed(['إكسل', 'Excel'], { step: 'export-excel' });
    const arrived = await waitForDownload(before);
    check(
      'an export button downloads a spreadsheet file',
      clickedExcel && arrived.length > 0,
      arrived.map((item) => item.suggested).join(', ') || 'no download arrived',
    );
    if (arrived.length) {
      const bytes = bytesOf(arrived[arrived.length - 1]);
      check(
        'the downloaded file is a real spreadsheet',
        bytes.length > 500 && bytes.subarray(0, 2).toString('latin1') === 'PK',
        `${bytes.length} bytes, ${bytes.subarray(0, 2).toString('latin1')} signature`,
      );
    }

    // ───────────────────────────────────────────── 3. print page
    const beforeTabs = (await browser.pages()).length;
    const clickedPrint = await clickNamed(['طباعة', 'Print'], { step: 'print' });
    let printUrl = '';
    let printPage = null;
    for (let i = 0; i < 15; i++) {
      const currentPages = await browser.pages();
      printPage = currentPages.find((p) => /\/print/.test(p.url()));
      if (printPage) {
        printUrl = printPage.url();
        break;
      }
      const printFrame = page.frames().find((f) => /\/print/.test(f.url()));
      if (printFrame) {
        printUrl = printFrame.url();
        break;
      }
      await wait(500);
    }
    if (!printUrl) {
      const currentPages = await browser.pages();
      printUrl = currentPages.length > beforeTabs ? currentPages[currentPages.length - 1].url() : page.url();
    }
    check(
      'the print button reaches a print page',
      clickedPrint && /\/print/.test(printUrl),
      printUrl,
    );
    if (printPage && printPage !== page) {
      await printPage
        .screenshot({ path: join(OUT_DIR, '05-print-page.png') })
        .catch(() => {});
      await printPage.close().catch(() => {});
      await page.bringToFront();
    }

    // ───────────────────────────────── 4. import template + file choose
    const beforeTemplate = downloads.length;
    const wentToImport = await clickNamed(['رفع بيانات', 'Import'], { step: 'nav-import' });
    await wait(5000);
    await shot('06-import');
    check('the import entry opens', wentToImport, `at ${page.url()}`);

    const clickedTemplate = await clickNamed(
      ['تنزيل القالب', 'تنزيل', 'Download the template', 'Download template'],
      { step: 'import-template' },
    );
    const templateArrived = await waitForDownload(beforeTemplate);
    check(
      'the template button downloads a file',
      clickedTemplate && templateArrived.length > 0,
      templateArrived.map((item) => item.suggested).join(', ') || 'no download arrived',
    );

    // Choosing a file: the real system dialogue is driven through CDP.
    const dryRunMark = network.length;
    let choseFile = false;
    try {
      const [chooser] = await Promise.all([
        page.waitForFileChooser({ timeout: 10000 }),
        clickNamed(['اختر الملف', 'ملف', 'file', 'File'], { timeoutMs: 10000, step: 'choose-file' }),
      ]);
      // A small spreadsheet the server can parse, written here so the tool
      // travels alone.
      const fixture = join(OUT_DIR, 'import-fixture.csv');
      writeFileSync(fixture, 'code,name_ar,name_en\nE2E-1,اختبار,Check\n');
      await chooser.accept([fixture]);
      choseFile = true;
    } catch {
      choseFile = false;
    }
    await wait(7000);
    await shot('07-after-file');
    const dryRunCalls = network
      .slice(dryRunMark)
      .filter(
        (request) =>
          /import\/.*dry/i.test(request.url) ||
          (/import\//.test(request.url) && request.method === 'POST'),
      );
    check(
      'choosing a file makes the app read it on the server',
      choseFile && dryRunCalls.length > 0,
      choseFile ? `${dryRunCalls.length} read request(s)` : 'no file chooser opened',
    );
    if (!choseFile) await describe('choose-file');

    // Closing the dialogue without a file must not wedge the button.
    let cancelRecovered = false;
    let cancelError = null;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const [chooser] = await Promise.all([
          page.waitForFileChooser({ timeout: 15000 }),
          clickNamed(
            ['اختر ملفاً آخر', 'اختر الملف', 'ملفاً', 'ملف', 'choose', 'file', 'File'],
            { timeoutMs: 15000, step: `choose-file-cancel-${attempt}` },
          ),
        ]);
        if (typeof chooser?.cancel === 'function') {
          await chooser.cancel();
        } else if (typeof chooser?.dismiss === 'function') {
          await chooser.dismiss();
        } else if (typeof chooser?.accept === 'function') {
          await chooser.accept([]);
        }
        await page.evaluate(() => {
          window.dispatchEvent(new Event('focus'));
          document.querySelectorAll('input[type="file"]').forEach((input) => {
            input.dispatchEvent(new Event('cancel', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }).catch(() => {});
        await wait(2000);
      }
      cancelRecovered = true;
    } catch (err) {
      cancelRecovered = false;
      cancelError = err?.message || String(err);
    }
    check('closing the file dialogue twice in a row is fine', cancelRecovered, cancelError);

    // ───────────────────────────────────────────── 5. full backup
    const beforeBackup = network.length;
    const beforeDump = downloads.length;
    const wentToBackup = await clickNamed(['النسخ الاحتياطي', 'Backup'], { step: 'nav-backup' });
    await wait(5000);
    await shot('08-backup');
    check('the backup entry opens', wentToBackup, `at ${page.url()}`);

    const clickedCreate = await clickNamed(['إنشاء نسخة', 'Create full backup'], {
      timeoutMs: 15000,
      step: 'create-backup',
    });
    await wait(25000);
    await shot('09-backup-made');
    const backupCalls = network
      .slice(beforeBackup)
      .filter((request) => /backup\/full/.test(request.url) && request.method === 'POST');
    check(
      'the backup button asks the server for a full backup',
      clickedCreate && backupCalls.length > 0,
      `${backupCalls.length} backup request(s)`,
    );

    const clickedDump = await clickNamed(['تنزيل', 'Download'], { step: 'download-backup' });
    const dumpArrived = await waitForDownload(beforeDump);
    check(
      'the backup file downloads',
      clickedDump && dumpArrived.length > 0,
      dumpArrived.map((item) => item.suggested).join(', ') || 'no download arrived',
    );
    if (dumpArrived.length) {
      const bytes = bytesOf(dumpArrived[dumpArrived.length - 1]);
      const magic = bytes.subarray(0, 5).toString('latin1');
      check(
        'the backup is a PostgreSQL archive',
        magic === 'PGDMP',
        `${bytes.length} bytes, magic=${JSON.stringify(magic)}`,
      );
    }

    // ───────────────────────────────────────────────────────── summary
    await shot('10-final');
    check(
      'the page raised no uncaught errors of its own',
      consoleErrors.filter((line) => !/favicon|fonts\.g/i.test(line)).length === 0,
      consoleErrors.slice(0, 3).join(' / ') || 'none',
    );
    check(
      'the server answered every request the program made',
      serverErrors.length === 0,
      serverErrors.slice(0, 3).join(' | ') || 'no 5xx was seen',
    );
  } finally {
    await browser.close().catch(() => {});
  }

  const failures = results.filter((result) => !result.ok);
  log(
    `\n${results.length - failures.length}/${results.length} checks passed` +
      (failures.length
        ? `\nFAILED: ${failures.map((entry) => entry.name).join('\n       ')}`
        : ''),
  );
  save();
  return failures.length ? 1 : 0;
}

mkdirSync(OUT_DIR, { recursive: true });

// Whatever ends this run should say so on its way out. A browser that goes
// away, a promise nobody awaited and a page that crashes all used to leave
// nothing behind but an exit code.
process.on('unhandledRejection', (reason) => {
  log(`DIED a promise was rejected and nobody caught it: ${reason?.stack ?? reason}`);
});
process.on('uncaughtException', (error) => {
  log(`DIED an exception escaped: ${error?.stack ?? error}`);
});

main()
  .then((code) => {
    // Not process.exit: it would cut the log off mid-sentence. Setting the
    // code lets Node finish writing and leave on its own.
    process.exitCode = code;
  })
  .catch((error) => {
    log(`the browser check itself broke: ${error?.stack ?? error}`);
    results.push({
      name: 'the check ran to the end',
      ok: false,
      detail: String(error?.message ?? error),
    });
    save();
    process.exitCode = 2;
  });
