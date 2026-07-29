import type { Card } from '../lib/cards';
import SettingsMenu from './SettingsMenu';
import CardSelector from './CardSelector';

interface Props {
  currency: string;
  onCurrencyChange: (code: string) => void;
  monthStartDay: number;
  onMonthStartChange: (day: number) => void;
  hasData: boolean;
  onClearAll: () => void;
  onClearTransactionsOnly: () => void;
  onExportJSON: () => void;
  onExportCSV: () => void;
  onExportFullBackup: () => void;
  onRestoreFullBackup: (file: File) => void;
  cards: Card[];
  activeCardId: string;
  combineEnabled: boolean;
  onSwitchCard: (id: string) => void;
  onManageCards: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export default function Header({
  currency,
  onCurrencyChange,
  monthStartDay,
  onMonthStartChange,
  hasData,
  onClearAll,
  onClearTransactionsOnly,
  onExportJSON,
  onExportCSV,
  onExportFullBackup,
  onRestoreFullBackup,
  cards,
  activeCardId,
  combineEnabled,
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
          <CardSelector
            cards={cards}
            activeCardId={activeCardId}
            combineEnabled={combineEnabled}
            onSwitchCard={onSwitchCard}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={onManageCards}>
            Manage cards
          </button>
          <SettingsMenu
            currency={currency}
            onCurrencyChange={onCurrencyChange}
            monthStartDay={monthStartDay}
            onMonthStartChange={onMonthStartChange}
            theme={theme}
            onToggleTheme={onToggleTheme}
            hasData={hasData}
            onClearAll={onClearAll}
            onClearTransactionsOnly={onClearTransactionsOnly}
            onExportJSON={onExportJSON}
            onExportCSV={onExportCSV}
            onExportFullBackup={onExportFullBackup}
            onRestoreFullBackup={onRestoreFullBackup}
          />
        </div>
      </div>
    </header>
  );
}
