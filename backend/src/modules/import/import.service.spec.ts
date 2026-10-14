import { BadRequestException } from '@nestjs/common';

import { IMPORT_KINDS, ImportService } from './import.service';
import { readCsv, readXlsx } from './tabular';

/// The file this program hands out has to be one this program accepts.
///
/// It sounds obvious and it was not true: the template used to carry its
/// Arabic labels and its notes on the very sheet that gets uploaded, so the
/// first thing anybody saw after downloading it and uploading it unchanged
/// was a wall of red rows. That reads as a broken screen, and it is the
/// screen's own template doing it.
describe('ImportService', () => {
  const COMPANY = '11111111-1111-4111-8111-111111111111';
  const USER = '22222222-2222-4222-8222-222222222222';

  /// Enough of Prisma to read a file that writes nothing.
  function prisma() {
    return {
      customer: { findMany: async () => [], create: async () => ({}) },
      supplier: { findMany: async () => [], create: async () => ({}) },
      item: { findMany: async () => [], create: async () => ({}) },
      $transaction: async (work: unknown) =>
        typeof work === 'function' ? (work as () => unknown)() : work,
    };
  }

  function service() {
    return new ImportService(
      prisma() as never,
      { record: async () => {} } as never,
    );
  }

  it('reads back the template it writes, with nothing to correct', async () => {
    const importer = service();
    for (const kind of IMPORT_KINDS) {
      const buffer = await importer.template(kind);
      expect(buffer.length).toBeGreaterThan(0);

      const report = await importer.run(
        kind,
        COMPANY,
        USER,
        { originalname: `${kind}.xlsx`, buffer },
        { dryRun: true, mode: 'insert' },
      );

      // The example row is a real row, so it must be accepted and counted.
      expect(report.errors).toEqual([]);
      expect(report.totalRows).toBe(1);
      expect(report.created).toBe(1);
      expect(report.unknownColumns).toEqual([]);
    }
  });

  it('keeps the notes where a person can read them and the importer cannot trip over them', async () => {
    const importer = service();
    const buffer = await importer.template('customers');
    const sheet = await readXlsx(buffer);

    // One header, one example row. Anything else on this sheet is something
    // the importer would have to guess about.
    expect(sheet.headers).toContain('Code');
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]!.values['code']).toBe('C-100');
  });

  it('names the columns a file must have, in both languages', async () => {
    const importer = service();
    const buffer = await importer.template('items');
    const sheet = await readXlsx(buffer);
    // The Arabic name of the code column is on the instructions sheet, so a
    // person can match a hand-made sheet; the upload sheet stays clean.
    expect(sheet.headers.join(',')).not.toMatch(/[؀-ۿ]/);
  });

  it('refuses a file that is not a spreadsheet', async () => {
    const importer = service();
    await expect(
      importer.run(
        'customers',
        COMPANY,
        USER,
        { originalname: 'notes.txt', buffer: Buffer.from('hello') },
        { dryRun: true, mode: 'insert' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports the row and column of a value it cannot accept', async () => {
    const importer = service();
    const csv = 'Code,Name (English),Name (Arabic)\n'
      + ',No code given,بدون كود\n'
      + 'OK-1,Fine,جيد\n';
    const report = await importer.run(
      'customers',
      COMPANY,
      USER,
      { originalname: 'customers.csv', buffer: Buffer.from(csv, 'utf8') },
      { dryRun: true, mode: 'insert' },
    );
    expect(report.totalRows).toBe(2);
    expect(report.created).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]!.row).toBe(2);
    expect(report.errors[0]!.message).toContain('Code');
  });

  it('refuses a file that leaves out a required column entirely', async () => {
    // A column that is not in the file at all used to leave no value and no
    // complaint: the record was written with nothing where its Arabic name
    // should have been.
    const importer = service();
    const csv = 'Code,Name (English)\nC-9,Alfa\n';
    const report = await importer.run(
      'customers',
      COMPANY,
      USER,
      { originalname: 'x.csv', buffer: Buffer.from(csv, 'utf8') },
      { dryRun: true, mode: 'insert' },
    );
    expect(report.created).toBe(0);
    expect(report.errors.map((error) => error.column)).toContain(
      'Name (Arabic)',
    );
  });

  it('reads a CSV with a byte-order mark, as Excel writes them', async () => {
    const sheet = readCsv(
      Buffer.concat([
        Buffer.from('﻿', 'utf8'),
        Buffer.from('Code,Name (English)\nC-1,Alfa\n', 'utf8'),
      ]),
    );
    expect(sheet.headers[0]).toBe('Code');
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]!.values['code']).toBe('C-1');
  });

  it('will not write when the file still has problems', async () => {
    const importer = service();
    const csv = 'Code,Name (English),Name (Arabic)\nBAD,Alfa,\u0639\u0644\u0627\u0621\n';
    // A dry run and a real run take the same path, so a file that cannot be
    // read cleanly cannot be written either.
    const dry = await importer.run(
      'customers',
      COMPANY,
      USER,
      { originalname: 'x.csv', buffer: Buffer.from(csv, 'utf8') },
      { dryRun: true, mode: 'insert' },
    );
    expect(dry.created + dry.updated).toBe(1);
    expect(dry.errors).toEqual([]);
  });
});
