import { useMemo, useState } from 'react';
import type { CategoryOverride, CategoryRule, Transaction } from '../types';
import type { TxGroup } from '../lib/grouping';
import { EXPENSE_CATEGORIES, categoryColor } from '../lib/categorize';
import { money } from '../lib/format';
import CategoryPicker from './CategoryPicker';

interface Props {
  groups: TxGroup[];
  leftovers: Transaction[];
  customCategories: string[];
  onCreateCategory: (name: string) => void;
  onComplete: (rules: CategoryRule[], overrides: CategoryOverride[]) => void;
  onClose: () => void;
}

const KEEP = '__keep__';

/**
 * Guided categorization. The user walks one merchant group at a time: uncheck
 * any transactions that don't belong, pick a single category for the rest, and
 * continue. A final step quick-classifies the leftovers. Choices are returned
 * as rules (auto-applied to future imports) and per-transaction overrides.
 */
export default function CategorizeWizard({
  groups,
  leftovers,
  customCategories,
  onCreateCategory,
  onComplete,
  onClose,
}: Props) {
  const [step, setStep] = useState(0);

  // Built-in categories plus any the user has created (de-duplicated).
  const categoryOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of [...EXPENSE_CATEGORIES, ...customCategories]) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    return out;
  }, [customCategories]);

  // Accumulated decisions.
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [overrides, setOverrides] = useState<CategoryOverride[]>([]);
  const [extraLeftovers, setExtraLeftovers] = useState<Transaction[]>([]);

  const onLeftoverStep = step >= groups.length;
  const group = groups[step];

  // Per-group working state.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState('');
  const [groupKey, setGroupKey] = useState(-1);
  // Re-initialize working state whenever we land on a new group.
  if (!onLeftoverStep && groupKey !== step) {
    setGroupKey(step);
    setExcluded(new Set());
    setCategory(group.suggested);
  }

  const includedCount = group ? group.txs.length - excluded.size : 0;

  const toggle = (id: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyGroup = () => {
    const excludedIds = [...excluded];
    const newRule: CategoryRule = {
      signature: group.signature,
      category,
      excludedIds,
      sample: group.label,
      createdAt: Date.now(),
    };
    setRules((r) => [...r, newRule]);
    // Excluded transactions fall through to the leftovers step.
    if (excludedIds.length) {
      const excludedTxs = group.txs.filter((t) => excluded.has(t.id));
      setExtraLeftovers((e) => [...e, ...excludedTxs]);
    }
    setStep((s) => s + 1);
  };

  const skipGroup = () => setStep((s) => s + 1);

  // --- Leftovers step ---------------------------------------------------------
  const allLeftovers = useMemo(() => {
    const seen = new Set<string>();
    const out: Transaction[] = [];
    for (const t of [...extraLeftovers, ...leftovers]) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        out.push(t);
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [extraLeftovers, leftovers]);

  const [leftoverPick, setLeftoverPick] = useState<Record<string, string>>({});

  const finish = (extraOverrides: CategoryOverride[] = []) => {
    onComplete(rules, [...overrides, ...extraOverrides]);
  };

  const finishLeftovers = () => {
    const picked: CategoryOverride[] = Object.entries(leftoverPick)
      .filter(([, cat]) => cat && cat !== KEEP)
      .map(([id, cat]) => ({ id, category: cat }));
    setOverrides((o) => [...o, ...picked]);
    finish(picked);
  };

  const totalSteps = groups.length + (leftovers.length || extraLeftovers.length ? 1 : 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="wiz-head">
          <div>
            <h2>{onLeftoverStep ? 'Quick-classify the rest' : 'Categorize your spending'}</h2>
            <p className="muted">
              {onLeftoverStep
                ? `${allLeftovers.length} one-off transaction${allLeftovers.length === 1 ? '' : 's'} that didn’t group with others.`
                : `Group ${step + 1} of ${groups.length}${totalSteps > groups.length ? ' (+ leftovers)' : ''} · ${groups.length - step - 1} more after this`}
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onLeftoverStep ? finishLeftovers : finish.bind(null, [])}>
            Save & close
          </button>
        </div>

        <div className="wiz-progress">
          <div
            className="wiz-progress-fill"
            style={{ width: `${totalSteps ? (step / totalSteps) * 100 : 0}%` }}
          />
        </div>

        {!onLeftoverStep && group ? (
          <>
            <div className="wiz-group-meta">
              <div>
                <strong className="wiz-merchant">“{group.label}”</strong>
                <span className="muted">
                  {group.txs.length} similar transactions · {money(group.total)} total
                </span>
                {group.samples.length > 1 && (
                  <div className="wiz-samples">
                    {group.samples.map((s) => (
                      <span key={s} className="chip">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <label className="field">
                <span>Category for the {includedCount} selected</span>
                <CategoryPicker
                  value={category}
                  onChange={setCategory}
                  options={categoryOptions}
                  onCreate={onCreateCategory}
                />
              </label>
            </div>

            <p className="muted wiz-hint">Uncheck any that don’t belong — they’ll move to the leftovers step.</p>

            <div className="wiz-list">
              {group.txs.map((t) => {
                const on = !excluded.has(t.id);
                return (
                  <label key={t.id} className={`wiz-row ${on ? '' : 'wiz-row-off'}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(t.id)} />
                    <span className="wiz-date">{t.date}</span>
                    <span className="wiz-desc" title={t.description}>
                      {t.description || '—'}
                    </span>
                    <span className="wiz-amt neg">{money(t.amount)}</span>
                  </label>
                );
              })}
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={skipGroup}>
                Skip this group
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={includedCount === 0}
                onClick={applyGroup}
              >
                Apply to {includedCount} & continue
              </button>
            </div>
          </>
        ) : (
          <>
            {allLeftovers.length === 0 ? (
              <p className="muted wiz-hint">Nothing left to classify — you’re all set.</p>
            ) : (
              <div className="wiz-list">
                {allLeftovers.map((t) => (
                  <div key={t.id} className="wiz-row wiz-row-leftover">
                    <span className="wiz-date">{t.date}</span>
                    <span className="wiz-desc" title={t.description}>
                      {t.description || '—'}
                    </span>
                    <span className="wiz-amt neg">{money(t.amount)}</span>
                    <CategoryPicker
                      value={leftoverPick[t.id] ?? KEEP}
                      onChange={(cat) => setLeftoverPick((p) => ({ ...p, [t.id]: cat }))}
                      options={categoryOptions}
                      onCreate={onCreateCategory}
                      keepValue={KEEP}
                      keepLabel="Keep auto-guess"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={finishLeftovers}>
                Finish
              </button>
            </div>
          </>
        )}

        <Legend />
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="wiz-legend">
      {EXPENSE_CATEGORIES.slice(0, 8).map((c) => (
        <span key={c} className="legend-item">
          <span className="dot" style={{ background: categoryColor(c) }} /> {c}
        </span>
      ))}
    </div>
  );
}
