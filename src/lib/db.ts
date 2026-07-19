// IndexedDB persistence. Transactions accumulate here across months and years,
// so the user only ever uploads the *latest* statement — never their history.
// Everything stays on the user's device; nothing is sent to a server.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  CategoryOverride,
  CategoryRule,
  ImportResult,
  KeywordRule,
  Transaction,
} from '../types';

interface CashFlowDB extends DBSchema {
  transactions: {
    key: string; // Transaction.id
    value: Transaction;
    indexes: { 'by-month': string; 'by-date': string };
  };
  rules: {
    key: string; // CategoryRule.signature
    value: CategoryRule;
  };
  overrides: {
    key: string; // CategoryOverride.id (transaction id)
    value: CategoryOverride;
  };
  keywordRules: {
    key: string; // KeywordRule.keyword
    value: KeywordRule;
  };
}

const DB_NAME = 'cashflow';
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase<CashFlowDB>> | null = null;

function getDB(): Promise<IDBPDatabase<CashFlowDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CashFlowDB>(DB_NAME, DB_VERSION, {
      blocked() {
        console.warn('CashFlow: opening the database is blocked by another open tab.');
      },
      blocking() {
        // Another tab needs to upgrade; nothing to release here.
      },
      terminated() {
        // Let the next call re-open instead of reusing a dead connection.
        dbPromise = null;
      },
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const store = db.createObjectStore('transactions', { keyPath: 'id' });
          store.createIndex('by-month', 'month');
          store.createIndex('by-date', 'date');
        }
        if (oldVersion < 2) {
          db.createObjectStore('rules', { keyPath: 'signature' });
          db.createObjectStore('overrides', { keyPath: 'id' });
        }
        if (oldVersion < 3) {
          db.createObjectStore('keywordRules', { keyPath: 'keyword' });
        }
      },
    });
  }
  return dbPromise;
}

/** Load every stored transaction, sorted by date ascending. */
export async function getAllTransactions(): Promise<Transaction[]> {
  const db = await getDB();
  const all = await db.getAll('transactions');
  // ISO date strings sort correctly with a plain comparison, which is far
  // faster than localeCompare across tens of thousands of rows.
  all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return all;
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

  // Fetch existing keys once instead of an awaited lookup per row, then queue
  // puts without awaiting each — a large import goes from thousands of
  // round-trips to one key scan plus a batch of writes.
  const existing = new Set<string>((await store.getAllKeys()) as string[]);

  let added = 0;
  let duplicates = 0;
  for (const t of txs) {
    if (existing.has(t.id)) {
      duplicates++;
      continue;
    }
    existing.add(t.id); // also de-dupes identical rows within this file
    void store.put(t);
    added++;
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

/** Wipe all stored data, including category rules and overrides. */
export async function clearAll(): Promise<void> {
  const db = await getDB();
  await Promise.all([
    db.clear('transactions'),
    db.clear('rules'),
    db.clear('overrides'),
    db.clear('keywordRules'),
  ]);
}

// --- Category rules & overrides ----------------------------------------------

export async function getRules(): Promise<CategoryRule[]> {
  const db = await getDB();
  return db.getAll('rules');
}

export async function getOverrides(): Promise<CategoryOverride[]> {
  const db = await getDB();
  return db.getAll('overrides');
}

/** Upsert rules and overrides in one transaction. */
export async function saveCategorization(
  rules: CategoryRule[],
  overrides: CategoryOverride[],
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['rules', 'overrides'], 'readwrite');
  for (const r of rules) await tx.objectStore('rules').put(r);
  for (const o of overrides) await tx.objectStore('overrides').put(o);
  await tx.done;
}

/** Remove a single rule by signature. */
export async function deleteRule(signature: string): Promise<void> {
  const db = await getDB();
  await db.delete('rules', signature);
}

/** Upsert a single per-transaction category override. */
export async function saveOverride(override: CategoryOverride): Promise<void> {
  const db = await getDB();
  await db.put('overrides', override);
}

/** Remove a per-transaction override (revert to auto categorization). */
export async function deleteOverride(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('overrides', id);
}

/** Reset all user categorization (keeps transactions). */
export async function clearCategorization(): Promise<void> {
  const db = await getDB();
  await Promise.all([db.clear('rules'), db.clear('overrides'), db.clear('keywordRules')]);
}

// --- Keyword refinement rules ------------------------------------------------

export async function getKeywordRules(): Promise<KeywordRule[]> {
  const db = await getDB();
  return db.getAll('keywordRules');
}

/** Upsert a keyword rule (keyed by keyword). */
export async function saveKeywordRule(rule: KeywordRule): Promise<void> {
  const db = await getDB();
  await db.put('keywordRules', rule);
}

export async function deleteKeywordRule(keyword: string): Promise<void> {
  const db = await getDB();
  await db.delete('keywordRules', keyword);
}
