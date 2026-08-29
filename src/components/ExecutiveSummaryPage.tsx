import { useMemo, useState } from 'react';
import type { Transaction } from '../types';
import {
  buildExecutiveSummary,
  currentPeriodSummary,
  type CategoryBreakdown,
  type SummaryGranularity,
} from '../lib/executiveSummary';
import type { Asset, AssetValueEntry, BalanceCheckpoint, CardType } from '../lib/balances';
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

type PageView = 'period' | 'trend';

const PAGE_VIEWS: { key: PageView; label: string }[] = [
  { key: 'period', label: 'This period' },
  { key: 'trend', label: 'Trend' },
];

const GRANULARITIES: { key: SummaryGranularity; label: string }[] = [
  { key: 'month', label: 'Monthly' },
  { key: 'week', label: 'Weekly' },
];

/** The top-5-plus-"Other" rows under a Sources/Uses total row — see
 *  lib/executiveSummary.ts's categoryBreakdown for how the cap and the
 *  reconciling gap (folded into "Other" rather than shown separately) work. */
function CategorySubRows({ breakdown, sign }: { breakdown: CategoryBreakdown; sign: '+' | '-' }) {
  const rows = breakdown.otherTotal > 0.005 ? [...breakdown.top, { category: 'Other', amount: breakdown.otherTotal }] : breakdown.top;
  return (
    <>
      {rows.map((r) => {
        const pct = breakdown.total > 0 ? (r.amount / breakdown.total) * 100 : 0;
        return (
          <tr key={r.category} className="exec-subrow">
            <td>
              <span className="exec-subrow-label">
                <span className="catdot" style={{ background: categoryColor(r.category) }} />
                {r.category}
              </span>
            </td>
            <td className="num muted">
              {sign}
              {money(r.amount, { compact: true })} · {pct.toFixed(0)}%
            </td>
          </tr>
        );
      })}
    </>
  );
}

