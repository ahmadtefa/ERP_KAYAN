import { generateKeyPairSync, KeyObject } from 'node:crypto';

import {
  LicenseKeyError,
  LicensePayload,
  buildRequestCode,
  loadPublicKey,
  parseRequestCode,
  publicKeyFingerprint,
  readPayload,
  signPayload,
  splitKey,
  verifyKey,
} from './license-key';

/**
 * The keys are signed documents, so every test here is about what a document
 * is allowed to say. The private key exists only in this test: nothing in the
 * backend can sign, which is the property that makes the format worth having.
 */

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

const base = (overrides: Partial<LicensePayload> = {}): LicensePayload => ({
  v: 1,
  keyId: 'key_0001-abcd',
  type: 'ACTIVATION',
  licenseId: 'lic_0001-abcd',
  machineId: 'KM-AAAA-BBBB-CCCC',
  issuedAt: '2026-05-01T00:00:00.000Z',
  term: { kind: 'MONTHS', months: 12 },
  seats: { mode: 'INCREASE', value: 5 },
  state: null,
  note: null,
  ...overrides,
});

const issued = (overrides: Partial<LicensePayload> = {}): string =>
  signPayload(base(overrides), privateKey);

describe('the licence key format', () => {
  it('round-trips a signed activation key', () => {
    const parsed = verifyKey(issued(), publicKey);
    expect(parsed.payload.type).toBe('ACTIVATION');
    expect(parsed.payload.machineId).toBe('KM-AAAA-BBBB-CCCC');
    expect(parsed.payload.term).toEqual({ kind: 'MONTHS', months: 12 });
  });

  it('refuses a key when even one character of the payload changed', () => {
    const key = issued();
    const [prefix, payload, signature] = key.split('.');
    const tampered = `${prefix}.${payload.slice(0, -2)}AA.${signature}`;
    expect(() => verifyKey(tampered, publicKey)).toThrow(LicenseKeyError);
  });

  it('refuses a key signed by a different private key', () => {
    const other = generateKeyPairSync('ed25519');
    const foreign = signPayload(
      { ...base(), licenseId: 'lic_9999-zzzz' },
      other.privateKey,
    );
    expect(() => verifyKey(foreign, publicKey)).toThrow(/signature does not match/i);
  });

  it('refuses a payload whose JSON was re-serialised in another order', () => {
    // Same fields, same values, different spelling: the signature covers the
    // text that was signed, so a rebuilt payload no longer verifies. This is
    // what stops a forger from editing one field and keeping the signature.
    const key = issued();
    const [prefix, payload, signature] = key.split('.');
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const reversed = Object.fromEntries(
      Object.entries(parsed).reverse(),
    );
    expect(Object.keys(reversed)[0]).not.toBe(Object.keys(parsed)[0]);
    const rebuilt = `${prefix}.${Buffer.from(
      JSON.stringify(reversed),
    ).toString('base64url')}`;
    expect(() => verifyKey(`${rebuilt}.${signature}`, publicKey)).toThrow(
      LicenseKeyError,
    );
  });

  it('rejects text that is not a KAYAN key at all', () => {
    expect(() => splitKey('hello')).toThrow(/not a KAYAN licence key/i);
    expect(() => splitKey('KYN1.abc')).toThrow(LicenseKeyError);
    expect(() => splitKey('')).toThrow(/empty/i);
  });

  it('tolerates the whitespace a chat message adds', () => {
    const key = issued();
    const wrapped = `  ${key.slice(0, 40)}\n${key.slice(40)}  `;
    expect(verifyKey(wrapped, publicKey).payload.keyId).toBe('key_0001-abcd');
  });
});

