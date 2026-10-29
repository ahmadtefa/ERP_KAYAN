#!/usr/bin/env node
/**
 * KAYAN licence key generator — the operator's tool.
 *
 * This file is the supplier's side of the offline licensing system. It holds
 * the Ed25519 private key; the product only ever holds the matching public
 * key and can verify, never sign. **This tool is never shipped to a customer
 * and never installed with the program.**
 *
 * It runs offline, on the operator's own computer, with nothing but Node:
 *
 *     node kayan-license.mjs init
 *     node kayan-license.mjs licence create --ref "شركة النور" --seats 5 --term 1y
 *     node kayan-license.mjs issue activation --licence lic_xxx --machine KM-...
 *
 * The Windows packaged launcher opens the operator UI in its own native
 * WebView2 window and starts this file's packaged local service hidden. In a
 * source checkout, running with no command or `gui` still opens the local page
 * in the default browser; `gui --no-browser` serves it without a browser. Every
 * UI action calls the same functions as the CLI, so the two front ends cannot
 * disagree.
 *
 * The packaged `KAYAN-Key-Generator.exe` is this file bundled with a Node
 * runtime; it does not contain a signing key, and it never prints one.
 *
 * The private key lives in `--home` (default ~/.kayan-license-generator), in a
 * file readable only by the account that created it. Back that directory up:
 * without it, no new key can be issued for an installation, and a lost key
 * means reinstalling the product's public key everywhere.
 *
 * See docs/licensing/OPERATOR-GUIDE.md for the procedures, and
 * docs/licensing/KEY-PROTECTION.md for handling the private key.
 */

import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { startGui } from './license-gui.mjs';

const VERSION = '1.1.0';
const KEY_PREFIX = 'KYN1';
const REQUEST_PREFIX = 'KYNREQ1';
const REGISTER_VERSION = 1;
const MAX_TERM_MONTHS = 1200;

const TYPES = ['ACTIVATION', 'RENEWAL', 'SEATS', 'TRANSFER'];
const MACHINE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/;
const ID = /^[0-9a-zA-Z][0-9a-zA-Z._:-]{7,63}$/;

// ─────────────────────────────────────────────────────────────────── helpers

class Refusal extends Error {}
const refuse = (message) => {
  throw new Refusal(message);
};

const b64url = (value) => Buffer.from(value).toString('base64url');
const unb64url = (value) => Buffer.from(value, 'base64url');

const home = (() => {
  const index = process.argv.indexOf('--home');
  if (index > 0) return process.argv[index + 1];
  return process.env.KAYAN_LICENSE_HOME || join(homedir(), '.kayan-license-generator');
})();

const paths = {
  privateKey: join(home, 'private-key.pem'),
  publicKey: join(home, 'public-key.pem'),
  register: join(home, 'register.json'),
  registerMac: join(home, 'register.mac'),
  audit: join(home, 'audit.log'),
};

/**
 * The operator's own record of what was done with the tool.
 *
 * One JSON object per line, appended, never rewritten: the register says what
 * exists, this says who did what and when. It deliberately carries no key
 * text, no private key, no note and no free text - only identifiers that are
 * already on the customer's licence screen.
 */
function audit(entry) {
  try {
    ensureHome();
    const line = JSON.stringify({
      at: new Date().toISOString(),
      tool: `kayan-license/${VERSION}`,
      ...entry,
    });
    appendFileSync(paths.audit, `${line}\n`, { mode: 0o600 });
  } catch {
    // A log that cannot be written must never stop a key being issued.
  }
}

function readAudit(limit = 50) {
  try {
    if (!existsSync(paths.audit)) return [];
    const lines = readFileSync(paths.audit, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0);
    return lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { at: null, action: 'unreadable audit line', result: '' };
        }
      });
  } catch {
    return [];
  }
}

function ensureHome() {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    try {
      chmodSync(home, 0o700);
    } catch {
      /* the home may be on a filesystem without POSIX modes */
    }
  }
}

function requireKeys() {
  if (!existsSync(paths.privateKey) || !existsSync(paths.publicKey)) {
    refuse(
      `No key pair in ${home}. Run "init" first.\n` +
        'لا يوجد مفتاح في هذا المجلد. شغّل init أولًا.',
    );
  }
  const privateKey = createPrivateKey(readFileSync(paths.privateKey, 'utf8'));
  const publicKey = createPublicKey(readFileSync(paths.publicKey, 'utf8'));
  const derived = createPublicKey(privateKey);
  const left = derived.export({ format: 'der', type: 'spki' });
  const right = publicKey.export({ format: 'der', type: 'spki' });
  if (!left.equals(right)) {
    refuse(
      `The private and public keys in ${home} do not belong together. Restore ` +
        'both from the same backup; a key issued with the wrong pair would not ' +
        'verify in the product.',
    );
  }
  return { privateKey, publicKey };
}

/** The same fingerprint the product shows, so the two can be compared. */
function fingerprint(publicKey) {
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return createHash('sha256')
    .update(der)
    .digest('hex')
    .toUpperCase()
    .slice(0, 32)
    .replace(/(.{4})(?=.)/g, '$1-');
}

/**
 * The register is the operator's memory of what was issued. It is
 * authenticated with a key derived from the private key, so a copy edited by
 * hand - or a register that travelled without its key - is noticed instead of
 * being trusted.
 */
function registerMacKey(privateKey) {
  return createHash('sha256')
    .update(privateKey.export({ format: 'pem', type: 'pkcs8' }))
    .digest();
}

