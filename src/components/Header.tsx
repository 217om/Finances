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
        </div>
      </div>
    </header>
  );
}