function ThisPeriodView({
  cards,
  cardCount,
  cardName,
  assets,
  assetValues,
  transactions,
  categoryOf,
  monthStartDay,
  weekStartDay,
  granularity,
}: Props & { granularity: SummaryGranularity }) {
  const summary = useMemo(
    () => currentPeriodSummary(cards, assets, assetValues, transactions, categoryOf, monthStartDay, weekStartDay, granularity),
    [cards, assets, assetValues, transactions, categoryOf, monthStartDay, weekStartDay, granularity],
  );

  if (!summary) {
    return (
      <section className="panel">
        <p className="muted">
          Import statements and set at least one card's balance (in the Balances tab) to see your
          Executive Summary.
        </p>
      </section>
    );
  }

  const hasAssets = assets.length > 0;
  const incomplete = !summary.openingComplete || !summary.closingComplete;
  const subtitle = cardName
    ? `For ${cardName}.`
    : `Combined across ${cardCount} card${cardCount === 1 ? '' : 's'}${hasAssets ? ' and your other tracked assets' : ''}.`;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{summary.label}</h2>
          <p className="muted">{subtitle}</p>
        </div>
      </div>
      {incomplete && (
        <p className="muted exec-caveat">
          * One or more cards' balance couldn't be fully reconstructed this far back (no statement
          balance or manual entry) — the gap was treated as zero and folded into Sources or Uses
          below rather than hidden.
        </p>
      )}
      <div className="table-wrap exec-table-wrap">
        <table className="data-table exec-table exec-period-table">
          <thead>
            <tr>
              <th>&nbsp;</th>
              <th className="num">{summary.label}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="exec-row-opening">
              <td>Opening balance</td>
              <td className="num">{money(summary.opening, { compact: true })}</td>
            </tr>
            <tr className="exec-row-total">
              <td>Sources of cash</td>
              <td className={`num ${summary.sources.total > 0.005 ? 'pos' : 'muted'}`}>
                {summary.sources.total > 0.005 ? `+${money(summary.sources.total, { compact: true })}` : '—'}
              </td>
            </tr>
            <CategorySubRows breakdown={summary.sources} sign="+" />
            <tr className="exec-row-total">
              <td>Uses of cash</td>
              <td className={`num ${summary.uses.total > 0.005 ? 'neg' : 'muted'}`}>
                {summary.uses.total > 0.005 ? `-${money(summary.uses.total, { compact: true })}` : '—'}
              </td>
            </tr>
            <CategorySubRows breakdown={summary.uses} sign="-" />
            {hasAssets && (
              <tr>
                <td>Change in asset values</td>
                <td className={`num ${summary.assetChange === 0 ? 'muted' : summary.assetChange > 0 ? 'pos' : 'neg'}`}>
                  {summary.assetChange === 0 ? '—' : money(summary.assetChange, { sign: true, compact: true })}
                </td>
              </tr>
            )}
            <tr className="exec-row-closing">
              <td>Closing balance</td>
              <td className="num">{money(summary.closing, { compact: true })}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TrendView({
  cards,
  assets,
  assetValues,
  transactions,
  monthStartDay,
  weekStartDay,
  granularity,
}: Props & { granularity: SummaryGranularity }) {
  const summary = useMemo(
    () => buildExecutiveSummary(cards, assets, assetValues, transactions, monthStartDay, weekStartDay, granularity),
    [cards, assets, assetValues, transactions, monthStartDay, weekStartDay, granularity],
  );

  if (!summary) {
    return (
      <section className="panel">
        <p className="muted">
          Import statements and set at least one card's balance (in the Balances tab) to see your
          Executive Summary.
        </p>
      </section>
    );
  }

  const { periods, anyIncomplete } = summary;
  const hasAssets = assets.length > 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Cash bridge</h2>
          <p className="muted">How the opening balance became the closing balance, {granularity === 'week' ? 'week' : 'month'} by {granularity === 'week' ? 'week' : 'month'}.</p>
        </div>
      </div>
      {anyIncomplete && (
        <p className="muted exec-caveat">
          * One or more cards' balance early in this window couldn't be reconstructed (no statement
          balance or manual entry that far back) and was treated as zero — folded into Sources or Uses
          of cash below (whichever direction it moved) rather than hidden.
        </p>
      )}
      <div className="table-wrap exec-table-wrap">
        <table className="data-table exec-table">
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
            <tr>
              <td>Sources of cash</td>
              {periods.map((p) => {
                const shown = p.sources + Math.max(p.other, 0);
                return (
                  <td key={p.period} className={`num ${shown > 0.005 ? 'pos' : 'muted'}`}>
                    {shown > 0.005 ? `+${money(shown, { compact: true })}` : '—'}
                  </td>
                );
              })}
            </tr>
            <tr>
              <td>Uses of cash</td>
              {periods.map((p) => {
                const shown = p.uses + Math.max(-p.other, 0);
                return (
                  <td key={p.period} className={`num ${shown > 0.005 ? 'neg' : 'muted'}`}>
                    {shown > 0.005 ? `-${money(shown, { compact: true })}` : '—'}
                  </td>
                );
              })}
            </tr>
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
  );
}

/**
 * The one report the rest of the app builds up to: what your cash position
 * was, broadly why it moved, and what it is now. Shows one card's own story
 * when a single card is active, or the full cross-card (plus tracked
 * assets) picture when "Combine all cards" is on. Two views: "This period"
 * (the default) for the current month/week's opening/closing and a
 * sources/uses category breakdown, and "Trend" for the multi-period bridge
 * table. See lib/executiveSummary.ts for how both are computed.
 */
export default function ExecutiveSummaryPage(props: Props) {
  const [pageView, setPageView] = useState<PageView>('period');
  const [granularity, setGranularity] = useState<SummaryGranularity>('month');

  return (
    <div className="exec-page">
      <div className="exec-view-controls">
        <div className="seg seg-sm">
          {PAGE_VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              className={pageView === v.key ? 'seg-on' : ''}
              onClick={() => setPageView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="seg seg-sm">
          {GRANULARITIES.map((g) => (
            <button
              key={g.key}
              type="button"
              className={granularity === g.key ? 'seg-on' : ''}
              onClick={() => setGranularity(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {pageView === 'period' ? (
        <ThisPeriodView {...props} granularity={granularity} />
      ) : (
        <TrendView {...props} granularity={granularity} />
      )}
    </div>
  );
}
