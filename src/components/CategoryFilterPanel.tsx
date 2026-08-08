import { useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { categoryColor } from '../lib/categorize';
import { UNSORTED } from '../lib/subcategory';
import { isCategoryExcluded, isSubExcluded, type CategoryFilterState } from '../lib/categoryFilter';
import { captureIncluded, resolvePresetFilter, sameFilter, type CategoryFilterPreset } from '../lib/categoryFilterPresets';
import { money } from '../lib/format';

export interface Tagged {
  t: Transaction;
  cat: string;
}

/** Just enough of SubResolver for the filter panel — a full SubResolver
 *  satisfies this structurally, and the combined view (which has no single
 *  card's rules to build a real one from) can supply a lighter stand-in. */
export interface MiniSubResolver {
  subOf: (tx: Transaction, parent: string) => string;
  subsForParent: (parent: string) => string[];
}

// --- Show in charts & totals (category/sub visibility filter) ---------------

export default function CategoryFilterPanel({
  expenses,
  incomeTagged,
  sub,
  categoryFilter,
  onToggleCategoryFilter,
  onToggleSubFilter,
  presets,
  onSavePreset,
  onRenamePreset,
  onDeletePreset,
  onApplyPreset,
}: {
  expenses: Tagged[];
  incomeTagged: Tagged[];
  sub: MiniSubResolver;
  categoryFilter: CategoryFilterState;
  onToggleCategoryFilter: (category: string) => void;
  onToggleSubFilter: (category: string, subName: string) => void;
  /** Named, reusable filter snapshots — save the current selection, apply a
   *  saved one, rename or delete. Shared globally, not scoped to this card
   *  or view (see lib/categoryFilterPresets.ts). */
  presets: CategoryFilterPreset[];
  onSavePreset: (name: string, includedCategories: string[], includedSubs: Record<string, string[]>) => void;
  onRenamePreset: (id: string, name: string) => void;
  onDeletePreset: (id: string) => void;
  onApplyPreset: (filter: CategoryFilterState) => void;
}) {
  const categoryTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const x of expenses) totals.set(x.cat, (totals.get(x.cat) ?? 0) + -x.t.amount);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [expenses]);

  const incomeTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const x of incomeTagged) totals.set(x.cat, (totals.get(x.cat) ?? 0) + x.t.amount);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [incomeTagged]);

  const subTotalsFor = (category: string) => {
    const totals = new Map<string, number>();
    for (const x of expenses) {
      if (x.cat !== category) continue;
      const s = sub.subOf(x.t, category);
      if (s === UNSORTED) continue;
      totals.set(s, (totals.get(s) ?? 0) + -x.t.amount);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  };

  const hiddenChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    for (const c of categoryFilter.categories) {
      chips.push({ key: `cat:${c}`, label: c, onRemove: () => onToggleCategoryFilter(c) });
    }
    for (const [parent, subs] of Object.entries(categoryFilter.subs)) {
      for (const s of subs) {
        chips.push({
          key: `sub:${parent}:${s}`,
          label: `${parent} → ${s}`,
          onRemove: () => onToggleSubFilter(parent, s),
        });
      }
    }
    return chips;
  }, [categoryFilter, onToggleCategoryFilter, onToggleSubFilter]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (c: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  // The universe a preset's allow-list is resolved against — every category
  // (and, per category, every sub-category) currently known to this view,
  // whether or not it existed yet when a given preset was saved.
  const allCategories = useMemo(
    () => [...new Set([...categoryTotals.map(([c]) => c), ...incomeTotals.map(([c]) => c)])],
    [categoryTotals, incomeTotals],
  );

  const activePresetId = useMemo(
    () =>
      presets.find((p) => sameFilter(resolvePresetFilter(p, allCategories, sub.subsForParent), categoryFilter))
        ?.id ?? null,
    [presets, categoryFilter, allCategories, sub],
  );

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [creatingPreset, setCreatingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');

  const startRename = (p: CategoryFilterPreset) => {
    setRenamingId(p.id);
    setRenameValue(p.name);
  };
  const commitRename = () => {
    const id = renamingId;
    setRenamingId(null);
    if (!id) return;
    const name = renameValue.trim();
    if (name) onRenamePreset(id, name);
  };
  const commitNewPreset = () => {
    setCreatingPreset(false);
    const name = newPresetName.trim();
    if (!name) return;
    const { includedCategories, includedSubs } = captureIncluded(categoryFilter, allCategories, sub.subsForParent);
    onSavePreset(name, includedCategories, includedSubs);
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Show in charts &amp; totals</h2>
          <p className="muted">
            Uncheck anything that isn’t real spending (like a transfer to your own savings) to remove
            it from every chart, KPI, and total across the app — not just here.
          </p>
        </div>
      </div>

      <div className="filter-presets">
        <span className="muted filter-presets-label">Presets:</span>
        {presets.map((p) => (
          <div
            key={p.id}
            className={`filter-preset ${activePresetId === p.id ? 'filter-preset-active' : ''}`}
          >
            {renamingId === p.id ? (
              <input
                autoFocus
                className="filter-preset-rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
              />
            ) : (
              <button
                type="button"
                className="filter-preset-btn"
                title="Click to apply, double-click to rename"
                onClick={() => onApplyPreset(resolvePresetFilter(p, allCategories, sub.subsForParent))}
                onDoubleClick={() => startRename(p)}
              >
                {p.name}
              </button>
            )}
            <button
              type="button"
              className="filter-preset-del"
              title="Delete preset"
              onClick={() => onDeletePreset(p.id)}
            >
              ×
            </button>
          </div>
        ))}
        {creatingPreset ? (
          <input
            autoFocus
            className="filter-preset-rename-input"
            value={newPresetName}
            placeholder="Preset name…"
            onChange={(e) => setNewPresetName(e.target.value)}
            onBlur={commitNewPreset}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitNewPreset();
              if (e.key === 'Escape') setCreatingPreset(false);
            }}
          />
        ) : (
          <button
            type="button"
            className="filter-preset-add"
            onClick={() => {
              setNewPresetName('');
              setCreatingPreset(true);
            }}
          >
            + Save current
          </button>
        )}
      </div>

      {hiddenChips.length > 0 && (
        <div className="hidden-tray">
          <span className="muted hidden-tray-label">Hidden:</span>
          {hiddenChips.map((h) => (
            <button key={h.key} type="button" className="hidden-chip" onClick={h.onRemove}>
              {h.label} <span aria-hidden>✕</span>
            </button>
          ))}
        </div>
      )}

      <div className="filter-list">
        {categoryTotals.map(([cat, total]) => {
          const catExcluded = isCategoryExcluded(categoryFilter, cat);
          const subs = sub.subsForParent(cat);
          const hasSubs = subs.length > 0;
          const isExpanded = expanded.has(cat);
          return (
            <div key={cat} className="filter-row-group">
              <div className={`filter-row ${catExcluded ? 'filter-row-excluded' : ''}`}>
                <label className="filter-check">
                  <input
                    type="checkbox"
                    checked={!catExcluded}
                    onChange={() => onToggleCategoryFilter(cat)}
                  />
                </label>
                <span className="catdot" style={{ background: categoryColor(cat) }} />
                <span className="filter-name">{cat}</span>
                <span className="muted filter-total">{money(total)}</span>
                {hasSubs && (
                  <button
                    type="button"
                    className="linklike filter-expand"
                    onClick={() => toggleExpand(cat)}
                  >
                    {isExpanded ? 'hide subs' : `${subs.length} sub${subs.length === 1 ? '' : 's'}`}
                  </button>
                )}
              </div>
              {hasSubs && isExpanded && (
                <div className="filter-subs">
                  {subTotalsFor(cat).map(([s, subTotal]) => {
                    const subExcluded = isSubExcluded(categoryFilter, cat, s);
                    return (
                      <div
                        key={s}
                        className={`filter-row filter-subrow ${subExcluded ? 'filter-row-excluded' : ''}`}
                      >
                        <label className="filter-check">
                          <input
                            type="checkbox"
                            checked={!subExcluded}
                            disabled={catExcluded}
                            onChange={() => onToggleSubFilter(cat, s)}
                          />
                        </label>
                        <span
                          className="catdot"
                          style={{ background: categoryColor(`${cat}/${s}`) }}
                        />
                        <span className="filter-name">{s}</span>
                        <span className="muted filter-total">{money(subTotal)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {incomeTotals.length > 0 && (
        <>
          <h3 className="filter-income-head">Income categories</h3>
          <div className="filter-list">
            {incomeTotals.map(([cat, total]) => {
              const catExcluded = isCategoryExcluded(categoryFilter, cat);
              return (
                <div key={cat} className="filter-row-group">
                  <div className={`filter-row ${catExcluded ? 'filter-row-excluded' : ''}`}>
                    <label className="filter-check">
                      <input
                        type="checkbox"
                        checked={!catExcluded}
                        onChange={() => onToggleCategoryFilter(cat)}
                      />
                    </label>
                    <span className="catdot" style={{ background: categoryColor(cat) }} />
                    <span className="filter-name">{cat}</span>
                    <span className="muted filter-total pos">{money(total)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
