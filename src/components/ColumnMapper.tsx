import { useMemo, useState } from 'react';
import type { ColumnMapping, ParsedFile } from '../types';
import { normalize } from '../lib/parse';
import { money, monthLabel } from '../lib/format';

interface Props {
  parsed: ParsedFile;
  busy: boolean;
  onConfirm: (parsed: ParsedFile, mapping: ColumnMapping) => void;
  onCancel: () => void;
}

type AmountMode = 'single' | 'split';

const NONE = '';

/**
 * Confirmation step shown after a file is read. We pre-fill the detected
 * mapping; the user can correct it if a bank uses unusual column names. A live
 * preview shows how many rows will import and the first few normalized rows.
 */
export default function ColumnMapper({ parsed, busy, onConfirm, onCancel }: Props) {
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
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Review “{parsed.fileName}”</h2>
          <p>We detected the columns below. Adjust anything that looks off, then import.</p>
        </div>

        <div className="map-grid">
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
        </div>

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

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!valid || busy}
            onClick={() => onConfirm(parsed, mapping)}
          >
            {busy ? 'Importing…' : 'Import statement'}
          </button>
        </div>
      </div>
    </div>
  );
}
