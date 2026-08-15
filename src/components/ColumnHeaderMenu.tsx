import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  label: string;
  align?: 'left' | 'right';
  /** Omit all four to disable sorting — filter-only header. */
  sortActive?: boolean;
  sortDir?: 'asc' | 'desc';
  ascLabel?: string;
  descLabel?: string;
  onSort?: (dir: 'asc' | 'desc') => void;
  /** Omit both to disable the checklist filter — sort-only header. */
  filterValues?: string[];
  /** null means "everything selected" (no filter applied). */
  selectedValues?: Set<string> | null;
  onChangeSelected?: (next: Set<string> | null) => void;
}

interface Position {
  top: number;
  left?: number;
  right?: number;
}

/**
 * Excel-style column header: click to open a menu with "sort ascending" /
 * "sort descending" (where applicable) and, for columns with a bounded set
 * of values, a searchable checklist to show only specific ones plus an
 * explicit "Clear filter" action — same interaction as an AutoFilter
 * dropdown. The whole header cell is the click target, not just an icon.
 *
 * The popup itself is rendered into a portal at the document root, positioned
 * from the trigger button's own screen coordinates, rather than as a normal
 * absolutely-positioned child — the table it lives in scrolls, and a plain
 * absolute child gets silently clipped by that scroll container whenever the
 * (possibly filtered-down-to-nothing) table is shorter than the popup.
 */
export default function ColumnHeaderMenu({
  label,
  align = 'left',
  sortActive,
  sortDir,
  ascLabel,
  descLabel,
  onSort,
  filterValues,
  selectedValues,
  onChangeSelected,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<Position | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    // Scrolling (the table body, or the page) would leave a fixed-position
    // popup stranded away from its trigger — closing is simpler and more
    // predictable than continuously re-tracking its position.
    const onScroll = () => setOpen(false);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos(
      align === 'right'
        ? { top: rect.bottom + 6, right: window.innerWidth - rect.right }
        : { top: rect.bottom + 6, left: rect.left },
    );
  }, [open, align]);

  const hasFilter = filterValues !== undefined && onChangeSelected !== undefined;
  const total = filterValues?.length ?? 0;
  const selectedCount = selectedValues ? selectedValues.size : total;
  const isFiltered = hasFilter && selectedCount < total;
  const allChecked = selectedCount === total;
  const noneChecked = selectedCount === 0;

  const shownValues = useMemo(() => {
    if (!filterValues) return [];
    const q = search.trim().toLowerCase();
    return q ? filterValues.filter((v) => v.toLowerCase().includes(q)) : filterValues;
  }, [filterValues, search]);

  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = !allChecked && !noneChecked;
  }, [allChecked, noneChecked]);

  const toggleAll = () => {
    if (!onChangeSelected) return;
    onChangeSelected(allChecked ? new Set() : null);
  };
  const toggleOne = (v: string) => {
    if (!onChangeSelected || !filterValues) return;
    const base = selectedValues ?? new Set(filterValues);
    const next = new Set(base);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChangeSelected(next.size === filterValues.length ? null : next);
  };

  return (
    <div className={`col-menu ${align === 'right' ? 'col-menu-right' : ''}`} ref={ref}>
      <button type="button" className="col-menu-btn" ref={btnRef} onClick={() => setOpen((o) => !o)}>
        <span className="col-menu-label">{label}</span>
        {sortActive && <span className="col-menu-sort-ind">{sortDir === 'asc' ? '▲' : '▼'}</span>}
        {isFiltered && <span className="col-menu-filter-dot" title="Filtered" />}
        <svg className="col-menu-caret" viewBox="0 0 10 6" width="9" height="6" aria-hidden="true">
          <path d="M0 0 L10 0 L5 6 Z" fill="currentColor" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            className="menu-pop col-menu-pop"
            role="menu"
            ref={popupRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left ?? 'auto', right: pos.right ?? 'auto' }}
          >
            {onSort && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSort('asc');
                    setOpen(false);
                  }}
                >
                  {ascLabel}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSort('desc');
                    setOpen(false);
                  }}
                >
                  {descLabel}
                </button>
              </>
            )}
            {hasFilter && filterValues && filterValues.length > 0 && (
              <>
                {onSort && <div className="menu-sep" />}
                {isFiltered && (
                  <button
                    type="button"
                    role="menuitem"
                    className="col-menu-clear"
                    onClick={() => {
                      onChangeSelected?.(null);
                      setOpen(false);
                    }}
                  >
                    ✕ Clear filter
                  </button>
                )}
                <div className="menu-sep" />
                <input
                  className="col-menu-search"
                  autoFocus
                  value={search}
                  placeholder="Search…"
                  onChange={(e) => setSearch(e.target.value)}
                />
                <label className="filter-check col-menu-selectall">
                  <input ref={selectAllRef} type="checkbox" checked={allChecked} onChange={toggleAll} />
                  Select all
                </label>
                <div className="col-menu-list">
                  {shownValues.map((v) => (
                    <label key={v} className="filter-check">
                      <input
                        type="checkbox"
                        checked={!selectedValues || selectedValues.has(v)}
                        onChange={() => toggleOne(v)}
                      />
                      {v}
                    </label>
                  ))}
                  {shownValues.length === 0 && <div className="muted col-menu-empty">No matches</div>}
                </div>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
