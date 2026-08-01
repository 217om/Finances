import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { deleteNote, getAllNotes, makeNote, saveNote, type Note } from '../lib/notes';
import { evalNote, formatResult, cardSlug, type CardGetter } from '../lib/notesCalc';
import { loadCards, type Card } from '../lib/cards';
import { loadCardCategoryTotals, sumCategory, type CardCategoryData } from '../lib/cardTotals';
import { RANGE_PRESETS, resolvePreset, type RangePreset } from '../lib/dateRanges';
import {
  isRichBody,
  plainTextToHtml,
  extractPlainText,
  getCaretOffset,
  setCaretOffset,
  setSelectionRange,
  wrapSelectionStyle,
} from '../lib/richText';

const SAVE_DEBOUNCE_MS = 400;
const HISTORY_LIMIT = 100;
const TYPING_BURST_MS = 600;
const POSITION_KEY = 'cashflow.notesPosition';
const SIZE_KEY = 'cashflow.notesSize';
const LINE_HEIGHT = 20;
const PAD_TOP = 10;
const PAD_LEFT = 8;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 260;

// A handful of colors lifted straight from the app's existing category
// palette, so note text stays legible and on-theme in both light and dark
// mode without needing separate tuning.
// Concrete values, not `inherit` — a formatting span can end up nested
// inside a leftover (now-empty) ancestor span from an earlier color/size
// change, and `inherit` would pick up THAT ancestor's value instead of
// resetting to the editor's real base style.
const TEXT_COLORS: { label: string; value: string }[] = [
  { label: 'Default', value: 'var(--text)' },
  { label: 'Red', value: '#C1584B' },
  { label: 'Green', value: '#7C9473' },
  { label: 'Blue', value: '#6F8FA0' },
  { label: 'Amber', value: '#C9A227' },
  { label: 'Purple', value: '#9B7FAE' },
];

const TEXT_SIZES: { label: string; title: string; value: string }[] = [
  { label: 'S', title: 'Small text', value: '11px' },
  { label: 'M', title: 'Normal text', value: '13px' },
  { label: 'L', title: 'Large text', value: '16px' },
];

interface Position {
  x: number;
  y: number;
}
interface Size {
  width: number;
  height: number;
}
interface AcOption {
  label: string;
  insertText: string;
}
interface AcState {
  options: AcOption[];
  start: number;
  end: number;
  selected: number;
}
interface CardEntry {
  card: Card;
  slug: string;
  data: CardCategoryData;
}
interface NoteHistory {
  undo: string[];
  redo: string[];
}

function loadPosition(): Position | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.x === 'number' && typeof p?.y === 'number') return p;
  } catch {
    /* ignore */
  }
  return null;
}

function savePosition(pos: Position): void {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

function loadSize(): Size | null {
  try {
    const raw = localStorage.getItem(SIZE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (typeof s?.width === 'number' && typeof s?.height === 'number') return s;
  } catch {
    /* ignore */
  }
  return null;
}

function saveSize(size: Size): void {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify(size));
  } catch {
    /* ignore */
  }
}

/** Measures the pixel width of one monospace character in the note editor's font. */
function measureCharWidth(): number {
  const span = document.createElement('span');
  span.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  span.style.fontSize = '13px';
  span.style.whiteSpace = 'pre';
  span.style.position = 'absolute';
  span.style.visibility = 'hidden';
  span.textContent = '0'.repeat(20);
  document.body.appendChild(span);
  const width = span.getBoundingClientRect().width / 20;
  document.body.removeChild(span);
  return width || 8;
}

/**
 * Figures out what to suggest at the caret: a card identifier (e.g. "card1"),
 * its ".get(" method, or a quoted category name inside an open .get("...").
 */
