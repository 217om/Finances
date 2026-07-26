import { useEffect, useRef, useState } from 'react';
import { deleteNote, getAllNotes, makeNote, saveNote, type Note } from '../lib/notes';
import { evalNote, formatResult } from '../lib/notesCalc';

const SAVE_DEBOUNCE_MS = 400;

/**
 * A floating notepad available on every page, independent of which card is
 * active. Supports multiple notes and a small inline calculator: any line
 * like "rent = 500" or "total = rent + food" is evaluated live, with
 * variables carrying down through the rest of that note.
 */
export default function NotesWidget() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [bodyDraft, setBodyDraft] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const notesRef = useRef(notes);
  notesRef.current = notes;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const bodyDraftRef = useRef(bodyDraft);
  bodyDraftRef.current = bodyDraft;
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<number | null>(null);

  // Load notes lazily — only once the widget is actually opened, so it never
  // adds to the app's critical startup path.
  useEffect(() => {
    if (!open || loaded) return;
    setLoaded(true);
    (async () => {
      const all = await getAllNotes().catch(() => [] as Note[]);
      if (all.length === 0) {
        const first = makeNote('Note 1');
        await saveNote(first).catch(() => {});
        setNotes([first]);
        setActiveId(first.id);
        setBodyDraft('');
      } else {
        setNotes(all);
        setActiveId(all[0].id);
        setBodyDraft(all[0].body);
      }
    })();
  }, [open, loaded]);

  function flushSave() {
    const id = activeIdRef.current;
    if (!id) return;
    const body = bodyDraftRef.current;
    const current = notesRef.current.find((n) => n.id === id);
    if (!current || current.body === body) return;
    const updated: Note = { ...current, body, updatedAt: Date.now() };
    setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
    void saveNote(updated);
  }

  function handleBodyChange(value: string) {
    setBodyDraft(value);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }

  function selectNote(id: string) {
    if (id === activeId) return;
    flushSave();
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const note = notesRef.current.find((n) => n.id === id);
    setActiveId(id);
    setBodyDraft(note?.body ?? '');
  }

  function addNote() {
    flushSave();
    const n = makeNote(`Note ${notesRef.current.length + 1}`);
    void saveNote(n);
    setNotes((prev) => [n, ...prev]);
    setActiveId(n.id);
    setBodyDraft('');
  }

  function removeNote(id: string) {
    if (!confirm('Delete this note? This cannot be undone.')) return;
    void deleteNote(id);
    setNotes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      if (id === activeIdRef.current) {
        const fallback = next[0];
        setActiveId(fallback?.id ?? null);
        setBodyDraft(fallback?.body ?? '');
      }
      return next;
    });
  }

  function startRename(n: Note) {
    setRenamingId(n.id);
    setRenameValue(n.title);
  }

  function commitRename() {
    const id = renamingId;
    setRenamingId(null);
    if (!id) return;
    const title = renameValue.trim();
    if (!title) return;
    setNotes((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, title, updatedAt: n.updatedAt } : n));
      const updated = next.find((n) => n.id === id);
      if (updated) void saveNote(updated);
      return next;
    });
  }

  function toggleOpen() {
    setOpen((prev) => {
      if (prev) {
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        flushSave();
      }
      return !prev;
    });
  }

  const activeNote = notes.find((n) => n.id === activeId) ?? null;
  const lines = bodyDraft.split('\n');
  const results = evalNote(bodyDraft);

  return (
    <div className="notes-fab-wrap">
      <button type="button" className="notes-fab" onClick={toggleOpen} title="Notes" aria-label="Notes">
        📝
      </button>

      {open && (
        <div className="notes-panel">
          <div className="notes-panel-head">
            <h2>Notes</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={toggleOpen}>
              ✕
            </button>
          </div>

          <div className="notes-tabs">
            {notes.map((n) => (
              <div key={n.id} className={`notes-tab ${n.id === activeId ? 'notes-tab-active' : ''}`}>
                {renamingId === n.id ? (
                  <input
                    autoFocus
                    className="notes-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="notes-tab-btn"
                    title="Click to open, double-click to rename"
                    onClick={() => selectNote(n.id)}
                    onDoubleClick={() => startRename(n)}
                  >
                    {n.title || 'Untitled'}
                  </button>
                )}
                <button
                  type="button"
                  className="notes-tab-del"
                  title="Delete note"
                  onClick={() => removeNote(n.id)}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="notes-tab-add" onClick={addNote}>
              + New
            </button>
          </div>

          {activeNote ? (
            <>
              <div className="notes-editor">
                <textarea
                  className="notes-lines"
                  value={bodyDraft}
                  spellCheck={false}
                  placeholder={'Write anything. Try:\nrent = 500\nfood = 200\ntotal = rent + food'}
                  onChange={(e) => handleBodyChange(e.target.value)}
                  onScroll={(e) => {
                    if (resultsRef.current) resultsRef.current.scrollTop = e.currentTarget.scrollTop;
                  }}
                />
                <div className="notes-results" ref={resultsRef}>
                  {lines.map((_, i) => {
                    const r = results[i];
                    return (
                      <div key={i} className="notes-result-row">
                        {r ? `= ${formatResult(r.value)}` : ''}
                      </div>
                    );
                  })}
                </div>
              </div>
              <p className="muted notes-hint">
                Lines like “rent = 500” save a variable; later lines (e.g. “total = rent + food”) can use it.
              </p>
            </>
          ) : (
            <div className="notes-empty">
              <p className="muted">No notes yet.</p>
              <button type="button" className="btn btn-primary btn-sm" onClick={addNote}>
                + New note
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
