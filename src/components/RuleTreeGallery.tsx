import { useMemo, useRef, useState } from 'react';
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

const ROOT_X = 14;
const ROOT_W = 84;
const BRANCH_X = 120;
const LEAF_X = 216;
const ROW_H = 30;
const PAD_Y = 8;
const TREE_CELL_W = 280;

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

function treeHeight(tree: RuleTree): number {
  return Math.max(1, tree.branches.length) * ROW_H + PAD_Y * 2;
}

/** One tree's connecting lines, offset into a shared canvas coordinate
 *  space — meant to sit inside one big <svg> covering every tree at once. */
function TreeLines({ tree, offsetX, offsetY }: { tree: RuleTree; offsetX: number; offsetY: number }) {
  const rootY = offsetY + (tree.branches.length * ROW_H) / 2 + PAD_Y;
  const branchY = (i: number) => offsetY + i * ROW_H + ROW_H / 2 + PAD_Y;
  const rootRightEdge = offsetX + ROOT_X + ROOT_W;
  const branchX = offsetX + BRANCH_X;
  const leafX = offsetX + LEAF_X;
  return (
    <>
      {tree.branches.map((b, i) => (
        <g key={b.node.key}>
          <line x1={rootRightEdge} y1={rootY} x2={branchX - 42} y2={branchY(i)} stroke="var(--border)" strokeWidth="1.5" />
          {b.leaf && (
            <line x1={branchX + 42} y1={branchY(i)} x2={leafX - 36} y2={branchY(i)} stroke="var(--border)" strokeWidth="1.5" />
          )}
        </g>
      ))}
    </>
  );
}

interface TreeBubblesProps {
  tree: RuleTree;
  offsetX: number;
  offsetY: number;
  openKey: string | null;
  onOpen: (key: string | null) => void;
  popoverProps: Omit<EditPopoverProps, 'node' | 'onClose'>;
}

/** One tree's root/branch/leaf bubbles, offset into the same shared canvas
 *  coordinate space as TreeLines. */
function TreeBubbles({ tree, offsetX, offsetY, openKey, onOpen, popoverProps }: TreeBubblesProps) {
  const branchY = (i: number) => offsetY + i * ROW_H + ROW_H / 2 + PAD_Y;
  const rootY = offsetY + (tree.branches.length * ROW_H) / 2 + PAD_Y;
  const rootX = offsetX + ROOT_X;
  const branchX = offsetX + BRANCH_X;
  const leafX = offsetX + LEAF_X;

  return (
    <>
      <div
        className="tree-bubble tree-bubble-root"
        style={{ left: rootX, top: rootY, width: ROOT_W }}
        title={tree.root.label}
      >
        <span className="tree-bubble-label">{tree.root.label}</span>
      </div>

      {tree.branches.map((b, i) => (
        <div key={b.node.key}>
          <button
            type="button"
            className="tree-bubble tree-bubble-cat"
            style={{
              left: branchX,
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
            <div className="tree-pop-anchor" style={{ left: branchX, top: branchY(i) + 18 }}>
              <EditPopover node={b.node} onClose={() => onOpen(null)} {...popoverProps} />
            </div>
          )}

          {b.leaf && (
            <>
              <button
                type="button"
                className="tree-bubble tree-bubble-leaf"
                style={{
                  left: leafX,
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
                <div className="tree-pop-anchor" style={{ left: leafX, top: branchY(i) + 18 }}>
                  <EditPopover node={b.leaf} onClose={() => onOpen(null)} {...popoverProps} />
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </>
  );
}

const COLUMNS = 3;
const CELL_GAP_X = 24;
const CELL_GAP_Y = 20;
const CANVAS_PAD = 16;
const VIEWPORT_H = 320;
const DRAG_THRESHOLD = 4;

interface DragState {
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
  dragging: boolean;
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
 * Always-visible, single pannable widget holding every tree at once — one
 * per merchant rule, one per "standalone" keyword rule (a keyword that never
 * diverts a merchant's own transactions elsewhere). Trees sit on a shared
 * virtual canvas usually larger than the visible viewport; drag anywhere in
 * the widget to pan around it. Click a colored bubble to change its category
 * or sub-category without hunting through the list below.
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
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const justDraggedRef = useRef(false);

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

  const layout = useMemo(() => {
    const cellW = TREE_CELL_W + CELL_GAP_X;
    const items: { tree: RuleTree; x: number; y: number }[] = [];
    let y = CANVAS_PAD;
    for (let i = 0; i < shown.length; i += COLUMNS) {
      const row = shown.slice(i, i + COLUMNS);
      const rowH = Math.max(...row.map(treeHeight));
      row.forEach((tree, c) => items.push({ tree, x: CANVAS_PAD + c * cellW, y }));
      y += rowH + CELL_GAP_Y;
    }
    const cols = Math.min(COLUMNS, shown.length);
    const width = cols > 0 ? CANVAS_PAD * 2 + cols * cellW - CELL_GAP_X : 0;
    return { items, width, height: y };
  }, [shown]);

  const clampPan = (p: { x: number; y: number }) => {
    const vp = viewportRef.current;
    const vw = vp?.clientWidth ?? 0;
    const vh = vp?.clientHeight ?? VIEWPORT_H;
    const minX = Math.min(0, vw - layout.width);
    const minY = Math.min(0, vh - layout.height);
    return { x: Math.min(0, Math.max(minX, p.x)), y: Math.min(0, Math.max(minY, p.y)) };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y, dragging: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.dragging && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
      d.dragging = true;
      // Capture only once a real drag is confirmed — capturing on every
      // pointerdown (even a plain click) can suppress the click event that
      // would otherwise fire on the bubble underneath, since click synthesis
      // compares the pointerdown/pointerup targets and capture redirects the
      // up-target to this element.
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (d.dragging) setPan(clampPan({ x: d.startPanX + dx, y: d.startPanY + dy }));
  };
  const onPointerUp = () => {
    if (dragRef.current?.dragging) justDraggedRef.current = true;
    dragRef.current = null;
  };
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (justDraggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      justDraggedRef.current = false;
    }
  };

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
        <div
          className="tree-canvas-viewport"
          ref={viewportRef}
          style={{ height: Math.min(VIEWPORT_H, Math.max(140, layout.height + 8)) }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClickCapture={onClickCapture}
        >
          <div
            className="tree-canvas-content"
            style={{ width: layout.width, height: layout.height, transform: `translate(${pan.x}px, ${pan.y}px)` }}
          >
            <svg className="tree-lines" width={layout.width} height={layout.height}>
              {layout.items.map(({ tree, x, y }) => (
                <TreeLines key={tree.id} tree={tree} offsetX={x} offsetY={y} />
              ))}
            </svg>
            {layout.items.map(({ tree, x, y }) => (
              <TreeBubbles
                key={tree.id}
                tree={tree}
                offsetX={x}
                offsetY={y}
                openKey={openKey}
                onOpen={setOpenKey}
                popoverProps={popoverProps}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
