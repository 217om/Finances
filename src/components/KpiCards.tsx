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

/**
 * Percent change of `current` vs `base`, or null when a percentage wouldn't
 * actually be informative:
 *  - no base to divide by,
 *  - either side sitting at exactly zero (any move away from/to zero is
 *    always "-100%" or undefined, which says nothing beyond "it was/is
 *    zero" — e.g. income not having landed yet this period isn't a
 *    meaningful "-100%"),
 *  - or the two periods landing on opposite sides of zero (a swing from
 *    spending more than earning to earning more than spending isn't a
 *    "percent" of anything — the sign flip itself is the whole story).
 */
function deltaPct(current: number, base: number): number | null {
  if (base === 0 || current === 0) return null;
  if (current < 0 !== base < 0) return null;
  return ((current - base) / Math.abs(base)) * 100;
}

/** "+OMR 4.905 (+71%) vs Last week" — the actual amount moved, not just the
 *  percentage, since a bare "+71%" on its own says nothing about size. The
 *  percentage itself is dropped (see deltaPct) when it wouldn't be
 *  meaningful, leaving just the plain amount moved. */
function deltaSub(current: number, base: number, label: string): string {
  const amount = money(current - base, { sign: true, compact: true });
  const pct = deltaPct(current, base);
  return `${amount}${pct === null ? '' : ` (${percent(pct)})`} vs ${label}`;
}

export default function KpiCards({ overview, compareOverview, compareLabel }: Props) {
  const { totalIncome, totalExpenses, totalNet, avgMonthlyIncome, avgMonthlyExpenses, savingsRate, latestWeek, priorWeek, latestMonth, priorMonth } =
    overview;

  const incomeDelta = compareOverview ? totalIncome - compareOverview.totalIncome : null;
  const expensesDelta = compareOverview ? totalExpenses - compareOverview.totalExpenses : null;
  const netDelta = compareOverview ? totalNet - compareOverview.totalNet : null;
  const label = compareLabel ?? 'compare period';

  const weekDelta = latestWeek && priorWeek ? latestWeek.net - priorWeek.net : null;
  const monthDelta = latestMonth && priorMonth ? latestMonth.net - priorMonth.net : null;

  return (
    <section className="kpis">
      <Kpi
        label="Income"
        value={money(totalIncome)}
        tone="pos"
        sub={
          compareOverview
            ? deltaSub(totalIncome, compareOverview.totalIncome, label)
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
            ? deltaSub(totalExpenses, compareOverview.totalExpenses, label)
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
            ? deltaSub(totalNet, compareOverview.totalNet, label)
            : `${savingsRate.toFixed(0)}% of income kept`
        }
        subTone={netDelta === null ? undefined : netDelta >= 0 ? 'pos' : 'neg'}
      />
      <Kpi
        label="Latest week"
        value={latestWeek ? money(latestWeek.net) : '—'}
        tone={!latestWeek ? 'neutral' : latestWeek.net >= 0 ? 'pos' : 'neg'}
        sub={
          !latestWeek || !priorWeek
            ? 'not enough history yet'
            : weekDelta === 0
              ? 'no change vs prior week'
              : deltaSub(latestWeek.net, priorWeek.net, 'prior week')
        }
        subTone={weekDelta === null ? undefined : weekDelta >= 0 ? 'pos' : 'neg'}
      />
      <Kpi
        label="Latest month"
        value={latestMonth ? money(latestMonth.net) : '—'}
        tone={!latestMonth ? 'neutral' : latestMonth.net >= 0 ? 'pos' : 'neg'}
        sub={
          !latestMonth || !priorMonth
            ? 'not enough history yet'
            : monthDelta === 0
              ? 'no change vs prior month'
              : deltaSub(latestMonth.net, priorMonth.net, 'prior month')
        }
        subTone={monthDelta === null ? undefined : monthDelta >= 0 ? 'pos' : 'neg'}
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
