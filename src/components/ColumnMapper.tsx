import { useMemo, useState } from 'react';
import type { ColumnMapping, ParsedFile, Transaction } from '../types';
import { normalize } from '../lib/parse';
import { findImportOverlaps } from '../lib/importOverlaps';
import { money, monthLabel } from '../lib/format';

interface Props {
  parsed: ParsedFile;
  busy: boolean;
  existing: Transaction[];
  onConfirm: (parsed: ParsedFile, mapping: ColumnMapping, matches: ReadonlyMap<string, string>) => void;
  onCancel: () => void;
}

type AmountMode = 'single' | 'split';

const NONE = '';

/**
 * Confirmation step shown after a file is read. We pre-fill the detected
 * mapping; the user can correct it if a bank uses unusual column names. A live
 * preview shows how many rows will import and the first few normalized rows.
 */
export default function ColumnMapper({ parsed, busy, existing, onConfirm, onCancel }: Props) {
  const [keepSeparate, setKeepSeparate] = useState<Set<string>>(new Set());
  const detected = parsed.suggestedMapping;

  const [mode, setMode] = useState<AmountMode>(
    detected?.debitColumn || detected?.creditColumn ? 'split' : 'single',
  );
  const [dateColumn, setDateColumn] = useState(detected?.dateColumn ?? NONE);
  const [descriptionColumn, setDescriptionColumn] = useState(detected?.descriptionColumn ?? NONE);
  const [amountColumn, setAmountColumn] = useState(detected?.amountColumn ?? NONE);
  const [debitColumn, setDebitColumn] = useState(detected?.debitColumn ?? NONE);
  const [creditColumn, setCreditColumn] = useState(detected?.creditColumn ?? NONE);
  const [positiveMeans, setPositiveMeans] = useState<'income' | 'expense'>(
    detected?.positiveMeans ?? 'income',
  );
  const [balanceColumn, setBalanceColumn] = useState(detected?.balanceColumn ?? NONE);

  const mapping: ColumnMapping = useMemo(
    () => ({
      dateColumn,
      descriptionColumn,
      amountColumn: mode === 'single' ? amountColumn : undefined,
      debitColumn: mode === 'split' ? debitColumn : undefined,
      creditColumn: mode === 'split' ? creditColumn : undefined,
      positiveMeans,
      balanceColumn: balanceColumn || undefined,
    }),
    [dateColumn, descriptionColumn, amountColumn, debitColumn, creditColumn, mode, positiveMeans, balanceColumn],
  );

  const valid =
    dateColumn !== NONE &&
    (mode === 'single' ? amountColumn !== NONE : debitColumn !== NONE || creditColumn !== NONE);

  const normalized = useMemo(() => valid ? normalize(parsed, mapping).transactions : [], [parsed, mapping, valid]);
  const overlaps = useMemo(() => findImportOverlaps(normalized, existing), [normalized, existing]);
  const reviewedMatches = new Map([...overlaps].filter(([id, row]) => !keepSeparate.has(`${id}|${row.id}`)).map(([id, row]) => [id, row.id]));
  const preview = useMemo(() => {
    if (!valid) return { transactions: [], skipped: 0 };
    const { transactions, skipped } = normalize(parsed, mapping);
    return { transactions: transactions.slice(0, 6), skipped, total: transactions.length };
  }, [parsed, mapping, valid]);

  const columnSelect = (value: string, onChange: (v: string) => void, allowNone = false) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {allowNone && <option value={NONE}>(none)</option>}
      {!allowNone && <option value={NONE}>Select…</option>}
      {parsed.headers.map((h) => (
        <option key={h} value={h}>
          {h}
        </option>
      ))}
    </select>
  );

  return (
    <div className="modal-backdrop" onClick={() => { if (!busy) onCancel(); }}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Review “{parsed.fileName}”</h2>
          <p>{parsed.importKind === 'google-sheet'
            ? 'Amounts follow IN/OUT. Review the transactions and any possible duplicates before importing.'
            : 'We detected the columns below. Adjust anything that looks off, then import.'}</p>
        </div>

        {!parsed.importKind && <div className="map-grid">
          <label className="field">
            <span>Date column</span>
            {columnSelect(dateColumn, setDateColumn)}
          </label>

          <label className="field">
            <span>Description column</span>
            {columnSelect(descriptionColumn, setDescriptionColumn, true)}
          </label>

          <label className="field">
            <span>Balance column (optional)</span>
            {columnSelect(balanceColumn, setBalanceColumn, true)}
          </label>

          <div className="field field-full">
            <span>How are amounts stored?</span>
            <div className="seg">
              <button
                type="button"
                className={mode === 'single' ? 'seg-on' : ''}
                onClick={() => setMode('single')}
              >
                One Amount column
              </button>
              <button
                type="button"
                className={mode === 'split' ? 'seg-on' : ''}
                onClick={() => setMode('split')}
              >
                Separate Money-in / Money-out
              </button>
            </div>
          </div>

          {mode === 'single' ? (
            <>
              <label className="field">
                <span>Amount column</span>
                {columnSelect(amountColumn, setAmountColumn)}
              </label>
              <label className="field">
                <span>A positive number means…</span>
                <select
                  value={positiveMeans}
                  onChange={(e) => setPositiveMeans(e.target.value as 'income' | 'expense')}
                >
                  <option value="income">Money in (income)</option>
                  <option value="expense">Money out (expense)</option>
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>Money-in (credit) column</span>
                {columnSelect(creditColumn, setCreditColumn, true)}
              </label>
              <label className="field">
                <span>Money-out (debit) column</span>
                {columnSelect(debitColumn, setDebitColumn, true)}
              </label>
            </>
          )}
        </div>}

        <div className="preview">
          <div className="preview-head">
            <strong>Preview</strong>
            {valid && (
              <span className="muted">
                {preview.total ?? 0} transactions ready
                {preview.skipped ? ` · ${preview.skipped} rows skipped` : ''}
              </span>
            )}
          </div>
          {valid && preview.transactions.length > 0 ? (
            <table className="preview-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Date</th>
                  <th>Description</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {preview.transactions.map((t, i) => (
                  <tr key={i}>
                    <td>{monthLabel(t.month)}</td>
                    <td>{t.date}</td>
                    <td className="desc">{t.description || '—'}</td>
                    <td className={`num ${t.amount >= 0 ? 'pos' : 'neg'}`}>
                      {money(t.amount, { sign: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Pick a date and amount column to see a preview.</p>
          )}
        </div>

        {overlaps.size > 0 && (
          <section className="import-overlaps" aria-label="Review possible duplicates">
            <h3>Review {overlaps.size} possible duplicate{overlaps.size === 1 ? '' : 's'}</h3>
            <p className="muted">These sheet and statement entries have the same date and amount, but different descriptions.
              Checked entries will count once. Uncheck any that are separate payments.</p>
            <div className="import-overlap-list">
              {normalized.filter((t, i, all) => overlaps.has(t.id) && all.findIndex((r) => r.id === t.id) === i).map((t) => {
                const match = overlaps.get(t.id)!;
                const key = `${t.id}|${match.id}`;
                return <label className="import-overlap" key={key}>
                  <input type="checkbox" checked={!keepSeparate.has(key)} disabled={busy} onChange={(e) => {
                    const checked = e.target.checked;
                    setKeepSeparate((prev) => {
                      const next = new Set(prev);
                      if (checked) next.delete(key); else next.add(key);
                      return next;
                    });
                  }} />
                  <span><strong>{t.date} · {money(t.amount)}</strong><br />
                    New: {t.description || '—'}<br />Already stored: {match.description || '—'}</span>
                </label>;
              })}
            </div>
          </section>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!valid || busy}
            onClick={() => onConfirm(parsed, mapping, reviewedMatches)}
          >
            {busy ? 'Importing…' : 'Import transactions'}
          </button>
        </div>
      </div>
    </div>
  );
}
