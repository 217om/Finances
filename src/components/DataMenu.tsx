import { useEffect, useRef, useState } from 'react';

interface Props {
  hasData: boolean;
  onExportJSON: () => void;
  onExportCSV: () => void;
  onClearAll: () => void;
  onExportFullBackup: () => void;
  onRestoreFullBackup: (file: File) => void;
}

/** Small dropdown gathering the data actions: backup, CSV export, clear. */
export default function DataMenu({
  hasData,
  onExportJSON,
  onExportCSV,
  onClearAll,
  onExportFullBackup,
  onRestoreFullBackup,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

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
          <button type="button" role="menuitem" onClick={pick(onExportFullBackup)}>
            Download full backup (all cards)
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={pick(() => restoreInputRef.current?.click())}
          >
            Restore full backup…
          </button>
          {hasData && (
            <>
              <div className="menu-sep" />
              <button type="button" role="menuitem" onClick={pick(onExportJSON)}>
                Download backup (this card, JSON)
              </button>
              <button type="button" role="menuitem" onClick={pick(onExportCSV)}>
                Export transactions (CSV)
              </button>
              <div className="menu-sep" />
              <button type="button" role="menuitem" className="menu-danger" onClick={pick(onClearAll)}>
                Clear all data…
              </button>
            </>
          )}
        </div>
      )}
      <input
        ref={restoreInputRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onRestoreFullBackup(file);
        }}
      />
    </div>
  );
}
