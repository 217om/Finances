import { useEffect, useMemo, useState } from 'react';
import type { Card } from '../lib/cards';
import { ALL_CARDS_ID } from '../lib/cards';
import type { CategoryRule, KeywordRule, SubRule, Transaction } from '../types';
import type { CardSnapshot } from '../lib/combine';
import {
  BUILT_IN_RULES,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  categoryColor,
  findShadowingRule,
  mergeByKey,
  normalizeCategoryName,
  signatureOf,
} from '../lib/categorize';
import CategoryPicker from './CategoryPicker';
import RuleTreeGallery from './RuleTreeGallery';

export interface CardRuleSet {
  cardId: string;
  cardName: string;
  rules: CategoryRule[];
  keywordRules: KeywordRule[];
  subRules: SubRule[];
}

interface Props {
  cards: Card[];
  /** Which card's transactions the "N transactions" counts reflect — either
   *  a specific card id or ALL_CARDS_ID to sum across every card. */
  countCardId: string;
  onChangeCountCard: (id: string) => void;
  /** Every card's own effective (global+card merged) resolver — used only
   *  for computing match counts, never for deciding what's editable here. */
  cardSnapshots: CardSnapshot[];
  globalRules: CategoryRule[];
  globalKeywordRules: KeywordRule[];
  globalSubRules: SubRule[];
  /** Each card's own card-specific rules, unmerged — what actually renders
   *  in that card's own section below the global one. */
  cardRuleSets: CardRuleSet[];
  customCategories: string[];
  onCreateCategory: (scope: string, name: string) => void;
  onCreateKeywordRule: (scope: string, keyword: string, category: string) => void;
  onUpdateKeywordRuleCategory: (scope: string, keyword: string, category: string) => void;
  onDeleteKeywordRule: (scope: string, keyword: string, category: string) => void;
  onReorderKeywordRule: (scope: string, keyword: string, direction: 'up' | 'down') => void;
  /** One-click fix for a shadowed keyword rule — bump it to just above the
   *  rule currently shadowing it (which may live in a different scope). Also
   *  used to implement drag-and-drop reordering. */
  onPromoteKeywordRuleAbove: (scope: string, keyword: string, aboveCreatedAt: number) => void;
  /** Moves a card-specific rule into the global set, keeping its category
   *  and priority — only relevant for card sections, never the global one. */
  onMoveKeywordRuleToGlobal: (scope: string, keyword: string) => void;
  onUpdateSignatureRuleCategory: (scope: string, signature: string, category: string) => void;
  onDeleteSignatureRule: (scope: string, signature: string, category: string) => void;
  onReorderSignatureRule: (scope: string, signature: string, direction: 'up' | 'down') => void;
  onPromoteSignatureRuleAbove: (scope: string, signature: string, aboveCreatedAt: number) => void;
  onMoveSignatureRuleToGlobal: (scope: string, signature: string) => void;
  onCreateSubRule: (scope: string, parent: string, keyword: string, sub: string) => void;
  onDeleteSubRule: (scope: string, id: string, info: { parent: string; sub: string; keyword: string }) => void;
  onReorderSubRule: (scope: string, id: string, direction: 'up' | 'down') => void;
  onPromoteSubRuleAbove: (scope: string, id: string, aboveCreatedAt: number) => void;
  onMoveSubRuleToGlobal: (scope: string, id: string) => void;
  onReparentSubRule: (scope: string, id: string, newParent: string) => void;
}

function plural(n: number): string {
  return n === 1 ? 'transaction' : 'transactions';
}

const BUILTIN_PREVIEW = 8;

interface RuleWarning {
  text: string;
  fixLabel?: string;
  onFix?: () => void;
}

interface RuleRowProps {
  priority?: number;
  priorityTitle?: string;
  keyLabel: string;
  titleAttr?: string;
  category: string;
  categoryOptions: string[];
  onCreateCategory: (name: string) => void;
  onCategoryChange: (category: string) => void;
  subValue: string;
  onSubCommit: (value: string) => void;
  count: number;
  onReorderUp?: () => void;
  onReorderDown?: () => void;
  reorderUpDisabled?: boolean;
  reorderDownDisabled?: boolean;
  onRemove: () => void;
  onMakeGlobal?: () => void;
  warning?: RuleWarning | null;
  /** This row's identity for drag-and-drop, and the handler a drop on THIS
   *  row calls with the dragged row's key — "move the dragged rule to just
   *  above this one." Both present together, or neither (no drag support). */
  dragKey?: string;
  onDragReorder?: (draggedKey: string, targetKey: string) => void;
}

/** One row of a scope's rule list: keyword/merchant → category → optional
 *  sub-category. Handles all three row kinds (keyword rule, merchant rule,
 *  standalone sub-rule) through the same shape so they read as one list. */
