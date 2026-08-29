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
  deleteOverride,
  getAllTransactions,
  getKeywordRules,
  getOverrides,
  getRules,
  getSubOverrides,
  getSubRules,
  onDatabaseBlocked,
  deleteSubOverride,
  deleteTransaction,
  setTransactionNote,
} from './lib/db';
import {
  loadCards,
  scopedKey,
  CURRENCY_KEY,
  MONTH_START_KEY,
  WEEK_START_KEY,
  CATEGORY_FILTER_KEY,
  COLUMN_MAPPING_KEY,
  COMBINED_CATEGORY_FILTER_KEY,
  CATEGORY_FILTER_PRESETS_KEY,
  CARD_TYPE_KEY,
  BALANCE_CHECKPOINTS_KEY,
  THEME_KEY,
  COMBINE_KEY,
  ALL_CARDS_ID,
} from './lib/cards';
import { combineAllData, combineAllRows, type CardSnapshot } from './lib/combine';
import { EXPENSE_CATEGORIES } from './lib/categorize';
import { makePreset, isValidPresetList, type CategoryFilterPreset } from './lib/categoryFilterPresets';
import {
  defaultCategoryFilter,
  excludedCount,
  isExcluded,
  isValidCategoryFilter,
  toggleCategory,
  toggleSub,
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
  type FullBackupFile,
} from './lib/exportData';
import CloudSyncSettings from './components/CloudSyncSettings';
import { syncEngine } from './lib/cloudSync/syncEngine';
import { useSyncState } from './lib/cloudSync/useSyncState';
import type { ProviderId } from './lib/cloudSync/types';
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
import BalancesPage from './components/BalancesPage';
import ExecutiveSummaryPage from './components/ExecutiveSummaryPage';
import {
  isValidCheckpoints,
  makeCheckpoint,
  type BalanceCheckpoint,
  type CardType,
} from './lib/balances';
import { useBudgets } from './hooks/useBudgets';
import { useAssets } from './hooks/useAssets';
import { useCards } from './hooks/useCards';
import { useRules } from './hooks/useRules';
import { useConfirm } from './hooks/useConfirm';

type Theme = 'light' | 'dark';

