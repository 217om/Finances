import { currencyOptions } from '../lib/format';

interface Props {
  currency: string;
  onCurrencyChange: (code: string) => void;
  hasData: boolean;
  onClearAll: () => void;
}

export default function Header({ currency, onCurrencyChange, hasData, onClearAll }: Props) {
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
          <label className="currency-picker">
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
