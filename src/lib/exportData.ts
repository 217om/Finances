// Backup / restore / CSV export. Everything runs in the browser; files are
// generated client-side and downloaded directly.

import type { CategoryOverride, CategoryRule, KeywordRule, SubOverride, SubRule, Transaction } from '../types';
import { categorize } from './categorize';
import {
  BUDGETS_KEY,
  BUDGET_ENTRIES_KEY,
  CARD_TYPE_KEY,
  BALANCE_CHECKPOINTS_KEY,
  ASSETS_KEY,
  ASSET_VALUES_KEY,
  CATEGORY_FILTER_KEY,
  COMBINED_CATEGORY_FILTER_KEY,
  CATEGORY_FILTER_PRESETS_KEY,
  CURRENCY_KEY,
  CUSTOM_CATEGORIES_KEY,
  GLOBAL_RULES_DB,
  MONTH_START_KEY,
  WEEK_START_KEY,
  THEME_KEY,
  makeCard,
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
import {
  isValidBudgetEntries,
  isValidBudgets,
  mergeBudgetEntries,
  mergeBudgets,
  type Budget,
  type BudgetEntry,
} from './budget';
import {
  isValidAssetValues,
  isValidAssets,
  isValidCardType,
  isValidCheckpoints,
  mergeAssetValues,
  mergeAssets,
  mergeCheckpoints,
  type Asset,
  type AssetValueEntry,
  type BalanceCheckpoint,
  type CardType,
} from './balances';

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
  weekStartDay: number | null;
  /** Legacy — custom categories used to be scoped per card. Kept optional so
   *  an older backup file still restores its categories (see
   *  restoreFullBackup); no longer written by buildFullBackup, which puts
   *  them in the top-level FullBackupFile.globalCustomCategories instead. */
  customCategories?: string[];
  categoryFilter: CategoryFilterState;
  /** See lib/balances.ts — null cardType means "unset" (defaults to 'debit'). */
  cardType: CardType | null;
  checkpoints: BalanceCheckpoint[];
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
  /** Budgets apply at the total (all-cards-combined) level — see
   *  lib/budget.ts and lib/cards' BUDGETS_KEY doc comment. */
  budgets: Budget[];
  budgetEntries: BudgetEntry[];
  /** Free-form assets tracked for net worth, independent of any card — see
   *  lib/balances.ts and lib/cards' ASSETS_KEY doc comment. */
  assets: Asset[];
  assetValues: AssetValueEntry[];
  /** Categorization rules shared by every card by default — see lib/cards'
   *  GLOBAL_RULES_DB doc comment. Card-specific overrides of these live
   *  inside each card's own CardBackup above. */
  globalRules: CategoryRule[];
  globalKeywordRules: KeywordRule[];
  globalSubRules: SubRule[];
  /** Custom categories are global too (see lib/cards' CUSTOM_CATEGORIES_KEY
   *  doc comment) — a category name is meaningful on any card, so there's
   *  one shared list rather than one per card. */
  globalCustomCategories: string[];
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

/** For sync-restore: given the records already stored locally and the ones
 *  coming in from a backup, returns only the incoming records that should
 *  actually be written — new ones (no local match by key) and ones whose
 *  updatedAt is at least as recent as the local copy's. An incoming record
 *  that's older than what's already stored is dropped, so restoring a stale
 *  backup can't silently revert a newer local edit to the same rule/
 *  override/etc. Records written before updatedAt existed sort as oldest. */
function reconcileForRestore<T>(
  existing: T[],
  incoming: T[],
  keyOf: (t: T) => string,
  updatedAtOf: (t: T) => number | undefined,
): T[] {
  const existingByKey = new Map(existing.map((t) => [keyOf(t), t]));
  const toWrite: T[] = [];
  for (const inc of incoming) {
    const cur = existingByKey.get(keyOf(inc));
    if (!cur || (updatedAtOf(inc) ?? 0) >= (updatedAtOf(cur) ?? 0)) toWrite.push(inc);
  }
  return toWrite;
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
  budgets: Budget[],
  budgetEntries: BudgetEntry[],
  assets: Asset[],
  assetValues: AssetValueEntry[],
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
      // Same null-vs-zero care as App.tsx's load effect — Number(null) is a
      // valid Sunday (0), so presence has to be checked before parsing.
      const rawWeekStartDay = readLS(scopedKey(WEEK_START_KEY, card.id));
      const weekStartDay = rawWeekStartDay !== null ? Number(rawWeekStartDay) : NaN;
      const categoryFilterRaw = readJSON(scopedKey(CATEGORY_FILTER_KEY, card.id));
      const cardTypeRaw = readLS(scopedKey(CARD_TYPE_KEY, card.id));
      const checkpointsRaw = readJSON(scopedKey(BALANCE_CHECKPOINTS_KEY, card.id));
      return {
        id: card.id,
        name: card.name,
        dbName: card.dbName,
        createdAt: card.createdAt,
        currency: readLS(scopedKey(CURRENCY_KEY, card.id)),
        monthStartDay: monthStartDay >= 1 && monthStartDay <= 28 ? monthStartDay : null,
        weekStartDay: weekStartDay >= 0 && weekStartDay <= 6 ? weekStartDay : null,
        categoryFilter: isValidCategoryFilter(categoryFilterRaw) ? categoryFilterRaw : defaultCategoryFilter(),
        cardType: isValidCardType(cardTypeRaw) ? cardTypeRaw : null,
        checkpoints: isValidCheckpoints(checkpointsRaw) ? checkpointsRaw : [],
        transactions,
        rules,
        overrides,
        keywordRules,
        subRules,
        subOverrides,
      };
    }),
  );

  const [globalRules, globalKeywordRules, globalSubRules] = await Promise.all([
    getRules(GLOBAL_RULES_DB),
    getKeywordRules(GLOBAL_RULES_DB),
    getSubRules(GLOBAL_RULES_DB),
  ]);
  const globalCustomCategoriesRaw = readJSON(CUSTOM_CATEGORIES_KEY);
  const globalCustomCategories = Array.isArray(globalCustomCategoriesRaw)
    ? globalCustomCategoriesRaw.filter((c): c is string => typeof c === 'string')
    : [];

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
    budgets,
    budgetEntries,
    assets,
    assetValues,
    globalRules,
    globalKeywordRules,
    globalSubRules,
    globalCustomCategories,
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

