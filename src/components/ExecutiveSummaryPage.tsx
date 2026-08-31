import { useEffect, useMemo, useState } from 'react';
import type { Transaction } from '../types';
import {
  buildCustomRangeSummary,
  buildPeriodBreakdowns,
  hasSalaryRuleMatch,
  type CategoryAmount,
  type CategoryBreakdown,
  type PeriodSummary,
  type SalaryRule,
  type SummaryGranularity,
} from '../lib/executiveSummary';
import {
  cardBalanceHistory,
  computeCardBalance,
  latestAssetValue,
  signedAssetValue,
  type Asset,
  type AssetValueEntry,
  type NetWorthPoint,
} from '../lib/balances';
import { todayISO } from '../lib/budget';
import { categoryColor } from '../lib/categorize';
import { dayLabel, money } from '../lib/format';
import { BalanceSnapshotCard, freshnessLabel, type CardBalanceRow } from './BalancesPage';

interface Props {
  cards: CardBalanceRow[];
  cardCount: number;
  /** Set when showing a single card's own story (not "Combine all cards") —
   *  swaps the subtitle to name that card instead of talking about a count. */
  cardName?: string;
  assets: Asset[];
  assetValues: AssetValueEntry[];
  transactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  monthStartDay: number;
  weekStartDay: number;
  /** Identifies salary payments so Monthly periods can open on the actual
   *  payday instead of a fixed day-of-month — null means "not set up",
   *  falling back to monthStartDay. Configured in Settings, not here — see
   *  lib/executiveSummary.ts. */
  salaryRule: SalaryRule | null;
}

type ViewMode = SummaryGranularity | 'custom';

const MODES: { key: ViewMode; label: string }[] = [
  { key: 'month', label: 'Monthly' },
  { key: 'week', label: 'Weekly' },
  { key: 'custom', label: 'Custom range' },
];

const TOP_CATEGORY_COUNT = 5;

/** One category's name + signed amount, stacked in a table cell — used for
 *  the rank-based Sources/Uses sub-rows, where a given row position (e.g.
 *  "2nd largest") is a different category in each period's column. */
function CategoryCell({ entry, sign }: { entry: CategoryAmount | null; sign: '+' | '-' }) {
  if (!entry) return <span className="muted">—</span>;
  return (
    <div className="exec-cat-cell">
      <span className="exec-cat-cell-name">
        <span className="catdot" style={{ background: categoryColor(entry.category) }} />
        {entry.category}
      </span>
      <span className={`exec-cat-cell-amt ${sign === '+' ? 'pos' : 'neg'}`}>
        {sign}
        {money(entry.amount, { compact: true })}
      </span>
    </div>
  );
}

/** The top-5-plus-"Other" rows under a Sources/Uses total row, one column
 *  per period — see lib/executiveSummary.ts's categoryBreakdown for how the
 *  cap and the reconciling gap (folded into "Other" rather than shown
 *  separately) work. Each row is a rank ("largest", "2nd largest", …), not a
 *  fixed category name, since different periods rank different categories. */
