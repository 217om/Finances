import { currencyOptions } from '../lib/format';

interface Props {
  currency: string;
  onCurrencyChange: (code: string) => void;
  monthStartDay: number;
  onMonthStartChange: (day: number) => void;
  hasData: boolean;
  onClearAll: () => void;
}

const ORDINALS = ['', '1st', '2nd', '3rd', ...Array.from({ length: 25 }, (_, i) => `${i + 4}th`)];

export default function Header({
  currency,
  onCurrencyChange,
  monthStartDay,
  onMonthStartChange,
  hasData,
  onClearAll,
}: Props) {
  return (
    <header className="header">
      <div className="container header-inner">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ▲
          </span>
          <div>
            <h1>CashFlow</h1>
            <p className="brand-sub">Monthly cashflow, at a glance</p>
          </div>
        </div>

        <div className="header-actions">
          <label className="picker" title="The day each month starts on, e.g. your payday">
            <span className="picker-label">Month starts</span>
            <select
              value={monthStartDay}
              onChange={(e) => onMonthStartChange(Number(e.target.value))}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? '1st (calendar)' : ORDINALS[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="picker">
            <span className="sr-only">Currency</span>
            <select value={currency} onChange={(e) => onCurrencyChange(e.target.value)}>
              {currencyOptions().map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          {hasData && (
            <button type="button" className="btn btn-ghost" onClick={onClearAll}>
              Clear data
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
