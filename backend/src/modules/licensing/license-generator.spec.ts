import { execFileSync, spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addCalendarMonths } from './license-duration';
import { loadPublicKey, publicKeyFingerprint, verifyKey } from './license-key';
import {
  MACHINE,
  OTHER_MACHINE,
  expectCode,
  harness,
} from './licensing.harness';

/**
 * The supplier's generator and the product are two halves of one format. This
 * file runs the real tool - a separate process, no mocks - and then feeds what
 * it produced into the real service. If either side's idea of a key drifts,
 * these tests fail, which is the only thing standing between a paying customer
 * and a key the program will not read.
 */

const SCRIPT = join(
  process.cwd(),
  '..',
  'tools',
  'license-generator',
  'kayan-license.mjs',
);

let home: string;

const run = (...args: string[]): string =>
  execFileSync(process.execPath, [SCRIPT, ...args, '--home', home], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/** A second key folder: a different operator identity, or a test-only key. */
let otherHome: string;

const runOther = (...args: string[]): string =>
  execFileSync(process.execPath, [SCRIPT, ...args, '--home', otherHome], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const publicKeyOf = (folder: string) => loadPublicKey(readFileSync(join(folder, 'public-key.pem'), 'utf8'));

/** The product's own verification, applied to a key the tool printed. */
const productReads = (key: string, folder: string) => verifyKey(key, publicKeyOf(folder));

const registerOf = (folder: string) =>
  JSON.parse(readFileSync(join(folder, 'register.json'), 'utf8')) as {
    licences: Record<string, { seats: number; seatsUsed: number; status: string; licenseId: string }>;
    keys: Array<{ keyId: string; type: string; status: string; licenseId: string }>;
  };

const runFails = (...args: string[]): string => {
  try {
    run(...args);
    throw new Error('the tool should have refused this');
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    expect(failure.status).toBe(1);
    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }
};

/** The last line of a key the tool printed: the key itself. */
const lastKey = (output: string): string => {
  const match = /KYN1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.exec(output);
  if (!match) throw new Error(`no key in the output:\n${output}`);
  return match[0];
};

const licenceIdFrom = (output: string): string => {
  const match = /lic_[0-9a-f]{16}/.exec(output);
  if (!match) throw new Error(`no licence id in the output:\n${output}`);
  return match[0];
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'kayan-gen-'));
  run('init');
});

describe('the packaged generator layout', () => {
  it('has no runtime dependency of its own', () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), '..', 'tools', 'license-generator', 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    // Build-time tools live in sea/package.json; what the operator runs is
    // plain Node with nothing to install.
    expect(manifest.dependencies).toBeUndefined();
  });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const newLicence = (seats = 5, term = '1y') =>
  licenceIdFrom(run('licence', 'create', '--ref', 'test customer', '--seats', `${seats}`, '--term', term));

/**
 * A product installation whose only key is the generator's public key. Real
 * time is used: the keys this process issued are dated now, and a service
 * whose clock is months behind would rightly call them future-dated.
 */
const installation = (machineId: string = MACHINE) => {
  const printed = run('public-key');
  const der = /LICENSE_PUBLIC_KEY \(whole value, one line\):\s*(\S+)/.exec(printed)?.[1];
  if (!der) throw new Error(`no public key in the output:\n${printed}`);
  return harness({
    publicKeyText: der,
    machineId,
    clockIso: new Date().toISOString(),
  });
};

