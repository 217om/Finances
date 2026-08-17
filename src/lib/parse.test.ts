import { describe, expect, it } from 'vitest';
import type { ColumnMapping, ParsedFile } from '../types';
import { normalize, parseAmount, parseDate } from './parse';

describe('parseAmount', () => {
  it('parses plain numbers and strings', () => {
    expect(parseAmount(42)).toBe(42);
    expect(parseAmount('42.50')).toBe(42.5);
  });

  it('treats parentheses as negative (accounting style)', () => {
    expect(parseAmount('(45.00)')).toBe(-45);
  });

  it('treats a trailing DR as negative and CR as positive', () => {
    expect(parseAmount('100.00 DR')).toBe(-100);
    expect(parseAmount('100.00 CR')).toBe(100);
  });

  it('disambiguates US vs EU thousands/decimal separators', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56); // US
    expect(parseAmount('1.234,56')).toBe(1234.56); // EU
  });

  it('returns NaN for garbage input', () => {
    expect(parseAmount('')).toBeNaN();
    expect(parseAmount(null)).toBeNaN();
    expect(parseAmount('not a number')).toBeNaN();
  });
});

describe('parseDate', () => {
  it('parses plain ISO dates', () => {
    expect(parseDate('2026-08-17')).toBe('2026-08-17');
  });

  it('parses "12 Jan 2024" style dates', () => {
    expect(parseDate('12 Jan 2024')).toBe('2024-01-12');
  });

  it('returns null for unparseable input', () => {
    expect(parseDate('not a date')).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
});

function parsedFile(rows: Record<string, string>[]): ParsedFile {
  return { fileName: 'test.csv', headers: ['Date', 'Description', 'Amount'], rows, suggestedMapping: null };
}

const mapping: ColumnMapping = {
  dateColumn: 'Date',
  descriptionColumn: 'Description',
  amountColumn: 'Amount',
  positiveMeans: 'income',
};

describe('normalize', () => {
  it('produces one transaction per valid row, skipping rows with no date/amount', () => {
    const parsed = parsedFile([
      { Date: '2026-08-01', Description: 'Salary', Amount: '1000' },
      { Date: '', Description: 'No date', Amount: '10' },
      { Date: '2026-08-02', Description: 'No amount', Amount: '' },
    ]);
    const { transactions, skipped } = normalize(parsed, mapping);
    expect(transactions).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it('gives identical rows the same content-hash id (de-dup on re-import)', () => {
    const parsed = parsedFile([{ Date: '2026-08-01', Description: 'Coffee', Amount: '-5' }]);
    const first = normalize(parsed, mapping).transactions[0];
    const second = normalize(parsed, mapping).transactions[0];
    expect(first.id).toBe(second.id);
  });

  it('gives different rows different ids', () => {
    const parsed = parsedFile([
      { Date: '2026-08-01', Description: 'Coffee', Amount: '-5' },
      { Date: '2026-08-02', Description: 'Coffee', Amount: '-5' },
    ]);
    const [a, b] = normalize(parsed, mapping).transactions;
    expect(a.id).not.toBe(b.id);
  });

  it('assigns a direction-corrected seq so higher seq always means chronologically later', () => {
    // Newest-first statement (common bank export order).
    const newestFirst = parsedFile([
      { Date: '2026-08-03', Description: 'C', Amount: '-1' },
      { Date: '2026-08-02', Description: 'B', Amount: '-1' },
      { Date: '2026-08-01', Description: 'A', Amount: '-1' },
    ]);
    const txs = normalize(newestFirst, mapping).transactions;
    // Regardless of the file's own row order, the later date must have the
    // higher seq — that's the whole point of direction correction.
    const byDesc = Object.fromEntries(txs.map((t) => [t.description, t.seq]));
    expect(byDesc.A).toBeLessThan(byDesc.B!);
    expect(byDesc.B).toBeLessThan(byDesc.C!);
  });

  it('assigns seq consistently for an oldest-first statement too', () => {
    const oldestFirst = parsedFile([
      { Date: '2026-08-01', Description: 'A', Amount: '-1' },
      { Date: '2026-08-02', Description: 'B', Amount: '-1' },
      { Date: '2026-08-03', Description: 'C', Amount: '-1' },
    ]);
    const txs = normalize(oldestFirst, mapping).transactions;
    const byDesc = Object.fromEntries(txs.map((t) => [t.description, t.seq]));
    expect(byDesc.A).toBeLessThan(byDesc.B!);
    expect(byDesc.B).toBeLessThan(byDesc.C!);
  });

  it('applies positiveMeans: expense by flipping the sign', () => {
    const parsed = parsedFile([{ Date: '2026-08-01', Description: 'X', Amount: '50' }]);
    const expenseMapping: ColumnMapping = { ...mapping, positiveMeans: 'expense' };
    expect(normalize(parsed, expenseMapping).transactions[0].amount).toBe(-50);
  });

  it('supports separate debit/credit columns instead of one signed amount', () => {
    const debitCreditMapping: ColumnMapping = {
      dateColumn: 'Date',
      descriptionColumn: 'Description',
      debitColumn: 'Debit',
      creditColumn: 'Credit',
      positiveMeans: 'income',
    };
    const parsed: ParsedFile = {
      fileName: 'test.csv',
      headers: ['Date', 'Description', 'Debit', 'Credit'],
      rows: [
        { Date: '2026-08-01', Description: 'Spent', Debit: '20', Credit: '' },
        { Date: '2026-08-02', Description: 'Received', Debit: '', Credit: '30' },
      ],
      suggestedMapping: null,
    };
    const { transactions } = normalize(parsed, debitCreditMapping);
    expect(transactions[0].amount).toBe(-20);
    expect(transactions[1].amount).toBe(30);
  });
});
