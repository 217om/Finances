import { useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { buildExecutiveSummary, type SummaryGranularity } from '../lib/executiveSummary';
import type { Asset, AssetValueEntry, BalanceCheckpoint, CardType } from '../lib/balances';
import { money } from '../lib/format';

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
  monthStartDay: number;
  weekStartDay: number;
}

const GRANULARITIES: { key: SummaryGranularity; label: string }[] = [
  { key: 'month', label: 'Monthly' },
  { key: 'week', label: 'Weekly' },
];

/**
 * The one report the rest of the app builds up to: what your cash position
 * was, broadly why it moved, and what it is now — combined across every
 * card (and any other tracked assets), trailing several months or weeks.
 * See lib/executiveSummary.ts for how the bridge and its "other" reconciling
 * line are computed.
 */
export default function ExecutiveSummaryPage({
  cards,
  cardCount,
  assets,
  assetValues,
  combinedTransactions,
  monthStartDay,
  weekStartDay,
}: Props) {
  const [granularity, setGranularity] = useState<SummaryGranularity>('month');

  const summary = useMemo(
    () => buildExecutiveSummary(cards, assets, assetValues, combinedTransactions, monthStartDay, weekStartDay, granularity),
    [cards, assets, assetValues, combinedTransactions, monthStartDay, weekStartDay, granularity],
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

  const { periods, opening, closing, netChange, anyIncomplete } = summary;
  const hasAssets = assets.length > 0;
  const hasOther = periods.some((p) => Math.abs(p.other) > 1);
  const periodWord = granularity === 'week' ? 'weeks' : 'months';

  return (
    <div className="exec-page">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Executive Summary</h2>
            <p className="muted">
              Trailing {periods.length} {periodWord}, combined across {cardCount} card{cardCount === 1 ? '' : 's'}
              {hasAssets ? ' and your other tracked assets' : ''}.
            </p>
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

        <div className="exec-headline">
          <div className="exec-headline-stat">
            <div className="exec-headline-label">Opening balance</div>
            <div className="exec-headline-value">{money(opening)}</div>
            <div className="muted exec-headline-caption">{periods[0].label} start</div>
          </div>
          <div className="exec-headline-div" aria-hidden />
          <div className="exec-headline-stat">
            <div className="exec-headline-label">Net change</div>
            <div className={`exec-headline-value ${netChange >= 0 ? 'pos' : 'neg'}`}>
              {money(netChange, { sign: true })}
            </div>
            <div className="muted exec-headline-caption">over {periods.length} {periodWord}</div>
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
            <p className="muted">How the opening balance became the closing balance, {granularity === 'week' ? 'week' : 'month'} by {granularity === 'week' ? 'week' : 'month'}.</p>
          </div>
        </div>
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
    </div>
  );
}
