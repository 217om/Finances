import { useMemo, useState } from 'react';
import type { CategoryOverride, CategoryRule, KeywordRule, Transaction } from '../types';
import type { TxGroup } from '../lib/grouping';
import { EXPENSE_CATEGORIES, categoryColor } from '../lib/categorize';
import { money } from '../lib/format';
import CategoryPicker from './CategoryPicker';

interface Props {
  groups: TxGroup[];
  leftovers: Transaction[];
  customCategories: string[];
  onCreateCategory: (name: string) => void;
  onComplete: (rules: CategoryRule[], overrides: CategoryOverride[], keywordRules: KeywordRule[]) => void;
  onClose: () => void;
}

interface Split {
  keyword: string;
  category: string;
  ids: string[];
}

const KEEP = '__keep__';

/**
 * Guided categorization. The user walks one merchant group at a time: uncheck
 * any transactions that don't belong, pick a single category for the rest, and
 * continue. A final step quick-classifies the leftovers. Choices are returned
 * as rules (auto-applied to future imports), per-transaction overrides, and
 * keyword rules split off along the way.
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
  const [keywordRules, setKeywordRules] = useState<KeywordRule[]>([]);
  const [extraLeftovers, setExtraLeftovers] = useState<Transaction[]>([]);

  const onLeftoverStep = step >= groups.length;
  const group = groups[step];

  // Per-group working state.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState('');
  const [splits, setSplits] = useState<Split[]>([]);
  const [groupKey, setGroupKey] = useState(-1);
  // Re-initialize working state whenever we land on a new group.
  if (!onLeftoverStep && groupKey !== step) {
    setGroupKey(step);
    setExcluded(new Set());
    setCategory(group.suggested);
    setSplits([]);
  }

  const splitIds = useMemo(() => new Set(splits.flatMap((s) => s.ids)), [splits]);
  const includedCount = group ? group.txs.length - excluded.size - splitIds.size : 0;

  const toggle = (id: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyGroup = () => {
    if (includedCount > 0) {
      const newRule: CategoryRule = {
        signature: group.signature,
        category,
        excludedIds: [...excluded, ...splitIds],
        sample: group.label,
        createdAt: Date.now(),
      };
      setRules((r) => [...r, newRule]);
    }
    if (splits.length) {
      const newKw: KeywordRule[] = splits.map((s) => ({ keyword: s.keyword, category: s.category, createdAt: Date.now() }));
      setKeywordRules((k) => [...k, ...newKw]);
    }
    // Manually-unchecked transactions (not covered by a split) fall through
    // to the leftovers step — split ones already have a keyword rule.
    if (excluded.size) {
      const excludedTxs = group.txs.filter((t) => excluded.has(t.id));
      setExtraLeftovers((e) => [...e, ...excludedTxs]);
    }
    setStep((s) => s + 1);
  };

  const skipGroup = () => {
    setExtraLeftovers((e) => [...e, ...group.txs]);
    setStep((s) => s + 1);
  };

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
  const [leftoverSplits, setLeftoverSplits] = useState<Split[]>([]);
  const leftoverSplitIds = useMemo(() => new Set(leftoverSplits.flatMap((s) => s.ids)), [leftoverSplits]);
  const leftoverRows = useMemo(
    () => allLeftovers.filter((t) => !leftoverSplitIds.has(t.id)),
    [allLeftovers, leftoverSplitIds],
  );

  const finish = (extraOverrides: CategoryOverride[] = [], extraKeywordRules: KeywordRule[] = []) => {
    onComplete(rules, [...overrides, ...extraOverrides], [...keywordRules, ...extraKeywordRules]);
  };

  const finishLeftovers = () => {
    const picked: CategoryOverride[] = Object.entries(leftoverPick)
      .filter(([id, cat]) => cat && cat !== KEEP && !leftoverSplitIds.has(id))
      .map(([id, cat]) => ({ id, category: cat }));
    setOverrides((o) => [...o, ...picked]);
    const newKw: KeywordRule[] = leftoverSplits.map((s) => ({ keyword: s.keyword, category: s.category, createdAt: Date.now() }));
    if (newKw.length) setKeywordRules((k) => [...k, ...newKw]);
    finish(picked, newKw);
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
          <button type="button" className="btn btn-ghost" onClick={onLeftoverStep ? finishLeftovers : finish.bind(null, [], [])}>
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

            <p className="muted wiz-hint">Uncheck any that don't belong, they'll move to leftovers.</p>

            <KeywordSplitTool
              candidates={group.txs.filter((t) => !excluded.has(t.id) && !splitIds.has(t.id))}
              categoryOptions={categoryOptions}
              onCreateCategory={onCreateCategory}
              onAdd={(keyword, cat, ids) => setSplits((s) => [...s, { keyword, category: cat, ids }])}
            />

            {splits.length > 0 && (
              <div className="wiz-split-chips">
                {splits.map((s, i) => (
                  <span key={`${s.keyword}-${i}`} className="chip chip-removable">
                    “{s.keyword}” → {s.category} ({s.ids.length})
                    <button type="button" onClick={() => setSplits((sp) => sp.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="wiz-list">
              {group.txs.map((t) => {
                const split = splits.find((s) => s.ids.includes(t.id));
                if (split) {
                  return (
                    <div key={t.id} className="wiz-row wiz-row-split">
                      <span className="wiz-date">{t.date}</span>
                      <span className="wiz-desc" title={t.description}>
                        {t.description || '—'}
                      </span>
                      <span className="wiz-amt neg">{money(t.amount)}</span>
                      <span className="wiz-split-tag">→ {split.category}</span>
                    </div>
                  );
                }
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
                disabled={includedCount === 0 && splits.length === 0}
                onClick={applyGroup}
              >
                {includedCount > 0 ? `Apply to ${includedCount} & continue` : 'Continue'}
              </button>
            </div>
          </>
        ) : (
          <>
            {allLeftovers.length === 0 ? (
              <p className="muted wiz-hint">Nothing left to classify. You're all set.</p>
            ) : (
              <>
                <p className="muted wiz-hint">Share a recognizable word? Split them off into a rule below.</p>

                <KeywordSplitTool
                  candidates={leftoverRows}
                  categoryOptions={categoryOptions}
                  onCreateCategory={onCreateCategory}
                  onAdd={(keyword, cat, ids) => setLeftoverSplits((s) => [...s, { keyword, category: cat, ids }])}
                />

                {leftoverSplits.length > 0 && (
                  <div className="wiz-split-chips">
                    {leftoverSplits.map((s, i) => (
                      <span key={`${s.keyword}-${i}`} className="chip chip-removable">
                        “{s.keyword}” → {s.category} ({s.ids.length})
                        <button type="button" onClick={() => setLeftoverSplits((sp) => sp.filter((_, j) => j !== i))}>
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {leftoverRows.length > 0 && (
                  <div className="wiz-list">
                    {leftoverRows.map((t) => (
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
              </>
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

interface KeywordSplitToolProps {
  /** Pool of not-yet-claimed transactions to search within. */
  candidates: Transaction[];
  categoryOptions: string[];
  onCreateCategory: (name: string) => void;
  onAdd: (keyword: string, category: string, ids: string[]) => void;
}

