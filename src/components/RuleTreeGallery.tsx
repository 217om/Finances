import { useMemo, useState } from 'react';
import type { CategoryRule, KeywordRule, SubRule, Transaction } from '../types';
import type { CardSnapshot } from '../lib/combine';
import { categoryColor, normalizeCategoryName, signatureOf } from '../lib/categorize';
import CategoryPicker from './CategoryPicker';

interface TreeNode {
  key: string;
  label: string;
  category?: string;
  count?: number;
  editKind?: 'keyword' | 'signature' | 'sub';
  editKey?: string;
  /** Which scope this node's underlying rule actually lives in — a merchant's
   *  diverting branch can be a global keyword rule even inside a card's own
   *  tree, so edits/deletes must be routed there, not hardcoded to whichever
   *  scope this gallery instance is showing. */
  scope: string;
  /** For a sub-category leaf: the keyword/signature text its rule is
   *  attached to (distinct from editKey, which is the sub-rule's own id) —
   *  needed to rename it (onSetSub) or delete it (onDeleteSub's info). */
  matchKey?: string;
}

interface TreeBranch {
  node: TreeNode;
  leaf?: TreeNode;
}

interface RuleTree {
  id: string;
  root: TreeNode;
  branches: TreeBranch[];
}

function subLeafFor(
  category: string,
  key: string,
  subByPair: Map<string, { rule: SubRule; scope: string }>,
  count?: number,
): TreeNode | undefined {
  const found = subByPair.get(`${category}|${key}`);
  if (!found) return undefined;
  const { rule: sr, scope } = found;
  return { key: sr.id, label: sr.sub, category, count, editKind: 'sub', editKey: sr.id, matchKey: key, scope };
}

/**
 * Builds one small tree per merchant rule (root = the merchant, branches =
 * where its transactions actually end up) plus one per keyword rule that
 * never shows up as a branch under any merchant tree. Branches are derived
 * from real transaction resolution, not from comparing keyword text — a
 * keyword rule only earns its own branch under a merchant's tree when it
 * demonstrably diverts at least one of that merchant's transactions to a
 * different category than the merchant rule's own.
 *
 * A diverting (or standalone) keyword/sub rule can come from either this
 * scope's own rules or the global set merged on top of them — `ownScope`
 * plus the `own*` id sets say which, so every node can carry the *actual*
 * scope its rule lives in for editing.
 */
