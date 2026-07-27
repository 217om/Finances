import { useEffect, useRef, useState } from 'react';
import { COMBINE_CARD_ID, type Card } from '../lib/cards';

interface Props {
  cards: Card[];
  activeCardId: string;
  combineEnabled: boolean;
  onSwitchCard: (id: string) => void;
}

/**
 * A custom dropdown (not a native <select>) for the Card picker, so the
 * "Combine all cards" entry can get its own accent color/spacing without
 * relying on browser-controlled native <option> styling — which is
 * inconsistent across browsers for both color scoping and row spacing.
 */
export default function CardSelector({ cards, activeCardId, combineEnabled, onSwitchCard }: Props) {
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

  const activeCard = cards.find((c) => c.id === activeCardId);
  const label = combineEnabled ? '⬡ Combine all cards' : activeCard?.name ?? 'Select card';

  const pick = (id: string) => () => {
    setOpen(false);
    onSwitchCard(id);
  };

  return (
    <div className="picker card-selector" ref={ref} title="Which card/account you're analyzing">
      <span className="picker-label">Card</span>
      <button
        type="button"
        className={`card-selector-btn ${combineEnabled ? 'card-selector-btn-combined' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {label}
        <span className="card-selector-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="menu-pop card-selector-pop" role="listbox">
          {cards.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={!combineEnabled && c.id === activeCardId}
              onClick={pick(c.id)}
            >
              {c.name}
            </button>
          ))}
          {cards.length > 1 && (
            <>
              <div className="menu-sep" />
              <button
                type="button"
                role="option"
                aria-selected={combineEnabled}
                className="card-option-combine"
                onClick={pick(COMBINE_CARD_ID)}
              >
                ⬡ Combine all cards
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