/**
 * Lets the user tell the app *why* a subset of transactions belongs to a
 * category instead of just picking each one individually: type the word
 * that identifies them (a name, a merchant) and a category, and every
 * matching transaction splits off together, becoming a keyword rule that
 * also applies to future imports.
 */
function KeywordSplitTool({ candidates, categoryOptions, onCreateCategory, onAdd }: KeywordSplitToolProps) {
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');

  const needle = text.trim().toLowerCase();
  const matches = useMemo(() => {
    if (needle.length < 2) return [];
    return candidates.filter((t) => t.description.toLowerCase().includes(needle));
  }, [candidates, needle]);

  const add = () => {
    if (!category || matches.length === 0) return;
    onAdd(needle, category, matches.map((t) => t.id));
    setText('');
    setCategory('');
  };

  return (
    <div className="wiz-split">
      <input
        className="wiz-split-kw"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Because it says… e.g. a name in the description"
        onKeyDown={(e) => {
          if (e.key === 'Enter') add();
        }}
      />
      <CategoryPicker
        value={category}
        onChange={setCategory}
        options={categoryOptions}
        onCreate={onCreateCategory}
        keepValue=""
        keepLabel="Category…"
      />
      <button type="button" className="btn btn-ghost btn-sm" disabled={!category || matches.length === 0} onClick={add}>
        Split off{matches.length > 0 ? ` ${matches.length}` : ''}
      </button>
      {needle.length >= 2 && matches.length === 0 && <span className="muted wiz-split-empty">No matches</span>}
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
