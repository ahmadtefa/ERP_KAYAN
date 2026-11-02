// Verify the configured signing key without logging or writing it. This signs
// only random bytes, not a licence, and leaves all application data untouched.
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, timingSafeEqual, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

// This check proves private-key possession and is restricted to operator
// machines; never ask CI to receive even an ephemeral private signing key.
if (process.env.CI || process.env.GITHUB_ACTIONS) {
  console.error('Private-key pair verification is forbidden in CI.');
  process.exit(1);
}

const expected = '9153e15e475ba2e2251a7e40d8eb58559006bbba2923ee8ba564d8d59cc602c4';
try {
  const publicKey = createPublicKey(readFileSync('distribution/windows/public-key.pem'));
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  if (createHash('sha256').update(publicDer).digest('hex') !== expected) {
    console.error('Configured public key fingerprint is not the approved fingerprint.');
    process.exitCode = 1;
  } else if (!process.env.KAYAN_LICENCE_PRIVATE_KEY) {
    console.error('KAYAN_LICENCE_PRIVATE_KEY is not available to this workflow.');
    process.exitCode = 1;
  } else {
    const privateKey = createPrivateKey(process.env.KAYAN_LICENCE_PRIVATE_KEY);
    const derivedDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
    const challenge = randomBytes(32);
    const signature = sign(null, challenge, privateKey);
    if (derivedDer.length !== publicDer.length || !timingSafeEqual(derivedDer, publicDer) || !verify(null, challenge, publicKey, signature)) {
      console.error('Configured private key does not match the approved public key.');
      process.exitCode = 1;
    } else {
      console.log('Approved public key and configured private key match; random challenge verified in memory.');
    }
  }
} catch {
  // Do not print exception objects: crypto/provider errors can contain input.
  console.error('Could not safely verify the configured Ed25519 key pair.');
  process.exitCode = 1;
}
