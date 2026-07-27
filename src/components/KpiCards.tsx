import type { Overview } from '../lib/aggregate';
import { money, monthLabel, percent } from '../lib/format';

interface Props {
  overview: Overview;
}

export default function KpiCards({ overview }: Props) {
  const {
    totalNet,
    avgMonthlyNet,
    avgMonthlyIncome,
    avgMonthlyExpenses,
    savingsRate,
    netTrendPct,
    bestMonth,
    worstMonth,
  } = overview;

  return (
    <section className="kpis">
      <Kpi
        label="Net saved"
        value={money(totalNet)}
        tone={totalNet >= 0 ? 'pos' : 'neg'}
        sub="across all statements"
      />
      <Kpi
        label="Avg net / month"
        value={money(avgMonthlyNet)}
        tone={avgMonthlyNet >= 0 ? 'pos' : 'neg'}
        sub={netTrendPct !== null ? `${percent(netTrendPct)} vs prior 6 mo` : 'typical month'}
        subTone={netTrendPct === null ? undefined : netTrendPct >= 0 ? 'pos' : 'neg'}
      />
      <Kpi
        label="Savings rate"
        value={`${savingsRate.toFixed(0)}%`}
        tone={savingsRate >= 0 ? 'pos' : 'neg'}
        sub="of income kept"
      />
      <Kpi
        label="Avg income / month"
        value={money(avgMonthlyIncome)}
        tone="neutral"
        sub={`spend ${money(avgMonthlyExpenses)}`}
      />
      <Kpi
        label="Best month"
        value={bestMonth ? money(bestMonth.net) : '—'}
        tone={bestMonth && bestMonth.net < 0 ? 'neg' : 'pos'}
        sub={bestMonth ? monthLabel(bestMonth.month) : ''}
      />
      <Kpi
        label="Toughest month"
        value={worstMonth ? money(worstMonth.net) : '—'}
        tone={worstMonth && worstMonth.net < 0 ? 'neg' : 'neutral'}
        sub={worstMonth ? monthLabel(worstMonth.month) : ''}
      />
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
  subTone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: 'pos' | 'neg' | 'neutral';
  subTone?: 'pos' | 'neg';
}) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${tone}`}>{value}</div>
      {sub && <div className={`kpi-sub ${subTone ?? ''}`}>{sub}</div>}
    </div>
  );
}
