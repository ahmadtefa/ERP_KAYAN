import {
  createPublicKey,
  createHash,
  KeyObject,
  sign as nodeSign,
  verify as verifySignature,
} from 'node:crypto';

/**
 * The offline licence key format.
 *
 * A key is three dot-separated parts:
 *
 *     KYN1.<base64url(payload JSON)>.<base64url(ed25519 signature)>
 *
 * The signature covers the literal text `KYN1.<payload>` exactly as it was
 * issued, so re-serialising the JSON (different key order, different spacing)
 * cannot produce a valid key. Only the operator's key generator holds the
 * private half; this file is the whole of what the product can do with a key,
 * and it can only verify.
 *
 * There is deliberately no symmetric fallback and no secret in this product:
 * a value compiled into the program would be a licence forgeable by anyone
 * who reads the program.
 */

export const LICENSE_KEY_PREFIX = 'KYN1';
export const LICENSE_REQUEST_PREFIX = 'KYNREQ1';

export type LicenseKeyType =
  | 'ACTIVATION'
  | 'RENEWAL'
  | 'SEATS'
  | 'TRANSFER';

export const LICENSE_KEY_TYPES: readonly LicenseKeyType[] = [
  'ACTIVATION',
  'RENEWAL',
  'SEATS',
  'TRANSFER',
];

export type LicenseTerm =
  | { kind: 'MONTHS'; months: number }
  | { kind: 'PERPETUAL' };

/** How a seat key changes the limit. The meaning is written into the key, so
 *  the operator and the product cannot read the same number differently. */
export type SeatGrant =
  /** Add `value` seats to the current limit. */
  | { mode: 'INCREASE'; value: number }
  /** Set the limit to `value`; refused when it would be below what is used. */
  | { mode: 'CAP'; value: number }
  /** Leave the limit alone (used by transfer keys). */
  | { mode: 'PRESERVE'; value: number };

export interface LicensePayload {
  /** Format version. Anything but 1 is refused unread. */
  v: 1;
  /** Unique per issued key; the anti-replay identity. */
  keyId: string;
  type: LicenseKeyType;
  licenseId: string;
  /** The machine an activation or transfer is for; null for renewal/seats. */
  machineId: string | null;
  issuedAt: string;
  /** The term an activation or renewal grants; null for seats/transfer. */
  term: LicenseTerm | null;
  /** The seat limit change; null when the key does not touch seats. */
  seats: SeatGrant | null;
  /**
   * Authoritative state carried by a transfer, taken from the operator's
   * register: the licence moves to another machine with exactly this term,
   * this seat limit and this count of accounts already created.
   * `expiresAt: null` means perpetual.
   */
  state?: {
    expiresAt: string | null;
    seatLimit: number;
    seatsUsed: number;
    startsAt: string;
    issuedAt: string;
  } | null;
  note?: string | null;
}

export interface ParsedLicenseKey {
  payload: LicensePayload;
  payloadJson: string;
  signature: string;
  signedText: string;
}

export class LicenseKeyError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'MALFORMED'
      | 'UNSUPPORTED_VERSION'
      | 'BAD_FIELD'
      | 'NO_PUBLIC_KEY'
      | 'BAD_SIGNATURE' = 'MALFORMED',
  ) {
    super(message);
    this.name = 'LicenseKeyError';
  }
}

/** base64url without padding, the only alphabet a key uses. */
function b64urlEncode(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function b64urlDecode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

const UUID_LIKE = /^[0-9a-zA-Z][0-9a-zA-Z._:-]{7,63}$/;
/** A machine id is opaque to the server: it is validated by shape only. */
const MACHINE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/;

function assertUuidLike(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_LIKE.test(value)) {
    throw new LicenseKeyError(`${field} is missing or malformed`, 'BAD_FIELD');
  }
  return value;
}

function assertTerm(value: unknown): LicenseTerm | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') {
    throw new LicenseKeyError('term is malformed', 'BAD_FIELD');
  }
  const term = value as { kind?: unknown; months?: unknown };
  if (term.kind === 'PERPETUAL') return { kind: 'PERPETUAL' };
  if (term.kind === 'MONTHS') {
    const months = Number(term.months);
    if (!Number.isInteger(months) || months < 1 || months > 1200) {
      throw new LicenseKeyError('term months must be 1..1200', 'BAD_FIELD');
    }
    return { kind: 'MONTHS', months };
  }
  throw new LicenseKeyError('term kind is unknown', 'BAD_FIELD');
}