export default function App() {
  // Styled stand-in for window.confirm() — shared by App's own handlers and
  // threaded into useCards/useRules for theirs.
  const { confirmAsync, confirmDialog } = useConfirm();

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

  // Bumped after a full-backup restore so the load effect below re-fetches
  // this card's data even when the restore didn't change activeCardId.
  const [reloadToken, setReloadToken] = useState(0);
  const [cloudSyncOpen, setCloudSyncOpen] = useState(false);
  const cloudSyncState = useSyncState();
  const cloudSyncActive = cloudSyncState.google.connected || cloudSyncState.onedrive.connected;

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

  // Balances: per-card type (debit/credit) and manual checkpoints, keyed by
  // card id — plain localStorage reads, not IndexedDB, so (unlike rules or
  // transactions) they don't need an async load effect; useCards' create/
  // merge/delete handlers below keep these records in sync with the card
  // list, which is why they're hoisted above that hook call.
  const [cardTypes, setCardTypes] = useState<Record<string, CardType>>(() =>
    Object.fromEntries(loadCards().map((c) => [c.id, loadCardType(c.id)])),
  );
  const [cardCheckpoints, setCardCheckpoints] = useState<Record<string, BalanceCheckpoint[]>>(() =>
    Object.fromEntries(loadCards().map((c) => [c.id, loadCardCheckpoints(c.id)])),
  );
  // Also hoisted above useCards for the same reason: merging a card resets
  // the surviving card's filter, and create/switch/delete all close the
  // wizard and can post a toast.
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilterState>(defaultCategoryFilter());
  const [wizardOpen, setWizardOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Card identity and lifecycle (create/rename/merge/delete/switch) — see
  // hooks/useCards.ts. Unlike useBudgets/useAssets it can't own all of its
  // own state in isolation, since creating/merging/deleting a card also has
  // to touch the state hoisted just above.
  const {
    cards,
    setCards,
    activeCardId,
    setActiveCardId,
    cardManagerOpen,
    setCardManagerOpen,
    cardBusy,
    cardsRef,
    activeCard,
    dbName,
    handleSwitchCard,
    handleCreateCard,
    handleRenameCard,
    handleDeleteCard,
  } = useCards({
    combineEnabled,
    setCombineEnabled,
    cardCheckpoints,
    setCardTypes,
    setCardCheckpoints,
    setCategoryFilter,
    setWizardOpen,
    setReloadToken,
    setToast,
    confirmAsync,
  });

  // Which card's transaction count Advanced Settings shows next to each
  // rule — defaults to an aggregate across every card, since rules are
  // global by default. Independent of the app's actual active card.
  const [countCardId, setCountCardId] = useState<string>(ALL_CARDS_ID);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<ParsedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrencyState] = useState(getCurrency());
  const [monthStartDay, setMonthStartDay] = useState(1);
  const [weekStartDay, setWeekStartDay] = useState(1);
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
  // global, like the combined filter above. See lib/budget.ts and hooks/useBudgets.ts.
  const {
    budgets,
    setBudgets,
    budgetEntries,
    setBudgetEntries,
    budgetCycleAmounts,
    setBudgetCycleAmounts,
    handleCreateBudget,
    handleRenameBudget,
    handleSetBudgetCadence,
    handleToggleBudgetCategory,
    handleDeleteBudget,
    handleSetBudgetAmount,
    handleSetBudgetCycleAmount,
  } = useBudgets();
  // Assets are global, like budgets — see hooks/useAssets.ts. cardTypes,
  // cardCheckpoints, and wizardOpen are declared earlier, above useCards.
  const {
    assets,
    setAssets,
    assetValues,
    setAssetValues,
    handleCreateAsset,
    handleRenameAsset,
    handleSetAssetKind,
    handleDeleteAsset,
    handleAddAssetValue,
    handleDeleteAssetValue,
  } = useAssets();

  // The categorization system: per-card and global rules, overrides, custom
  // categories, every other card's full data, and the derived resolvers most
  // tabs read from — see hooks/useRules.ts. By far the most interconnected
  // slice extracted so far, so unlike useBudgets/useAssets it takes cards,
  // activeCardId, dbName, currency, and transactions as read-only inputs,
  // plus a handful of other domains' setters its handlers legitimately need
  // to reach (this card's filter, the wizard, the reload token, the toast,
  // the error banner).
  const {
    rules,
    setRules,
    overrides,
    setOverrides,
    keywordRules,
    setKeywordRules,
    subRules,
    setSubRules,
    subOverrides,
    setSubOverrides,
    globalRules,
    setGlobalRules,
    globalKeywordRules,
    setGlobalKeywordRules,
    globalSubRules,
    setGlobalSubRules,
    customCategories,
    setCustomCategories,
    otherCardsData,
    setOtherCardsData,
    rulesMigrationDone,
    categoryOf,
    subResolver,
    allCardSnapshots,
    cardRuleSets,
    grouping,
    overriddenIds,
    handleCreateKeywordRuleFor,
    handleDeleteKeywordRuleFor,
    handleSetKeywordRulePriority,
    handlePromoteKeywordRuleAbove,
    handleUpdateKeywordRuleCategory,
    handleUpdateSignatureRuleCategory,
    handleDeleteSignatureRule,
    handleReorderSignatureRule,
    handlePromoteSignatureRuleAbove,
    handleCreateSubRule,
    handleDeleteSubRule,
    handleReparentSubRule,
    handleSetSubRulePriority,
    handlePromoteSubRuleAbove,
    handleMoveKeywordRuleToGlobal,
    handleMoveSignatureRuleToGlobal,
    handleMoveSubRuleToGlobal,
    handleCreateCategory,
    handleCreateCategoryFor,
    handleWizardComplete,
    handleSetCategory,
    handleClearCategory,
    handleSetSubCategory,
    handleBulkSetSubCategory,
    handleExportRulesBackup,
    handleImportRulesFile,
  } = useRules({
    cards,
    activeCardId,
    activeCard,
    dbName,
    currency,
    transactions,
    confirmAsync,
    setCategoryFilter,
    setCombinedCategoryFilter,
    setWizardOpen,
    setReloadToken,
    setToast,
    setError,
  });

  const [view, setView] = useState<
    'summary' | 'dashboard' | 'transactions' | 'categories' | 'budgets' | 'balances' | 'advanced'
  >('summary');
  // Set only when jumping in from a chart click (Dashboard -> a specific
  // day/week/month's transactions); cleared on any normal tab navigation, so
  // the Transactions tab is never affected by category filters otherwise.
  const [txJump, setTxJump] = useState<{ from: string; to: string; token: number } | null>(null);

  const handleTabClick = useCallback(
    (next: 'summary' | 'dashboard' | 'transactions' | 'categories' | 'budgets' | 'balances' | 'advanced') => {
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

  // Every card's transactions merged with their own categorization, always —
  // unlike combinedAllData below, not gated behind "Combine all cards",
  // since the Executive Summary is inherently a cross-card view no matter
  // which single card (if any) is currently active.
  const everyCardCombinedData = useMemo(() => combineAllData(allCardSnapshots), [allCardSnapshots]);

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

  // Every expense category any card could budget for — built-ins plus every
  // custom one (global, see lib/cards' CUSTOM_CATEGORIES_KEY doc comment),
  // since Budgets applies at the total (combined) level. Expense-only:
  // there's nothing to "budget" about income.
  const budgetCategoryOptions = useMemo(
    () => [...EXPENSE_CATEGORIES, ...customCategories],
    [customCategories],
  );

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
        budgetCycleAmounts,
        assets,
        assetValues,
      );
      downloadFullBackup(backup);
    } catch (e) {
      setToast(`Could not build the full backup. ${(e as Error).message ?? ''}`.trim());
    }
  }, [
    cards,
    activeCardId,
    theme,
    combinedCategoryFilter,
    filterPresets,
    budgets,
    budgetEntries,
    budgetCycleAmounts,
    assets,
    assetValues,
  ]);

  // Shared by both restore paths (a picked file, or a cloud sync download)
  // once each has already confirmed with the user — applies a parsed backup
  // to every piece of state it touches. `silent` skips the toast, for the
  // automatic catch-up pull below — that one runs on every load a connected
  // provider is present, so announcing it every time would be noise (and
  // misleading on the common case where there was nothing new to merge).
  const applyRestoredBackup = useCallback(
    async (backup: FullBackupFile, opts?: { silent?: boolean }) => {
      const result = await restoreFullBackup(
        backup,
        cards,
        combinedCategoryFilter,
        filterPresets,
        budgets,
        budgetEntries,
        budgetCycleAmounts,
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
      setBudgetCycleAmounts(result.budgetCycleAmounts);
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
      if (!opts?.silent) setToast('Full backup restored.');
    },
    [cards, combinedCategoryFilter, filterPresets, budgets, budgetEntries, budgetCycleAmounts, assets, assetValues],
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
        const ok = await confirmAsync(
          `Restore this backup (from ${backup.exportedAt.slice(0, 10)})? It covers ${txCount} ` +
            `transaction${txCount === 1 ? '' : 's'} across ${backupCards.length} card` +
            `${backupCards.length === 1 ? '' : 's'} and ${noteCount} note` +
            `${noteCount === 1 ? '' : 's'}. Existing data is kept, matching cards are ` +
            'merged and new cards are added.',
          { confirmLabel: 'Restore', danger: false },
        );
        if (!ok) return;
        await applyRestoredBackup(backup);
      } catch (e) {
        setError(`Could not restore that backup. ${(e as Error).message ?? ''}`.trim());
      }
    },
    [applyRestoredBackup, confirmAsync],
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
    if (!(await confirmAsync('Delete all stored statements and analysis for this card? This cannot be undone.'))) {
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
  }, [dbName, activeCardId, confirmAsync]);

  const handleClearTransactionsOnly = useCallback(async () => {
    if (
      !(await confirmAsync(
        'Remove all transactions from this card? Categories, rules, and filters are all kept, ' +
          'this just clears the statements themselves.',
      ))
    ) {
      return;
    }
    await clearTransactionsOnly(dbName);
    setTransactions([]);
    setToast('Transactions cleared. Categories and rules were kept.');
  }, [dbName, confirmAsync]);

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
    budgetCycleAmounts,
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
      budgetCycleAmounts,
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
        p.budgetCycleAmounts,
        p.assets,
        p.assetValues,
      );
      return JSON.stringify(backup);
    });
  }, []);

  // A device that's been closed while another device pushed newer data would
  // otherwise auto-push its own stale snapshot the moment it's reopened —
  // notifyChange() below fires unconditionally on mount, with no way to know
  // the cloud copy has since moved on. So on every load, before any push is
  // allowed, silently pull and merge whatever each connected provider
  // already has (additive, same updatedAt-based merge as a manual restore —
  // never deletes anything). If nothing's connected, or a pull fails (e.g.
  // offline), this still unblocks push after one attempt, so a network blip
  // doesn't permanently stop this device from backing up. Each pull gets a
  // timeout — neither provider's download() has one of its own, and unlike
  // "Restore from cloud" (a visible, retryable button) this runs silently on
  // every load, so a network stall here must never be able to block this
  // device's own sync indefinitely.
  const [initialCloudMergeDone, setInitialCloudMergeDone] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids: ProviderId[] = ['google', 'onedrive'];
      for (const id of ids) {
        if (cancelled || !syncEngine.isConfigured(id) || !cloudSyncState[id].connected) continue;
        try {
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timed-out')), 15000),
          );
          const json = await Promise.race([syncEngine.pull(id), timeout]);
          if (json && !cancelled) {
            await applyRestoredBackup(parseFullBackup(json), { silent: true });
          }
        } catch {
          /* best effort — a failed or slow pull shouldn't block this device's own sync */
        }
      }
      if (!cancelled) setInitialCloudMergeDone(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Broad on purpose: any of these changing means the next full-backup
  // payload would differ, which is the only signal a debounced "does
  // anything need pushing" check actually needs.
  useEffect(() => {
    if (!initialCloudMergeDone) return;
    syncEngine.notifyChange();
  }, [
    initialCloudMergeDone,
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
                  className={view === 'summary' ? 'on' : ''}
                  onClick={() => handleTabClick('summary')}
                >
                  Executive Summary
                </button>
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
                  title={
                    combineEnabled
                      ? undefined
                      : cards.length < 2
                        ? 'Add another card, then choose "Combine all cards" from the Card menu, to use Budgets'
                        : 'Choose "Combine all cards" from the Card menu to use Budgets'
                  }
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

            {(view === 'summary' || view === 'dashboard' || !hasData) && !combineEnabled && (
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
            ) : view === 'summary' ? (
              <ExecutiveSummaryPage
                cards={balanceCardRows}
                cardCount={balanceCardRows.length}
                assets={assets}
                assetValues={assetValues}
                combinedTransactions={everyCardCombinedData.transactions}
                monthStartDay={monthStartDay}
                weekStartDay={weekStartDay}
              />
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
                  budgetCycleAmounts={budgetCycleAmounts}
                  onCreateBudget={handleCreateBudget}
                  onRenameBudget={handleRenameBudget}
                  onSetCadence={handleSetBudgetCadence}
                  onDeleteBudget={handleDeleteBudget}
                  onToggleBudgetCategory={handleToggleBudgetCategory}
                  onSetAmount={handleSetBudgetAmount}
                  onSetCycleAmount={handleSetBudgetCycleAmount}
                />
              ) : (
                <section className="panel">
                  <p className="muted">
                    {cards.length < 2
                      ? 'Add another card, then choose "Combine all cards" from the Card menu above, to use Budgets.'
                      : 'Choose "Combine all cards" from the Card menu above to use Budgets.'}
                  </p>
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
                onSetKeywordRulePriority={handleSetKeywordRulePriority}
                onPromoteKeywordRuleAbove={handlePromoteKeywordRuleAbove}
                onMoveKeywordRuleToGlobal={handleMoveKeywordRuleToGlobal}
                onUpdateSignatureRuleCategory={handleUpdateSignatureRuleCategory}
                onDeleteSignatureRule={handleDeleteSignatureRule}
                onReorderSignatureRule={handleReorderSignatureRule}
                onPromoteSignatureRuleAbove={handlePromoteSignatureRuleAbove}
                onMoveSignatureRuleToGlobal={handleMoveSignatureRuleToGlobal}
                onCreateSubRule={handleCreateSubRule}
                onDeleteSubRule={handleDeleteSubRule}
                onSetSubRulePriority={handleSetSubRulePriority}
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
      {confirmDialog}

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
