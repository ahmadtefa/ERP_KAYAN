import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('both installer key comparisons use the built-in SHA-256 helper', async () => {
  const source = await readFile(new URL('../distribution/windows/install-runtime.ps1', import.meta.url), 'utf8');
  assert.match(source, /function Get-KayanFileSha256\(\[string\]\$Path\)/);
  assert.match(source, /\$incomingKeyHash = Get-KayanFileSha256 \$incomingKey/);
  assert.match(source, /\$installedKeyHash = Get-KayanFileSha256 \$installedKey/);
  assert.match(source, /\(Get-KayanFileSha256 \$source\) -ne \(Get-KayanFileSha256 \$target\)/);
  assert.doesNotMatch(source, /\(Get-FileHash\s/);
});

// Windows PowerShell 5.1 is the same host invoked by Inno Setup. This test
// executes only the real script's preflight prefix against disposable paths:
// it must never start services, configure databases or write signing keys.
test('Windows PowerShell preflight compares installed keys without Get-FileHash', { skip: process.platform !== 'win32' }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'kayan-key-preflight-'));
  try {
    const source = await readFile(new URL('../distribution/windows/install-runtime.ps1', import.meta.url), 'utf8');
    const split = source.indexOf("$bootstrapLog = Join-Path");
    assert.ok(split > 0);
    const app = join(base, 'app');
    const data = join(base, 'program-data');
    const license = join(data, 'license');
    await mkdir(app, { recursive: true });
    await mkdir(join(data, 'logs'), { recursive: true });
    const script = join(app, 'preflight.ps1');
    await writeFile(script, source.slice(0, split) + "\nWrite-Output 'PREFLIGHT_OK'\n");
    await writeFile(join(app, 'runtime-manifest.json'), JSON.stringify({ licenseBuildKind: 'product' }));
    const key = await readFile(new URL('../distribution/windows/public-key.pem', import.meta.url));
    await writeFile(join(app, 'public-key.pem'), key);
    const wrapper = join(base, 'wrapper.ps1');
    await writeFile(wrapper, "function Get-FileHash { throw 'Get-FileHash must not be called' }\n& $env:KAYAN_PROBE_SCRIPT -UserSettingsPath $env:KAYAN_PROBE_SETTINGS -ProgramDataRoot $env:KAYAN_PROBE_DATA\n");
    function run() {
      return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapper], {
        encoding: 'utf8', timeout: 30000,
        env: { ...process.env, KAYAN_PROBE_SCRIPT: script, KAYAN_PROBE_SETTINGS: join(base, 'settings.env'), KAYAN_PROBE_DATA: data },
      });
    }
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PREFLIGHT_OK/);
    await mkdir(license);
    const installed = join(license, 'public-key.pem');
    await writeFile(installed, key);
    const state = join(license, 'license-state.json');
    await writeFile(state, 'synthetic state that must remain untouched');
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PREFLIGHT_OK/);

    const different = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
    await writeFile(installed, different);
    result = run();
    assert.notEqual(result.status, 0);
    assert.match(await readFile(join(data, 'logs', 'installer-result.txt'), 'utf8'), /public-key-comparison/);
    assert.equal(await readFile(installed, 'utf8'), different);
    assert.equal(await readFile(state, 'utf8'), 'synthetic state that must remain untouched');

    await rm(installed);
    result = run();
    assert.notEqual(result.status, 0);
    assert.match(await readFile(join(data, 'logs', 'installer-result.txt'), 'utf8'), /existing-key-absent/);
    assert.equal(await readFile(state, 'utf8'), 'synthetic state that must remain untouched');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
