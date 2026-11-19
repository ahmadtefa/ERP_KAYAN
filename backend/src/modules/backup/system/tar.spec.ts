import { mkdtemp, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  TarWriter,
  assertSafeArchiveName,
  extractTar,
  listTar,
  readTarTextEntries,
  verifyTarArchive,
} from './tar';

/// The archive format is the one thing in the backup system that a later
/// version must still be able to read, so it is pinned here on real files:
/// names with spaces and Arabic letters, long paths, an entry the manifest
/// promises and one it does not, an archive that was cut short, and a name
/// that tries to escape the staging folder.

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'kayan-tar-'));
}

describe('TAR archive', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await scratch();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes and reads back the bytes exactly, with a SHA-256 per entry', async () => {
    const big = Buffer.alloc(5000, 7);
    const text = Buffer.from('ملف عربي — English text', 'utf8');
    const source = join(dir, 'source.bin');
    await writeFile(source, big);

    const path = join(dir, 'backup.kayanbackup');
    const writer = await TarWriter.create(path);
    await writer.add({ name: 'manifest.json', data: Buffer.from('{"a":1}') });
    await writer.add({ name: 'files/uploads/شعار الشركة.png', data: text });
    await writer.add({ name: `files/uploads/${'deep/'.repeat(30)}file.bin`, path: source });
    await writer.close();

    const listing = await listTar(path);
    expect(listing.entries.map((entry) => entry.name)).toEqual([
      'manifest.json',
      'files/uploads/شعار الشركة.png',
      `files/uploads/${'deep/'.repeat(30)}file.bin`,
    ]);

    const extracted = await extractTar(path, join(dir, 'out'));
    expect(extracted).toHaveLength(3);
    expect(await readFile(join(dir, 'out', 'files/uploads/شعار الشركة.png'), 'utf8')).toBe(
      'ملف عربي — English text',
    );
    const longName = `files/uploads/${'deep/'.repeat(30)}file.bin`;
    expect((await stat(join(dir, 'out', longName))).size).toBe(5000);
    expect(writer.digests.get(longName)?.sha256).toHaveLength(64);
  });

  it('reads the manifest without walking a large archive to its end', async () => {
    const path = join(dir, 'backup.kayanbackup');
    const writer = await TarWriter.create(path);
    await writer.add({ name: 'manifest.json', data: Buffer.from('{"format":"kayan"}') });
    await writer.add({ name: 'checksums.sha256', data: Buffer.from('a  b\n') });
    await writer.add({ name: 'database/database.dump', data: Buffer.alloc(200_000, 3) });
    await writer.close();

    const texts = await readTarTextEntries(path, ['manifest.json', 'checksums.sha256']);
    expect(texts.get('manifest.json')).toBe('{"format":"kayan"}');
    expect(texts.get('checksums.sha256')).toBe('a  b\n');
  });

  it('refuses an entry whose name escapes the archive root', async () => {
    const path = join(dir, 'evil.kayanbackup');
    const writer = await TarWriter.create(path);
    await expect(writer.add({ name: '../../etc/passwd', data: Buffer.from('x') })).rejects.toThrow(
      /escapes the archive root/,
    );
    await writer.close();

    expect(() => assertSafeArchiveName('/absolute')).toThrow(/absolute/);
    expect(() => assertSafeArchiveName('C:/windows')).toThrow(/absolute/);
    expect(() => assertSafeArchiveName('a\\b')).toThrow(/forward slashes/);
  });

  it('refuses a corrupted header rather than guessing', async () => {
    const path = join(dir, 'backup.kayanbackup');
    const writer = await TarWriter.create(path);
    await writer.add({ name: 'manifest.json', data: Buffer.from('{}') });
    await writer.close();

    // Change one byte of the name inside the first header: the checksum no
    // longer matches, which is exactly how a damaged archive is caught.
    const bytes = await readFile(path);
    bytes[0] = 'X'.charCodeAt(0);
    await writeFile(path, bytes);

    await expect(listTar(path)).rejects.toThrow(/checksum mismatch/);
  });

  it('refuses an archive that was cut off mid-file', async () => {
    const path = join(dir, 'backup.kayanbackup');
    const writer = await TarWriter.create(path);
    await writer.add({ name: 'database/database.dump', data: Buffer.alloc(4096, 9) });
    await writer.close();

    const full = await stat(path);
    await truncate(path, Math.floor(full.size / 2));

    await expect(extractTar(path, join(dir, 'out'))).rejects.toThrow(/ended inside|holds no files/);
  });

  it('verifies every entry against the hashes a manifest promises', async () => {
    const path = join(dir, 'backup.kayanbackup');
    const writer = await TarWriter.create(path);
    await writer.add({ name: 'database/database.dump', data: Buffer.from('PGDMP-payload') });
    await writer.add({ name: 'settings/settings.json', data: Buffer.from('{"a":1}') });
    await writer.close();

    const dumpDigest = writer.digests.get('database/database.dump');
    const settingsDigest = writer.digests.get('settings/settings.json');
    const expected = new Map([
      ['database/database.dump', { sha256: dumpDigest?.sha256 as string }],
      ['settings/settings.json', { sha256: settingsDigest?.sha256 as string }],
    ]);
    await expect(verifyTarArchive(path, expected)).resolves.toMatchObject({ checked: 2 });

    expected.set('settings/settings.json', { sha256: 'a'.repeat(64) });
    await expect(verifyTarArchive(path, expected)).rejects.toThrow(/does not match/);

    expected.delete('settings/settings.json');
    expected.set('missing.json', { sha256: 'a'.repeat(64) });
    await expect(verifyTarArchive(path, expected)).rejects.toThrow(/does not contain/);
  });
});
