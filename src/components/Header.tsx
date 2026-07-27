import type { Card } from '../lib/cards';
import { currencyOptions } from '../lib/format';
import DataMenu from './DataMenu';

interface Props {
  currency: string;
  onCurrencyChange: (code: string) => void;
  monthStartDay: number;
  onMonthStartChange: (day: number) => void;
  hasData: boolean;
  onClearAll: () => void;
  onExportJSON: () => void;
  onExportCSV: () => void;
  cards: Card[];
  activeCardId: string;
  onSwitchCard: (id: string) => void;
  onManageCards: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

const ORDINALS = ['', '1st', '2nd', '3rd', ...Array.from({ length: 25 }, (_, i) => `${i + 4}th`)];

export default function Header({
  currency,
  onCurrencyChange,
  monthStartDay,
  onMonthStartChange,
  hasData,
  onClearAll,
  onExportJSON,
  onExportCSV,
  cards,
  activeCardId,
  onSwitchCard,
  onManageCards,
  theme,
  onToggleTheme,
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
          <label className="picker" title="Which card/account you're analyzing">
            <span className="picker-label">Card</span>
            <select value={activeCardId} onChange={(e) => onSwitchCard(e.target.value)}>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onManageCards}>
            Manage cards
          </button>
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
            <DataMenu
              onExportJSON={onExportJSON}
              onExportCSV={onExportCSV}
              onClearAll={onClearAll}
            />
          )}
          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle color theme"
          >
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.6" />
                <path
                  d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
                <path
                  d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
