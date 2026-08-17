import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CategoryOverride,
  CategoryRule,
  ColumnMapping,
  ImportResult,
  KeywordRule,
  ParsedFile,
  SubOverride,
  SubRule,
  Transaction,
} from './types';
import { inspectFile, normalize } from './lib/parse';
import {
  addTransactions,
  clearAll,
  clearTransactionsOnly,
  deleteCardDatabase,
  deleteKeywordRule,
  deleteOverride,
  deleteRule,
  deleteSubRule,
  getAllTransactions,
  getKeywordRules,
  getOverrides,
  getRules,
  getSubOverrides,
  getSubRules,
  onDatabaseBlocked,
  saveCategorization,
  saveKeywordRule,
  saveKeywordRules,
  saveOverride,
  saveSubOverride,
  saveSubOverrides,
  saveSubRules,
  deleteSubOverride,
  deleteSubOverrides,
  deleteTransaction,
  setTransactionNote,
  clearRuleDefinitions,
} from './lib/db';
import {
  type Card,
  loadActiveCardId,
  loadCards,
  makeCard,
  saveActiveCardId,
  saveCards,
  scopedKey,
  CURRENCY_KEY,
  MONTH_START_KEY,
  WEEK_START_KEY,
  CUSTOM_CATEGORIES_KEY,
  CUSTOM_CATEGORIES_GLOBAL_MIGRATION_KEY,
  CATEGORY_FILTER_KEY,
  COLUMN_MAPPING_KEY,
  COMBINED_CATEGORY_FILTER_KEY,
  CATEGORY_FILTER_PRESETS_KEY,
  BUDGETS_KEY,
  BUDGET_ENTRIES_KEY,
  CARD_TYPE_KEY,
  BALANCE_CHECKPOINTS_KEY,
  ASSETS_KEY,
  ASSET_VALUES_KEY,
  THEME_KEY,
  COMBINE_KEY,
  COMBINE_CARD_ID,
  GLOBAL_RULES_DB,
  RULES_GLOBAL_MIGRATION_KEY,
  ALL_CARDS_ID,
  DEFAULT_CARD_ID,
} from './lib/cards';
import type { CopyOptions } from './components/CardManager';
import { combineAllData, combineAllRows, type CardSnapshot } from './lib/combine';
import { buildGroups } from './lib/grouping';
import { EXPENSE_CATEGORIES, makeResolver, mergeByKey, signatureOf } from './lib/categorize';
import { makeSubResolver, UNSORTED } from './lib/subcategory';
import { makePreset, isValidPresetList, type CategoryFilterPreset } from './lib/categoryFilterPresets';
import {
  defaultCategoryFilter,
  excludeNewCategory,
  excludedCount,
  isExcluded,
  isValidCategoryFilter,
  toggleCategory,
  toggleSub,
  unionCategoryFilter,
  type CategoryFilterState,
} from './lib/categoryFilter';
import { getCurrency, setCurrency } from './lib/format';
import {
  downloadBackup,
  downloadCSV,
  downloadFullBackup,
  isBackupFile,
  buildFullBackup,
  parseFullBackup,
  restoreFullBackup,
  parseBackup,
  sniffBackupKind,
  buildRulesBackup,
  downloadRulesBackup,
  parseRulesBackup,
  restoreRulesBackup,
  type FullBackupFile,
} from './lib/exportData';
import CloudSyncSettings from './components/CloudSyncSettings';
import { syncEngine } from './lib/cloudSync/syncEngine';
import { useSyncState } from './lib/cloudSync/useSyncState';
import NotesWidget from './components/NotesWidget';
import Header from './components/Header';
import UploadPanel from './components/UploadPanel';
import ColumnMapper from './components/ColumnMapper';
import Dashboard from './components/Dashboard';
import EmptyState from './components/EmptyState';
import Toast from './components/Toast';
import CategorizeWizard from './components/CategorizeWizard';
import TransactionsPage from './components/TransactionsPage';
import CombinedTransactionsPage from './components/CombinedTransactionsPage';
import CategoriesPage from './components/CategoriesPage';
import CombinedCategoriesPage from './components/CombinedCategoriesPage';
import AdvancedSettingsPage from './components/AdvancedSettingsPage';
import CardManager from './components/CardManager';
import BudgetsPage from './components/BudgetsPage';
import {
  isValidBudgetEntries,
  isValidBudgets,
  makeBudget,
  removeBudgetEntries,
  renameBudget,
  setBudgetAmount,
  setBudgetAmountForWeeks,
  toggleBudgetCategory,
  type Budget,
  type BudgetEntry,
} from './lib/budget';
import BalancesPage from './components/BalancesPage';
import {
  isValidAssetValues,
  isValidAssets,
  isValidCheckpoints,
  makeAsset,
  makeAssetValueEntry,
  makeCheckpoint,
  mergeCheckpoints,
  type Asset,
  type AssetKind,
  type AssetValueEntry,
  type BalanceCheckpoint,
  type CardType,
} from './lib/balances';

type Theme = 'light' | 'dark';

interface OtherCardData {
  transactions: Transaction[];
  rules: CategoryRule[];
  overrides: CategoryOverride[];
  keywordRules: KeywordRule[];
  subRules: SubRule[];
  subOverrides: SubOverride[];
  currency: string;
}

