// IndexedDB persistence. Transactions accumulate here across months and years,
// so the user only ever uploads the *latest* statement — never their history.
// Everything stays on the user's device; nothing is sent to a server.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ImportResult, Transaction } from '../types';

interface CashFlowDB extends DBSchema {
  transactions: {
    key: string; // Transaction.id
    value: Transaction;
    indexes: { 'by-month': string; 'by-date': string };
  };
}

const DB_NAME = 'cashflow';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<CashFlowDB>> | null = null;

function getDB(): Promise<IDBPDatabase<CashFlowDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CashFlowDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('transactions', { keyPath: 'id' });
        store.createIndex('by-month', 'month');
        store.createIndex('by-date', 'date');
      },
    });
  }
  return dbPromise;
}

/** Load every stored transaction, sorted by date ascending. */
export async function getAllTransactions(): Promise<Transaction[]> {
  const db = await getDB();
  const all = await db.getAll('transactions');
  return all.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Insert transactions, skipping any whose id already exists. The id is a hash
 * of date+amount+description, so re-uploading an overlapping statement is safe
 * and won't double-count.
 */
export async function addTransactions(
  txs: Transaction[],
  fileName: string,
): Promise<ImportResult> {
  const db = await getDB();
  const tx = db.transaction('transactions', 'readwrite');
  const store = tx.objectStore('transactions');

  let added = 0;
  let duplicates = 0;
  for (const t of txs) {
    const existing = await store.get(t.id);
    if (existing) {
      duplicates++;
    } else {
      await store.put(t);
      added++;
    }
  }
  await tx.done;
  return { added, duplicates, fileName };
}

/** Remove every transaction imported from a given file name. */
export async function deleteBySource(source: string): Promise<number> {
  const db = await getDB();
  const all = await db.getAll('transactions');
  const tx = db.transaction('transactions', 'readwrite');
  let removed = 0;
  for (const t of all) {
    if (t.source === source) {
      await tx.objectStore('transactions').delete(t.id);
      removed++;
    }
  }
  await tx.done;
  return removed;
}

/** Wipe all stored data. */
export async function clearAll(): Promise<void> {
  const db = await getDB();
  await db.clear('transactions');
}
