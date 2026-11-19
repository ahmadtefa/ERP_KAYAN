import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * A small, strict TAR reader and writer.
 *
 * Why a hand-written TAR instead of a zip: a complete backup is one file a
 * person may have to open by hand on a machine with nothing installed. TAR is
 * a 1979 byte layout that any archiver on any system reads, needs no
 * dependency, and — the part that matters here — lets the program write a
 * 500 MB database dump straight to disk without ever holding it in memory.
 *
 * The reader is deliberately unforgiving. An archive that claims to hold
 * `../../etc/passwd`, that lies about a size, or whose header checksum does
 * not match is not "mostly fine": it is refused before a single byte is
 * written outside the staging folder.
 */

const BLOCK = 512;

/// The bytes every TAR header starts — and ends — with. Used to tell a
/// truncated archive from a complete one.
export interface TarEntry {
  name: string;
  size: number;
  mode: number;
  mtimeSeconds: number;
  type: 'file' | 'directory';
}

export interface TarWriteEntry {
  /// The name inside the archive. Always relative, always forward slashes.
  name: string;
  /// The file on disk to take the bytes from.
  path?: string;
  /// Or bytes already in memory (the manifest, the checksum list).
  data?: Buffer;
  mode?: number;
  mtime?: Date;
  directory?: boolean;
}

export interface ExtractedEntry {
  name: string;
  bytes: number;
  sha256: string;
}

const MAX_ENTRIES = 100_000;
const MAX_SINGLE_ENTRY = 8 * 1024 * 1024 * 1024; // 8 GB

/// A name that may be written into an archive and later extracted on this
/// machine or on Windows: relative, no drive letters, no `..`, no control
/// characters, no backslashes.
export function assertSafeArchiveName(name: string): void {
  if (!name || name.length > 512) {
    throw new Error(`archive entry name is empty or too long`);
  }
  if (name.includes('\u0000') || /[\u0000-\u001f]/.test(name)) {
    throw new Error(`archive entry name "${name}" holds control characters`);
  }
  if (name.includes('\\')) {
    throw new Error(`archive entry name "${name}" must use forward slashes`);
  }
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    throw new Error(`archive entry name "${name}" is absolute`);
  }
  const parts = name.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`archive entry name "${name}" escapes the archive root`);
  }
}

/// Joins a validated archive name onto a destination folder and refuses the
/// result if it is not inside it. Belt and braces: the name was checked
/// above, and the resolved path is checked again here.
export function resolveInside(root: string, name: string): string {
  assertSafeArchiveName(name);
  const base = resolve(root);
  const target = resolve(base, name);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`archive entry "${name}" resolves outside ${root}`);
  }
  return target;
}

function octal(value: number, length: number): Buffer {
  const text = value.toString(8).padStart(length - 1, '0') + '\0';
  return Buffer.from(text, 'latin1');
}

function putString(header: Buffer, offset: number, length: number, value: string): void {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > length) throw new Error(`field "${value}" does not fit in the header`);
  bytes.copy(header, offset);
}

function splitName(name: string): { name: string; prefix: string } {
  if (Buffer.byteLength(name, 'utf8') <= 100) return { name, prefix: '' };
  // ustar allows 155 (prefix) + 100 (name), split at a slash so the two
  // halves are two real paths and the last component stays in `name`.
  const chars = [...name];
  for (let index = chars.length - 1; index > 0; index -= 1) {
    if (chars[index - 1] !== '/') continue;
    const head = chars.slice(0, index - 1).join('');
    const tail = chars.slice(index).join('');
    if (Buffer.byteLength(head, 'utf8') <= 155 && Buffer.byteLength(tail, 'utf8') <= 100) {
      return { name: tail, prefix: head };
    }
  }
  throw new Error(
    `archive entry name "${name}" cannot be split into a TAR header (a single path component is too long)`,
  );
}

