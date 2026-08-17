// Parsing and normalization of bank-statement files (CSV / Excel).
//
// Bank exports are messy: header names differ, some use one signed "Amount"
// column, others split into "Debit"/"Credit", dates come in many formats, and
// amounts carry currency symbols, thousands separators, or parentheses for
// negatives. This module turns any of that into clean `Transaction` records.

import Papa from 'papaparse';
import type { ColumnMapping, ParsedFile, Transaction } from '../types';

// --- Header detection vocabulary ---------------------------------------------

const DATE_HINTS = [/^date$/i, /date/i, /posted/i, /transaction\s*date/i];
const DESC_HINTS = [
  /description/i,
  /details?/i,
  /narrative/i,
  /memo/i,
  /payee/i,
  /reference/i,
  /particulars/i,
  /name/i,
  /transaction/i,
];
const AMOUNT_HINTS = [/^amount$/i, /amount/i, /value/i];
const DEBIT_HINTS = [/debit/i, /withdrawal/i, /paid\s*out/i, /money\s*out/i, /^out$/i];
const CREDIT_HINTS = [/credit/i, /deposit/i, /paid\s*in/i, /money\s*in/i, /^in$/i];
const BALANCE_HINTS = [/running\s*balance/i, /available\s*balance/i, /closing\s*balance/i, /^balance$/i, /balance/i];

function matchesAny(header: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(header.trim()));
}

// --- Amount parsing ----------------------------------------------------------

/**
 * Parse a money string into a number. Handles "$1,234.56", "(45.00)" for
 * negatives, "1.234,56" (EU style), trailing "CR"/"DR", and stray symbols.
 * Returns NaN if there's no number at all.
 */
export function parseAmount(raw: string | number | undefined | null): number {
  if (raw === null || raw === undefined) return NaN;
  if (typeof raw === 'number') return raw;

  let s = String(raw).trim();
  if (s === '') return NaN;

  let negative = false;

  // Parentheses denote negatives in accounting exports.
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // Trailing/leading CR (credit) / DR (debit) markers.
  if (/dr\b/i.test(s)) negative = true;
  s = s.replace(/\b(cr|dr)\b/gi, '');

  // A leading minus anywhere.
  if (s.includes('-')) negative = true;

  // Strip everything except digits and separators.
  s = s.replace(/[^0-9.,]/g, '');
  if (s === '') return NaN;

  // Decide which separator is the decimal point. If both appear, the last one
  // is the decimal separator; the other is a thousands separator.
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      // EU style: 1.234,56
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // US style: 1,234.56
      s = s.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    // Only commas. Treat as decimal if it looks like one (e.g. "12,50"),
    // otherwise as thousands separators.
    const after = s.length - lastComma - 1;
    s = after === 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  }

  const n = Number(s);
  if (Number.isNaN(n)) return NaN;
  return negative ? -Math.abs(n) : n;
}

// --- Date parsing ------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse a date string into an ISO `YYYY-MM-DD` string, or null if unparseable.
 * Handles ISO, D/M/Y and M/D/Y (disambiguated when possible), and "12 Jan 2024".
 */
