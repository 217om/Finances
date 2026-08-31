import { useEffect, useMemo, useState } from 'react';
import type { Transaction } from '../types';
import {
  buildCustomRangeSummary,
  buildPeriodBreakdowns,
  type CategoryAmount,
  type CategoryBreakdown,
  type PeriodSummary,
  type SummaryGranularity,
} from '../lib/executiveSummary';
import type { Asset, AssetValueEntry, BalanceCheckpoint, CardType } from '../lib/balances';
import { todayISO } from '../lib/budget';
import { categoryColor } from '../lib/categorize';
import { money } from '../lib/format';

interface CardInput {
  type: CardType;
  transactions: Transaction[];
  checkpoints: BalanceCheckpoint[];
}

interface Props {
  cards: CardInput[];
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

  return (
    <>
      {Array.from({ length: rowCount }).map((_, i) => (
        <tr key={i} className="exec-subrow">
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
        : buildPeriodBreakdowns(cards, assets, assetValues, transactions, categoryOf, monthStartDay, weekStartDay, mode),
    [cards, assets, assetValues, transactions, categoryOf, monthStartDay, weekStartDay, mode],
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

  return (
    <div className="exec-page">
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
                <tr className="exec-row-total">
                  <td>Sources of cash</td>
                  {periods.map((p) => (
                    <td key={p.period} className={`num ${p.sources.total > 0.005 ? 'pos' : 'muted'}`}>
                      {p.sources.total > 0.005 ? `+${money(p.sources.total, { compact: true })}` : '—'}
                    </td>
                  ))}
                </tr>
                <CategoryRankRows periods={periods} pick={(p) => p.sources} sign="+" />
                <tr className="exec-row-total">
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