function loadRegister(privateKey) {
  if (!existsSync(paths.register)) {
    return {
      v: REGISTER_VERSION,
      createdAt: new Date().toISOString(),
      licences: {},
      keys: [],
    };
  }
  const register = JSON.parse(readFileSync(paths.register, 'utf8'));
  if (!existsSync(paths.registerMac)) {
    refuse(
      'The register has no checksum file beside it (register.mac). Restore the ' +
        'backup of the key directory, or confirm the register was not edited ' +
        'by hand and delete register.mac to re-seal it.',
    );
  }
  const expected = createHmac('sha256', registerMacKey(privateKey))
    .update(stableStringify(register))
    .digest();
  const actual = Buffer.from(readFileSync(paths.registerMac, 'utf8').trim(), 'hex');
  if (
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    refuse(
      'The register failed its integrity check: it was edited by hand, or it ' +
        'belongs to a different key pair. Restore it from the backup.',
    );
  }
  if (register.v !== REGISTER_VERSION) {
    refuse(`The register uses format ${register.v}; this tool reads ${REGISTER_VERSION}.`);
  }
  register.licences ??= {};
  register.keys ??= [];
  return register;
}

function saveRegister(privateKey, register) {
  ensureHome();
  writeFileSync(paths.register, stableStringify(register, 2), { mode: 0o600 });
  const mac = createHmac('sha256', registerMacKey(privateKey))
    .update(stableStringify(register))
    .digest('hex');
  writeFileSync(paths.registerMac, mac, { mode: 0o600 });
}

