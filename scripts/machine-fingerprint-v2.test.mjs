// Pure tests only: no registry, device identifiers, customer data or files.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { machineFingerprintV2 } from '../backend/src/modules/licensing/machine-fingerprint-v2.ts';

const sample = {
  systemUuid: 'a1b2c3d4-0011-2233-4455-abcdef123456',
  boardSerial: 'Board 7342-ABC',
  biosSerial: 'BIOS-9912-XY',
  machineGuid: '11223344-1234-5678-ABCD-1234567890AB',
};

test('stable across property order, harmless formatting and case', () => {
  const first = machineFingerprintV2(sample);
  const second = machineFingerprintV2({
    machineGuid: '1122334412345678abcd1234567890ab',
    biosSerial: 'bios 9912 xy',
    boardSerial: 'board-7342-abc',
    systemUuid: 'A1B2C3D4001122334455ABCDEF123456',
  });
  assert.equal(first, second);
  assert.match(first, /^KM2-(?:[0-9A-F]{4}-){7}[0-9A-F]{4}$/);
  assert.ok(!first.includes('7342-ABC'));
});

test('rejects missing, placeholder and duplicated-only signals without echoing input', () => {
  assert.throws(() => machineFingerprintV2({ machineGuid: '11223344' }), /Not enough independent/);
  assert.throws(() => machineFingerprintV2({ systemUuid: '0000-0000', boardSerial: 'To be filled by O.E.M.' }), /Not enough independent/);
  assert.throws(() => machineFingerprintV2({ systemUuid: 'ffff-ffff', boardSerial: 'Default string' }), /Not enough independent/);
  assert.throws(() => machineFingerprintV2({ systemUuid: '1122334412345678ABCD1234567890AB', boardSerial: '11223344-1234-5678-abcd-1234567890ab' }), /Not enough independent/);
  assert.throws(() => machineFingerprintV2({ systemUuid: 'not-a-valid-uuid', boardSerial: 'BOARD1234' }), /Not enough independent/);
  assert.throws(() => machineFingerprintV2({ systemUuid: 'X'.repeat(257), boardSerial: 'board-secret' }), (error) => !error.message.includes('board-secret'));
});

test('allows hardware plus machine GUID, but changes identity on signal change or loss', () => {
  const a = machineFingerprintV2({ systemUuid: sample.systemUuid, machineGuid: sample.machineGuid });
  assert.notEqual(a, machineFingerprintV2({ systemUuid: sample.systemUuid, machineGuid: '99887766-1234-5678-ABCD-1234567890AB' }));
  assert.notEqual(machineFingerprintV2(sample), machineFingerprintV2({ ...sample, biosSerial: null }));
  assert.throws(() => machineFingerprintV2({ machineGuid: sample.machineGuid }), /Not enough independent/);
});

test('source names and lengths prevent ambiguous combinations', () => {
  const a = machineFingerprintV2({ boardSerial: 'ABCD1234', biosSerial: 'EFGH5678' });
  const b = machineFingerprintV2({ boardSerial: 'EFGH5678', biosSerial: 'ABCD1234' });
  assert.notEqual(a, b);
});
