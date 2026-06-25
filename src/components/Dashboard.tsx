import { useMemo, useState } from 'react';
import type { Overview } from '../lib/aggregate';
import { withMovingAverage } from '../lib/aggregate';
import KpiCards from './KpiCards';
import NetCashflowChart from './NetCashflowChart';
import IncomeExpenseChart from './IncomeExpenseChart';
import MonthTable from './MonthTable';
import Sources from './Sources';

interface Props {
  overview: Overview;
}

type Range = '12' | '24' | '60' | 'all';

const RANGES: { key: Range; label: string }[] = [
  { key: '12', label: '1Y' },
  { key: '24', label: '2Y' },
  { key: '60', label: '5Y' },
  { key: 'all', label: 'All' },
];

export default function Dashboard({ overview }: Props) {
  const [range, setRange] = useState<Range>('all');

  const months = useMemo(() => {
    const all = withMovingAverage(overview.months);
    if (range === 'all') return all;
    return all.slice(-Number(range));
  }, [overview.months, range]);

  return (
    <div className="dashboard">
      <KpiCards overview={overview} />

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Net cashflow by month</h2>
            <p className="muted">Money in minus money out. The line is a 3-month average.</p>
          </div>
          <div className="seg seg-sm">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                className={range === r.key ? 'seg-on' : ''}
                onClick={() => setRange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <NetCashflowChart months={months} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Income vs. expenses</h2>
            <p className="muted">How much came in and went out each month.</p>
          </div>
        </div>
        <IncomeExpenseChart months={months} />
      </section>

      <div className="two-col">
        <section className="panel">
          <div className="panel-head">
            <h2>Monthly breakdown</h2>
          </div>
          <MonthTable months={overview.months} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Imported statements</h2>
          </div>
          <Sources sources={overview.sources} />
        </section>
      </div>
    </div>
  );
}