function assertSeats(value: unknown): SeatGrant | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') {
    throw new LicenseKeyError('seats is malformed', 'BAD_FIELD');
  }
  const grant = value as { mode?: unknown; value?: unknown };
  if (
    grant.mode !== 'INCREASE' &&
    grant.mode !== 'CAP' &&
    grant.mode !== 'PRESERVE'
  ) {
    throw new LicenseKeyError('seat mode is unknown', 'BAD_FIELD');
  }
  const amount = Number(grant.value);
  if (!Number.isInteger(amount) || amount < 0 || amount > 100000) {
    throw new LicenseKeyError('seat value is out of range', 'BAD_FIELD');
  }
  if (grant.mode !== 'PRESERVE' && amount < 1) {
    throw new LicenseKeyError('a seat grant must be at least 1', 'BAD_FIELD');
  }
  return { mode: grant.mode, value: amount };
}


/** A PKCS#8 Ed25519 private key (and its SPKI shape is far shorter, so the
 *  two cannot be confused). */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function isPrivateKeyDer(der: Buffer): boolean {
  return (
    der.length >= ED25519_PKCS8_PREFIX.length &&
    der.subarray(0, ED25519_PKCS8_PREFIX.length).equals(ED25519_PKCS8_PREFIX)
  );
}

/**
 * Reads a public key without ever accepting a private one.
 *
 * The installer writes a PEM file; an operator may also paste the same text
 * into LICENSE_PUBLIC_KEY. Both are accepted; a key of the wrong type is not.
 */
export function loadPublicKey(text: string): KeyObject {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new LicenseKeyError('No licence public key was configured', 'NO_PUBLIC_KEY');
  }
  // `createPublicKey` derives the public half when it is handed a private key,
  // which would quietly accept a private key into an installation. The product
  // must never hold one, so the input is refused before it is parsed.
  if (/PRIVATE KEY/.test(trimmed)) {
    throw new LicenseKeyError(
      'That is a private key. Only the public key belongs in the product; keep the private key with the key generator.',
      'NO_PUBLIC_KEY',
    );
  }
  const der = trimmed.includes('-----BEGIN')
    ? null
    : b64urlDecode(trimmed.replace(/\s+/g, ''));
  if (der && isPrivateKeyDer(der)) {
    throw new LicenseKeyError(
      'That is a private key. Only the public key belongs in the product; keep the private key with the key generator.',
      'NO_PUBLIC_KEY',
    );
  }
  let key: KeyObject;
  try {
    key = der
      ? createPublicKey({ key: der, format: 'der', type: 'spki' })
      : createPublicKey({ key: trimmed, format: 'pem' });
  } catch {
    throw new LicenseKeyError('The licence public key could not be read', 'NO_PUBLIC_KEY');
  }
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
    throw new LicenseKeyError(
      'The licence public key must be an Ed25519 public key',
      'NO_PUBLIC_KEY',
    );
  }
  return key;
}

/** A short, stable name for a public key, so the operator can tell which one
 *  a given installation is checking against. Not a secret. */
export function publicKeyFingerprint(key: KeyObject): string {
  const der = key.export({ format: 'der', type: 'spki' });
  const hex = createHash('sha256').update(der).digest('hex').toUpperCase();
  return hex.slice(0, 32).replace(/(.{4})(?=.)/g, '$1-');
}

/** Validates the payload's shape. Signature checking is a separate step so a
 *  malformed key is reported as malformed, not as a forgery. */
