// Small, self-contained helpers for the notes rich-text editor: converting
// between the persisted HTML and the plain text the calculator/autocomplete
// need, migrating legacy plain-text notes, and mapping a caret position
// to/from a plain-text character offset within the contentEditable DOM.
// Line breaks are always a single <br> per line — no nested block elements —
// which keeps every helper below simple and consistent with each other.

const HTML_MARKER = /<(br|span|b)[ />]/i;

/** True if `body` is already our HTML format, vs. a legacy plain-text note. */
export function isRichBody(body: string): boolean {
  return HTML_MARKER.test(body);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Converts a legacy plain-text note body (with \n line breaks) to HTML. */
export function plainTextToHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => escapeHtml(line))
    .join('<br>');
}

/** The plain-text projection of a rendered note (one line per visual line),
 *  for the calculator and for keeping the per-line results column aligned. */
export function extractPlainText(root: HTMLElement): string {
  return root.innerText.replace(/\r\n/g, '\n');
}

/** Walks `root` building its plain-text-with-newlines content, stopping at
 *  (node, nodeOffset) — the shared core of caret-offset get/set below. */
function collectTextUpTo(root: Node, stopNode: Node, stopOffset: number): string {
  let result = '';
  let done = false;
  const visit = (node: Node) => {
    if (done) return;
    if (node === stopNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        result += (node as Text).data.slice(0, stopOffset);
      } else {
        for (const child of Array.from(node.childNodes).slice(0, stopOffset)) visit(child);
      }
      done = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      result += (node as Text).data;
    } else if (node.nodeName === 'BR') {
      result += '\n';
    } else {
      for (const child of Array.from(node.childNodes)) {
        visit(child);
        if (done) return;
      }
    }
  };
  visit(root);
  return result;
}

/** Plain-text character offset of the caret within `root`, or 0 if the
 *  current selection isn't inside it. */
export function getCaretOffset(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return 0;
  return collectTextUpTo(root, range.startContainer, range.startOffset).length;
}

/** Places the (collapsed) caret at plain-text character `offset` in `root`. */
export function setCaretOffset(root: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  let remaining = offset;
  const result: { target: { node: Node; offset: number } | null } = { target: null };

  const visit = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node as Text).data.length;
      if (remaining <= len) {
        result.target = { node, offset: remaining };
        return true;
      }
      remaining -= len;
      return false;
    }
    if (node.nodeName === 'BR') {
      if (remaining <= 0) {
        const parent = node.parentNode;
        if (parent) {
          result.target = { node: parent, offset: Array.from(parent.childNodes).indexOf(node as ChildNode) + 1 };
          return true;
        }
      }
      remaining -= 1;
      return false;
    }
    for (const child of Array.from(node.childNodes)) {
      if (visit(child)) return true;
    }
    return false;
  };

  visit(root);
  const range = document.createRange();
  if (result.target) {
    range.setStart(result.target.node, result.target.offset);
  } else {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Selects the plain-text range [start, end) within `root`. */
export function setSelectionRange(root: HTMLElement, start: number, end: number): void {
  setCaretOffset(root, start);
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const anchorNode = sel.anchorNode;
  const anchorOffset = sel.anchorOffset;
  setCaretOffset(root, end);
  const focus = sel.getRangeAt(0);
  if (!anchorNode) return;
  const range = document.createRange();
  range.setStart(anchorNode, anchorOffset);
  range.setEnd(focus.startContainer, focus.startOffset);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Wraps the current (non-collapsed) selection inside `root` with a
 *  `<span style="...">`, leaving the wrapped text selected afterward. */
export function wrapSelectionStyle(root: HTMLElement, styleCss: string): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;
  const span = document.createElement('span');
  span.setAttribute('style', styleCss);
  span.appendChild(range.extractContents());
  range.insertNode(span);
  const next = document.createRange();
  next.selectNodeContents(span);
  sel.removeAllRanges();
  sel.addRange(next);
}