function buildHeader(entry: TarWriteEntry, size: number): Buffer {
  const header = Buffer.alloc(BLOCK, 0);
  const { name, prefix } = splitName(entry.name);
  putString(header, 0, 100, name);
  octal(entry.mode ?? (entry.directory ? 0o755 : 0o644), 8).copy(header, 100);
  octal(0, 8).copy(header, 108); // uid
  octal(0, 8).copy(header, 116); // gid
  octal(size, 12).copy(header, 124);
  const mtime = Math.floor((entry.mtime ?? new Date()).getTime() / 1000);
  octal(mtime, 12).copy(header, 136);
  header.fill(32, 148, 156); // checksum placeholder: eight spaces
  header.write(entry.directory ? '5' : '0', 156, 'latin1');
  putString(header, 257, 6, 'ustar\0');
  putString(header, 263, 2, '00');
  if (prefix) putString(header, 345, 155, prefix);

  let sum = 0;
  for (const byte of header) sum += byte;
  const checksum = sum.toString(8).padStart(6, '0') + '\0 ';
  header.write(checksum, 148, 'latin1');
  return header;
}

/**
 * Writes a TAR archive file by file, computing each entry's SHA-256 while its
 * bytes pass through. The digest is what the manifest promises, so it is
 * produced from the exact bytes that went to disk rather than from a second
 * read that could differ.
 */
export class TarWriter {
  private constructor(
    private readonly handle: Awaited<ReturnType<typeof open>>,
    private readonly path: string,
  ) {}

  private written = 0;
  readonly digests = new Map<string, { sha256: string; bytes: number }>();
  private entryCount = 0;

  static async create(path: string): Promise<TarWriter> {
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, 'w');
    return new TarWriter(handle, path);
  }

  /**
   * Writes one chunk at the current position and waits until every byte of it
   * is on disk. `FileHandle.write` may accept less than a whole chunk; treating
   * that as success would leave a hole in the archive while its size still
   * looked right — an archive that fails its own checksum, or worse, one that
   * passes a size check and restores garbage.
   */
  private async write(chunk: Buffer): Promise<void> {
    let offset = 0;
    while (offset < chunk.length) {
      const { bytesWritten } = await this.handle.write(
        chunk,
        offset,
        chunk.length - offset,
        this.written,
      );
      if (!bytesWritten || bytesWritten <= 0) {
        throw new Error('the archive file accepted no bytes; the disk may be full');
      }
      offset += bytesWritten;
      this.written += bytesWritten;
    }
  }

  async add(entry: TarWriteEntry): Promise<void> {
    assertSafeArchiveName(entry.name);
    this.entryCount += 1;
    if (this.entryCount > MAX_ENTRIES) {
      throw new Error('the archive holds more entries than this program accepts');
    }

    if (entry.directory) {
      const header = buildHeader(entry, 0);
      await this.write(header);
      return;
    }

    const info = entry.data ? null : await stat(entry.path as string);
    const size = entry.data ? entry.data.length : (info as { size: number }).size;
    if (size > MAX_SINGLE_ENTRY) {
      throw new Error(`"${entry.name}" is larger than a single archive entry may be`);
    }
    if (entry.data) {
      const sha256 = createHash('sha256').update(entry.data).digest('hex');
      this.digests.set(entry.name, { sha256, bytes: size });
      await this.write(buildHeader(entry, size));
      await this.write(entry.data);
      await this.pad(size);
      return;
    }

    await this.write(buildHeader(entry, size));
    const hash = createHash('sha256');
    let copied = 0;
    // A `for await` loop, not a `data` listener: a listener can hear `end`
    // while its last write is still in flight, and the padding for the entry
    // would then be written over the entry's own last bytes — an archive
    // whose size is right and whose content is quietly wrong. The loop does
    // not move on until the chunk it handed over is on disk.
    for await (const chunk of createReadStream(entry.path as string)) {
      const data = chunk as Buffer;
      hash.update(data);
      copied += data.length;
      await this.write(data);
    }
    if (copied !== size) {
      throw new Error(
        `"${entry.path}" changed while it was being archived ` +
          `(expected ${size} bytes, read ${copied})`,
      );
    }
    this.digests.set(entry.name, { sha256: hash.digest('hex'), bytes: size });
    await this.pad(size);
  }

  private async pad(size: number): Promise<void> {
    const remainder = size % BLOCK;
    if (remainder === 0) return;
    await this.write(Buffer.alloc(BLOCK - remainder, 0));
  }

  /// Two zero blocks close a TAR archive. Without them a reader cannot tell
  /// a finished archive from one whose last file was cut off.
  async close(): Promise<void> {
    await this.write(Buffer.alloc(BLOCK * 2, 0));
    await this.handle.sync();
    await this.handle.close();
  }
}

