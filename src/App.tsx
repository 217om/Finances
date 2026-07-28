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
  clearCategorization,
  deleteCardDatabase,
  deleteKeywordRule,
  deleteOverride,
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
  CUSTOM_CATEGORIES_KEY,
  CATEGORY_FILTER_KEY,
  COMBINED_CATEGORY_FILTER_KEY,
  THEME_KEY,
  COMBINE_KEY,
  COMBINE_CARD_ID,
} from './lib/cards';
import type { CopyOptions } from './components/CardManager';
import { combineSnapshots, combineAllRows, type CardSnapshot } from './lib/combine';
import { buildOverview } from './lib/aggregate';
import { buildGroups } from './lib/grouping';
import { EXPENSE_CATEGORIES, makeResolver } from './lib/categorize';
import { makeSubResolver, UNSORTED } from './lib/subcategory';
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
} from './lib/exportData';
import NotesWidget from './components/NotesWidget';
import Header from './components/Header';
import UploadPanel from './components/UploadPanel';
import ColumnMapper from './components/ColumnMapper';
import Dashboard from './components/Dashboard';
import EmptyState from './components/EmptyState';
import Toast from './components/Toast';
import CategorizeWizard from './components/CategorizeWizard';
import RefineCategories from './components/RefineCategories';
import TransactionsPage from './components/TransactionsPage';
import CombinedTransactionsPage from './components/CombinedTransactionsPage';
import CategoriesPage from './components/CategoriesPage';
import CombinedCategoriesPage from './components/CombinedCategoriesPage';
import CardManager from './components/CardManager';

type Theme = 'light' | 'dark';

interface OtherCardData {
  transactions: Transaction[];
  rules: CategoryRule[];
  overrides: CategoryOverride[];
  keywordRules: KeywordRule[];
  subRules: SubRule[];
  subOverrides: SubOverride[];
  currency: string;
  filter: CategoryFilterState;
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

