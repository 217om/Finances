import { useEffect, useRef, useState } from 'react';

interface Props {
  onExportJSON: () => void;
  onExportCSV: () => void;
  onClearAll: () => void;
}

/** Small dropdown gathering the data actions: backup, CSV export, clear. */
export default function DataMenu({ onExportJSON, onExportCSV, onClearAll }: Props) {
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

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="menu" ref={ref}>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen((o) => !o)}>
        Data ▾
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <button type="button" role="menuitem" onClick={pick(onExportJSON)}>
            Download backup (JSON)
          </button>
          <button type="button" role="menuitem" onClick={pick(onExportCSV)}>
            Export transactions (CSV)
          </button>
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="menu-danger" onClick={pick(onClearAll)}>
            Clear all data…
          </button>
        </div>
      )}
    </div>
  );
}
