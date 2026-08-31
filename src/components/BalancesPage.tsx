import { useMemo, useState } from 'react';
import type { Transaction } from '../types';
import {
  cardBalanceHistory,
  computeCardBalance,
  latestAssetValue,
  netWorthHistory,
  signedAssetValue,
  type Asset,
  type AssetKind,
  type AssetValueEntry,
  type BalanceCheckpoint,
  type CardType,
  type ComputedBalance,
  type NetWorthPoint,
} from '../lib/balances';
import { todayISO } from '../lib/budget';
import { dayLabel, money } from '../lib/format';
import NetWorthChart from './NetWorthChart';
import Sparkline from './Sparkline';

export interface CardBalanceRow {
  cardId: string;
  cardName: string;
  currency: string;
  type: CardType;
  transactions: Transaction[];
  checkpoints: BalanceCheckpoint[];
}

interface Props {
  cards: CardBalanceRow[];
  assets: Asset[];
  assetValues: AssetValueEntry[];
  onSetCardType: (cardId: string, type: CardType) => void;
  onAddCheckpoint: (cardId: string, date: string, balance: number) => void;
  onDeleteCheckpoint: (cardId: string, checkpointId: string) => void;
  onCreateAsset: (name: string) => void;
  onRenameAsset: (id: string, name: string) => void;
  onSetAssetKind: (id: string, kind: AssetKind) => void;
  onDeleteAsset: (id: string) => void;
  onAddAssetValue: (assetId: string, date: string, value: number) => void;
  onDeleteAssetValue: (id: string) => void;
}

export function freshnessLabel(computed: ComputedBalance): string {
  if (computed.amount === null) return 'No balance entered yet';
  const asOf = dayLabel(computed.asOf!);
  if (computed.sinceCount === 0) {
    return computed.fromCheckpoint ? `As of ${asOf}, from your entry` : `As of ${asOf}, from the statement`;
  }
  const word = computed.sinceCount === 1 ? 'transaction' : 'transactions';
  return computed.fromCheckpoint
    ? `Estimated: your ${asOf} entry + ${computed.sinceCount} ${word} since`
    : `Estimated: the ${asOf} statement balance + ${computed.sinceCount} ${word} since`;
}

/** Read-only counterpart to CardBalanceCard/AssetRow below — same card look
 *  (name, amount, freshness, sparkline), but no edit affordances (type
 *  toggle, "Update balance", history). Used by the Executive Summary's
 *  balance row, where this page's own editing tools would be out of place —
 *  managing balances stays this tab's job. */
export function BalanceSnapshotCard({
  name,
  badge,
  amount,
  freshness,
  history,
  markerDates,
}: {
  name: string;
  badge: string;
  amount: number | null;
  freshness: string;
  history: NetWorthPoint[];
  /** See Sparkline's markerDates — only meaningful when `history`'s values
   *  are known to line up exactly with whatever table these dates come
   *  from (e.g. a single card with no other assets in the picture). */
  markerDates?: Set<string>;
}) {
  return (
    <div className="balance-card">
      <div className="balance-card-head">
        <span className="balance-card-name">{name}</span>
        <span className="chip">{badge}</span>
      </div>
      <div className={`balance-amount ${amount === null ? '' : amount >= 0 ? 'pos' : 'neg'}`}>
        {amount === null ? '—' : money(amount)}
      </div>
      <div className="muted balance-freshness">{freshness}</div>
      {history.length >= 2 && (
        <Sparkline points={history} positive={amount === null || amount >= 0} markerDates={markerDates} />
      )}
    </div>
  );
}

/** A small date + amount form, used both for a card's balance checkpoint and
 *  an asset's value update. */