function CategoryRankRows({ periods, pick, sign }: { periods: PeriodSummary[]; pick: (p: PeriodSummary) => CategoryBreakdown; sign: '+' | '-' }) {
  const rowsFor = (p: PeriodSummary): (CategoryAmount | null)[] => {
    const b = pick(p);
    const rows: (CategoryAmount | null)[] = [...b.top];
    if (b.otherTotal > 0.005) rows.push({ category: 'Other', amount: b.otherTotal });
    while (rows.length < TOP_CATEGORY_COUNT + 1) rows.push(null);
    return rows;
  };
  const perPeriodRows = periods.map(rowsFor);
  const rowCount = Math.max(0, ...perPeriodRows.map((r) => r.filter((x) => x !== null).length));
  const groupClass = sign === '+' ? 'exec-subrow-sources' : 'exec-subrow-uses';

  return (
    <>
      {Array.from({ length: rowCount }).map((_, i) => (
        <tr key={i} className={`exec-subrow ${groupClass}`}>
          <td>&nbsp;</td>
          {perPeriodRows.map((rows, colIdx) => (
            <td key={periods[colIdx].period} className="num">
              <CategoryCell entry={rows[i]} sign={sign} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * The one report the rest of the app builds up to: what your cash position
 * was, broadly why it moved, and what it is now — one column per period
 * (oldest to newest, ending at the current one), each with its own
 * opening/closing balance and a sources/uses category breakdown capped at
 * the top 5 plus an "Other" catch-all. A given row position under Sources
 * or Uses is a *rank* ("largest", "2nd largest", …), not a fixed category —
 * different periods usually rank different categories there. Shows one
 * card's own story when a single card is active, or the full cross-card
 * (plus tracked assets) picture when "Combine all cards" is on. See
 * lib/executiveSummary.ts's buildPeriodBreakdowns for how each period's
 * numbers are computed.
 */
export default function ExecutiveSummaryPage({
  cards,
  cardCount,
  cardName,
  assets,
  assetValues,
  transactions,
  categoryOf,
  monthStartDay,
  weekStartDay,
  salaryRule,
}: Props) {
  const [mode, setMode] = useState<ViewMode>('month');

  // The exact first/last transaction dates — the custom-range pickers below
  // let the user pick any day in between, defaulting to the full span.
  const dateBounds = useMemo(() => {
    if (transactions.length === 0) return { min: '', max: '' };
    let min = transactions[0].date;
    let max = transactions[0].date;
    for (const t of transactions) {
      if (t.date < min) min = t.date;
      if (t.date > max) max = t.date;
    }
    return { min, max };
  }, [transactions]);

  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  useEffect(() => {
    if (!customFrom && !customTo && dateBounds.max) {
      setCustomFrom(dateBounds.min);
      setCustomTo(dateBounds.max);
    }
  }, [dateBounds.min, dateBounds.max]); // eslint-disable-line react-hooks/exhaustive-deps

  const trendPeriods = useMemo(
    () =>
      mode === 'custom'
        ? []
        : buildPeriodBreakdowns(
            cards,
            assets,
            assetValues,
            transactions,
            categoryOf,
            monthStartDay,
            weekStartDay,
            mode,
            undefined,
            salaryRule,
          ),
    [cards, assets, assetValues, transactions, categoryOf, monthStartDay, weekStartDay, mode, salaryRule],
  );

  const customSummary = useMemo(() => {
    if (mode !== 'custom' || !customFrom || !customTo) return null;
    return buildCustomRangeSummary(cards, assets, assetValues, transactions, categoryOf, customFrom, customTo);
  }, [mode, cards, assets, assetValues, transactions, categoryOf, customFrom, customTo]);

  const periods = mode === 'custom' ? (customSummary ? [customSummary] : []) : trendPeriods;

  const hasAssets = assets.length > 0;
  const subtitle = cardName
    ? `For ${cardName}.`
    : `Combined across ${cardCount} card${cardCount === 1 ? '' : 's'}${hasAssets ? ' and your other tracked assets' : ''}.`;
  const anyIncomplete = periods.some((p) => !p.openingComplete || !p.closingComplete);
  const salaryRuleNoMatchYet = mode === 'month' && !!salaryRule && !hasSalaryRuleMatch(transactions, salaryRule);
  // The trailing-periods trend (Monthly/Weekly) always ends on the current,
  // possibly still in-progress period — worth calling out so it's clear
  // which column is "now" versus history. A Custom range is just whatever
  // span the user picked, not necessarily current, so it never gets the
  // badge.
  const currentPeriodKey = mode !== 'custom' && periods.length > 0 ? periods[periods.length - 1].period : null;

  // When there's exactly one card and no assets, the period table's
  // opening/closing figures are that card's own numbers exactly (nothing
  // else feeds them) — so its sparkline can be marked at each period
  // boundary with those *exact* values, letting the chart's shape be read
  // directly against the table below it. Doesn't apply once a second card
  // or an asset is in the mix: the table would then be a combined total no
  // single card's own line matches.
  const periodMarkers = useMemo(() => {
    if (cards.length !== 1 || assets.length > 0 || periods.length === 0) return null;
    const values = new Map<string, number>();
    const dates = new Set<string>();
    for (const p of periods) {
      values.set(p.from, p.opening);
      dates.add(p.from);
    }
    const last = periods[periods.length - 1];
    values.set(last.to, last.closing);
    dates.add(last.to);
    return { values, dates };
  }, [cards.length, assets.length, periods]);

  // The same "current balance" snapshot the Balances tab shows, one row —
  // cards and other assets together, not split into separate sections —
  // read-only here (no type toggle, "Update balance" button, or history;
  // that stays the Balances tab's job).
  const cardSnapshots = useMemo(
    () =>
      cards.map((c) => {
        const history = cardBalanceHistory(c.type, c.transactions, c.checkpoints);
        // Merge in the period-boundary points (exact table values override
        // whatever this card's own history would otherwise show for that
        // date) so the marked dots are guaranteed to match the table, not
        // just closely track it.
        const merged = periodMarkers
          ? [...new Map([...history.map((p): [string, number] => [p.date, p.amount]), ...periodMarkers.values]).entries()]
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([date, amount]): NetWorthPoint => ({ date, amount }))
          : history;
        return {
          key: c.cardId,
          name: c.cardName,
          badge: c.type === 'credit' ? 'Credit' : 'Debit',
          computed: computeCardBalance(c.type, c.transactions, c.checkpoints),
          history: merged,
          markerDates: periodMarkers?.dates,
        };
      }),
    [cards, periodMarkers],
  );
  const assetSnapshots = useMemo(
    () =>
      assets.map((a) => {
        const kind = a.kind ?? 'asset';
        const ownHistory = assetValues
          .filter((v) => v.assetId === a.id)
          .sort((a1, b1) => (a1.date < b1.date ? -1 : a1.date > b1.date ? 1 : 0))
          .map((v): NetWorthPoint => ({ date: v.date, amount: signedAssetValue(kind, v.value) }));
        const latest = latestAssetValue(assetValues, a.id);
        return {
          key: a.id,
          name: a.name,
          badge: kind === 'liability' ? 'Liability' : 'Asset',
          amount: latest ? signedAssetValue(kind, latest.value) : null,
          freshness: latest ? `As of ${dayLabel(latest.date)}` : 'No value entered yet',
          history: ownHistory,
        };
      }),
    [assets, assetValues],
  );

  return (
    <div className="exec-page">
      {(cardSnapshots.length > 0 || assetSnapshots.length > 0) && (
        <section className="panel">
          <div className="balance-grid">
            {cardSnapshots.map((c) => (
              <BalanceSnapshotCard
                key={c.key}
                name={c.name}
                badge={c.badge}
                amount={c.computed.amount}
                freshness={freshnessLabel(c.computed)}
                history={c.history}
                markerDates={c.markerDates}
              />
            ))}
            {assetSnapshots.map((a) => (
              <BalanceSnapshotCard key={a.key} name={a.name} badge={a.badge} amount={a.amount} freshness={a.freshness} history={a.history} />
            ))}
          </div>
        </section>
      )}

      <div className="exec-view-controls">
        <p className="muted">{subtitle}</p>
        <div className="seg seg-sm">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              className={mode === m.key ? 'seg-on' : ''}
              onClick={() => setMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {salaryRuleNoMatchYet && (
        <p className="muted exec-caveat">
          Your salary rule (Settings → Preferences) hasn't matched a transaction yet — showing the
          standard monthly periods until it does.
        </p>
      )}

      {mode === 'custom' && (
        <div className="exec-view-controls">
          <p className="muted">Pick the exact start and end date for this report.</p>
          <div className="range-pickers">
            <label className="picker">
              <span className="picker-label">From</span>
              <input
                type="date"
                value={customFrom}
                max={todayISO()}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </label>
            <span className="range-dash">→</span>
            <label className="picker">
              <span className="picker-label">To</span>
              <input
                type="date"
                value={customTo}
                max={todayISO()}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </label>
          </div>
        </div>
      )}

      {periods.length === 0 ? (
        <section className="panel">
          <p className="muted">
            Import statements and set at least one card's balance (in the Balances tab) to see your
            Executive Summary.
          </p>
        </section>
      ) : (
        <section className="panel">
          {anyIncomplete && (
            <p className="muted exec-caveat">
              * One or more cards' balance early in some period couldn't be fully reconstructed (no
              statement balance or manual entry that far back) — the gap was treated as zero and
              folded into Sources or Uses rather than hidden.
            </p>
          )}
          <div className="table-wrap exec-table-wrap">
            <table className="data-table exec-table exec-table-wide">
              <thead>
                <tr>
                  <th>&nbsp;</th>
                  {periods.map((p) => (
                    <th key={p.period} className="num">
                      {p.label}
                      {p.period === currentPeriodKey && <span className="chip exec-current-chip">Current</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="exec-row-opening">
                  <td>Opening balance</td>
                  {periods.map((p) => (
                    <td key={p.period} className="num">
                      {money(p.opening, { compact: true })}
                    </td>
                  ))}
                </tr>
                <tr className="exec-row-total exec-row-sources">
                  <td>Sources of cash</td>
                  {periods.map((p) => (
                    <td key={p.period} className={`num ${p.sources.total > 0.005 ? 'pos' : 'muted'}`}>
                      {p.sources.total > 0.005 ? `+${money(p.sources.total, { compact: true })}` : '—'}
                    </td>
                  ))}
                </tr>
                <CategoryRankRows periods={periods} pick={(p) => p.sources} sign="+" />
                <tr className="exec-row-total exec-row-uses">
                  <td>Uses of cash</td>
                  {periods.map((p) => (
                    <td key={p.period} className={`num ${p.uses.total > 0.005 ? 'neg' : 'muted'}`}>
                      {p.uses.total > 0.005 ? `-${money(p.uses.total, { compact: true })}` : '—'}
                    </td>
                  ))}
                </tr>
                <CategoryRankRows periods={periods} pick={(p) => p.uses} sign="-" />
                {hasAssets && (
                  <tr>
                    <td>Change in asset values</td>
                    {periods.map((p) => (
                      <td key={p.period} className={`num ${p.assetChange === 0 ? 'muted' : p.assetChange > 0 ? 'pos' : 'neg'}`}>
                        {p.assetChange === 0 ? '—' : money(p.assetChange, { sign: true, compact: true })}
                      </td>
                    ))}
                  </tr>
                )}
                <tr className="exec-row-closing">
                  <td>Closing balance</td>
                  {periods.map((p) => (
                    <td key={p.period} className="num">
                      {money(p.closing, { compact: true })}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