const RULES_BACKUP_MAGIC = 'cashflow-rules-backup';
const RULES_BACKUP_VERSION = 1;

interface CardRulesBackup {
  id: string;
  name: string;
  rules: CategoryRule[];
  keywordRules: KeywordRule[];
  subRules: SubRule[];
  /** Legacy — custom categories used to be scoped per card. Kept optional so
   *  an older rules export still restores its categories (see
   *  restoreRulesBackup); no longer written by buildRulesBackup, which puts
   *  them in the top-level RulesBackupFile.globalCustomCategories instead. */
  customCategories?: string[];
}

export interface RulesBackupFile {
  app: typeof RULES_BACKUP_MAGIC;
  version: number;
  exportedAt: string;
  globalRules: CategoryRule[];
  globalKeywordRules: KeywordRule[];
  globalSubRules: SubRule[];
  /** See lib/cards' CUSTOM_CATEGORIES_KEY doc comment — global, not per card. */
  globalCustomCategories: string[];
  cards: CardRulesBackup[];
}

/**
 * Gathers every categorization rule — global and every card's own — plus the
 * shared custom categories, without any transaction data. Meant for moving
 * just the "how do I categorize things" logic between browsers/profiles,
 * separately from the (much larger, more sensitive) full backup.
 */
export async function buildRulesBackup(cards: Card[]): Promise<RulesBackupFile> {
  const cardBackups = await Promise.all(
    cards.map(async (card): Promise<CardRulesBackup> => {
      const [rules, keywordRules, subRules] = await Promise.all([
        getRules(card.dbName),
        getKeywordRules(card.dbName),
        getSubRules(card.dbName),
      ]);
      return { id: card.id, name: card.name, rules, keywordRules, subRules };
    }),
  );

  const [globalRules, globalKeywordRules, globalSubRules] = await Promise.all([
    getRules(GLOBAL_RULES_DB),
    getKeywordRules(GLOBAL_RULES_DB),
    getSubRules(GLOBAL_RULES_DB),
  ]);
  const globalCustomCategoriesRaw = readJSON(CUSTOM_CATEGORIES_KEY);
  const globalCustomCategories = Array.isArray(globalCustomCategoriesRaw)
    ? globalCustomCategoriesRaw.filter((c): c is string => typeof c === 'string')
    : [];

  return {
    app: RULES_BACKUP_MAGIC,
    version: RULES_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    globalRules,
    globalKeywordRules,
    globalSubRules,
    globalCustomCategories,
    cards: cardBackups,
  };
}

