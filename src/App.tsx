import { useCallback, useEffect, useMemo, useState } from 'react';
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
  deleteKeywordRule,
  deleteOverride,
  getAllTransactions,
  getKeywordRules,
  getOverrides,
  getRules,
  getSubOverrides,
  getSubRules,
  saveCategorization,
  saveKeywordRule,
  saveOverride,
  saveSubOverride,
  saveSubRule,
  deleteSubOverride,
  deleteSubRule,
} from './lib/db';
import { buildOverview } from './lib/aggregate';
import { buildGroups } from './lib/grouping';
import { EXPENSE_CATEGORIES, makeResolver } from './lib/categorize';
import { makeSubResolver, UNSORTED } from './lib/subcategory';
import { getCurrency, setCurrency } from './lib/format';
import { downloadBackup, downloadCSV, isBackupFile, parseBackup } from './lib/exportData';
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

const CURRENCY_KEY = 'cashflow.currency';
const MONTH_START_KEY = 'cashflow.monthStartDay';
const CUSTOM_CATEGORIES_KEY = 'cashflow.customCategories';

export default function App() {
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
  const [wizardOpen, setWizardOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [view, setView] = useState<'dashboard' | 'transactions' | 'categories'>('dashboard');

  // Restore preferences and load stored data on first mount. Everything here is
  // defensive: reading localStorage can throw on some browsers/privacy modes,
  // and opening IndexedDB can hang — neither should ever leave the app stuck on
  // the loading screen.
  useEffect(() => {
    // Preferences (best-effort; never block the app on these).
    try {
      const saved = localStorage.getItem(CURRENCY_KEY);
      if (saved) {
        setCurrency(saved);
        setCurrencyState(saved);
      }
      const savedDay = Number(localStorage.getItem(MONTH_START_KEY));
      if (savedDay >= 1 && savedDay <= 28) setMonthStartDay(savedDay);
      const savedCats = JSON.parse(localStorage.getItem(CUSTOM_CATEGORIES_KEY) ?? '[]');
      if (Array.isArray(savedCats)) setCustomCategories(savedCats.filter((c) => typeof c === 'string'));
    } catch {
      /* ignore unavailable / malformed localStorage */
    }

    let cancelled = false;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timed-out')), 20000),
    );

    (async () => {
      try {
        // Transactions are the critical data; guard against a hung DB open.
        const txs = (await Promise.race([getAllTransactions(), timeout])) as Transaction[];
        if (cancelled) return;
        setTransactions(txs);

        // Categorization is non-critical: tolerate a failure of any one store.
        const [r, o, kr, sr, so] = await Promise.all([
          getRules().catch(() => [] as CategoryRule[]),
          getOverrides().catch(() => [] as CategoryOverride[]),
          getKeywordRules().catch(() => [] as KeywordRule[]),
          getSubRules().catch(() => [] as SubRule[]),
          getSubOverrides().catch(() => [] as SubOverride[]),
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
    };
  }, []);

  const rulesMap = useMemo(() => new Map(rules.map((r) => [r.signature, r])), [rules]);
  const overridesMap = useMemo(
    () => new Map(overrides.map((o) => [o.id, o.category])),
    [overrides],
  );
  const categoryOf = useMemo(
    () => makeResolver(rulesMap, overridesMap, keywordRules),
    [rulesMap, overridesMap, keywordRules],
  );

  const overview = useMemo(
    () => buildOverview(transactions, monthStartDay, categoryOf),
    [transactions, monthStartDay, categoryOf],
  );

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
    await clearCategorization();
    setRules([]);
    setOverrides([]);
    setKeywordRules([]);
    setSubRules([]);
    setSubOverrides([]);
    setWizardOpen(true);
    setToast('Categorization reset — reclassify from scratch.');
  }, []);

  const overriddenIds = useMemo(() => new Set(overrides.map((o) => o.id)), [overrides]);
  const subResolver = useMemo(
    () => makeSubResolver(subRules, subOverrides),
    [subRules, subOverrides],
  );

  const handleAddSubRule = useCallback((parent: string, keyword: string, subName: string) => {
    const kw = keyword.toLowerCase();
    const rule: SubRule = { id: `${parent}${kw}`, parent, keyword: kw, sub: subName, createdAt: Date.now() };
    saveSubRule(rule);
    setSubRules((prev) => [...prev.filter((r) => r.id !== rule.id), rule]);
    setToast(`Sub-category saved · ${parent} → ${subName}`);
  }, []);

  const handleDeleteSubRule = useCallback((id: string) => {
    deleteSubRule(id);
    setSubRules((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleSetSubCategory = useCallback((id: string, parent: string, subName: string) => {
    if (subName === UNSORTED) {
      deleteSubOverride(id);
      setSubOverrides((prev) => prev.filter((o) => o.id !== id));
      return;
    }
    const o: SubOverride = { id, parent, sub: subName };
    saveSubOverride(o);
    setSubOverrides((prev) => [...prev.filter((x) => x.id !== id), o]);
  }, []);

  const handleSetCategory = useCallback((id: string, category: string) => {
    const o: CategoryOverride = { id, category };
    saveOverride(o);
    setOverrides((prev) => [...prev.filter((x) => x.id !== id), o]);
  }, []);

  const handleClearCategory = useCallback((id: string) => {
    deleteOverride(id);
    setOverrides((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const handleCreateKeywordRule = useCallback((keyword: string, category: string) => {
    const rule: KeywordRule = { keyword, category, createdAt: Date.now() };
    saveKeywordRule(rule);
    setKeywordRules((prev) => [...prev.filter((r) => r.keyword !== keyword), rule]);
    setToast(`Rule saved · “${keyword}” → ${category}`);
  }, []);

  const handleDeleteKeywordRule = useCallback((keyword: string) => {
    deleteKeywordRule(keyword);
    setKeywordRules((prev) => prev.filter((r) => r.keyword !== keyword));
  }, []);

  const handleCreateCategory = useCallback((rawName: string) => {
    setCustomCategories((prev) => {
      const exists =
        prev.some((c) => c.toLowerCase() === rawName.toLowerCase()) ||
        EXPENSE_CATEGORIES.some((c) => c.toLowerCase() === rawName.toLowerCase());
      if (exists) return prev;
      const next = [...prev, rawName];
      localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleWizardComplete = useCallback(
    async (newRules: CategoryRule[], newOverrides: CategoryOverride[]) => {
      // Merge: new decisions replace any existing rule/override with the same key.
      const mergedRules = new Map(rules.map((r) => [r.signature, r]));
      for (const r of newRules) mergedRules.set(r.signature, r);
      const mergedOverrides = new Map(overrides.map((o) => [o.id, o]));
      for (const o of newOverrides) mergedOverrides.set(o.id, o);

      await saveCategorization(newRules, newOverrides);
      setRules([...mergedRules.values()]);
      setOverrides([...mergedOverrides.values()]);
      setWizardOpen(false);
      const n = newRules.length + newOverrides.length;
      if (n > 0) setToast(`Categorization saved · ${newRules.length} rules applied`);
    },
    [rules, overrides],
  );

  const handleCurrencyChange = useCallback((code: string) => {
    setCurrency(code);
    setCurrencyState(code);
    localStorage.setItem(CURRENCY_KEY, code);
  }, []);

  const handleMonthStartChange = useCallback((day: number) => {
    setMonthStartDay(day);
    localStorage.setItem(MONTH_START_KEY, String(day));
  }, []);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setError(null);
    const list = Array.from(files);
    if (list.length === 0) return;
    const file = list[0];

    // A CashFlow JSON backup is restored directly, skipping column mapping.
    if (isBackupFile(file.name)) {
      try {
        const restored = parseBackup(await file.text());
        const result = await addTransactions(restored, file.name);
        setTransactions(await getAllTransactions());
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
  }, []);

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
        const result: ImportResult = await addTransactions(txs, parsed.fileName);
        const fresh = await getAllTransactions();
        setTransactions(fresh);
        setPending(null);
        setToast(buildToast(result, skipped));
      } catch (e) {
        setError(`Import failed. ${(e as Error).message ?? ''}`.trim());
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const handleClearAll = useCallback(async () => {
    if (!confirm('Delete all stored statements and analysis from this browser? This cannot be undone.')) {
      return;
    }
    await clearAll();
    localStorage.removeItem(CUSTOM_CATEGORIES_KEY);
    setTransactions([]);
    setRules([]);
    setOverrides([]);
    setKeywordRules([]);
    setSubRules([]);
    setSubOverrides([]);
    setCustomCategories([]);
    setToast('All data cleared.');
  }, []);

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
                monthStartDay={monthStartDay}
                pendingCount={grouping.pendingCount}
                onReview={canCategorize ? () => setWizardOpen(true) : undefined}
                onReset={hasCategorization ? handleResetCategorization : undefined}
                onRefine={() => setRefineOpen(true)}
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

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      <footer className="footer">
        Your statements never leave this browser — all parsing and storage happens on your device.
      </footer>
    </div>
  );
}

function buildToast(result: ImportResult, skipped: number): string {
  const parts = [`Added ${result.added} transaction${result.added === 1 ? '' : 's'}`];
  if (result.duplicates > 0) parts.push(`${result.duplicates} already imported`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  return parts.join(' · ');
}
