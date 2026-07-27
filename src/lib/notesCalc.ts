// A tiny, safe (no eval) calculator for the notepad: each line can be plain
// text, a bare expression ("12 * (3 + 4)"), a variable assignment
// ("rent = 500"), or a card lookup ("card1.get(\"Dining\")"). Variables
// assigned on earlier lines are available to every line below them. Lines
// that don't parse as valid math are just prose.

type Token =
  | { type: 'num'; value: number }
  | { type: 'ident'; value: string }
  | { type: 'string'; value: string }
  | { type: 'op'; value: '+' | '-' | '*' | '/' | '^' | '%' }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'dot' }
  | { type: 'comma' };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    // A number starts with a digit, or a "." immediately followed by a digit
    // (so a lone "." — as in "card1.get(...)" — falls through to the dot
    // token below instead of being mistaken for a malformed number).
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const raw = src.slice(i, j);
      if ((raw.match(/\./g) ?? []).length > 1) throw new Error('bad number');
      tokens.push({ type: 'num', value: Number(raw) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      tokens.push({ type: 'ident', value: src.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let value = '';
      while (j < src.length && src[j] !== quote) {
        value += src[j];
        j++;
      }
      if (j >= src.length) throw new Error('unterminated string');
      tokens.push({ type: 'string', value });
      i = j + 1;
      continue;
    }
    if (ch === '.') {
      tokens.push({ type: 'dot' });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma' });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }
    if ('+-*/^%'.includes(ch)) {
      tokens.push({ type: 'op', value: ch as '+' | '-' | '*' | '/' | '^' | '%' });
      i++;
      continue;
    }
    throw new Error(`unexpected character "${ch}"`);
  }
  return tokens;
}

/**
 * Looks up a card's total for a category by the card's slug (e.g. "card1"
 * for a card named "Card 1"), optionally restricted to an inclusive date
 * range (both ISO "YYYY-MM-DD"). Returns undefined if the card/category is
 * unknown.
 */
export type CardGetter = (
  cardSlug: string,
  category: string,
  from?: string,
  to?: string,
) => number | undefined;

class Parser {
  private pos = 0;
  constructor(
    private tokens: Token[],
    private vars: Record<string, number>,
    private cardGetter?: CardGetter,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private next(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new Error('unexpected end');
    this.pos++;
    return t;
  }

  parse(): number {
    const value = this.parseExpr();
    if (this.pos !== this.tokens.length) throw new Error('trailing input');
    return value;
  }

  private parseExpr(): number {
    let value = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
        this.next();
        const rhs = this.parseTerm();
        value = t.value === '+' ? value + rhs : value - rhs;
      } else break;
    }
    return value;
  }

  private parseTerm(): number {
    let value = this.parsePow();
    for (;;) {
      const t = this.peek();
      if (t?.type === 'op' && (t.value === '*' || t.value === '/')) {
        this.next();
        const rhs = this.parsePow();
        value = t.value === '*' ? value * rhs : value / rhs;
      } else break;
    }
    return value;
  }

  private parsePow(): number {
    const base = this.parseUnary();
    const t = this.peek();
    if (t?.type === 'op' && t.value === '^') {
      this.next();
      const exp = this.parsePow(); // right-associative
      return Math.pow(base, exp);
    }
    return base;
  }

  private parseUnary(): number {
    const t = this.peek();
    if (t?.type === 'op' && t.value === '-') {
      this.next();
      return -this.parseUnary();
    }
    if (t?.type === 'op' && t.value === '+') {
      this.next();
      return this.parseUnary();
    }
    return this.parsePostfix();
  }

  private parsePostfix(): number {
    let value = this.parsePrimary();
    while (this.peek()?.type === 'op' && (this.peek() as { value: string }).value === '%') {
      this.next();
      value = value / 100;
    }
    return value;
  }

  private parsePrimary(): number {
    const t = this.next();
    if (t.type === 'num') return t.value;
    if (t.type === 'ident') {
      // Card lookup: identifier.get("category" [, "from", "to"])
      if (this.peek()?.type === 'dot') {
        this.next(); // consume '.'
        const method = this.next();
        if (method.type !== 'ident' || method.value !== 'get') {
          throw new Error('expected .get("category")');
        }
        const lp = this.next();
        if (lp.type !== 'lparen') throw new Error('expected (');
        const args: string[] = [];
        const first = this.next();
        if (first.type !== 'string') throw new Error('expected a quoted category name');
        args.push(first.value);
        while (this.peek()?.type === 'comma') {
          this.next(); // consume ','
          const arg = this.next();
          if (arg.type !== 'string') throw new Error('expected a quoted date');
          args.push(arg.value);
        }
        const rp = this.next();
        if (rp.type !== 'rparen') throw new Error('expected )');
        const value = this.cardGetter?.(t.value, args[0], args[1], args[2]);
        if (value === undefined) throw new Error(`unknown card/category "${t.value}.get(${args.join(', ')})"`);
        return value;
      }
      if (!(t.value in this.vars)) throw new Error(`unknown variable "${t.value}"`);
      return this.vars[t.value];
    }
    if (t.type === 'lparen') {
      const value = this.parseExpr();
      const close = this.next();
      if (close.type !== 'rparen') throw new Error('expected )');
      return value;
    }
    throw new Error('unexpected token');
  }
}

function evalExpr(src: string, vars: Record<string, number>, cardGetter?: CardGetter): number {
  const tokens = tokenize(src);
  if (tokens.length === 0) throw new Error('empty');
  return new Parser(tokens, vars, cardGetter).parse();
}

export interface LineResult {
  assign?: string;
  value: number;
}

const ASSIGNMENT = /^([a-zA-Z_]\w*)\s*=\s*(.+)$/;

/** Evaluate one line against the running variable table. Returns null for
 *  lines that are plain prose (don't parse as math), never throws. */
export function evalLine(
  line: string,
  vars: Record<string, number>,
  cardGetter?: CardGetter,
): LineResult | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const m = ASSIGNMENT.exec(trimmed);
    if (m) {
      const [, name, exprStr] = m;
      const value = evalExpr(exprStr, vars, cardGetter);
      return { assign: name, value };
    }
    return { value: evalExpr(trimmed, vars, cardGetter) };
  } catch {
    return null;
  }
}

/** Evaluate every line of a note top-to-bottom, threading variables through. */
export function evalNote(body: string, cardGetter?: CardGetter): (LineResult | null)[] {
  const vars: Record<string, number> = {};
  const results: (LineResult | null)[] = [];
  for (const line of body.split('\n')) {
    const result = evalLine(line, vars, cardGetter);
    if (result) {
      if (result.assign) vars[result.assign] = result.value;
      results.push(result);
    } else {
      results.push(null);
    }
  }
  return results;
}

export function formatResult(n: number): string {
  if (Number.isNaN(n)) return '—';
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞';
  const rounded = Math.round(n * 1e9) / 1e9;
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 9 });
}

/** Turn a card's display name into a valid bare identifier, e.g.
 *  "Second Card" -> "secondCard", "Card 1" -> "card1". */
export function cardSlug(name: string): string {
  const words = name
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words.length === 0) return 'card';
  const joined = words
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
  return /^[0-9]/.test(joined) ? `c${joined}` : joined;
}