function buildRuleTrees(
  ownScope: string,
  rules: CategoryRule[],
  keywordRules: KeywordRule[],
  effectiveKeywordRules: KeywordRule[],
  subRules: SubRule[],
  globalSubRules: SubRule[],
  countCardIds: string[],
  snapshotById: Map<string, CardSnapshot>,
): RuleTree[] {
  const sortedKeyword = [...effectiveKeywordRules].sort((a, b) => b.createdAt - a.createdAt);
  const ownKeywordSet = new Set(keywordRules.map((r) => r.keyword));
  const keywordScope = (kw: string) => (ownKeywordSet.has(kw) ? ownScope : 'global');

  // Sub-rules resolve the same additive way — this scope's own rule for a
  // given (parent, keyword) pair wins if one exists, else the global one.
  const subByPair = new Map<string, { rule: SubRule; scope: string }>();
  if (ownScope !== 'global') {
    for (const r of globalSubRules) subByPair.set(`${r.parent}|${r.keyword}`, { rule: r, scope: 'global' });
  }
  for (const r of subRules) subByPair.set(`${r.parent}|${r.keyword}`, { rule: r, scope: ownScope });

  const usedKeywords = new Set<string>();
  const trees: RuleTree[] = [];

  for (const rule of rules) {
    const sig = rule.signature;
    const txs: Transaction[] = [];
    for (const id of countCardIds) {
      const snap = snapshotById.get(id);
      if (!snap) continue;
      for (const t of snap.transactions) {
        if (t.amount < 0 && signatureOf(t.description) === sig) txs.push(t);
      }
    }

    const diverted = new Map<string, { category: string; count: number }>();
    let trunkCount = 0;
    for (const t of txs) {
      if (rule.excludedIds.includes(t.id)) continue;
      const desc = t.description.toLowerCase();
      const winner = sortedKeyword.find((k) => k.keyword && desc.includes(k.keyword));
      if (winner && winner.category !== rule.category) {
        const entry = diverted.get(winner.keyword);
        if (entry) entry.count++;
        else diverted.set(winner.keyword, { category: winner.category, count: 1 });
      } else {
        trunkCount++;
      }
    }

    const branches: TreeBranch[] = [
      {
        node: {
          key: `${sig}::trunk`,
          label: rule.category,
          category: rule.category,
          count: trunkCount,
          editKind: 'signature',
          editKey: sig,
          scope: ownScope,
        },
        leaf: subLeafFor(rule.category, sig, subByPair, trunkCount),
      },
    ];
    for (const [kw, { category, count }] of diverted) {
      usedKeywords.add(kw);
      branches.push({
        node: {
          key: `${sig}::${kw}`,
          label: `“${kw}” → ${category}`,
          category,
          count,
          editKind: 'keyword',
          editKey: kw,
          scope: keywordScope(kw),
        },
        leaf: subLeafFor(category, kw, subByPair, count),
      });
    }

    trees.push({
      id: `mr-${sig}`,
      root: { key: sig, label: rule.sample || sig, scope: ownScope },
      branches,
    });
  }

  for (const r of keywordRules) {
    if (usedKeywords.has(r.keyword)) continue;
    trees.push({
      id: `kw-${r.keyword}`,
      root: { key: r.keyword, label: `“${r.keyword}”`, scope: ownScope },
      branches: [
        {
          node: {
            key: `${r.keyword}::cat`,
            label: r.category,
            category: r.category,
            editKind: 'keyword',
            editKey: r.keyword,
            scope: ownScope,
          },
          leaf: subLeafFor(r.category, r.keyword, subByPair),
        },
      ],
    });
  }

  return trees;
}

function treeMatches(tree: RuleTree, needle: string): boolean {
  if (!needle) return true;
  const hit = (s: string | undefined) => !!s && s.toLowerCase().includes(needle);
  if (hit(tree.root.label)) return true;
  return tree.branches.some(
    (b) => hit(b.node.label) || hit(b.node.category) || hit(b.leaf?.label) || hit(b.leaf?.category),
  );
}

const ROOT_X = 26;
const BRANCH_X = 168;
const LEAF_X = 300;
const ROW_H = 46;
const PAD_Y = 14;
const CARD_W = 380;

interface EditPopoverProps {
  node: TreeNode;
  categoryOptions: string[];
  onCreateCategory: (scope: string, name: string) => void;
  onUpdateKeywordRuleCategory: (scope: string, keyword: string, category: string) => void;
  onDeleteKeywordRule: (scope: string, keyword: string, category: string) => void;
  onUpdateSignatureRuleCategory: (scope: string, signature: string, category: string) => void;
  onDeleteSignatureRule: (scope: string, signature: string, category: string) => void;
  onSetSub: (scope: string, parent: string, key: string, sub: string) => void;
  onDeleteSub: (scope: string, id: string, info: { parent: string; sub: string; keyword: string }) => void;
  onClose: () => void;
}

/** The popover a branch or leaf bubble opens — lets you change its category
 *  (branch) or rename it (leaf), or remove it, without leaving the gallery. */