describe('the generator', () => {
  it('writes a key pair whose public half the product accepts', () => {
    const printed = run('public-key');
    const fingerprint = /fingerprint:\s*(\S+)/.exec(printed)?.[1];
    const pem = /-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/.exec(printed)?.[0];
    expect(pem).toBeDefined();
    const publicKey = loadPublicKey(pem!);
    expect(publicKeyFingerprint(publicKey)).toBe(fingerprint);
    if (process.platform !== 'win32') {
      expect(statSync(join(home, 'private-key.pem')).mode & 0o777).toBe(0o600);
    }
  });

  it('refuses to replace an existing key pair without an explicit instruction', () => {
    expect(runFails('init')).toMatch(/already exists/i);
    expect(runFails('init', '--rotate')).toMatch(/--i-understand/);
  });

  it('needs the licence to be registered before a key can be issued', () => {
    expect(runFails('issue', 'activation', '--licence', 'lic_nope', '--machine', MACHINE)).toMatch(
      /no licence/i,
    );
  });

  it('refuses a machine id that is not one', () => {
    const licence = newLicence();
    expect(
      runFails('issue', 'activation', '--licence', licence, '--machine', 'PC'),
    ).toMatch(/not a machine id/i);
  });

  it('reads back a key it issued, and notices a key it did not', () => {
    const licence = newLicence();
    const key = lastKey(
      run('issue', 'activation', '--licence', licence, '--machine', MACHINE),
    );
    expect(run('verify', key)).toMatch(/signature : valid/);

    const [prefix, payload, signature] = key.split('.');
    expect(run('verify', `${prefix}.${payload}.${signature.slice(0, -4)}AAAA`)).toMatch(
      /signature : INVALID/,
    );
  });

  it('stores no key material in the register', () => {
    const licence = newLicence();
    const key = lastKey(
      run('issue', 'activation', '--licence', licence, '--machine', MACHINE),
    );
    const register = readFileSync(join(home, 'register.json'), 'utf8');
    expect(register).not.toContain(key);
    expect(register).not.toContain('PRIVATE KEY');
  });

  it('refuses a register edited by hand', () => {
    newLicence();
    const path = join(home, 'register.json');
    const register = JSON.parse(readFileSync(path, 'utf8'));
    const id = Object.keys(register.licences)[0];
    register.licences[id].seats = 500;
    require('node:fs').writeFileSync(path, JSON.stringify(register));
    expect(runFails('list')).toMatch(/integrity check/i);
  });

  it('backs up the key and the register together, with checksums', () => {
    newLicence();
    const out = mkdtempSync(join(tmpdir(), 'kayan-gen-backup-'));
    try {
      run('backup', '--out', out);
      const { readdirSync } = require('node:fs') as typeof import('node:fs');
      const folder = join(out, readdirSync(out)[0]);
      const files = readdirSync(folder);
      expect(files).toEqual(
        expect.arrayContaining(['private-key.pem', 'public-key.pem', 'register.json', 'SHA256SUMS']),
      );
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe('a key the generator issued, applied by the product', () => {
  it('activates: the term and the seat limit are the ones the operator signed', async () => {
    const licence = newLicence(5, '1y');
    const key = lastKey(
      run('issue', 'activation', '--licence', licence, '--machine', MACHINE, '--term', '1y', '--seats', '5'),
    );
    const h = installation();
    try {
      const status = await h.service.activate(key);
      expect(status.state).toBe('ACTIVE');
      expect(status.licenseId).toBe(licence);
      // One calendar year from the moment it was applied.
      expect(status.expiresAt).toBe(
        addCalendarMonths(new Date(status.startsAt!), 12).toISOString(),
      );
      expect(status.seats).toEqual({ limit: 5, used: 0, available: 5 });
    } finally {
      h.dispose();
    }
  });

  it('renews: the calendar year is added to the end date', async () => {
    const licence = newLicence();
    const activationKey = lastKey(
      run('issue', 'activation', '--licence', licence, '--machine', MACHINE),
    );
    const renewalKey = lastKey(run('issue', 'renewal', '--licence', licence, '--term', '1y'));
    const h = installation();
    try {
      const activated = await h.service.activate(activationKey);
      // Renewed a day later, while still valid: the term is added to the end.
      const later = new Date(new Date(activated.startsAt!).getTime() + 86_400_000);
      h.setNow(later.toISOString());
      const status = await h.service.renew(renewalKey);
      expect(status.expiresAt).toBe(
        addCalendarMonths(new Date(activated.expiresAt!), 12).toISOString(),
      );
    } finally {
      h.dispose();
    }
  });

  it('raises the seats by the increment, not by the value', async () => {
    const licence = newLicence(5);
    const activationKey = lastKey(
      run('issue', 'activation', '--licence', licence, '--machine', MACHINE),
    );
    const seats = lastKey(run('issue', 'seats', '--licence', licence, '--increase', '3'));
    const h = installation();
    try {
      await h.service.activate(activationKey);
      const status = await h.service.addSeats(seats);
      expect(status.seats).toEqual({ limit: 8, used: 0, available: 8 });
      // The same key again is spent, not applied twice.
      await expect(h.service.addSeats(seats)).rejects.toBeTruthy();
      expect((await h.service.status({ fresh: true })).seats.limit).toBe(8);
    } finally {
      h.dispose();
    }
  });

  it('moves a licence to a new machine with its term, limit and used count', async () => {
    const licence = newLicence(4, '6m');
    const activationKey = lastKey(
      run('issue', 'activation', '--licence', licence, '--machine', MACHINE, '--term', '6m', '--seats', '4'),
    );
    run('licence', 'set', '--licence', licence, '--used', '2');

    // The replacement machine asked for its own code; the operator issues
    // the transfer against that code's machine id.
    const target = installation(OTHER_MACHINE);
    try {
      const request = target.service.requestCodeObject().code;
      expect(request.startsWith('KYNREQ1.')).toBe(true);
      const shown = run('show-request', request);
      expect(shown).toContain(OTHER_MACHINE);

      const transferKey = lastKey(
        run(
          'issue',
          'transfer',
          '--licence',
          licence,
          '--machine',
          OTHER_MACHINE,
          '--request',
          request,
          '--used',
          '2',
        ),
      );
      const status = await target.service.transfer(transferKey);
      expect(status.state).toBe('ACTIVE');
      expect(status.perpetual).toBe(false);
      expect(status.seats).toEqual({ limit: 4, used: 2, available: 2 });
    } finally {
      target.dispose();
    }
  });

  it('refuses the transfer key on a machine it does not name', async () => {
    const licence = newLicence();
    run('issue', 'activation', '--licence', licence, '--machine', MACHINE);
    const transferKey = lastKey(
      run('issue', 'transfer', '--licence', licence, '--machine', OTHER_MACHINE),
    );
    // The old machine tries to reuse the key meant for the replacement.
    const h = installation();
    try {
      await expectCode(h.service.transfer(transferKey), 'LICENSE_KEY_WRONG_MACHINE');
      expect(h.db.installations).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

  it('will not issue a seat key without a direction, or below the seats in use', () => {
    const licence = newLicence(5);
    expect(
      runFails('issue', 'seats', '--licence', licence),
    ).toMatch(/--increase N or --cap N/);
    run('licence', 'set', '--licence', licence, '--used', '4');
    expect(
      runFails('issue', 'seats', '--licence', licence, '--cap', '3'),
    ).toMatch(/below them/i);
  });
});

describe('type confusion across the two halves', () => {
  it('will not let a seats key activate, or an activation key add seats', async () => {
    const licence = newLicence();
    const activationKey = lastKey(
      run('issue', 'activation', '--licence', licence, '--machine', MACHINE),
    );
    const seats = lastKey(run('issue', 'seats', '--licence', licence, '--increase', '1'));
    const h = installation();
    try {
      // A seats key is not an activation key.
      await expectCode(h.service.activate(seats), 'LICENSE_KEY_WRONG_TYPE');
      // An activation key is not a seats key.
      await expectCode(h.service.addSeats(activationKey), 'LICENSE_KEY_WRONG_TYPE');
      expect(h.db.installations).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

});

describe('a request code from the customer', () => {
  it('issues the activation key for the machine named in the code', async () => {
    const licence = newLicence(3);
    const h = installation(OTHER_MACHINE);
    try {
      const request = h.service.requestCodeObject().code;
      const key = lastKey(
        run('issue', 'activation', '--licence', licence, '--request', request, '--term', '6m', '--seats', '3'),
      );
      const status = await h.service.activate(key);
      expect(status.state).toBe('ACTIVE');
      expect(status.machineId).toBe(OTHER_MACHINE);
      expect(status.seats.limit).toBe(3);
    } finally {
      h.dispose();
    }
  });

  it('refuses a machine that disagrees with the request code', () => {
    const licence = newLicence();
    const h = installation(OTHER_MACHINE);
    try {
      const request = h.service.requestCodeObject().code;
      expect(
        runFails('issue', 'activation', '--licence', licence, '--request', request, '--machine', MACHINE),
      ).toMatch(/request code is for machine/i);
    } finally {
      h.dispose();
    }
  });

  it('rejects a code that is incomplete, altered or of the wrong kind', () => {
    const h = installation(OTHER_MACHINE);
    try {
      const request = h.service.requestCodeObject().code;
      // Truncated by a chat app that split the line.
      expect(runFails('show-request', request.slice(0, -6))).toMatch(/incomplete or was altered/i);
      // One character changed in the checksum.
      const [prefix, body, checksum] = request.split('.');
      const altered = `${prefix}.${body}.${checksum.slice(0, -1)}${checksum.endsWith('A') ? 'B' : 'A'}`;
      expect(runFails('show-request', altered)).toMatch(/incomplete or was altered/i);
      // A signed licence key is not a request code.
      const licence = newLicence();
      const key = lastKey(run('issue', 'activation', '--licence', licence, '--machine', OTHER_MACHINE));
      expect(runFails('show-request', key)).toMatch(/not an activation\/transfer request code/i);
      // Nor is a request code a licence key.
      expect(runFails('verify', request)).toMatch(/not a KAYAN key/i);
    } finally {
      h.dispose();
    }
  });

  it('shows the details of a valid request before a key is issued', () => {
    const h = installation(OTHER_MACHINE);
    try {
      const request = h.service.requestCodeObject().code;
      const shown = run('show-request', request);
      expect(shown).toContain(OTHER_MACHINE);
      expect(shown).toMatch(/app version/);
    } finally {
      h.dispose();
    }
  });
});

describe('what the operator may not do', () => {
  it('refuses an operation that is not one of the four', () => {
    const licence = newLicence();
    expect(runFails('issue', 'upgrade', '--licence', licence)).toMatch(/activation, renewal, seats, or transfer/);
  });

  it('refuses a seat limit of zero instead of silently meaning unlimited', () => {
    // The product treats a limit of 0 as "no limit"; a key must never grant
    // that by accident, so a count of people is at least one.
    expect(runFails('licence', 'create', '--seats', '0', '--term', '1y')).toMatch(/at least 1/i);
    expect(runFails('licence', 'create', '--seats', '-3', '--term', '1y')).toMatch(/whole number/i);
    const licence = newLicence(5);
    expect(runFails('issue', 'seats', '--licence', licence, '--cap', '0')).toMatch(/at least 1/i);
    expect(runFails('issue', 'seats', '--licence', licence, '--increase', '0')).toMatch(/at least 1 seat/i);
    expect(runFails('issue', 'activation', '--licence', licence, '--machine', MACHINE, '--seats', '0'))
      .toMatch(/at least 1/i);
  });

  it('refuses a transfer that would carry more accounts than the licence allows', () => {
    const licence = newLicence(4);
    run('issue', 'activation', '--licence', licence, '--machine', MACHINE);
    expect(
      runFails('issue', 'transfer', '--licence', licence, '--machine', OTHER_MACHINE, '--used', '9'),
    ).toMatch(/above the recorded seat limit/i);
  });

  it('refuses an unknown licence and an unknown term', () => {
    expect(runFails('issue', 'renewal', '--licence', 'lic_0000000000000000', '--term', '1y')).toMatch(
      /no licence/i,
    );
    const licence = newLicence();
    expect(runFails('issue', 'renewal', '--licence', licence, '--term', '7w')).toMatch(/do not understand/i);
  });
});

describe('preview and audit', () => {
  it('previews a payload without signing anything', () => {
    const licence = newLicence(2);
    const before = registerOf(home);
    const preview = run(
      'issue', 'activation', '--licence', licence, '--machine', MACHINE, '--term', '6m', '--seats', '2', '--dry-run',
    );
    expect(preview).toMatch(/Preview only/i);
    expect(preview).toContain(MACHINE);
    expect(preview).not.toMatch(/KYN1\./);
    const after = registerOf(home);
    expect(after.keys).toHaveLength(before.keys.length);
    expect(after.licences[licence].status).toBe('registered');
  });

  it('records each operation in an audit log with no secret in it', () => {
    const licence = newLicence(2);
    const key = lastKey(
      run('issue', 'activation', '--licence', licence, '--machine', MACHINE, '--note', 'INV-77'),
    );
    run('verify', key);
    const audit = readFileSync(join(home, 'audit.log'), 'utf8');
    const entries = audit.trim().split('\n').map((line) => JSON.parse(line));
    expect(entries.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['init', 'licence.create', 'issue', 'verify']),
    );
    expect(entries.find((entry) => entry.action === 'issue').licenseId).toBe(licence);
    expect(audit).not.toContain(key);
    expect(audit).not.toContain('PRIVATE KEY');
    expect(audit).not.toContain('INV-77');
    expect(audit).not.toMatch(/key_[0-9a-f]{16}"[^}]*"note/);
  });
});

describe('two signing keys', () => {
  it('a key signed by another key pair is refused by the product', () => {
    otherHome = mkdtempSync(join(tmpdir(), 'kayan-gen-other-'));
    try {
      runOther('init');
      const licenceId = /lic_[0-9a-f]{16}/.exec(
        runOther('licence', 'create', '--ref', 'impostor', '--seats', '9', '--term', '3y'),
      )![0];
      const foreignKey = lastKey(
        runOther('issue', 'activation', '--licence', licenceId, '--machine', MACHINE, '--seats', '9'),
      );
      // The product trusts only the operator's public key.
      expect(() => productReads(foreignKey, home)).toThrow(/signature/i);
      const h = installation();
      try {
        return expectCode(h.service.activate(foreignKey), 'LICENSE_KEY_BAD_SIGNATURE').then(() => {
          expect(h.db.installations).toHaveLength(0);
        });
      } finally {
        h.dispose();
      }
    } finally {
      rmSync(otherHome, { recursive: true, force: true });
    }
  });

  it('the other pair can still verify its own keys', () => {
    otherHome = mkdtempSync(join(tmpdir(), 'kayan-gen-other-'));
    try {
      runOther('init');
      const licence = /lic_[0-9a-f]{16}/.exec(
        runOther('licence', 'create', '--ref', 'own', '--seats', '1', '--term', '1m'),
      )![0];
      const key = lastKey(runOther('issue', 'activation', '--licence', licence, '--machine', MACHINE));
      expect(productReads(key, otherHome).payload.licenseId).toBe(licence);
      expect(() => productReads(key, home)).toThrow(/signature/i);
    } finally {
      rmSync(otherHome, { recursive: true, force: true });
    }
  });
});

describe('the operator window', () => {
  /** Starts the local window and returns its address and token. */
  const openWindow = async () => {
    const child = spawn(process.execPath, [SCRIPT, 'gui', '--no-browser', '--port', '0', '--home', home], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const match = /KAYAN-GUI-URL=(\S+)/.exec(output);
      if (match) {
        const url = match[1];
        return { child, url, port: Number(new URL(url).port), token: url.split('#')[1] };
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    child.kill('SIGKILL');
    throw new Error(`the window did not start:\n${output}`);
  };

  const call = (port: number, path: string, token: string | null, body?: unknown) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { 'x-kayan-token': token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it('serves the page, refuses calls without its token, and issues a key the product accepts', async () => {
    const licence = newLicence(2);
    const window = await openWindow();
    try {
      const page = await call(window.port, '/', null);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('KAYAN');

      expect((await call(window.port, '/api/state', null)).status).toBe(401);
      const state = (await (await call(window.port, '/api/state', window.token)).json()) as {
        hasKey: boolean;
        licences: Array<{ licenseId: string }>;
      };
      expect(state.hasKey).toBe(true);
      expect(state.licences.map((entry) => entry.licenseId)).toContain(licence);

      // A preview writes nothing.
      const before = registerOf(home);
      const preview = (await (
        await call(window.port, '/api/issue', window.token, {
          type: 'ACTIVATION',
          licenceId: licence,
          machineId: MACHINE,
          term: '1y',
          seats: 2,
          dryRun: true,
        })
      ).json()) as { preview: { machineId: string } };
      expect(preview.preview.machineId).toBe(MACHINE);
      expect(registerOf(home).keys).toHaveLength(before.keys.length);

      const issued = (await (
        await call(window.port, '/api/issue', window.token, {
          type: 'ACTIVATION',
          licenceId: licence,
          machineId: MACHINE,
          term: '1y',
          seats: 2,
        })
      ).json()) as { key: string };
      expect(issued.key).toMatch(/^KYN1\./);

      const parsed = productReads(issued.key, home);
      expect(parsed.payload.machineId).toBe(MACHINE);
      expect(parsed.payload.seats).toEqual({ mode: 'CAP', value: 2 });
      expect(parsed.payload.term).toEqual({ kind: 'MONTHS', months: 12 });

      const inspected = (await (
        await call(window.port, '/api/verify', window.token, { key: issued.key })
      ).json()) as { valid: boolean; payload: { licenseId: string } };
      expect(inspected.valid).toBe(true);
      expect(inspected.payload.licenseId).toBe(licence);
    } finally {
      window.child.kill('SIGKILL');
    }
  }, 60_000);

  it('rejects a foreign Host header, so another local page cannot drive it', async () => {
    const window = await openWindow();
    try {
      // `fetch` refuses to forge Host, so the request is made with node:http.
      const status = await new Promise<number>((resolveStatus, rejectStatus) => {
        const request = httpRequest(
          {
            host: '127.0.0.1',
            port: window.port,
            path: '/api/state',
            method: 'GET',
            headers: { host: 'evil.example', 'x-kayan-token': window.token },
          },
          (response) => {
            response.resume();
            resolveStatus(response.statusCode ?? 0);
          },
        );
        request.on('error', rejectStatus);
        request.end();
      });
      expect(status).toBe(421);
    } finally {
      window.child.kill('SIGKILL');
    }
  }, 60_000);

  it('agrees with the command line, field for field', async () => {
    const licence = newLicence(4, '6m');
    const fromCli = lastKey(
      run('issue', 'activation', '--licence', licence, '--machine', MACHINE, '--term', '6m', '--seats', '4'),
    );
    const window = await openWindow();
    try {
      const issued = (await (
        await call(window.port, '/api/issue', window.token, {
          type: 'ACTIVATION',
          licenceId: licence,
          machineId: MACHINE,
          term: '6m',
          seats: 4,
        })
      ).json()) as { key: string };

      const a = productReads(fromCli, home).payload;
      const b = productReads(issued.key, home).payload;
      // Everything except the two values that must differ per issuing run.
      const strip = (payload: typeof a) => {
        const { keyId, issuedAt, ...rest } = payload;
        return rest;
      };
      expect(strip(b)).toEqual(strip(a));
      expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
      expect(b.keyId).not.toBe(a.keyId);
      expect(b.seats).toEqual({ mode: 'CAP', value: 4 });
    } finally {
      window.child.kill('SIGKILL');
    }
  }, 60_000);
});

describe('perpetual licences through the generator', () => {
  it('issues a perpetual activation that the product never expires', async () => {
    const licence = newLicence(2, 'P');
    const key = lastKey(run('issue', 'activation', '--licence', licence, '--machine', MACHINE, '--term', 'P', '--seats', '2'));
    const h = installation();
    try {
      const status = await h.service.activate(key);
      expect(status.perpetual).toBe(true);
      expect(status.expiresAt).toBeNull();
      // Years later it is still active.
      h.setNow(new Date(Date.now() + 20 * 365 * 86_400_000).toISOString());
      expect((await h.service.status({ fresh: true })).state).toBe('ACTIVE');
    } finally {
      h.dispose();
    }
  });

  it('keeps a perpetual licence perpetual through a renewal', async () => {
    const licence = newLicence(1, 'P');
    const activationKey = lastKey(run('issue', 'activation', '--licence', licence, '--machine', MACHINE, '--term', 'P'));
    const renewalKey = lastKey(run('issue', 'renewal', '--licence', licence, '--term', 'P'));
    const h = installation();
    try {
      await h.service.activate(activationKey);
      const status = await h.service.renew(renewalKey);
      expect(status.perpetual).toBe(true);
      expect(status.expiresAt).toBeNull();
    } finally {
      h.dispose();
    }
  });
});