function computeAutocomplete(
  body: string,
  caret: number,
  slugs: string[],
  dataBySlug: Map<string, CardCategoryData>,
): { options: AcOption[]; start: number; end: number } | null {
  const lineStart = body.lastIndexOf('\n', caret - 1) + 1;
  const upToCaret = body.slice(lineStart, caret);

  const inString = /([a-zA-Z_]\w*)\.get\(\s*["']([^"']*)$/.exec(upToCaret);
  if (inString) {
    const [, slug, partial] = inString;
    const entry = dataBySlug.get(slug);
    if (!entry) return null;
    const matches = entry.categories.filter((c) => c.toLowerCase().startsWith(partial.toLowerCase()));
    if (matches.length === 0) return null;
    const closeSuffix = /^["']/.test(body.slice(caret)) ? '' : '")';
    return {
      options: matches.map((c) => ({ label: c, insertText: c + closeSuffix })),
      start: caret - partial.length,
      end: caret,
    };
  }

  const afterDot = /([a-zA-Z_]\w*)\.(\w*)$/.exec(upToCaret);
  if (afterDot) {
    const [, slug, partialMethod] = afterDot;
    if (slugs.includes(slug) && 'get'.startsWith(partialMethod)) {
      return { options: [{ label: 'get("…")', insertText: 'get("' }], start: caret - partialMethod.length, end: caret };
    }
    return null;
  }

  const bareIdent = /(?:^|[^.\w])([a-zA-Z_]\w*)$/.exec(upToCaret);
  if (bareIdent) {
    const partial = bareIdent[1];
    const matches = slugs.filter((s) => s.toLowerCase().startsWith(partial.toLowerCase()));
    if (matches.length === 0) return null;
    return {
      options: matches.map((s) => ({ label: s, insertText: s })),
      start: caret - partial.length,
      end: caret,
    };
  }

  return null;
}

/**
 * A floating notepad available on every page, independent of which card is
 * active. Supports multiple notes, drag-to-move and drag-to-resize, basic
 * text formatting (bold/color/size), and a small inline calculator: lines
 * like "rent = 500" save a variable, later lines like "total = rent + food"
 * can use it, and "card1.get(\"Dining\")" pulls a category total straight
 * from a card. The "Insert value" picker builds that expression for you (with
 * a time range) so you never have to type the syntax by hand — notes stay
 * ordinary free text otherwise.
 */
export default function NotesWidget() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [bodyDraft, setBodyDraft] = useState('');
  const [isEmpty, setIsEmpty] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // null = not yet moved/resized, so the panel opens at its default spot and
  // size every time — only a completed drag/resize overrides that.
  const [position, setPosition] = useState<Position | null>(() => loadPosition());
  const [size, setSize] = useState<Size | null>(() => loadSize());
  const [cardEntries, setCardEntries] = useState<CardEntry[]>([]);
  const [autocomplete, setAutocomplete] = useState<AcState | null>(null);

  const [insertOpen, setInsertOpen] = useState(false);
  const [insertCardId, setInsertCardId] = useState('');
  const [insertCategory, setInsertCategory] = useState('');
  const [insertPreset, setInsertPreset] = useState<RangePreset>('all');
  const [insertFrom, setInsertFrom] = useState('');
  const [insertTo, setInsertTo] = useState('');
  const [colorOpen, setColorOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);

  const notesRef = useRef(notes);
  notesRef.current = notes;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const bodyDraftRef = useRef(bodyDraft);
  bodyDraftRef.current = bodyDraft;
  const cardEntriesRef = useRef(cardEntries);
  cardEntriesRef.current = cardEntries;
  const caretRef = useRef(0);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const charWidthRef = useRef<number | null>(null);
  // Undo/redo history, kept per note (so switching notes doesn't cross-wire
  // history) and independent of the browser's own undo manager — that one
  // never sees the manual DOM surgery bold/color/size use, so Ctrl+Z would
  // silently ignore formatting changes otherwise.
  const historyRef = useRef<Map<string, NoteHistory>>(new Map());
  const typingBurstRef = useRef(false);
  const burstTimerRef = useRef<number | null>(null);

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
      } else {
        setNotes(all);
        setActiveId(all[0].id);
      }
    })();
  }, [open, loaded]);

  // A saved position/size can be stale relative to the current window (e.g.
  // the panel was last dragged near the edge of a much wider screen) — without
  // re-clamping on open, it can render fully off-screen, which looks exactly
  // like the button silently doing nothing. useLayoutEffect so it's corrected
  // before the first paint, not after a visible flash.
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    setPosition((prev) => (prev ? clampPosition(prev) : prev));
  }, [open]);

  // The contentEditable's rendered HTML is the source of truth for
  // formatting; React never re-renders its children while the user is
  // editing (that would fight the browser's own cursor position), so it's
  // synced imperatively here whenever the active note changes.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const note = notesRef.current.find((n) => n.id === activeId);
    const body = note?.body ?? '';
    el.innerHTML = isRichBody(body) ? body : plainTextToHtml(body);
    const plain = extractPlainText(el);
    setBodyDraft(plain);
    setIsEmpty(plain.length === 0);
    setAutocomplete(null);
    typingBurstRef.current = false;
    if (burstTimerRef.current) window.clearTimeout(burstTimerRef.current);
  }, [activeId, open]);

  // Refresh the card-lookup snapshot every time the panel opens, so
  // card1.get("Dining") reflects reasonably current numbers.
  useEffect(() => {
    if (!open) return;
    (async () => {
      const cards = loadCards();
      const entries = await Promise.all(
        cards.map(async (card) => {
          const slug = cardSlug(card.name);
          const data = await loadCardCategoryTotals(card, slug);
          return { card, slug, data };
        }),
      );
      setCardEntries(entries);
      setInsertCardId((prev) => (prev && entries.some((e) => e.card.id === prev) ? prev : entries[0]?.card.id ?? ''));
    })();
  }, [open]);

  // Keep the category picker valid whenever the chosen card changes.
  useEffect(() => {
    const entry = cardEntries.find((e) => e.card.id === insertCardId);
    const cats = entry?.data.categories ?? [];
    setInsertCategory((prev) => (prev && cats.includes(prev) ? prev : cats[0] ?? ''));
  }, [insertCardId, cardEntries]);

  function flushSave() {
    const id = activeIdRef.current;
    const el = editorRef.current;
    if (!id || !el) return;
    const html = el.innerHTML;
    const current = notesRef.current.find((n) => n.id === id);
    if (!current || current.body === html) return;
    const updated: Note = { ...current, body: html, updatedAt: Date.now() };
    setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
    void saveNote(updated);
  }

  function scheduleSave() {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }

  function getHistory(id: string): NoteHistory {
    let h = historyRef.current.get(id);
    if (!h) {
      h = { undo: [], redo: [] };
      historyRef.current.set(id, h);
    }
    return h;
  }

  /** Snapshots the editor's current (pre-change) HTML onto the undo stack.
   *  Call this immediately before any formatting or content mutation. */
  function pushHistory() {
    const id = activeIdRef.current;
    const el = editorRef.current;
    if (!id || !el) return;
    const hist = getHistory(id);
    const html = el.innerHTML;
    if (hist.undo[hist.undo.length - 1] === html) return;
    hist.undo.push(html);
    if (hist.undo.length > HISTORY_LIMIT) hist.undo.shift();
    hist.redo = [];
  }

  function restoreHtml(html: string) {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = html;
    setCaretOffset(el, extractPlainText(el).length);
    typingBurstRef.current = false;
    handleEditorInput();
  }

  function performUndo() {
    const id = activeIdRef.current;
    const el = editorRef.current;
    if (!id || !el) return;
    const hist = getHistory(id);
    const prev = hist.undo.pop();
    if (prev === undefined) return;
    hist.redo.push(el.innerHTML);
    restoreHtml(prev);
  }

  function performRedo() {
    const id = activeIdRef.current;
    const el = editorRef.current;
    if (!id || !el) return;
    const hist = getHistory(id);
    const next = hist.redo.pop();
    if (next === undefined) return;
    hist.undo.push(el.innerHTML);
    restoreHtml(next);
  }

  function updateAutocomplete(caret: number, plain: string) {
    if (charWidthRef.current === null) charWidthRef.current = measureCharWidth();
    caretRef.current = caret;
    const slugs = cardEntriesRef.current.map((e) => e.slug);
    const dataBySlug = new Map(cardEntriesRef.current.map((e) => [e.slug, e.data]));
    const ctx = computeAutocomplete(plain, caret, slugs, dataBySlug);
    setAutocomplete(ctx ? { ...ctx, selected: 0 } : null);
  }

  /** Re-syncs React state from the live DOM after any edit (typed, pasted,
   *  or programmatically inserted) and re-checks autocomplete. */
  function handleEditorInput() {
    const el = editorRef.current;
    if (!el) return;
    const plain = extractPlainText(el);
    setBodyDraft(plain);
    setIsEmpty(plain.length === 0);
    scheduleSave();
    updateAutocomplete(getCaretOffset(el), plain);
  }

  function acceptAutocomplete(option: AcOption) {
    const el = editorRef.current;
    const ac = autocomplete;
    if (!el || !ac) return;
    pushHistory();
    el.focus();
    setSelectionRange(el, ac.start, ac.end);
    document.execCommand('insertText', false, option.insertText);
    setAutocomplete(null);
    typingBurstRef.current = false;
    requestAnimationFrame(() => {
      handleEditorInput();
    });
  }

  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) performRedo();
      else performUndo();
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      performRedo();
      return;
    }
    if (autocomplete) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAutocomplete((ac) => ac && { ...ac, selected: (ac.selected + 1) % ac.options.length });
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAutocomplete((ac) => ac && { ...ac, selected: (ac.selected - 1 + ac.options.length) % ac.options.length });
        return;
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        acceptAutocomplete(autocomplete.options[autocomplete.selected]);
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setAutocomplete(null);
        return;
      }
    }
    // Normalize Enter to a single <br> — left to the browser, different
    // engines insert <div>/<p> wrappers instead, which would desync the
    // plain-text line count from the per-line results column. Its own
    // undo step, separate from the typing burst before or after it.
    if (e.key === 'Enter') {
      e.preventDefault();
      pushHistory();
      typingBurstRef.current = false;
      document.execCommand('insertLineBreak');
      requestAnimationFrame(() => handleEditorInput());
      return;
    }
    // Coalesce ordinary typing into bursts so one undo removes a whole
    // recently-typed run, not a single character — matching how undo felt
    // in the plain <textarea> this editor replaced.
    if (!mod && !e.altKey && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete')) {
      if (!typingBurstRef.current) {
        pushHistory();
        typingBurstRef.current = true;
      }
      if (burstTimerRef.current) window.clearTimeout(burstTimerRef.current);
      burstTimerRef.current = window.setTimeout(() => {
        typingBurstRef.current = false;
      }, TYPING_BURST_MS);
    }
  }

  function selectNote(id: string) {
    if (id === activeId) return;
    flushSave();
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setActiveId(id);
  }

  function addNote() {
    flushSave();
    const n = makeNote(`Note ${notesRef.current.length + 1}`);
    void saveNote(n);
    setNotes((prev) => [n, ...prev]);
    setActiveId(n.id);
  }

  function removeNote(id: string) {
    if (!confirm('Delete this note? This cannot be undone.')) return;
    void deleteNote(id);
    historyRef.current.delete(id);
    setNotes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      if (id === activeIdRef.current) {
        const fallback = next[0];
        setActiveId(fallback?.id ?? null);
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

  function clampPosition(pos: Position): Position {
    const panel = panelRef.current;
    const w = panel?.offsetWidth ?? 380;
    const h = panel?.offsetHeight ?? 520;
    const maxX = Math.max(8, window.innerWidth - w - 8);
    const maxY = Math.max(8, window.innerHeight - h - 8);
    return { x: Math.min(Math.max(8, pos.x), maxX), y: Math.min(Math.max(8, pos.y), maxY) };
  }

  function handleDragStart(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button')) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: rect.left, originY: rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleDragMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const { startX, startY, originX, originY } = dragRef.current;
    setPosition(clampPosition({ x: originX + (e.clientX - startX), y: originY + (e.clientY - startY) }));
  }

  function handleDragEnd() {
    if (!dragRef.current) return;
    dragRef.current = null;
    setPosition((prev) => {
      if (prev) savePosition(prev);
      return prev;
    });
  }

  function handleResizeStart(e: React.PointerEvent<HTMLDivElement>) {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: rect.width, startH: rect.height };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
  }

  function handleResizeMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = resizeRef.current;
    if (!d) return;
    const maxW = window.innerWidth - 40;
    const maxH = window.innerHeight - 40;
    const width = Math.min(maxW, Math.max(MIN_WIDTH, d.startW + (e.clientX - d.startX)));
    const height = Math.min(maxH, Math.max(MIN_HEIGHT, d.startH + (e.clientY - d.startY)));
    setSize({ width, height });
  }

  function handleResizeEnd() {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    setSize((prev) => {
      if (prev) saveSize(prev);
      return prev;
    });
  }

  function toggleOpen() {
    setOpen((prev) => {
      if (prev) {
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        flushSave();
        setAutocomplete(null);
        setInsertOpen(false);
        setColorOpen(false);
        setSizeOpen(false);
      }
      return !prev;
    });
  }

  /** Inserts text at the caret, starting a fresh line first if the caret
   *  isn't already at the start of an empty line (so two inserts in a row,
   *  or an insert after typed text, never get glued onto the same line). */
  function insertAtCaret(text: string) {
    const el = editorRef.current;
    if (!el) return;
    pushHistory();
    typingBurstRef.current = false;
    el.focus();
    const plain = extractPlainText(el);
    const pos = Math.min(caretRef.current, plain.length);
    const lineStart = plain.lastIndexOf('\n', pos - 1) + 1;
    const linePrefix = plain.slice(lineStart, pos);
    setCaretOffset(el, pos);
    if (linePrefix.trim().length > 0) {
      document.execCommand('insertLineBreak');
    }
    document.execCommand('insertText', false, text);
    requestAnimationFrame(() => handleEditorInput());
  }

  function handleInsertValue() {
    const entry = cardEntries.find((e) => e.card.id === insertCardId);
    if (!entry || !insertCategory) return;
    const range = insertPreset === 'custom' ? { from: insertFrom, to: insertTo } : resolvePreset(insertPreset);
    const snippet =
      range && range.from && range.to
        ? `${entry.slug}.get("${insertCategory}", "${range.from}", "${range.to}")`
        : `${entry.slug}.get("${insertCategory}")`;
    insertAtCaret(snippet);
    setInsertOpen(false);
  }

  function applyBold() {
    const el = editorRef.current;
    if (!el) return;
    pushHistory();
    typingBurstRef.current = false;
    el.focus();
    document.execCommand('bold');
    handleEditorInput();
  }

  function applyColor(value: string) {
    const el = editorRef.current;
    if (!el) return;
    pushHistory();
    typingBurstRef.current = false;
    el.focus();
    wrapSelectionStyle(el, `color: ${value}`);
    setColorOpen(false);
    handleEditorInput();
  }

  function applySize(value: string) {
    const el = editorRef.current;
    if (!el) return;
    pushHistory();
    typingBurstRef.current = false;
    el.focus();
    wrapSelectionStyle(el, `font-size: ${value}`);
    setSizeOpen(false);
    handleEditorInput();
  }

  const activeNote = notes.find((n) => n.id === activeId) ?? null;
  const lines = bodyDraft.split('\n');
  const cardGetter: CardGetter = (slug, category, from, to) => {
    const entry = cardEntriesRef.current.find((e) => e.slug === slug);
    if (!entry) return undefined;
    if (!entry.data.categories.some((c) => c.toLowerCase() === category.toLowerCase())) return undefined;
    return sumCategory(entry.data, category, from, to);
  };
  const results = evalNote(bodyDraft, cardGetter);

  const acStyle = (() => {
    if (!autocomplete || !editorRef.current) return undefined;
    const charWidth = charWidthRef.current ?? 8;
    const before = bodyDraft.slice(0, autocomplete.start);
    const lineIdx = before.split('\n').length - 1;
    const col = before.slice(before.lastIndexOf('\n') + 1).length;
    const scrollTop = editorRef.current.scrollTop;
    const scrollLeft = editorRef.current.scrollLeft;
    const top = PAD_TOP + lineIdx * LINE_HEIGHT - scrollTop + LINE_HEIGHT;
    const left = Math.max(4, Math.min(PAD_LEFT + col * charWidth - scrollLeft, editorRef.current.clientWidth - 160));
    return { left, top };
  })();

  const insertEntry = cardEntries.find((e) => e.card.id === insertCardId);
  const insertCategories = insertEntry?.data.categories ?? [];

  return (
    <div className="notes-fab-wrap">
      <button type="button" className="notes-fab" onClick={toggleOpen} title="Notes" aria-label="Notes">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
          <path
            d="M6 4h9l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M15 4v4a1 1 0 0 0 1 1h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M8 12.5h8M8 16h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          className="notes-panel"
          ref={panelRef}
          style={{
            ...(position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : {}),
            ...(size ? { width: size.width, height: size.height } : {}),
          }}
        >
          <div
            className="notes-panel-head"
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
          >
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
              <div className="notes-toolbar">
                <div className="notes-fmt-group">
                  <button
                    type="button"
                    className="notes-fmt-btn notes-fmt-bold"
                    title="Bold (Ctrl+B)"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={applyBold}
                  >
                    B
                  </button>

                  <div className="notes-fmt-wrap">
                    <button
                      type="button"
                      className="notes-fmt-btn"
                      title="Text color"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setColorOpen((v) => !v);
                        setSizeOpen(false);
                      }}
                    >
                      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.3" />
                        <path d="M8 2a6 6 0 0 1 0 12 3 3 0 0 1 0-6 2 2 0 0 0 0-4Z" fill="currentColor" />
                      </svg>
                    </button>
                    {colorOpen && (
                      <div className="notes-fmt-pop notes-fmt-pop-color">
                        {TEXT_COLORS.map((c) => (
                          <button
                            key={c.label}
                            type="button"
                            className="notes-swatch"
                            title={c.label}
                            style={{ background: c.value }}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => applyColor(c.value)}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="notes-fmt-wrap">
                    <button
                      type="button"
                      className="notes-fmt-btn notes-fmt-size-btn"
                      title="Text size"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSizeOpen((v) => !v);
                        setColorOpen(false);
                      }}
                    >
                      A▾
                    </button>
                    {sizeOpen && (
                      <div className="notes-fmt-pop notes-fmt-pop-size">
                        {TEXT_SIZES.map((s) => (
                          <button
                            key={s.label}
                            type="button"
                            className="notes-fmt-size-opt"
                            title={s.title}
                            style={{ fontSize: s.value }}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => applySize(s.value)}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="notes-toolbar-sep" />

                <div className="notes-insert-wrap">
                  <button
                    type="button"
                    className="notes-fmt-btn notes-insert-btn"
                    title="Insert a number from a card"
                    onClick={() => setInsertOpen((v) => !v)}
                  >
                    + Insert value
                  </button>
                  {insertOpen && (
                    <div className="notes-insert-pop">
                      {cardEntries.length === 0 ? (
                        <p className="muted">No cards yet.</p>
                      ) : (
                        <>
                          <label className="picker notes-insert-field">
                            <span className="picker-label">Card</span>
                            <select value={insertCardId} onChange={(e) => setInsertCardId(e.target.value)}>
                              {cardEntries.map((e) => (
                                <option key={e.card.id} value={e.card.id}>
                                  {e.card.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="picker notes-insert-field">
                            <span className="picker-label">Category</span>
                            <select
                              value={insertCategory}
                              onChange={(e) => setInsertCategory(e.target.value)}
                              disabled={insertCategories.length === 0}
                            >
                              {insertCategories.length === 0 ? (
                                <option value="">No categories yet</option>
                              ) : (
                                insertCategories.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))
                              )}
                            </select>
                          </label>
                          <label className="picker notes-insert-field">
                            <span className="picker-label">Time range</span>
                            <select
                              value={insertPreset}
                              onChange={(e) => setInsertPreset(e.target.value as RangePreset)}
                            >
                              {RANGE_PRESETS.map((p) => (
                                <option key={p.key} value={p.key}>
                                  {p.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {insertPreset === 'custom' && (
                            <div className="notes-insert-range">
                              <label className="picker notes-insert-field">
                                <span className="picker-label">From</span>
                                <input
                                  type="date"
                                  value={insertFrom}
                                  onChange={(e) => setInsertFrom(e.target.value)}
                                />
                              </label>
                              <label className="picker notes-insert-field">
                                <span className="picker-label">To</span>
                                <input type="date" value={insertTo} onChange={(e) => setInsertTo(e.target.value)} />
                              </label>
                            </div>
                          )}
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={
                              !insertCategory || (insertPreset === 'custom' && (!insertFrom || !insertTo))
                            }
                            onClick={handleInsertValue}
                          >
                            Insert
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="notes-editor">
                <div
                  ref={editorRef}
                  className={`notes-lines ${isEmpty ? 'notes-lines-empty' : ''}`}
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  data-placeholder={
                    'Write anything. Try:\nrent = 500\ntotal = rent + food\n\nOr click "+ Insert value" above to pull a number from a card.'
                  }
                  onInput={handleEditorInput}
                  onKeyDown={handleEditorKeyDown}
                  onKeyUp={(e) => {
                    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key) && editorRef.current) {
                      updateAutocomplete(getCaretOffset(editorRef.current), extractPlainText(editorRef.current));
                    }
                  }}
                  onClick={() => {
                    if (editorRef.current) {
                      updateAutocomplete(getCaretOffset(editorRef.current), extractPlainText(editorRef.current));
                    }
                  }}
                  onPaste={(e) => {
                    e.preventDefault();
                    pushHistory();
                    typingBurstRef.current = false;
                    const text = e.clipboardData.getData('text/plain');
                    document.execCommand('insertText', false, text);
                    requestAnimationFrame(() => handleEditorInput());
                  }}
                  onBlur={() => setAutocomplete(null)}
                  onScroll={(e) => {
                    if (resultsRef.current) resultsRef.current.scrollTop = e.currentTarget.scrollTop;
                    setAutocomplete(null);
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
                {autocomplete && acStyle && (
                  <div className="notes-autocomplete" style={acStyle}>
                    {autocomplete.options.map((opt, i) => (
                      <button
                        key={opt.label}
                        type="button"
                        className={`notes-ac-opt ${i === autocomplete.selected ? 'notes-ac-opt-active' : ''}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          acceptAutocomplete(opt);
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="muted notes-hint">
                Write anything — “rent = 500” saves a number you can reuse, and “+ Insert value” pulls a number
                straight from a card without typing any code. Select text to bold, color, or resize it.
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

          <div
            className="notes-resize-handle"
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
            title="Drag to resize"
          />
        </div>
      )}
    </div>
  );
}
