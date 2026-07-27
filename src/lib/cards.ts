// A "card" is one bank account/statement the user analyzes. Each card has its
// own IndexedDB database (transactions, categorization rules, overrides) and
// its own scoped preferences (currency, month start, custom categories,
// category filter) — nothing mixes between cards except what's explicitly
// copied when a card is created.

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
export const CUSTOM_CATEGORIES_KEY = 'cashflow.customCategories';
export const CATEGORY_FILTER_KEY = 'cashflow.categoryFilter';
export const THEME_KEY = 'cashflow.theme';
export const COMBINE_KEY = 'cashflow.combineCards';

/** The first card ever created keeps the original database name so existing
 *  users' data loads with no migration step. */
export const DEFAULT_CARD_ID = 'default';

/** Sentinel value for the "Combine all cards" entry in the card selector —
 *  never a real card id, so it can share the same <select> as real cards. */
export const COMBINE_CARD_ID = '__combined__';

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
