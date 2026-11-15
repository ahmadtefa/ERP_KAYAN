// Emit an already policy-scanned source diff through bounded CI annotations.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const [file, group] = process.argv.slice(2);
if (!file || !['0', '1'].includes(group)) throw new Error('Expected diff path and group 0 or 1');
const bytes = readFileSync(file);
const encoded = gzipSync(bytes).toString('base64');
const count = Math.ceil(encoded.length / 3000);
if (count > 18) throw new Error('Generated diff exceeds the diagnostic limit');
if (group === '0') console.log(`::notice title=Generated patch hash::${createHash('sha256').update(bytes).digest('hex')}`);
const start = Number(group) * 9;
for (let i = start; i < Math.min(start + 9, count); i++) {
  console.log(`::notice title=Generated patch ${i + 1}/${count}::${encoded.slice(i * 3000, (i + 1) * 3000)}`);
}
