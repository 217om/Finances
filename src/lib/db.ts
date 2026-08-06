// IndexedDB persistence. Transactions accumulate here across months and years,
// so the user only ever uploads the *latest* statement — never their history.
// Everything stays on the user's device; nothing is sent to a server.
//
// Each "card" (account) the user analyzes gets its own physically separate
// database, so transactions, rules, and overrides never mix between cards.
// The very first card keeps the original database name ('cashflow') so
// existing users' data loads with no migration.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  CategoryOverride,
  CategoryRule,
  ImportResult,
  KeywordRule,
  SubOverride,
  SubRule,
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
  subRules: {
    key: string; // SubRule.id
    value: SubRule;
  };
  subOverrides: {
    key: string; // SubOverride.id (transaction id)
    value: SubOverride;
  };
}

const DB_VERSION = 4;

const dbCache = new Map<string, Promise<IDBPDatabase<CashFlowDB>>>();
const activeDbs = new Map<string, IDBPDatabase<CashFlowDB>>();
let blockedListener: ((dbName: string) => void) | null = null;

/** Notified when opening a database is blocked by another tab holding it open. */
export function onDatabaseBlocked(fn: ((dbName: string) => void) | null): void {
  blockedListener = fn;
}

function getDB(dbName: string): Promise<IDBPDatabase<CashFlowDB>> {
  let promise = dbCache.get(dbName);
  if (!promise) {
    promise = openDB<CashFlowDB>(dbName, DB_VERSION, {
      blocked() {
        // Another (older) tab is holding this database open and blocking our upgrade.
        console.warn(`CashFlow: opening "${dbName}" is blocked by another open tab.`);
        blockedListener?.(dbName);
      },
      blocking() {
        // A newer version wants to upgrade in another tab — release our
        // connection so it can proceed instead of blocking it.
        try {
          activeDbs.get(dbName)?.close();
        } catch {
          /* ignore */
        }
        activeDbs.delete(dbName);
        dbCache.delete(dbName);
      },
      terminated() {
        // Let the next call re-open instead of reusing a dead connection.
        activeDbs.delete(dbName);
        dbCache.delete(dbName);
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
        if (oldVersion < 4) {
          db.createObjectStore('subRules', { keyPath: 'id' });
          db.createObjectStore('subOverrides', { keyPath: 'id' });
        }
      },
    });
    dbCache.set(dbName, promise);
    promise.then((db) => activeDbs.set(dbName, db)).catch(() => dbCache.delete(dbName));
  }
  return promise;
}

/** Permanently delete a card's database (used when deleting a card). */
export async function deleteCardDatabase(dbName: string): Promise<void> {
  const active = activeDbs.get(dbName);
  active?.close();
  activeDbs.delete(dbName);
  dbCache.delete(dbName);
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // best-effort; it'll finish once tabs close
  });
}

