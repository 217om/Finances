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
  saveSubRule,
  saveSubRules,
  deleteSubOverride,
  deleteSubOverrides,
  deleteSubRule,
} from './lib/db';
import {
  type Card,
  loadActiveCardId,
  loadCards,
  makeCard,
  saveActiveCardId,
  saveCards,
  scopedKey,
} from './lib/cards';
import type { CopyOptions } from './components/CardManager';
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
import { downloadBackup, downloadCSV, isBackupFile, parseBackup } from './lib/exportData';
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
import CategoriesPage from './components/CategoriesPage';
import CardManager from './components/CardManager';

const CURRENCY_KEY = 'cashflow.currency';
const MONTH_START_KEY = 'cashflow.monthStartDay';
const CUSTOM_CATEGORIES_KEY = 'cashflow.customCategories';
const CATEGORY_FILTER_KEY = 'cashflow.categoryFilter';

export default function App() {
  const [cards, setCards] = useState<Card[]>(() => loadCards());
  const [activeCardId, setActiveCardId] = useState<string>(() => loadActiveCardId(loadCards()));
  const [cardManagerOpen, setCardManagerOpen] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const activeCard = useMemo(
    () => cards.find((c) => c.id === activeCardId) ?? cards[0],
    [cards, activeCardId],
  );
  const dbName = activeCard?.dbName ?? 'cashflow';

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
  const [wizardOpen, setWizardOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [view, setView] = useState<'dashboard' | 'transactions' | 'categories'>('dashboard');

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
  }, [activeCardId]);

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

  const handleAddSubRule = useCallback(
    (parent: string, keyword: string, subName: string) => {
      const kw = keyword.toLowerCase();
      const rule: SubRule = { id: `${parent}${kw}`, parent, keyword: kw, sub: subName, createdAt: Date.now() };
      saveSubRule(dbName, rule);
      setSubRules((prev) => [...prev.filter((r) => r.id !== rule.id), rule]);
      setToast(`Sub-category saved · ${parent} → ${subName}`);
    },
    [dbName],
  );

  const handleDeleteSubRule = useCallback(
    (id: string) => {
      deleteSubRule(dbName, id);
      setSubRules((prev) => prev.filter((r) => r.id !== id));
    },
    [dbName],
  );

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

  // --- Card management ---------------------------------------------------

  const handleSwitchCard = useCallback(
    (id: string) => {
      if (id === activeCardId) return;
      setActiveCardId(id);
      saveActiveCardId(id);
      // Keep whichever tab (Dashboard/Categories/Transactions) the user was
      // already on — switching cards shouldn't reset where you're looking.
      setWizardOpen(false);
      setRefineOpen(false);
    },
    [activeCardId],
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
        onExportJSON={handleExportJSON}
        onExportCSV={handleExportCSV}
        cards={cards}
        activeCardId={activeCardId}
        onSwitchCard={handleSwitchCard}
        onManageCards={() => setCardManagerOpen(true)}
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
                  onClick={() => setView('dashboard')}
                >
                  Dashboard
                </button>
                <button
                  type="button"
                  className={view === 'categories' ? 'on' : ''}
                  onClick={() => setView('categories')}
                >
                  Categories
                </button>
                <button
                  type="button"
                  className={view === 'transactions' ? 'on' : ''}
                  onClick={() => setView('transactions')}
                >
                  Transactions
                </button>
              </nav>
            )}

            {view === 'dashboard' && <UploadPanel onFiles={handleFiles} compact={hasData} />}

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
              <CategoriesPage
                transactions={transactions}
                categoryOf={categoryOf}
                sub={subResolver}
                subRules={subRules}
                onAddSubRule={handleAddSubRule}
                onDeleteSubRule={handleDeleteSubRule}
                onBulkSetSubCategory={handleBulkSetSubCategory}
                categoryFilter={categoryFilter}
                onToggleCategoryFilter={handleToggleCategoryFilter}
                onToggleSubFilter={handleToggleSubFilter}
              />
            ) : view === 'transactions' ? (
              <TransactionsPage
                transactions={transactions}
                categoryOf={categoryOf}
                overriddenIds={overriddenIds}
                customCategories={customCategories}
                sub={subResolver}
                onSetCategory={handleSetCategory}
                onClearCategory={handleClearCategory}
                onCreateCategory={handleCreateCategory}
                onSetSubCategory={handleSetSubCategory}
              />
            ) : (
              <Dashboard
                overview={overview}
                transactions={visibleTransactions}
                categoryOf={categoryOf}
                monthStartDay={monthStartDay}
                pendingCount={grouping.pendingCount}
                onReview={canCategorize ? () => setWizardOpen(true) : undefined}
                onReset={hasCategorization ? handleResetCategorization : undefined}
                onRefine={() => setRefineOpen(true)}
                hiddenCount={excludedCount(categoryFilter)}
                onManageHidden={() => setView('categories')}
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
