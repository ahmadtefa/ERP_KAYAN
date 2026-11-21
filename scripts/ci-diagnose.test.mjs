import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const diagnostic = fileURLToPath(new URL('./ci-diagnose.py', import.meta.url));

test('CI diagnostic keeps Node assertion failures ahead of the log tail', () => {
  const result = spawnSync(
    'python3',
    [
      diagnostic,
      'node',
      '-e',
      "const assert = require('node:assert/strict'); assert.equal(1, 2);",
    ],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /--- failure lines ---[\s\S]*AssertionError/);
  assert.match(result.stdout, /at \[eval\]:\d+/);
});
