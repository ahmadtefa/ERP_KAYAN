'use strict';
// Extra defence only for the reviewed, non-HMAC Jest suite. Do not preload
// this on PostgreSQL or other protocols that use synthetic test credentials.
// This is not a sandbox: WebCrypto/native code/child programs may bypass it.
require('./ci-no-signing.cjs');
const crypto = require('node:crypto');
const { syncBuiltinESMExports } = require('node:module');
for (const name of ['createSecretKey', 'createHmac']) {
  crypto[name] = function () { throw new Error(`CI policy forbids ${name}; HMAC licence tests require an approved isolated VM`); };
}
syncBuiltinESMExports();