export function downloadRulesBackup(backup: RulesBackupFile): void {
  triggerDownload(JSON.stringify(backup, null, 2), `cashflow-rules-${stamp()}.json`, 'application/json');
}

/** True if a JSON file's magic marker identifies it as a rules-only export
 *  (as opposed to a per-card or full backup). */
export function isRulesBackup(text: string): boolean {
  try {
    return (JSON.parse(text) as { app?: unknown } | null)?.app === RULES_BACKUP_MAGIC;
  } catch {
    return false;
  }
}

export function parseRulesBackup(text: string): RulesBackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const obj = data as Partial<RulesBackupFile>;
  if (obj.app !== RULES_BACKUP_MAGIC || !Array.isArray(obj.cards)) {
    throw new Error('That JSON is not a CashFlow rules export.');
  }
  return obj as RulesBackupFile;
}

/**
 * Restores a rules-only export on top of whatever's already stored —
 * additive, same as restoreFullBackup: nothing existing is deleted, matching
 * keys are overwritten with the imported version. Cards are matched by name
 * (case-insensitive); a backup card with no local match is skipped rather
 * than creating an empty card with rules but no transactions to apply them
 * to — the caller should report which names were skipped.
 */
export async function restoreRulesBackup(
  backup: RulesBackupFile,
  existingCards: Card[],
): Promise<{
  globalRules: CategoryRule[];
  globalKeywordRules: KeywordRule[];
  globalSubRules: SubRule[];
  customCategories: string[];
  matchedCards: string[];
  skippedCards: string[];
}> {
  await saveCategorization(GLOBAL_RULES_DB, asArray<CategoryRule>(backup.globalRules), []);
  await saveKeywordRules(GLOBAL_RULES_DB, asArray<KeywordRule>(backup.globalKeywordRules));
  await saveSubRules(GLOBAL_RULES_DB, asArray<SubRule>(backup.globalSubRules));

  const matchedCards: string[] = [];
  const skippedCards: string[] = [];
  // Custom categories are global (see lib/cards' CUSTOM_CATEGORIES_KEY doc
  // comment) — union the current top-level field plus any legacy per-card
  // ones (an older export, from before categories were global) into one set.
  const incomingCategories = new Set<string>(asArray<unknown>(backup.globalCustomCategories).filter(
    (c): c is string => typeof c === 'string',
  ));

  for (const cb of asArray<CardRulesBackup>(backup.cards)) {
    if (!cb || typeof cb.name !== 'string') continue;
    const nameKey = cb.name.trim().toLowerCase();
    const target = existingCards.find((c) => c.name.trim().toLowerCase() === nameKey);
    if (!target) {
      skippedCards.push(cb.name);
      continue;
    }
    matchedCards.push(cb.name);
    await saveCategorization(target.dbName, asArray<CategoryRule>(cb.rules), []);
    await saveKeywordRules(target.dbName, asArray<KeywordRule>(cb.keywordRules));
    await saveSubRules(target.dbName, asArray<SubRule>(cb.subRules));

    for (const c of asArray<unknown>(cb.customCategories)) {
      if (typeof c === 'string') incomingCategories.add(c);
    }
  }

  const existingCategoriesRaw = readJSON(CUSTOM_CATEGORIES_KEY);
  const existingCategories = Array.isArray(existingCategoriesRaw)
    ? existingCategoriesRaw.filter((c): c is string => typeof c === 'string')
    : [];
  const seen = new Set<string>();
  const customCategories: string[] = [];
  for (const c of [...existingCategories, ...incomingCategories]) {
    const key = c.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      customCategories.push(c);
    }
  }
  writeLS(CUSTOM_CATEGORIES_KEY, JSON.stringify(customCategories));

  const [globalRules, globalKeywordRules, globalSubRules] = await Promise.all([
    getRules(GLOBAL_RULES_DB),
    getKeywordRules(GLOBAL_RULES_DB),
    getSubRules(GLOBAL_RULES_DB),
  ]);

  return { globalRules, globalKeywordRules, globalSubRules, customCategories, matchedCards, skippedCards };
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
 * destructive: cards are matched by name (case-insensitive), not by id —
 * every browser profile seeds its very first card with the same fixed id
 * ("default"), so matching by id would silently fold an imported card's data
 * into an unrelated local card that merely happens to share that id. A
 * backup card whose name matches an existing local card is merged into it;
 * anything else becomes a brand-new card with its own fresh id and database,
 * even if the backup's id collides with a local one. The combined view's
 * filter is unioned rather than replaced, and presets are merged by id —
 * nothing existing is ever deleted. Tolerant of a malformed or older backup
 * file too: a missing or invalid field falls back to a sensible default (or
 * is skipped) instead of aborting the whole restore.
 */
