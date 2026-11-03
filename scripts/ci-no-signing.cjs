'use strict';
// Defense in depth for the explicitly listed non-signing CI tests. This is not
// an OS sandbox: never use it to authorize unreviewed tests or child programs.
const crypto = require('node:crypto');
const { syncBuiltinESMExports } = require('node:module');
for (const name of ['generateKeyPair', 'generateKeyPairSync', 'createPrivateKey', 'sign', 'createSign']) {
  crypto[name] = function () { throw new Error(`CI policy forbids ${name}; signing tests require the approved isolated VM`); };
}
syncBuiltinESMExports();
