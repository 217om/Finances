import { useMemo } from 'react';
import type { MonthlySummary } from '../types';
import { categoryTotals } from '../lib/aggregate';
import { categoryColor } from '../lib/categorize';
import { money } from '../lib/format';

interface Props {
  months: MonthlySummary[];
}

/** Horizontal "where your money goes" breakdown for the visible range. */
export default function CategoryBreakdown({ months }: Props) {
  const rows = useMemo(() => categoryTotals(months), [months]);
  const total = rows.reduce((a, r) => a + r.amount, 0);

  if (total === 0) {
    return <p className="muted">No expenses in this range to categorize.</p>;
  }

  const max = rows[0]?.amount ?? 1;

  return (
    <div className="catlist">
      {rows.map((r) => {
        const pct = (r.amount / total) * 100;
        return (
          <div key={r.category} className="catrow">
            <div className="catrow-head">
              <span className="catname">
                <span className="catdot" style={{ background: categoryColor(r.category) }} />
                {r.category}
              </span>
              <span className="catamt">
                {money(r.amount)} <span className="muted">· {pct.toFixed(0)}%</span>
              </span>
            </div>
            <div className="catbar-track">
              <div
                className="catbar-fill"
                style={{ width: `${(r.amount / max) * 100}%`, background: categoryColor(r.category) }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