  useEffect(() => {
    if (!combineEnabled) {
      setOtherCardsData({});
      return;
    }
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
          let filter = defaultCategoryFilter();
          try {
            cur = localStorage.getItem(scopedKey(CURRENCY_KEY, c.id)) || 'OMR';
            const savedFilter = JSON.parse(localStorage.getItem(scopedKey(CATEGORY_FILTER_KEY, c.id)) ?? 'null');
            if (isValidCategoryFilter(savedFilter)) filter = savedFilter;
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
            filter,
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
  }, [combineEnabled, cards, activeCardId]);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<ParsedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrencyState] = useState(getCurrency());
  const [monthStartDay, setMonthStartDay] = useState(1);
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
  const [wizardOpen, setWizardOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [view, setView] = useState<'dashboard' | 'transactions' | 'categories'>('dashboard');
  // Set only when jumping in from a chart click (Dashboard -> a specific
  // day/week/month's transactions); cleared on any normal tab navigation, so
  // the Transactions tab is never affected by category filters otherwise.
  const [txJump, setTxJump] = useState<{ from: string; to: string; token: number } | null>(null);

  const handleTabClick = useCallback((next: 'dashboard' | 'transactions' | 'categories') => {
    setTxJump(null);
    setView(next);
  }, []);

  const handleDrillToTransactions = useCallback((from: string, to: string) => {
    setTxJump({ from, to, token: Date.now() });
    setView('transactions');
  }, []);

  // Restore preferences and load stored data whenever the active card changes
  // (including on first mount). Everything here is defensive: reading
  // localStorage can throw on some browsers/privacy modes, and opening
  // IndexedDB can hang — neither should ever leave the app stuck loading.
  useEffect(() => {
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
      const savedCats = JSON.parse(localStorage.getItem(scopedKey(CUSTOM_CATEGORIES_KEY, cardId)) ?? '[]');
      setCustomCategories(Array.isArray(savedCats) ? savedCats.filter((c) => typeof c === 'string') : []);
      const savedFilter = JSON.parse(localStorage.getItem(scopedKey(CATEGORY_FILTER_KEY, cardId)) ?? 'null');
      setCategoryFilter(isValidCategoryFilter(savedFilter) ? savedFilter : defaultCategoryFilter());
    } catch {
      setCurrency('OMR');
      setCurrencyState('OMR');
      setMonthStartDay(1);
      setCustomCategories([]);
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
            ? 'Loading your saved data is taking too long. Your data is safe — try Reload. If this app is open in another tab, close it first.'
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
  }, [activeCardId, reloadToken]);

  const rulesMap = useMemo(() => new Map(rules.map((r) => [r.signature, r])), [rules]);
  const overridesMap = useMemo(
    () => new Map(overrides.map((o) => [o.id, o.category])),
    [overrides],
  );
  const categoryOf = useMemo(
    () => makeResolver(rulesMap, overridesMap, keywordRules),
    [rulesMap, overridesMap, keywordRules],
  );
  const subResolver = useMemo(
    () => makeSubResolver(subRules, subOverrides),
    [subRules, subOverrides],
  );

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

  const overview = useMemo(
    () => buildOverview(visibleTransactions, monthStartDay, categoryOf),
    [visibleTransactions, monthStartDay, categoryOf],
  );

  // When combining, every other card gets its own resolver/filter built from
  // its own rules — a card's transactions are always categorized and
  // filtered by that card's own rules, never the active card's.
  const combinedSnapshots = useMemo<CardSnapshot[]>(() => {
    if (!combineEnabled || !activeCard) return [];
    const activeSnap: CardSnapshot = {
      cardId: activeCard.id,
      cardName: activeCard.name,
      currency,
      transactions,
      categoryOf,
      subOf: subResolver.subOf,
      filter: categoryFilter,
    };
    const others = cards
      .filter((c) => c.id !== activeCardId)
      .map((c) => {
        const raw = otherCardsData[c.id];
        if (!raw) return null;
        const rMap = new Map(raw.rules.map((r) => [r.signature, r]));
        const oMap = new Map(raw.overrides.map((o) => [o.id, o.category]));
        const snap: CardSnapshot = {
          cardId: c.id,
          cardName: c.name,
          currency: raw.currency,
          transactions: raw.transactions,
          categoryOf: makeResolver(rMap, oMap, raw.keywordRules),
          subOf: makeSubResolver(raw.subRules, raw.subOverrides).subOf,
          filter: raw.filter,
        };
        return snap;
      })
      .filter((s): s is CardSnapshot => s !== null);
    return [activeSnap, ...others];
  }, [
    combineEnabled,
    activeCard,
    activeCardId,
    currency,
    transactions,
    categoryOf,
    subResolver,
    categoryFilter,
    cards,
    otherCardsData,
  ]);

  const combinedData = useMemo(
    () => (combineEnabled ? combineSnapshots(combinedSnapshots) : null),
    [combineEnabled, combinedSnapshots],
  );

  const combinedOverview = useMemo(
    () => (combinedData ? buildOverview(combinedData.transactions, monthStartDay, combinedData.categoryOf) : null),
    [combinedData, monthStartDay],
  );

  // The read-only merged Transactions view — every card's transactions
  // together, unfiltered by any card's hidden-category filter (matching the
  // single-card Transactions tab, which is likewise never affected by it).
  const combinedRows = useMemo(
    () => (combineEnabled ? combineAllRows(combinedSnapshots) : []),
    [combineEnabled, combinedSnapshots],
  );

  const dashboardTransactions = combineEnabled && combinedData ? combinedData.transactions : visibleTransactions;
  const dashboardCategoryOf = combineEnabled && combinedData ? combinedData.categoryOf : categoryOf;
  const dashboardOverview = combineEnabled && combinedOverview ? combinedOverview : overview;

  // Classification (the wizard's pending groups) is independent of the display
  // filter above — you can still categorize everything even if some of it is
  // excluded from the charts.
  const grouping = useMemo(
    () => buildGroups(transactions, rulesMap, overridesMap, keywordRules),
    [transactions, rulesMap, overridesMap, keywordRules],
  );

  const handleResetCategorization = useCallback(async () => {
    if (
      !confirm(
        'Start categorization over? This clears your saved category rules and manual ' +
          'assignments so you can reclassify from scratch. Your transactions and custom ' +
          'categories are kept.',
      )
    ) {
      return;
    }
    await clearCategorization(dbName);
    setRules([]);
    setOverrides([]);
    setKeywordRules([]);
    setSubRules([]);
    setSubOverrides([]);
    setWizardOpen(true);
    setToast('Categorization reset — reclassify from scratch.');
  }, [dbName]);

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

  const handleSetSubCategory = useCallback(
    (id: string, parent: string, subName: string) => {
      if (subName === UNSORTED) {
        deleteSubOverride(dbName, id);
        setSubOverrides((prev) => prev.filter((o) => o.id !== id));
        return;
      }
      const o: SubOverride = { id, parent, sub: subName };
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
      const newOverrides = ids.map((id) => ({ id, parent, sub: subName }));
      saveSubOverrides(dbName, newOverrides);
      setSubOverrides((prev) => {
        const idSet = new Set(ids);
        return [...prev.filter((o) => !idSet.has(o.id)), ...newOverrides];
      });
      setToast(`Sub-category applied · ${ids.length} transaction${ids.length === 1 ? '' : 's'} → ${subName}`);
    },
    [dbName],
  );

  const handleSetCategory = useCallback(
    (id: string, category: string) => {
      const o: CategoryOverride = { id, category };
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

  const handleCreateKeywordRule = useCallback(
    (keyword: string, category: string) => {
      const rule: KeywordRule = { keyword, category, createdAt: Date.now() };
      saveKeywordRule(dbName, rule);
      setKeywordRules((prev) => [...prev.filter((r) => r.keyword !== keyword), rule]);
      setToast(`Rule saved · “${keyword}” → ${category}`);
    },
    [dbName],
  );

  const handleDeleteKeywordRule = useCallback(
    (keyword: string) => {
      deleteKeywordRule(dbName, keyword);
      setKeywordRules((prev) => prev.filter((r) => r.keyword !== keyword));
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
          localStorage.setItem(scopedKey(CUSTOM_CATEGORIES_KEY, activeCardId), JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [activeCardId],
  );

  const handleWizardComplete = useCallback(
    async (newRules: CategoryRule[], newOverrides: CategoryOverride[]) => {
      // Merge: new decisions replace any existing rule/override with the same key.
      const mergedRules = new Map(rules.map((r) => [r.signature, r]));
      for (const r of newRules) mergedRules.set(r.signature, r);
      const mergedOverrides = new Map(overrides.map((o) => [o.id, o]));
      for (const o of newOverrides) mergedOverrides.set(o.id, o);

      await saveCategorization(dbName, newRules, newOverrides);
      setRules([...mergedRules.values()]);
      setOverrides([...mergedOverrides.values()]);
      setWizardOpen(false);
      const n = newRules.length + newOverrides.length;
      if (n > 0) setToast(`Categorization saved · ${newRules.length} rules applied`);
    },
    [rules, overrides, dbName],
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

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      const list = Array.from(files);
      if (list.length === 0) return;
      const file = list[0];

      // A CashFlow JSON backup is restored directly, skipping column mapping.
      if (isBackupFile(file.name)) {
        try {
          const restored = parseBackup(await file.text());
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
        setPending(parsed);
      } catch (e) {
        setError(`Could not read that file. ${(e as Error).message ?? ''}`.trim());
      }
    },
    [dbName],
  );

  const handleExportJSON = useCallback(() => downloadBackup(transactions), [transactions]);
  const handleExportCSV = useCallback(() => downloadCSV(transactions), [transactions]);

  const handleExportFullBackup = useCallback(async () => {
    try {
      const backup = await buildFullBackup(cards, activeCardId, theme);
      downloadFullBackup(backup);
    } catch (e) {
      setToast(`Could not build the full backup. ${(e as Error).message ?? ''}`.trim());
    }
  }, [cards, activeCardId, theme]);

  const handleRestoreFullBackup = useCallback(
    async (file: File) => {
      try {
        const backup = parseFullBackup(await file.text());
        const txCount = backup.cards.reduce((a, c) => a + c.transactions.length, 0);
        const ok = confirm(
          `Restore this backup (from ${backup.exportedAt.slice(0, 10)})? It covers ${txCount} ` +
            `transaction${txCount === 1 ? '' : 's'} across ${backup.cards.length} card` +
            `${backup.cards.length === 1 ? '' : 's'} and ${backup.notes.length} note` +
            `${backup.notes.length === 1 ? '' : 's'}. Existing data is kept — matching cards are ` +
            'merged by id, and any cards not already present are added.',
        );
        if (!ok) return;
        const result = await restoreFullBackup(backup, cards);
        setCards(result.cards);
        setActiveCardId(result.activeCardId);
        setTheme(result.theme);
        setReloadToken((n) => n + 1);
        setToast('Full backup restored.');
      } catch (e) {
        setError(`Could not restore that backup. ${(e as Error).message ?? ''}`.trim());
      }
    },
    [cards],
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
      } catch (e) {
        setError(`Import failed. ${(e as Error).message ?? ''}`.trim());
      } finally {
        setBusy(false);
      }
    },
    [dbName],
  );

  const handleClearAll = useCallback(async () => {
    if (!confirm('Delete all stored statements and analysis for this card? This cannot be undone.')) {
      return;
    }
    await clearAll(dbName);
    try {
      localStorage.removeItem(scopedKey(CUSTOM_CATEGORIES_KEY, activeCardId));
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
    setCustomCategories([]);
    setCategoryFilter(defaultCategoryFilter());
    setToast('All data cleared for this card.');
  }, [dbName, activeCardId]);

  const handleClearTransactionsOnly = useCallback(async () => {
    if (
      !confirm(
        'Remove all transactions from this card? Category rules, keyword rules, sub-categories, ' +
          'custom categories, and the hidden-category filter are all kept — this just clears the ' +
          'statements themselves.',
      )
    ) {
      return;
    }
    await clearTransactionsOnly(dbName);
    setTransactions([]);
    setToast('Transactions cleared — categories and rules were kept.');
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
      setRefineOpen(false);
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
          if (opts.customCategories) {
            try {
              const raw = localStorage.getItem(scopedKey(CUSTOM_CATEGORIES_KEY, source.id));
              const list = JSON.parse(raw ?? '[]');
              if (Array.isArray(list) && list.length > 0) {
                localStorage.setItem(scopedKey(CUSTOM_CATEGORIES_KEY, card.id), JSON.stringify(list));
              }
            } catch {
              /* ignore */
            }
          }
        }
        const next = [...cards, card];
        setCards(next);
        saveCards(next);
        setActiveCardId(card.id);
        saveActiveCardId(card.id);
        setWizardOpen(false);
        setRefineOpen(false);
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

  const handleRenameCard = useCallback((id: string, name: string) => {
    setCards((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, name } : c));
      saveCards(next);
      return next;
    });
  }, []);

  const handleDeleteCard = useCallback(
    async (id: string) => {
      const card = cards.find((c) => c.id === id);
      if (!card) return;
      if (cards.length <= 1) return;
      if (!confirm(`Delete "${card.name}" and all of its data? This cannot be undone.`)) return;

      await deleteCardDatabase(card.dbName);
      try {
        localStorage.removeItem(scopedKey(CUSTOM_CATEGORIES_KEY, id));
        localStorage.removeItem(scopedKey(CATEGORY_FILTER_KEY, id));
        localStorage.removeItem(scopedKey(CURRENCY_KEY, id));
        localStorage.removeItem(scopedKey(MONTH_START_KEY, id));
      } catch {
        /* ignore */
      }

      const next = cards.filter((c) => c.id !== id);
      setCards(next);
      saveCards(next);
      if (id === activeCardId) {
        const fallback = next[0];
        setActiveCardId(fallback.id);
        saveActiveCardId(fallback.id);
        setWizardOpen(false);
        setRefineOpen(false);
      }
      setToast(`Deleted card · ${card.name}`);
    },
    [cards, activeCardId],
  );

  const hasData = transactions.length > 0;
  const canCategorize = grouping.groups.length > 0 || grouping.leftovers.length > 0;
  const hasCategorization = rules.length > 0 || overrides.length > 0;

  return (
    <div className="app">
      <Header
        currency={currency}
        onCurrencyChange={handleCurrencyChange}
        monthStartDay={monthStartDay}
        onMonthStartChange={handleMonthStartChange}
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
              combineEnabled && combinedData ? (
                <CombinedCategoriesPage
                  transactions={combinedData.transactions}
                  categoryOf={combinedData.categoryOf}
                  subOf={combinedData.subOf}
                  cardNameOf={combinedData.cardNameOf}
                  categoryFilter={combinedCategoryFilter}
                  onToggleCategoryFilter={handleToggleCombinedCategoryFilter}
                  onToggleSubFilter={handleToggleCombinedSubFilter}
                />
              ) : (
                <CategoriesPage
                  transactions={transactions}
                  categoryOf={categoryOf}
                  sub={subResolver}
                  onBulkSetSubCategory={handleBulkSetSubCategory}
                  categoryFilter={categoryFilter}
                  onToggleCategoryFilter={handleToggleCategoryFilter}
                  onToggleSubFilter={handleToggleSubFilter}
                />
              )
            ) : view === 'transactions' ? (
              combineEnabled ? (
                <CombinedTransactionsPage rows={combinedRows} jump={txJump} />
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
                />
              )
            ) : (
              <Dashboard
                overview={dashboardOverview}
                transactions={dashboardTransactions}
                categoryOf={dashboardCategoryOf}
                monthStartDay={monthStartDay}
                pendingCount={grouping.pendingCount}
                onReview={canCategorize ? () => setWizardOpen(true) : undefined}
                onReset={hasCategorization ? handleResetCategorization : undefined}
                onRefine={() => setRefineOpen(true)}
                hiddenCount={excludedCount(categoryFilter)}
                onManageHidden={() => handleTabClick('categories')}
                onDrillToTransactions={handleDrillToTransactions}
                combineEnabled={combineEnabled}
                combinedCardNames={combineEnabled ? combinedSnapshots.map((s) => s.cardName) : []}
                mixedCurrency={combineEnabled ? combinedData?.mixedCurrency ?? false : false}
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

      {refineOpen && (
        <RefineCategories
          transactions={transactions}
          keywordRules={keywordRules}
          customCategories={customCategories}
          categoryOf={categoryOf}
          onCreateCategory={handleCreateCategory}
          onCreateRule={handleCreateKeywordRule}
          onDeleteRule={handleDeleteKeywordRule}
          onClose={() => setRefineOpen(false)}
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

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      <footer className="footer">
        Your statements never leave this browser — all parsing and storage happens on your device.
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