function RuleRow({
  priority,
  priorityTitle,
  keyLabel,
  titleAttr,
  category,
  categoryOptions,
  onCreateCategory,
  onCategoryChange,
  subValue,
  onSubCommit,
  count,
  onReorderUp,
  onReorderDown,
  reorderUpDisabled,
  reorderDownDisabled,
  onRemove,
  onMakeGlobal,
  warning,
  dragKey,
  onDragReorder,
}: RuleRowProps) {
  const [draft, setDraft] = useState(subValue);
  useEffect(() => setDraft(subValue), [subValue]);
  const commit = () => {
    const trimmed = draft ? normalizeCategoryName(draft) : '';
    if (trimmed !== subValue) onSubCommit(trimmed);
  };
  const draggable = Boolean(dragKey && onDragReorder);
  return (
    <div
      className="rules-row-wrap"
      onDragOver={draggable ? (e) => e.preventDefault() : undefined}
      onDrop={
        draggable
          ? (e) => {
              e.preventDefault();
              const draggedKey = e.dataTransfer.getData('text/plain');
              if (draggedKey && draggedKey !== dragKey) onDragReorder!(draggedKey, dragKey!);
            }
          : undefined
      }
    >
      <div className="rules-row">
        {draggable && (
          <span
            className="rules-drag-handle"
            draggable
            title="Drag to reorder"
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', dragKey!);
              e.dataTransfer.effectAllowed = 'move';
            }}
          >
            ⠿
          </span>
        )}
        {priority != null && (
          <span className="rules-pri" title={priorityTitle}>
            {priority}
          </span>
        )}
        <span className="rules-kw" title={titleAttr}>
          {keyLabel}
        </span>
        <span className="rules-arrow">→</span>
        <span className="rules-cat-pick">
          <CategoryPicker value={category} onChange={onCategoryChange} options={categoryOptions} onCreate={onCreateCategory} />
        </span>
        <span className="rules-arrow rules-arrow-sub">→</span>
        <input
          className="rules-sub-input"
          value={draft}
          placeholder="sub-category (optional)"
          maxLength={28}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        <span className="rules-count muted">
          {count} {plural(count)}
        </span>
        <span className="rules-actions">
          {onReorderUp && (
            <button
              type="button"
              className="btn btn-ghost btn-sm rules-reorder"
              disabled={reorderUpDisabled}
              title="Higher priority"
              onClick={onReorderUp}
            >
              ▲
            </button>
          )}
          {onReorderDown && (
            <button
              type="button"
              className="btn btn-ghost btn-sm rules-reorder"
              disabled={reorderDownDisabled}
              title="Lower priority"
              onClick={onReorderDown}
            >
              ▼
            </button>
          )}
          {onMakeGlobal && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              title="Apply this rule to every card, not just this one"
              onClick={onMakeGlobal}
            >
              Make global
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>
            Remove
          </button>
        </span>
      </div>
      {warning && (
        <div className="rules-warn-line">
          <span>⚠ {warning.text}</span>
          {warning.onFix && (
            <button type="button" className="linklike rules-warn-fix" onClick={warning.onFix}>
              {warning.fixLabel ?? 'Fix'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface ScopedCategoryRulesProps {
  rules: CategoryRule[];
  keywordRules: KeywordRule[];
  /** The full set this scope's keyword rules actually compete against at
   *  resolution time — for the global section that's just its own
   *  keywordRules; for a card section it's global+card merged, since a card
   *  rule can be shadowed by (or shadow) a global one too. Used only to
   *  detect overlaps, never to decide what's editable here. */
  effectiveKeywordRules: KeywordRule[];
  subRules: SubRule[];
  categoryOptions: string[];
  onCreateCategory: (name: string) => void;
  countCardIds: string[];
  snapshotById: Map<string, CardSnapshot>;
  query: string;
  onUpdateKeywordRuleCategory: (keyword: string, category: string) => void;
  onDeleteKeywordRule: (keyword: string, category: string) => void;
  onReorderKeywordRule: (keyword: string, direction: 'up' | 'down') => void;
  onPromoteKeywordRule: (keyword: string, aboveCreatedAt: number) => void;
  /** Present only for a card's own section — moves the rule to global. */
  onMoveKeywordToGlobal?: (keyword: string) => void;
  onUpdateSignatureRuleCategory: (signature: string, category: string) => void;
  onDeleteSignatureRule: (signature: string, category: string) => void;
  onReorderSignature: (signature: string, direction: 'up' | 'down') => void;
  onPromoteSignature: (signature: string, aboveCreatedAt: number) => void;
  onMoveSignatureToGlobal?: (signature: string) => void;
  onSetSub: (parent: string, keyword: string, sub: string) => void;
  onDeleteSub: (id: string, info: { parent: string; sub: string; keyword: string }) => void;
  onReorderSub: (id: string, direction: 'up' | 'down') => void;
  onPromoteSub: (id: string, aboveCreatedAt: number) => void;
  onMoveSubToGlobal?: (id: string) => void;
  onReparentSub: (id: string, newParent: string) => void;
}

/** The category-grouped rule list for one scope (global, or a single card's
 *  own rules) — keyword and merchant rules merged into one list, each with
 *  an optional second arrow to a sub-category; a sub-rule with no matching
 *  top-level rule still gets its own row. */
function ScopedCategoryRules({
  rules,
  keywordRules,
  effectiveKeywordRules,
  subRules,
  categoryOptions,
  onCreateCategory,
  countCardIds,
  snapshotById,
  query,
  onUpdateKeywordRuleCategory,
  onDeleteKeywordRule,
  onReorderKeywordRule,
  onPromoteKeywordRule,
  onMoveKeywordToGlobal,
  onUpdateSignatureRuleCategory,
  onDeleteSignatureRule,
  onReorderSignature,
  onPromoteSignature,
  onMoveSignatureToGlobal,
  onSetSub,
  onDeleteSub,
  onReorderSub,
  onPromoteSub,
  onMoveSubToGlobal,
  onReparentSub,
}: ScopedCategoryRulesProps) {
  // True evaluation order — resolveCategory sorts ALL of a scope's keyword
  // rules by createdAt regardless of category, so that's the order priority
  // numbers, up/down bounds, and shadow detection all have to use. The
  // category-grouped `g.keyword` list below is just a display grouping.
  const sortedOwnKeyword = useMemo(
    () => [...keywordRules].sort((a, b) => b.createdAt - a.createdAt),
    [keywordRules],
  );
  const sortedEffectiveKeyword = useMemo(
    () => [...effectiveKeywordRules].sort((a, b) => b.createdAt - a.createdAt),
    [effectiveKeywordRules],
  );
  const priorityOf = (keyword: string) => sortedOwnKeyword.findIndex((r) => r.keyword === keyword) + 1;

  // Merchant rules are keyed by signature, so at most one can ever match a
  // transaction — there's no real conflict to order, but the same manual
  // ordering mechanism (createdAt) still gives a consistent, reorderable
  // list, same as keyword rules.
  const sortedOwnSignature = useMemo(
    () => [...rules].sort((a, b) => b.createdAt - a.createdAt),
    [rules],
  );
  const prioritySignatureOf = (signature: string) => sortedOwnSignature.findIndex((r) => r.signature === signature) + 1;

  // Sub-rules resolve per-parent (same "newest, first substring match wins"
  // pattern as keyword rules), and that pool includes BOTH the standalone
  // rows below and any sub-rule inline-attached to a keyword/merchant row —
  // so priority/bounds have to come from the full per-parent set, not just
  // the standalone subset actually rendered as its own row.
  const subRulesByParent = useMemo(() => {
    const m = new Map<string, SubRule[]>();
    for (const r of subRules) {
      const list = m.get(r.parent);
      if (list) list.push(r);
      else m.set(r.parent, [r]);
    }
    for (const list of m.values()) list.sort((a, b) => b.createdAt - a.createdAt);
    return m;
  }, [subRules]);
  const prioritySubOf = (id: string, parent: string) => {
    const list = subRulesByParent.get(parent) ?? [];
    const idx = list.findIndex((r) => r.id === id);
    return idx < 0 ? undefined : idx + 1;
  };

  const countCategoryFor = (needle: string, category: string) => {
    let n = 0;
    for (const id of countCardIds) {
      const snap = snapshotById.get(id);
      if (!snap) continue;
      for (const t of snap.transactions) {
        if (t.description.toLowerCase().includes(needle) && snap.categoryOf(t) === category) n++;
      }
    }
    return n;
  };
  const countSignature = (sig: string) => {
    let n = 0;
    for (const id of countCardIds) {
      const snap = snapshotById.get(id);
      if (!snap) continue;
      for (const t of snap.transactions) {
        if (t.amount < 0 && signatureOf(t.description) === sig) n++;
      }
    }
    return n;
  };
  const countSub = (needle: string, parent: string, sub: string) => {
    let n = 0;
    for (const id of countCardIds) {
      const snap = snapshotById.get(id);
      if (!snap) continue;
      for (const t of snap.transactions) {
        if (!t.description.toLowerCase().includes(needle)) continue;
        if (snap.categoryOf(t) !== parent) continue;
        if (snap.subOf(t, parent) === sub) n++;
      }
    }
    return n;
  };

  const subByPair = useMemo(() => {
    const m = new Map<string, SubRule>();
    for (const r of subRules) m.set(`${r.parent}|${r.keyword}`, r);
    return m;
  }, [subRules]);
  const coveredSubKeys = useMemo(() => {
    const s = new Set<string>();
    for (const r of keywordRules) s.add(`${r.category}|${r.keyword}`);
    for (const r of rules) s.add(`${r.category}|${r.signature}`);
    return s;
  }, [keywordRules, rules]);
  const standaloneSubRules = useMemo(
    () => subRules.filter((r) => !coveredSubKeys.has(`${r.parent}|${r.keyword}`)),
    [subRules, coveredSubKeys],
  );

  const categoryGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = (...texts: (string | undefined)[]) => !q || texts.some((t) => t?.toLowerCase().includes(q));

    const groups = new Map<string, { keyword: KeywordRule[]; merchant: CategoryRule[]; standalone: SubRule[] }>();
    const ensure = (cat: string) => {
      let g = groups.get(cat);
      if (!g) {
        g = { keyword: [], merchant: [], standalone: [] };
        groups.set(cat, g);
      }
      return g;
    };
    for (const r of keywordRules) if (hit(r.keyword)) ensure(r.category).keyword.push(r);
    for (const r of rules) if (hit(r.signature, r.sample)) ensure(r.category).merchant.push(r);
    for (const r of standaloneSubRules) if (hit(r.keyword, r.sub)) ensure(r.parent).standalone.push(r);

    for (const g of groups.values()) {
      g.keyword.sort((a, b) => b.createdAt - a.createdAt);
      g.merchant.sort((a, b) => b.createdAt - a.createdAt);
      g.standalone.sort((a, b) => b.createdAt - a.createdAt);
    }
    return [...groups.entries()].sort(
      (a, b) => b[1].keyword.length + b[1].merchant.length + b[1].standalone.length - (a[1].keyword.length + a[1].merchant.length + a[1].standalone.length),
    );
  }, [keywordRules, rules, standaloneSubRules, query]);

  const searching = query.trim().length > 0;
  const total = rules.length + keywordRules.length;

  if (total === 0 && standaloneSubRules.length === 0) {
    return <p className="muted rules-empty">No rules here yet — add one above.</p>;
  }
  if (categoryGroups.length === 0) {
    return <p className="muted rules-empty">No rules match “{query}”.</p>;
  }

  return (
    <div className="rules-groups">
      {categoryGroups.map(([cat, g]) => (
        <details key={cat} open={searching || undefined}>
          <summary>
            <span className="catdot" style={{ background: categoryColor(cat) }} />
            {cat}
            <span className="muted rules-group-count">{g.keyword.length + g.merchant.length + g.standalone.length}</span>
          </summary>
          <div className="rules-list">
            {g.keyword.map((r) => {
              const subValue = subByPair.get(`${cat}|${r.keyword}`)?.sub ?? '';
              const priority = priorityOf(r.keyword);
              const shadow = findShadowingRule(r, sortedEffectiveKeyword);
              return (
                <RuleRow
                  key={`kw-${r.keyword}`}
                  priority={priority}
                  keyLabel={`contains “${r.keyword}”`}
                  category={r.category}
                  categoryOptions={categoryOptions}
                  onCreateCategory={onCreateCategory}
                  onCategoryChange={(newCat) => onUpdateKeywordRuleCategory(r.keyword, newCat)}
                  subValue={subValue}
                  onSubCommit={(v) =>
                    v
                      ? onSetSub(cat, r.keyword, v)
                      : subByPair.has(`${cat}|${r.keyword}`) &&
                        onDeleteSub(`${cat}${r.keyword}`, { parent: cat, sub: subValue, keyword: r.keyword })
                  }
                  count={countCategoryFor(r.keyword, cat)}
                  onReorderUp={() => onReorderKeywordRule(r.keyword, 'up')}
                  onReorderDown={() => onReorderKeywordRule(r.keyword, 'down')}
                  reorderUpDisabled={priority <= 1}
                  reorderDownDisabled={priority >= sortedOwnKeyword.length}
                  onRemove={() => onDeleteKeywordRule(r.keyword, r.category)}
                  onMakeGlobal={onMoveKeywordToGlobal ? () => onMoveKeywordToGlobal(r.keyword) : undefined}
                  warning={
                    shadow && {
                      text: `“${shadow.keyword}” (${shadow.category}) always matches first — this rule can never apply.`,
                      fixLabel: `Move above “${shadow.keyword}”`,
                      onFix: () => onPromoteKeywordRule(r.keyword, shadow.createdAt),
                    }
                  }
                  dragKey={r.keyword}
                  onDragReorder={(draggedKeyword, targetKeyword) => {
                    const target = sortedOwnKeyword.find((x) => x.keyword === targetKeyword);
                    if (target) onPromoteKeywordRule(draggedKeyword, target.createdAt);
                  }}
                />
              );
            })}
            {g.merchant.map((r) => {
              const subValue = subByPair.get(`${cat}|${r.signature}`)?.sub ?? '';
              const priority = prioritySignatureOf(r.signature);
              return (
                <RuleRow
                  key={`mr-${r.signature}`}
                  priority={priority}
                  priorityTitle="Merchant rules never conflict with each other — this order is just for your own browsing."
                  keyLabel={r.signature}
                  titleAttr={r.sample}
                  category={r.category}
                  categoryOptions={categoryOptions}
                  onCreateCategory={onCreateCategory}
                  onCategoryChange={(newCat) => onUpdateSignatureRuleCategory(r.signature, newCat)}
                  subValue={subValue}
                  onSubCommit={(v) =>
                    v
                      ? onSetSub(cat, r.signature, v)
                      : subByPair.has(`${cat}|${r.signature}`) &&
                        onDeleteSub(`${cat}${r.signature}`, { parent: cat, sub: subValue, keyword: r.signature })
                  }
                  count={countSignature(r.signature)}
                  onReorderUp={() => onReorderSignature(r.signature, 'up')}
                  onReorderDown={() => onReorderSignature(r.signature, 'down')}
                  reorderUpDisabled={priority <= 1}
                  reorderDownDisabled={priority >= sortedOwnSignature.length}
                  onRemove={() => onDeleteSignatureRule(r.signature, r.category)}
                  onMakeGlobal={onMoveSignatureToGlobal ? () => onMoveSignatureToGlobal(r.signature) : undefined}
                  dragKey={r.signature}
                  onDragReorder={(draggedSignature, targetSignature) => {
                    const target = sortedOwnSignature.find((x) => x.signature === targetSignature);
                    if (target) onPromoteSignature(draggedSignature, target.createdAt);
                  }}
                />
              );
            })}
            {g.standalone.map((r) => (
              <RuleRow
                key={`sr-${r.id}`}
                priority={prioritySubOf(r.id, r.parent)}
                keyLabel={`contains “${r.keyword}”`}
                category={r.parent}
                categoryOptions={categoryOptions}
                onCreateCategory={onCreateCategory}
                onCategoryChange={(newCat) => onReparentSub(r.id, newCat)}
                subValue={r.sub}
                onSubCommit={(v) =>
                  v
                    ? onSetSub(r.parent, r.keyword, v)
                    : onDeleteSub(r.id, { parent: r.parent, sub: r.sub, keyword: r.keyword })
                }
                count={countSub(r.keyword, r.parent, r.sub)}
                onReorderUp={() => onReorderSub(r.id, 'up')}
                onReorderDown={() => onReorderSub(r.id, 'down')}
                reorderUpDisabled={(prioritySubOf(r.id, r.parent) ?? 1) <= 1}
                reorderDownDisabled={(prioritySubOf(r.id, r.parent) ?? 0) >= (subRulesByParent.get(r.parent)?.length ?? 0)}
                onRemove={() => onDeleteSub(r.id, { parent: r.parent, sub: r.sub, keyword: r.keyword })}
                onMakeGlobal={onMoveSubToGlobal ? () => onMoveSubToGlobal(r.id) : undefined}
                dragKey={r.id}
                onDragReorder={(draggedId, targetId) => {
                  const list = subRulesByParent.get(r.parent) ?? [];
                  const target = list.find((x) => x.id === targetId);
                  if (target) onPromoteSub(draggedId, target.createdAt);
                }}
              />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

/**
 * The full categorization decision tree, across every card: global rules
 * (the default, applying everywhere) plus any card that has its own
 * card-specific overrides — each shown in its own section, category-grouped
 * within. New rules can be added even with zero matching transactions today,
 * so they're ready for future imports. Deleting a rule never changes how an
 * already-categorized transaction looks — see the caller for that guarantee.
 */
export default function AdvancedSettingsPage({
  cards,
  countCardId,
  onChangeCountCard,
  cardSnapshots,
  globalRules,
  globalKeywordRules,
  globalSubRules,
  cardRuleSets,
  customCategories,
  onCreateCategory,
  onCreateKeywordRule,
  onUpdateKeywordRuleCategory,
  onDeleteKeywordRule,
  onReorderKeywordRule,
  onPromoteKeywordRuleAbove,
  onMoveKeywordRuleToGlobal,
  onUpdateSignatureRuleCategory,
  onDeleteSignatureRule,
  onReorderSignatureRule,
  onPromoteSignatureRuleAbove,
  onMoveSignatureRuleToGlobal,
  onCreateSubRule,
  onDeleteSubRule,
  onReorderSubRule,
  onPromoteSubRuleAbove,
  onMoveSubRuleToGlobal,
  onReparentSubRule,
}: Props) {
  const categoryOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES, ...customCategories]) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    return out;
  }, [customCategories]);

  const snapshotById = useMemo(() => new Map(cardSnapshots.map((s) => [s.cardId, s])), [cardSnapshots]);
  const countCardIds = useMemo(
    () => (countCardId === ALL_CARDS_ID ? cards.map((c) => c.id) : [countCardId]),
    [countCardId, cards],
  );
  const countTransactions = useMemo(() => {
    const out: Transaction[] = [];
    for (const id of countCardIds) {
      const snap = snapshotById.get(id);
      if (snap) out.push(...snap.transactions);
    }
    return out;
  }, [countCardIds, snapshotById]);

  // --- Add-rule form -------------------------------------------------------
  const [mode, setMode] = useState<'keyword' | 'sub'>('keyword');
  const [formScope, setFormScope] = useState('global');
  const [kwText, setKwText] = useState('');
  const [kwCategory, setKwCategory] = useState('');
  const [subParent, setSubParent] = useState('');
  const [subText, setSubText] = useState('');
  const [subName, setSubName] = useState('');

  const kwNeedle = kwText.trim().toLowerCase();
  const kwMatches = useMemo(() => {
    if (kwNeedle.length < 2) return 0;
    let n = 0;
    for (const t of countTransactions) if (t.description.toLowerCase().includes(kwNeedle)) n++;
    return n;
  }, [countTransactions, kwNeedle]);

  const subNeedle = subText.trim().toLowerCase();
  const subMatches = useMemo(() => {
    if (!subParent || subNeedle.length < 2) return 0;
    let n = 0;
    for (const id of countCardIds) {
      const snap = snapshotById.get(id);
      if (!snap) continue;
      for (const t of snap.transactions) {
        if (snap.categoryOf(t) === subParent && t.description.toLowerCase().includes(subNeedle)) n++;
      }
    }
    return n;
  }, [countCardIds, snapshotById, subParent, subNeedle]);

  const allSubRules = useMemo(
    () => [...globalSubRules, ...cardRuleSets.flatMap((c) => c.subRules)],
    [globalSubRules, cardRuleSets],
  );
  const subNamesForParent = useMemo(() => {
    if (!subParent) return [];
    const set = new Set<string>();
    for (const r of allSubRules) if (r.parent === subParent) set.add(r.sub);
    return [...set].sort();
  }, [allSubRules, subParent]);

  const submitKeyword = () => {
    if (!kwNeedle || !kwCategory) return;
    onCreateKeywordRule(formScope, kwNeedle, kwCategory);
    setKwText('');
    setKwCategory('');
  };

  const submitSub = () => {
    const kw = subText.trim().toLowerCase();
    const name = normalizeCategoryName(subName);
    if (!subParent || !kw || !name) return;
    onCreateSubRule(formScope, subParent, kw, name);
    setSubText('');
    setSubName('');
  };

  // --- Built-in reference, decluttered: collapsed to a preview per category
  const [expandedBuiltIn, setExpandedBuiltIn] = useState<Set<string>>(new Set());
  const toggleBuiltIn = (category: string) => {
    setExpandedBuiltIn((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const [query, setQuery] = useState('');

  const cardsWithOwnRules = useMemo(
    () => cardRuleSets.filter((c) => c.rules.length + c.keywordRules.length + c.subRules.length > 0),
    [cardRuleSets],
  );

  return (
    <div className="rules-page">
      <p className="muted rules-intro">
        Rules are global by default — a keyword or merchant rule applies to every card unless a card
        defines its own for the same keyword/merchant, which takes precedence just for that card.
        Give any rule an optional sub-category for a finer split within it. When two keyword rules
        could both match the same transaction, the number on the left (lowest wins) decides — use ▲▼
        to change it, or ⚠ Fix if a rule is shown as fully blocked by another one.
      </p>

      <label className="picker rules-card-picker">
        <span className="picker-label">Show match counts for</span>
        <select value={countCardId} onChange={(e) => onChangeCountCard(e.target.value)}>
          <option value={ALL_CARDS_ID}>All cards</option>
          {cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <section className="panel rules-add">
        <div className="panel-head">
          <div>
            <h2>Add a rule</h2>
            <p className="muted">
              Applies immediately to matching transactions, and automatically to anything you import
              later — even with zero matches today.
            </p>
          </div>
          <div className="seg seg-sm">
            <button type="button" className={mode === 'keyword' ? 'seg-on' : ''} onClick={() => setMode('keyword')}>
              Keyword → category
            </button>
            <button type="button" className={mode === 'sub' ? 'seg-on' : ''} onClick={() => setMode('sub')}>
              Keyword → sub-category
            </button>
          </div>
        </div>

        <label className="picker rules-form-scope">
          <span className="picker-label">For</span>
          <select value={formScope} onChange={(e) => setFormScope(e.target.value)}>
            <option value="global">All cards (default)</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} only
              </option>
            ))}
          </select>
        </label>

        {mode === 'keyword' ? (
          <div className="rules-form">
            <span className="muted">If description contains</span>
            <input
              value={kwText}
              placeholder="e.g. carrefour"
              maxLength={64}
              onChange={(e) => setKwText(e.target.value)}
            />
            <span className="muted">classify as</span>
            <CategoryPicker
              value={kwCategory}
              onChange={setKwCategory}
              options={categoryOptions}
              onCreate={(name) => onCreateCategory(formScope, name)}
              keepValue=""
              keepLabel="Choose category…"
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!kwNeedle || !kwCategory}
              onClick={submitKeyword}
            >
              Save rule
            </button>
            {kwNeedle.length >= 2 && (
              <span className="rules-preview muted">
                {kwMatches === 0
                  ? 'No transactions match yet — the rule will still apply to future imports'
                  : `${kwMatches} matching ${plural(kwMatches)} now`}
              </span>
            )}
          </div>
        ) : (
          <div className="rules-form">
            <span className="muted">Within</span>
            <select value={subParent} onChange={(e) => setSubParent(e.target.value)}>
              <option value="">Choose category…</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className="muted">if description contains</span>
            <input
              value={subText}
              placeholder="e.g. savings"
              maxLength={64}
              onChange={(e) => setSubText(e.target.value)}
            />
            <span className="muted">sub-category</span>
            <input
              value={subName}
              placeholder="e.g. Savings transfer"
              maxLength={28}
              list="rules-sub-names"
              onChange={(e) => setSubName(e.target.value)}
            />
            <datalist id="rules-sub-names">
              {subNamesForParent.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!subParent || !subText.trim() || !subName.trim()}
              onClick={submitSub}
            >
              Save rule
            </button>
            {subParent && subNeedle.length >= 2 && (
              <span className="rules-preview muted">
                {subMatches === 0
                  ? 'No transactions match yet — the rule will still apply to future imports'
                  : `${subMatches} matching ${plural(subMatches)} now`}
              </span>
            )}
          </div>
        )}
      </section>

      <input
        className="rules-search rules-search-top"
        value={query}
        placeholder="Search rules across every card…"
        onChange={(e) => setQuery(e.target.value)}
      />

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Global rules</h2>
            <p className="muted">Apply to every card by default.</p>
          </div>
          <span className="badge">{globalRules.length + globalKeywordRules.length}</span>
        </div>
        <RuleTreeGallery
          ownScope="global"
          rules={globalRules}
          keywordRules={globalKeywordRules}
          effectiveKeywordRules={globalKeywordRules}
          subRules={globalSubRules}
          globalSubRules={globalSubRules}
          countCardIds={countCardIds}
          snapshotById={snapshotById}
          query={query}
          categoryOptions={categoryOptions}
          onCreateCategory={onCreateCategory}
          onUpdateKeywordRuleCategory={onUpdateKeywordRuleCategory}
          onDeleteKeywordRule={onDeleteKeywordRule}
          onUpdateSignatureRuleCategory={onUpdateSignatureRuleCategory}
          onDeleteSignatureRule={onDeleteSignatureRule}
          onSetSub={onCreateSubRule}
          onDeleteSub={onDeleteSubRule}
        />
        <ScopedCategoryRules
          rules={globalRules}
          keywordRules={globalKeywordRules}
          effectiveKeywordRules={globalKeywordRules}
          subRules={globalSubRules}
          categoryOptions={categoryOptions}
          onCreateCategory={(name) => onCreateCategory('global', name)}
          countCardIds={countCardIds}
          snapshotById={snapshotById}
          query={query}
          onUpdateKeywordRuleCategory={(kw, cat) => onUpdateKeywordRuleCategory('global', kw, cat)}
          onDeleteKeywordRule={(kw, cat) => onDeleteKeywordRule('global', kw, cat)}
          onReorderKeywordRule={(kw, dir) => onReorderKeywordRule('global', kw, dir)}
          onPromoteKeywordRule={(kw, above) => onPromoteKeywordRuleAbove('global', kw, above)}
          onUpdateSignatureRuleCategory={(sig, cat) => onUpdateSignatureRuleCategory('global', sig, cat)}
          onDeleteSignatureRule={(sig, cat) => onDeleteSignatureRule('global', sig, cat)}
          onReorderSignature={(sig, dir) => onReorderSignatureRule('global', sig, dir)}
          onPromoteSignature={(sig, above) => onPromoteSignatureRuleAbove('global', sig, above)}
          onSetSub={(parent, kw, sub) => onCreateSubRule('global', parent, kw, sub)}
          onDeleteSub={(id, info) => onDeleteSubRule('global', id, info)}
          onReorderSub={(id, dir) => onReorderSubRule('global', id, dir)}
          onPromoteSub={(id, above) => onPromoteSubRuleAbove('global', id, above)}
          onReparentSub={(id, newParent) => onReparentSubRule('global', id, newParent)}
        />
      </section>

      {cardsWithOwnRules.map((c) => (
        <section className="panel" key={c.cardId}>
          <details open>
            <summary>
              <strong>{c.cardName} — card-specific rules</strong>
              <span className="muted rules-group-count">{c.rules.length + c.keywordRules.length}</span>
            </summary>
            <p className="muted rules-card-scope-note">
              Only applies to {c.cardName}, and takes precedence over a global rule for the same keyword
              or merchant.
            </p>
            <RuleTreeGallery
              ownScope={c.cardId}
              rules={c.rules}
              keywordRules={c.keywordRules}
              effectiveKeywordRules={mergeByKey(globalKeywordRules, c.keywordRules, (r) => r.keyword)}
              subRules={c.subRules}
              globalSubRules={globalSubRules}
              countCardIds={countCardIds}
              snapshotById={snapshotById}
              query={query}
              categoryOptions={categoryOptions}
              onCreateCategory={onCreateCategory}
              onUpdateKeywordRuleCategory={onUpdateKeywordRuleCategory}
              onDeleteKeywordRule={onDeleteKeywordRule}
              onUpdateSignatureRuleCategory={onUpdateSignatureRuleCategory}
              onDeleteSignatureRule={onDeleteSignatureRule}
              onSetSub={onCreateSubRule}
              onDeleteSub={onDeleteSubRule}
            />
            <ScopedCategoryRules
              rules={c.rules}
              keywordRules={c.keywordRules}
              effectiveKeywordRules={mergeByKey(globalKeywordRules, c.keywordRules, (r) => r.keyword)}
              subRules={c.subRules}
              categoryOptions={categoryOptions}
              onCreateCategory={(name) => onCreateCategory(c.cardId, name)}
              countCardIds={countCardIds}
              snapshotById={snapshotById}
              query={query}
              onUpdateKeywordRuleCategory={(kw, cat) => onUpdateKeywordRuleCategory(c.cardId, kw, cat)}
              onDeleteKeywordRule={(kw, cat) => onDeleteKeywordRule(c.cardId, kw, cat)}
              onReorderKeywordRule={(kw, dir) => onReorderKeywordRule(c.cardId, kw, dir)}
              onPromoteKeywordRule={(kw, above) => onPromoteKeywordRuleAbove(c.cardId, kw, above)}
              onMoveKeywordToGlobal={(kw) => onMoveKeywordRuleToGlobal(c.cardId, kw)}
              onUpdateSignatureRuleCategory={(sig, cat) => onUpdateSignatureRuleCategory(c.cardId, sig, cat)}
              onDeleteSignatureRule={(sig, cat) => onDeleteSignatureRule(c.cardId, sig, cat)}
              onReorderSignature={(sig, dir) => onReorderSignatureRule(c.cardId, sig, dir)}
              onPromoteSignature={(sig, above) => onPromoteSignatureRuleAbove(c.cardId, sig, above)}
              onMoveSignatureToGlobal={(sig) => onMoveSignatureRuleToGlobal(c.cardId, sig)}
              onSetSub={(parent, kw, sub) => onCreateSubRule(c.cardId, parent, kw, sub)}
              onDeleteSub={(id, info) => onDeleteSubRule(c.cardId, id, info)}
              onReorderSub={(id, dir) => onReorderSubRule(c.cardId, id, dir)}
              onPromoteSub={(id, above) => onPromoteSubRuleAbove(c.cardId, id, above)}
              onMoveSubToGlobal={(id) => onMoveSubRuleToGlobal(c.cardId, id)}
              onReparentSub={(id, newParent) => onReparentSubRule(c.cardId, id, newParent)}
            />
          </details>
        </section>
      ))}

      <section className="panel">
        <details>
          <summary>
            <strong>Built-in reference patterns</strong>
            <span className="muted rules-group-count">read-only</span>
          </summary>
          <p className="muted">
            Always applied as the last resort, when nothing above matches. Add a rule above to override
            any of these for a specific transaction.
          </p>
          <div className="rules-builtin">
            {BUILT_IN_RULES.map((r) => {
              const isOpen = expandedBuiltIn.has(r.category);
              const shown = isOpen ? r.keywords : r.keywords.slice(0, BUILTIN_PREVIEW);
              const hiddenCount = r.keywords.length - shown.length;
              return (
                <div key={r.category} className="rules-builtin-cat">
                  <div className="rules-builtin-cat-name">
                    <span className="catdot" style={{ background: categoryColor(r.category) }} />
                    {r.category}
                  </div>
                  <div className="rules-chips">
                    {shown.map((k) => (
                      <span key={k} className="chip">
                        {k}
                      </span>
                    ))}
                    {hiddenCount > 0 && (
                      <button type="button" className="chip chip-more" onClick={() => toggleBuiltIn(r.category)}>
                        +{hiddenCount} more
                      </button>
                    )}
                    {isOpen && r.keywords.length > BUILTIN_PREVIEW && (
                      <button type="button" className="chip chip-more" onClick={() => toggleBuiltIn(r.category)}>
                        Show less
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      </section>
    </div>
  );
}