function readString(header: Buffer, offset: number, length: number): string {
  const slice = header.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
}

function readOctal(header: Buffer, offset: number, length: number): number {
  const text = readString(header, offset, length).trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error(`archive header holds a bad number "${text}"`);
  return parseInt(text, 8);
}

function verifyChecksum(header: Buffer): void {
  const stored = readOctal(header, 148, 8);
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    sum += index >= 148 && index < 156 ? 32 : header[index];
  }
  if (stored !== sum) {
    throw new Error('a TAR header in this archive is damaged (checksum mismatch)');
  }
}

export interface TarListing {
  entries: TarEntry[];
  totalBytes: number;
}

interface WalkedEntry extends TarEntry {
  sha256?: string;
}

interface WalkOptions {
  /// Write regular files here (created when missing). Entries not passing
  /// `only` are skipped without being read.
  extractRoot?: string;
  only?: (name: string) => boolean;
  /// Hash every file that is read, and refuse a file whose hash does not
  /// match what the caller expects.
  hash?: boolean;
  expected?: Map<string, { sha256: string; bytes?: number }>;
  /// Load these entries into memory instead of writing them (the manifest and
  /// the checksum list are small by construction).
  readText?: Set<string>;
  maxTotalBytes?: number;
  /// Stop after these names have been seen — used to read the manifest
  /// without walking a 500 MB archive to its end.
  stopAfter?: Set<string>;
}

interface WalkResult {
  entries: WalkedEntry[];
  texts: Map<string, Buffer>;
  totalBytes: number;
}

/**
 * The one place the TAR layout is parsed. Reading, listing, verifying and
 * extracting all come through here, so a change to the format cannot make one
 * of them disagree with the others about what an archive holds.
 */
