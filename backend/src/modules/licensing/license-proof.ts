import { KeyObject } from 'node:crypto';

import { ParsedLicenseKey, verifyKey } from './license-key';

/** A database row is not trusted until the original signature is checked. */
export interface RecordedLicenseProof {
  keyId: string;
  licenseId: string;
  type: string;
  machineId: string | null;
  payloadJson: string;
  signedKey: string | null;
}

export class LicenseProofError extends Error {
  constructor(readonly code: 'MISSING_PROOF' | 'INVALID_PROOF') {
    super(code === 'MISSING_PROOF'
      ? 'The original signed licence key is unavailable; a trusted proof or reissue is required.'
      : 'The recorded licence key could not be verified against the protected record.');
    this.name = 'LicenseProofError';
  }
}

/**
 * Verify the exact vendor-signed payload, then bind it to the row. This does
 * not validate the current machine, term, replay ledger or clock; callers
 * must independently verify those before using the result for recovery.
 */
export function verifyRecordedLicenseProof(
  record: RecordedLicenseProof,
  publicKey: KeyObject,
): ParsedLicenseKey {
  if (typeof record.signedKey !== 'string' || !record.signedKey) {
    throw new LicenseProofError('MISSING_PROOF');
  }
  let parsed: ParsedLicenseKey;
  try {
    parsed = verifyKey(record.signedKey, publicKey);
  } catch {
    // Do not include signed keys or payload contents in error messages.
    throw new LicenseProofError('INVALID_PROOF');
  }
  if (parsed.payload.keyId !== record.keyId ||
      parsed.payload.licenseId !== record.licenseId ||
      parsed.payload.type !== record.type ||
      parsed.payload.machineId !== record.machineId ||
      parsed.payloadJson !== record.payloadJson) {
    throw new LicenseProofError('INVALID_PROOF');
  }
  return parsed;
}
