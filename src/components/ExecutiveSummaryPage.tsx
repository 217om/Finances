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
  /** Set when showing a single card's own story (not "Combine all cards") —
   *  swaps the subtitle to name that card instead of talking about a count. */
  cardName?: string;
  assets: Asset[];
  assetValues: AssetValueEntry[];
  transactions: Transaction[];
  monthStartDay: number;
  weekStartDay: number;
}

const GRANULARITIES: { key: SummaryGranularity; label: string }[] = [
  { key: 'month', label: 'Monthly' },
  { key: 'week', label: 'Weekly' },
];

/**
 * The one report the rest of the app builds up to: what your cash position
 * was, broadly why it moved, and what it is now. Shows one card's own story
 * when a single card is active, or the full cross-card (plus tracked
 * assets) picture when "Combine all cards" is on. See
 * lib/executiveSummary.ts for how the bridge (and its reconciling "other"
 * amount, folded straight into Sources/Uses below rather than shown on its
 * own line) is computed.
 */
export default function ExecutiveSummaryPage({
  cards,
  cardCount,
  cardName,
  assets,
  assetValues,
  transactions,
  monthStartDay,
  weekStartDay,
}: Props) {
  const [granularity, setGranularity] = useState<SummaryGranularity>('month');

  const summary = useMemo(
    () => buildExecutiveSummary(cards, assets, assetValues, transactions, monthStartDay, weekStartDay, granularity),
    [cards, assets, assetValues, transactions, monthStartDay, weekStartDay, granularity],
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
  const periodWord = granularity === 'week' ? 'weeks' : 'months';
  const subtitle = cardName
    ? `Trailing ${periods.length} ${periodWord} for ${cardName}.`
    : `Trailing ${periods.length} ${periodWord}, combined across ${cardCount} card${cardCount === 1 ? '' : 's'}${hasAssets ? ' and your other tracked assets' : ''}.`;

  return (
    <div className="exec-page">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Executive Summary</h2>
            <p className="muted">{subtitle}</p>
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
            balance or manual entry that far back) and was treated as zero — folded into Sources or Uses
            of cash below (whichever direction it moved) rather than hidden.
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
                {periods.map((p) => {
                  // Any unreconciled gap (see lib/executiveSummary.ts's "other")
                  // is folded straight in here when it moved the balance up,
                  // rather than shown on its own separate line.
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
    </div>
  );
}