function EditPopover({
  node,
  categoryOptions,
  onCreateCategory,
  onUpdateKeywordRuleCategory,
  onDeleteKeywordRule,
  onUpdateSignatureRuleCategory,
  onDeleteSignatureRule,
  onSetSub,
  onDeleteSub,
  onClose,
}: EditPopoverProps) {
  const [subDraft, setSubDraft] = useState(node.editKind === 'sub' ? node.label : '');

  if (node.editKind === 'sub' && node.editKey && node.matchKey) {
    const commit = () => {
      const trimmed = normalizeCategoryName(subDraft);
      if (trimmed && trimmed !== node.label && node.category) onSetSub(node.scope, node.category, node.matchKey!, trimmed);
      onClose();
    };
    return (
      <div className="tree-pop" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="rules-sub-input"
          value={subDraft}
          maxLength={28}
          onChange={(e) => setSubDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        <div className="tree-pop-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={commit}>
            Save
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              onDeleteSub(node.scope, node.key, { parent: node.category ?? '', sub: node.label, keyword: node.matchKey! });
              onClose();
            }}
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  if (node.editKind === 'keyword' && node.editKey) {
    return (
      <div className="tree-pop" onClick={(e) => e.stopPropagation()}>
        <CategoryPicker
          value={node.category ?? ''}
          onChange={(cat) => {
            onUpdateKeywordRuleCategory(node.scope, node.editKey!, cat);
            onClose();
          }}
          options={categoryOptions}
          onCreate={(name) => onCreateCategory(node.scope, name)}
        />
        <div className="tree-pop-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              onDeleteKeywordRule(node.scope, node.editKey!, node.category ?? '');
              onClose();
            }}
          >
            Remove rule
          </button>
        </div>
      </div>
    );
  }

  if (node.editKind === 'signature' && node.editKey) {
    return (
      <div className="tree-pop" onClick={(e) => e.stopPropagation()}>
        <CategoryPicker
          value={node.category ?? ''}
          onChange={(cat) => {
            onUpdateSignatureRuleCategory(node.scope, node.editKey!, cat);
            onClose();
          }}
          options={categoryOptions}
          onCreate={(name) => onCreateCategory(node.scope, name)}
        />
        <div className="tree-pop-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              onDeleteSignatureRule(node.scope, node.editKey!, node.category ?? '');
              onClose();
            }}
          >
            Remove rule
          </button>
        </div>
      </div>
    );
  }

  return null;
}

interface TreeCardProps {
  tree: RuleTree;
  openKey: string | null;
  onOpen: (key: string | null) => void;
  popoverProps: Omit<EditPopoverProps, 'node' | 'onClose'>;
}

