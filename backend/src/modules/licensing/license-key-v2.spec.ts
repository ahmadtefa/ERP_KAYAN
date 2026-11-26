import { generateKeyPairSync } from 'node:crypto';
import {
  LicenseKeyError, LicensePayloadV2, signPayload, signPayloadV2, splitKey, verifyKey, verifyKeyV2,
} from './license-key';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
const base: LicensePayloadV2 = {
  v: 2, keyId: '11111111-1111-4111-8111-111111111111', type: 'COMPANY_ACTIVATION',
  licenseId: '22222222-2222-4222-8222-222222222222', machineId: null,
  issuedAt: '2026-11-26T00:00:00.000Z', term: { kind: 'MONTHS', months: 12 }, seats: { mode: 'CAP', value: 5 },
  companyRef: 'company-ref-0001', displayLabel: null, state: null, note: null,
};
const MACHINE = process.env.TEST_MACHINE_ID;
const withMachine = (o: Partial<LicensePayloadV2> = {}): LicensePayloadV2 => ({ ...base, machineId: validMachine(), ...o });
function validMachine(): string {
  // Build a value the product's own pattern accepts by trying the documented shape.
  return MACHINE ?? 'ABCD-EFGH-IJKL-MNOP';
}

describe('KYN2 company keys (additive, format 1 untouched)', () => {
  it('verifies a COMPANY_ACTIVATION key and carries companyRef', () => {
    const key = signPayloadV2(withMachine(), privateKey);
    const parsed = verifyKeyV2(key, publicKey);
    expect(parsed.payload.type).toBe('COMPANY_ACTIVATION');
    expect(parsed.payload.companyRef).toBe('company-ref-0001');
  });
  it('rejects a wrong signer, an altered payload and a missing companyRef', () => {
    const key = signPayloadV2(withMachine(), other.privateKey);
    expect(() => verifyKeyV2(key, publicKey)).toThrow(/signature/);
    const good = signPayloadV2(withMachine(), privateKey).split('.');
    const edited = JSON.parse(Buffer.from(good[1], 'base64url').toString());
    edited.companyRef = 'company-ref-9999';
    expect(() => verifyKeyV2(`${good[0]}.${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${good[2]}`, publicKey)).toThrow(/signature/);
    expect(() => verifyKeyV2(signPayloadV2({ ...withMachine(), companyRef: '' } as any, privateKey), publicKey)).toThrow(LicenseKeyError);
  });
  it('requires activation fields for a company activation (machine, term, seat limit)', () => {
    expect(() => verifyKeyV2(signPayloadV2(withMachine({ machineId: null }), privateKey), publicKey)).toThrow(/machine/);
    expect(() => verifyKeyV2(signPayloadV2(withMachine({ term: null }), privateKey), publicKey)).toThrow(/term/);
    expect(() => verifyKeyV2(signPayloadV2(withMachine({ seats: null }), privateKey), publicKey)).toThrow(/seat/);
  });
  it('the format 1 reader refuses every KYN2 key cleanly and never misreads it', () => {
    const key = signPayloadV2(withMachine(), privateKey);
    expect(() => verifyKey(key, publicKey)).toThrow(/not a KAYAN licence key/);
    expect(() => splitKey(key)).toThrow(LicenseKeyError);
  });
  it('the format 2 reader refuses a KYN1 key', () => {
    const v1 = signPayload({
      v: 1, keyId: base.keyId, type: 'ACTIVATION', licenseId: base.licenseId, machineId: validMachine(),
      issuedAt: base.issuedAt, term: base.term, seats: base.seats, state: null, note: null,
    }, privateKey);
    expect(() => verifyKeyV2(v1, publicKey)).toThrow(/format 2/);
  });
  it('rejects control characters and long labels in displayLabel', () => {
    expect(() => verifyKeyV2(signPayloadV2(withMachine({ displayLabel: 'a\nb' }), privateKey), publicKey)).toThrow(/displayLabel/);
    expect(() => verifyKeyV2(signPayloadV2(withMachine({ displayLabel: 'x'.repeat(81) }), privateKey), publicKey)).toThrow(/displayLabel/);
    expect(verifyKeyV2(signPayloadV2(withMachine({ displayLabel: 'Example Co' }), privateKey), publicKey).payload.displayLabel).toBe('Example Co');
  });
  it('a RENEWAL for a company needs companyRef too', () => {
    const renewal = withMachine({ type: 'RENEWAL', machineId: null, seats: null });
    expect(verifyKeyV2(signPayloadV2(renewal, privateKey), publicKey).payload.type).toBe('RENEWAL');
    expect(() => verifyKeyV2(signPayloadV2({ ...renewal, companyRef: undefined } as any, privateKey), publicKey)).toThrow(/companyRef/);
  });
});
