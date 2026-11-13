import { createHash, KeyObject } from 'node:crypto';

import {
  LicenseKeyError,
  ParsedLicenseKey,
  loadPublicKey,
  verifyKey,
} from './license-key';

/**
 * Public verifier material only. This is a transition building block: it is
 * not connected to installed key loading, activation or recovery yet.
 * Issuance policy is separate and must never use the legacy key to sign.
 */
export const LEGACY_VERIFIER_SHA256 = '9153e15e475ba2e2251a7e40d8eb58559006bbba2923ee8ba564d8d59cc602c4';
export const NEW_VERIFIER_SHA256 = 'f93238b0cdc0a81d345f160cf8dcdbb7de5e4d20fa99959b7e4b165ac1ebb5c3';

type VerifiedEntry = Readonly<{ key: KeyObject; fingerprint: string }>;

function pinnedPublicKey(pem: string, expected: string): VerifiedEntry {
  const key = loadPublicKey(pem);
  const actual = createHash('sha256')
    .update(key.export({ type: 'spki', format: 'der' }))
    .digest('hex');
  if (actual !== expected) {
    throw new LicenseKeyError('The configured licence verification key does not match its approved fingerprint.', 'NO_PUBLIC_KEY');
  }
  return Object.freeze({ key, fingerprint: actual });
}

/**
 * Both exact public keys must be present: no caller-supplied fingerprint,
 * fallback key, environment override, private key, or partial keyring is
 * accepted. Filesystem ACLs, tamper detection and protected-store migration
 * remain the responsibility of the future integration.
 */
export class PublicLicenseKeyring {
  private constructor(private readonly entries: readonly VerifiedEntry[]) {}

  static fromPinnedPem(legacyPem: string, newPem: string): PublicLicenseKeyring {
    const entries = Object.freeze([
      pinnedPublicKey(legacyPem, LEGACY_VERIFIER_SHA256),
      pinnedPublicKey(newPem, NEW_VERIFIER_SHA256),
    ]);
    return new PublicLicenseKeyring(entries);
  }

  /** A cryptographic result only; callers must separately enforce machine,
   * dates, revocation, replay, clock and recorded proof before authorizing. */
  verify(raw: string): { parsed: ParsedLicenseKey; signerSha256: string } {
    for (const entry of this.entries) {
      try {
        return { parsed: verifyKey(raw, entry.key), signerSha256: entry.fingerprint };
      } catch (error) {
        // Malformed content and unexpected failures are not key-rotation
        // mismatches. Only a clean bad-signature result may try the other key.
        if (!(error instanceof LicenseKeyError) || error.code !== 'BAD_SIGNATURE') throw error;
      }
    }
    throw new LicenseKeyError('The key signature does not match an approved verifier.', 'BAD_SIGNATURE');
  }
}
