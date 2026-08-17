import { useState } from 'react';
import type { Card } from '../lib/cards';

export interface CopyOptions {
  rules: boolean;
  keywords: boolean;
  subRules: boolean;
}

interface Props {
  cards: Card[];
  activeCardId: string;
  busy: boolean;
  onSwitch: (id: string) => void;
  onCreate: (name: string, copyFromId: string | null, opts: CopyOptions) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

/**
 * Add/switch/rename/delete cards (separate accounts to analyze). Each card
 * keeps its own transactions, category rules, and filters — nothing mixes —
 * but a new card can optionally start from an existing card's categorization
 * (signature rules, keyword rules, sub-category rules, custom categories).
 */
export default function CardManager({
  cards,
  activeCardId,
  busy,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newName, setNewName] = useState('');
  const [copyFrom, setCopyFrom] = useState<string>('');
  const [copyOpts, setCopyOpts] = useState<CopyOptions>({
    rules: true,
    keywords: true,
    subRules: true,
  });

  const startRename = (c: Card) => {
    setRenamingId(c.id);
    setRenameValue(c.name);
  };

  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRename(renamingId, renameValue.trim());
    setRenamingId(null);
  };

  const create = () => {
    if (!newName.trim()) return;
    onCreate(newName, copyFrom || null, copyOpts);
    setNewName('');
    setCopyFrom('');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="wiz-head">
          <div>
            <h2>Cards</h2>
            <p className="muted">Each card is a separate account with its own transactions and filters.</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="card-list">
          {cards.map((c) => {
            const isActive = c.id === activeCardId;
            return (
              <div
                key={c.id}
                className={`card-row ${isActive ? 'card-row-active' : 'card-row-switchable'}`}
                title={isActive ? undefined : `Switch to ${c.name}`}
                onClick={() => {
                  if (!isActive && renamingId !== c.id) onSwitch(c.id);
                }}
              >
                {renamingId === c.id ? (
                  <input
                    autoFocus
                    className="card-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onBlur={commitRename}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="card-name" title={c.name}>
                    {c.name}
                    {isActive && <span className="card-active-tag">current</span>}
                  </span>
                )}
                <div className="card-row-actions" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => startRename(c)}>
                    Rename
                  </button>
                  {cards.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-danger"
                      onClick={() => onDelete(c.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="card-add">
          <h3>Add a new card</h3>
          <label className="picker">
            <span className="picker-label">Name</span>
            <input
              value={newName}
              placeholder="e.g. Visa Platinum"
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
          <label className="picker">
            <span className="picker-label">Carry over categorization from</span>
            <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">Start fresh, no copying</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {copyFrom && (
            <div className="card-copy-opts">
              <label className="filter-check">
                <input
                  type="checkbox"
                  checked={copyOpts.rules}
                  onChange={(e) => setCopyOpts((o) => ({ ...o, rules: e.target.checked }))}
                />
                Category rules (grouped merchants)
              </label>
              <label className="filter-check">
                <input
                  type="checkbox"
                  checked={copyOpts.keywords}
                  onChange={(e) => setCopyOpts((o) => ({ ...o, keywords: e.target.checked }))}
                />
                Keyword refinement rules
              </label>
              <label className="filter-check">
                <input
                  type="checkbox"
                  checked={copyOpts.subRules}
                  onChange={(e) => setCopyOpts((o) => ({ ...o, subRules: e.target.checked }))}
                />
                Sub-category rules
              </label>
              <p className="muted card-copy-note">
                Only the rules above are copied, not transactions. Custom categories are shared by every
                card already.
              </p>
            </div>
          )}

          <button type="button" className="btn btn-primary" disabled={!newName.trim() || busy} onClick={create}>
            {busy ? 'Creating…' : 'Create card'}
          </button>
        </div>
      </div>
    </div>
  );
}