/** Deterministic JSON, so the MAC covers exactly one spelling of the file. */
function stableStringify(value, space = 0) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item, 0)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const body = keys
      .filter((key) => value[key] !== undefined)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify(value[key], 0)}`,
      )
      .join(',');
    return space ? JSON.stringify(JSON.parse(`{${body}}`), null, space) : `{${body}}`;
  }
  return JSON.stringify(value);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--home') {
      index += 1;
      continue;
    }
    if (token.startsWith('--')) {
      const name = token.slice(2);
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[name] = next;
        index += 1;
      } else {
        args[name] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

/** `1m`, `6m`, `1y`, `2y`, `3y`, `p`/`perpetual`. Calendar months, no 30-day blocks. */
function parseTerm(text) {
  if (text === undefined || text === true) {
    refuse('A term is required: 1m, 6m, 1y, 2y, 3y, or P for perpetual.');
  }
  const value = String(text).trim().toLowerCase();
  if (value === 'p' || value === 'perpetual' || value === 'دائم') {
    return { kind: 'PERPETUAL' };
  }
  const match = /^(\d{1,4})\s*(m|month|months|months?|شهر|أشهر|y|year|years|سنة|سنوات)$/.exec(
    value,
  );
  if (!match) {
    refuse(`I do not understand the term "${text}". Use 1m, 6m, 1y, 2y, or P.`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const months = unit.startsWith('y') || unit === 'سنة' || unit === 'سنوات'
    ? amount * 12
    : amount;
  if (!Number.isInteger(months) || months < 1 || months > MAX_TERM_MONTHS) {
    refuse(`A term must be between 1 month and ${MAX_TERM_MONTHS} months.`);
  }
  return { kind: 'MONTHS', months };
}

function termMonths(term) {
  return term.kind === 'PERPETUAL' ? null : term.months;
}

/** Calendar months, clamped at month end: 31 Jan + 1 month is 28/29 Feb. */
function addMonths(from, months) {
  const result = new Date(from.getTime());
  const day = result.getUTCDate();
  const targetMonth = result.getUTCMonth() + months;
  const year = result.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  result.setUTCFullYear(year, month, Math.min(day, lastDay));
  return result;
}

function describeTerm(term) {
  if (term.kind === 'PERPETUAL') return 'دائم / perpetual';
  const months = term.months;
  if (months % 12 === 0) return `${months / 12} سنة / ${months / 12} year(s)`;
  return `${months} شهر / ${months} month(s)`;
}

function newLicenceId() {
  return `lic_${randomBytes(8).toString('hex')}`;
}

function newKeyId() {
  return `key_${randomBytes(8).toString('hex')}`;
}

/** Exactly the text the product verifies: `KYN1.<payload>`. */
function signPayload(payload, privateKey) {
  const json = JSON.stringify(payload);
  const signedText = `${KEY_PREFIX}.${b64url(json)}`;
  const signature = sign(null, Buffer.from(signedText, 'utf8'), privateKey);
  return `${signedText}.${signature.toString('base64url')}`;
}

function readPayload(key, publicKey) {
  const text = String(key ?? '')
    .replace(/\s+/g, '')
    .trim();
  const parts = text.split('.');
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX) {
    refuse('That is not a KAYAN key (it should start with KYN1.).');
  }
  const payloadJson = unb64url(parts[1]).toString('utf8');
  const payload = JSON.parse(payloadJson);
  const valid = verify(
    null,
    Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'),
    publicKey,
    unb64url(parts[2]),
  );
  return { payload, valid };
}

/** Reads the code a customer sends over WhatsApp. */
function parseRequestCode(code) {
  const text = String(code ?? '')
    .replace(/\s+/g, '')
    .trim();
  const parts = text.split('.');
  if (parts.length !== 3 || parts[0] !== REQUEST_PREFIX) {
    refuse(
      'That is not an activation/transfer request code (it should start with ' +
        'KYNREQ1.). Ask the customer to copy the whole code from the licence screen.',
    );
  }
  const expected = createHash('sha256')
    .update(`${REQUEST_PREFIX}.${parts[1]}`)
    .digest('base64url')
    .slice(0, 10);
  if (expected !== parts[2]) {
    refuse(
      'The request code is incomplete or was altered in the message. Ask the ' +
        'customer to send it again, copied in one piece.',
    );
  }
  const request = JSON.parse(unb64url(parts[1]).toString('utf8'));
  if (!request || typeof request.machineId !== 'string') {
    refuse('The request code carries no machine id.');
  }
  return request;
}

/** The term a licence was registered with, as the key format spells it. */
function licenceTerm(licence) {
  return licence.term === null || licence.term === undefined
    ? { kind: 'PERPETUAL' }
    : { kind: 'MONTHS', months: licence.term };
}

function requireLicence(register, id) {
  const licence = register.licences[id];
  if (!licence) refuse(`There is no licence ${id} in the register.`);
  return licence;
}

function markSuperseded(register, licenceId, type) {
  for (const key of register.keys) {
    if (
      key.licenceId === licenceId &&
      key.type === type &&
      key.status === 'issued'
    ) {
      key.status = 'superseded';
      key.supersededAt = new Date().toISOString();
    }
  }
}

function recordKey(register, licence, entry) {
  register.keys.push({
    keyId: entry.payload.keyId,
    licenseId: entry.payload.licenseId,
    type: entry.payload.type,
    machineId: entry.payload.machineId ?? null,
    term: entry.payload.term ? termMonths(entry.payload.term) : null,
    seats: entry.payload.seats ?? null,
    issuedAt: entry.payload.issuedAt,
    status: 'issued',
    note: entry.payload.note ?? null,
    // Never store the key text itself: the register travels in backups.
    fingerprint: createHash('sha256')
      .update(String(entry.key))
      .digest('hex')
      .slice(0, 16),
  });
  licence.updatedAt = new Date().toISOString();
}

// ────────────────────────────────────────────────────────────────── commands

function commandInit(args) {
  if (existsSync(paths.privateKey) && !args.rotate) {
    refuse(
      `A key pair already exists in ${home}.\n` +
        'Creating a new one would invalidate every key already issued: the ' +
        'product checks against the public key it was installed with. Back up ' +
        'this directory instead ("backup"). Use --rotate --i-understand only ' +
        'if you intend to replace the key everywhere.',
    );
  }
  if (args.rotate && !args['i-understand']) {
    refuse(
      'Rotating the key pair makes every key already issued unverifiable until ' +
        'the product is reinstalled with the new public key. Add ' +
        '--i-understand to proceed.',
    );
  }
  ensureHome();
  if (args.rotate && existsSync(paths.privateKey)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    copyFileSync(paths.privateKey, join(home, `private-key.retired-${stamp}.pem`));
    copyFileSync(paths.publicKey, join(home, `public-key.retired-${stamp}.pem`));
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(
    paths.privateKey,
    privateKey.export({ format: 'pem', type: 'pkcs8' }),
    { mode: 0o600 },
  );
  writeFileSync(
    paths.publicKey,
    publicKey.export({ format: 'pem', type: 'spki' }),
    { mode: 0o644 },
  );
  if (process.platform !== 'win32') {
    try {
      chmodSync(paths.privateKey, 0o600);
    } catch {
      /* see ensureHome */
    }
  }
  if (args.rotate && existsSync(paths.register)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    copyFileSync(paths.register, join(home, `register.retired-${stamp}.json`));
  }
  const register = { v: REGISTER_VERSION, createdAt: new Date().toISOString(), licences: {}, keys: [] };
  saveRegister(privateKey, register);

  const der = createPublicKey(readFileSync(paths.publicKey, 'utf8')).export({
    format: 'der',
    type: 'spki',
  });
  console.log(`تم إنشاء مفتاح التوقيع. / Signing key created.
  home          : ${home}
  private key   : ${basename(paths.privateKey)}   (keep it secret; back it up)
  public key    : ${basename(paths.publicKey)}    (goes into the product)
  fingerprint   : ${fingerprint(createPublicKey(readFileSync(paths.publicKey, 'utf8')))}

نص المفتاح العام لتثبيته في البرنامج / public key for the product (LICENSE_PUBLIC_KEY):
${der.toString('base64url')}

Back up this directory now ("backup --out <folder>"). Losing it means a new
key pair and reinstalling the public key on every customer machine.`);
}

function commandPublicKey(args) {
  const { publicKey } = requireKeys();
  const der = publicKey.export({ format: 'der', type: 'spki' });
  if (args.base64 || args['base64url']) {
    console.log(der.toString('base64url'));
    return;
  }
  console.log(`fingerprint: ${fingerprint(publicKey)}
LICENSE_PUBLIC_KEY (whole value, one line):
${der.toString('base64url')}

or, as a file the installer writes to the licence state folder:
-----BEGIN PUBLIC KEY-----
${der.toString('base64')}
-----END PUBLIC KEY-----`);
}

/**
 * Registers a licence in the operator's register. `seats` is the limit the
 * customer bought; every key issued for this licence is measured against it.
 */
function createLicence(input) {
  const { privateKey } = requireKeys();
  const register = loadRegister(privateKey);
  const seats = requireSeatCount(input.seats, '--seats');
  const term = parseTerm(input.term);
  const licence = {
    licenseId: newLicenceId(),
    ref: input.ref ? String(input.ref) : null,
    seats,
    seatsUsed: 0,
    term: termMonths(term),
    machineId: null,
    startsAt: null,
    expiresAt: null,
    status: 'registered',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  register.licences[licence.licenseId] = licence;
  saveRegister(privateKey, register);
  audit({
    action: 'licence.create',
    licenseId: licence.licenseId,
    seats,
    term: termMonths(term),
    result: 'registered',
  });
  return { licence, term };
}

function commandLicenceCreate(args) {
  const { licence, term } = createLicence({
    ref: args.ref,
    seats: args.seats,
    term: args.term,
  });
  console.log(`تم تسجيل الترخيص. / Licence registered.
  licence   : ${licence.licenseId}
  seats     : ${licence.seats}
  term      : ${describeTerm(term)}
  customer  : ${licence.ref ?? '(no note)'}

