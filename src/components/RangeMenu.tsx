import { useEffect, useRef, useState } from 'react';

export interface RangeMenuOption {
  key: string;
  label: string;
}

interface Props {
  options: RangeMenuOption[];
  activeKey: string;
  onSelect: (key: string) => void;
}

/** A deliberately low-key range picker — reads as a plain word inside a
 *  sentence ("Sized by spending, month to date.") that happens to open a
 *  small menu when clicked, rather than a visible control competing with the
 *  rest of the panel for attention. */
export default function RangeMenu({ options, activeKey, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const active = options.find((o) => o.key === activeKey);

  return (
    <span className="menu range-menu" ref={ref}>
      <button
        type="button"
        className="linklike range-menu-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {(active?.label ?? activeKey).toLowerCase()}
      </button>
      {open && (
        <div className="menu-pop range-menu-pop" role="menu">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              role="menuitem"
              className={o.key === activeKey ? 'compare-menu-active' : ''}
              onClick={() => {
                setOpen(false);
                onSelect(o.key);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
