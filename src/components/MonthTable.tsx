import type { MonthlySummary } from '../types';
import { money, monthLabel } from '../lib/format';

interface Props {
  months: MonthlySummary[];
}

export default function MonthTable({ months }: Props) {
  // Most recent first; only months that actually had activity.
  const active = months.filter((m) => m.txCount > 0).slice().reverse();

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Month</th>
            <th className="num">Income</th>
            <th className="num">Expenses</th>
            <th className="num">Net</th>
          </tr>
        </thead>
        <tbody>
          {active.map((m) => (
            <tr key={m.month}>
              <td>{monthLabel(m.month)}</td>
              <td className="num">{money(m.income)}</td>
              <td className="num">{money(m.expenses)}</td>
              <td className={`num strong ${m.net >= 0 ? 'pos' : 'neg'}`}>
                {money(m.net, { sign: true })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
