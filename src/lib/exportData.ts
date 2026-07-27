// Backup / restore / CSV export. Everything runs in the browser; files are
// generated client-side and downloaded directly.

import type { CategoryOverride, CategoryRule, KeywordRule, SubOverride, SubRule, Transaction } from '../types';
import { categorize } from './categorize';
import {
  CATEGORY_FILTER_KEY,
  CURRENCY_KEY,
  CUSTOM_CATEGORIES_KEY,
  MONTH_START_KEY,
  THEME_KEY,
  saveActiveCardId,
  saveCards,
  scopedKey,
  type Card,
} from './cards';
import {
  addTransactions,
  getAllTransactions,
  getKeywordRules,
  getOverrides,
  getRules,
  getSubOverrides,
  getSubRules,
  saveCategorization,
  saveKeywordRules,
  saveSubOverrides,
  saveSubRules,
} from './db';
import { getAllNotes, saveNote, type Note } from './notes';
import { defaultCategoryFilter, isValidCategoryFilter, type CategoryFilterState } from './categoryFilter';

const BACKUP_MAGIC = 'cashflow-backup';
const BACKUP_VERSION = 1;

interface BackupFile {
  app: typeof BACKUP_MAGIC;
  version: number;
  exportedAt: string;
  transactions: Transaction[];
}

const FULL_BACKUP_MAGIC = 'cashflow-full-backup';
const FULL_BACKUP_VERSION = 1;

interface CardBackup {
  id: string;
  name: string;
  dbName: string;
  createdAt: number;
  currency: string | null;
  monthStartDay: number | null;
  customCategories: string[];
  categoryFilter: CategoryFilterState;
  transactions: Transaction[];
  rules: CategoryRule[];
  overrides: CategoryOverride[];
  keywordRules: KeywordRule[];
  subRules: SubRule[];
  subOverrides: SubOverride[];
}

