import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as codec from './license-key';
import { LicenseKeyError, ParsedLicenseKey } from './license-key';
import { LEGACY_VERIFIER_SHA256, NEW_VERIFIER_SHA256, PublicLicenseKeyring } from './license-keyring';

// This suite verifies pinned public-key loading and control flow with a mocked
// verifier. No key is generated, no licence is signed, and no real signature
// is verified. Cryptographic compatibility remains an approved-VM test.
const oldPem = readFileSync(resolve(__dirname, '../../../../distribution/windows/public-key.pem'), 'utf8');
const newPem = readFileSync(resolve(__dirname, '../../../../distribution/windows/public-key-next.pem'), 'utf8');

const sample = { payload: {}, payloadJson: '{}', signature: '', signedText: '' } as ParsedLicenseKey;

describe('candidate public licence keyring (not integrated)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('requires the approved legacy and new public keys in their designated slots', () => {
    expect(() => PublicLicenseKeyring.fromPinnedPem(oldPem, newPem)).not.toThrow();
    expect(() => PublicLicenseKeyring.fromPinnedPem(newPem, oldPem)).toThrow(LicenseKeyError);
    expect(() => PublicLicenseKeyring.fromPinnedPem(oldPem, oldPem)).toThrow(LicenseKeyError);
    expect(() => PublicLicenseKeyring.fromPinnedPem('', newPem)).toThrow(LicenseKeyError);
    expect(() => PublicLicenseKeyring.fromPinnedPem('-----BEGIN PRIVATE KEY-----', newPem)).toThrow(LicenseKeyError);
  });

  it('returns the signer identity when the first verifier accepts', () => {
    const verify = jest.spyOn(codec, 'verifyKey').mockReturnValue(sample);
    const result = PublicLicenseKeyring.fromPinnedPem(oldPem, newPem).verify('untrusted input');
    expect(result).toEqual({ parsed: sample, signerSha256: LEGACY_VERIFIER_SHA256 });
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('tries the new verifier only for a bad signature and returns its identity', () => {
    const verify = jest.spyOn(codec, 'verifyKey')
      .mockImplementationOnce(() => { throw new LicenseKeyError('bad', 'BAD_SIGNATURE'); })
      .mockReturnValueOnce(sample);
    const result = PublicLicenseKeyring.fromPinnedPem(oldPem, newPem).verify('untrusted input');
    expect(result).toEqual({ parsed: sample, signerSha256: NEW_VERIFIER_SHA256 });
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('refuses when neither verifier matches and does not echo the input', () => {
    jest.spyOn(codec, 'verifyKey').mockImplementation(() => { throw new LicenseKeyError('bad', 'BAD_SIGNATURE'); });
    try {
      PublicLicenseKeyring.fromPinnedPem(oldPem, newPem).verify('untrusted input');
      throw new Error('an invalid input was accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(LicenseKeyError);
      expect((error as LicenseKeyError).code).toBe('BAD_SIGNATURE');
      expect(String(error)).not.toContain('untrusted input');
    }
  });

  it('does not swallow malformed input or unexpected verifier failures', () => {
    const malformed = new LicenseKeyError('malformed', 'MALFORMED');
    const verify = jest.spyOn(codec, 'verifyKey').mockImplementation(() => { throw malformed; });
    expect(() => PublicLicenseKeyring.fromPinnedPem(oldPem, newPem).verify('x')).toThrow(malformed);
    expect(verify).toHaveBeenCalledTimes(1);
    const unexpected = new Error('unexpected');
    verify.mockImplementation(() => { throw unexpected; });
    expect(() => PublicLicenseKeyring.fromPinnedPem(oldPem, newPem).verify('x')).toThrow(unexpected);
    expect(verify).toHaveBeenCalledTimes(2);
  });
});
