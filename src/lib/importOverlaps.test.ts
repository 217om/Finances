import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../types';
import { addTransactions, getAllTransactions } from './db';
import { findImportOverlaps } from './importOverlaps';
import { normalize } from './parse';

let dbCounter = 0;
const dbName = () => `import-tests-${++dbCounter}`;
function row(id: string, fields: Partial<Transaction> = {}): Transaction {
  return { id, date: '2026-10-22', month: '2026-10', description: 'EXAMPLE CAFE', amount: -7.245, source: 'statement.csv', importedAt: 1, ...fields };
}
const sms = (id = 'sms-1', fields: Partial<Transaction> = {}) => row(id, { importKind: 'google-sheet', source: 'Google Sheets', description: 'CAFE', ...fields });

describe('overlap review', () => {
  it('suggests cross-source matches in either import order', () => {
    expect(findImportOverlaps([sms()], [row('bank')]).get('sms-1')?.id).toBe('bank');
    expect(findImportOverlaps([row('bank')], [sms()]).get('bank')?.id).toBe('sms-1');
  });
  it('does not suggest different dates, directions, precision or same-source payments', () => {
    expect(findImportOverlaps([sms()], [row('bank', { amount: -7.244 })]).size).toBe(0);
    expect(findImportOverlaps([sms()], [row('bank', { amount: 7.245 })]).size).toBe(0);
    expect(findImportOverlaps([sms()], [row('bank', { date: '2026-10-23' })]).size).toBe(0);
    expect(findImportOverlaps([sms()], [sms('sms-2')]).size).toBe(0);
  });
  it('matches one-to-one and reserves existing exact matches', () => {
    expect(findImportOverlaps([sms('sms-1'), sms('sms-2')], [row('bank')]).size).toBe(1);
    expect(findImportOverlaps([sms(), row('bank')], [row('bank')]).size).toBe(0);
    expect(findImportOverlaps([sms('known'), sms('new')], [row('bank', { importAliases: ['known'] })]).size).toBe(0);
  });
});

describe('persisted import de-duplication', () => {
  it.each(['sheet-first', 'statement-first'])('counts a reviewed overlap once (%s) and remembers it on refresh', async (order) => {
    const db = dbName();
    const [first, second] = order === 'sheet-first' ? [sms(), row('bank', { balance: 800 })] : [row('bank', { balance: 800 }), sms()];
    await addTransactions(db, [first], first.source);
    const result = await addTransactions(db, [second], second.source, new Map([[second.id, first.id]]));
    expect(result).toMatchObject({ added: 0, duplicates: 1 });
    const repeat = await addTransactions(db, [second], second.source);
    expect(repeat).toMatchObject({ added: 0, duplicates: 1 });
    const stored = await getAllTransactions(db);
    expect(stored).toHaveLength(1);
    expect(stored[0].balance).toBe(800);
    expect(stored[0].description).toBe(first.description);
    expect(findImportOverlaps([second], stored).size).toBe(0);
  });
  it('matches identical normalized content across sheet and statement without review', async () => {
    const db = dbName();
    await addTransactions(db, [row('bank')], 'statement');
    expect(await addTransactions(db, [sms('sms-1', { description: 'example cafe' })], 'sheet')).toMatchObject({ added: 0, duplicates: 1 });
  });
  it('keeps two legitimate same-day, same-amount sheet payments with different references', async () => {
    const db = dbName();
    expect(await addTransactions(db, [sms('one'), sms('two')], 'sheet')).toMatchObject({ added: 2 });
    expect(await addTransactions(db, [sms('one'), sms('two')], 'sheet')).toMatchObject({ added: 0, duplicates: 2 });
    expect(await getAllTransactions(db)).toHaveLength(2);
  });
  it('preserves payments when the user keeps a possible overlap separate', async () => {
    const db = dbName();
    await addTransactions(db, [row('bank')], 'statement');
    expect(await addTransactions(db, [sms()], 'sheet', new Map())).toMatchObject({ added: 1 });
    expect(await getAllTransactions(db)).toHaveLength(2);
  });
  it('does not reuse one matched transaction for two incoming payments', async () => {
    const db = dbName();
    await addTransactions(db, [row('bank')], 'statement');
    expect(await addTransactions(db, [sms('one'), sms('two')], 'sheet', new Map([['one', 'bank'], ['two', 'bank']]))).toMatchObject({ added: 1, duplicates: 1 });
  });
  it('keeps cards isolated and rejects stale or invalid reviewed matches', async () => {
    const db = dbName();
    await addTransactions(db, [row('bank')], 'statement');
    expect(await addTransactions(dbName(), [sms()], 'sheet')).toMatchObject({ added: 1 });
    expect(await addTransactions(db, [sms('different', { amount: -2 })], 'sheet', new Map([['different', 'bank']]))).toMatchObject({ added: 1 });
  });
  it('retains duplicate aliases when merging a newer backup into existing data', async () => {
    const db = dbName();
    await addTransactions(db, [row('bank')], 'statement');
    await addTransactions(db, [row('bank', { importAliases: ['sms-1'] })], 'backup');
    expect(await addTransactions(db, [sms()], 'sheet')).toMatchObject({ added: 0, duplicates: 1 });
    expect((await getAllTransactions(db))[0].importAliases).toContain('sms-1');
  });
  it('uses statement ordering when adding a running balance to an SMS transaction', async () => {
    const db = dbName();
    await addTransactions(db, [sms('sms-1', { seq: 9, importedAt: 1, note: 'Keep this note' })], 'sheet');
    await addTransactions(db, [row('bank', { seq: 2, importedAt: 20, balance: 800 })], 'statement', new Map([['bank', 'sms-1']]));
    expect((await getAllTransactions(db))[0]).toMatchObject({ id: 'sms-1', seq: 2, importedAt: 20, balance: 800, note: 'Keep this note' });
  });
  it('does not collapse OMR precision or break legacy two-decimal hashes', async () => {
    const parsed = { fileName: 'bank.csv', headers: ['Date', 'Amount', 'Description'], rows: [
      { Date: '2026-10-22', Amount: '-7.241', Description: 'CAFE' },
      { Date: '2026-10-22', Amount: '-7.244', Description: 'CAFE' },
      { Date: '2026-10-22', Amount: '-7.24', Description: 'CAFE' },
    ], suggestedMapping: null };
    const mapping = { dateColumn: 'Date', descriptionColumn: 'Description', amountColumn: 'Amount', positiveMeans: 'income' as const };
    const incoming = normalize(parsed, mapping).transactions;
    expect(new Set(incoming.map((t) => t.id)).size).toBe(3);
    const db = dbName();
    // Legacy -7.241 used the same hash that -7.24 still uses today.
    await addTransactions(db, [{ ...incoming[0], id: incoming[2].id }], 'legacy');
    expect(await addTransactions(db, incoming, 'new')).toMatchObject({ added: 2, duplicates: 1 });
    expect(await addTransactions(db, incoming, 'repeat')).toMatchObject({ added: 0, duplicates: 3 });
    expect(await getAllTransactions(db)).toHaveLength(3);
  });
});
