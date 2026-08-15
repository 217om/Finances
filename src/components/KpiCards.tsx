import type { Overview } from '../lib/aggregate';
import { money, percent } from '../lib/format';

interface Props {
  overview: Overview;
}

export default function KpiCards({ overview }: Props) {
  const {
    totalIncome,
    totalExpenses,
    totalNet,
    avgMonthlyIncome,
    avgMonthlyExpenses,
    savingsRate,
    latestWeek,
    priorWeek,
    weekChangePct,
    latestMonth,
    priorMonth,
    monthChangePct,
  } = overview;

  return (
    <section className="kpis">
      <Kpi
        label="Income"
        value={money(totalIncome)}
        tone="pos"
        sub={`avg ${money(avgMonthlyIncome, { compact: true })} / mo`}
      />
      <Kpi
        label="Expenses"
        value={money(totalExpenses)}
        tone="accent"
        sub={`avg ${money(avgMonthlyExpenses, { compact: true })} / mo`}
      />
      <Kpi
        label="Net"
        value={money(totalNet)}
        tone={totalNet >= 0 ? 'pos' : 'neg'}
        sub={`${savingsRate.toFixed(0)}% of income kept`}
      />
      <Kpi
        label="Latest week"
        value={latestWeek ? money(latestWeek.net) : '—'}
        tone={!latestWeek ? 'neutral' : latestWeek.net >= 0 ? 'pos' : 'neg'}
        sub={weekChangePct !== null ? `${percent(weekChangePct)} vs prior week` : priorWeek ? 'no change' : 'not enough history yet'}
        subTone={weekChangePct === null ? undefined : weekChangePct >= 0 ? 'pos' : 'neg'}
      />
      <Kpi
        label="Latest month"
        value={latestMonth ? money(latestMonth.net) : '—'}
        tone={!latestMonth ? 'neutral' : latestMonth.net >= 0 ? 'pos' : 'neg'}
        sub={monthChangePct !== null ? `${percent(monthChangePct)} vs prior month` : priorMonth ? 'no change' : 'not enough history yet'}
        subTone={monthChangePct === null ? undefined : monthChangePct >= 0 ? 'pos' : 'neg'}
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
  tone: 'pos' | 'neg' | 'neutral' | 'accent';
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