Next: issue an activation key for the machine the customer named.
  node ${basename(process.argv[1] ?? 'kayan-license.mjs')} issue activation --licence ${licence.licenseId} --machine KM-...`);
}

function requiredInt(value, name) {
  if (value === undefined || value === true) refuse(`${name} is required.`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    refuse(`${name} must be a whole number.`);
  }
  return parsed;
}

/**
 * A seat limit of zero is not "no seats": the product reads `limit > 0` before
 * it refuses anyone, so zero would quietly mean *unlimited*. A key may not
 * grant that by accident, so a count of people is always at least one.
 */
function requireSeatCount(value, name) {
  const seats = requiredInt(value, name);
  if (seats < 1) {
    refuse(
      `${name} must be at least 1. Zero would not mean "no users": the product ` +
        'reads a limit of zero as no limit at all.',
    );
  }
  return seats;
}

/** The machine a key names, from `--machine`, the request code, or both. */
function resolveMachine(machineValue, requestCode) {
  const fromMachine = machineValue === undefined || machineValue === true
    ? null
    : requireMachine(machineValue);
  const fromRequest = requestCode ? parseRequestCode(requestCode).machineId : null;
  if (fromRequest && !MACHINE_ID.test(fromRequest)) {
    refuse(`The request code carries "${fromRequest}", which is not a machine id.`);
  }
  if (fromMachine && fromRequest && fromMachine !== fromRequest) {
    refuse(
      `The request code is for machine ${fromRequest}, but --machine says ` +
        `${fromMachine}. Use the machine id from the request code.`,
    );
  }
  const machine = fromMachine ?? fromRequest;
  if (!machine) {
    refuse('--machine is required (the KM-… id from the request code).');
  }
  return machine;
}

/**
 * Builds and signs one key. This is the only place a key is produced; the
 * command line and the operator window both call it.
 *
 * Returns `{ key, payload, licence, preview }`; with `dryRun` the payload is
 * returned unsigned and nothing is written, so the operator can look at it
 * first.
 */
function issueKey(input) {
  const type = String(input.type ?? '').toUpperCase();
  if (!TYPES.includes(type)) {
    refuse('issue needs a type: activation, renewal, seats, or transfer.');
  }
  const { privateKey, publicKey } = requireKeys();
  const register = loadRegister(privateKey);
  const licence = requireLicence(register, input.licenceId);
  const issuedAt = new Date().toISOString();
  const base = {
    v: 1,
    keyId: newKeyId(),
    type,
    licenseId: licence.licenseId,
    issuedAt,
  };

  let payload;
  if (type === 'ACTIVATION') {
    const machineId = resolveMachine(input.machineId, input.request);
    const term = input.term === undefined || input.term === null
      ? licenceTerm(licence)
      : parseTerm(input.term);
    const seats = input.seats === undefined || input.seats === null
      ? licence.seats
      : requireSeatCount(input.seats, '--seats');
    if (seats < licence.seatsUsed) {
      refuse(
        `This licence already records ${licence.seatsUsed} used seat(s); a ` +
          `limit of ${seats} would be below them.`,
      );
    }
    payload = {
      ...base,
      machineId,
      term,
      // An activation states the limit itself; it is not an increment.
      seats: { mode: 'CAP', value: seats },
      state: null,
      note: note({ note: input.note }),
    };
    if (!input.dryRun) {
      licence.machineId = machineId;
      licence.seats = seats;
      licence.status = 'active';
      licence.startsAt = licence.startsAt ?? issuedAt;
      if (term.kind !== 'PERPETUAL') {
        licence.expiresAt = addMonths(new Date(), term.months).toISOString();
        licence.term = term.months;
      } else {
        licence.expiresAt = null;
        licence.term = null;
      }
      markSuperseded(register, licence.licenseId, 'ACTIVATION');
    }
  } else if (type === 'RENEWAL') {
    const term = input.term === undefined || input.term === null
      ? licenceTerm(licence)
      : parseTerm(input.term);
    payload = {
      ...base,
      machineId: null,
      term,
      seats: null,
      state: null,
      note: note({ note: input.note }),
    };
    if (!input.dryRun) {
      if (term.kind === 'PERPETUAL') {
        licence.expiresAt = null;
        licence.term = null;
      } else {
        const now = new Date();
        const current = licence.expiresAt ? new Date(licence.expiresAt) : null;
        const from = current && current.getTime() > now.getTime() ? current : now;
        licence.expiresAt = addMonths(from, term.months).toISOString();
        licence.term = term.months;
      }
      licence.status = 'active';
    }
  } else if (type === 'SEATS') {
    const increase = input.increase === undefined || input.increase === null
      ? null
      : requiredInt(input.increase, '--increase');
    const cap = input.cap === undefined || input.cap === null
      ? null
      : requireSeatCount(input.cap, '--cap');
    if ((increase === null) === (cap === null)) {
      refuse('issue seats needs exactly one of --increase N or --cap N.');
    }
    if (increase !== null && increase < 1) {
      refuse('--increase must be at least 1 seat.');
    }
    const next = increase !== null ? licence.seats + increase : cap;
    if (next < licence.seatsUsed) {
      refuse(
        `This licence records ${licence.seatsUsed} used seat(s); a limit of ` +
          `${next} would be below them. A seat key never takes a seat back.`,
      );
    }
    payload = {
      ...base,
      machineId: null,
      term: null,
      seats: increase !== null
        ? { mode: 'INCREASE', value: increase }
        : { mode: 'CAP', value: cap },
      state: null,
      note: note({ note: input.note }),
    };
    if (!input.dryRun) licence.seats = next;
  } else {
    // TRANSFER: the register's numbers are what travels. They must be
    // corrected from the customer's licence screen if it disagrees.
    const machineId = resolveMachine(input.machineId, input.request);
    if (!licence.machineId) {
      refuse(
        'This licence has no machine recorded, so there is nothing to transfer ' +
          'from. Issue an activation key first.',
      );
    }
    if (licence.machineId === machineId) {
      refuse('The licence is already recorded on that machine; nothing to transfer.');
    }
    const used = input.used === undefined || input.used === null
      ? licence.seatsUsed
      : requiredInt(input.used, '--used');
    if (used > licence.seats) {
      refuse(
        `--used ${used} is above the recorded seat limit ${licence.seats}. ` +
          'Correct the licence first: a transfer cannot carry more accounts than the licence allows.',
      );
    }
    payload = {
      ...base,
      machineId,
      term: null,
      seats: null,
      state: {
        expiresAt: licence.expiresAt ?? null,
        seatLimit: licence.seats,
        seatsUsed: used,
        startsAt: licence.startsAt ?? issuedAt,
        issuedAt,
      },
      note: note({ note: input.note }),
    };
    if (!input.dryRun) {
      licence.machineId = machineId;
      licence.seatsUsed = used;
      markSuperseded(register, licence.licenseId, 'TRANSFER');
    }
  }

  if (input.dryRun) {
    return { key: null, payload, licence, preview: previewOf(payload) };
  }

  const key = signPayload(payload, privateKey);
  // Never trust what we wrote: read it back through the public key.
  const check = readPayload(key, publicKey);
  if (!check.valid) refuse('The key did not verify after signing; refusing to issue it.');

  recordKey(register, licence, { payload, key });
  saveRegister(privateKey, register);
  audit({
    action: 'issue',
    type,
    keyId: payload.keyId,
    licenseId: payload.licenseId,
    machineId: payload.machineId,
    seats: payload.seats ?? null,
    term: payload.term ?? null,
    result: 'issued',
  });
  return { key, payload, licence, preview: previewOf(payload) };
}

/** What the operator sees before signing: no key text, no signature. */
function previewOf(payload) {
  return {
    type: payload.type,
    keyId: payload.keyId,
    licenseId: payload.licenseId,
    machineId: payload.machineId,
    term: payload.term,
    seats: payload.seats,
    state: payload.state ?? null,
    issuedAt: payload.issuedAt,
    note: payload.note ?? null,
  };
}

function commandIssue(args) {
  const type = String(args._[1] ?? '').toUpperCase();
  if (!TYPES.includes(type)) {
    refuse('issue needs a type: activation, renewal, seats, or transfer.');
  }
  const { key, payload, licence } = issueKey({
    type,
    licenceId: args.licence,
    machineId: args.machine,
    request: args.request,
    term: args.term,
    seats: args.seats,
    increase: args.increase,
    cap: args.cap,
    used: args.used,
    note: args.note,
    dryRun: Boolean(args['dry-run']),
  });

  if (args['dry-run']) {
    console.log(`معاينة فقط، لم يُوقّع شيء. / Preview only, nothing was signed.\n${JSON.stringify(previewOf(payload), null, 2)}`);
    return;
  }

  console.log(`تم إصدار المفتاح. / Key issued.
  type      : ${type}
  licence   : ${licence.licenseId}
  key id    : ${payload.keyId}
  term      : ${payload.term ? describeTerm(payload.term) : '-'}
  seats     : ${payload.seats ? `${payload.seats.mode} ${payload.seats.value}` : '-'}
  machine   : ${payload.machineId ?? '-'}
  ${payload.state ? `state     : expires ${payload.state.expiresAt ?? 'never'}, limit ${payload.state.seatLimit}, used ${payload.state.seatsUsed}\n  ` : ''}status    : issued

