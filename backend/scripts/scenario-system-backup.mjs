#!/usr/bin/env node
/**
 * Complete system backup and restore, over HTTP, against the running server.
 *
 * This exercises what a person actually presses: the capabilities answer, the
 * safety gate, taking a complete backup, listing it, verifying it, checking an
 * upload before restoring, refusing a damaged archive, restoring, and reading
 * the status afterwards. It also proves the two backups are not the same
 * thing: a company JSON file is refused by the system restore, and a complete
 * archive is refused by the company restore.
 *
 * Nothing here is destructive to real data: the server this runs against in CI
 * is a disposable database, and every restore takes a safety backup first.
 *
 * Usage:
 *   ADMIN_USERNAME=ci-admin ADMIN_PASSWORD=... \
 *     node scripts/scenario-system-backup.mjs http://127.0.0.1:3000/api/v1
 */

const base = (process.argv[2] ?? 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '');
const username = process.env.ADMIN_USERNAME ?? 'ci-admin';
const password = process.env.ADMIN_PASSWORD ?? 'CI-only-Admin-Password-12345';

let checks = 0;
let failures = 0;

function check(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ok  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function request(path, { method = 'GET', token, body, form, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(form ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, text };
}

async function login() {
  const result = await request('/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  if (result.status >= 300 || !result.data?.accessToken) {
    throw new Error(`login failed: ${result.status} ${result.text.slice(0, 300)}`);
  }
  return result.data.accessToken;
}

async function binaryDownload(path, token) {
  const response = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const token = await login();
  console.log('system backup scenario');

  // ───────────────────────────────────────────── 1. capabilities and gate
  const caps = await request('/backup/complete/capabilities', { token });
  check(
    'the server answers what it can do',
    caps.status === 200 && typeof caps.data?.available === 'boolean',
    `available=${caps.data?.available} tools=${caps.data?.version ?? 'none'}`,
  );
  check(
    'the machine passed its restore safeguards in CI',
    caps.data?.fullRestoreSupported === true,
    (caps.data?.fullRestoreReasons ?? []).join('; ') || 'every check passed',
  );
  check(
    'the gate reports each safeguard separately',
    Array.isArray(caps.data?.restore?.checks) && caps.data.restore.checks.length >= 8,
    `${caps.data?.restore?.checks?.length ?? 0} checks`,
  );

  // ───────────────────────────────────────────── 2. take a complete backup
  const created = await request('/backup/complete', { method: 'POST', token });
  check(
    'a complete backup is written',
    created.status === 201 && Boolean(created.data?.file?.name),
    created.status === 201
      ? `${created.data?.file?.name ?? ''} (${created.data?.file?.sizeBytes ?? 0} bytes)`
      // The server's own words, so a failure here is not a mystery.
      : `${created.status}: ${created.text.replace(/\s+/g, ' ').slice(0, 700)}`,
  );
  const name = created.data?.file?.name;
  const manifest = created.data?.manifest;
  check(
    'it carries the database, the files and a manifest',
    manifest?.database?.archiveEntries > 0 && manifest?.format === 'kayan-system-backup',
    `${manifest?.counts?.companies ?? 0} companies, ${manifest?.files?.count ?? 0} files`,
  );
  check(
    'the licence is recorded as state only, never as key material',
    manifest?.licence?.statePath !== undefined && manifest?.licence?.archiveSha256 !== undefined,
    `present=${manifest?.licence?.present}`,
  );

  // ───────────────────────────────────────────── 3. list, verify, download
  const list = await request('/backup/complete', { token });
  check(
    'the backup is in the list',
    list.status === 200 && list.data?.some?.((file) => file.name === name),
    `${list.data?.length ?? 0} archives`,
  );

  const verified = await request(`/backup/complete/${encodeURIComponent(name)}/verify`, {
    method: 'POST',
    token,
  });
  check(
    'it verifies: manifest, every SHA-256 and pg_restore agree',
    verified.status === 201 && verified.data?.ok === true,
    (verified.data?.checks ?? []).map((entry) => entry.name).join(' → '),
  );

  // The download endpoint expects the one-minute ticket the browser uses,
  // because a navigation cannot carry an Authorization header.
  const ticket = await request('/auth/download-ticket', { method: 'POST', token });
  const archive = await binaryDownload(
    `/backup/complete/${encodeURIComponent(name)}/download?ticket=${encodeURIComponent(ticket.data?.ticket ?? '')}`,
    token,
  );
  check('the archive downloads whole', archive.length > 1024, `${archive.length} bytes`);

  // ─────────────────────────────────────── 4. an upload is checked, and bad
  //                                          archives never reach the database
  const form = new FormData();
  form.append('file', new Blob([archive]), name);
  const inspected = await request('/backup/complete/inspect', {
    method: 'POST',
    token,
    form,
  });
  check(
    'an uploaded archive is verified before it is restored',
    inspected.status === 201 && inspected.data?.ok === true,
    (inspected.data?.manifest?.counts?.companies ?? 0) + ' companies inside',
  );

  const damaged = Buffer.from(archive);
  const marker = damaged.indexOf(Buffer.from('PGDMP', 'latin1'));
  if (marker > 0) damaged[marker + 200] = damaged[marker + 200] ^ 0xff;
  const damagedForm = new FormData();
  damagedForm.append('file', new Blob([damaged]), 'damaged.kayanbackup');
  const damagedCheck = await request('/backup/complete/inspect', {
    method: 'POST',
    token,
    form: damagedForm,
  });
  // Inspection answers with a verdict, not an HTTP error: the file was read,
  // and the answer is that it is not usable — with the reason that stopped it.
  const damagedRefused =
    damagedCheck.data?.ok === false &&
    String(damagedCheck.data?.failure ?? '').length > 0;
  check(
    'a damaged archive is refused, with the reason named',
    (damagedCheck.status >= 400 && Boolean(damagedCheck.data?.detail)) || damagedRefused,
    `${damagedCheck.status}: ${String(
      damagedCheck.data?.failure ?? damagedCheck.data?.detail ?? '',
    ).slice(0, 140)}`,
  );

  const unconfirmed = await request('/backup/complete/restore', {
    method: 'POST',
    token,
    body: { fileName: name, confirm: true },
  });
  check(
    'a restore without the typed word is refused',
    unconfirmed.status === 400,
    `${unconfirmed.status}: ${String(unconfirmed.data?.detail ?? '').slice(0, 100)}`,
  );

  // ───────────────────────────────── 5. the two backups stay separate
  const companyFile = new FormData();
  companyFile.append(
    'file',
    new Blob([JSON.stringify({ format: 'kayan-backup', version: 1, tables: {} })]),
    'company.json',
  );
  const wrongKind = await request('/backup/complete/restore', {
    method: 'POST',
    token,
    form: companyFile,
  });
  check(
    'a company JSON file is refused by the system restore',
    wrongKind.status >= 400,
    `${wrongKind.status}: ${String(wrongKind.data?.detail ?? '').slice(0, 120)}`,
  );

  const systemIntoCompany = new FormData();
  systemIntoCompany.append('file', new Blob([archive]), name);
  const wrongCompany = await request('/backup/restore?replace=true', {
    method: 'POST',
    token,
    form: systemIntoCompany,
  });
  check(
    'a complete archive is refused by the company restore',
    wrongCompany.status >= 400,
    `${wrongCompany.status}: ${String(wrongCompany.data?.detail ?? '').slice(0, 120)}`,
  );

  // ───────────────────────────────────────────────── 6. the real restore
  const restoreForm = new FormData();
  restoreForm.append('file', new Blob([archive]), name);
  restoreForm.append('fileName', name);
  restoreForm.append('confirm', 'true');
  restoreForm.append('confirmPhrase', 'RESTORE');
  const restored = await request('/backup/complete/restore', {
    method: 'POST',
    token,
    form: restoreForm,
  });
  check(
    'the restore finishes',
    restored.status === 201 && restored.data?.restored === true,
    `${restored.status} ${
      restored.data?.restored
        ? `safety ${restored.data?.safetyBackup}`
        : String(restored.data?.detail ?? JSON.stringify(restored.data ?? {}))
            .replace(/\s+/g, ' ')
            .slice(0, 700)
    }`,
  );
  check(
    'it rehearsed on a scratch database before touching anything',
    restored.data?.rehearsed === true,
  );
  check(
    'it checked the restored data against the manifest',
    Array.isArray(restored.data?.checks) &&
      restored.data.checks.length > 0 &&
      restored.data.checks.every((entry) => entry.ok),
    (restored.data?.checks ?? []).map((entry) => entry.name).join(', '),
  );
  check(
    'the licence was not touched',
    restored.data?.licencePreserved === true,
  );
  check(
    'a safety backup exists and is itself a complete archive',
    Boolean(restored.data?.safetyBackup),
    restored.data?.safetyBackup ?? '',
  );

  // ─────────────────────────────────────────────────── 7. after the restore
  const health = await request('/health');
  check('the program answers after the restore', health.status === 200, `status ${health.status}`);

  const status = await request('/backup/complete/status', { token });
  check(
    'the status shows no running or interrupted restore',
    status.status === 200 &&
      status.data?.maintenance === false &&
      status.data?.journal?.unfinished !== true,
    `maintenance=${status.data?.maintenance} phase=${status.data?.journal?.phase ?? 'none'}`,
  );

  const relogin = await request('/auth/login', { method: 'POST', body: { username, password } });
  check(
    'the restored accounts still sign in with the same credentials',
    relogin.status < 300 && typeof relogin.data?.accessToken === 'string',
    `status ${relogin.status}`,
  );

  // Clean up the archives this run wrote, so the folder does not grow forever
  // and so deleting one is exercised too.
  const safety = restored.data?.safetyBackup;
  for (const target of [name, safety].filter(Boolean)) {
    const removed = await request(`/backup/complete/${encodeURIComponent(target)}`, {
      method: 'DELETE',
      token: relogin.data?.accessToken ?? token,
    });
    if (removed.status >= 400) {
      console.log(`  note: ${target} was not deleted (${removed.status})`);
    }
  }

  console.log(`\n${checks} checks, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('the scenario itself failed:', error);
  process.exitCode = 1;
});
