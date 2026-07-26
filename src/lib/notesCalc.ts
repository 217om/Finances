// A tiny, safe (no eval) calculator for the notepad: each line can be plain
// text, a bare expression ("12 * (3 + 4)"), or a variable assignment
// ("rent = 500"). Variables assigned on earlier lines are available to every
// line below them. Lines that don't parse as valid math are just prose.

type Token =
  | { type: 'num'; value: number }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: '+' | '-' | '*' | '/' | '^' | '%' }
  | { type: 'lparen' }
  | { type: 'rparen' };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
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

class Parser {
  private pos = 0;
  constructor(private tokens: Token[], private vars: Record<string, number>) {}

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

function evalExpr(src: string, vars: Record<string, number>): number {
  const tokens = tokenize(src);
  if (tokens.length === 0) throw new Error('empty');
  return new Parser(tokens, vars).parse();
}

export interface LineResult {
  assign?: string;
  value: number;
}

const ASSIGNMENT = /^([a-zA-Z_]\w*)\s*=\s*(.+)$/;

/** Evaluate one line against the running variable table. Returns null for
 *  lines that are plain prose (don't parse as math), never throws. */
export function evalLine(line: string, vars: Record<string, number>): LineResult | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const m = ASSIGNMENT.exec(trimmed);
    if (m) {
      const [, name, exprStr] = m;
      const value = evalExpr(exprStr, vars);
      return { assign: name, value };
    }
    return { value: evalExpr(trimmed, vars) };
  } catch {
    return null;
  }
}

/** Evaluate every line of a note top-to-bottom, threading variables through. */
export function evalNote(body: string): (LineResult | null)[] {
  const vars: Record<string, number> = {};
  const results: (LineResult | null)[] = [];
  for (const line of body.split('\n')) {
    const result = evalLine(line, vars);
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