function AmountEntryForm({
  amountLabel,
  allowNegative,
  onSubmit,
  onCancel,
}: {
  amountLabel: string;
  allowNegative: boolean;
  onSubmit: (date: string, amount: number) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(todayISO());
  const [text, setText] = useState('');
  const n = Number(text);
  const valid = text.trim() !== '' && Number.isFinite(n) && (allowNegative || n >= 0);

  return (
    <div className="balance-entry-form">
      <label className="picker">
        <span className="picker-label">Date</span>
        <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="picker">
        <span className="picker-label">{amountLabel}</span>
        <input
          type="number"
          step="0.01"
          min={allowNegative ? undefined : 0}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid) onSubmit(date, n);
            if (e.key === 'Escape') onCancel();
          }}
        />
      </label>
      <div className="balance-entry-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!valid}
          onClick={() => onSubmit(date, n)}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function CardBalanceCard({
  card,
  computed,
  onSetType,
  onAddCheckpoint,
  onDeleteCheckpoint,
}: {
  card: CardBalanceRow;
  computed: ComputedBalance;
  onSetType: (type: CardType) => void;
  onAddCheckpoint: (date: string, balance: number) => void;
  onDeleteCheckpoint: (id: string) => void;
}) {
  const [entering, setEntering] = useState(false);
  const sortedCheckpoints = useMemo(
    () => [...card.checkpoints].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [card.checkpoints],
  );
  const history = useMemo(
    () => cardBalanceHistory(card.type, card.transactions, card.checkpoints),
    [card.type, card.transactions, card.checkpoints],
  );

  return (
    <div className="balance-card">
      <div className="balance-card-head">
        <span className="balance-card-name">{card.cardName}</span>
        <div className="seg seg-sm">
          <button
            type="button"
            className={card.type === 'debit' ? 'seg-on' : ''}
            onClick={() => onSetType('debit')}
          >
            Debit
          </button>
          <button
            type="button"
            className={card.type === 'credit' ? 'seg-on' : ''}
            onClick={() => onSetType('credit')}
          >
            Credit
          </button>
        </div>
      </div>

      <div className={`balance-amount ${computed.amount === null ? '' : computed.amount >= 0 ? 'pos' : 'neg'}`}>
        {computed.amount === null ? '—' : money(computed.amount)}
      </div>
      <div className="muted balance-freshness">{freshnessLabel(computed)}</div>
      {history.length >= 2 && <Sparkline points={history} positive={computed.amount === null || computed.amount >= 0} />}

      {entering ? (
        <AmountEntryForm
          amountLabel={card.type === 'credit' ? 'How much do you currently owe?' : 'Current balance'}
          allowNegative={card.type === 'debit'}
          onSubmit={(date, amount) => {
            onAddCheckpoint(date, amount);
            setEntering(false);
          }}
          onCancel={() => setEntering(false)}
        />
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEntering(true)}>
          Update balance
        </button>
      )}

      {sortedCheckpoints.length > 0 && (
        <details className="balance-history">
          <summary>History ({sortedCheckpoints.length})</summary>
          <ul className="balance-history-list">
            {sortedCheckpoints.map((cp) => (
              <li key={cp.id}>
                <span>{dayLabel(cp.date)}</span>
                <span>{money(cp.balance)}</span>
                <button
                  type="button"
                  className="linklike balance-history-remove"
                  onClick={() => onDeleteCheckpoint(cp.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function AssetRow({
  asset,
  history,
  onRename,
  onSetKind,
  onDelete,
  onAddValue,
  onDeleteValue,
}: {
  asset: Asset;
  history: AssetValueEntry[];
  onRename: (name: string) => void;
  onSetKind: (kind: AssetKind) => void;
  onDelete: () => void;
  onAddValue: (date: string, value: number) => void;
  onDeleteValue: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [nameText, setNameText] = useState(asset.name);
  const [entering, setEntering] = useState(false);
  const kind: AssetKind = asset.kind ?? 'asset';

  const sorted = useMemo(
    () => [...history].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [history],
  );
  const latest = sorted[0] ?? null;
  const signedLatest = latest ? signedAssetValue(kind, latest.value) : null;

  const commitName = () => {
    setRenaming(false);
    if (nameText.trim() && nameText.trim() !== asset.name) onRename(nameText);
    else setNameText(asset.name);
  };

  return (
    <div className="balance-card">
      <div className="balance-card-head">
        {renaming ? (
          <input
            autoFocus
            className="budget-name-input"
            value={nameText}
            onChange={(e) => setNameText(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') {
                setNameText(asset.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <button type="button" className="balance-card-name linklike" onClick={() => setRenaming(true)}>
            {asset.name}
          </button>
        )}
        <button type="button" className="budget-remove" title="Delete this asset" onClick={onDelete}>
          ✕
        </button>
      </div>
      <div className="seg seg-sm">
        <button type="button" className={kind === 'asset' ? 'seg-on' : ''} onClick={() => onSetKind('asset')}>
          Asset
        </button>
        <button type="button" className={kind === 'liability' ? 'seg-on' : ''} onClick={() => onSetKind('liability')}>
          Liability
        </button>
      </div>

      <div className={`balance-amount ${signedLatest === null ? '' : signedLatest >= 0 ? 'pos' : 'neg'}`}>
        {signedLatest === null ? '—' : money(signedLatest)}
      </div>
      <div className="muted balance-freshness">{latest ? `As of ${dayLabel(latest.date)}` : 'No value entered yet'}</div>

      {entering ? (
        <AmountEntryForm
          amountLabel={kind === 'liability' ? 'How much do you owe on this?' : 'Value'}
          allowNegative={kind === 'asset'}
          onSubmit={(date, value) => {
            onAddValue(date, value);
            setEntering(false);
          }}
          onCancel={() => setEntering(false)}
        />
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEntering(true)}>
          Update value
        </button>
      )}

      {sorted.length > 0 && (
        <details className="balance-history">
          <summary>History ({sorted.length})</summary>
          <ul className="balance-history-list">
            {sorted.map((e) => (
              <li key={e.id}>
                <span>{dayLabel(e.date)}</span>
                <span>{money(e.value)}</span>
                <button type="button" className="linklike balance-history-remove" onClick={() => onDeleteValue(e.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Latest balance per card (debit balances shown as-is, credit balances shown
 * as debt), plus free-form assets and the net worth they combine into. A
 * card's balance is computed from whatever running-balance data its
 * statements included and any manual checkpoints entered here — see
 * lib/balances.ts.
 */
export default function BalancesPage({
  cards,
  assets,
  assetValues,
  onSetCardType,
  onAddCheckpoint,
  onDeleteCheckpoint,
  onCreateAsset,
  onRenameAsset,
  onSetAssetKind,
  onDeleteAsset,
  onAddAssetValue,
  onDeleteAssetValue,
}: Props) {
  const [newAssetName, setNewAssetName] = useState('');
  const [creatingAsset, setCreatingAsset] = useState(false);

  const computedByCard = useMemo(
    () =>
      cards.map((c) => ({
        card: c,
        computed: computeCardBalance(c.type, c.transactions, c.checkpoints),
      })),
    [cards],
  );

  const mixedCurrency = useMemo(() => new Set(cards.map((c) => c.currency)).size > 1, [cards]);
  const anyUnknown = computedByCard.some((c) => c.computed.amount === null);

  const totalCardBalances = computedByCard.reduce((a, c) => a + (c.computed.amount ?? 0), 0);
  const totalAssetValues = assets.reduce((a, asset) => {
    const latest = latestAssetValue(assetValues, asset.id);
    return a + (latest ? signedAssetValue(asset.kind, latest.value) : 0);
  }, 0);
  const netWorth = totalCardBalances + totalAssetValues;

  const history = useMemo(() => netWorthHistory(cards, assets, assetValues), [cards, assets, assetValues]);

  const commitNewAsset = () => {
    setCreatingAsset(false);
    const name = newAssetName.trim();
    setNewAssetName('');
    if (name) onCreateAsset(name);
  };

  return (
    <div className="balances-page">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Balances</h2>
            <p className="muted">Latest balance per card, plus any other assets you track.</p>
          </div>
        </div>

        <div className="explorer-stats balance-stats">
          <div className="explorer-stat">
            <div className="explorer-stat-label">Net worth</div>
            <div className={`explorer-stat-value ${netWorth >= 0 ? 'pos' : 'neg'}`}>{money(netWorth)}</div>
          </div>
          <div className="explorer-stat">
            <div className="explorer-stat-label">Cards</div>
            <div className={`explorer-stat-value ${totalCardBalances >= 0 ? 'pos' : 'neg'}`}>
              {money(totalCardBalances)}
            </div>
          </div>
          <div className="explorer-stat">
            <div className="explorer-stat-label">Other assets</div>
            <div className={`explorer-stat-value ${totalAssetValues >= 0 ? 'pos' : 'neg'}`}>
              {money(totalAssetValues)}
            </div>
          </div>
        </div>
        {(mixedCurrency || anyUnknown) && (
          <p className="muted balance-caveat">
            {mixedCurrency && 'Cards use different currencies, so this total mixes units. '}
            {anyUnknown && 'One or more balances are unknown and counted as zero until you enter one.'}
          </p>
        )}
        <div className="balance-chart">
          <NetWorthChart points={history} />
        </div>
      </section>

      <section className="panel balance-cards-panel">
        <h3>Cards</h3>
        <div className="balance-grid">
          {computedByCard.map(({ card, computed }) => (
            <CardBalanceCard
              key={card.cardId}
              card={card}
              computed={computed}
              onSetType={(type) => onSetCardType(card.cardId, type)}
              onAddCheckpoint={(date, balance) => onAddCheckpoint(card.cardId, date, balance)}
              onDeleteCheckpoint={(id) => onDeleteCheckpoint(card.cardId, id)}
            />
          ))}
        </div>
      </section>

      <section className="panel balance-assets-panel">
        <div className="panel-head">
          <h3>Other assets</h3>
        </div>
        {assets.length === 0 && !creatingAsset && (
          <p className="muted">No assets yet.</p>
        )}
        <div className="balance-grid">
          {assets.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              history={assetValues.filter((v) => v.assetId === asset.id)}
              onRename={(name) => onRenameAsset(asset.id, name)}
              onSetKind={(kind) => onSetAssetKind(asset.id, kind)}
              onDelete={() => onDeleteAsset(asset.id)}
              onAddValue={(date, value) => onAddAssetValue(asset.id, date, value)}
              onDeleteValue={(id) => onDeleteAssetValue(id)}
            />
          ))}
        </div>
        <div className="budget-add-row">
          {creatingAsset ? (
            <input
              autoFocus
              className="budget-name-input"
              placeholder="Asset name…"
              value={newAssetName}
              onChange={(e) => setNewAssetName(e.target.value)}
              onBlur={commitNewAsset}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNewAsset();
                if (e.key === 'Escape') {
                  setCreatingAsset(false);
                  setNewAssetName('');
                }
              }}
            />
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreatingAsset(true)}>
              + New asset
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
