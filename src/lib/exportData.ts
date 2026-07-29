// Backup / restore / CSV export. Everything runs in the browser; files are
// generated client-side and downloaded directly.

import type { CategoryOverride, CategoryRule, KeywordRule, SubOverride, SubRule, Transaction } from '../types';
import { categorize } from './categorize';
import {
  CATEGORY_FILTER_KEY,
  COMBINED_CATEGORY_FILTER_KEY,
  CATEGORY_FILTER_PRESETS_KEY,
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
import {
  defaultCategoryFilter,
  isValidCategoryFilter,
  unionCategoryFilter,
  type CategoryFilterState,
} from './categoryFilter';
import { isValidPresetList, mergePresets, type CategoryFilterPreset } from './categoryFilterPresets';

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
  /** Global (not per-card) preferences — see lib/cards.ts. */
  combinedCategoryFilter: CategoryFilterState;
  filterPresets: CategoryFilterPreset[];
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
  const header = ['Date', 'Description', 'Amount', 'Type', 'Category', 'Source', 'Note'];
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
        csvCell(t.note ?? ''),
      ].join(','),
    );
  }
  triggerDownload(lines.join('\n'), `cashflow-transactions-${stamp()}.csv`, 'text/csv');
}

/** True if a filename looks like a JSON backup. */
export function isBackupFile(name: string): boolean {
  return /\.json$/i.test(name);
}

/** Which kind of CashFlow backup a JSON file is, without throwing — used to
 *  route a dropped file to the right restore path (per-card vs. full). */
export function sniffBackupKind(text: string): 'card' | 'full' | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const app = (data as { app?: unknown } | null)?.app;
  if (app === FULL_BACKUP_MAGIC) return 'full';
  if (app === BACKUP_MAGIC) return 'card';
  return null;
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
  combinedCategoryFilter: CategoryFilterState,
  filterPresets: CategoryFilterPreset[],
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
    combinedCategoryFilter,
    filterPresets,
  };
}

export function downloadFullBackup(backup: FullBackupFile): void {
  triggerDownload(JSON.stringify(backup), `cashflow-full-backup-${stamp()}.json`, 'application/json');
}

/** Parse a full-app backup file, or throw if it isn't one. Only the magic
 *  marker and top-level card list are checked here — everything else is
 *  validated field-by-field in restoreFullBackup, which tolerates a
 *  malformed or older backup instead of aborting the whole restore. */
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

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function isValidNote(v: unknown): v is Note {
  if (!v || typeof v !== 'object') return false;
  const n = v as Record<string, unknown>;
  return (
    typeof n.id === 'string' &&
    typeof n.title === 'string' &&
    typeof n.body === 'string' &&
    typeof n.createdAt === 'number' &&
    typeof n.updatedAt === 'number'
  );
}

/**
 * Restores a full backup on top of whatever's already stored. Additive, not
 * destructive: transactions are de-duped by id, cards that already exist
 * (matched by id) are merged into, cards not present locally are added, the
 * combined view's filter is unioned rather than replaced, and presets are
 * merged by id — nothing existing is ever deleted. Tolerant of a malformed
 * or older backup file too: a missing or invalid field falls back to a
 * sensible default (or is skipped) instead of aborting the whole restore.
 */
export async function restoreFullBackup(
  backup: FullBackupFile,
  existingCards: Card[],
  existingCombinedCategoryFilter: CategoryFilterState,
  existingFilterPresets: CategoryFilterPreset[],
): Promise<{
  cards: Card[];
  activeCardId: string;
  theme: 'light' | 'dark';
  combinedCategoryFilter: CategoryFilterState;
  filterPresets: CategoryFilterPreset[];
}> {
  let cards = existingCards;

  for (const cb of backup.cards) {
    if (!cb || typeof cb.id !== 'string' || typeof cb.dbName !== 'string') continue;
    if (!cards.some((c) => c.id === cb.id)) {
      cards = [
        ...cards,
        { id: cb.id, name: cb.name || 'Card', dbName: cb.dbName, createdAt: cb.createdAt || Date.now() },
      ];
    }
    const dbName = cards.find((c) => c.id === cb.id)!.dbName;

    await addTransactions(dbName, asArray<Transaction>(cb.transactions), `restore-${cb.name}`);
    await saveCategorization(dbName, asArray<CategoryRule>(cb.rules), asArray<CategoryOverride>(cb.overrides));
    await saveKeywordRules(dbName, asArray<KeywordRule>(cb.keywordRules));
    await saveSubRules(dbName, asArray<SubRule>(cb.subRules));
    await saveSubOverrides(dbName, asArray<SubOverride>(cb.subOverrides));

    if (cb.currency) writeLS(scopedKey(CURRENCY_KEY, cb.id), cb.currency);
    if (typeof cb.monthStartDay === 'number' && cb.monthStartDay >= 1 && cb.monthStartDay <= 28) {
      writeLS(scopedKey(MONTH_START_KEY, cb.id), String(cb.monthStartDay));
    }
    const customCategories = asArray<unknown>(cb.customCategories).filter(
      (c): c is string => typeof c === 'string',
    );
    if (customCategories.length > 0) {
      writeLS(scopedKey(CUSTOM_CATEGORIES_KEY, cb.id), JSON.stringify(customCategories));
    }
    if (isValidCategoryFilter(cb.categoryFilter)) {
      writeLS(scopedKey(CATEGORY_FILTER_KEY, cb.id), JSON.stringify(cb.categoryFilter));
    }
  }

  for (const note of asArray<unknown>(backup.notes)) {
    if (isValidNote(note)) await saveNote(note);
  }

  if (backup.theme) writeLS(THEME_KEY, backup.theme);
  saveCards(cards);
  const activeCardId = cards.some((c) => c.id === backup.activeCardId) ? backup.activeCardId : cards[0].id;
  saveActiveCardId(activeCardId);

  const incomingCombinedFilter = isValidCategoryFilter(backup.combinedCategoryFilter)
    ? backup.combinedCategoryFilter
    : defaultCategoryFilter();
  const combinedCategoryFilter = unionCategoryFilter(existingCombinedCategoryFilter, incomingCombinedFilter);
  writeLS(COMBINED_CATEGORY_FILTER_KEY, JSON.stringify(combinedCategoryFilter));

  const incomingPresets = isValidPresetList(backup.filterPresets) ? backup.filterPresets : [];
  const filterPresets = mergePresets(existingFilterPresets, incomingPresets);
  writeLS(CATEGORY_FILTER_PRESETS_KEY, JSON.stringify(filterPresets));

  return {
    cards,
    activeCardId,
    theme: backup.theme === 'dark' ? 'dark' : 'light',
    combinedCategoryFilter,
    filterPresets,
  };
}
