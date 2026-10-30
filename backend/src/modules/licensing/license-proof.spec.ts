import { generateKeyPairSync } from 'node:crypto';
import { signPayload, splitKey } from './license-key';
import { LicenseProofError, RecordedLicenseProof, verifyRecordedLicenseProof } from './license-proof';

const pair = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
const signedKey = signPayload({
  v: 1, keyId: 'key_proof-0001', type: 'ACTIVATION', licenseId: 'license-proof-0001',
  machineId: 'KM-TEST-AAAA-BBBB', issuedAt: '2026-01-01T00:00:00.000Z',
  term: { kind: 'PERPETUAL' }, seats: { mode: 'CAP', value: 5 }, state: null,
}, pair.privateKey);
const payload = splitKey(signedKey);
const record: RecordedLicenseProof = {
  keyId: payload.payload.keyId, licenseId: payload.payload.licenseId,
  type: payload.payload.type, machineId: payload.payload.machineId,
  payloadJson: payload.payloadJson, signedKey,
};

describe('recorded vendor signature', () => {
  it('returns the signed payload only after verifying the key and its row', () => {
    expect(verifyRecordedLicenseProof(record, pair.publicKey).payload).toEqual(payload.payload);
  });

  it('refuses legacy payload-only rows rather than inventing a signature', () => {
    try {
      verifyRecordedLicenseProof({ ...record, signedKey: null }, pair.publicKey);
      throw new Error('a row without proof was accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(LicenseProofError);
      expect((error as LicenseProofError).code).toBe('MISSING_PROOF');
    }
  });

  it.each([
    ['key id', { keyId: 'key_changed-1' }],
    ['licence id', { licenseId: 'license-changed-1' }],
    ['type', { type: 'RENEWAL' }],
    ['machine', { machineId: 'KM-OTHER-AAAA-BBBB' }],
    ['payload', { payloadJson: '{}' }],
    ['signature', { signedKey: `${signedKey.slice(0, -1)}!` }],
  ])('rejects a changed %s without exposing its contents', (_name, change) => {
    try {
      verifyRecordedLicenseProof({ ...record, ...change }, pair.publicKey);
      throw new Error('changed proof was accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(LicenseProofError);
      expect((error as LicenseProofError).code).toBe('INVALID_PROOF');
      expect(String(error)).not.toContain(signedKey);
    }
  });

  it('rejects a key issued by another signer', () => {
    expect(() => verifyRecordedLicenseProof(record, other.publicKey)).toThrow(LicenseProofError);
  });
});