Send this whole line to the customer (it is one key, do not split it):

${key}
`);
}

function note(args) {
  const text = args.note === undefined ? null : String(args.note).slice(0, 300);
  return text;
}

function requireMachine(value) {
  if (value === undefined || value === true) {
    refuse('--machine is required (the KM-… id from the request code).');
  }
  const machineId = String(value).trim().toUpperCase();
  if (!MACHINE_ID.test(machineId)) {
    refuse(`"${value}" is not a machine id. It looks like KM-XXXX-XXXX-XXXX-XXXX-XXXX.`);
  }
  return machineId;
}

function commandShowRequest(args) {
  const code = args._[1] ?? args.code;
  if (!code) refuse('show-request needs the code the customer sent.');
  const request = parseRequestCode(code);
  console.log(`طلب تفعيل / activation request
  machine id : ${request.machineId}
  install id : ${request.installId ?? '-'}
  app version: ${request.appVersion ?? '-'}
  requested  : ${request.requestedAt ?? '-'}
  nonce      : ${request.nonce ?? '-'}

Issue the key for exactly that machine id:
  node kayan-license.mjs issue activation --licence <licence> --machine ${request.machineId}`);
}

function commandList(args) {
  const { privateKey } = requireKeys();
  const register = loadRegister(privateKey);
  const filter = args.licence;
  const licences = Object.values(register.licences).filter(
    (licence) => !filter || licence.licenseId === filter,
  );
  if (licences.length === 0) {
    console.log('The register is empty. / السجل فارغ.');
    return;
  }
  for (const licence of licences) {
    const keys = register.keys.filter((key) => key.licenseId === licence.licenseId);
    console.log(`
