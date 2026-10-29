// A structural PE check only. It cannot validate an Inno overlay, prove that
// the installer is complete, scan compressed payloads, or authorize upload.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function inspectPe(bytes) {
  if (bytes.length < 1024 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Missing or too short DOS header.');
  const pe = bytes.readUInt32LE(0x3c);
  if (pe < 64 || pe > bytes.length - 24 || bytes.readUInt32LE(pe) !== 0x00004550) throw new Error('Invalid PE signature or offset.');
  const machine = bytes.readUInt16LE(pe + 4);
  const sections = bytes.readUInt16LE(pe + 6);
  const optSize = bytes.readUInt16LE(pe + 20);
  const flags = bytes.readUInt16LE(pe + 22);
  if (![0x14c, 0x8664].includes(machine) || !(flags & 0x0002) || sections < 1 || sections > 96 || optSize < 96) throw new Error('Unsupported PE executable header.');
  const optional = pe + 24;
  const table = optional + optSize;
  if (table + sections * 40 > bytes.length) throw new Error('Truncated PE section table.');
  const magic = bytes.readUInt16LE(optional);
  if (![0x10b, 0x20b].includes(magic)) throw new Error('Unsupported PE optional header.');
  for (let i = 0; i < sections; i++) {
    const section = table + 40 * i;
    const length = bytes.readUInt32LE(section + 16);
    const offset = bytes.readUInt32LE(section + 20);
    if (length && (offset > bytes.length || length > bytes.length - offset)) throw new Error('Truncated PE section.');
  }
  return { machine: machine === 0x14c ? 'x86' : 'x64', sections };
}

function main(args) {
  if (args.length !== 1) throw new Error('Usage: node inspect-windows-pe.mjs <file.exe>');
  const bytes = readFileSync(args[0]);
  const info = inspectPe(bytes);
  const sha = createHash('sha256').update(bytes).digest('hex');
  console.log(`PE structure: ${info.machine}, ${info.sections} sections, ${bytes.length} bytes, SHA-256 ${sha}. Inno/payload/completeness NOT verified.`);
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::notice title=Candidate PE structure::${bytes.length} bytes; SHA-256 ${sha}; ${info.machine}; Inno and payload NOT verified`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`PE check failed: ${e.message}`); process.exitCode = 1; }
}