describe('key types are exclusive', () => {
  const good = {
    ACTIVATION: base(),
    RENEWAL: base({ type: 'RENEWAL', machineId: null, seats: null }),
    SEATS: base({ type: 'SEATS', machineId: null, term: null }),
    TRANSFER: base({
      type: 'TRANSFER',
      term: null,
      seats: null,
      state: {
        expiresAt: '2027-05-01T00:00:00.000Z',
        seatLimit: 5,
        seatsUsed: 3,
        startsAt: '2026-05-01T00:00:00.000Z',
        issuedAt: '2026-05-01T00:00:00.000Z',
      },
    }),
  };

  it.each(Object.entries(good))('%s keys are accepted with their full payload', (type, payload) => {
    const parsed = verifyKey(signPayload(payload, privateKey), publicKey);
    expect(parsed.payload.type).toBe(type);
  });

  it('refuses an activation key that names no machine', () => {
    expect(() => readPayload({ ...base(), machineId: null })).toThrow(
      /must name a machine/i,
    );
  });

  it('refuses an activation key with no term', () => {
    expect(() => readPayload({ ...base(), term: null })).toThrow(/must state a term/i);
  });

  it('refuses an activation key with no seat limit', () => {
    // Without this refusal a key with no seats block would read as unlimited.
    expect(() => readPayload({ ...base(), seats: null })).toThrow(/seat limit/i);
    expect(() =>
      readPayload({ ...base(), seats: { mode: 'PRESERVE', value: 0 } }),
    ).toThrow(/seat limit/i);
  });

  it('refuses a renewal key that also moves the seat limit', () => {
    expect(() =>
      readPayload({
        ...base(),
        type: 'RENEWAL',
        machineId: null,
        seats: { mode: 'INCREASE', value: 3 },
      }),
    ).toThrow(/separate seats key/i);
  });

  it('refuses a seats key that also carries a term', () => {
    expect(() =>
      readPayload({ ...base(), type: 'SEATS', machineId: null }),
    ).toThrow(/separate renewal key/i);
  });

  it('refuses a seats key that changes nothing', () => {
    expect(() =>
      readPayload({
        ...base(),
        type: 'SEATS',
        machineId: null,
        term: null,
        seats: { mode: 'PRESERVE', value: 0 },
      }),
    ).toThrow(/must state the change/i);
  });

  it('refuses a transfer key without the state it must preserve', () => {
    expect(() =>
      readPayload({ ...base(), type: 'TRANSFER', term: null, seats: null }),
    ).toThrow(/carry the licence state/i);
  });

  it('refuses an unknown type and an unknown version', () => {
    expect(() => readPayload({ ...base(), type: 'MASTER' })).toThrow(/type is unknown/i);
    expect(() => readPayload({ ...base(), v: 2 })).toThrow(/format 2/i);
  });

  it('refuses a seat grant outside its range', () => {
    expect(() =>
      readPayload({ ...base(), seats: { mode: 'INCREASE', value: 0 } }),
    ).toThrow(/at least 1/i);
    expect(() =>
      readPayload({ ...base(), seats: { mode: 'INCREASE', value: 1.5 } }),
    ).toThrow(/out of range/i);
    expect(() =>
      readPayload({ ...base(), seats: { mode: 'CAP', value: 100001 } }),
    ).toThrow(/out of range/i);
  });

  it('refuses a term longer than a hundred years', () => {
    expect(() =>
      readPayload({ ...base(), term: { kind: 'MONTHS', months: 1201 } }),
    ).toThrow(/1\.\.1200/);
    expect(() =>
      readPayload({ ...base(), term: { kind: 'MONTHS', months: 0 } }),
    ).toThrow(/1\.\.1200/);
  });

  it('reads a perpetual term without inventing a date', () => {
    const parsed = readPayload({ ...base(), term: { kind: 'PERPETUAL' } });
    expect(parsed.term).toEqual({ kind: 'PERPETUAL' });
  });
});

describe('the public key', () => {
  it('accepts PEM and the bare DER an installer may write', () => {
    const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
    const der = publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64url');
    expect(loadPublicKey(pem).asymmetricKeyType).toBe('ed25519');
    expect(loadPublicKey(der).asymmetricKeyType).toBe('ed25519');
    expect(loadPublicKey(`  ${pem}  `).type).toBe('public');
  });

  it('refuses a private key in PEM, so one cannot be shipped by mistake', () => {
    const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    // `createPublicKey` would happily derive the public half from this; the
    // product must refuse it instead of holding a private key.
    expect(() => loadPublicKey(privatePem)).toThrow(/private key/i);
  });

  it('refuses a private key written as bare DER', () => {
    const privateDer = privateKey
      .export({ format: 'der', type: 'pkcs8' })
      .toString('base64url');
    expect(() => loadPublicKey(privateDer)).toThrow(/private key/i);
  });

  it('refuses a public key that is not Ed25519', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = rsa.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    expect(() => loadPublicKey(pem)).toThrow(/must be an Ed25519 public key/i);
  });

  it('refuses an empty setting with a distinct code', () => {
    expect(() => loadPublicKey('   ')).toThrow(LicenseKeyError);
    try {
      loadPublicKey('');
    } catch (error) {
      expect((error as LicenseKeyError).code).toBe('NO_PUBLIC_KEY');
    }
  });

  it('prints a stable fingerprint that is not the key itself', () => {
    const print = publicKeyFingerprint(publicKey as KeyObject);
    const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
    expect(print).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){7}$/);
    expect(publicKeyFingerprint(loadPublicKey(pem))).toBe(print);
    expect(print).not.toContain(pem.slice(30, 60));
  });
});

describe('the activation request code', () => {
  const request = {
    v: 1 as const,
    machineId: 'KM-AAAA-BBBB-CCCC',
    installId: 'install-1234',
    appVersion: '0.1.0',
    requestedAt: '2026-05-01T00:00:00.000Z',
    nonce: '0a1b2c3d4e5f6071',
  };

  it('carries the machine id to the operator and back', () => {
    const code = buildRequestCode(request);
    expect(code.startsWith('KYNREQ1.')).toBe(true);
    expect(parseRequestCode(code)?.machineId).toBe('KM-AAAA-BBBB-CCCC');
  });

  it('refuses a request code whose body was altered', () => {
    const code = buildRequestCode(request);
    const [prefix, body, check] = code.split('.');
    const otherBody = Buffer.from(
      JSON.stringify({ ...request, machineId: 'KM-XXXX-YYYY-ZZZZ' }),
    ).toString('base64url');
    expect(parseRequestCode(`${prefix}.${otherBody}.${check}`)).toBeNull();
    expect(parseRequestCode(`${prefix}.${body}.${check}x`)).toBeNull();
  });

  it('returns null for anything that is not a request code', () => {
    expect(parseRequestCode('')).toBeNull();
    expect(parseRequestCode(issued())).toBeNull();
    expect(parseRequestCode('KYNREQ1.nope.nope')).toBeNull();
  });
});