export function parseDate(raw: string | number | undefined | null): string | null {
  if (raw === null || raw === undefined) return null;

  // Excel serial date number.
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const d = excelSerialToDate(raw);
    return d ? toISO(d) : null;
  }

  const s = String(raw).trim();
  if (s === '') return null;

  // ISO yyyy-mm-dd (optionally with time).
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return formatISO(+iso[1], +iso[2], +iso[3]);
  }

  // "12 Jan 2024" / "Jan 12, 2024" / "12-Jan-24".
  const named = s.match(/(\d{1,2})[\s/-]*([A-Za-z]{3,})[\s,/-]*(\d{2,4})/);
  if (named) {
    const mon = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (mon) return formatISO(normalizeYear(+named[3]), mon, +named[1]);
  }
  const named2 = s.match(/([A-Za-z]{3,})[\s/-]*(\d{1,2})[\s,/-]*(\d{2,4})/);
  if (named2) {
    const mon = MONTHS[named2[1].slice(0, 3).toLowerCase()];
    if (mon) return formatISO(normalizeYear(+named2[3]), mon, +named2[2]);
  }

  // Numeric d/m/y or m/d/y separated by / . or -.
  const parts = s.match(/^(\d{1,4})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (parts) {
    let a = +parts[1];
    const b = +parts[2];
    let c = +parts[3];
    // yyyy/mm/dd
    if (a > 31) return formatISO(a, b, c);
    // Otherwise day/month/year — assume day-first (most of the world). If the
    // first field can't be a day but the second can, fall back to month-first.
    let day = a;
    let month = b;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      day = b;
      month = a;
    }
    c = normalizeYear(c);
    return formatISO(c, month, day);
  }

  // Last resort: let the engine try.
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return toISO(d);
  return null;
}

function excelSerialToDate(serial: number): Date {
  // Excel epoch is 1899-12-30 (accounting for the 1900 leap-year bug).
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms);
}