${licence.licenseId}  [${licence.status}]
  ref     : ${licence.ref ?? '-'}
  machine : ${licence.machineId ?? '-'}
  seats   : ${licence.seats} (used ${licence.seatsUsed})
  term    : ${licence.term === null ? 'perpetual' : `${licence.term} month(s)`}
  expires : ${licence.expiresAt ?? 'never'}
  issued  : ${keys.length} key(s)`);
    for (const key of keys) {
      const detail =
        key.type === 'SEATS'
          ? `${key.seats?.mode} ${key.seats?.value}`
          : key.term === null
            ? 'perpetual'
            : `${key.term} month(s)`;
      console.log(
        `    ${key.status.padEnd(10)} ${key.type.padEnd(10)} ${detail.padEnd(16)} ${key.issuedAt.slice(0, 10)}  ${key.keyId}`,
      );
    }
  }
  console.log(`
Statuses: issued (not yet applied), used (applied by the customer),
revoked (withdrawn), superseded (replaced by a newer key of the same type).`);
}

function markUsed(keyId, at) {
  const { privateKey } = requireKeys();
  const register = loadRegister(privateKey);
  const key = findKey(register, keyId);
  if (key.status === 'revoked') refuse(`Key ${key.keyId} is revoked; it cannot be marked used.`);
  key.status = 'used';
  key.usedAt = at ? String(at) : new Date().toISOString();
  const licence = register.licences[key.licenseId];
  if (licence && key.type === 'ACTIVATION' && key.seats) {
    licence.seats = key.seats.value;
  }
  saveRegister(privateKey, register);
  audit({ action: 'mark-used', keyId: key.keyId, licenseId: key.licenseId, result: 'used' });
  return key;
}

function commandMarkUsed(args) {
  const key = markUsed(args.key, args.at);
  console.log(`تم تسجيل استخدام المفتاح. / Key ${key.keyId} marked used.`);
}

function revokeKey(keyId, reason) {
  const { privateKey } = requireKeys();
  const register = loadRegister(privateKey);
  const key = findKey(register, keyId);
  if (!reason) {
    refuse(
      'A revocation needs --reason: it is the record of why the key was withdrawn.',
    );
  }
  key.status = 'revoked';
  key.revokedAt = new Date().toISOString();
  key.reason = String(reason).slice(0, 300);
  saveRegister(privateKey, register);
  audit({ action: 'revoke', keyId: key.keyId, licenseId: key.licenseId, result: 'revoked' });
  return key;
}

function commandRevoke(args) {
  const key = revokeKey(args.key, args.reason);
  console.log(
    `تم إلغاء المفتاح. / Key ${key.keyId} revoked: ${key.reason}\n` +
      'Note: a key already applied cannot be un-applied from the customer\'s ' +
      'machine offline. Revoking stops it being used if it was never applied; ' +
      'if it was, issue a corrective key.',
  );
}

function findKey(register, id) {
  const key = register.keys.find(
    (entry) =>
      entry.keyId === id ||
      entry.keyId.endsWith(String(id)) ||
      entry.fingerprint === id,
  );
  if (!key) refuse(`No key matching "${id}" in the register.`);
  return key;
}

function commandSetLicence(args) {
  const { privateKey } = requireKeys();
  const register = loadRegister(privateKey);
  const licence = requireLicence(register, args.licence);
  if (args.expires !== undefined) {
    if (args.expires === 'never' || args.expires === true) {
      licence.expiresAt = null;
    } else {
      const date = new Date(String(args.expires));
      if (Number.isNaN(date.getTime())) refuse('--expires must be a date, e.g. 2027-05-01.');
      licence.expiresAt = date.toISOString();
    }
  }
  if (args.used !== undefined) {
    const used = requiredInt(args.used, '--used');
    if (used > licence.seats) {
      refuse(
        `--used ${used} is above the recorded limit ${licence.seats}; correct --seats first.`,
      );
    }
    licence.seatsUsed = used;
  }
  if (args.seats !== undefined) {
    const seats = requireSeatCount(args.seats, '--seats');
    if (seats < licence.seatsUsed) {
      refuse(`--seats ${seats} is below the ${licence.seatsUsed} seat(s) in use.`);
    }
    licence.seats = seats;
  }
  licence.updatedAt = new Date().toISOString();
  saveRegister(privateKey, register);
  audit({
    action: 'licence.set',
    licenseId: licence.licenseId,
    seats: licence.seats,
    seatsUsed: licence.seatsUsed,
    expiresAt: licence.expiresAt,
    result: 'updated',
  });
  console.log(`Updated ${licence.licenseId}: expires ${licence.expiresAt ?? 'never'}, seats ${licence.seats}, used ${licence.seatsUsed}.`);
}

function verifyKeyText(key) {
  const { publicKey } = requireKeys();
  if (!key || typeof key !== 'string') refuse('verify needs a key.');
  const { payload, valid } = readPayload(key, publicKey);
  audit({
    action: 'verify',
    keyId: payload.keyId ?? null,
    licenseId: payload.licenseId ?? null,
    type: payload.type ?? null,
    result: valid ? 'valid' : 'INVALID',
  });
  return { payload, valid };
}

function commandVerify(args) {
  const key = args._[1] ?? args.key;
  if (!key) refuse('verify needs a key.');
  const { payload, valid } = verifyKeyText(key);
  console.log(`signature : ${valid ? 'valid' : 'INVALID'}
