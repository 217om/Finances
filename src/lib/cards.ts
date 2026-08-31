// A "card" is one bank account/statement the user analyzes. Each card has its
// own IndexedDB database (transactions, categorization rules, overrides) and
// its own scoped preferences (currency, month start, category filter) —
// nothing mixes between cards except what's explicitly copied when a card is
// created. Custom categories are the one exception: they're global, like
// categorization rules (see GLOBAL_RULES_DB below) — a category name is
// meaningful on any card, so there's one shared list, not one per card.

export interface Card {
  id: string;
  name: string;
  dbName: string;
  createdAt: number;
}

const CARDS_KEY = 'cashflow.cards';
const ACTIVE_CARD_KEY = 'cashflow.activeCardId';

// Per-card preference keys (namespaced via scopedKey) and the one global,
// card-independent preference — exported here so both App.tsx and the full
// backup/restore code share a single source of truth for the literal strings.
export const CURRENCY_KEY = 'cashflow.currency';
export const MONTH_START_KEY = 'cashflow.monthStartDay';
/** 0 = Sunday .. 6 = Saturday, matching Date#getUTCDay. Defaults to Monday
 *  (1) — the app's original hardcoded week-start behavior. */
export const WEEK_START_KEY = 'cashflow.weekStartDay';
/** Global (not per-card) — a category name is meaningful on any card, so
 *  there's one shared list rather than each card keeping its own. Kept
 *  unscoped (the same literal key the very first card always used) so
 *  existing single-card users need no migration; multi-card users get a
 *  one-time union migration, see CUSTOM_CATEGORIES_GLOBAL_MIGRATION_KEY. */
export const CUSTOM_CATEGORIES_KEY = 'cashflow.customCategories';
export const CATEGORY_FILTER_KEY = 'cashflow.categoryFilter';
/** Remembers the last-used import column mapping (date/description/amount
 *  columns) per card, so re-importing a statement with the same layout
 *  skips straight to it instead of re-detecting from scratch. */
export const COLUMN_MAPPING_KEY = 'cashflow.columnMapping';
export const THEME_KEY = 'cashflow.theme';
export const COMBINE_KEY = 'cashflow.combineCards';
/** Independent from any single card's own CATEGORY_FILTER_KEY — a hide/show
 *  filter that only applies while exploring the combined Categories view. */
export const COMBINED_CATEGORY_FILTER_KEY = 'cashflow.combinedCategoryFilter';
/** Named, reusable category filter snapshots — global, shared by every card
 *  and the combined view alike (see lib/categoryFilterPresets.ts). */
export const CATEGORY_FILTER_PRESETS_KEY = 'cashflow.categoryFilterPresets';
/** Budgets apply at the total (all-cards-combined) level, not per card — see
 *  lib/budget.ts. Each budget is a named group of one or more categories;
 *  a 'weekly'-cadence budget's per-week amounts live under
 *  BUDGET_ENTRIES_KEY, while a 'daily'/'monthly'-cadence budget's one
 *  rate/total per cycle lives under BUDGET_CYCLE_AMOUNTS_KEY instead. */
export const BUDGETS_KEY = 'cashflow.budgets';
export const BUDGET_ENTRIES_KEY = 'cashflow.budgetEntries';
export const BUDGET_CYCLE_AMOUNTS_KEY = 'cashflow.budgetCycleAmounts';
/** 'debit' or 'credit', per card — see lib/balances.ts for why credit
 *  balances are shown as negative debt. Defaults to 'debit' when unset. */
export const CARD_TYPE_KEY = 'cashflow.cardType';
/** Manually-entered balance snapshots per card, used to bring a card's
 *  balance up to date when its statements don't include a running-balance
 *  column — see lib/balances.ts. */
export const BALANCE_CHECKPOINTS_KEY = 'cashflow.balanceCheckpoints';
/** Free-form assets tracked for net worth, independent of any card. Global,
 *  like the combined filter and budgets above. See lib/balances.ts. */