async function walkTar(path: string, options: WalkOptions = {}): Promise<WalkResult> {
  const handle = await open(path, 'r');
  const entries: WalkedEntry[] = [];
  const texts = new Map<string, Buffer>();
  let totalBytes = 0;
  try {
    const info = await handle.stat();
    let position = 0;
    let longName: string | null = null;
    const limit = options.maxTotalBytes ?? 16 * 1024 * 1024 * 1024;
    const stopReached = (): boolean => {
      const wanted = options.stopAfter ?? options.readText;
      if (!wanted || wanted.size === 0) return false;
      for (const name of wanted) if (!texts.has(name)) return false;
      return true;
    };

    while (position + BLOCK <= info.size) {
      const header = Buffer.alloc(BLOCK);
      const read = await handle.read(header, 0, BLOCK, position);
      if (read.bytesRead < BLOCK) break;
      position += BLOCK;
      if (header.every((byte) => byte === 0)) break; // end-of-archive marker
      verifyChecksum(header);

      const rawName = readString(header, 0, 100);
      const prefix = readString(header, 345, 155);
      const size = readOctal(header, 124, 12);
      const type = String.fromCharCode(header[156]) || '0';
      const mtimeSeconds = readOctal(header, 136, 12);
      const mode = readOctal(header, 100, 8);

      // GNU long name: the real name travels in its own pseudo-entry.
      if (type === 'L') {
        const nameBytes = Buffer.alloc(size);
        await handle.read(nameBytes, 0, size, position);
        const end = nameBytes.indexOf(0);
        longName = nameBytes.subarray(0, end === -1 ? size : end).toString('utf8');
        position += Math.ceil(size / BLOCK) * BLOCK;
        continue;
      }
      // PAX headers carry metadata this format does not use.
      if (type === 'x' || type === 'g') {
        position += Math.ceil(size / BLOCK) * BLOCK;
        continue;
      }

      const fullName = longName ?? (prefix ? `${prefix}/${rawName}` : rawName);
      longName = null;

      if (type === '5') {
        position += Math.ceil(size / BLOCK) * BLOCK;
        continue;
      }
      if (type !== '0' && type !== '\u0000') {
        throw new Error(
          `the archive holds an entry of unsupported kind "${type}" ("${fullName}")`,
        );
      }

      assertSafeArchiveName(fullName);
      if (size > MAX_SINGLE_ENTRY) {
        throw new Error(`"${fullName}" is larger than a single archive entry may be`);
      }
      totalBytes += size;
      if (totalBytes > limit) {
        throw new Error(
          `the archive holds ${totalBytes} bytes, more than this program will process at once`,
        );
      }
      if (entries.length >= MAX_ENTRIES) {
        throw new Error('the archive holds more entries than this program accepts');
      }

      const wanted =
        (options.readText?.has(fullName) ?? false) ||
        (options.extractRoot !== undefined && (options.only ? options.only(fullName) : true));

      const entry: WalkedEntry = {
        name: fullName,
        size,
        mode,
        mtimeSeconds,
        type: 'file',
      };

      if (!wanted) {
        if (options.hash) {
          // Still hashed so a caller asking for "every file" gets every file;
          // existing files are read in chunks, never loaded whole.
          entry.sha256 = await hashRange(handle, position, size);
        }
        entries.push(entry);
        position += Math.ceil(size / BLOCK) * BLOCK;
        if (stopReached()) break;
        continue;
      }

      if (options.readText?.has(fullName)) {
        if (size > 8 * 1024 * 1024) {
          throw new Error(`"${fullName}" is larger than a metadata entry may be`);
        }
        const data = Buffer.alloc(size);
        await handle.read(data, 0, size, position);
        texts.set(fullName, data);
        entry.sha256 = createHash('sha256').update(data).digest('hex');
      } else {
        const target = resolveInside(options.extractRoot as string, fullName);
        await mkdir(dirname(target), { recursive: true });
        entry.sha256 = await writeRange(handle, position, size, target);
      }

      entries.push(entry);
      position += Math.ceil(size / BLOCK) * BLOCK;
      if (stopReached()) break;
    }

    if (entries.length === 0) throw new Error('the archive holds no files');

    if (options.expected) {
      for (const [name, expectation] of options.expected) {
        const found = entries.find((entry) => entry.name === name);
        if (!found) {
          throw new Error(`the archive does not contain "${name}"`);
        }
        if (found.sha256 !== expectation.sha256) {
          throw new Error(
            `"${name}" does not match the backup's own checksum. ` +
              'The archive is damaged; nothing was restored.',
          );
        }
        if (expectation.bytes !== undefined && found.size !== expectation.bytes) {
          throw new Error(`"${name}" is ${found.size} bytes but the manifest promised ${expectation.bytes}`);
        }
      }
    }

    return { entries, texts, totalBytes };
  } finally {
    await handle.close();
  }
}

async function hashRange(
  handle: Awaited<ReturnType<typeof open>>,
  offset: number,
  size: number,
): Promise<string> {
  const hash = createHash('sha256');
  let read = 0;
  while (read < size) {
    const want = Math.min(1024 * 1024, size - read);
    const chunk = Buffer.alloc(want);
    const got = await handle.read(chunk, 0, want, offset + read);
    if (got.bytesRead === 0) throw new Error('the archive ended inside a file');
    hash.update(chunk.subarray(0, got.bytesRead));
    read += got.bytesRead;
  }
  return hash.digest('hex');
}

