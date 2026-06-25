import { useState } from 'react';
import { normalizeCategoryName } from '../lib/categorize';

interface Props {
  value: string;
  onChange: (category: string) => void;
  options: string[];
  /** Create a brand-new category; should persist it and make it reusable. */
  onCreate: (name: string) => void;
  /** Optional leading "keep" choice (used by the leftovers step). */
  keepValue?: string;
  keepLabel?: string;
}

const NEW = '__new__';

/**
 * A category dropdown with an inline "Create new category…" affordance. Picking
 * that option swaps the select for a small text input so the user can name a
 * custom category on the spot.
 */
export default function CategoryPicker({
  value,
  onChange,
  options,
  onCreate,
  keepValue,
  keepLabel,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');

  const commit = () => {
    const name = normalizeCategoryName(text);
    if (!name) {
      setAdding(false);
      setText('');
      return;
    }
    // Reuse an existing option if the name matches (case-insensitive).
    const existing = options.find((o) => o.toLowerCase() === name.toLowerCase());
    if (existing) {
      onChange(existing);
    } else {
      onCreate(name);
      onChange(name);
    }
    setAdding(false);
    setText('');
  };

  if (adding) {
    return (
      <span className="catpick-add">
        <input
          autoFocus
          value={text}
          placeholder="New category name"
          maxLength={28}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setAdding(false);
              setText('');
            }
          }}
        />
        <button type="button" className="btn btn-primary btn-sm" onClick={commit}>
          Add
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setAdding(false);
            setText('');
          }}
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === NEW) setAdding(true);
        else onChange(e.target.value);
      }}
    >
      {keepValue !== undefined && <option value={keepValue}>{keepLabel ?? 'Keep'}</option>}
      {options.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
      <option value={NEW}>➕ Create new category…</option>
    </select>
  );
}
