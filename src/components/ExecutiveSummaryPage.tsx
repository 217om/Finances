import { useMemo } from 'react';
import type { Transaction } from '../types';
import { buildExecutiveSummary, type CategoryAmount } from '../lib/executiveSummary';
import type { Asset, AssetValueEntry, BalanceCheckpoint, CardType } from '../lib/balances';
import { categoryColor } from '../lib/categorize';
import { money, monthLabel } from '../lib/format';

interface CardInput {
  type: CardType;
  transactions: Transaction[];
  checkpoints: BalanceCheckpoint[];
}

interface Props {
  cards: CardInput[];
  cardCount: number;
  assets: Asset[];
  assetValues: AssetValueEntry[];
  combinedTransactions: Transaction[];
  categoryOf: (tx: Transaction) => string;
  monthStartDay: number;
}

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

function CategoryList({ rows, total, emptyLabel }: { rows: CategoryAmount[]; total: number; emptyLabel: string }) {
  if (rows.length === 0) return <p className="muted">{emptyLabel}</p>;
  const max = rows[0].amount;
  return (
    <div className="catlist">
      {rows.map((r) => (
        <CatRow key={r.category} category={r.category} amount={r.amount} max={max} total={total} />
      ))}
    </div>
  );
}

/**
 * The one report the rest of the app builds up to: what your cash position
 * was, broadly why it moved, and what it is now — combined across every
 * card (and any other tracked assets), trailing several pay-cycle months.
 * See lib/executiveSummary.ts for how the bridge and its "other" reconciling
 * line are computed.
 */
export default function ExecutiveSummaryPage({
  cards,
  cardCount,
  assets,
  assetValues,
  combinedTransactions,
  categoryOf,
  monthStartDay,
}: Props) {
  const summary = useMemo(
    () => buildExecutiveSummary(cards, assets, assetValues, combinedTransactions, categoryOf, monthStartDay),
    [cards, assets, assetValues, combinedTransactions, categoryOf, monthStartDay],
  );

  if (!summary) {
    return (
      <div className="exec-page">
        <section className="panel">
          <p className="muted">
            Import statements and set at least one card's balance (in the Balances tab) to see your
            Executive Summary.
          </p>
        </section>
      </div>
    );
  }

  const { periods, opening, closing, netChange, sourceCategories, useCategories, anyIncomplete } = summary;
  const hasAssets = assets.length > 0;
  const hasOther = periods.some((p) => Math.abs(p.other) > 1);

  return (
    <div className="exec-page">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Executive Summary</h2>
            <p className="muted">
              Trailing {periods.length} months, combined across {cardCount} card{cardCount === 1 ? '' : 's'}
              {hasAssets ? ' and your other tracked assets' : ''}.
            </p>
          </div>
        </div>

        <div className="exec-headline">
          <div className="exec-headline-stat">
            <div className="exec-headline-label">Opening balance</div>
            <div className="exec-headline-value">{money(opening)}</div>
            <div className="muted exec-headline-caption">{monthLabel(periods[0].period)} start</div>
          </div>
          <div className="exec-headline-div" aria-hidden />
          <div className="exec-headline-stat">
            <div className="exec-headline-label">Net change</div>
            <div className={`exec-headline-value ${netChange >= 0 ? 'pos' : 'neg'}`}>
              {money(netChange, { sign: true })}
            </div>
            <div className="muted exec-headline-caption">over {periods.length} months</div>
          </div>
          <div className="exec-headline-div" aria-hidden />
          <div className="exec-headline-stat">
            <div className="exec-headline-label">Closing balance</div>
            <div className="exec-headline-value">{money(closing)}</div>
            <div className="muted exec-headline-caption">as of today</div>
          </div>
        </div>

        {anyIncomplete && (
          <p className="muted exec-caveat">
            * One or more cards' balance early in this window couldn't be reconstructed (no statement
            balance or manual entry that far back) and was treated as zero — folded into "Other /
            unexplained" below rather than hidden.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Cash bridge</h2>
            <p className="muted">How the opening balance became the closing balance, month by month.</p>
          </div>
        </div>
        <div className="table-wrap exec-table-wrap">
          <table className="data-table exec-table">
            <thead>
              <tr>
                <th>&nbsp;</th>
                {periods.map((p) => (
                  <th key={p.period} className="num">
                    {monthLabel(p.period)}
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
                {periods.map((p) => (
                  <td key={p.period} className={`num ${p.sources > 0 ? 'pos' : 'muted'}`}>
                    {p.sources > 0 ? `+${money(p.sources, { compact: true })}` : '—'}
                  </td>
                ))}
              </tr>
              <tr>
                <td>Uses of cash</td>
                {periods.map((p) => (
                  <td key={p.period} className={`num ${p.uses > 0 ? 'neg' : 'muted'}`}>
                    {p.uses > 0 ? `-${money(p.uses, { compact: true })}` : '—'}
                  </td>
                ))}
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
              {hasOther && (
                <tr>
                  <td className="muted">Other / unexplained</td>
                  {periods.map((p) => (
                    <td key={p.period} className="num muted">
                      {Math.abs(p.other) > 1 ? money(p.other, { sign: true, compact: true }) : '—'}
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

      <div className="two-col">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Top sources</h2>
              <p className="muted">This window's income, by category.</p>
            </div>
          </div>
          <CategoryList rows={sourceCategories} total={summary.totalSources} emptyLabel="No income in this window." />
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Top uses</h2>
              <p className="muted">This window's spending, by category.</p>
            </div>
          </div>
          <CategoryList rows={useCategories} total={summary.totalUses} emptyLabel="No spending in this window." />
        </section>
      </div>
    </div>
  );
}
