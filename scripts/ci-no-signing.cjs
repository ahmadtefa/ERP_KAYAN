'use strict';
// Defense in depth for explicitly reviewed non-signing CI tests. This is NOT
// an OS sandbox: native addons, WebCrypto, subprocesses without NODE_OPTIONS,
// and tools in other languages are not contained. Never use this to authorize
// unreviewed code, production secrets, or a real licence/signature test.
const crypto = require('node:crypto');
const { syncBuiltinESMExports } = require('node:module');
for (const name of ['generateKeyPair', 'generateKeyPairSync', 'createPrivateKey', 'sign', 'createSign']) {
  crypto[name] = function () { throw new Error(`CI policy forbids ${name}; signing tests require the approved isolated VM`); };
}
syncBuiltinESMExports();