type      : ${payload.type}
licence   : ${payload.licenseId}
key id    : ${payload.keyId}
machine   : ${payload.machineId ?? '-'}
term      : ${payload.term ? `${payload.term.kind} ${payload.term.months ?? ''}`.trim() : '-'}
seats     : ${payload.seats ? `${payload.seats.mode} ${payload.seats.value}` : '-'}
issued    : ${payload.issuedAt}`);
}

function commandBackup(args) {
  const { privateKey } = requireKeys();
  if (!args.out) refuse('backup needs --out <folder>.');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(String(args.out), `kayan-licence-keys-${stamp}`);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const files = readdirSync(home).filter(
    (name) => name.startsWith('private-key') || name.startsWith('public-key') ||
      name === 'register.json' || name === 'register.mac',
  );
  for (const name of files) {
    copyFileSync(join(home, name), join(target, name));
  }
  const manifest = files
    .map((name) => {
      const digest = createHash('sha256')
        .update(readFileSync(join(target, name)))
        .digest('hex');
      return `${digest}  ${name}`;
    })
    .join('\n');
  writeFileSync(join(target, 'SHA256SUMS'), `${manifest}\n`, { mode: 0o600 });
  writeFileSync(
    join(target, 'RESTORE.txt'),
    `KAYAN licence generator backup, ${new Date().toISOString()}

Copy these files back into the key directory and run any command:

  node kayan-license.mjs list --home <key directory>

If register.mac is missing or does not match register.json, the register was
edited or belongs to another key pair; the tool refuses to use it.
Verify the copy before relying on it: sha256sum -c SHA256SUMS
`,
    { mode: 0o600 },
  );
  console.log(`تم النسخ الاحتياطي. / Backup written to:
  ${target}
  ${files.length} file(s) + SHA256SUMS + RESTORE.txt

Keep it on removable media in a safe, and keep it away from the customer.
The private key in this folder can issue licences for every installation.`);
}

function commandHelp() {
  console.log(`KAYAN licence generator / مولّد مفاتيح ترخيص كيان

  init [--rotate --i-understand]      create the key pair in --home
  public-key [--base64url]            print the value the product installs
  licence create --ref TEXT --seats N --term 1y
  licence set --licence L [--expires DATE|never] [--seats N] [--used N]
  gui [--port N] [--no-browser]       open the operator window (also: no command)
  version                             print the tool version
  issue activation --licence L [--machine KM-... | --request KYNREQ1...]
                   [--term 1y] [--seats N]
  issue renewal    --licence L --term 6m
  issue seats      --licence L (--increase N | --cap N)
  issue transfer   --licence L (--machine KM-NEW | --request KYNREQ1...)
                   [--used N]
  issue ... --dry-run                 show the payload without signing it
  show-request KYNREQ1...             read the code the customer sent
  list [--licence L]                  the register of issued keys
  mark-used --key ID [--at ISO]       record that a customer applied a key
  revoke --key ID --reason TEXT
  verify KYN1...                      check a key against the public key
  backup --out FOLDER                 copy key + register with checksums

Options: --home FOLDER (default %USERPROFILE%\.kayan-license-generator), --note TEXT.

Terms: 1m 6m 1y 2y 3y, or P for perpetual (never expires).
Seats: INCREASE adds to the current limit; CAP sets a new limit. The mode is
signed inside the key, so the product cannot read it as the other one. A limit
is always at least 1: zero would mean "no limit" to the product, not "no users".

