/**
 * Compares the two dialects that read a segment's REGEX pattern (R2): Python's `re`, with which
 * Flagsmith's server matches it (`re.compile(pattern).match(text)` in
 * flag_engine/segments/evaluator.py), and JavaScript's RegExp without flags, with which the Node
 * engine matches it once the server profile has anchored it (Annex B syntax).
 *
 * A pattern is portable when it uses only syntax that both dialects read alike:
 * - characters other than `^ $ \ . * + ? ( ) [ ] { } |`, and escaped ASCII punctuation;
 * - `.`, `^`, `$`, alternation, and classes such as `[a-z_]` or `[^,]`;
 * - groups `(...)` and `(?:...)`, lookahead, and lookbehind of one fixed width;
 * - the quantifiers `*`, `+`, `?`, `{n}`, `{n,}` and `{n,m}`, each optionally lazy;
 * - the escapes \d \D \w \W \s \S \b \B \n \r \t \f \v \xhh and \uhhhh.
 * Both dialects match a portable pattern alike on printable ASCII. Other text can still differ:
 * - Python's \d, \w, \s and \b are Unicode classes, and its \s also matches "\x1c" to "\x1f";
 * - Python's `.` matches "\r", "\u2028" and "\u2029", and its `$` also matches before a final "\n";
 * - JavaScript reads a character above U+FFFF as two units, which `.`, a negated class or a
 *   range over the surrogates can split.
 * The edge probes of the parity suite run an example of each through both engines.
 */

/** What the text must avoid for both dialects to agree on a portable pattern. */
export type PortableRegex = {
  /** Uses \d, \D, \w, \W, \s, \S, \b or \B: the text must be printable ASCII. */
  unicodeClasses: boolean;
  /**
   * Uses `.`, `$`, a negated class or a range over the surrogates: the text must have no "\n",
   * "\r", "\u2028", "\u2029" or character above U+FFFF.
   */
  lineSensitive: boolean;
};

/** The text-dependent parts of a portable pattern, or undefined when it is not portable. */
export function portableRegex(pattern: string): PortableRegex | undefined {
  const reader = new PatternReader(pattern);
  try {
    reader.read();
  } catch (error) {
    if (error instanceof Unportable) {
      return undefined;
    }
    throw error;
  }
  return { unicodeClasses: reader.unicodeClasses, lineSensitive: reader.lineSensitive };
}

/** The lengths a part of a pattern can match, in characters. */
type Width = { min: number; max: number };

const ZERO: Width = { min: 0, max: 0 };
const ONE: Width = { min: 1, max: 1 };
const QUANTIFIERS = new Set(['*', '+', '?', '{']);
const CLASS_ESCAPES = new Set(['d', 'D', 'w', 'W', 's', 'S']);
const CONTROL_ESCAPES = new Map([
  ['n', 0x0a],
  ['r', 0x0d],
  ['t', 0x09],
  ['f', 0x0c],
  ['v', 0x0b],
]);
// Python requires every digit of \xhh and \uhhhh; JavaScript reads a short escape as a letter.
const HEX_ESCAPES = new Map([
  ['x', /^[\dA-Fa-f]{2}/],
  ['u', /^[\dA-Fa-f]{4}/],
]);
// Both read printable ASCII other than letters and digits as itself after a backslash. Python
// refuses the letters it does not know, and digits are group references or octal escapes.
const ASCII_PUNCTUATION = /^[\x20-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]$/;
// {n}, {n,} and {n,m}. Python also reads {,n} as a count, where JavaScript reads text.
const COUNT = /^\{(\d{1,4})(,(\d{0,4}))?\}/;
const MAX_GROUP_DEPTH = 100;

/** Thrown inside this module only, when the pattern leaves the portable subset. */
class Unportable extends Error {
  constructor() {
    super('The pattern uses syntax that Python and JavaScript may read differently.');
    this.name = 'Unportable';
  }
}

function unportable(): never {
  throw new Unportable();
}

