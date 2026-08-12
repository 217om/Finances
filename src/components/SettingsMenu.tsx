import { useEffect, useRef, useState } from 'react';
import { currencyOptions } from '../lib/format';

interface Props {
  currency: string;
  onCurrencyChange: (code: string) => void;
  monthStartDay: number;
  onMonthStartChange: (day: number) => void;
  weekStartDay: number;
  onWeekStartChange: (day: number) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  hasData: boolean;
  onClearAll: () => void;
  onClearTransactionsOnly: () => void;
  onExportJSON: () => void;
  onExportCSV: () => void;
  onExportFullBackup: () => void;
  onRestoreFullBackup: (file: File) => void;
}

const ORDINALS = ['', '1st', '2nd', '3rd', ...Array.from({ length: 25 }, (_, i) => `${i + 4}th`)];

// Index matches Date#getUTCDay (0 = Sunday .. 6 = Saturday), same convention
// lib/aggregate.ts's startOfWeek uses.
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Everything that isn't a day-to-day action — appearance, month-start day,
 * currency, and the data/backup tools — gathered under one icon so the
 * header itself only shows the card picker and "Manage cards".
 */
export default function SettingsMenu({
  currency,
  onCurrencyChange,
  monthStartDay,
  onMonthStartChange,
  weekStartDay,
  onWeekStartChange,
  theme,
  onToggleTheme,
  hasData,
  onClearAll,
  onClearTransactionsOnly,
  onExportJSON,
  onExportCSV,
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
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        onClick={() => setOpen((o) => !o)}
        title="Settings"
        aria-label="Settings"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeWidth="2.4" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <rect
              key={deg}
              x="10.8"
              y="2.8"
              width="2.4"
              height="4.6"
              rx="0.6"
              fill="currentColor"
              transform={`rotate(${deg} 12 12)`}
            />
          ))}
        </svg>
      </button>
      {open && (
        <div className="menu-pop settings-pop" role="menu">
          <div className="menu-section-label">Appearance</div>
          <button type="button" role="menuitem" onClick={pick(onToggleTheme)}>
            {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          </button>

          <div className="menu-sep" />
          <div className="menu-section-label">Preferences</div>
          <label className="picker settings-field" title="The day each month starts on, e.g. your payday">
            <span className="picker-label">Month starts</span>
            <select value={monthStartDay} onChange={(e) => onMonthStartChange(Number(e.target.value))}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? '1st (calendar)' : ORDINALS[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="picker settings-field" title="Which day the weekly chart's bars start on">
            <span className="picker-label">Week starts</span>
            <select value={weekStartDay} onChange={(e) => onWeekStartChange(Number(e.target.value))}>
              {WEEKDAY_NAMES.map((name, d) => (
                <option key={d} value={d}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="picker settings-field">
            <span className="picker-label">Currency</span>
            <select value={currency} onChange={(e) => onCurrencyChange(e.target.value)}>
              {currencyOptions().map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <div className="menu-sep" />
          <div className="menu-section-label">Data</div>
          <button type="button" role="menuitem" onClick={pick(onExportFullBackup)}>
            Download full backup (all cards)
          </button>
          <button type="button" role="menuitem" onClick={pick(() => restoreInputRef.current?.click())}>
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
              <button
                type="button"
                role="menuitem"
                className="menu-danger"
                onClick={pick(onClearTransactionsOnly)}
              >
                Clear transactions only…
              </button>
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