Every action is also written to audit.log beside the register: time, action,
key id, licence id and result - never the private key, the key text or the note.`);
}

// ───────────────────────────────────────────────── coming from the window

/** The window's view of the key directory: what exists, never what is secret. */
function folderSnapshot() {
  const hasKey = existsSync(paths.privateKey) && existsSync(paths.publicKey);
  let fingerprint = null;
  if (hasKey) {
    try {
      fingerprint = fingerprintOf(readFileSync(paths.publicKey, 'utf8'));
    } catch {
      fingerprint = null;
    }
  }
  let licences = [];
  let keys = [];
  if (hasKey) {
    const { privateKey } = requireKeys();
    const register = loadRegister(privateKey);
    licences = Object.values(register.licences);
    keys = register.keys.map((key) => ({
      keyId: key.keyId,
      licenseId: key.licenseId,
      type: key.type,
      status: key.status,
      issuedAt: key.issuedAt,
      machineId: key.machineId ?? null,
    }));
  }
  return {
    home,
    version: VERSION,
    hasKey,
    fingerprint,
    licences,
    keys,
    audit: readAudit(50),
  };
}

function fingerprintOf(publicKeyText) {
  return fingerprint(createPublicKey(publicKeyText));
}

/** Creates the first key pair from the window, after the operator typed CREATE. */
function initKeyPairFromWindow() {
  if (existsSync(paths.privateKey)) {
    refuse(
      'A signing key already exists in this folder. Creating another would ' +
        'invalidate every key already issued. Back this folder up instead.',
    );
  }
  commandInit({ _: [] });
  audit({ action: 'init', result: 'created' });
  return { fingerprint: fingerprintOf(readFileSync(paths.publicKey, 'utf8')) };
}

/**
 * The object the window talks to. Every method is a thin wrapper over the
 * function the command line uses - there is no second implementation of a
 * licensing rule anywhere.
 */
function guiApi() {
  const summaryOf = (payload) => {
    const lines = [
      `type: ${payload.type}`,
      `licence: ${payload.licenseId}`,
      `key id: ${payload.keyId}`,
      `machine: ${payload.machineId ?? '-'}`,
      `term: ${payload.term ? describeTerm(payload.term) : '-'}`,
      `seats: ${payload.seats ? `${payload.seats.mode} ${payload.seats.value}` : '-'}`,
    ];
    if (payload.state) {
      lines.push(
        `state: expires ${payload.state.expiresAt ?? 'never'}, ` +
          `limit ${payload.state.seatLimit}, used ${payload.state.seatsUsed}`,
      );
    }
    return lines.join('\n');
  };

  return {
    state: () => folderSnapshot(),
    createLicence: (body) => {
      const { licence } = createLicence({
        ref: body?.ref,
        seats: body?.seats,
        term: body?.term,
      });
      return { licence };
    },
    issueKey: (body) => {
      const result = issueKey({
        type: body?.type,
        licenceId: body?.licenceId,
        machineId: body?.machineId,
        request: body?.request,
        term: body?.term,
        seats: body?.seats,
        increase: body?.increase,
        cap: body?.cap,
        used: body?.used,
        note: body?.note,
        dryRun: Boolean(body?.dryRun),
      });
      if (body?.dryRun) return { preview: result.preview };
      return {
        key: result.key,
        preview: result.preview,
        summary: summaryOf(result.payload),
      };
    },
    verifyKey: (key) => verifyKeyText(key),
    inspectRequest: (code) => {
      const request = parseRequestCode(code);
      return {
        machineId: request.machineId,
        installId: request.installId ?? null,
        appVersion: request.appVersion ?? null,
        requestedAt: request.requestedAt ?? null,
      };
    },
    markUsed: (keyId) => {
      const key = markUsed(keyId);
      return { keyId: key.keyId, status: key.status };
    },
    revokeKey: (keyId, reason) => {
      const key = revokeKey(keyId, reason);
      return { keyId: key.keyId, status: key.status };
    },
    initKeyPair: () => initKeyPairFromWindow(),
  };
}

/**
 * Opens the operator window. The server listens on the loopback address only
 * and every call needs the token printed in the address.
 */
async function commandGui(args) {
  await startGui({
    home,
    port: args.port ? Number(args.port) : 0,
    open: !args['no-browser'],
    api: guiApi(),
    openBrowser: (url) => {
      const command =
        process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', url]]
          : process.platform === 'darwin'
            ? ['open', [url]]
            : ['xdg-open', [url]];
      return new Promise((resolve, reject) => {
        const child = spawn(command[0], command[1], {
          detached: true,
          stdio: 'ignore',
        });
        child.on('error', reject);
        child.on('spawn', resolve);
        child.unref();
      });
    },
  });
  // The window is the process: it stays up until the operator closes it with
  // Ctrl+C or the console window.
  return new Promise(() => {});
}

// ────────────────────────────────────────────────────────────────────── main


async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  // `--help` is consumed as an option by the parser, so check both spellings;
  // without this, a bare `--help` would be read as "no command" and open the
  // operator window.
  if (args.help || command === '-h' || command === 'help') {
    commandHelp();
    return;
  }
  if (command === 'version' || command === '--version') {
    console.log(`kayan-license ${VERSION} (node ${process.version}, ${process.platform})`);
    return;
  }
  if (command === 'gui') {
    await commandGui(args);
    return;
  }
  if (command === 'licence') {
    const action = args._[1];
    if (action === 'create') return commandLicenceCreate(args);
    if (action === 'set') return commandSetLicence(args);
    refuse('licence needs "create" or "set".');
  }

  const run = {
    init: (initArgs) => {
      commandInit(initArgs);
      audit({ action: 'init', result: initArgs.rotate ? 'rotated' : 'created' });
    },
    'public-key': commandPublicKey,
    issue: commandIssue,
    'show-request': commandShowRequest,
    list: commandList,
    'mark-used': commandMarkUsed,
    revoke: commandRevoke,
    verify: commandVerify,
    backup: commandBackup,
    help: commandHelp,
  }[command];

  if (!run) {
    if (command) {
      console.error(`Unknown command "${command}".`);
      commandHelp();
      process.exitCode = 2;
      return;
    }
    // No command at all: the operator window. That is what the packaged
    // executable does when the operator double-clicks it.
    await commandGui(args);
    return;
  }

  await run(args);
}

async function runCli() {
  try {
    await main();
  } catch (error) {
    if (error instanceof Refusal) {
      console.error(`\n  ${error.message}\n`);
      process.exitCode = 1;
    } else {
      // Never print a stack that could include key material from a closure.
      console.error(`\n  Unexpected failure: ${error.message}\n`);
      process.exitCode = 3;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}

export {
  VERSION,
  runCli,
  main,
  signPayload,
  readPayload,
  parseRequestCode,
  parseTerm,
  addMonths,
  createLicence,
  issueKey,
  verifyKeyText,
  markUsed,
  revokeKey,
  folderSnapshot,
  readAudit,
  previewOf,
  requireSeatCount,
  guiApi,
  home,
  paths,
};