function TreeCard({ tree, openKey, onOpen, popoverProps }: TreeCardProps) {
  const rootY = (tree.branches.length * ROW_H) / 2 + PAD_Y;
  const height = tree.branches.length * ROW_H + PAD_Y * 2;
  const branchY = (i: number) => i * ROW_H + ROW_H / 2 + PAD_Y;

  return (
    <div className="tree-card" style={{ width: CARD_W, height }}>
      <svg className="tree-lines" viewBox={`0 0 ${CARD_W} ${height}`} preserveAspectRatio="none">
        {tree.branches.map((b, i) => (
          <g key={b.node.key}>
            <line x1={ROOT_X + 44} y1={rootY} x2={BRANCH_X - 60} y2={branchY(i)} stroke="var(--border)" strokeWidth="1.5" />
            {b.leaf && (
              <line
                x1={BRANCH_X + 90}
                y1={branchY(i)}
                x2={LEAF_X - 56}
                y2={branchY(i)}
                stroke="var(--border)"
                strokeWidth="1.5"
              />
            )}
          </g>
        ))}
      </svg>

      <div className="tree-bubble tree-bubble-root" style={{ left: ROOT_X, top: rootY }} title={tree.root.label}>
        {tree.root.label}
      </div>

      {tree.branches.map((b, i) => (
        <div key={b.node.key}>
          <button
            type="button"
            className="tree-bubble tree-bubble-cat"
            style={{
              left: BRANCH_X,
              top: branchY(i),
              background: b.node.category ? categoryColor(b.node.category) : undefined,
            }}
            title={b.node.label}
            onClick={() => onOpen(openKey === b.node.key ? null : b.node.key)}
          >
            <span className="tree-bubble-label">{b.node.label}</span>
            {b.node.count != null && <span className="tree-bubble-count">{b.node.count}</span>}
          </button>
          {openKey === b.node.key && (
            <div className="tree-pop-anchor" style={{ left: BRANCH_X, top: branchY(i) + 26 }}>
              <EditPopover node={b.node} onClose={() => onOpen(null)} {...popoverProps} />
            </div>
          )}

          {b.leaf && (
            <>
              <button
                type="button"
                className="tree-bubble tree-bubble-leaf"
                style={{
                  left: LEAF_X,
                  top: branchY(i),
                  background: b.leaf.category ? categoryColor(b.leaf.category) : undefined,
                }}
                title={b.leaf.label}
                onClick={() => onOpen(openKey === b.leaf!.key ? null : b.leaf!.key)}
              >
                <span className="tree-bubble-label">{b.leaf.label}</span>
                {b.leaf.count != null && <span className="tree-bubble-count">{b.leaf.count}</span>}
              </button>
              {openKey === b.leaf.key && (
                <div className="tree-pop-anchor" style={{ left: LEAF_X, top: branchY(i) + 26 }}>
                  <EditPopover node={b.leaf} onClose={() => onOpen(null)} {...popoverProps} />
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

interface Props {
  /** The scope this gallery's OWN rules belong to — 'global', or a card id. */
  ownScope: string;
  rules: CategoryRule[];
  keywordRules: KeywordRule[];
  /** Same array as keywordRules when ownScope is 'global'; otherwise the
   *  global set merged on top — a diverting branch's scope is attributed by
   *  checking whether its keyword is in `keywordRules` (own) or not (global). */
  effectiveKeywordRules: KeywordRule[];
  subRules: SubRule[];
  globalSubRules: SubRule[];
  countCardIds: string[];
  snapshotById: Map<string, CardSnapshot>;
  query: string;
  categoryOptions: string[];
  onCreateCategory: (scope: string, name: string) => void;
  onUpdateKeywordRuleCategory: (scope: string, keyword: string, category: string) => void;
  onDeleteKeywordRule: (scope: string, keyword: string, category: string) => void;
  onUpdateSignatureRuleCategory: (scope: string, signature: string, category: string) => void;
  onDeleteSignatureRule: (scope: string, signature: string, category: string) => void;
  onSetSub: (scope: string, parent: string, key: string, sub: string) => void;
  onDeleteSub: (scope: string, id: string, info: { parent: string; sub: string; keyword: string }) => void;
}

/**
 * Always-visible gallery of small trees, one per merchant rule and one per
 * "standalone" keyword rule (a keyword that never diverts a merchant's own
 * transactions elsewhere). Meant as an overview next to the full rule list
 * below — click a colored bubble to change its category or sub-category
 * without hunting through the list.
 */
export default function RuleTreeGallery({
  ownScope,
  rules,
  keywordRules,
  effectiveKeywordRules,
  subRules,
  globalSubRules,
  countCardIds,
  snapshotById,
  query,
  categoryOptions,
  onCreateCategory,
  onUpdateKeywordRuleCategory,
  onDeleteKeywordRule,
  onUpdateSignatureRuleCategory,
  onDeleteSignatureRule,
  onSetSub,
  onDeleteSub,
}: Props) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  const trees = useMemo(
    () =>
      buildRuleTrees(
        ownScope,
        rules,
        keywordRules,
        effectiveKeywordRules,
        subRules,
        globalSubRules,
        countCardIds,
        snapshotById,
      ),
    [ownScope, rules, keywordRules, effectiveKeywordRules, subRules, globalSubRules, countCardIds, snapshotById],
  );

  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => trees.filter((t) => treeMatches(t, needle)), [trees, needle]);

  if (trees.length === 0) return null;

  const popoverProps = {
    categoryOptions,
    onCreateCategory,
    onUpdateKeywordRuleCategory,
    onDeleteKeywordRule,
    onUpdateSignatureRuleCategory,
    onDeleteSignatureRule,
    onSetSub,
    onDeleteSub,
  };

  return (
    <div className="tree-gallery">
      {shown.length === 0 ? (
        <p className="muted rules-empty">No rule trees match “{query}”.</p>
      ) : (
        shown.map((tree) => (
          <TreeCard key={tree.id} tree={tree} openKey={openKey} onOpen={setOpenKey} popoverProps={popoverProps} />
        ))
      )}
    </div>
  );
}