/** Load every stored transaction, sorted by date ascending. */
export async function getAllTransactions(dbName: string): Promise<Transaction[]> {
  const db = await getDB(dbName);
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
  dbName: string,
  txs: Transaction[],
  fileName: string,
): Promise<ImportResult> {
  const db = await getDB(dbName);
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
export async function deleteBySource(dbName: string, source: string): Promise<number> {
  const db = await getDB(dbName);
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
export async function clearAll(dbName: string): Promise<void> {
  const db = await getDB(dbName);
  await Promise.all([
    db.clear('transactions'),
    db.clear('rules'),
    db.clear('overrides'),
    db.clear('keywordRules'),
    db.clear('subRules'),
    db.clear('subOverrides'),
  ]);
}

/**
 * Remove only the transactions, keeping every rule/override/keyword/
 * sub-category built up so far — a clean slate for re-importing statements
 * without losing the categorization work already done. Manual per-
 * transaction overrides are left in place too: since transaction ids are
 * content hashes, re-importing the same statement later reactivates them.
 */
export async function clearTransactionsOnly(dbName: string): Promise<void> {
  const db = await getDB(dbName);
  await db.clear('transactions');
}

/** Permanently delete one transaction. */
export async function deleteTransaction(dbName: string, id: string): Promise<void> {
  const db = await getDB(dbName);
  await db.delete('transactions', id);
}

/** Set (or, given an empty/whitespace-only string, clear) one transaction's
 *  note. A no-op if the transaction isn't found — e.g. a stale id from a
 *  view that hasn't refreshed yet. */
export async function setTransactionNote(dbName: string, id: string, note: string): Promise<void> {
  const db = await getDB(dbName);
  const existing = await db.get('transactions', id);
  if (!existing) return;
  const trimmed = note.trim();
  const updated: Transaction = { ...existing };
  if (trimmed) {
    updated.note = trimmed;
  } else {
    delete updated.note;
  }
  await db.put('transactions', updated);
}

// --- Category rules & overrides ----------------------------------------------

export async function getRules(dbName: string): Promise<CategoryRule[]> {
  const db = await getDB(dbName);
  return db.getAll('rules');
}

export async function getOverrides(dbName: string): Promise<CategoryOverride[]> {
  const db = await getDB(dbName);
  return db.getAll('overrides');
}

/** Upsert rules and overrides in one transaction. */
export async function saveCategorization(
  dbName: string,
  rules: CategoryRule[],
  overrides: CategoryOverride[],
): Promise<void> {
  const db = await getDB(dbName);
  const tx = db.transaction(['rules', 'overrides'], 'readwrite');
  for (const r of rules) await tx.objectStore('rules').put(r);
  for (const o of overrides) await tx.objectStore('overrides').put(o);
  await tx.done;
}

/** Remove a single rule by signature. */
export async function deleteRule(dbName: string, signature: string): Promise<void> {
  const db = await getDB(dbName);
  await db.delete('rules', signature);
}

/** Upsert a single per-transaction category override. */
export async function saveOverride(dbName: string, override: CategoryOverride): Promise<void> {
  const db = await getDB(dbName);
  await db.put('overrides', override);
}

/** Remove a per-transaction override (revert to auto categorization). */
export async function deleteOverride(dbName: string, id: string): Promise<void> {
  const db = await getDB(dbName);
  await db.delete('overrides', id);
}

/** Reset all user categorization (keeps transactions). */
export async function clearCategorization(dbName: string): Promise<void> {
  const db = await getDB(dbName);
  await Promise.all([
    db.clear('rules'),
    db.clear('overrides'),
    db.clear('keywordRules'),
    db.clear('subRules'),
    db.clear('subOverrides'),
  ]);
}

/** Clear only the rule definitions (signature rules, keyword rules,
 *  sub-rules) — used when migrating a card's rules into the global store, so
 *  its transactions, overrides, and sub-overrides are left untouched. */
export async function clearRuleDefinitions(dbName: string): Promise<void> {
  const db = await getDB(dbName);
  await Promise.all([db.clear('rules'), db.clear('keywordRules'), db.clear('subRules')]);
}

// --- Keyword refinement rules ------------------------------------------------

export async function getKeywordRules(dbName: string): Promise<KeywordRule[]> {
  const db = await getDB(dbName);
  return db.getAll('keywordRules');
}

/** Upsert a keyword rule (keyed by keyword). */
export async function saveKeywordRule(dbName: string, rule: KeywordRule): Promise<void> {
  const db = await getDB(dbName);
  await db.put('keywordRules', rule);
}

/** Bulk upsert keyword rules in one transaction (e.g. copying from another card). */
export async function saveKeywordRules(dbName: string, rules: KeywordRule[]): Promise<void> {
  const db = await getDB(dbName);
  const tx = db.transaction('keywordRules', 'readwrite');
  for (const r of rules) void tx.store.put(r);
  await tx.done;
}

export async function deleteKeywordRule(dbName: string, keyword: string): Promise<void> {
  const db = await getDB(dbName);
  await db.delete('keywordRules', keyword);
}

// --- Sub-category rules & overrides ------------------------------------------

export async function getSubRules(dbName: string): Promise<SubRule[]> {
  const db = await getDB(dbName);
  return db.getAll('subRules');
}

export async function getSubOverrides(dbName: string): Promise<SubOverride[]> {
  const db = await getDB(dbName);
  return db.getAll('subOverrides');
}

/** Bulk upsert sub-rules in one transaction (e.g. copying from another card). */
export async function saveSubRules(dbName: string, rules: SubRule[]): Promise<void> {
  const db = await getDB(dbName);
  const tx = db.transaction('subRules', 'readwrite');
  for (const r of rules) void tx.store.put(r);
  await tx.done;
}

export async function saveSubOverride(dbName: string, override: SubOverride): Promise<void> {
  const db = await getDB(dbName);
  await db.put('subOverrides', override);
}

/** Bulk upsert sub-overrides in one transaction (for multi-select assignment). */
export async function saveSubOverrides(dbName: string, overrides: SubOverride[]): Promise<void> {
  const db = await getDB(dbName);
  const tx = db.transaction('subOverrides', 'readwrite');
  for (const o of overrides) void tx.store.put(o);
  await tx.done;
}

/** Bulk delete sub-overrides in one transaction (revert to automatic/Unsorted). */
export async function deleteSubOverrides(dbName: string, ids: string[]): Promise<void> {
  const db = await getDB(dbName);
  const tx = db.transaction('subOverrides', 'readwrite');
  for (const id of ids) void tx.store.delete(id);
  await tx.done;
}

export async function deleteSubOverride(dbName: string, id: string): Promise<void> {
  const db = await getDB(dbName);
  await db.delete('subOverrides', id);
}

/** Remove a single sub-rule by id. */
export async function deleteSubRule(dbName: string, id: string): Promise<void> {
  const db = await getDB(dbName);
  await db.delete('subRules', id);
}
