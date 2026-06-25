import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ColumnMapping, ImportResult, ParsedFile, Transaction } from './types';
import { inspectFile, normalize } from './lib/parse';
import { addTransactions, clearAll, getAllTransactions } from './lib/db';
import { buildOverview } from './lib/aggregate';
import { getCurrency, setCurrency } from './lib/format';
import Header from './components/Header';
import UploadPanel from './components/UploadPanel';
import ColumnMapper from './components/ColumnMapper';
import Dashboard from './components/Dashboard';
import EmptyState from './components/EmptyState';
import Toast from './components/Toast';

const CURRENCY_KEY = 'cashflow.currency';
const MONTH_START_KEY = 'cashflow.monthStartDay';

export default function App() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<ParsedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrencyState] = useState(getCurrency());
  const [monthStartDay, setMonthStartDay] = useState(1);

  // Restore preferences and load stored history on first mount.
  useEffect(() => {
    const saved = localStorage.getItem(CURRENCY_KEY);
    if (saved) {
      setCurrency(saved);
      setCurrencyState(saved);
    }
    const savedDay = Number(localStorage.getItem(MONTH_START_KEY));
    if (savedDay >= 1 && savedDay <= 28) setMonthStartDay(savedDay);
    getAllTransactions()
      .then(setTransactions)
      .catch(() => setError('Could not open local storage. Is this a private browsing window?'))
      .finally(() => setLoading(false));
  }, []);

  const overview = useMemo(
    () => buildOverview(transactions, monthStartDay),
    [transactions, monthStartDay],
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
    // Inspect one file at a time so the user can confirm its column mapping.
    try {
      const parsed = await inspectFile(list[0]);
      if (parsed.rows.length === 0) {
        setError(`No rows found in "${parsed.fileName}". Is it an exported transaction file?`);
        return;
      }
      setPending(parsed);
    } catch (e) {
      setError(`Could not read that file. ${(e as Error).message ?? ''}`.trim());
    }
  }, []);

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
    setTransactions([]);
    setToast('All data cleared.');
  }, []);

  const hasData = transactions.length > 0;

  return (
    <div className="app">
      <Header
        currency={currency}
        onCurrencyChange={handleCurrencyChange}
        monthStartDay={monthStartDay}
        onMonthStartChange={handleMonthStartChange}
        hasData={hasData}
        onClearAll={handleClearAll}
      />

      <main className="container">
        {loading ? (
          <div className="loading">Loading your data…</div>
        ) : (
          <>
            <UploadPanel onFiles={handleFiles} compact={hasData} />

            {error && <div className="banner banner-error">{error}</div>}

            {hasData ? (
              <Dashboard overview={overview} monthStartDay={monthStartDay} />
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
