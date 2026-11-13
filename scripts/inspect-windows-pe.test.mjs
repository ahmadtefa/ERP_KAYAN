import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectPe } from './inspect-windows-pe.mjs';

function sample() {
  const b = Buffer.alloc(1024);
  b.write('MZ'); b.writeUInt32LE(0x80, 0x3c); b.writeUInt32LE(0x4550, 0x80);
  b.writeUInt16LE(0x8664, 0x84); b.writeUInt16LE(1, 0x86);
  b.writeUInt16LE(0xf0, 0x94); b.writeUInt16LE(2, 0x96);
  b.writeUInt16LE(0x20b, 0x98);
  b.writeUInt32LE(0x100, 0x198); b.writeUInt32LE(0x200, 0x19c);
  return b;
}
test('accepts structural PE and rejects invalid or truncated headers and sections', () => {
  const b = sample();
  assert.deepEqual(inspectPe(b), {machine: 'x64', sections: 1});
  assert.throws(() => inspectPe(Buffer.alloc(1024)));
  const invalid = Buffer.from(b); invalid.writeUInt32LE(0xffff, 0x3c);
  assert.throws(() => inspectPe(invalid));
  const truncated = Buffer.from(b); truncated.writeUInt32LE(0x1000, 0x198);
  assert.throws(() => inspectPe(truncated));
});
