import { useEffect, useRef, useState } from 'react';
import { dayLabel } from '../lib/format';

export interface CompareOption {
  key: string;
  label: string;
  range: { from: string; to: string };
}

interface Props {
  options: CompareOption[];
  activeKey: string | null;
  onSelect: (key: string | null) => void;
}

/** One button that offers period-aware comparisons for whichever preset is
 *  currently active on the Dashboard — the options themselves come from the
 *  caller, already tailored to that preset (e.g. week-to-date offers "last
 *  week", month-to-date doesn't). Disabled entirely for a hand-typed custom
 *  range, where "compare to what" has no obvious answer. */
export default function CompareMenu({ options, activeKey, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const active = options.find((o) => o.key === activeKey) ?? null;
  const disabled = options.length === 0;

  const pick = (key: string | null) => () => {
    setOpen(false);
    onSelect(key);
  };

  return (
    <div className="menu compare-menu" ref={ref}>
      <button
        type="button"
        className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        title={disabled ? 'Pick a preset above to compare periods' : 'Compare this period to another'}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {active ? `Compare: ${active.label}` : 'Compare'}
        <span className="compare-menu-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="menu-pop compare-menu-pop" role="menu">
          {active && (
            <>
              <button type="button" role="menuitem" className="menu-danger" onClick={pick(null)}>
                ✕ Turn off comparison
              </button>
              <div className="menu-sep" />
            </>
          )}
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              role="menuitem"
              className={o.key === activeKey ? 'compare-menu-active' : ''}
              onClick={pick(o.key)}
            >
              <span className="compare-menu-item-label">{o.label}</span>
              <span className="muted compare-menu-item-range">
                {dayLabel(o.range.from)} – {dayLabel(o.range.to)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
