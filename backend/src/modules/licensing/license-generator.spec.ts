import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addCalendarMonths } from './license-duration';
import { loadPublicKey, publicKeyFingerprint } from './license-key';
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