export function readPayload(raw: unknown): LicensePayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LicenseKeyError('The key payload is not an object', 'MALFORMED');
  }
  const payload = raw as Record<string, unknown>;
  if (payload.v !== 1) {
    throw new LicenseKeyError(
      `This key was written in format ${String(payload.v)}, which this version does not read`,
      'UNSUPPORTED_VERSION',
    );
  }
  const type = payload.type;
  if (!LICENSE_KEY_TYPES.includes(type as LicenseKeyType)) {
    throw new LicenseKeyError('The key type is unknown', 'BAD_FIELD');
  }
  const keyId = assertUuidLike(payload.keyId, 'keyId');
  const licenseId = assertUuidLike(payload.licenseId, 'licenseId');

  const machineRaw = payload.machineId ?? null;
  let machineId: string | null = null;
  if (machineRaw !== null) {
    if (typeof machineRaw !== 'string' || !MACHINE_ID.test(machineRaw)) {
      throw new LicenseKeyError('machineId is malformed', 'BAD_FIELD');
    }
    machineId = machineRaw;
  }

  const issuedAt = new Date(String(payload.issuedAt ?? ''));
  if (Number.isNaN(issuedAt.getTime())) {
    throw new LicenseKeyError('issuedAt is not a date', 'BAD_FIELD');
  }

  const term = assertTerm(payload.term);
  const seats = assertSeats(payload.seats);

  let state: LicensePayload['state'] = null;
  if (payload.state !== null && payload.state !== undefined) {
    if (typeof payload.state !== 'object') {
      throw new LicenseKeyError('state is malformed', 'BAD_FIELD');
    }
    const stateRaw = payload.state as Record<string, unknown>;
    const expiresAt =
      stateRaw.expiresAt === null || stateRaw.expiresAt === undefined
        ? null
        : new Date(String(stateRaw.expiresAt));
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new LicenseKeyError('state.expiresAt is not a date', 'BAD_FIELD');
    }
    const seatLimit = Number(stateRaw.seatLimit);
    if (!Number.isInteger(seatLimit) || seatLimit < 0) {
      throw new LicenseKeyError('state.seatLimit is invalid', 'BAD_FIELD');
    }
    const seatsUsed = Number(stateRaw.seatsUsed ?? 0);
    if (!Number.isInteger(seatsUsed) || seatsUsed < 0) {
      throw new LicenseKeyError('state.seatsUsed is invalid', 'BAD_FIELD');
    }
    const startsAt = new Date(String(stateRaw.startsAt ?? ''));
    const stateIssuedAt = new Date(String(stateRaw.issuedAt ?? ''));
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(stateIssuedAt.getTime())) {
      throw new LicenseKeyError('state dates are invalid', 'BAD_FIELD');
    }
    state = {
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      seatLimit,
      seatsUsed,
      startsAt: startsAt.toISOString(),
      issuedAt: stateIssuedAt.toISOString(),
    };
  }

  const noteRaw = payload.note;
  const note =
    noteRaw === null || noteRaw === undefined
      ? null
      : String(noteRaw).slice(0, 300);

  // Type-specific requirements, checked on the payload alone.
  if (type === 'ACTIVATION') {
    if (!machineId) {
      throw new LicenseKeyError('An activation key must name a machine', 'BAD_FIELD');
    }
    if (!term) {
      throw new LicenseKeyError('An activation key must state a term', 'BAD_FIELD');
    }
    // Without an explicit number the limit would read as "no limit", which
    // would turn the cheapest key into an unlimited one.
    if (!seats || seats.mode === 'PRESERVE') {
      throw new LicenseKeyError('An activation key must state a seat limit', 'BAD_FIELD');
    }
  }
  if (type === 'RENEWAL') {
    if (!term) {
      throw new LicenseKeyError('A renewal key must state a term', 'BAD_FIELD');
    }
    if (seats && seats.mode !== 'PRESERVE') {
      throw new LicenseKeyError(
        'A renewal key cannot change the seat limit; issue a separate seats key',
        'BAD_FIELD',
      );
    }
  }
  if (type === 'SEATS') {
    if (!seats || seats.mode === 'PRESERVE') {
      throw new LicenseKeyError('A seats key must state the change', 'BAD_FIELD');
    }
    if (term) {
      throw new LicenseKeyError(
        'A seats key cannot change the licence term; issue a separate renewal key',
        'BAD_FIELD',
      );
    }
  }
  if (type === 'TRANSFER') {
    if (!machineId) {
      throw new LicenseKeyError('A transfer key must name the new machine', 'BAD_FIELD');
    }
    if (!state) {
      throw new LicenseKeyError(
        'A transfer key must carry the licence state to preserve',
        'BAD_FIELD',
      );
    }
  }

  return {
    v: 1,
    keyId,
    type: type as LicenseKeyType,
    licenseId,
    machineId,
    issuedAt: issuedAt.toISOString(),
    term,
    seats,
    state,
    note,
  };
}

