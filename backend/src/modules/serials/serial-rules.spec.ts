import {
  cleanSerial,
  nextSerialStatus,
  parseSerialList,
  parseWarrantyMonths,
  SerialError,
  warrantyDaysLeft,
  warrantyEndDate,
  warrantyState,
} from './serial-rules';

describe('serial life cycle', () => {
  it('moves in stock to sold to returned and back to sold', () => {
    expect(nextSerialStatus('IN_STOCK', 'sell')).toBe('SOLD');
    expect(nextSerialStatus('SOLD', 'return')).toBe('RETURNED');
    expect(nextSerialStatus('RETURNED', 'sell')).toBe('SOLD');
  });
  it('scraps only what is on the shelf', () => {
    expect(nextSerialStatus('IN_STOCK', 'scrap')).toBe('SCRAPPED');
    expect(nextSerialStatus('RETURNED', 'scrap')).toBe('SCRAPPED');
    expect(() => nextSerialStatus('SOLD', 'scrap')).toThrow(SerialError);
  });
  it('refuses every move out of scrapped and sold twice', () => {
    for (const a of ['sell', 'return', 'scrap'] as const) expect(() => nextSerialStatus('SCRAPPED', a)).toThrow(SerialError);
    expect(() => nextSerialStatus('SOLD', 'sell')).toThrow(SerialError);
    expect(() => nextSerialStatus('IN_STOCK', 'return')).toThrow(SerialError);
  });
});

describe('serial entry', () => {
  it('trims and refuses empty, long and spaced serials', () => {
    expect(cleanSerial('  SN-001 ')).toBe('SN-001');
    expect(() => cleanSerial('')).toThrow(SerialError);
    expect(() => cleanSerial('   ')).toThrow(SerialError);
    expect(() => cleanSerial('A B')).toThrow(SerialError);
    expect(() => cleanSerial('x'.repeat(65))).toThrow(SerialError);
    expect(cleanSerial('x'.repeat(64))).toHaveLength(64);
  });
  it('reads a pasted list by line, comma or semicolon', () => {
    expect(parseSerialList('A1\nA2,A3; A4\r\nA5\n\n')).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
    expect(parseSerialList(['x1', ' x2 '])).toEqual(['x1', 'x2']);
  });
  it('refuses a repeat inside the list, ignoring case, an empty list and a huge one', () => {
    expect(() => parseSerialList('A1\na1')).toThrow(/twice/);
    expect(() => parseSerialList('  \n ')).toThrow(SerialError);
    expect(() => parseSerialList(Array.from({ length: 501 }, (_, i) => `S${i}`))).toThrow(/At most/);
    expect(parseSerialList(Array.from({ length: 500 }, (_, i) => `S${i}`))).toHaveLength(500);
  });
});

describe('warranty', () => {
  it('reads months as whole numbers up to 240, empty meaning none', () => {
    expect(parseWarrantyMonths('')).toBe(0);
    expect(parseWarrantyMonths(undefined)).toBe(0);
    expect(parseWarrantyMonths('12')).toBe(12);
    expect(parseWarrantyMonths(24)).toBe(24);
    for (const bad of ['-1', '1.5', 'x', '241', '1e2']) expect(() => parseWarrantyMonths(bad)).toThrow(SerialError);
  });
  it('adds whole months and clamps to the last day of a shorter month', () => {
    expect(warrantyEndDate('2026-03-15', 12)).toBe('2027-03-15');
    expect(warrantyEndDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(warrantyEndDate('2027-12-31', 2)).toBe('2028-02-29');
    expect(warrantyEndDate('2026-11-30', 3)).toBe('2027-02-28');
    expect(warrantyEndDate('2026-12-15', 1)).toBe('2027-01-15');
    expect(warrantyEndDate('2026-06-10', 0)).toBeNull();
    expect(() => warrantyEndDate('10/06/2026', 6)).toThrow(SerialError);
  });
  it('covers the whole last day', () => {
    expect(warrantyState('SOLD', '2027-03-15', '2027-03-15')).toBe('ACTIVE');
    expect(warrantyState('SOLD', '2027-03-15', '2027-03-16')).toBe('EXPIRED');
    expect(warrantyDaysLeft('2027-03-15', '2027-03-15')).toBe(0);
    expect(warrantyDaysLeft('2027-03-15', '2027-03-10')).toBe(5);
    expect(warrantyDaysLeft('2027-03-15', '2027-03-16')).toBeNull();
  });
  it('only a sold serial has a warranty state', () => {
    expect(warrantyState('IN_STOCK', null, '2027-01-01')).toBe('NOT_SOLD');
    expect(warrantyState('RETURNED', '2030-01-01', '2027-01-01')).toBe('NOT_SOLD');
    expect(warrantyState('SOLD', null, '2027-01-01')).toBe('NONE');
  });
});