function normalizeYear(y: number): number {
  if (y < 100) return y < 70 ? 2000 + y : 1900 + y;
  return y;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// Reject obviously-wrong years (parse errors / mis-mapped columns) so a single
// bad row can't stretch the time axis to thousands of months.
const MAX_YEAR = new Date().getFullYear() + 1;
function plausibleYear(y: number): boolean {
  return y >= 1900 && y <= MAX_YEAR;
}

function formatISO(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || !plausibleYear(y)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function toISO(d: Date): string | null {
  const y = d.getUTCFullYear();
  if (!plausibleYear(y)) return null;
  return `${y}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// --- Column detection --------------------------------------------------------

/** Score how date-like a sample of values is (0..1). */
function dateScore(values: string[]): number {
  const sample = values.filter((v) => v && v.trim() !== '').slice(0, 25);
  if (sample.length === 0) return 0;
  const ok = sample.filter((v) => parseDate(v) !== null).length;
  return ok / sample.length;
}

/** Score how number-like a sample of values is (0..1). */
function numberScore(values: string[]): number {
  const sample = values.filter((v) => v && v.trim() !== '').slice(0, 25);
  if (sample.length === 0) return 0;
  const ok = sample.filter((v) => !Number.isNaN(parseAmount(v))).length;
  return ok / sample.length;
}

function columnValues(rows: Record<string, string>[], header: string): string[] {
  return rows.map((r) => r[header] ?? '');
}

/**
 * Inspect headers + sample rows and propose a column mapping. Combines header
 * name hints with value-shape scoring so it works even when headers are unusual.
 */
export function detectMapping(
  headers: string[],
  rows: Record<string, string>[],
): ColumnMapping | null {
  if (headers.length === 0 || rows.length === 0) return null;

  // Date: prefer a hinted header that also parses as dates; else best date score.
  let dateColumn =
    headers.find((h) => matchesAny(h, DATE_HINTS) && dateScore(columnValues(rows, h)) > 0.5) ?? '';
  if (!dateColumn) {
    const scored = headers
      .map((h) => ({ h, s: dateScore(columnValues(rows, h)) }))
      .sort((a, b) => b.s - a.s);
    if (scored[0] && scored[0].s > 0.6) dateColumn = scored[0].h;
  }

  // Debit / credit split columns.
  const debitColumn = headers.find((h) => matchesAny(h, DEBIT_HINTS));
  const creditColumn = headers.find((h) => matchesAny(h, CREDIT_HINTS));

  // Single signed amount column.
  let amountColumn = headers.find(
    (h) =>
      matchesAny(h, AMOUNT_HINTS) &&
      h !== debitColumn &&
      h !== creditColumn &&
      numberScore(columnValues(rows, h)) > 0.5,
  );

  // Description: prefer hinted header; else the most text-like non-numeric column.
  let descriptionColumn =
    headers.find(
      (h) =>
        matchesAny(h, DESC_HINTS) &&
        h !== dateColumn &&
        numberScore(columnValues(rows, h)) < 0.5,
    ) ?? '';
  if (!descriptionColumn) {
    const textCols = headers
      .filter((h) => h !== dateColumn && h !== amountColumn && h !== debitColumn && h !== creditColumn)
      .map((h) => ({ h, s: numberScore(columnValues(rows, h)) }))
      .sort((a, b) => a.s - b.s);
    if (textCols[0]) descriptionColumn = textCols[0].h;
  }

  const haveAmount = Boolean(amountColumn);
  const haveSplit = Boolean(debitColumn && creditColumn);

  // If neither amount nor a split was found by name, fall back to the most
  // numeric remaining column as a signed amount.
  if (!haveAmount && !haveSplit) {
    const numericCols = headers
      .filter((h) => h !== dateColumn && h !== descriptionColumn)
      .map((h) => ({ h, s: numberScore(columnValues(rows, h)) }))
      .sort((a, b) => b.s - a.s);
    if (numericCols[0] && numericCols[0].s > 0.6) amountColumn = numericCols[0].h;
  }

  if (!dateColumn || (!amountColumn && !haveSplit)) return null;

  // Optional running-balance column, if the statement includes one. Only
  // matched by name (not by number-shape, since a balance column looks just
  // like any other numeric column) and never one already claimed above.
  const balanceColumn = headers.find(
    (h) =>
      matchesAny(h, BALANCE_HINTS) &&
      h !== dateColumn &&
      h !== descriptionColumn &&
      h !== amountColumn &&
      h !== debitColumn &&
      h !== creditColumn &&
      numberScore(columnValues(rows, h)) > 0.5,
  );

  return {
    dateColumn,
    descriptionColumn,
    amountColumn: haveSplit ? undefined : amountColumn,
    debitColumn: haveSplit ? debitColumn : undefined,
    creditColumn: haveSplit ? creditColumn : undefined,
    positiveMeans: 'income',
    balanceColumn,
  };
}

// --- File reading ------------------------------------------------------------

function isExcel(fileName: string): boolean {
  return /\.(xlsx|xls|xlsm)$/i.test(fileName);
}

/** Read a File into normalized { headers, rows } regardless of CSV vs Excel. */
async function readRows(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  if (isExcel(file.name)) {
    // Loaded on demand so the (large) spreadsheet library stays out of the
    // initial bundle — only fetched when an Excel file is actually imported.
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const matrix: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
    return matrixToRows(matrix);
  }

  const text = await file.text();
  const result = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  return matrixToRows(result.data as unknown[][]);
}

/**
 * Many bank CSVs have preamble lines ("Account: 1234", blank rows, etc.) before
 * the real header. Find the most likely header row, then build records from it.
 */
function matrixToRows(matrix: unknown[][]): { headers: string[]; rows: Record<string, string>[] } {
  const cleaned = matrix.filter((row) => row && row.some((c) => String(c ?? '').trim() !== ''));
  if (cleaned.length === 0) return { headers: [], rows: [] };

  // Header row = the first row whose cells are mostly short, non-numeric labels
  // and which has the most filled cells among the first few candidates.
  let headerIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < Math.min(cleaned.length, 15); i++) {
    const row = cleaned[i].map((c) => String(c ?? '').trim());
    const filled = row.filter((c) => c !== '').length;
    const numeric = row.filter((c) => c !== '' && !Number.isNaN(parseAmount(c))).length;
    const score = filled - numeric * 2; // labels good, numbers bad
    if (filled >= 2 && score > bestScore) {
      bestScore = score;
      headerIdx = i;
    }
  }

  const rawHeaders = cleaned[headerIdx].map((c) => String(c ?? '').trim());
  const headers = rawHeaders.map((h, i) => (h === '' ? `Column ${i + 1}` : h));

  const rows: Record<string, string>[] = [];
  for (let i = headerIdx + 1; i < cleaned.length; i++) {
    const row = cleaned[i];
    const rec: Record<string, string> = {};
    let any = false;
    headers.forEach((h, c) => {
      const v = String(row[c] ?? '').trim();
      rec[h] = v;
      if (v !== '') any = true;
    });
    if (any) rows.push(rec);
  }

  return { headers, rows };
}

/** Read a file and propose a mapping, without committing anything. */
export async function inspectFile(file: File): Promise<ParsedFile> {
  const { headers, rows } = await readRows(file);
  return {
    fileName: file.name,
    headers,
    rows,
    suggestedMapping: detectMapping(headers, rows),
  };
}

// --- Normalization -----------------------------------------------------------

/** Tiny stable hash (FNV-1a) → base36 string, for de-dup ids. */
function hashId(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function cleanDescription(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Apply a mapping to parsed rows, producing normalized transactions. Rows that
 * lack a valid date or amount are skipped (returned in `skipped`).
 */
export function normalize(
  parsed: ParsedFile,
  mapping: ColumnMapping,
): { transactions: Transaction[]; skipped: number } {
  const importedAt = Date.now();
  const transactions: Transaction[] = [];
  let skipped = 0;

  for (const row of parsed.rows) {
    const date = parseDate(row[mapping.dateColumn]);
    if (!date) {
      skipped++;
      continue;
    }

    let amount: number;
    if (mapping.amountColumn) {
      const a = parseAmount(row[mapping.amountColumn]);
      if (Number.isNaN(a)) {
        skipped++;
        continue;
      }
      amount = mapping.positiveMeans === 'expense' ? -a : a;
    } else {
      const debit = parseAmount(row[mapping.debitColumn ?? '']);
      const credit = parseAmount(row[mapping.creditColumn ?? '']);
      const hasDebit = !Number.isNaN(debit) && Math.abs(debit) > 0;
      const hasCredit = !Number.isNaN(credit) && Math.abs(credit) > 0;
      if (!hasDebit && !hasCredit) {
        skipped++;
        continue;
      }
      amount = (hasCredit ? Math.abs(credit) : 0) - (hasDebit ? Math.abs(debit) : 0);
    }

    if (amount === 0) {
      skipped++;
      continue;
    }

    const description = cleanDescription(row[mapping.descriptionColumn] ?? '');
    const month = date.slice(0, 7);
    const id = hashId(`${date}|${amount.toFixed(2)}|${description.toLowerCase()}`);

    // Raw, unmodified value — no sign convention applied here (see lib/balances.ts).
    let balance: number | undefined;
    if (mapping.balanceColumn) {
      const b = parseAmount(row[mapping.balanceColumn]);
      if (!Number.isNaN(b)) balance = b;
    }

    transactions.push({
      id,
      date,
      amount,
      description,
      month,
      source: parsed.fileName,
      importedAt,
      ...(balance !== undefined ? { balance } : {}),
    });
  }

  // Storage doesn't preserve row order (IndexedDB keys transactions by their
  // content-hash id, so getAll() comes back in effectively arbitrary order) —
  // so anything that needs to know which of several same-day transactions
  // actually happened last (picking a running-balance anchor, sorting the
  // Date column) has nothing reliable to go on without this. Capture the
  // statement's own row order now, while we still have it, corrected for
  // whichever direction this particular file happens to run in, so a higher
  // `seq` always means "chronologically later" regardless of source order.
  let direction: 1 | -1 = 1;
  for (let i = 0; i < transactions.length - 1; i++) {
    if (transactions[i].date !== transactions[i + 1].date) {
      direction = transactions[i].date < transactions[i + 1].date ? 1 : -1;
      break;
    }
  }
  transactions.forEach((t, i) => {
    t.seq = direction === 1 ? i : transactions.length - 1 - i;
  });

  return { transactions, skipped };
}