export const ASSETS_KEY = 'cashflow.assets';
export const ASSET_VALUES_KEY = 'cashflow.assetValues';
/** Global, like budgets/assets — identifies salary payments so the Executive
 *  Summary's Monthly periods can open on the actual payday instead of a
 *  fixed day-of-month. Null/absent means "not set up", falling back to
 *  monthStartDay. See lib/executiveSummary.ts's SalaryRule. */
export const SALARY_RULE_KEY = 'cashflow.salaryRule';

/** The first card ever created keeps the original database name so existing
 *  users' data loads with no migration step. */
export const DEFAULT_CARD_ID = 'default';

/** Not a real card — a dedicated database (reusing the same schema as a
 *  card's own db) that holds categorization rules shared by every card by
 *  default. A card can still define its own rules that take precedence over
 *  a global one for the same keyword/signature/sub-rule id. */
export const GLOBAL_RULES_DB = 'cashflow-global-rules';

/** Set once the one-time migration of every card's pre-existing rules into
 *  the global store has run, so it never repeats. */
export const RULES_GLOBAL_MIGRATION_KEY = 'cashflow.rulesGlobalMigration.v1';

/** Set once the one-time migration of every card's pre-existing custom
 *  categories into the single shared list has run, so it never repeats. */
export const CUSTOM_CATEGORIES_GLOBAL_MIGRATION_KEY = 'cashflow.customCategoriesGlobalMigration.v1';

/** Sentinel value for the "Combine all cards" entry in the card selector —
 *  never a real card id, so it can share the same <select> as real cards. */
export const COMBINE_CARD_ID = '__combined__';

/** Sentinel for "every card" in Advanced Settings' transaction-count picker
 *  — aggregates a rule's match count across every card instead of just one. */
export const ALL_CARDS_ID = '__all__';

function defaultCard(): Card {
  return { id: DEFAULT_CARD_ID, name: 'Card 1', dbName: 'cashflow', createdAt: Date.now() };
}

function isCard(x: unknown): x is Card {
  if (!x || typeof x !== 'object') return false;
  const c = x as Record<string, unknown>;
  return typeof c.id === 'string' && typeof c.name === 'string' && typeof c.dbName === 'string';
}

/** Load the saved list of cards, seeding a single default card on first run. */
export function loadCards(): Card[] {
  try {
    const raw = localStorage.getItem(CARDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isCard)) return parsed;
    }
  } catch {
    /* ignore unavailable / malformed localStorage */
  }
  const seed = [defaultCard()];
  saveCards(seed);
  return seed;
}

export function saveCards(cards: Card[]): void {
  try {
    localStorage.setItem(CARDS_KEY, JSON.stringify(cards));
  } catch {
    /* ignore */
  }
}

export function loadActiveCardId(cards: Card[]): string {
  try {
    const saved = localStorage.getItem(ACTIVE_CARD_KEY);
    if (saved && cards.some((c) => c.id === saved)) return saved;
  } catch {
    /* ignore */
  }
  return cards[0]?.id ?? DEFAULT_CARD_ID;
}

export function saveActiveCardId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_CARD_KEY, id);
  } catch {
    /* ignore */
  }
}

function randomId(): string {
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

/** Create a brand-new card with its own database name. Does not persist it —
 *  call `saveCards` with the updated list once the caller is ready. */
export function makeCard(name: string): Card {
  const id = randomId();
  return { id, name: name.trim() || 'New card', dbName: `cashflow-${id}`, createdAt: Date.now() };
}

/**
 * Namespaces a localStorage preference key by card, keeping the very first
 * card's key exactly as it was before multi-card support existed, so
 * existing users' preferences keep applying without a migration step.
 */
export function scopedKey(base: string, cardId: string): string {
  return cardId === DEFAULT_CARD_ID ? base : `${base}.${cardId}`;
}