const isSurrogate = (code: number) => code >= 0xd800 && code <= 0xdfff;

/** A product of lengths, where zero repetitions of an unbounded length are still zero. */
const times = (length: number, count: number) => (length === 0 || count === 0 ? 0 : length * count);

/** A recursive-descent reader of the portable subset, which throws `Unportable` outside it. */
class PatternReader {
  unicodeClasses = false;
  lineSensitive = false;
  private readonly pattern: string;
  private position = 0;
  private depth = 0;

  constructor(pattern: string) {
    this.pattern = pattern;
  }

  read(): void {
    this.disjunction();
    // A ")" without its "(": Python refuses it, while in Node it closes the anchoring group.
    if (this.position < this.pattern.length) {
      unportable();
    }
  }

  private peek(offset = 0): string | undefined {
    return this.pattern[this.position + offset];
  }

  private startsWith(text: string): boolean {
    return this.pattern.startsWith(text, this.position);
  }

  private disjunction(): Width {
    let width = this.alternative();
    while (this.peek() === '|') {
      this.position++;
      const next = this.alternative();
      width = { min: Math.min(width.min, next.min), max: Math.max(width.max, next.max) };
    }
    return width;
  }

  private alternative(): Width {
    const width = { ...ZERO };
    while (!this.atAlternativeEnd()) {
      const term = this.term();
      width.min += term.min;
      width.max += term.max;
    }
    return width;
  }

  private atAlternativeEnd(): boolean {
    const next = this.peek();
    return next === undefined || next === '|' || next === ')';
  }

  private term(): Width {
    switch (this.peek()) {
      case '^':
        this.position++;
        return this.assertion();
      case '$':
        this.position++;
        this.lineSensitive = true;
        return this.assertion();
      case '(':
        return this.group();
      case '.':
        this.position++;
        this.lineSensitive = true;
        return this.quantified(ONE);
      case '[':
        this.characterClass();
        return this.quantified(ONE);
      case '\\':
        if (this.peek(1) === 'b' || this.peek(1) === 'B') {
          this.position += 2;
          this.unicodeClasses = true;
          return this.assertion();
        }
        if (!this.classEscape()) {
          this.characterEscape();
        }
        return this.quantified(ONE);
      default:
        this.character(false);
        return this.quantified(ONE);
    }
  }

  /** The dialects disagree on which assertions a quantifier may follow. */
  private assertion(): Width {
    if (QUANTIFIERS.has(this.peek() ?? '')) {
      unportable();
    }
    return ZERO;
  }

  private group(): Width {
    if (++this.depth > MAX_GROUP_DEPTH) {
      unportable();
    }
    let width: Width;
    if (this.startsWith('(?=') || this.startsWith('(?!')) {
      this.position += 3;
      this.closeGroup(this.disjunction());
      width = this.assertion();
    } else if (this.startsWith('(?<=') || this.startsWith('(?<!')) {
      this.position += 4;
      const behind = this.closeGroup(this.disjunction());
      // Python compiles a lookbehind only when all its matches have the same length.
      if (behind.min !== behind.max) {
        unportable();
      }
      width = this.assertion();
    } else if (this.startsWith('(?:') || this.peek(1) !== '?') {
      this.position += this.startsWith('(?:') ? 3 : 1;
      width = this.quantified(this.closeGroup(this.disjunction()));
    } else {
      // Named groups, inline flags, comments, atomic groups, conditionals: one dialect lacks each.
      unportable();
    }
    this.depth--;
    return width;
  }

  private closeGroup(width: Width): Width {
    if (this.peek() !== ')') {
      unportable();
    }
    this.position++;
    return width;
  }

