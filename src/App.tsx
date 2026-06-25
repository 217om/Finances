import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CategoryOverride,
  CategoryRule,
  ColumnMapping,
  ImportResult,
  ParsedFile,
  Transaction,
} from './types';
import { inspectFile, normalize } from './lib/parse';
import {
  addTransactions,
  clearAll,
  getAllTransactions,
  getOverrides,
  getRules,
  saveCategorization,
} from './lib/db';
import { buildOverview } from './lib/aggregate';
import { buildGroups } from './lib/grouping';
import { EXPENSE_CATEGORIES, makeResolver } from './lib/categorize';
import { getCurrency, setCurrency } from './lib/format';
import { downloadBackup, downloadCSV, isBackupFile, parseBackup } from './lib/exportData';
import Header from './components/Header';
import UploadPanel from './components/UploadPanel';
import ColumnMapper from './components/ColumnMapper';
import Dashboard from './components/Dashboard';
import EmptyState from './components/EmptyState';
import Toast from './components/Toast';
import CategorizeWizard from './components/CategorizeWizard';

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
  const [wizardOpen, setWizardOpen] = useState(false);

  // Restore preferences and load stored data on first mount.
  useEffect(() => {
    const saved = localStorage.getItem(CURRENCY_KEY);
    if (saved) {
      setCurrency(saved);
      setCurrencyState(saved);
    }
    const savedDay = Number(localStorage.getItem(MONTH_START_KEY));
    if (savedDay >= 1 && savedDay <= 28) setMonthStartDay(savedDay);
    try {
      const savedCats = JSON.parse(localStorage.getItem(CUSTOM_CATEGORIES_KEY) ?? '[]');
      if (Array.isArray(savedCats)) setCustomCategories(savedCats.filter((c) => typeof c === 'string'));
    } catch {
      /* ignore malformed value */
    }
    Promise.all([getAllTransactions(), getRules(), getOverrides()])
      .then(([txs, r, o]) => {
        setTransactions(txs);
        setRules(r);
        setOverrides(o);
      })
      .catch(() => setError('Could not open local storage. Is this a private browsing window?'))
      .finally(() => setLoading(false));
  }, []);

  const rulesMap = useMemo(() => new Map(rules.map((r) => [r.signature, r])), [rules]);
  const overridesMap = useMemo(
    () => new Map(overrides.map((o) => [o.id, o.category])),
    [overrides],
  );
  const categoryOf = useMemo(() => makeResolver(rulesMap, overridesMap), [rulesMap, overridesMap]);

  const overview = useMemo(
    () => buildOverview(transactions, monthStartDay, categoryOf),
    [transactions, monthStartDay, categoryOf],
  );

  const grouping = useMemo(
    () => buildGroups(transactions, rulesMap, overridesMap),
    [transactions, rulesMap, overridesMap],
  );

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
    setCustomCategories([]);
    setToast('All data cleared.');
  }, []);

  const hasData = transactions.length > 0;
  const canCategorize = grouping.groups.length > 0 || grouping.leftovers.length > 0;

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
            <UploadPanel onFiles={handleFiles} compact={hasData} />

            {error && <div className="banner banner-error">{error}</div>}

            {hasData ? (
              <Dashboard
                overview={overview}
                monthStartDay={monthStartDay}
                pendingCount={grouping.pendingCount}
                onReview={canCategorize ? () => setWizardOpen(true) : undefined}
              />
            ) : (
              <EmptyState />
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