export async function restoreFullBackup(
  backup: FullBackupFile,
  existingCards: Card[],
  existingCombinedCategoryFilter: CategoryFilterState,
  existingFilterPresets: CategoryFilterPreset[],
  existingBudgets: Budget[],
  existingBudgetEntries: BudgetEntry[],
  existingAssets: Asset[],
  existingAssetValues: AssetValueEntry[],
): Promise<{
  cards: Card[];
  activeCardId: string;
  theme: 'light' | 'dark';
  combinedCategoryFilter: CategoryFilterState;
  filterPresets: CategoryFilterPreset[];
  budgets: Budget[];
  budgetEntries: BudgetEntry[];
  assets: Asset[];
  assetValues: AssetValueEntry[];
  globalRules: CategoryRule[];
  globalKeywordRules: KeywordRule[];
  globalSubRules: SubRule[];
  customCategories: string[];
}> {
  let cards = existingCards;
  // Backup card id -> id of the local card its data actually landed in.
  const resolvedIdByBackupId = new Map<string, string>();
  // Custom categories are global (see lib/cards' CUSTOM_CATEGORIES_KEY doc
  // comment) — union the current top-level field plus any legacy per-card
  // ones (an older backup, from before categories were global) into one set.
  const incomingCategories = new Set<string>(
    asArray<unknown>(backup.globalCustomCategories).filter((c): c is string => typeof c === 'string'),
  );

  for (const cb of backup.cards) {
    if (!cb || typeof cb.id !== 'string' || typeof cb.dbName !== 'string') continue;

    const nameKey = (cb.name || '').trim().toLowerCase();
    const existing = nameKey ? cards.find((c) => c.name.trim().toLowerCase() === nameKey) : undefined;
    let target: Card;
    if (existing) {
      target = existing;
    } else {
      target = { ...makeCard(cb.name || 'Card'), createdAt: cb.createdAt || Date.now() };
      cards = [...cards, target];
    }
    resolvedIdByBackupId.set(cb.id, target.id);
    const dbName = target.dbName;

    await addTransactions(dbName, asArray<Transaction>(cb.transactions), `restore-${cb.name}`);

    // Rules/overrides are keyed upserts — write only the incoming ones that
    // are new or at least as recent as what's already here, so an older
    // backup can't quietly revert a newer local recategorization.
    const [existingRules, existingOverrides, existingKeywordRules, existingSubRules, existingSubOverrides] =
      await Promise.all([
        getRules(dbName),
        getOverrides(dbName),
        getKeywordRules(dbName),
        getSubRules(dbName),
        getSubOverrides(dbName),
      ]);
    const rulesToWrite = reconcileForRestore(
      existingRules,
      asArray<CategoryRule>(cb.rules),
      (r) => r.signature,
      (r) => r.updatedAt,
    );
    const overridesToWrite = reconcileForRestore(
      existingOverrides,
      asArray<CategoryOverride>(cb.overrides),
      (o) => o.id,
      (o) => o.updatedAt,
    );
    const keywordRulesToWrite = reconcileForRestore(
      existingKeywordRules,
      asArray<KeywordRule>(cb.keywordRules),
      (r) => r.keyword,
      (r) => r.updatedAt,
    );
    const subRulesToWrite = reconcileForRestore(
      existingSubRules,
      asArray<SubRule>(cb.subRules),
      (r) => r.id,
      (r) => r.updatedAt,
    );
    const subOverridesToWrite = reconcileForRestore(
      existingSubOverrides,
      asArray<SubOverride>(cb.subOverrides),
      (o) => o.id,
      (o) => o.updatedAt,
    );
    await saveCategorization(dbName, rulesToWrite, overridesToWrite);
    await saveKeywordRules(dbName, keywordRulesToWrite);
    await saveSubRules(dbName, subRulesToWrite);
    await saveSubOverrides(dbName, subOverridesToWrite);

    if (cb.currency) writeLS(scopedKey(CURRENCY_KEY, target.id), cb.currency);
    if (typeof cb.monthStartDay === 'number' && cb.monthStartDay >= 1 && cb.monthStartDay <= 28) {
      writeLS(scopedKey(MONTH_START_KEY, target.id), String(cb.monthStartDay));
    }
    if (typeof cb.weekStartDay === 'number' && cb.weekStartDay >= 0 && cb.weekStartDay <= 6) {
      writeLS(scopedKey(WEEK_START_KEY, target.id), String(cb.weekStartDay));
    }
    for (const c of asArray<unknown>(cb.customCategories)) {
      if (typeof c === 'string') incomingCategories.add(c);
    }
    if (isValidCategoryFilter(cb.categoryFilter)) {
      writeLS(scopedKey(CATEGORY_FILTER_KEY, target.id), JSON.stringify(cb.categoryFilter));
    }
    if (isValidCardType(cb.cardType)) {
      writeLS(scopedKey(CARD_TYPE_KEY, target.id), cb.cardType);
    }
    if (isValidCheckpoints(cb.checkpoints) && cb.checkpoints.length > 0) {
      const existingRaw = readJSON(scopedKey(BALANCE_CHECKPOINTS_KEY, target.id));
      const existingCheckpoints = isValidCheckpoints(existingRaw) ? existingRaw : [];
      const mergedCheckpoints = mergeCheckpoints(existingCheckpoints, cb.checkpoints);
      writeLS(scopedKey(BALANCE_CHECKPOINTS_KEY, target.id), JSON.stringify(mergedCheckpoints));
    }
  }

  for (const note of asArray<unknown>(backup.notes)) {
    if (isValidNote(note)) await saveNote(note);
  }

  if (backup.theme) writeLS(THEME_KEY, backup.theme);
  saveCards(cards);
  const resolvedActiveId = resolvedIdByBackupId.get(backup.activeCardId);
  const activeCardId = resolvedActiveId && cards.some((c) => c.id === resolvedActiveId) ? resolvedActiveId : cards[0].id;
  saveActiveCardId(activeCardId);

  const incomingCombinedFilter = isValidCategoryFilter(backup.combinedCategoryFilter)
    ? backup.combinedCategoryFilter
    : defaultCategoryFilter();
  const combinedCategoryFilter = unionCategoryFilter(existingCombinedCategoryFilter, incomingCombinedFilter);
  writeLS(COMBINED_CATEGORY_FILTER_KEY, JSON.stringify(combinedCategoryFilter));

  const incomingPresets = isValidPresetList(backup.filterPresets) ? backup.filterPresets : [];
  const filterPresets = mergePresets(existingFilterPresets, incomingPresets);
  writeLS(CATEGORY_FILTER_PRESETS_KEY, JSON.stringify(filterPresets));

  const incomingBudgets = isValidBudgets(backup.budgets) ? backup.budgets : [];
  const budgets = mergeBudgets(existingBudgets, incomingBudgets);
  writeLS(BUDGETS_KEY, JSON.stringify(budgets));

  const incomingBudgetEntries = isValidBudgetEntries(backup.budgetEntries) ? backup.budgetEntries : [];
  const budgetEntries = mergeBudgetEntries(existingBudgetEntries, incomingBudgetEntries);
  writeLS(BUDGET_ENTRIES_KEY, JSON.stringify(budgetEntries));

  const incomingAssets = isValidAssets(backup.assets) ? backup.assets : [];
  const assets = mergeAssets(existingAssets, incomingAssets);
  writeLS(ASSETS_KEY, JSON.stringify(assets));

  const incomingAssetValues = isValidAssetValues(backup.assetValues) ? backup.assetValues : [];
  const assetValues = mergeAssetValues(existingAssetValues, incomingAssetValues);
  writeLS(ASSET_VALUES_KEY, JSON.stringify(assetValues));

  // Global rules (shared by every card by default) reconcile into the
  // shared store the same key-aware, newer-wins way each card's own rules
  // do above, rather than letting an older backup revert a newer edit.
  const [existingGlobalRules, existingGlobalKeywordRules, existingGlobalSubRules] = await Promise.all([
    getRules(GLOBAL_RULES_DB),
    getKeywordRules(GLOBAL_RULES_DB),
    getSubRules(GLOBAL_RULES_DB),
  ]);
  await saveCategorization(
    GLOBAL_RULES_DB,
    reconcileForRestore(existingGlobalRules, asArray<CategoryRule>(backup.globalRules), (r) => r.signature, (r) => r.updatedAt),
    [],
  );
  await saveKeywordRules(
    GLOBAL_RULES_DB,
    reconcileForRestore(
      existingGlobalKeywordRules,
      asArray<KeywordRule>(backup.globalKeywordRules),
      (r) => r.keyword,
      (r) => r.updatedAt,
    ),
  );
  await saveSubRules(
    GLOBAL_RULES_DB,
    reconcileForRestore(existingGlobalSubRules, asArray<SubRule>(backup.globalSubRules), (r) => r.id, (r) => r.updatedAt),
  );
  const [globalRules, globalKeywordRules, globalSubRules] = await Promise.all([
    getRules(GLOBAL_RULES_DB),
    getKeywordRules(GLOBAL_RULES_DB),
    getSubRules(GLOBAL_RULES_DB),
  ]);

  const existingCategoriesRaw = readJSON(CUSTOM_CATEGORIES_KEY);
  const existingCategories = Array.isArray(existingCategoriesRaw)
    ? existingCategoriesRaw.filter((c): c is string => typeof c === 'string')
    : [];
  const seenCategories = new Set<string>();
  const customCategories: string[] = [];
  for (const c of [...existingCategories, ...incomingCategories]) {
    const key = c.toLowerCase();
    if (!seenCategories.has(key)) {
      seenCategories.add(key);
      customCategories.push(c);
    }
  }
  writeLS(CUSTOM_CATEGORIES_KEY, JSON.stringify(customCategories));

  return {
    cards,
    activeCardId,
    theme: backup.theme === 'dark' ? 'dark' : 'light',
    combinedCategoryFilter,
    filterPresets,
    budgets,
    budgetEntries,
    assets,
    assetValues,
    globalRules,
    globalKeywordRules,
    globalSubRules,
    customCategories,
  };
}
