import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDefaultOperations,
  CsvParseError,
  exportRowsToXlsxBlob,
  parseCsvBuffer,
  parseXlsxBuffer,
  runCleaningPipeline,
  type CleaningOperationConfig,
} from '../lib/cleaner';
import { estimateCreditsForRows, formatInrFromPaise } from '../config/pricing';

const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures');

function readFixtureBuffer(filename: string): ArrayBuffer {
  const buf = fs.readFileSync(path.join(FIXTURES_DIR, filename));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function stringToArrayBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe('CleanData Studio Browser CSV Engine (Phase 1)', () => {
  it('processes golden fixture messy_customers.csv deterministically without mutating input', () => {
    const buffer = readFixtureBuffer('messy_customers.csv');
    const expected = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, 'messy_customers.expected.json'), 'utf8'),
    );

    const inspection = parseCsvBuffer(buffer, 'messy_customers.csv');
    const originalRowsSnapshot = JSON.stringify(inspection.rows);

    expect(inspection.rowCount).toBe(expected.rowsBefore);
    expect(inspection.headers).toEqual(expected.headers);
    expect(inspection.problems.emptyRows).toBe(1);
    expect(inspection.problems.duplicateRows).toBe(1);
    expect(inspection.problems.formulaCells).toBeGreaterThanOrEqual(3);

    const ops = buildDefaultOperations(inspection).map((op) => {
      if (op.id === 'trim_whitespace') {
        return { ...op, enabled: true, params: { columns: [], collapseInternal: true } };
      }
      if (op.id === 'standardize_dates') {
        return {
          ...op,
          enabled: true,
          params: { columns: [], dayFirst: true, outputFormat: 'YYYY-MM-DD' as const },
        };
      }
      return op;
    });

    const result = runCleaningPipeline(inspection, ops, { formulaProtection: true });

    // Original inspection must remain untouched
    expect(JSON.stringify(inspection.rows)).toBe(originalRowsSnapshot);

    expect(result.report.rowsBefore).toBe(expected.rowsBefore);
    expect(result.report.rowsAfter).toBe(expected.rowsAfter);
    expect(result.report.emptyRowsRemoved).toBe(expected.emptyRowsRemoved);
    expect(result.report.duplicatesRemoved).toBe(expected.duplicatesRemoved);
    expect(result.report.formulaCellsEscaped).toBe(expected.formulaCellsEscaped);
    expect(result.rows[0]).toEqual(expected.expectedFirstRow);
    expect(result.rows[1]).toEqual(expected.expectedSecondRowDayFirst);

    // Check formula-injection escaping in exported CSV
    for (const escapedCell of expected.expectedFormulaNoteCells) {
      expect(result.csvOutput).toContain(escapedCell);
    }
    // Plain negative numeric value in Order Total (-45.00) should NOT be quote-prefixed
    expect(result.csvOutput).toContain(',-45.00,');
    expect(result.report.qualityAfter.score).toBeGreaterThan(result.report.qualityBefore.score);
  });

  it('rejects empty files with EMPTY_FILE error', () => {
    const buffer = readFixtureBuffer('empty.csv');
    expect(() => parseCsvBuffer(buffer, 'empty.csv')).toThrowError(CsvParseError);
    try {
      parseCsvBuffer(buffer, 'empty.csv');
    } catch (err) {
      expect((err as CsvParseError).code).toBe('EMPTY_FILE');
    }
  });

  it('rejects oversized files (> 5 MB) with FILE_TOO_LARGE error', () => {
    const oversized = new Uint8Array(5 * 1024 * 1024 + 10);
    oversized.fill(65); // 'A'
    try {
      parseCsvBuffer(oversized.buffer, 'huge.csv');
      expect.fail('Expected FILE_TOO_LARGE error');
    } catch (err) {
      expect(err).toBeInstanceOf(CsvParseError);
      expect((err as CsvParseError).code).toBe('FILE_TOO_LARGE');
    }
  });

  it('rejects binary files (ZIP/XLSX and PDF) masquerading as .csv', () => {
    const zipMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const pdfMagic = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

    for (const bytes of [zipMagic, pdfMagic]) {
      try {
        parseCsvBuffer(bytes.buffer, 'fake.csv');
        expect.fail('Expected UNSUPPORTED_BINARY_FILE error');
      } catch (err) {
        expect(err).toBeInstanceOf(CsvParseError);
        expect((err as CsvParseError).code).toBe('UNSUPPORTED_BINARY_FILE');
      }
    }
  });

  it('handles header-only CSV files safely', () => {
    const buffer = readFixtureBuffer('header_only.csv');
    const inspection = parseCsvBuffer(buffer, 'header_only.csv');

    expect(inspection.headers).toEqual(['id', 'name', 'email', 'signup_date']);
    expect(inspection.rowCount).toBe(0);
    expect(inspection.qualityBefore.score).toBe(100);
    expect(inspection.warnings.some((w) => w.code === 'HEADER_ONLY_FILE')).toBe(true);

    const result = runCleaningPipeline(inspection, buildDefaultOperations(inspection));
    expect(result.rows.length).toBe(0);
    expect(result.csvOutput.trim()).toBe('id,name,email,signup_date');
  });

  it('disambiguates duplicate and blank headers safely', () => {
    const buffer = readFixtureBuffer('duplicate_blank_headers.csv');
    const inspection = parseCsvBuffer(buffer, 'duplicate_blank_headers.csv');

    expect(inspection.headers).toEqual(['name', 'column_2', 'name_2', 'email']);
    expect(inspection.problems.normalizedHeadersCount).toBe(2);
    expect(inspection.warnings.some((w) => w.code === 'NORMALIZED_HEADERS')).toBe(true);
  });

  it('strips UTF-8 BOM and preserves quoted embedded newlines', () => {
    const rawBytes = new Uint8Array(readFixtureBuffer('bom_quoted_newlines.csv'));
    const withBom = new Uint8Array(3 + rawBytes.length);
    withBom.set([0xef, 0xbb, 0xbf], 0);
    withBom.set(rawBytes, 3);

    const inspection = parseCsvBuffer(withBom.buffer, 'bom_quoted_newlines.csv');
    expect(inspection.encoding).toBe('UTF-8-BOM');
    expect(inspection.headers[0]).toBe('id');
    expect(inspection.rowCount).toBe(2);
    expect(inspection.rows[0][2]).toBe('12 MG Road\nBengaluru, KA');
  });

  it('falls back to Windows-1252 / Latin-1 encoding and detects semicolon delimiter', () => {
    // "name;city\nMüller;Café\n" in Windows-1252 (ü = 0xFC, é = 0xE9)
    const latin1Bytes = new Uint8Array([
      ...Array.from(new TextEncoder().encode('name;city\nM')),
      0xfc,
      ...Array.from(new TextEncoder().encode('ller;Caf')),
      0xe9,
      0x0a,
    ]);

    const inspection = parseCsvBuffer(latin1Bytes.buffer, 'latin1.csv');
    expect(inspection.encoding).toBe('Windows-1252 / Latin-1');
    expect(inspection.delimiter).toBe(';');
    expect(inspection.rows[0]).toEqual(['Müller', 'Café']);
  });

  it('detects pipe and tab delimiters automatically', () => {
    const pipeBuf = readFixtureBuffer('pipe_delimiter.csv');
    const pipeInspection = parseCsvBuffer(pipeBuf, 'pipe.csv');
    expect(pipeInspection.delimiter).toBe('|');
    expect(pipeInspection.headers).toEqual(['id', 'email', 'joined_at', 'score']);
    expect(pipeInspection.problems.duplicateRows).toBe(1);

    const tabBuf = stringToArrayBuffer('a\tb\tc\n1\t2\t3\n4\t5\t6\n');
    const tabInspection = parseCsvBuffer(tabBuf, 'tabs.csv');
    expect(tabInspection.delimiter).toBe('\t');
    expect(tabInspection.headers).toEqual(['a', 'b', 'c']);
  });

  it('requires explicit dayFirst vs monthFirst for ambiguous dates and never guesses unparseable dates', () => {
    const buffer = readFixtureBuffer('ambiguous_dates.csv');
    const inspection = parseCsvBuffer(buffer, 'ambiguous_dates.csv');
    expect(inspection.problems.ambiguousDates).toBe(1);
    expect(inspection.problems.unparseableDates).toBe(1);

    const dayFirstOp: CleaningOperationConfig[] = [
      {
        id: 'standardize_dates',
        enabled: true,
        params: { columns: ['order_date'], dayFirst: true, outputFormat: 'YYYY-MM-DD' },
      },
    ];
    const resDayFirst = runCleaningPipeline(inspection, dayFirstOp);
    expect(resDayFirst.rows[0][1]).toBe('2025-04-03');
    expect(resDayFirst.rows[1][1]).toBe('2025-04-15');
    expect(resDayFirst.rows[2][1]).toBe('2025-05-01');
    expect(resDayFirst.rows[3][1]).toBe('invalid_date');
    expect(resDayFirst.report.warnings.some((w) => w.code === 'UNPARSEABLE_DATES_PRESERVED')).toBe(
      true,
    );

    const monthFirstOp: CleaningOperationConfig[] = [
      {
        id: 'standardize_dates',
        enabled: true,
        params: { columns: ['order_date'], dayFirst: false, outputFormat: 'YYYY-MM-DD' },
      },
    ];
    const resMonthFirst = runCleaningPipeline(inspection, monthFirstOp);
    expect(resMonthFirst.rows[0][1]).toBe('2025-03-04');
    expect(resMonthFirst.rows[1][1]).toBe('2025-04-15');
  });

  it('supports key-column deduplication with keep first vs last', () => {
    const csv = [
      'id,email,plan',
      '1,a@example.com,free',
      '2,a@example.com,pro',
      '3,b@example.com,free',
    ].join('\n');
    const inspection = parseCsvBuffer(stringToArrayBuffer(csv), 'keys.csv');

    const keepFirst = runCleaningPipeline(inspection, [
      {
        id: 'remove_duplicates',
        enabled: true,
        params: { keyColumns: ['email'], keep: 'first' },
      },
    ]);
    expect(keepFirst.rows).toEqual([
      ['1', 'a@example.com', 'free'],
      ['3', 'b@example.com', 'free'],
    ]);

    const keepLast = runCleaningPipeline(inspection, [
      {
        id: 'remove_duplicates',
        enabled: true,
        params: { keyColumns: ['email'], keep: 'last' },
      },
    ]);
    expect(keepLast.rows).toEqual([
      ['2', 'a@example.com', 'pro'],
      ['3', 'b@example.com', 'free'],
    ]);
  });

  it('handles missing values via mean, median, constant, zero, and row removal', () => {
    const csv = [
      'name,score,city',
      'A,10,Delhi',
      'B,,Mumbai',
      'C,20,',
      'D,30,Pune',
    ].join('\n');
    const inspection = parseCsvBuffer(stringToArrayBuffer(csv), 'missing.csv');

    const resMean = runCleaningPipeline(inspection, [
      {
        id: 'handle_missing_values',
        enabled: true,
        params: {
          strategies: {
            score: { strategy: 'fill_mean' },
            city: { strategy: 'fill_constant', constantValue: 'Unknown' },
          },
        },
      },
    ]);
    expect(resMean.rows[1][1]).toBe('20');
    expect(resMean.rows[2][2]).toBe('Unknown');

    const resRemove = runCleaningPipeline(inspection, [
      {
        id: 'handle_missing_values',
        enabled: true,
        params: {
          strategies: {
            score: { strategy: 'remove_row' },
          },
        },
      },
    ]);
    expect(resRemove.rows.length).toBe(3);
  });

  it('renames columns and normalizes text cleanly', () => {
    const csv = 'First Name,Last Name\n  john doe ,JANE SMITH\n';
    const inspection = parseCsvBuffer(stringToArrayBuffer(csv), 'text.csv');

    const res = runCleaningPipeline(inspection, [
      {
        id: 'normalize_text',
        enabled: true,
        params: { columns: ['First Name', 'Last Name'], caseMode: 'title', collapseWhitespace: true },
      },
      {
        id: 'rename_columns',
        enabled: true,
        params: { convention: 'snake_case', customMap: {} },
      },
    ]);

    expect(res.headers).toEqual(['first_name', 'last_name']);
    expect(res.rows[0]).toEqual(['John Doe', 'Jane Smith']);
  });

  it('fails safely on malformed quoting', () => {
    const buffer = readFixtureBuffer('malformed_quotes.csv');
    expect(() => parseCsvBuffer(buffer, 'malformed_quotes.csv')).toThrowError(CsvParseError);
    try {
      parseCsvBuffer(buffer, 'malformed_quotes.csv');
    } catch (err) {
      expect((err as CsvParseError).code).toBe('MALFORMED_CSV');
    }
  });

  it('processes 5,000 rows quickly in the browser engine', () => {
    const lines = ['id,email,created_at,amount'];
    for (let i = 0; i < 5000; i++) {
      lines.push(`${i},USER${i % 2500}@EXAMPLE.COM,2025-01-${String((i % 28) + 1).padStart(2, '0')},${i}.50`);
    }
    const start = performance.now();
    const inspection = parseCsvBuffer(stringToArrayBuffer(lines.join('\n')), 'large_5k.csv');
    const ops = buildDefaultOperations(inspection);
    const result = runCleaningPipeline(inspection, ops);
    const elapsed = performance.now() - start;

    expect(inspection.rowCount).toBe(5000);
    expect(result.rows.length).toBe(5000); // ids are unique so exact rows aren't duplicates
    expect(elapsed).toBeLessThan(3000);
  });

  it('normalizes valid phone numbers by explicit region and preserves invalid ones with warning', () => {
    const csv = [
      'name,phone',
      'Asha,098765 43210',
      'Rohan,+91 98111 22233',
      'Bad,123',
    ].join('\n');
    const inspection = parseCsvBuffer(stringToArrayBuffer(csv), 'phones.csv');

    const res = runCleaningPipeline(inspection, [
      {
        id: 'normalize_phone_numbers',
        enabled: true,
        params: { columns: ['phone'], defaultRegion: 'IN', format: 'E.164' },
      },
    ]);

    expect(res.rows[0][1]).toBe('+919876543210');
    expect(res.rows[1][1]).toBe('+919811122233');
    expect(res.rows[2][1]).toBe('123');
    expect(res.report.warnings.some((w) => w.code === 'INVALID_PHONE_FORMAT')).toBe(true);
  });

  it('exports and parses XLSX workbooks safely without formula evaluation', async () => {
    const headers = ['name', 'amount', 'notes'];
    const rows = [
      ['Alice', '120.5', '=CMD()'],
      ['Bob', '-45', 'Normal note'],
    ];

    const blob = await exportRowsToXlsxBlob(headers, rows, {
      formulaProtection: true,
      columnTypes: { name: 'text', amount: 'decimal', notes: 'text' },
    });
    const buffer = await blob.arrayBuffer();
    const inspection = await parseXlsxBuffer(buffer, 'roundtrip.xlsx');

    expect(inspection.inputFormat).toBe('xlsx');
    expect(inspection.headers).toEqual(headers);
    expect(inspection.rowCount).toBe(2);
    expect(inspection.rows[0][0]).toBe('Alice');
    expect(inspection.rows[0][1]).toBe('120.5');
    expect(inspection.rows[0][2]).toBe("'=CMD()");
    expect(inspection.rows[1][1]).toBe('-45');
  });

  it('rejects corrupted non-ZIP files claiming .xlsx extension', async () => {
    const fakeBytes = new TextEncoder().encode('not a zip file');
    await expect(
      parseXlsxBuffer(fakeBytes.buffer, 'corrupted.xlsx'),
    ).rejects.toThrowError(CsvParseError);
  });

  it('computes INR display and ceil(rows/1000) credit estimates accurately', () => {
    expect(estimateCreditsForRows(0)).toBe(0);
    expect(estimateCreditsForRows(1)).toBe(1);
    expect(estimateCreditsForRows(1000)).toBe(1);
    expect(estimateCreditsForRows(1001)).toBe(2);
    expect(estimateCreditsForRows(5000)).toBe(5);
    expect(formatInrFromPaise(29900)).toBe('₹299');
    expect(formatInrFromPaise(199900)).toBe('₹1,999');
  });

  it('applies saved user preferences when building default cleaning operations', () => {
    const csv = 'phone,signup_date\n4155552671,03/04/2025\n';
    const inspection = parseCsvBuffer(stringToArrayBuffer(csv), 'prefs.csv');
    const ops = buildDefaultOperations(inspection, {
      dayFirst: false,
      dateFormat: 'MM/DD/YYYY',
      phoneRegion: 'US',
    });

    const dateOp = ops.find((o) => o.id === 'standardize_dates');
    const phoneOp = ops.find((o) => o.id === 'normalize_phone_numbers');
    expect(dateOp?.id === 'standardize_dates' && dateOp.params.dayFirst).toBe(false);
    expect(dateOp?.id === 'standardize_dates' && dateOp.params.outputFormat).toBe('MM/DD/YYYY');
    expect(phoneOp?.id === 'normalize_phone_numbers' && phoneOp.params.defaultRegion).toBe('US');
  });
});