export default function App() {
  // Global, independent of which card is active — same as Notes.
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [theme]);

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const [cards, setCards] = useState<Card[]>(() => loadCards());
  const [activeCardId, setActiveCardId] = useState<string>(() => loadActiveCardId(loadCards()));
  // Bumped after a full-backup restore so the load effect below re-fetches
  // this card's data even when the restore didn't change activeCardId.
  const [reloadToken, setReloadToken] = useState(0);
  const [cardManagerOpen, setCardManagerOpen] = useState(false);
  const [cloudSyncOpen, setCloudSyncOpen] = useState(false);
  const cloudSyncState = useSyncState();
  const cloudSyncActive = cloudSyncState.google.connected || cloudSyncState.onedrive.connected;
  const [cardBusy, setCardBusy] = useState(false);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const activeCard = useMemo(
    () => cards.find((c) => c.id === activeCardId) ?? cards[0],
    [cards, activeCardId],
  );
  const dbName = activeCard?.dbName ?? 'cashflow';

  // "Combine all cards" is a display mode selected from the same dropdown as
  // a real card (see Header) — it never changes activeCardId, which keeps
  // pointing at whichever card Transactions-editing and Categories operate
  // on. Each card still categorizes and filters its own transactions with
  // its own rules; combining just merges the results afterward.
  const [combineEnabled, setCombineEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COMBINE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [otherCardsData, setOtherCardsData] = useState<Record<string, OtherCardData>>({});
  // Which card's transaction count Advanced Settings shows next to each
  // rule — defaults to an aggregate across every card, since rules are
  // global by default. Independent of the app's actual active card.
  const [countCardId, setCountCardId] = useState<string>(ALL_CARDS_ID);

  // Categorization rules shared by every card by default (see lib/cards'
  // GLOBAL_RULES_DB doc comment). A one-time migration on first load under
  // this version moves every card's pre-existing rules here, since that's
  // what they always meant before per-card scoping existed.
  const [globalRules, setGlobalRules] = useState<CategoryRule[]>([]);
  const [globalKeywordRules, setGlobalKeywordRules] = useState<KeywordRule[]>([]);
  const [globalSubRules, setGlobalSubRules] = useState<SubRule[]>([]);
  // Gates every other effect that reads a card's rules from IndexedDB (the
  // active-card loader, and the other-cards fetch below) so none of them can
  // read a card's rules mid-migration and cache a stale copy that never
  // refreshes — migration doesn't touch `cards` or `activeCardId`, the only
  // things those effects otherwise re-run on.
  const [rulesMigrationDone, setRulesMigrationDone] = useState(false);
  const cardsAtMountRef = useRef(cards);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let migrated = false;
      try {
        migrated = localStorage.getItem(RULES_GLOBAL_MIGRATION_KEY) === '1';
      } catch {
        /* ignore */
      }
      if (!migrated) {
        // If this throws partway (e.g. an IndexedDB write fails), leave the
        // migration flag unset so it's retried next load instead of quietly
        // losing rules — but still fall through to unblock the rest of the
        // app below rather than leaving it stuck loading forever.
        try {
          for (const card of cardsAtMountRef.current) {
            const [r, kr, sr] = await Promise.all([
              getRules(card.dbName).catch(() => [] as CategoryRule[]),
              getKeywordRules(card.dbName).catch(() => [] as KeywordRule[]),
              getSubRules(card.dbName).catch(() => [] as SubRule[]),
            ]);
            if (r.length === 0 && kr.length === 0 && sr.length === 0) continue;
            if (r.length > 0) await saveCategorization(GLOBAL_RULES_DB, r, []);
            if (kr.length > 0) await saveKeywordRules(GLOBAL_RULES_DB, kr);
            if (sr.length > 0) await saveSubRules(GLOBAL_RULES_DB, sr);
            await clearRuleDefinitions(card.dbName);
          }
          localStorage.setItem(RULES_GLOBAL_MIGRATION_KEY, '1');
        } catch {
          /* ignore — retried next load */
        }
      }

      // One-time migration: custom categories used to be scoped per card;
      // a category name is meaningful on any card though, so they're
      // genuinely global now — union every card's list into the one shared,
      // unscoped key and drop the old per-card ones.
      let categoriesMigrated = false;
      try {
        categoriesMigrated = localStorage.getItem(CUSTOM_CATEGORIES_GLOBAL_MIGRATION_KEY) === '1';
      } catch {
        /* ignore */
      }
      if (!categoriesMigrated) {
        try {
          const seen = new Set<string>();
          const merged: string[] = [];
          for (const card of cardsAtMountRef.current) {
            const scoped = scopedKey(CUSTOM_CATEGORIES_KEY, card.id);
            try {
              const raw = JSON.parse(localStorage.getItem(scoped) ?? '[]');
              if (Array.isArray(raw)) {
                for (const c of raw) {
                  if (typeof c !== 'string') continue;
                  const key = c.toLowerCase();
                  if (!seen.has(key)) {
                    seen.add(key);
                    merged.push(c);
                  }
                }
              }
            } catch {
              /* ignore this card's malformed list */
            }
            if (card.id !== DEFAULT_CARD_ID) localStorage.removeItem(scoped);
          }
          localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(merged));
          localStorage.setItem(CUSTOM_CATEGORIES_GLOBAL_MIGRATION_KEY, '1');
        } catch {
          /* ignore — retried next load */
        }
      }

      if (cancelled) return;
      setRulesMigrationDone(true);
      try {
        const [gr, gkr, gsr] = await Promise.all([
          getRules(GLOBAL_RULES_DB).catch(() => [] as CategoryRule[]),
          getKeywordRules(GLOBAL_RULES_DB).catch(() => [] as KeywordRule[]),
          getSubRules(GLOBAL_RULES_DB).catch(() => [] as SubRule[]),
        ]);
        if (cancelled) return;
        setGlobalRules(gr);
        setGlobalKeywordRules(gkr);
        setGlobalSubRules(gsr);
      } catch {
        /* leave global rule state empty; not fatal */
      }
      try {
        const rawCats = JSON.parse(localStorage.getItem(CUSTOM_CATEGORIES_KEY) ?? '[]');
        if (!cancelled) {
          setCustomCategories(Array.isArray(rawCats) ? rawCats.filter((c): c is string => typeof c === 'string') : []);
        }
      } catch {
        /* leave custom categories empty; not fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every other card's full data is kept loaded regardless of combine mode —
  // needed not just for combining, but so Advanced Settings can show every
  // card's rules and transaction counts at once, and so deleting a global
  // rule can freeze its effect on every card it actually touches. Waits for
  // the rules migration above so it never caches a card's pre-migration rules.
  useEffect(() => {
    if (!rulesMigrationDone) return;
    let cancelled = false;
    (async () => {
      const others = cards.filter((c) => c.id !== activeCardId);
      const entries = await Promise.all(
        others.map(async (c) => {
          const [txs, r, o, kr, sr, so] = await Promise.all([
            getAllTransactions(c.dbName).catch(() => [] as Transaction[]),
            getRules(c.dbName).catch(() => [] as CategoryRule[]),
            getOverrides(c.dbName).catch(() => [] as CategoryOverride[]),
            getKeywordRules(c.dbName).catch(() => [] as KeywordRule[]),
            getSubRules(c.dbName).catch(() => [] as SubRule[]),
            getSubOverrides(c.dbName).catch(() => [] as SubOverride[]),
          ]);
          let cur = 'OMR';
          try {
            cur = localStorage.getItem(scopedKey(CURRENCY_KEY, c.id)) || 'OMR';
          } catch {
            /* ignore */
          }
          const data: OtherCardData = {
            transactions: txs,
            rules: r,
            overrides: o,
            keywordRules: kr,
            subRules: sr,
            subOverrides: so,
            currency: cur,
          };
          return [c.id, data] as const;
        }),
      );
      if (cancelled) return;
      setOtherCardsData(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [cards, activeCardId, rulesMigrationDone]);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<ParsedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrencyState] = useState(getCurrency());
  const [monthStartDay, setMonthStartDay] = useState(1);
  const [weekStartDay, setWeekStartDay] = useState(1);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [overrides, setOverrides] = useState<CategoryOverride[]>([]);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [keywordRules, setKeywordRules] = useState<KeywordRule[]>([]);
  const [subRules, setSubRules] = useState<SubRule[]>([]);
  const [subOverrides, setSubOverrides] = useState<SubOverride[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilterState>(defaultCategoryFilter());
  // Global (not per-card) — see handleToggleCombinedCategoryFilter above.
  const [combinedCategoryFilter, setCombinedCategoryFilter] = useState<CategoryFilterState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COMBINED_CATEGORY_FILTER_KEY) ?? 'null');
      return isValidCategoryFilter(saved) ? saved : defaultCategoryFilter();
    } catch {
      return defaultCategoryFilter();
    }
  });
  // Global, named filter snapshots — shared by every card and the combined
  // view alike. See handleSaveFilterPreset and friends below.
  const [filterPresets, setFilterPresets] = useState<CategoryFilterPreset[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CATEGORY_FILTER_PRESETS_KEY) ?? '[]');
      return isValidPresetList(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  // Budgets apply at the total (combined-across-cards) level, not per card —
  // global, like the combined filter above. See lib/budget.ts.
  const [budgets, setBudgets] = useState<Budget[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BUDGETS_KEY) ?? '[]');
      return isValidBudgets(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const [budgetEntries, setBudgetEntries] = useState<BudgetEntry[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BUDGET_ENTRIES_KEY) ?? '[]');
      return isValidBudgetEntries(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  // Balances: per-card type (debit/credit) and manual checkpoints, keyed by
  // card id — plain localStorage reads, not IndexedDB, so (unlike rules or
  // transactions) they don't need an async load effect; handleCreateCard and
  // handleDeleteCard below keep these records in sync with the card list.
  // Assets are global, like budgets. See lib/balances.ts.
  const [cardTypes, setCardTypes] = useState<Record<string, CardType>>(() =>
    Object.fromEntries(loadCards().map((c) => [c.id, loadCardType(c.id)])),
  );
  const [cardCheckpoints, setCardCheckpoints] = useState<Record<string, BalanceCheckpoint[]>>(() =>
    Object.fromEntries(loadCards().map((c) => [c.id, loadCardCheckpoints(c.id)])),
  );
  const [assets, setAssets] = useState<Asset[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ASSETS_KEY) ?? '[]');
      return isValidAssets(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const [assetValues, setAssetValues] = useState<AssetValueEntry[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ASSET_VALUES_KEY) ?? '[]');
      return isValidAssetValues(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [view, setView] = useState<'dashboard' | 'transactions' | 'categories' | 'budgets' | 'balances' | 'advanced'>(
    'dashboard',
  );
  // Set only when jumping in from a chart click (Dashboard -> a specific
  // day/week/month's transactions); cleared on any normal tab navigation, so
  // the Transactions tab is never affected by category filters otherwise.
  const [txJump, setTxJump] = useState<{ from: string; to: string; token: number } | null>(null);

  const handleTabClick = useCallback(
    (next: 'dashboard' | 'transactions' | 'categories' | 'budgets' | 'balances' | 'advanced') => {
      setTxJump(null);
      setView(next);
    },
    [],
  );

  const handleDrillToTransactions = useCallback((from: string, to: string) => {
    setTxJump({ from, to, token: Date.now() });
    setView('transactions');
  }, []);

  // Restore preferences and load stored data whenever the active card changes
  // (including on first mount). Everything here is defensive: reading
  // localStorage can throw on some browsers/privacy modes, and opening
  // IndexedDB can hang — neither should ever leave the app stuck loading.
  // Waits for the rules migration so it never caches pre-migration rules.
  useEffect(() => {
    if (!rulesMigrationDone) return;
    const card = cardsRef.current.find((c) => c.id === activeCardId) ?? cardsRef.current[0];
    if (!card) return;
    const loadDbName = card.dbName;
    const cardId = card.id;

    setLoading(true);
    setError(null);

    // Preferences (best-effort; never block the app on these), scoped to this card.
    try {
      const savedCurrency = localStorage.getItem(scopedKey(CURRENCY_KEY, cardId));
      const cur = savedCurrency || 'OMR';
      setCurrency(cur);
      setCurrencyState(cur);
      const savedDay = Number(localStorage.getItem(scopedKey(MONTH_START_KEY, cardId)));
      setMonthStartDay(savedDay >= 1 && savedDay <= 28 ? savedDay : 1);
      // Number(null) is 0 — a legitimately valid day (Sunday), unlike
      // monthStartDay's 1-28 range where 0 always means "unset". Check for
      // presence first so an unset preference doesn't get silently read as
      // an explicit choice of Sunday.
      const rawWeekDay = localStorage.getItem(scopedKey(WEEK_START_KEY, cardId));
      const savedWeekDay = rawWeekDay !== null ? Number(rawWeekDay) : NaN;
      setWeekStartDay(savedWeekDay >= 0 && savedWeekDay <= 6 ? savedWeekDay : 1);
      const savedFilter = JSON.parse(localStorage.getItem(scopedKey(CATEGORY_FILTER_KEY, cardId)) ?? 'null');
      setCategoryFilter(isValidCategoryFilter(savedFilter) ? savedFilter : defaultCategoryFilter());
    } catch {
      setCurrency('OMR');
      setCurrencyState('OMR');
      setMonthStartDay(1);
      setWeekStartDay(1);
      setCategoryFilter(defaultCategoryFilter());
    }

    let cancelled = false;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timed-out')), 20000),
    );

    // If another tab is holding this card's database open (e.g. blocking an
    // update), say so immediately instead of spinning for 20 seconds.
    onDatabaseBlocked((blockedDbName) => {
      if (cancelled || blockedDbName !== loadDbName) return;
      setError(
        'This app is open in another tab or window, and it’s blocking an update. Close the other ' +
          'tabs (or fully quit and reopen your browser), then Reload. Your data is safe.',
      );
      setLoading(false);
    });

    (async () => {
      try {
        // Transactions are the critical data; guard against a hung DB open.
        const txs = (await Promise.race([getAllTransactions(loadDbName), timeout])) as Transaction[];
        if (cancelled) return;
        setError(null); // opened successfully after all
        setTransactions(txs);

        // Categorization is non-critical: tolerate a failure of any one store.
        const [r, o, kr, sr, so] = await Promise.all([
          getRules(loadDbName).catch(() => [] as CategoryRule[]),
          getOverrides(loadDbName).catch(() => [] as CategoryOverride[]),
          getKeywordRules(loadDbName).catch(() => [] as KeywordRule[]),
          getSubRules(loadDbName).catch(() => [] as SubRule[]),
          getSubOverrides(loadDbName).catch(() => [] as SubOverride[]),
        ]);
        if (cancelled) return;
        setRules(r);
        setOverrides(o);
        setKeywordRules(kr);
        setSubRules(sr);
        setSubOverrides(so);
      } catch (e) {
        if (cancelled) return;
        setError(
          (e as Error)?.message === 'timed-out'
            ? 'Loading your saved data is taking too long. Your data is safe, try Reload. If this app is open in another tab, close it first.'
            : 'Could not open local storage. If this is a private/incognito window, browser storage may be blocked.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      onDatabaseBlocked(null);
    };
  }, [activeCardId, reloadToken, rulesMigrationDone]);

  // Global rules apply to every card by default; a card's own rules take
  // precedence over a global one with the same key (see mergeByKey).
  const effectiveRules = useMemo(
    () => mergeByKey(globalRules, rules, (r) => r.signature),
    [globalRules, rules],
  );
  const effectiveKeywordRules = useMemo(
    () => mergeByKey(globalKeywordRules, keywordRules, (r) => r.keyword),
    [globalKeywordRules, keywordRules],
  );
  const effectiveSubRules = useMemo(
    () => mergeByKey(globalSubRules, subRules, (r) => r.id),
    [globalSubRules, subRules],
  );
  const rulesMap = useMemo(() => new Map(effectiveRules.map((r) => [r.signature, r])), [effectiveRules]);
  const overridesMap = useMemo(
    () => new Map(overrides.map((o) => [o.id, o.category])),
    [overrides],
  );
  const categoryOf = useMemo(
    () => makeResolver(rulesMap, overridesMap, effectiveKeywordRules),
    [rulesMap, overridesMap, effectiveKeywordRules],
  );
  const subResolver = useMemo(() => {
    const perCard = makeSubResolver(effectiveSubRules, subOverrides);
    // "Is this category split, and what sub-category names exist under it"
    // should reflect every card's manual sub-category assignments, not just
    // this card's own — otherwise a sub-category that only exists via an
    // override on another card never shows up as an option here (or the
    // picker doesn't even appear, if this card has no split evidence of its
    // own). Resolving a specific transaction's own sub-category stays scoped
    // to this card's own overrides (perCard.subOf below) though — mixing in
    // another card's overrides there risks a rare same-id collision between
    // two unrelated transactions leaking one card's assignment onto the
    // other's transaction.
    const allSubOverrides = subOverrides.concat(Object.values(otherCardsData).flatMap((d) => d.subOverrides));
    const vocabulary = makeSubResolver(effectiveSubRules, allSubOverrides);
    return { subOf: perCard.subOf, splitParents: vocabulary.splitParents, subsForParent: vocabulary.subsForParent };
  }, [effectiveSubRules, subOverrides, otherCardsData]);

  // Transactions in an excluded category/sub-category are treated as if they
  // don't exist for every calculation (KPIs, charts, category breakdown,
  // insights) — not just hidden from view. Income is never excludable.
  const visibleTransactions = useMemo(() => {
    if (categoryFilter.categories.length === 0 && Object.keys(categoryFilter.subs).length === 0) {
      return transactions;
    }
    return transactions.filter((t) => {
      const cat = categoryOf(t);
      const sub = subResolver.subOf(t, cat);
      return !isExcluded(categoryFilter, cat, sub);
    });
  }, [transactions, categoryOf, subResolver, categoryFilter]);

  // Every card's own resolver, built from its own rules merged with the
  // global ones — a card's transactions are always categorized by its own
  // effective rules, never the active card's. Always available (not gated on
  // combine mode) so Advanced Settings can show every card's rule matches
  // and counts, and so deleting a global rule can freeze its effect on every
  // card it actually touches.
  const allCardSnapshots = useMemo<CardSnapshot[]>(() => {
    if (!activeCard) return [];
    const activeSnap: CardSnapshot = {
      cardId: activeCard.id,
      cardName: activeCard.name,
      currency,
      transactions,
      categoryOf,
      subOf: subResolver.subOf,
    };
    const others = cards
      .filter((c) => c.id !== activeCardId)
      .map((c) => {
        const raw = otherCardsData[c.id];
        if (!raw) return null;
        const rMerged = mergeByKey(globalRules, raw.rules, (r) => r.signature);
        const rMap = new Map(rMerged.map((r) => [r.signature, r]));
        const oMap = new Map(raw.overrides.map((o) => [o.id, o.category]));
        const kwMerged = mergeByKey(globalKeywordRules, raw.keywordRules, (r) => r.keyword);
        const srMerged = mergeByKey(globalSubRules, raw.subRules, (r) => r.id);
        const snap: CardSnapshot = {
          cardId: c.id,
          cardName: c.name,
          currency: raw.currency,
          transactions: raw.transactions,
          categoryOf: makeResolver(rMap, oMap, kwMerged),
          subOf: makeSubResolver(srMerged, raw.subOverrides).subOf,
        };
        return snap;
      })
      .filter((s): s is CardSnapshot => s !== null);
    return [activeSnap, ...others];
  }, [
    activeCard,
    activeCardId,
    currency,
    transactions,
    categoryOf,
    subResolver,
    cards,
    otherCardsData,
    globalRules,
    globalKeywordRules,
    globalSubRules,
  ]);

  const combinedSnapshots = useMemo<CardSnapshot[]>(
    () => (combineEnabled ? allCardSnapshots : []),
    [combineEnabled, allCardSnapshots],
  );

  // Every card's balance data for the Balances tab — always every card,
  // regardless of combine mode, since it's inherently a cross-card overview.
  // Reuses allCardSnapshots' already-loaded raw transactions (unfiltered by
  // any card's own category filter, which balances shouldn't be affected by).
  const balanceCardRows = useMemo(
    () =>
      allCardSnapshots.map((s) => ({
        cardId: s.cardId,
        cardName: s.cardName,
        currency: s.currency,
        type: cardTypes[s.cardId] ?? 'debit',
        transactions: s.transactions,
        checkpoints: cardCheckpoints[s.cardId] ?? [],
      })),
    [allCardSnapshots, cardTypes, cardCheckpoints],
  );

  // Unfiltered by any card's own hidden-category filter — every combined view
  // (Dashboard and Categories alike) is driven by the combined view's own
  // independent filter below, not by whatever any individual card hides.
  const combinedAllData = useMemo(
    () => (combineEnabled ? combineAllData(combinedSnapshots) : null),
    [combineEnabled, combinedSnapshots],
  );

  const combinedDashboardTransactions = useMemo(() => {
    if (!combineEnabled || !combinedAllData) return null;
    const { categoryOf: catOf, subOf } = combinedAllData;
    return combinedAllData.transactions.filter(
      (tx) => !isExcluded(combinedCategoryFilter, catOf(tx), subOf(tx, catOf(tx))),
    );
  }, [combineEnabled, combinedAllData, combinedCategoryFilter]);

  // The read-only merged Transactions view — every card's transactions
  // together, unfiltered by any card's hidden-category filter (matching the
  // single-card Transactions tab, which is likewise never affected by it).
  const combinedRows = useMemo(
    () => (combineEnabled ? combineAllRows(combinedSnapshots) : []),
    [combineEnabled, combinedSnapshots],
  );

  const dashboardTransactions =
    combineEnabled && combinedDashboardTransactions ? combinedDashboardTransactions : visibleTransactions;
  const dashboardCategoryOf = combineEnabled && combinedAllData ? combinedAllData.categoryOf : categoryOf;

  // Advanced Settings shows every card's rules (plus the global ones) all
  // at once — cardRuleSets carries each card's own card-specific rules,
  // untouched by merging, so the UI can label where each one actually lives
  // and route edits/deletes to the right place. allCardSnapshots (above)
  // supplies each card's transactions + effective resolver for counting
  // matches and for freezing a rule's effect on delete.
  const cardRuleSets = useMemo(
    () =>
      cards.map((c) => {
        if (c.id === activeCardId) {
          return { cardId: c.id, cardName: c.name, rules, keywordRules, subRules };
        }
        const raw = otherCardsData[c.id];
        return {
          cardId: c.id,
          cardName: c.name,
          rules: raw?.rules ?? [],
          keywordRules: raw?.keywordRules ?? [],
          subRules: raw?.subRules ?? [],
        };
      }),
    [cards, activeCardId, rules, keywordRules, subRules, otherCardsData],
  );
  // Every expense category any card could budget for — built-ins plus every
  // custom one (global, see lib/cards' CUSTOM_CATEGORIES_KEY doc comment),
  // since Budgets applies at the total (combined) level. Expense-only:
  // there's nothing to "budget" about income.
  const budgetCategoryOptions = useMemo(
    () => [...EXPENSE_CATEGORIES, ...customCategories],
    [customCategories],
  );

  // Classification (the wizard's pending groups) is independent of the display
  // filter above — you can still categorize everything even if some of it is
  // excluded from the charts.
  const grouping = useMemo(
    () => buildGroups(transactions, rulesMap, overridesMap, effectiveKeywordRules),
    [transactions, rulesMap, overridesMap, effectiveKeywordRules],
  );

  const overriddenIds = useMemo(() => new Set(overrides.map((o) => o.id)), [overrides]);

  const handleToggleCategoryFilter = useCallback(
    (category: string) => {
      setCategoryFilter((prev) => {
        const next = toggleCategory(prev, category);
        try {
          localStorage.setItem(scopedKey(CATEGORY_FILTER_KEY, activeCardId), JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [activeCardId],
  );

  const handleToggleSubFilter = useCallback(
    (category: string, subName: string) => {
      setCategoryFilter((prev) => {
        const next = toggleSub(prev, category, subName);
        try {
          localStorage.setItem(scopedKey(CATEGORY_FILTER_KEY, activeCardId), JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [activeCardId],
  );

  // Budgets apply at the total (combined-across-cards) level — every handler
  // below writes to the global BUDGETS_KEY/BUDGET_ENTRIES_KEY, not a
  // per-card one, and none of them depend on activeCardId.
  const handleCreateBudget = useCallback((name: string) => {
    setBudgets((prev) => {
      const next = [...prev, makeBudget(name)];
      try {
        localStorage.setItem(BUDGETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleRenameBudget = useCallback((id: string, name: string) => {
    setBudgets((prev) => {
      const next = renameBudget(prev, id, name);
      try {
        localStorage.setItem(BUDGETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleToggleBudgetCategory = useCallback((id: string, category: string) => {
    setBudgets((prev) => {
      const next = toggleBudgetCategory(prev, id, category);
      try {
        localStorage.setItem(BUDGETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleDeleteBudget = useCallback((id: string) => {
    setBudgets((prev) => {
      const next = prev.filter((b) => b.id !== id);
      try {
        localStorage.setItem(BUDGETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    setBudgetEntries((prev) => {
      const next = removeBudgetEntries(prev, id);
      try {
        localStorage.setItem(BUDGET_ENTRIES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleSetBudgetAmount = useCallback((budgetId: string, weekStart: string, amount: number) => {
    setBudgetEntries((prev) => {
      const next = setBudgetAmount(prev, budgetId, weekStart, amount);
      try {
        localStorage.setItem(BUDGET_ENTRIES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleSetBudgetAmountForWeeks = useCallback((budgetId: string, weekStarts: string[], amount: number) => {
    setBudgetEntries((prev) => {
      const next = setBudgetAmountForWeeks(prev, budgetId, weekStarts, amount);
      try {
        localStorage.setItem(BUDGET_ENTRIES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // --- Balances ------------------------------------------------------------

  const handleSetCardType = useCallback((cardId: string, type: CardType) => {
    setCardTypes((prev) => ({ ...prev, [cardId]: type }));
    try {
      localStorage.setItem(scopedKey(CARD_TYPE_KEY, cardId), type);
    } catch {
      /* ignore */
    }
  }, []);

  const handleAddCheckpoint = useCallback((cardId: string, date: string, balance: number) => {
    setCardCheckpoints((prev) => {
      const next = { ...prev, [cardId]: [...(prev[cardId] ?? []), makeCheckpoint(date, balance)] };
      try {
        localStorage.setItem(scopedKey(BALANCE_CHECKPOINTS_KEY, cardId), JSON.stringify(next[cardId]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleDeleteCheckpoint = useCallback((cardId: string, checkpointId: string) => {
    setCardCheckpoints((prev) => {
      const next = { ...prev, [cardId]: (prev[cardId] ?? []).filter((c) => c.id !== checkpointId) };
      try {
        localStorage.setItem(scopedKey(BALANCE_CHECKPOINTS_KEY, cardId), JSON.stringify(next[cardId]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Assets apply at the total (all-cards) level, not per card — global, like
  // budgets above.
  const handleCreateAsset = useCallback((name: string) => {
    setAssets((prev) => {
      const next = [...prev, makeAsset(name)];
      try {
        localStorage.setItem(ASSETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleRenameAsset = useCallback((id: string, name: string) => {
    setAssets((prev) => {
      const trimmed = name.trim();
      const next = trimmed ? prev.map((a) => (a.id === id ? { ...a, name: trimmed, updatedAt: Date.now() } : a)) : prev;
      try {
        localStorage.setItem(ASSETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleSetAssetKind = useCallback((id: string, kind: AssetKind) => {
    setAssets((prev) => {
      const next = prev.map((a) => (a.id === id ? { ...a, kind, updatedAt: Date.now() } : a));
      try {
        localStorage.setItem(ASSETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleDeleteAsset = useCallback((id: string) => {
    setAssets((prev) => {
      const next = prev.filter((a) => a.id !== id);
      try {
        localStorage.setItem(ASSETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    setAssetValues((prev) => {
      const next = prev.filter((v) => v.assetId !== id);
      try {
        localStorage.setItem(ASSET_VALUES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleAddAssetValue = useCallback((assetId: string, date: string, value: number) => {
    setAssetValues((prev) => {
      const next = [...prev, makeAssetValueEntry(assetId, date, value)];
      try {
        localStorage.setItem(ASSET_VALUES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleDeleteAssetValue = useCallback((id: string) => {
    setAssetValues((prev) => {
      const next = prev.filter((v) => v.id !== id);
      try {
        localStorage.setItem(ASSET_VALUES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // A separate hide/show filter for the combined Categories view — deliberately
  // not scoped to any card, so switching cards or toggling combine mode never
  // affects it, and hiding something here never touches a card's own filter.
  const handleToggleCombinedCategoryFilter = useCallback((category: string) => {
    setCombinedCategoryFilter((prev) => {
      const next = toggleCategory(prev, category);
      try {
        localStorage.setItem(COMBINED_CATEGORY_FILTER_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleToggleCombinedSubFilter = useCallback((category: string, subName: string) => {
    setCombinedCategoryFilter((prev) => {
      const next = toggleSub(prev, category, subName);
      try {
        localStorage.setItem(COMBINED_CATEGORY_FILTER_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  function persistPresets(next: CategoryFilterPreset[]) {
    setFilterPresets(next);
    try {
      localStorage.setItem(CATEGORY_FILTER_PRESETS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  const handleSaveFilterPreset = useCallback(
    (name: string, includedCategories: string[], includedSubs: Record<string, string[]>) => {
      setFilterPresets((prev) => {
        const next = [...prev, makePreset(name, includedCategories, includedSubs)];
        try {
          localStorage.setItem(CATEGORY_FILTER_PRESETS_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [],
  );

  const handleRenameFilterPreset = useCallback(
    (id: string, name: string) => {
      persistPresets(filterPresets.map((p) => (p.id === id ? { ...p, name, updatedAt: Date.now() } : p)));
    },
    [filterPresets],
  );

  const handleDeleteFilterPreset = useCallback(
    (id: string) => {
      persistPresets(filterPresets.filter((p) => p.id !== id));
    },
    [filterPresets],
  );

  // Applying a preset replaces the target filter outright (not a merge) —
  // that's the whole point of a saved, named "this is what should be hidden".
  const handleApplyCategoryFilterPreset = useCallback(
    (filter: CategoryFilterState) => {
      setCategoryFilter(filter);
      try {
        localStorage.setItem(scopedKey(CATEGORY_FILTER_KEY, activeCardId), JSON.stringify(filter));
      } catch {
        /* ignore */
      }
    },
    [activeCardId],
  );

  const handleApplyCombinedCategoryFilterPreset = useCallback((filter: CategoryFilterState) => {
    setCombinedCategoryFilter(filter);
    try {
      localStorage.setItem(COMBINED_CATEGORY_FILTER_KEY, JSON.stringify(filter));
    } catch {
      /* ignore */
    }
  }, []);

  const handleSetSubCategory = useCallback(
    (id: string, parent: string, subName: string) => {
      if (subName === UNSORTED) {
        deleteSubOverride(dbName, id);
        setSubOverrides((prev) => prev.filter((o) => o.id !== id));
        return;
      }
      const o: SubOverride = { id, parent, sub: subName, updatedAt: Date.now() };
      saveSubOverride(dbName, o);
      setSubOverrides((prev) => [...prev.filter((x) => x.id !== id), o]);
    },
    [dbName],
  );

  const handleBulkSetSubCategory = useCallback(
    (ids: string[], parent: string, subName: string) => {
      if (subName === UNSORTED) {
        deleteSubOverrides(dbName, ids);
        const idSet = new Set(ids);
        setSubOverrides((prev) => prev.filter((o) => !idSet.has(o.id)));
        return;
      }
      const newOverrides = ids.map((id) => ({ id, parent, sub: subName, updatedAt: Date.now() }));
      saveSubOverrides(dbName, newOverrides);
      setSubOverrides((prev) => {
        const idSet = new Set(ids);
        return [...prev.filter((o) => !idSet.has(o.id)), ...newOverrides];
      });
      setToast(`Sub-category applied · ${ids.length} transaction${ids.length === 1 ? '' : 's'} → ${subName}`);
    },
    [dbName],
  );

  // A plain per-transaction note, with no categorization rules involved, so
  // — unlike category/sub-category edits — it's editable from anywhere the
  // transaction is shown, including the combined views. `cardId` says which
  // card's own database actually owns this transaction, so this works
  // equally whether it's the active card or one only visible via combine.
  const applyNote = useCallback((t: Transaction, note: string): Transaction => {
    const trimmed = note.trim();
    if (trimmed) return { ...t, note: trimmed };
    const { note: _drop, ...rest } = t;
    return rest as Transaction;
  }, []);

  const handleSetTxNote = useCallback(
    (cardId: string, id: string, note: string) => {
      if (cardId === activeCardId) {
        void setTransactionNote(dbName, id, note);
        setTransactions((prev) => prev.map((t) => (t.id === id ? applyNote(t, note) : t)));
        return;
      }
      const card = cardsRef.current.find((c) => c.id === cardId);
      if (!card) return;
      void setTransactionNote(card.dbName, id, note);
      setOtherCardsData((prev) => {
        const existing = prev[cardId];
        if (!existing) return prev;
        return {
          ...prev,
          [cardId]: { ...existing, transactions: existing.transactions.map((t) => (t.id === id ? applyNote(t, note) : t)) },
        };
      });
    },
    [activeCardId, dbName, applyNote],
  );

  // Deleting a transaction also drops any override/sub-override tied to its
  // id — otherwise they'd sit orphaned in that card's database forever, since
  // nothing ever looks them up again once the transaction itself is gone.
  const handleDeleteTransaction = useCallback(
    (cardId: string, id: string) => {
      if (cardId === activeCardId) {
        void deleteTransaction(dbName, id);
        void deleteOverride(dbName, id);
        void deleteSubOverride(dbName, id);
        setTransactions((prev) => prev.filter((t) => t.id !== id));
        setOverrides((prev) => prev.filter((o) => o.id !== id));
        setSubOverrides((prev) => prev.filter((o) => o.id !== id));
        return;
      }
      const card = cardsRef.current.find((c) => c.id === cardId);
      if (!card) return;
      void deleteTransaction(card.dbName, id);
      void deleteOverride(card.dbName, id);
      void deleteSubOverride(card.dbName, id);
      setOtherCardsData((prev) => {
        const existing = prev[cardId];
        if (!existing) return prev;
        return {
          ...prev,
          [cardId]: {
            ...existing,
            transactions: existing.transactions.filter((t) => t.id !== id),
            overrides: existing.overrides.filter((o) => o.id !== id),
            subOverrides: existing.subOverrides.filter((o) => o.id !== id),
          },
        };
      });
    },
    [activeCardId, dbName],
  );

  const handleSetCategory = useCallback(
    (id: string, category: string) => {
      const o: CategoryOverride = { id, category, updatedAt: Date.now() };
      saveOverride(dbName, o);
      setOverrides((prev) => [...prev.filter((x) => x.id !== id), o]);
    },
    [dbName],
  );

  const handleClearCategory = useCallback(
    (id: string) => {
      deleteOverride(dbName, id);
      setOverrides((prev) => prev.filter((x) => x.id !== id));
    },
    [dbName],
  );

  const handleCreateCategory = useCallback(
    (rawName: string) => {
      setCustomCategories((prev) => {
        const exists =
          prev.some((c) => c.toLowerCase() === rawName.toLowerCase()) ||
          EXPENSE_CATEGORIES.some((c) => c.toLowerCase() === rawName.toLowerCase());
        if (exists) return prev;
        const next = [...prev, rawName];
        try {
          localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      // A category that didn't exist when the user narrowed "Show in charts &
      // totals" down to a subset shouldn't silently start out visible — keep
      // it hidden (both this card's filter and the combined view's) until
      // it's explicitly checked back on.
      setCategoryFilter((prev) => {
        const next = excludeNewCategory(prev, rawName);
        if (next === prev) return prev;
        try {
          localStorage.setItem(scopedKey(CATEGORY_FILTER_KEY, activeCardId), JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      setCombinedCategoryFilter((prev) => {
        const next = excludeNewCategory(prev, rawName);
        if (next === prev) return prev;
        try {
          localStorage.setItem(COMBINED_CATEGORY_FILTER_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [activeCardId],
  );

  // --- Advanced Settings: same operations as above, but scoped to either a
  // specific card or 'global' (shared by every card by default). Writes go
  // to that scope's own database; state updates go to the main state if the
  // scope is the active card, the global state if it's 'global', or
  // otherCardsData for any other card.
  const getScopeDbName = useCallback(
    (scope: string) => (scope === 'global' ? GLOBAL_RULES_DB : cards.find((c) => c.id === scope)?.dbName ?? dbName),
    [cards, dbName],
  );
  const updateScopeKeywordRules = useCallback(
    (scope: string, updater: (prev: KeywordRule[]) => KeywordRule[]) => {
      if (scope === 'global') {
        setGlobalKeywordRules(updater);
      } else if (scope === activeCardId) {
        setKeywordRules(updater);
      } else {
        setOtherCardsData((prev) => {
          const existing = prev[scope];
          if (!existing) return prev;
          return { ...prev, [scope]: { ...existing, keywordRules: updater(existing.keywordRules) } };
        });
      }
    },
    [activeCardId],
  );
  const updateScopeRules = useCallback(
    (scope: string, updater: (prev: CategoryRule[]) => CategoryRule[]) => {
      if (scope === 'global') {
        setGlobalRules(updater);
      } else if (scope === activeCardId) {
        setRules(updater);
      } else {
        setOtherCardsData((prev) => {
          const existing = prev[scope];
          if (!existing) return prev;
          return { ...prev, [scope]: { ...existing, rules: updater(existing.rules) } };
        });
      }
    },
    [activeCardId],
  );
  const updateScopeSubRules = useCallback(
    (scope: string, updater: (prev: SubRule[]) => SubRule[]) => {
      if (scope === 'global') {
        setGlobalSubRules(updater);
      } else if (scope === activeCardId) {
        setSubRules(updater);
      } else {
        setOtherCardsData((prev) => {
          const existing = prev[scope];
          if (!existing) return prev;
          return { ...prev, [scope]: { ...existing, subRules: updater(existing.subRules) } };
        });
      }
    },
    [activeCardId],
  );

  // Before a rule is deleted, freeze its current effect: every transaction it
  // was actually deciding (matches its pattern, isn't already overridden, and
  // currently shows exactly the category/sub-category the rule assigns) gets
  // an explicit override recording that category, so removing the rule can
  // never silently change what an already-categorized transaction shows. A
  // global rule can affect every card, so this checks each one individually
  // with that card's own effective resolver.
  const freezeCategoryForRule = useCallback(
    async (scope: string, category: string, matches: (t: Transaction) => boolean) => {
      const cardIds = scope === 'global' ? cards.map((c) => c.id) : [scope];
      for (const cardId of cardIds) {
        const card = cards.find((c) => c.id === cardId);
        if (!card) continue;
        const isActive = cardId === activeCardId;
        const txs = isActive ? transactions : otherCardsData[cardId]?.transactions;
        const existingOverrides = isActive ? overrides : otherCardsData[cardId]?.overrides;
        const snap = allCardSnapshots.find((s) => s.cardId === cardId);
        if (!txs || !existingOverrides || !snap) continue;
        const overriddenIds = new Set(existingOverrides.map((o) => o.id));
        const newOverrides: CategoryOverride[] = [];
        for (const t of txs) {
          if (overriddenIds.has(t.id) || !matches(t) || snap.categoryOf(t) !== category) continue;
          newOverrides.push({ id: t.id, category, updatedAt: Date.now() });
        }
        if (newOverrides.length === 0) continue;
        await saveCategorization(card.dbName, [], newOverrides);
        const newIds = new Set(newOverrides.map((o) => o.id));
        if (isActive) {
          setOverrides((prev) => [...prev.filter((o) => !newIds.has(o.id)), ...newOverrides]);
        } else {
          setOtherCardsData((prev) => {
            const existing = prev[cardId];
            if (!existing) return prev;
            return {
              ...prev,
              [cardId]: { ...existing, overrides: [...existing.overrides.filter((o) => !newIds.has(o.id)), ...newOverrides] },
            };
          });
        }
      }
    },
    [cards, activeCardId, transactions, overrides, otherCardsData, allCardSnapshots],
  );

  const freezeSubForRule = useCallback(
    async (scope: string, parent: string, sub: string, matches: (t: Transaction) => boolean) => {
      const cardIds = scope === 'global' ? cards.map((c) => c.id) : [scope];
      for (const cardId of cardIds) {
        const card = cards.find((c) => c.id === cardId);
        if (!card) continue;
        const isActive = cardId === activeCardId;
        const txs = isActive ? transactions : otherCardsData[cardId]?.transactions;
        const existingSubOverrides = isActive ? subOverrides : otherCardsData[cardId]?.subOverrides;
        const snap = allCardSnapshots.find((s) => s.cardId === cardId);
        if (!txs || !existingSubOverrides || !snap) continue;
        const overriddenIds = new Set(existingSubOverrides.map((o) => o.id));
        const newSubOverrides: SubOverride[] = [];
        for (const t of txs) {
          if (overriddenIds.has(t.id) || !matches(t)) continue;
          if (snap.categoryOf(t) !== parent || snap.subOf(t, parent) !== sub) continue;
          newSubOverrides.push({ id: t.id, parent, sub, updatedAt: Date.now() });
        }
        if (newSubOverrides.length === 0) continue;
        await saveSubOverrides(card.dbName, newSubOverrides);
        const newIds = new Set(newSubOverrides.map((o) => o.id));
        if (isActive) {
          setSubOverrides((prev) => [...prev.filter((o) => !newIds.has(o.id)), ...newSubOverrides]);
        } else {
          setOtherCardsData((prev) => {
            const existing = prev[cardId];
            if (!existing) return prev;
            return {
              ...prev,
              [cardId]: {
                ...existing,
                subOverrides: [...existing.subOverrides.filter((o) => !newIds.has(o.id)), ...newSubOverrides],
              },
            };
          });
        }
      }
    },
    [cards, activeCardId, transactions, subOverrides, otherCardsData, allCardSnapshots],
  );

  const handleCreateKeywordRuleFor = useCallback(
    (scope: string, keyword: string, category: string) => {
      const rule: KeywordRule = { keyword, category, createdAt: Date.now(), updatedAt: Date.now() };
      saveKeywordRule(getScopeDbName(scope), rule);
      updateScopeKeywordRules(scope, (prev) => [...prev.filter((r) => r.keyword !== keyword), rule]);
      setToast(`Rule saved · “${keyword}” → ${category}`);
    },
    [getScopeDbName, updateScopeKeywordRules],
  );

  const handleDeleteKeywordRuleFor = useCallback(
    async (scope: string, keyword: string, category: string) => {
      await freezeCategoryForRule(scope, category, (t) => t.description.toLowerCase().includes(keyword));
      deleteKeywordRule(getScopeDbName(scope), keyword);
      updateScopeKeywordRules(scope, (prev) => prev.filter((r) => r.keyword !== keyword));
    },
    [freezeCategoryForRule, getScopeDbName, updateScopeKeywordRules],
  );

  // Priority is "newest wins", so reordering swaps the createdAt timestamps
  // of the two adjacent rules rather than needing a separate priority field.
  // Scoped to rules targeting the same category, since that's how they're
  // grouped and reordered in the Advanced Settings view.
  // Keyword rules compete on their keyword text alone — resolveCategory picks
  // the first substring match across ALL of a scope's keyword rules regardless
  // of category, so reordering has to operate on that same full list. Scoping
  // it to same-category siblings (as this used to) let you reorder rules that
  // could never actually conflict, while leaving the real cross-category
  // conflicts completely unaddressable from the UI.
  const handleReorderKeywordRule = useCallback(
    (scope: string, keyword: string, direction: 'up' | 'down') => {
      updateScopeKeywordRules(scope, (prev) => {
        const sorted = [...prev].sort((a, b) => b.createdAt - a.createdAt);
        const idx = sorted.findIndex((r) => r.keyword === keyword);
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return prev;
        const a = sorted[idx];
        const b = sorted[swapIdx];
        const updatedA: KeywordRule = { ...a, createdAt: b.createdAt };
        const updatedB: KeywordRule = { ...b, createdAt: a.createdAt };
        saveKeywordRules(getScopeDbName(scope), [updatedA, updatedB]);
        return prev.map((r) =>
          r.keyword === updatedA.keyword ? updatedA : r.keyword === updatedB.keyword ? updatedB : r,
        );
      });
    },
    [getScopeDbName, updateScopeKeywordRules],
  );

  // One-click fix for a shadowed rule (see AdvancedSettingsPage's shadow
  // detection): bump it to just above whatever rule is currently shadowing
  // it. Works even when the shadowing rule lives in a different scope (e.g.
  // a card rule shadowed by a global one) — priority is a shared numeric
  // order across the merged set, so nudging this rule's own createdAt past
  // the other rule's is enough; the other rule never needs to move.
  const handlePromoteKeywordRuleAbove = useCallback(
    (scope: string, keyword: string, aboveCreatedAt: number) => {
      updateScopeKeywordRules(scope, (prev) => {
        const existing = prev.find((r) => r.keyword === keyword);
        if (!existing) return prev;
        const updated: KeywordRule = { ...existing, createdAt: aboveCreatedAt + 1 };
        saveKeywordRule(getScopeDbName(scope), updated);
        return prev.map((r) => (r.keyword === keyword ? updated : r));
      });
    },
    [getScopeDbName, updateScopeKeywordRules],
  );

  // Editing a keyword rule's target category in place — unlike creating a new
  // rule with that keyword, this keeps the rule's existing priority instead
  // of bumping it to "newest wins".
  const handleUpdateKeywordRuleCategory = useCallback(
    (scope: string, keyword: string, category: string) => {
      updateScopeKeywordRules(scope, (prev) => {
        const existing = prev.find((r) => r.keyword === keyword);
        if (!existing) return prev;
        const updated: KeywordRule = { ...existing, category, updatedAt: Date.now() };
        saveKeywordRule(getScopeDbName(scope), updated);
        return prev.map((r) => (r.keyword === keyword ? updated : r));
      });
    },
    [getScopeDbName, updateScopeKeywordRules],
  );

  const handleUpdateSignatureRuleCategory = useCallback(
    (scope: string, signature: string, category: string) => {
      updateScopeRules(scope, (prev) => {
        const existing = prev.find((r) => r.signature === signature);
        if (!existing) return prev;
        const updated: CategoryRule = { ...existing, category, updatedAt: Date.now() };
        saveCategorization(getScopeDbName(scope), [updated], []);
        return prev.map((r) => (r.signature === signature ? updated : r));
      });
    },
    [getScopeDbName, updateScopeRules],
  );

  const handleDeleteSignatureRule = useCallback(
    async (scope: string, signature: string, category: string) => {
      await freezeCategoryForRule(scope, category, (t) => t.amount < 0 && signatureOf(t.description) === signature);
      deleteRule(getScopeDbName(scope), signature);
      updateScopeRules(scope, (prev) => prev.filter((r) => r.signature !== signature));
    },
    [freezeCategoryForRule, getScopeDbName, updateScopeRules],
  );

  const handleCreateSubRule = useCallback(
    (scope: string, parent: string, keyword: string, subName: string) => {
      const kw = keyword.trim().toLowerCase();
      if (!parent || !kw || !subName) return;
      const rule: SubRule = { id: `${parent}${kw}`, parent, keyword: kw, sub: subName, createdAt: Date.now(), updatedAt: Date.now() };
      saveSubRules(getScopeDbName(scope), [rule]);
      updateScopeSubRules(scope, (prev) => [...prev.filter((r) => r.id !== rule.id), rule]);
      setToast(`Sub-category rule saved · "${kw}" → ${parent} / ${subName}`);
    },
    [getScopeDbName, updateScopeSubRules],
  );

  const handleDeleteSubRule = useCallback(
    async (scope: string, id: string, info: { parent: string; sub: string; keyword: string }) => {
      await freezeSubForRule(scope, info.parent, info.sub, (t) => t.description.toLowerCase().includes(info.keyword));
      deleteSubRule(getScopeDbName(scope), id);
      updateScopeSubRules(scope, (prev) => prev.filter((r) => r.id !== id));
    },
    [freezeSubForRule, getScopeDbName, updateScopeSubRules],
  );

  // A sub-rule's id is derived from its (parent, keyword) pair, so moving it
  // to a different category means replacing it under a new id rather than
  // updating the existing record in place.
  const handleReparentSubRule = useCallback(
    (scope: string, id: string, newParent: string) => {
      updateScopeSubRules(scope, (prev) => {
        const existing = prev.find((r) => r.id === id);
        if (!existing || existing.parent === newParent) return prev;
        const updated: SubRule = { ...existing, parent: newParent, id: `${newParent}${existing.keyword}`, updatedAt: Date.now() };
        const targetDbName = getScopeDbName(scope);
        deleteSubRule(targetDbName, id);
        saveSubRules(targetDbName, [updated]);
        return [...prev.filter((r) => r.id !== id), updated];
      });
    },
    [getScopeDbName, updateScopeSubRules],
  );

  const handleReorderSubRule = useCallback(
    (scope: string, id: string, direction: 'up' | 'down') => {
      updateScopeSubRules(scope, (prev) => {
        const target = prev.find((r) => r.id === id);
        if (!target) return prev;
        const siblings = prev.filter((r) => r.parent === target.parent).sort((a, b) => b.createdAt - a.createdAt);
        const idx = siblings.findIndex((r) => r.id === id);
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (idx < 0 || swapIdx < 0 || swapIdx >= siblings.length) return prev;
        const a = siblings[idx];
        const b = siblings[swapIdx];
        const updatedA: SubRule = { ...a, createdAt: b.createdAt };
        const updatedB: SubRule = { ...b, createdAt: a.createdAt };
        saveSubRules(getScopeDbName(scope), [updatedA, updatedB]);
        return prev.map((r) => (r.id === updatedA.id ? updatedA : r.id === updatedB.id ? updatedB : r));
      });
    },
    [getScopeDbName, updateScopeSubRules],
  );

  // Merchant rules never conflict with each other (each is keyed by a unique
  // signature, so at most one can ever match a given transaction) — this
  // reorder is purely for the user's own browsing order, not resolution.
  const handleReorderSignatureRule = useCallback(
    (scope: string, signature: string, direction: 'up' | 'down') => {
      updateScopeRules(scope, (prev) => {
        const sorted = [...prev].sort((a, b) => b.createdAt - a.createdAt);
        const idx = sorted.findIndex((r) => r.signature === signature);
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return prev;
        const a = sorted[idx];
        const b = sorted[swapIdx];
        const updatedA: CategoryRule = { ...a, createdAt: b.createdAt };
        const updatedB: CategoryRule = { ...b, createdAt: a.createdAt };
        saveCategorization(getScopeDbName(scope), [updatedA, updatedB], []);
        return prev.map((r) =>
          r.signature === updatedA.signature ? updatedA : r.signature === updatedB.signature ? updatedB : r,
        );
      });
    },
    [getScopeDbName, updateScopeRules],
  );

  // Drag-and-drop support (and cross-scope drag): bump just this rule's
  // priority to sit right above whatever it was dropped onto, exactly like
  // the shadow-warning's "Move above" fix — no need to touch the target.
  const handlePromoteSignatureRuleAbove = useCallback(
    (scope: string, signature: string, aboveCreatedAt: number) => {
      updateScopeRules(scope, (prev) => {
        const existing = prev.find((r) => r.signature === signature);
        if (!existing) return prev;
        const updated: CategoryRule = { ...existing, createdAt: aboveCreatedAt + 1 };
        saveCategorization(getScopeDbName(scope), [updated], []);
        return prev.map((r) => (r.signature === signature ? updated : r));
      });
    },
    [getScopeDbName, updateScopeRules],
  );

  const handlePromoteSubRuleAbove = useCallback(
    (scope: string, id: string, aboveCreatedAt: number) => {
      updateScopeSubRules(scope, (prev) => {
        const existing = prev.find((r) => r.id === id);
        if (!existing) return prev;
        const updated: SubRule = { ...existing, createdAt: aboveCreatedAt + 1 };
        saveSubRules(getScopeDbName(scope), [updated]);
        return prev.map((r) => (r.id === id ? updated : r));
      });
    },
    [getScopeDbName, updateScopeSubRules],
  );

  // --- Promote a card-specific rule to global --------------------------------
  // Read-only lookups mirroring getScopeDbName, for the promote handlers below
  // to find a rule's current value before moving it.
  const getScopeKeywordRules = useCallback(
    (scope: string): KeywordRule[] => {
      if (scope === 'global') return globalKeywordRules;
      if (scope === activeCardId) return keywordRules;
      return otherCardsData[scope]?.keywordRules ?? [];
    },
    [globalKeywordRules, activeCardId, keywordRules, otherCardsData],
  );
  const getScopeRules = useCallback(
    (scope: string): CategoryRule[] => {
      if (scope === 'global') return globalRules;
      if (scope === activeCardId) return rules;
      return otherCardsData[scope]?.rules ?? [];
    },
    [globalRules, activeCardId, rules, otherCardsData],
  );
  const getScopeSubRules = useCallback(
    (scope: string): SubRule[] => {
      if (scope === 'global') return globalSubRules;
      if (scope === activeCardId) return subRules;
      return otherCardsData[scope]?.subRules ?? [];
    },
    [globalSubRules, activeCardId, subRules, otherCardsData],
  );

  // Moving a card rule to global keeps its category, sub-category coverage,
  // and createdAt (so its priority position carries over) — it just now
  // applies everywhere. If a global rule already existed for the same
  // keyword/signature/id, this intentionally replaces it: promoting a card's
  // override is "make my version the new default."
  const handleMoveKeywordRuleToGlobal = useCallback(
    (fromScope: string, keyword: string) => {
      if (fromScope === 'global') return;
      const existing = getScopeKeywordRules(fromScope).find((r) => r.keyword === keyword);
      if (!existing) return;
      deleteKeywordRule(getScopeDbName(fromScope), keyword);
      updateScopeKeywordRules(fromScope, (prev) => prev.filter((r) => r.keyword !== keyword));
      saveKeywordRule(getScopeDbName('global'), existing);
      updateScopeKeywordRules('global', (prev) => [...prev.filter((r) => r.keyword !== keyword), existing]);
      setToast(`"${keyword}" is now a global rule.`);
    },
    [getScopeKeywordRules, getScopeDbName, updateScopeKeywordRules],
  );

  const handleMoveSignatureRuleToGlobal = useCallback(
    (fromScope: string, signature: string) => {
      if (fromScope === 'global') return;
      const existing = getScopeRules(fromScope).find((r) => r.signature === signature);
      if (!existing) return;
      deleteRule(getScopeDbName(fromScope), signature);
      updateScopeRules(fromScope, (prev) => prev.filter((r) => r.signature !== signature));
      saveCategorization(getScopeDbName('global'), [existing], []);
      updateScopeRules('global', (prev) => [...prev.filter((r) => r.signature !== signature), existing]);
      setToast(`Merchant rule "${signature}" is now global.`);
    },
    [getScopeRules, getScopeDbName, updateScopeRules],
  );

  const handleMoveSubRuleToGlobal = useCallback(
    (fromScope: string, id: string) => {
      if (fromScope === 'global') return;
      const existing = getScopeSubRules(fromScope).find((r) => r.id === id);
      if (!existing) return;
      deleteSubRule(getScopeDbName(fromScope), id);
      updateScopeSubRules(fromScope, (prev) => prev.filter((r) => r.id !== id));
      saveSubRules(getScopeDbName('global'), [existing]);
      updateScopeSubRules('global', (prev) => [...prev.filter((r) => r.id !== id), existing]);
      setToast(`Sub-category rule "${existing.keyword}" is now global.`);
    },
    [getScopeSubRules, getScopeDbName, updateScopeSubRules],
  );

  // Custom categories are global (see lib/cards' CUSTOM_CATEGORIES_KEY doc
  // comment) — creating one for any scope adds it to the one shared list.
  // Only "keep it hidden until explicitly shown" still depends on scope,
  // since each card (and the combined view) keeps its own category filter.
  const handleCreateCategoryFor = useCallback(
    (scope: string, rawName: string) => {
      if (scope === 'global' || scope === activeCardId) {
        handleCreateCategory(rawName);
        return;
      }
      setCustomCategories((prev) => {
        const exists =
          prev.some((c) => c.toLowerCase() === rawName.toLowerCase()) ||
          EXPENSE_CATEGORIES.some((c) => c.toLowerCase() === rawName.toLowerCase());
        if (exists) return prev;
        const next = [...prev, rawName];
        try {
          localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      try {
        const filterKey = scopedKey(CATEGORY_FILTER_KEY, scope);
        const savedFilter = JSON.parse(localStorage.getItem(filterKey) ?? 'null');
        const scopeFilter = isValidCategoryFilter(savedFilter) ? savedFilter : defaultCategoryFilter();
        const nextFilter = excludeNewCategory(scopeFilter, rawName);
        if (nextFilter !== scopeFilter) localStorage.setItem(filterKey, JSON.stringify(nextFilter));
      } catch {
        /* ignore */
      }
      setCombinedCategoryFilter((prevFilter) => {
        const next = excludeNewCategory(prevFilter, rawName);
        if (next === prevFilter) return prevFilter;
        try {
          localStorage.setItem(COMBINED_CATEGORY_FILTER_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [activeCardId, handleCreateCategory],
  );

  const handleWizardComplete = useCallback(
    async (newRules: CategoryRule[], newOverrides: CategoryOverride[], newKeywordRules: KeywordRule[]) => {
      // Merge: new decisions replace any existing rule/override with the same key.
      const mergedRules = new Map(rules.map((r) => [r.signature, r]));
      for (const r of newRules) mergedRules.set(r.signature, r);
      const mergedOverrides = new Map(overrides.map((o) => [o.id, o]));
      for (const o of newOverrides) mergedOverrides.set(o.id, o);

      await saveCategorization(dbName, newRules, newOverrides);
      setRules([...mergedRules.values()]);
      setOverrides([...mergedOverrides.values()]);
      // Keyword rules split off in the wizard are, like every other rule,
      // shared by every card by default.
      for (const kr of newKeywordRules) handleCreateKeywordRuleFor('global', kr.keyword, kr.category);
      setWizardOpen(false);
      const n = newRules.length + newOverrides.length + newKeywordRules.length;
      if (n > 0) {
        setToast(`Categorization saved · ${newRules.length + newKeywordRules.length} rules applied`);
      }
    },
    [rules, overrides, dbName, handleCreateKeywordRuleFor],
  );

  const handleCurrencyChange = useCallback(
    (code: string) => {
      setCurrency(code);
      setCurrencyState(code);
      try {
        localStorage.setItem(scopedKey(CURRENCY_KEY, activeCardId), code);
      } catch {
        /* ignore */
      }
    },
    [activeCardId],
  );

  const handleMonthStartChange = useCallback(
    (day: number) => {
      setMonthStartDay(day);
      try {
        localStorage.setItem(scopedKey(MONTH_START_KEY, activeCardId), String(day));
      } catch {
        /* ignore */
      }
    },
    [activeCardId],
  );

  const handleWeekStartChange = useCallback(
    (day: number) => {
      setWeekStartDay(day);
      try {
        localStorage.setItem(scopedKey(WEEK_START_KEY, activeCardId), String(day));
      } catch {
        /* ignore */
      }
    },
    [activeCardId],
  );

  const handleExportJSON = useCallback(() => downloadBackup(transactions), [transactions]);
  const handleExportCSV = useCallback(() => downloadCSV(transactions), [transactions]);

  const handleExportFullBackup = useCallback(async () => {
    try {
      const backup = await buildFullBackup(
        cards,
        activeCardId,
        theme,
        combinedCategoryFilter,
        filterPresets,
        budgets,
        budgetEntries,
        assets,
        assetValues,
      );
      downloadFullBackup(backup);
    } catch (e) {
      setToast(`Could not build the full backup. ${(e as Error).message ?? ''}`.trim());
    }
  }, [cards, activeCardId, theme, combinedCategoryFilter, filterPresets, budgets, budgetEntries, assets, assetValues]);

  // Shared by both restore paths (a picked file, or a cloud sync download)
  // once each has already confirmed with the user — applies a parsed backup
  // to every piece of state it touches.
  const applyRestoredBackup = useCallback(
    async (backup: FullBackupFile) => {
      const result = await restoreFullBackup(
        backup,
        cards,
        combinedCategoryFilter,
        filterPresets,
        budgets,
        budgetEntries,
        assets,
        assetValues,
      );
      setCards(result.cards);
      setActiveCardId(result.activeCardId);
      setTheme(result.theme);
      setCombinedCategoryFilter(result.combinedCategoryFilter);
      setFilterPresets(result.filterPresets);
      setBudgets(result.budgets);
      setBudgetEntries(result.budgetEntries);
      setAssets(result.assets);
      setAssetValues(result.assetValues);
      // Restored cards may carry a card type / balance checkpoints that
      // restoreFullBackup already wrote to localStorage above — reload
      // this in-memory record from every current card so the Balances tab
      // reflects them immediately instead of only after a refresh.
      setCardTypes(Object.fromEntries(result.cards.map((c) => [c.id, loadCardType(c.id)])));
      setCardCheckpoints(Object.fromEntries(result.cards.map((c) => [c.id, loadCardCheckpoints(c.id)])));
      setGlobalRules(result.globalRules);
      setGlobalKeywordRules(result.globalKeywordRules);
      setGlobalSubRules(result.globalSubRules);
      setCustomCategories(result.customCategories);
      setReloadToken((n) => n + 1);
      setToast('Full backup restored.');
    },
    [cards, combinedCategoryFilter, filterPresets, budgets, budgetEntries, assets, assetValues],
  );

  const handleRestoreFullBackup = useCallback(
    async (file: File) => {
      try {
        const backup = parseFullBackup(await file.text());
        const backupCards = Array.isArray(backup.cards) ? backup.cards : [];
        const txCount = backupCards.reduce(
          (a, c) => a + (Array.isArray(c?.transactions) ? c.transactions.length : 0),
          0,
        );
        const noteCount = Array.isArray(backup.notes) ? backup.notes.length : 0;
        const ok = confirm(
          `Restore this backup (from ${backup.exportedAt.slice(0, 10)})? It covers ${txCount} ` +
            `transaction${txCount === 1 ? '' : 's'} across ${backupCards.length} card` +
            `${backupCards.length === 1 ? '' : 's'} and ${noteCount} note` +
            `${noteCount === 1 ? '' : 's'}. Existing data is kept, matching cards are ` +
            'merged and new cards are added.',
        );
        if (!ok) return;
        await applyRestoredBackup(backup);
      } catch (e) {
        setError(`Could not restore that backup. ${(e as Error).message ?? ''}`.trim());
      }
    },
    [applyRestoredBackup],
  );

  // The confirm dialog for a cloud restore lives in CloudSyncSettings
  // itself (it already knows which provider and why), so this just parses
  // and applies — no second confirmation here.
  const handleRestoreFromCloudJSON = useCallback(
    async (json: string) => {
      try {
        const backup = parseFullBackup(json);
        await applyRestoredBackup(backup);
      } catch (e) {
        setError(`Could not restore the cloud backup. ${(e as Error).message ?? ''}`.trim());
        throw e;
      }
    },
    [applyRestoredBackup],
  );

  const handleExportRulesBackup = useCallback(async () => {
    try {
      const backup = await buildRulesBackup(cards);
      downloadRulesBackup(backup);
    } catch (e) {
      setToast(`Could not export rules. ${(e as Error).message ?? ''}`.trim());
    }
  }, [cards]);

  const handleImportRulesFile = useCallback(
    async (file: File) => {
      try {
        const backup = parseRulesBackup(await file.text());
        const ruleCount =
          backup.globalRules.length +
          backup.globalKeywordRules.length +
          backup.globalSubRules.length +
          backup.cards.reduce((a, c) => a + c.rules.length + c.keywordRules.length + c.subRules.length, 0);
        const ok = confirm(
          `Import this rules file (from ${backup.exportedAt.slice(0, 10)})? It covers ${ruleCount} rule` +
            `${ruleCount === 1 ? '' : 's'} across ${backup.cards.length} card` +
            `${backup.cards.length === 1 ? '' : 's'} plus global rules. Existing rules are kept, ` +
            'matching ones are overwritten, nothing is deleted.',
        );
        if (!ok) return;
        const result = await restoreRulesBackup(backup, cards);
        setGlobalRules(result.globalRules);
        setGlobalKeywordRules(result.globalKeywordRules);
        setGlobalSubRules(result.globalSubRules);
        setCustomCategories(result.customCategories);
        setReloadToken((n) => n + 1);
        setToast(
          result.skippedCards.length > 0
            ? `Rules imported. Skipped (no matching card): ${result.skippedCards.join(', ')}`
            : 'Rules imported.',
        );
      } catch (e) {
        setError(`Could not import that rules file. ${(e as Error).message ?? ''}`.trim());
      }
    },
    [cards],
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      const list = Array.from(files);
      if (list.length === 0) return;
      const file = list[0];

      // A CashFlow JSON backup — either a single card or a full multi-card
      // backup — is restored directly, skipping column mapping.
      if (isBackupFile(file.name)) {
        const text = await file.text();
        const kind = sniffBackupKind(text);
        if (kind === 'full') {
          await handleRestoreFullBackup(file);
          return;
        }
        try {
          const restored = parseBackup(text);
          const result = await addTransactions(dbName, restored, file.name);
          setTransactions(await getAllTransactions(dbName));
          setToast(
            `Restored backup · ${result.added} added${
              result.duplicates ? `, ${result.duplicates} already present` : ''
            }`,
          );
        } catch (e) {
          setError(`Could not restore that backup. ${(e as Error).message ?? ''}`.trim());
        }
        return;
      }

      // Otherwise inspect the statement so the user can confirm its columns.
      try {
        const parsed = await inspectFile(file);
        if (parsed.rows.length === 0) {
          setError(`No rows found in "${parsed.fileName}". Is it an exported transaction file?`);
          return;
        }
        // Prefer the mapping this card used last time — but only if every
        // column it names still exists in this file, so a bank's changed
        // export format falls back to fresh auto-detection instead of
        // silently applying a stale/broken mapping.
        const savedMapping = loadSavedColumnMapping(activeCardId);
        const suggestedMapping =
          savedMapping && mappingFitsHeaders(savedMapping, parsed.headers) ? savedMapping : parsed.suggestedMapping;
        setPending({ ...parsed, suggestedMapping });
      } catch (e) {
        setError(`Could not read that file. ${(e as Error).message ?? ''}`.trim());
      }
    },
    [dbName, handleRestoreFullBackup, activeCardId],
  );

  const handleConfirmMapping = useCallback(
    async (parsed: ParsedFile, mapping: ColumnMapping) => {
      setBusy(true);
      setError(null);
      try {
        const { transactions: txs, skipped } = normalize(parsed, mapping);
        if (txs.length === 0) {
          setError('No usable transactions were found with that column mapping.');
          setBusy(false);
          return;
        }
        const result: ImportResult = await addTransactions(dbName, txs, parsed.fileName);
        const fresh = await getAllTransactions(dbName);
        setTransactions(fresh);
        setPending(null);
        setToast(buildToast(result, skipped));
        try {
          localStorage.setItem(scopedKey(COLUMN_MAPPING_KEY, activeCardId), JSON.stringify(mapping));
        } catch {
          /* ignore unavailable localStorage */
        }
      } catch (e) {
        setError(`Import failed. ${(e as Error).message ?? ''}`.trim());
      } finally {
        setBusy(false);
      }
    },
    [dbName, activeCardId],
  );

  const handleClearAll = useCallback(async () => {
    if (!confirm('Delete all stored statements and analysis for this card? This cannot be undone.')) {
      return;
    }
    await clearAll(dbName);
    try {
      localStorage.removeItem(scopedKey(CATEGORY_FILTER_KEY, activeCardId));
    } catch {
      /* ignore */
    }
    setTransactions([]);
    setRules([]);
    setOverrides([]);
    setKeywordRules([]);
    setSubRules([]);
    setSubOverrides([]);
    setCategoryFilter(defaultCategoryFilter());
    setToast('All data cleared for this card.');
  }, [dbName, activeCardId]);

  const handleClearTransactionsOnly = useCallback(async () => {
    if (
      !confirm(
        'Remove all transactions from this card? Categories, rules, and filters are all kept, ' +
          'this just clears the statements themselves.',
      )
    ) {
      return;
    }
    await clearTransactionsOnly(dbName);
    setTransactions([]);
    setToast('Transactions cleared. Categories and rules were kept.');
  }, [dbName]);

  // --- Card management ---------------------------------------------------

  const handleSwitchCard = useCallback(
    (id: string) => {
      if (id === COMBINE_CARD_ID) {
        if (combineEnabled) return;
        setCombineEnabled(true);
        try {
          localStorage.setItem(COMBINE_KEY, '1');
        } catch {
          /* ignore */
        }
        return;
      }
      const wasCombined = combineEnabled;
      if (wasCombined) {
        setCombineEnabled(false);
        try {
          localStorage.setItem(COMBINE_KEY, '0');
        } catch {
          /* ignore */
        }
      }
      if (id === activeCardId) return;
      setActiveCardId(id);
      saveActiveCardId(id);
      // Keep whichever tab (Dashboard/Categories/Transactions) the user was
      // already on — switching cards shouldn't reset where you're looking.
      setWizardOpen(false);
    },
    [activeCardId, combineEnabled],
  );

  const handleCreateCard = useCallback(
    async (name: string, copyFromId: string | null, opts: CopyOptions) => {
      setCardBusy(true);
      try {
        const card = makeCard(name);
        const source = copyFromId ? cards.find((c) => c.id === copyFromId) : undefined;
        if (source) {
          if (opts.rules) {
            const srcRules = await getRules(source.dbName);
            // Exclusion lists reference the source card's transaction ids,
            // which are meaningless (and never present) on a brand-new card.
            const cleaned = srcRules.map((r) => ({ ...r, excludedIds: [] }));
            if (cleaned.length > 0) await saveCategorization(card.dbName, cleaned, []);
          }
          if (opts.keywords) {
            const srcKeywords = await getKeywordRules(source.dbName);
            if (srcKeywords.length > 0) await saveKeywordRules(card.dbName, srcKeywords);
          }
          if (opts.subRules) {
            const srcSubRules = await getSubRules(source.dbName);
            if (srcSubRules.length > 0) await saveSubRules(card.dbName, srcSubRules);
          }
          // Custom categories are global (see lib/cards' CUSTOM_CATEGORIES_KEY
          // doc comment) — a new card already sees every one of them, nothing
          // to copy.
        }
        const next = [...cards, card];
        setCards(next);
        saveCards(next);
        setCardTypes((prev) => ({ ...prev, [card.id]: 'debit' }));
        setCardCheckpoints((prev) => ({ ...prev, [card.id]: [] }));
        setActiveCardId(card.id);
        saveActiveCardId(card.id);
        setWizardOpen(false);
        setCardManagerOpen(false);
        setToast(`Card created · ${card.name}`);
      } catch (e) {
        setToast(`Could not create card. ${(e as Error).message ?? ''}`.trim());
      } finally {
        setCardBusy(false);
      }
    },
    [cards],
  );

  // Absorbs `source` into `target`: transactions move over (the same
  // dedup-by-content logic a normal import uses, so a statement present on
  // both cards isn't duplicated), each card's own rule overrides and
  // category filter are merged (target's own entries win a same-key
  // conflict, since it's the card that survives), and `source` is deleted
  // entirely once its data has landed. Triggered by renaming a card to
  // (near-)match another one's name — see handleRenameCard below.
  const handleMergeCards = useCallback(
    async (source: Card, target: Card) => {
      setCardBusy(true);
      try {
        const srcTxs = await getAllTransactions(source.dbName);
        if (srcTxs.length > 0) await addTransactions(target.dbName, srcTxs, `merge-${source.name}`);

        const [srcRules, srcOverrides, srcKeywords, srcSubRules, srcSubOverrides, tgtRules, tgtKeywords, tgtSubRules] =
          await Promise.all([
            getRules(source.dbName),
            getOverrides(source.dbName),
            getKeywordRules(source.dbName),
            getSubRules(source.dbName),
            getSubOverrides(source.dbName),
            getRules(target.dbName),
            getKeywordRules(target.dbName),
            getSubRules(target.dbName),
          ]);
        const mergedRules = mergeByKey(srcRules, tgtRules, (r) => r.signature);
        const mergedKeywords = mergeByKey(srcKeywords, tgtKeywords, (r) => r.keyword);
        const mergedSubRules = mergeByKey(srcSubRules, tgtSubRules, (r) => r.id);
        await saveCategorization(target.dbName, mergedRules, srcOverrides);
        if (mergedKeywords.length > 0) await saveKeywordRules(target.dbName, mergedKeywords);
        if (mergedSubRules.length > 0) await saveSubRules(target.dbName, mergedSubRules);
        if (srcSubOverrides.length > 0) await saveSubOverrides(target.dbName, srcSubOverrides);

        try {
          const srcFilterRaw = JSON.parse(localStorage.getItem(scopedKey(CATEGORY_FILTER_KEY, source.id)) ?? 'null');
          const tgtFilterRaw = JSON.parse(localStorage.getItem(scopedKey(CATEGORY_FILTER_KEY, target.id)) ?? 'null');
          const srcFilter = isValidCategoryFilter(srcFilterRaw) ? srcFilterRaw : defaultCategoryFilter();
          const tgtFilter = isValidCategoryFilter(tgtFilterRaw) ? tgtFilterRaw : defaultCategoryFilter();
          const mergedFilter = unionCategoryFilter(srcFilter, tgtFilter);
          localStorage.setItem(scopedKey(CATEGORY_FILTER_KEY, target.id), JSON.stringify(mergedFilter));
          if (target.id === activeCardId) setCategoryFilter(mergedFilter);
        } catch {
          /* ignore */
        }

        const mergedCheckpoints = mergeCheckpoints(cardCheckpoints[source.id] ?? [], cardCheckpoints[target.id] ?? []);
        try {
          localStorage.setItem(scopedKey(BALANCE_CHECKPOINTS_KEY, target.id), JSON.stringify(mergedCheckpoints));
        } catch {
          /* ignore */
        }

        await deleteCardDatabase(source.dbName);
        try {
          localStorage.removeItem(scopedKey(CATEGORY_FILTER_KEY, source.id));
          localStorage.removeItem(scopedKey(CURRENCY_KEY, source.id));
          localStorage.removeItem(scopedKey(MONTH_START_KEY, source.id));
          localStorage.removeItem(scopedKey(WEEK_START_KEY, source.id));
          localStorage.removeItem(scopedKey(CARD_TYPE_KEY, source.id));
          localStorage.removeItem(scopedKey(BALANCE_CHECKPOINTS_KEY, source.id));
        } catch {
          /* ignore */
        }

        const next = cards.filter((c) => c.id !== source.id);
        setCards(next);
        saveCards(next);
        setCardTypes((prev) => {
          const rest = { ...prev };
          delete rest[source.id];
          return rest;
        });
        setCardCheckpoints((prev) => {
          const rest = { ...prev };
          delete rest[source.id];
          rest[target.id] = mergedCheckpoints;
          return rest;
        });

        if (source.id === activeCardId) {
          setActiveCardId(target.id);
          saveActiveCardId(target.id);
        } else if (target.id === activeCardId) {
          setReloadToken((n) => n + 1);
        }

        if (next.length <= 1 && combineEnabled) {
          setCombineEnabled(false);
          try {
            localStorage.setItem(COMBINE_KEY, '0');
          } catch {
            /* ignore */
          }
        }

        setToast(`Merged "${source.name}" into "${target.name}"`);
      } catch (e) {
        setToast(`Could not merge cards. ${(e as Error).message ?? ''}`.trim());
      } finally {
        setCardBusy(false);
      }
    },
    [cards, activeCardId, combineEnabled, cardCheckpoints],
  );

  const handleRenameCard = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const source = cards.find((c) => c.id === id);
      if (!source) return;
      const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
      const target = cards.find((c) => c.id !== id && normalize(c.name) === normalize(trimmed));
      if (target) {
        const proceed = confirm(
          `A card named "${target.name}" already exists. Merge "${source.name}" into it? All of ` +
            `"${source.name}"'s transactions will move into "${target.name}", and "${source.name}" will ` +
            'be removed. This cannot be undone.',
        );
        if (!proceed) return;
        void handleMergeCards(source, target);
        return;
      }
      setCards((prev) => {
        const next = prev.map((c) => (c.id === id ? { ...c, name: trimmed } : c));
        saveCards(next);
        return next;
      });
    },
    [cards, handleMergeCards],
  );

  const handleDeleteCard = useCallback(
    async (id: string) => {
      const card = cards.find((c) => c.id === id);
      if (!card) return;
      if (cards.length <= 1) return;
      if (!confirm(`Delete "${card.name}" and all of its data? This cannot be undone.`)) return;

      await deleteCardDatabase(card.dbName);
      try {
        localStorage.removeItem(scopedKey(CATEGORY_FILTER_KEY, id));
        localStorage.removeItem(scopedKey(CURRENCY_KEY, id));
        localStorage.removeItem(scopedKey(MONTH_START_KEY, id));
        localStorage.removeItem(scopedKey(WEEK_START_KEY, id));
        localStorage.removeItem(scopedKey(CARD_TYPE_KEY, id));
        localStorage.removeItem(scopedKey(BALANCE_CHECKPOINTS_KEY, id));
      } catch {
        /* ignore */
      }

      const next = cards.filter((c) => c.id !== id);
      setCards(next);
      saveCards(next);
      setCardTypes((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id)));
      setCardCheckpoints((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id)));
      if (id === activeCardId) {
        const fallback = next[0];
        setActiveCardId(fallback.id);
        saveActiveCardId(fallback.id);
        setWizardOpen(false);
      }
      // "Combine all cards" only makes sense (and is only reachable to turn
      // back off) with 2+ cards — dropping to a single one would otherwise
      // strand the app in a combined view with no way back to it via the UI.
      if (next.length <= 1 && combineEnabled) {
        setCombineEnabled(false);
        try {
          localStorage.setItem(COMBINE_KEY, '0');
        } catch {
          /* ignore */
        }
        if (next[0] && next[0].id !== activeCardId) {
          setActiveCardId(next[0].id);
          saveActiveCardId(next[0].id);
        }
      }
      setToast(`Deleted card · ${card.name}`);
    },
    [cards, activeCardId, combineEnabled],
  );

  // --- Cloud sync ------------------------------------------------------
  // The sync engine builds its own upload payload on demand (reusing the
  // exact same full-backup shape "Download full backup" produces) via a
  // callback registered once here; the ref keeps that callback reading
  // fresh values without re-registering it — and therefore without
  // resetting any in-flight debounce — on every render.
  const backupParamsRef = useRef({
    cards,
    activeCardId,
    theme,
    combinedCategoryFilter,
    filterPresets,
    budgets,
    budgetEntries,
    assets,
    assetValues,
  });
  useEffect(() => {
    backupParamsRef.current = {
      cards,
      activeCardId,
      theme,
      combinedCategoryFilter,
      filterPresets,
      budgets,
      budgetEntries,
      assets,
      assetValues,
    };
  });

  useEffect(() => {
    syncEngine.configurePayloadSource(async () => {
      const p = backupParamsRef.current;
      const backup = await buildFullBackup(
        p.cards,
        p.activeCardId,
        p.theme,
        p.combinedCategoryFilter,
        p.filterPresets,
        p.budgets,
        p.budgetEntries,
        p.assets,
        p.assetValues,
      );
      return JSON.stringify(backup);
    });
  }, []);

  // Broad on purpose: any of these changing means the next full-backup
  // payload would differ, which is the only signal a debounced "does
  // anything need pushing" check actually needs.
  useEffect(() => {
    syncEngine.notifyChange();
  }, [
    transactions,
    rules,
    overrides,
    keywordRules,
    subRules,
    subOverrides,
    customCategories,
    categoryFilter,
    cards,
    otherCardsData,
    budgets,
    budgetEntries,
    assets,
    assetValues,
    cardTypes,
    cardCheckpoints,
    combinedCategoryFilter,
    filterPresets,
    globalRules,
    globalKeywordRules,
    globalSubRules,
    theme,
  ]);

  const hasData = transactions.length > 0;
  const canCategorize = grouping.groups.length > 0 || grouping.leftovers.length > 0;

  return (
    <div className="app">
      <Header
        currency={currency}
        onCurrencyChange={handleCurrencyChange}
        monthStartDay={monthStartDay}
        onMonthStartChange={handleMonthStartChange}
        weekStartDay={weekStartDay}
        onWeekStartChange={handleWeekStartChange}
        hasData={hasData}
        onClearAll={handleClearAll}
        onClearTransactionsOnly={handleClearTransactionsOnly}
        onExportJSON={handleExportJSON}
        onExportCSV={handleExportCSV}
        onExportFullBackup={handleExportFullBackup}
        onRestoreFullBackup={handleRestoreFullBackup}
        cards={cards}
        activeCardId={activeCardId}
        combineEnabled={combineEnabled}
        onSwitchCard={handleSwitchCard}
        onManageCards={() => setCardManagerOpen(true)}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onOpenCloudSync={() => setCloudSyncOpen(true)}
      />

      <main className="container">
        {loading ? (
          <div className="loading">Loading your data…</div>
        ) : (
          <>
            {hasData && (
              <nav className="tabs">
                <button
                  type="button"
                  className={view === 'dashboard' ? 'on' : ''}
                  onClick={() => handleTabClick('dashboard')}
                >
                  Dashboard
                </button>
                <button
                  type="button"
                  className={view === 'categories' ? 'on' : ''}
                  onClick={() => handleTabClick('categories')}
                >
                  Categories
                </button>
                <button
                  type="button"
                  className={view === 'transactions' ? 'on' : ''}
                  onClick={() => handleTabClick('transactions')}
                >
                  Transactions
                </button>
                <button
                  type="button"
                  className={`tabs-right ${view === 'budgets' ? 'on' : ''}`}
                  onClick={() => handleTabClick('budgets')}
                  disabled={!combineEnabled}
                  title={combineEnabled ? undefined : 'Switch on "Combine all cards" to use Budgets'}
                >
                  Budgets
                </button>
                <button
                  type="button"
                  className={view === 'balances' ? 'on' : ''}
                  onClick={() => handleTabClick('balances')}
                >
                  Balances
                </button>
                <button
                  type="button"
                  className={view === 'advanced' ? 'on' : ''}
                  onClick={() => handleTabClick('advanced')}
                >
                  Advanced Settings
                </button>
              </nav>
            )}

            {(view === 'dashboard' || !hasData) && !combineEnabled && (
              <UploadPanel onFiles={handleFiles} compact={hasData} />
            )}

            {error && (
              <div className="banner banner-error">
                <span>{error}</span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => window.location.reload()}
                >
                  Reload
                </button>
              </div>
            )}

            {!hasData ? (
              <EmptyState />
            ) : view === 'categories' ? (
              combineEnabled && combinedAllData ? (
                <CombinedCategoriesPage
                  transactions={combinedAllData.transactions}
                  categoryOf={combinedAllData.categoryOf}
                  monthStartDay={monthStartDay}
                  weekStartDay={weekStartDay}
                  subOf={combinedAllData.subOf}
                  cardNameOf={combinedAllData.cardNameOf}
                  cardIdOf={combinedAllData.cardIdOf}
                  categoryFilter={combinedCategoryFilter}
                  onToggleCategoryFilter={handleToggleCombinedCategoryFilter}
                  onToggleSubFilter={handleToggleCombinedSubFilter}
                  onSetTxNote={handleSetTxNote}
                  presets={filterPresets}
                  onSavePreset={handleSaveFilterPreset}
                  onRenamePreset={handleRenameFilterPreset}
                  onDeletePreset={handleDeleteFilterPreset}
                  onApplyPreset={handleApplyCombinedCategoryFilterPreset}
                />
              ) : (
                <CategoriesPage
                  transactions={transactions}
                  categoryOf={categoryOf}
                  monthStartDay={monthStartDay}
                  weekStartDay={weekStartDay}
                  sub={subResolver}
                  onBulkSetSubCategory={handleBulkSetSubCategory}
                  onSetTxNote={(id, note) => handleSetTxNote(activeCardId, id, note)}
                  categoryFilter={categoryFilter}
                  onToggleCategoryFilter={handleToggleCategoryFilter}
                  onToggleSubFilter={handleToggleSubFilter}
                  presets={filterPresets}
                  onSavePreset={handleSaveFilterPreset}
                  onRenamePreset={handleRenameFilterPreset}
                  onDeletePreset={handleDeleteFilterPreset}
                  onApplyPreset={handleApplyCategoryFilterPreset}
                />
              )
            ) : view === 'budgets' ? (
              combineEnabled && combinedAllData ? (
                <BudgetsPage
                  transactions={combinedAllData.transactions}
                  categoryOf={combinedAllData.categoryOf}
                  monthStartDay={monthStartDay}
                  weekStartDay={weekStartDay}
                  categoryOptions={budgetCategoryOptions}
                  budgets={budgets}
                  budgetEntries={budgetEntries}
                  onCreateBudget={handleCreateBudget}
                  onRenameBudget={handleRenameBudget}
                  onDeleteBudget={handleDeleteBudget}
                  onToggleBudgetCategory={handleToggleBudgetCategory}
                  onSetAmount={handleSetBudgetAmount}
                  onSetAmountForWeeks={handleSetBudgetAmountForWeeks}
                />
              ) : (
                <section className="panel">
                  <p className="muted">Switch on "Combine all cards" above to use Budgets.</p>
                </section>
              )
            ) : view === 'balances' ? (
              <BalancesPage
                cards={balanceCardRows}
                assets={assets}
                assetValues={assetValues}
                onSetCardType={handleSetCardType}
                onAddCheckpoint={handleAddCheckpoint}
                onDeleteCheckpoint={handleDeleteCheckpoint}
                onCreateAsset={handleCreateAsset}
                onRenameAsset={handleRenameAsset}
                onSetAssetKind={handleSetAssetKind}
                onDeleteAsset={handleDeleteAsset}
                onAddAssetValue={handleAddAssetValue}
                onDeleteAssetValue={handleDeleteAssetValue}
              />
            ) : view === 'advanced' ? (
              <AdvancedSettingsPage
                cards={cards}
                countCardId={countCardId}
                onChangeCountCard={setCountCardId}
                cardSnapshots={allCardSnapshots}
                globalRules={globalRules}
                globalKeywordRules={globalKeywordRules}
                globalSubRules={globalSubRules}
                cardRuleSets={cardRuleSets}
                customCategories={customCategories}
                onCreateCategory={handleCreateCategoryFor}
                onCreateKeywordRule={handleCreateKeywordRuleFor}
                onUpdateKeywordRuleCategory={handleUpdateKeywordRuleCategory}
                onDeleteKeywordRule={handleDeleteKeywordRuleFor}
                onReorderKeywordRule={handleReorderKeywordRule}
                onPromoteKeywordRuleAbove={handlePromoteKeywordRuleAbove}
                onMoveKeywordRuleToGlobal={handleMoveKeywordRuleToGlobal}
                onUpdateSignatureRuleCategory={handleUpdateSignatureRuleCategory}
                onDeleteSignatureRule={handleDeleteSignatureRule}
                onReorderSignatureRule={handleReorderSignatureRule}
                onPromoteSignatureRuleAbove={handlePromoteSignatureRuleAbove}
                onMoveSignatureRuleToGlobal={handleMoveSignatureRuleToGlobal}
                onCreateSubRule={handleCreateSubRule}
                onDeleteSubRule={handleDeleteSubRule}
                onReorderSubRule={handleReorderSubRule}
                onPromoteSubRuleAbove={handlePromoteSubRuleAbove}
                onMoveSubRuleToGlobal={handleMoveSubRuleToGlobal}
                onReparentSubRule={handleReparentSubRule}
                onExportRules={handleExportRulesBackup}
                onImportRulesFile={handleImportRulesFile}
              />
            ) : view === 'transactions' ? (
              combineEnabled ? (
                <CombinedTransactionsPage
                  rows={combinedRows}
                  jump={txJump}
                  onSetTxNote={handleSetTxNote}
                  onDeleteTransaction={handleDeleteTransaction}
                  categoryFilter={combinedCategoryFilter}
                />
              ) : (
                <TransactionsPage
                  transactions={transactions}
                  categoryOf={categoryOf}
                  overriddenIds={overriddenIds}
                  customCategories={customCategories}
                  sub={subResolver}
                  categoryFilter={categoryFilter}
                  jump={txJump}
                  onSetCategory={handleSetCategory}
                  onClearCategory={handleClearCategory}
                  onCreateCategory={handleCreateCategory}
                  onSetSubCategory={handleSetSubCategory}
                  onSetTxNote={(id, note) => handleSetTxNote(activeCardId, id, note)}
                  onDeleteTransaction={(id) => handleDeleteTransaction(activeCardId, id)}
                />
              )
            ) : (
              <Dashboard
                transactions={dashboardTransactions}
                categoryOf={dashboardCategoryOf}
                monthStartDay={monthStartDay}
                weekStartDay={weekStartDay}
                pendingCount={grouping.pendingCount}
                onReview={canCategorize ? () => setWizardOpen(true) : undefined}
                hiddenCount={excludedCount(combineEnabled ? combinedCategoryFilter : categoryFilter)}
                onManageHidden={() => handleTabClick('categories')}
                onDrillToTransactions={handleDrillToTransactions}
                combineEnabled={combineEnabled}
                combinedCardNames={combineEnabled ? combinedSnapshots.map((s) => s.cardName) : []}
                mixedCurrency={combineEnabled ? combinedAllData?.mixedCurrency ?? false : false}
              />
            )}
          </>
        )}
      </main>

      {pending && (
        <ColumnMapper
          parsed={pending}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={handleConfirmMapping}
        />
      )}

      {wizardOpen && (
        <CategorizeWizard
          groups={grouping.groups}
          leftovers={grouping.leftovers}
          customCategories={customCategories}
          onCreateCategory={handleCreateCategory}
          onComplete={handleWizardComplete}
          onClose={() => setWizardOpen(false)}
        />
      )}

      {cardManagerOpen && (
        <CardManager
          cards={cards}
          activeCardId={activeCardId}
          busy={cardBusy}
          onSwitch={(id) => {
            handleSwitchCard(id);
            setCardManagerOpen(false);
          }}
          onCreate={handleCreateCard}
          onRename={handleRenameCard}
          onDelete={handleDeleteCard}
          onClose={() => setCardManagerOpen(false)}
        />
      )}

      {cloudSyncOpen && (
        <CloudSyncSettings onClose={() => setCloudSyncOpen(false)} onRestoreFromCloud={handleRestoreFromCloudJSON} />
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      <footer className="footer">
        {cloudSyncActive
          ? 'Cloud sync is on — your data also backs up to your connected storage. Manage it in Settings.'
          : 'Your statements never leave this browser. All parsing and storage happens on your device.'}
      </footer>

      <NotesWidget />
    </div>
  );
}

function buildToast(result: ImportResult, skipped: number): string {
  const parts = [`Added ${result.added} transaction${result.added === 1 ? '' : 's'}`];
  if (result.duplicates > 0) parts.push(`${result.duplicates} already imported`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  return parts.join(' · ');
}

/** The column mapping this card used the last time a statement was
 *  imported, so re-importing a similarly-formatted file can skip straight
 *  to it instead of re-detecting columns from scratch. */
function loadSavedColumnMapping(cardId: string): ColumnMapping | null {
  try {
    const raw = localStorage.getItem(scopedKey(COLUMN_MAPPING_KEY, cardId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.dateColumn === 'string') {
      return parsed as ColumnMapping;
    }
  } catch {
    /* ignore malformed/unavailable localStorage */
  }
  return null;
}

/** Whether every column a saved mapping references still exists in a newly
 *  dropped file's headers — guards against silently applying a stale
 *  mapping after a bank changes its export format. */
function mappingFitsHeaders(mapping: ColumnMapping, headers: string[]): boolean {
  const cols = [
    mapping.dateColumn,
    mapping.descriptionColumn,
    mapping.amountColumn,
    mapping.debitColumn,
    mapping.creditColumn,
    mapping.balanceColumn,
  ];
  return cols.every((c) => !c || headers.includes(c));
}

function loadCardType(cardId: string): CardType {
  try {
    return localStorage.getItem(scopedKey(CARD_TYPE_KEY, cardId)) === 'credit' ? 'credit' : 'debit';
  } catch {
    return 'debit';
  }
}

function loadCardCheckpoints(cardId: string): BalanceCheckpoint[] {
  try {
    const raw = JSON.parse(localStorage.getItem(scopedKey(BALANCE_CHECKPOINTS_KEY, cardId)) ?? '[]');
    return isValidCheckpoints(raw) ? raw : [];
  } catch {
    return [];
  }
}