  private quantified(width: Width): Width {
    const next = this.peek();
    let min: number;
    let max: number;
    if (next === '*' || next === '+' || next === '?') {
      this.position++;
      min = next === '+' ? 1 : 0;
      max = next === '?' ? 1 : Number.POSITIVE_INFINITY;
    } else if (next === '{') {
      // Python's {,n}, a count above 9999, or a "{" that a dialect reads as text.
      const [count, low = '', comma, high = ''] =
        COUNT.exec(this.pattern.slice(this.position)) ?? unportable();
      min = Number(low);
      max = comma === undefined ? min : high === '' ? Number.POSITIVE_INFINITY : Number(high);
      if (max < min) {
        unportable();
      }
      this.position += count.length;
    } else {
      return width;
    }
    if (this.peek() === '?') {
      this.position++;
    }
    // Another quantifier: possessive in Python 3.11 and later, an error in JavaScript.
    if (QUANTIFIERS.has(this.peek() ?? '')) {
      unportable();
    }
    return { min: times(width.min, min), max: times(width.max, max) };
  }

  private characterClass(): void {
    this.position++;
    if (this.peek() === '^') {
      this.position++;
      // A negated class matches half of a character above U+FFFF in JavaScript.
      this.lineSensitive = true;
    }
    // Python reads a first "]" as a member, JavaScript as the end of an empty class.
    if (this.peek() === ']') {
      unportable();
    }
    while (this.peek() !== ']') {
      const start = this.classMember();
      if (this.peek() === '-' && this.peek(1) !== ']') {
        this.position++;
        const end = this.classMember();
        // Python refuses a range from or to a class such as \w; JavaScript reads the "-" as text.
        if (start === undefined || end === undefined || end < start) {
          unportable();
        }
        if (start <= 0xdfff && end >= 0xd800) {
          // A range over the surrogates matches half of a character above U+FFFF in JavaScript.
          this.lineSensitive = true;
        }
      }
    }
    this.position++;
  }

  /** A class member: its character code, or undefined for \d, \w, \s and their negations. */
  private classMember(): number | undefined {
    if (this.peek() === '\\') {
      if (this.classEscape()) {
        return undefined;
      }
      if (this.peek(1) === 'b') {
        // A backspace, in both dialects.
        this.position += 2;
        return 0x08;
      }
      return this.characterEscape();
    }
    // Python warns that a later version may read "[" inside a class as a nested set.
    if (this.peek() === '[') {
      unportable();
    }
    return this.character(true);
  }

  /** \d \D \w \W \s \S, at a backslash. */
  private classEscape(): boolean {
    if (!CLASS_ESCAPES.has(this.peek(1) ?? '')) {
      return false;
    }
    this.position += 2;
    this.unicodeClasses = true;
    return true;
  }

  /** An escaped character, at a backslash: its code. */
  private characterEscape(): number {
    // A backslash at the end is an error in both.
    const letter = this.peek(1) ?? unportable();
    const control = CONTROL_ESCAPES.get(letter);
    if (control !== undefined) {
      this.position += 2;
      return control;
    }
    const hex = HEX_ESCAPES.get(letter);
    if (hex !== undefined) {
      const digits = hex.exec(this.pattern.slice(this.position + 2))?.[0] ?? unportable();
      const code = Number.parseInt(digits, 16);
      // Python reads \ud83d as a lone surrogate, JavaScript as half of a character above U+FFFF.
      if (isSurrogate(code)) {
        unportable();
      }
      this.position += 2 + digits.length;
      return code;
    }
    if (!ASCII_PUNCTUATION.test(letter)) {
      unportable();
    }
    this.position += 2;
    return letter.charCodeAt(0);
  }

  /** A character that stands for itself: its code. */
  private character(inClass: boolean): number {
    // The end of the pattern inside an unterminated class.
    const next = this.peek() ?? unportable();
    const code = next.charCodeAt(0);
    // Outside a class: a quantifier with nothing to repeat, or a "{", "}" or "]" that only some
    // positions make literal. Anywhere: half of a character above U+FFFF, which Python reads whole.
    if ((!inClass && '*+?{}]'.includes(next)) || isSurrogate(code)) {
      unportable();
    }
    this.position++;
    return code;
  }
}
