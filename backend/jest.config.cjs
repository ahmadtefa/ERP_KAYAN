/*
 * Jest configuration.
 *
 * In a normal environment `prisma generate` has produced a real client and this
 * file behaves exactly like the "jest" block in package.json.
 *
 * When the generated client is missing (for example an offline sandbox that
 * cannot download the Prisma schema engine from binaries.prisma.sh), the
 * placeholder client under node_modules/.prisma/client has no Prisma.Decimal.
 * In that case only, "@prisma/client" is mapped to a test-only runtime shim and
 * ts-jest runs in transpile-only mode. The suite never opens a database, so it
 * only needs the runtime value exports; full type checking still runs in CI on
 * the real generated client.
 */
'use strict';

function realGeneratedClientIsPresent() {
  try {
    // eslint-disable-next-line global-require
    const client = require('@prisma/client');
    return Boolean(client && client.Prisma && client.Prisma.Decimal);
  } catch {
    return false;
  }
}

const useShim = !realGeneratedClientIsPresent();

const baseConfig = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  testEnvironment: 'node',
};

if (!useShim) {
  module.exports = {
    ...baseConfig,
    transform: {
      '^.+\\.(t|j)s$': 'ts-jest',
    },
  };
} else {
  module.exports = {
    ...baseConfig,
    moduleNameMapper: {
      '^@prisma/client$': '<rootDir>/../jest-prisma-shim.cjs',
    },
    transform: {
      '^.+\\.(t|j)s$': [
        'ts-jest',
        {
          // Transpile only: the shim does not carry the generated client's
          // type declarations. Runtime behaviour is still fully exercised.
          tsconfig: { isolatedModules: true },
          diagnostics: false,
        },
      ],
    },
  };
}
