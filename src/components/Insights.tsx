import type { Overview } from '../lib/aggregate';
import { categoryColor } from '../lib/categorize';
import { money } from '../lib/format';

interface Props {
  overview: Overview;
}

const ICONS: Record<string, string> = { good: '✓', warn: '!', info: 'i' };

/** Plain-language alerts plus the detected recurring income & bills. */
export default function Insights({ overview }: Props) {
  const { insights, recurring } = overview;
  const income = recurring.filter((r) => r.kind === 'income').slice(0, 4);
  const expenses = recurring.filter((r) => r.kind === 'expense').slice(0, 8);

  if (insights.length === 0 && recurring.length === 0) {
    return <p className="muted">Import a few months of statements to surface trends and recurring items.</p>;
  }

  return (
    <div className="insights">
      {insights.length > 0 && (
        <ul className="alerts">
          {insights.map((ins, i) => (
            <li key={i} className={`alert alert-${ins.severity}`}>
              <span className="alert-icon">{ICONS[ins.severity]}</span>
              <div>
                <strong>{ins.title}</strong>
                <span className="alert-detail">{ins.detail}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {recurring.length > 0 && (
        <div className="recurring">
          {income.length > 0 && (
            <div className="recurring-group">
              <h3>Regular income</h3>
              {income.map((r) => (
                <RecurringRow key={r.label} label={r.label} category={r.category} amount={r.amount} months={r.months} />
              ))}
            </div>
          )}
          {expenses.length > 0 && (
            <div className="recurring-group">
              <h3>Recurring bills & subscriptions</h3>
              {expenses.map((r) => (
                <RecurringRow key={r.label} label={r.label} category={r.category} amount={r.amount} months={r.months} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RecurringRow({
  label,
  category,
  amount,
  months,
}: {
  label: string;
  category: string;
  amount: number;
  months: number;
}) {
  return (
    <div className="recurring-row">
      <span className="catdot" style={{ background: categoryColor(category) }} />
      <span className="recurring-label" title={label}>
        {label}
      </span>
      <span className="recurring-meta muted">{months} mo</span>
      <span className="recurring-amt">{money(amount)}</span>
    </div>
  );
}
