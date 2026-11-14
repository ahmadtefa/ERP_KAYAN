import { createHash } from 'node:crypto';

/**
 * Pure, versioned candidate identity algorithm. Not wired into the installed
 * product: changing an existing machine identity requires a tested migration.
 * Callers must obtain identifiers using an appropriately privileged OS API;
 * never log the values or place them in the licence request.
 */
export interface MachineIdentitySignals {
  systemUuid?: string | null;
  boardSerial?: string | null;
  biosSerial?: string | null;
  machineGuid?: string | null;
}

const SOURCES = ['systemUuid', 'boardSerial', 'biosSerial', 'machineGuid'] as const;
const PLACEHOLDERS = new Set([
  'NONE', 'NULL', 'UNKNOWN', 'UNAVAILABLE', 'NOTAVAILABLE',
  'NOTSPECIFIED', 'NOTAPPLICABLE', 'DEFAULTSTRING', 'SYSTEMSERIALNUMBER',
  'TOBEFILLEDBYOEM', 'TOBEFILLEDBYOEMCOM', 'OEMSYSTEMPRODUCTNAME',
]);

function normalize(name: (typeof SOURCES)[number], value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 256) return null;
  const text = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (text.length < 6 || PLACEHOLDERS.has(text) || /^(.)\1+$/.test(text)) return null;
  if ((name === 'systemUuid' || name === 'machineGuid') && !/^[0-9A-F]{32}$/.test(text)) return null;
  return text;
}

/**
 * Hash at least two distinct sources into a short identifier. Hashes of
 * predictable device identifiers are not anonymous against guessing attacks.
 * at least one of which must be a hardware signal. The exact valid source set
 * is part of the identity: callers must not silently switch sets on errors.
 * Disk serials, host names and network/MAC addresses are deliberately absent.
 */
export function machineFingerprintV2(signals: MachineIdentitySignals): string {
  const parts = SOURCES.flatMap((name) => {
    const value = normalize(name, signals[name]);
    return value ? [{ name, value }] : [];
  });
  if (
    parts.length < 2 ||
    !parts.some(({ name }) => name !== 'machineGuid') ||
    new Set(parts.map(({ value }) => value)).size < 2
  ) {
    // Never echo hardware identifiers in diagnostics.
    throw new Error('Not enough independent stable machine identity signals.');
  }

  const hash = createHash('sha256').update('KAYAN-MACHINE-ID-V2\0', 'utf8');
  for (const { name, value } of parts) {
    // Length-prefix values to avoid ambiguities in the serialized input.
    hash.update(`${name}:${Buffer.byteLength(value, 'utf8')}:`, 'utf8');
    hash.update(value, 'utf8');
    hash.update('\0', 'utf8');
  }
  const code = hash.digest('hex').slice(0, 32).toUpperCase();
  return `KM2-${code.match(/.{4}/g)!.join('-')}`;
}
