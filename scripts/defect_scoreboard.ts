import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  buildDefaultOperations,
  COUPON_EMPTY_TOKENS,
  defaultNumericRuleForHeader,
  DEFAULT_PLACEHOLDER_TOKENS,
  isJunkPhoneDigits,
  isValidEmailSyntax,
  parseCsvBuffer,
  parseDateValue,
  runCleaningPipeline,
  validateAndFormatPhone,
  validateNumericValue,
} from '../src/lib/cleaner';

const PLACEHOLDER_SET = new Set(DEFAULT_PLACEHOLDER_TOKENS.map((t) => t.toLowerCase()));

export function generateSyntheticCustomerOrdersCsv(rowCount: number): string {
  const headers = [
    'order_id',
    'customer_name',
    'email',
    'phone',
    'city',
    'state',
    'product',
    'category',
    'quantity',
    'price',
    'order_date',
    'coupon',
  ];

  const firstNames = ['Aarav', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Neha', 'Karthik', 'Meera'];
  const lastNames = ['Sharma', 'Patel', 'Nair', 'Verma', 'Iyer', 'Reddy', 'Gupta', 'Desai'];
  const cities = ['Kochi', 'Indore', 'Bengaluru', 'Mumbai', 'Pune', 'Hyderabad', 'Chennai', 'Delhi'];
  const states = ['KL', 'MP', 'KA', 'MH', 'TN', 'TS', 'DL'];
  const products = ['Wireless Mouse', 'Mechanical Keyboard', 'USB-C Hub', 'Laptop Stand', 'Webcam HD'];
  const categories = ['Electronics', 'Accessories', 'Peripherals', 'Office'];
  const coupons = ['SAVE10', 'WELCOME20', 'FESTIVE15'];

  const lines: string[] = [headers.join(',')];
  let orderCounter = 10000;

  const scale = rowCount / 12000;
  const exactDups = Math.max(rowCount >= 50 ? 3 : 0, Math.round(108 * scale));
  const nearDups = Math.max(rowCount >= 50 ? 2 : 0, Math.round(12 * scale));
  const uniqueTarget = rowCount - exactDups - nearDups;

  const rows: string[][] = [];

  for (let i = 0; i < uniqueTarget; i++) {
    orderCounter++;
    const fn = firstNames[i % firstNames.length];
    const ln = lastNames[(i * 3) % lastNames.length];
    let name = `${fn} ${ln}`;
    if (i % 33 === 0) name = `  ${fn}   ${ln} `;

    let email = `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@example.com`;
    if (i % 52 === 1) email = 'N/A';
    else if (i % 47 === 2) email = 'invalid-email';
    else if (i % 97 === 4) email = `${fn.toLowerCase()}@invalid`;
    else if (i % 52 === 3) email = email.toUpperCase();

    const rawTenDigit = `9${String(100000000 + ((i * 7919) % 899999999)).slice(0, 9)}`;
    let phone = `+91 ${rawTenDigit.slice(0, 5)} ${rawTenDigit.slice(5)}`;
    if (i % 32 === 4) phone = '12345';
    else if (i % 35 === 5) phone = '0000000000';
    else if (i % 40 === 6) phone = '9999999999';
    else if (i % 25 === 7) phone = `0${rawTenDigit}`;

    let city = cities[i % cities.length];
    if (i % 16 === 8) city = city.toLowerCase();
    else if (i % 31 === 9) city = city.toUpperCase();

    let state = states[i % states.length];
    if (i % 32 === 10) state = '??';

    let product = products[i % products.length];
    if (i % 104 === 11) product = 'unknown';

    let category = categories[i % categories.length];
    if (i % 69 === 12) category = 'misc';

    let quantity = String((i % 5) + 1);
    if (i % 360 === 13) quantity = '-99';
    else if (i % 360 === 14) quantity = '0';
    else if (i % 360 === 15) quantity = 'many';
    else if (i % 140 === 21) quantity = '2500';

    let price = ((i % 40) * 50 + 199.5).toFixed(2);
    if (i % 400 === 16) price = '-999';
    else if (i % 400 === 17) price = '0';
    else if (i % 400 === 18) price = 'free';

    const day = String((i % 28) + 1).padStart(2, '0');
    const month = String((i % 12) + 1).padStart(2, '0');
    let orderDate = `${day}/${month}/2025`;
    if (i % 200 === 19) orderDate = '2025-02-30';
    else if (i % 200 === 20) orderDate = 'not-a-date';
    else if (i % 145 === 22) orderDate = '1980-01-01';

    let coupon = '';
    if (i % 5 === 0) coupon = 'NONE';
    else if (i % 7 === 0) coupon = coupons[i % coupons.length].toLowerCase();

    rows.push([
      `ORD-${orderCounter}`,
      name,
      email,
      phone,
      city,
      state,
      product,
      category,
      quantity,
      price,
      orderDate,
      coupon,
    ]);
  }

  for (let d = 0; d < exactDups && rows.length > 0; d++) {
    rows.push([...rows[d * 5]]);
  }

  for (let m = 0; m < nearDups && rows.length > 0; m++) {
    const base = [...rows[m * 7 + 1]];
    base[4] = ''; // blank city so winner fills it or vice versa
    if (m % 2 === 1) {
      base[6] = 'USB-C Hub'; // conflicting product value
    }
    rows.push(base);
  }

  for (const r of rows) {
    lines.push(r.join(','));
  }

  return `${lines.join('\n')}\n`;
}

export interface DefectMetrics {
  rows: number;
  placeholders: number;
  invalidEmails: number;
  uppercaseEmails: number;
  invalidOrJunkPhones: number;
  apostrophePhones: number;
  invalidDates: number;
  invalidQuantities: number;
  invalidPrices: number;
  couponNoneTokens: number;
  exactDuplicateRows: number;
  whitespaceCells: number;
  caseVariants: number;
  qualityScore: number;
}

export function measureDefects(
  headers: string[],
  rows: string[][],
  csvOutput: string,
  qualityScore: number,
): DefectMetrics {
  const idx = (name: string) => headers.indexOf(name);
  const emailIdx = idx('email');
  const phoneIdx = idx('phone');
  const dateIdx = idx('order_date');
  const qtyIdx = idx('quantity');
  const priceIdx = idx('price');
  const couponIdx = idx('coupon');
  const cityIdx = idx('city');

  const qtyRule = defaultNumericRuleForHeader('quantity')!;
  const priceRule = defaultNumericRuleForHeader('price')!;

  let placeholders = 0;
  let invalidEmails = 0;
  let uppercaseEmails = 0;
  let invalidOrJunkPhones = 0;
  let invalidDates = 0;
  let invalidQuantities = 0;
  let invalidPrices = 0;
  let couponNoneTokens = 0;
  let whitespaceCells = 0;

  const seenRows = new Set<string>();
  let exactDuplicateRows = 0;

  const cityGroups = new Map<string, Set<string>>();

  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seenRows.has(key)) exactDuplicateRows++;
    else seenRows.add(key);

    row.forEach((cell, cIdx) => {
      const trimmed = cell.trim();
      if (cell !== trimmed || / {2,}|\t/.test(cell)) whitespaceCells++;
      if (trimmed !== '' && PLACEHOLDER_SET.has(trimmed.toLowerCase()) && cIdx !== couponIdx) {
        placeholders++;
      }
    });

    if (emailIdx >= 0) {
      const e = row[emailIdx]?.trim() ?? '';
      if (e !== '') {
        if (!isValidEmailSyntax(e)) invalidEmails++;
        if (e !== e.toLowerCase()) uppercaseEmails++;
      }
    }

    if (phoneIdx >= 0) {
      const p = row[phoneIdx]?.trim() ?? '';
      if (p !== '') {
        const res = validateAndFormatPhone(p, 'IN', 'E.164');
        const digits = p.replace(/\D/g, '');
        if (!res.valid || isJunkPhoneDigits(digits.slice(-10), 'IN')) {
          invalidOrJunkPhones++;
        }
      }
    }

    if (dateIdx >= 0) {
      const d = row[dateIdx]?.trim() ?? '';
      if (d !== '' && !parseDateValue(d, true).valid) {
        invalidDates++;
      }
    }

    if (qtyIdx >= 0) {
      const q = row[qtyIdx]?.trim() ?? '';
      if (q !== '' && !validateNumericValue(q, qtyRule).valid) {
        invalidQuantities++;
      }
    }

    if (priceIdx >= 0) {
      const pr = row[priceIdx]?.trim() ?? '';
      if (pr !== '' && !validateNumericValue(pr, priceRule).valid) {
        invalidPrices++;
      }
    }

    if (couponIdx >= 0) {
      const cp = row[couponIdx]?.trim() ?? '';
      if (cp !== '' && COUPON_EMPTY_TOKENS.has(cp.toLowerCase())) {
        couponNoneTokens++;
      }
    }

    if (cityIdx >= 0) {
      const c = row[cityIdx]?.trim() ?? '';
      if (c !== '') {
        const lower = c.toLowerCase();
        let set = cityGroups.get(lower);
        if (!set) {
          set = new Set<string>();
          cityGroups.set(lower, set);
        }
        set.add(c);
      }
    }
  }

  let caseVariants = 0;
  for (const variants of cityGroups.values()) {
    if (variants.size > 1) caseVariants += variants.size - 1;
  }

  let apostrophePhones = 0;
  const csvLines = csvOutput.split(/\r?\n/).slice(1);
  if (phoneIdx >= 0) {
    for (const line of csvLines) {
      if (!line) continue;
      const cols = line.split(',');
      if ((cols[phoneIdx] ?? '').startsWith("'+")) apostrophePhones++;
    }
  }

  return {
    rows: rows.length,
    placeholders,
    invalidEmails,
    uppercaseEmails,
    invalidOrJunkPhones,
    apostrophePhones,
    invalidDates,
    invalidQuantities,
    invalidPrices,
    couponNoneTokens,
    exactDuplicateRows,
    whitespaceCells,
    caseVariants,
    qualityScore,
  };
}