async function writeRange(
  handle: Awaited<ReturnType<typeof open>>,
  offset: number,
  size: number,
  target: string,
): Promise<string> {
  const hash = createHash('sha256');
  const out = await open(target, 'w');
  try {
    let read = 0;
    while (read < size) {
      const want = Math.min(1024 * 1024, size - read);
      const chunk = Buffer.alloc(want);
      const got = await handle.read(chunk, 0, want, offset + read);
      if (got.bytesRead === 0) throw new Error('the archive ended inside a file');
      hash.update(chunk.subarray(0, got.bytesRead));
      await out.write(chunk.subarray(0, got.bytesRead), 0, got.bytesRead, read);
      read += got.bytesRead;
    }
    await out.sync();
  } finally {
    await out.close();
  }
  return hash.digest('hex');
}

/// Reads the table of contents without writing anything. Throws when the
/// archive is truncated, damaged or contains a name that may escape.
export async function listTar(path: string): Promise<TarListing> {
  const walked = await walkTar(path);
  return { entries: walked.entries, totalBytes: walked.totalBytes };
}

/// Loads named small entries (the manifest, the checksum list) into memory,
/// stopping as soon as they have been seen.
export async function readTarTextEntries(
  path: string,
  names: string[],
): Promise<Map<string, string>> {
  const wanted = new Set(names);
  const walked = await walkTar(path, { readText: wanted, stopAfter: wanted });
  const result = new Map<string, string>();
  for (const [name, data] of walked.texts) result.set(name, data.toString('utf8'));
  return result;
}

/// Hashes every file in the archive and checks the ones the caller expects,
/// without writing anything anywhere. This is the check a restore runs before
/// it is allowed near the database.
export async function verifyTarArchive(
  path: string,
  expected: Map<string, { sha256: string; bytes?: number }>,
): Promise<{ checked: number; totalBytes: number }> {
  const walked = await walkTar(path, { hash: true, expected });
  return { checked: walked.entries.length, totalBytes: walked.totalBytes };
}

/// Extracts an archive into `destination`, verifying every entry's SHA-256
/// against `expected` when the caller has a manifest. Nothing is written
/// outside `destination`.
export async function extractTar(
  path: string,
  destination: string,
  options: {
    expected?: Map<string, { sha256: string; bytes?: number }>;
    /// Only these entries (and everything under them) are written.
    only?: (name: string) => boolean;
    maxTotalBytes?: number;
  } = {},
): Promise<ExtractedEntry[]> {
  await mkdir(destination, { recursive: true });
  const walked = await walkTar(path, {
    extractRoot: destination,
    only: options.only,
    hash: true,
    expected: options.expected,
    maxTotalBytes: options.maxTotalBytes,
  });
  return walked.entries
    .filter((entry) => (options.only ? options.only(entry.name) : true))
    .map((entry) => ({ name: entry.name, bytes: entry.size, sha256: entry.sha256 as string }));
}

/// Writes a small text file — used for the archive's own instructions.
export async function fileDigest(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      bytes += chunk.length;
    });
    stream.on('error', reject);
    stream.on('end', () => resolvePromise());
  });
  return { sha256: hash.digest('hex'), bytes };
}

/// Convenience for tests and small files.
export async function writeTextFile(
  path: string,
  text: string,
): Promise<{ sha256: string; bytes: number }> {
  await mkdir(dirname(path), { recursive: true });
  const data = Buffer.from(text, 'utf8');
  await writeFile(path, data);
  return { sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length };
}

/// The path of a file inside the archive, with forward slashes on every
/// platform so an archive written on Windows reads on Linux and back.
export function archivePath(...parts: string[]): string {
  return join(...parts).split(sep).join('/');
}
