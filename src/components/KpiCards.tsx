import type { Overview } from '../lib/aggregate';
import { money, percent } from '../lib/format';

interface Props {
  overview: Overview;
  /** The same shape of overview, but built over a comparison period — when
   *  present, Income/Expenses/Net show a delta against it instead of their
   *  usual averages. */
  compareOverview?: Overview | null;
  compareLabel?: string;
}

/** Percent change of `current` vs `base`, or null when `base` is zero (no
 *  meaningful percentage to show). */
function deltaPct(current: number, base: number): number | null {
  if (base === 0) return null;
  return ((current - base) / Math.abs(base)) * 100;
}

export default function KpiCards({ overview, compareOverview, compareLabel }: Props) {
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

  const incomePct = compareOverview ? deltaPct(totalIncome, compareOverview.totalIncome) : null;
  const expensesPct = compareOverview ? deltaPct(totalExpenses, compareOverview.totalExpenses) : null;
  const netPct = compareOverview ? deltaPct(totalNet, compareOverview.totalNet) : null;

  return (
    <section className="kpis">
      <Kpi
        label="Income"
        value={money(totalIncome)}
        tone="pos"
        sub={compareOverview ? `${percent(incomePct)} vs ${compareLabel}` : `avg ${money(avgMonthlyIncome, { compact: true })} / mo`}
        subTone={compareOverview ? (incomePct === null ? undefined : incomePct >= 0 ? 'pos' : 'neg') : undefined}
      />
      <Kpi
        label="Expenses"
        value={money(totalExpenses)}
        tone="accent"
        sub={compareOverview ? `${percent(expensesPct)} vs ${compareLabel}` : `avg ${money(avgMonthlyExpenses, { compact: true })} / mo`}
        subTone={compareOverview ? (expensesPct === null ? undefined : expensesPct <= 0 ? 'pos' : 'neg') : undefined}
      />
      <Kpi
        label="Net"
        value={money(totalNet)}
        tone={totalNet >= 0 ? 'pos' : 'neg'}
        sub={compareOverview ? `${percent(netPct)} vs ${compareLabel}` : `${savingsRate.toFixed(0)}% of income kept`}
        subTone={compareOverview ? (netPct === null ? undefined : netPct >= 0 ? 'pos' : 'neg') : undefined}
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
