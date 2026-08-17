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

/** "+OMR 4.905 (+71%) vs Last week" — the actual amount moved, not just the
 *  percentage, since a bare "+71%" on its own says nothing about size. */
function deltaSub(current: number, base: number, label: string | undefined): string {
  const amount = money(current - base, { sign: true, compact: true });
  const pct = deltaPct(current, base);
  return `${amount}${pct === null ? '' : ` (${percent(pct)})`} vs ${label}`;
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

  const incomeDelta = compareOverview ? totalIncome - compareOverview.totalIncome : null;
  const expensesDelta = compareOverview ? totalExpenses - compareOverview.totalExpenses : null;
  const netDelta = compareOverview ? totalNet - compareOverview.totalNet : null;

  return (
    <section className="kpis">
      <Kpi
        label="Income"
        value={money(totalIncome)}
        tone="pos"
        sub={
          compareOverview
            ? deltaSub(totalIncome, compareOverview.totalIncome, compareLabel)
            : `avg ${money(avgMonthlyIncome, { compact: true })} / mo`
        }
        subTone={incomeDelta === null ? undefined : incomeDelta >= 0 ? 'pos' : 'neg'}
      />
      <Kpi
        label="Expenses"
        value={money(totalExpenses)}
        tone="accent"
        sub={
          compareOverview
            ? deltaSub(totalExpenses, compareOverview.totalExpenses, compareLabel)
            : `avg ${money(avgMonthlyExpenses, { compact: true })} / mo`
        }
        subTone={expensesDelta === null ? undefined : expensesDelta <= 0 ? 'pos' : 'neg'}
      />
      <Kpi
        label="Net"
        value={money(totalNet)}
        tone={totalNet >= 0 ? 'pos' : 'neg'}
        sub={
          compareOverview
            ? deltaSub(totalNet, compareOverview.totalNet, compareLabel)
            : `${savingsRate.toFixed(0)}% of income kept`
        }
        subTone={netDelta === null ? undefined : netDelta >= 0 ? 'pos' : 'neg'}
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
