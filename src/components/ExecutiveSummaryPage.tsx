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

function CatRow({ category, amount, max, total }: { category: string; amount: number; max: number; total: number }) {
  const pct = total > 0 ? (amount / total) * 100 : 0;
  return (
    <div className="catrow">
      <div className="catrow-head">
        <span className="catname">
          <span className="catdot" style={{ background: categoryColor(category) }} />
          {category}
        </span>
        <span className="catamt">
          {money(amount)} <span className="muted">· {pct.toFixed(0)}%</span>
        </span>
      </div>
      <div className="catbar-track">
        <div
          className="catbar-fill"
          style={{ width: `${max > 0 ? (amount / max) * 100 : 0}%`, background: categoryColor(category) }}
        />
      </div>
    </div>
  );
}

/** Total up top, then the top 5 categories and an "Other" catch-all below —
 *  see lib/executiveSummary.ts's categoryBreakdown for how the cap and the
 *  reconciling gap (folded into "Other" rather than shown separately) work. */
function CategoryBreakdownPanel({
  title,
  subtitle,
  breakdown,
  tone,
  emptyLabel,
}: {
  title: string;
  subtitle: string;
  breakdown: CategoryBreakdown;
  tone: 'pos' | 'neg';
  emptyLabel: string;
}) {
  const rows = breakdown.otherTotal > 0.005 ? [...breakdown.top, { category: 'Other', amount: breakdown.otherTotal }] : breakdown.top;
  const max = rows.reduce((a, r) => Math.max(a, r.amount), 0);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          <p className="muted">{subtitle}</p>
        </div>
      </div>
      <div className={`exec-period-total ${tone}`}>{money(breakdown.total)}</div>
      {rows.length === 0 ? (
        <p className="muted">{emptyLabel}</p>
      ) : (
        <div className="catlist">
          {rows.map((r) => (
            <CatRow key={r.category} category={r.category} amount={r.amount} max={max} total={breakdown.total} />
          ))}
        </div>
      )}
    </section>
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
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{summary.label}</h2>
            <p className="muted">{subtitle}</p>
          </div>
        </div>
        <div className="explorer-stats">
          <div className="explorer-stat">
            <div className="explorer-stat-label">Opening balance</div>
            <div className="explorer-stat-value">{money(summary.opening)}</div>
          </div>
          <div className="explorer-stat">
            <div className="explorer-stat-label">Closing balance</div>
            <div className="explorer-stat-value">{money(summary.closing)}</div>
          </div>
          <div className="explorer-stat">
            <div className="explorer-stat-label">Net change</div>
            <div className={`explorer-stat-value ${summary.netChange >= 0 ? 'pos' : 'neg'}`}>
              {money(summary.netChange, { sign: true })}
            </div>
          </div>
          {hasAssets && (
            <div className="explorer-stat">
              <div className="explorer-stat-label">Asset value change</div>
              <div className={`explorer-stat-value ${summary.assetChange === 0 ? '' : summary.assetChange > 0 ? 'pos' : 'neg'}`}>
                {summary.assetChange === 0 ? '—' : money(summary.assetChange, { sign: true })}
              </div>
            </div>
          )}
        </div>
        {incomplete && (
          <p className="muted exec-caveat">
            * One or more cards' balance couldn't be fully reconstructed this far back (no statement
            balance or manual entry) — the gap was treated as zero and folded into Sources or Uses
            below rather than hidden.
          </p>
        )}
      </section>

      <div className="two-col">
        <CategoryBreakdownPanel
          title="Sources of cash"
          subtitle="This period's income, by category."
          breakdown={summary.sources}
          tone="pos"
          emptyLabel="No income this period."
        />
        <CategoryBreakdownPanel
          title="Uses of cash"
          subtitle="This period's spending, by category."
          breakdown={summary.uses}
          tone="neg"
          emptyLabel="No spending this period."
        />
      </div>
    </>
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