export interface FullBackupFile {
  app: typeof FULL_BACKUP_MAGIC;
  version: number;
  exportedAt: string;
  theme: 'light' | 'dark';
  activeCardId: string;
  cards: CardBackup[];
  notes: Note[];
}

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function readJSON(key: string): unknown {
  try {
    return JSON.parse(readLS(key) ?? 'null');
  } catch {
    return null;
  }
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function triggerDownload(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Download a full-fidelity JSON backup that can be restored later. */
export function downloadBackup(txs: Transaction[]): void {
  const payload: BackupFile = {
    app: BACKUP_MAGIC,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    transactions: txs,
  };
  triggerDownload(JSON.stringify(payload, null, 2), `cashflow-backup-${stamp()}.json`, 'application/json');
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Download the full history as a clean, spreadsheet-friendly CSV. */
export function downloadCSV(txs: Transaction[]): void {
  const header = ['Date', 'Description', 'Amount', 'Type', 'Category', 'Source'];
  const lines = [header.join(',')];
  for (const t of [...txs].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push(
      [
        csvCell(t.date),
        csvCell(t.description),
        csvCell(t.amount.toFixed(2)),
        csvCell(t.amount >= 0 ? 'Income' : 'Expense'),
        csvCell(categorize(t.description, t.amount)),
        csvCell(t.source),
      ].join(','),
    );
  }
  triggerDownload(lines.join('\n'), `cashflow-transactions-${stamp()}.csv`, 'text/csv');
}

/** True if a filename looks like a JSON backup. */
export function isBackupFile(name: string): boolean {
  return /\.json$/i.test(name);
}

/**
 * Parse a CashFlow JSON backup back into transactions, or throw if the file
 * isn't a valid backup. Tolerant of minor shape differences.
 */
export function parseBackup(text: string): Transaction[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const obj = data as Partial<BackupFile>;
  if (obj.app !== BACKUP_MAGIC || !Array.isArray(obj.transactions)) {
    throw new Error('That JSON is not a CashFlow backup.');
  }
  const txs = obj.transactions.filter(
    (t): t is Transaction =>
      !!t &&
      typeof t.id === 'string' &&
      typeof t.date === 'string' &&
      typeof t.amount === 'number' &&
      typeof t.month === 'string',
  );
  if (txs.length === 0) throw new Error('The backup contained no transactions.');
  return txs;
}

/**
 * Gathers everything the app has stored — every card's transactions,
 * categorization, and preferences, plus the global notes and theme — into one
 * restorable snapshot. This is the "insurance" backup: unlike the per-card
 * JSON/CSV exports above, restoring it recreates the whole app's state.
 */
export async function buildFullBackup(
  cards: Card[],
  activeCardId: string,
  theme: 'light' | 'dark',
): Promise<FullBackupFile> {
  const cardBackups = await Promise.all(
    cards.map(async (card): Promise<CardBackup> => {
      const [transactions, rules, overrides, keywordRules, subRules, subOverrides] = await Promise.all([
        getAllTransactions(card.dbName),
        getRules(card.dbName),
        getOverrides(card.dbName),
        getKeywordRules(card.dbName),
        getSubRules(card.dbName),
        getSubOverrides(card.dbName),
      ]);
      const monthStartDay = Number(readLS(scopedKey(MONTH_START_KEY, card.id)));
      const customCategoriesRaw = readJSON(scopedKey(CUSTOM_CATEGORIES_KEY, card.id));
      const categoryFilterRaw = readJSON(scopedKey(CATEGORY_FILTER_KEY, card.id));
      return {
        id: card.id,
        name: card.name,
        dbName: card.dbName,
        createdAt: card.createdAt,
        currency: readLS(scopedKey(CURRENCY_KEY, card.id)),
        monthStartDay: monthStartDay >= 1 && monthStartDay <= 28 ? monthStartDay : null,
        customCategories: Array.isArray(customCategoriesRaw)
          ? customCategoriesRaw.filter((c): c is string => typeof c === 'string')
          : [],
        categoryFilter: isValidCategoryFilter(categoryFilterRaw) ? categoryFilterRaw : defaultCategoryFilter(),
        transactions,
        rules,
        overrides,
        keywordRules,
        subRules,
        subOverrides,
      };
    }),
  );

  return {
    app: FULL_BACKUP_MAGIC,
    version: FULL_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    theme,
    activeCardId,
    cards: cardBackups,
    notes: await getAllNotes(),
  };
}

export function downloadFullBackup(backup: FullBackupFile): void {
  triggerDownload(JSON.stringify(backup), `cashflow-full-backup-${stamp()}.json`, 'application/json');
}

/** Parse a full-app backup file, or throw if it isn't one. */
export function parseFullBackup(text: string): FullBackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const obj = data as Partial<FullBackupFile>;
  if (obj.app !== FULL_BACKUP_MAGIC || !Array.isArray(obj.cards)) {
    throw new Error('That JSON is not a CashFlow full backup.');
  }
  return obj as FullBackupFile;
}

/**
 * Restores a full backup on top of whatever's already stored. Additive, not
 * destructive: transactions are de-duped by id, cards that already exist
 * (matched by id) are merged into, and cards not present locally are added —
 * nothing existing is deleted.
 */
export async function restoreFullBackup(
  backup: FullBackupFile,
  existingCards: Card[],
): Promise<{ cards: Card[]; activeCardId: string; theme: 'light' | 'dark' }> {
  let cards = existingCards;

  for (const cb of backup.cards) {
    if (!cards.some((c) => c.id === cb.id)) {
      cards = [...cards, { id: cb.id, name: cb.name, dbName: cb.dbName, createdAt: cb.createdAt }];
    }
    const dbName = cards.find((c) => c.id === cb.id)!.dbName;

    await addTransactions(dbName, cb.transactions, `restore-${cb.name}`);
    await saveCategorization(dbName, cb.rules, cb.overrides);
    await saveKeywordRules(dbName, cb.keywordRules);
    await saveSubRules(dbName, cb.subRules);
    await saveSubOverrides(dbName, cb.subOverrides);

    if (cb.currency) writeLS(scopedKey(CURRENCY_KEY, cb.id), cb.currency);
    if (cb.monthStartDay) writeLS(scopedKey(MONTH_START_KEY, cb.id), String(cb.monthStartDay));
    if (cb.customCategories.length > 0) {
      writeLS(scopedKey(CUSTOM_CATEGORIES_KEY, cb.id), JSON.stringify(cb.customCategories));
    }
    writeLS(scopedKey(CATEGORY_FILTER_KEY, cb.id), JSON.stringify(cb.categoryFilter));
  }

  for (const note of backup.notes) {
    await saveNote(note);
  }

  if (backup.theme) writeLS(THEME_KEY, backup.theme);
  saveCards(cards);
  const activeCardId = cards.some((c) => c.id === backup.activeCardId) ? backup.activeCardId : cards[0].id;
  saveActiveCardId(activeCardId);

  return { cards, activeCardId, theme: backup.theme === 'dark' ? 'dark' : 'light' };
}