/** Splits a key into its parts. Does not verify anything. */
export function splitKey(key: string): {
  payloadJson: string;
  payload: LicensePayload;
  signedText: string;
  signature: Buffer;
} {
  const text = String(key ?? '')
    .replace(/\s+/g, '')
    .trim();
  if (!text) throw new LicenseKeyError('The key is empty', 'MALFORMED');

  const parts = text.split('.');
  if (parts.length !== 3 || parts[0] !== LICENSE_KEY_PREFIX) {
    throw new LicenseKeyError(
      'This is not a KAYAN licence key (it should start with KYN1.)',
      'MALFORMED',
    );
  }
  let payloadJson: string;
  try {
    payloadJson = b64urlDecode(parts[1]).toString('utf8');
  } catch {
    throw new LicenseKeyError('The key payload is not readable', 'MALFORMED');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    throw new LicenseKeyError('The key payload is not JSON', 'MALFORMED');
  }
  return {
    payload: readPayload(parsed),
    payloadJson,
    signedText: `${parts[0]}.${parts[1]}`,
    signature: b64urlDecode(parts[2]),
  };
}

/**
 * The only thing the product does with a key: check that the operator signed
 * this exact payload. A key with a valid shape and an invalid signature is a
 * forgery and is reported as one.
 */
export function verifyKey(key: string, publicKey: KeyObject): ParsedLicenseKey {
  const parts = splitKey(key);
  let valid = false;
  try {
    valid = verifySignature(
      null,
      Buffer.from(parts.signedText, 'utf8'),
      publicKey,
      parts.signature,
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new LicenseKeyError(
      'The key signature does not match. It was not issued for this program, or it has been altered.',
      'BAD_SIGNATURE',
    );
  }
  return {
    payload: parts.payload,
    payloadJson: parts.payloadJson,
    signature: parts.signature.toString('base64url'),
    signedText: parts.signedText,
  };
}

// ───────────────────────────────────────────────────────── activation request

export interface ActivationRequest {
  v: 1;
  machineId: string;
  installId: string;
  appVersion: string;
  requestedAt: string;
  nonce: string;
}

/** The code the customer sends to the operator. It carries no secret: it is
 *  the machine id plus what the operator needs to see it is a fresh request. */
export function buildRequestCode(request: ActivationRequest): string {
  const json = JSON.stringify(request);
  const body = b64urlEncode(json);
  const check = createHash('sha256')
    .update(`${LICENSE_REQUEST_PREFIX}.${body}`)
    .digest('base64url')
    .slice(0, 10);
  return `${LICENSE_REQUEST_PREFIX}.${body}.${check}`;
}

export function parseRequestCode(code: string): ActivationRequest | null {
  const text = String(code ?? '')
    .replace(/\s+/g, '')
    .trim();
  const parts = text.split('.');
  if (parts.length !== 3 || parts[0] !== LICENSE_REQUEST_PREFIX) return null;
  const expected = createHash('sha256')
    .update(`${LICENSE_REQUEST_PREFIX}.${parts[1]}`)
    .digest('base64url')
    .slice(0, 10);
  if (expected !== parts[2]) return null;
  try {
    const parsed = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.machineId !== 'string') return null;
    return parsed as ActivationRequest;
  } catch {
    return null;
  }
}

/**
 * Signs a payload. Only the offline key generator holds a private key; this
 * helper exists so the format has one implementation to test against, and is
 * never called by the API.
 */
export function signPayload(payload: LicensePayload, privateKey: KeyObject): string {
  const payloadJson = JSON.stringify(payload);
  const signedText = `${LICENSE_KEY_PREFIX}.${b64urlEncode(payloadJson)}`;
  const signature = nodeSign(null, Buffer.from(signedText, 'utf8'), privateKey);
  return `${signedText}.${signature.toString('base64url')}`;
}
