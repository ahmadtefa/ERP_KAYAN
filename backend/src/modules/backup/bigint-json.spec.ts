import { OMITTED, TABLES } from './backup.service';

describe('a company backup survives JSON', () => {
  it('serialises the BigInt column a real backup carries', () => {
    // backupRun rows are part of a company backup and sizeBytes is a BigInt.
    const rows = [{ id: 'r1', sizeBytes: BigInt(665) }];
    const plain = () => JSON.stringify({ tables: { backupRun: rows } });
    expect(plain).toThrow(/BigInt/);
    const safe = JSON.stringify({ tables: { backupRun: rows } }, (_k, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(JSON.parse(safe).tables.backupRun[0].sizeBytes).toBe('665');
  });

  it('does not claim to omit a table it exports', () => {
    expect(TABLES.filter((s) => s.model in OMITTED).map((s) => s.model)).toEqual([]);
  });
});
