import { useState } from 'react';

interface Props {
  note?: string;
  onSave: (note: string) => void;
}

/** A small per-transaction note: an icon button that expands, in place, into
 *  a tiny textarea + Save/Cancel. Inline rather than a floating popover so it
 *  never gets clipped by a scrollable table wrapper. Optional and empty by
 *  default — the button itself shows whether a note is present so a whole
 *  table of them scans at a glance. */
export default function TxNoteCell({ note, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? '');

  const startEdit = () => {
    setDraft(note ?? '');
    setEditing(true);
  };

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed !== (note ?? '')) onSave(trimmed);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        className={`tx-note-btn ${note ? 'tx-note-btn-filled' : ''}`}
        title={note || 'Add a note'}
        aria-label={note ? `Note: ${note}` : 'Add a note'}
        onClick={startEdit}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6A1.5 1.5 0 0 1 12.5 11H6.4L3.5 13.3a.5.5 0 0 1-.8-.4V11h-.2A1.5 1.5 0 0 1 1 9.5v-6Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    );
  }

  return (
    <div className="tx-note-edit">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Add a note…"
        rows={2}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
          else if (e.key === 'Escape') setEditing(false);
        }}
      />
      <div className="tx-note-edit-actions">
        {note && (
          <button
            type="button"
            className="linklike tx-note-remove"
            onClick={() => {
              onSave('');
              setEditing(false);
            }}
          >
            Remove
          </button>
        )}
        <button type="button" className="linklike" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