function main() {
  const argPath = process.argv[2];
  let filename = 'synthetic_customer_orders_12000.csv';
  let rawBytes: Uint8Array;

  if (argPath) {
    const resolved = path.resolve(argPath);
    filename = path.basename(resolved);
    rawBytes = fs.readFileSync(resolved);
  } else {
    rawBytes = new TextEncoder().encode(generateSyntheticCustomerOrdersCsv(12000));
  }

  const buffer = new Uint8Array(rawBytes).buffer;
  const start = performance.now();
  const inspection = parseCsvBuffer(buffer, filename);
  const before = measureDefects(
    inspection.headers,
    inspection.rows,
    new TextDecoder().decode(rawBytes),
    inspection.qualityBefore.score,
  );

  const ops = buildDefaultOperations(inspection);
  const result = runCleaningPipeline(inspection, ops, { formulaProtection: true });
  const elapsedMs = Math.round((performance.now() - start) * 10) / 10;

  const after = measureDefects(
    result.headers,
    result.rows,
    result.csvOutput,
    result.report.qualityAfter.score,
  );

  // Idempotency check
  const pass2Bytes = new TextEncoder().encode(result.csvOutput);
  const pass2Inspection = parseCsvBuffer(
    pass2Bytes.buffer.slice(pass2Bytes.byteOffset, pass2Bytes.byteOffset + pass2Bytes.byteLength),
    filename,
  );
  const pass2Result = runCleaningPipeline(
    pass2Inspection,
    buildDefaultOperations(pass2Inspection),
    { formulaProtection: true },
  );

  console.log(`\n=== CleanData Studio Defect Scoreboard (${filename}) ===`);
  console.log(`Elapsed: ${elapsedMs} ms`);
  console.log('Metric                  | Before | After');
  console.log('------------------------+--------+------');
  const keys: Array<keyof DefectMetrics> = [
    'rows',
    'placeholders',
    'invalidEmails',
    'uppercaseEmails',
    'invalidOrJunkPhones',
    'apostrophePhones',
    'invalidDates',
    'invalidQuantities',
    'invalidPrices',
    'couponNoneTokens',
    'exactDuplicateRows',
    'whitespaceCells',
    'caseVariants',
    'qualityScore',
  ];
  for (const k of keys) {
    console.log(`${String(k).padEnd(23)} | ${String(before[k]).padStart(6)} | ${String(after[k]).padStart(5)}`);
  }
  console.log('\nAudit issue counts by rule:', result.report.issueCountsByRule);
  console.log(
    `Near-dup merges: ${result.report.merges?.length ?? 0} | Pass-2 issues: ${
      pass2Result.report.issues?.length ?? 0
    } | Pass-2 byte-identical: ${pass2Result.csvOutput === result.csvOutput}`,
  );
}

const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.includes('defect_scoreboard');

if (isDirectRun) {
  main();
}
