import type { Card } from '../lib/cards';
import type { SalaryRule } from '../lib/executiveSummary';
import SettingsMenu from './SettingsMenu';
import CardSelector from './CardSelector';
import SyncStatusBadge from './SyncStatusBadge';

interface Props {
  currency: string;
  onCurrencyChange: (code: string) => void;
  monthStartDay: number;
  onMonthStartChange: (day: number) => void;
  weekStartDay: number;
  onWeekStartChange: (day: number) => void;
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
  onOpenCloudSync: () => void;
  salaryRule: SalaryRule | null;
  onSalaryRuleChange: (next: SalaryRule | null) => void;
}

export default function Header({
  currency,
  onCurrencyChange,
  monthStartDay,
  onMonthStartChange,
  weekStartDay,
  onWeekStartChange,
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
  onOpenCloudSync,
  salaryRule,
  onSalaryRuleChange,
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
          <SyncStatusBadge />
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
            weekStartDay={weekStartDay}
            onWeekStartChange={onWeekStartChange}
            theme={theme}
            onToggleTheme={onToggleTheme}
            hasData={hasData}
            onClearAll={onClearAll}
            onClearTransactionsOnly={onClearTransactionsOnly}
            onExportJSON={onExportJSON}
            onExportCSV={onExportCSV}
            onExportFullBackup={onExportFullBackup}
            onRestoreFullBackup={onRestoreFullBackup}
            onOpenCloudSync={onOpenCloudSync}
            salaryRule={salaryRule}
            onSalaryRuleChange={onSalaryRuleChange}
          />
        </div>
      </div>
    </header>
  );
}
