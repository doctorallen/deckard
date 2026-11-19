/**
 * Glob matching in the dialect VS Code uses for `files.exclude`, with no
 * third-party code and no regular expressions (decision 0018).
 *
 * - `*` matches any run of characters within one path segment, `?` any one
 *   character, and both match a name that starts with a dot, as VS Code's do.
 * - `**`, as a whole segment, matches any number of segments, none included.
 *   Within a segment, as in `a**b`, it is a plain `*`.
 * - `{a,b}` matches either alternative, nested braces too; braces with no
 *   comma are literal.
 * - `[abc]`, `[a-z]`, and `[!a]` or `[^a]` match one character; a `[` with no
 *   closing `]` is literal. None of them matches `/`.
 * - `\` makes the next character literal, so `notes/\[draft\]` names the
 *   folder `[draft]`, as Exclude from Deckard writes it.
 * - Anything else is literal, extglob characters such as `+(`, `@(`, and a
 *   leading `!` included, since VS Code's dialect has neither.
 *
 * A pattern matches a whole path. Matching runs in time bounded by the
 * pattern's length times the path's, whatever either holds: a pattern is
 * matched segment by segment with the two-pointer wildcard algorithm, and
 * braces are expanded beforehand, at most {@link MAX_EXPANSIONS} ways.
 */

/** The most alternatives one pattern's braces expand to; the rest are dropped. */
export const MAX_EXPANSIONS = 1024;

/** One character of a segment's pattern: a literal, `?`, or a class. */
type CharToken =
  | { kind: 'literal'; char: string }
  | { kind: 'any' }
  | { kind: 'class'; negated: boolean; ranges: ReadonlyArray<readonly [string, string]> };

/** A segment's pattern: its characters and `*`s, or `**` standing alone. */
type SegmentPattern = { kind: 'globstar' } | { kind: 'segment'; tokens: ReadonlyArray<CharToken | { kind: 'star' }> };

/**
 * A matcher for the patterns given: true when any of them matches the whole
 * path, written with `/` separators.
 */
export function compileGlobs(patterns: readonly string[]): (path: string) => boolean {
  const compiled = patterns.flatMap((pattern) => expandBraces(pattern).map(compilePattern));
  return (path) => {
    if (compiled.length === 0) {
      return false;
    }
    const segments = path.split('/');
    return compiled.some((segmentPatterns) => matchSegments(segmentPatterns, segments));
  };
}

/**
 * The pattern with its braces expanded: `{a,b}c` as `ac` and `bc`, the first
 * group first, each alternative expanded in turn. A brace escaped, unclosed,
 * or holding no top-level comma stays as written.
 */
export function expandBraces(pattern: string): string[] {
  const results: string[] = [];
  const pending = [pattern];
  while (pending.length > 0 && results.length < MAX_EXPANSIONS) {
    const next = pending.shift() as string;
    const group = findBraceGroup(next);
    if (!group) {
      results.push(next);
      continue;
    }
    const before = next.slice(0, group.open);
    const after = next.slice(group.close + 1);
    const room = MAX_EXPANSIONS - results.length - pending.length;
    pending.unshift(...group.alternatives.slice(0, Math.max(room, 1)).map((alternative) => before + alternative + after));
  }
  return results;
}

/** The first brace group with a top-level comma: where it opens and closes, and its alternatives. */
function findBraceGroup(pattern: string): { open: number; close: number; alternatives: string[] } | undefined {
  for (let open = 0; open < pattern.length; open++) {
    const char = pattern[open];
    if (char === '\\') {
      open++;
      continue;
    }
    if (char === '[') {
      const end = findClassEnd(pattern, open);
      if (end !== undefined) {
        open = end;
      }
      continue;
    }
    if (char !== '{') {
      continue;
    }
    let depth = 0;
    const commas: number[] = [];
    for (let at = open + 1; at < pattern.length; at++) {
      const inner = pattern[at];
      if (inner === '\\') {
        at++;
      } else if (inner === '[') {
        at = findClassEnd(pattern, at) ?? at;
      } else if (inner === '{') {
        depth++;
      } else if (inner === '}' && depth > 0) {
        depth--;
      } else if (inner === ',' && depth === 0) {
        commas.push(at);
      } else if (inner === '}') {
        if (commas.length === 0) {
          break;
        }
        const bounds = [open, ...commas, at];
        const alternatives = bounds.slice(1).map((end, index) => pattern.slice(bounds[index] + 1, end));
        return { open, close: at, alternatives };
      }
    }
  }
  return undefined;
}

/** Where the class opening at `open` closes, or undefined when it never does. */
function findClassEnd(pattern: string, open: number): number | undefined {
  let at = open + 1;
  if (pattern[at] === '!' || pattern[at] === '^') {
    at++;
  }
  // A `]` first in the class is one of its characters.
  if (pattern[at] === ']') {
    at++;
  }
  for (; at < pattern.length; at++) {
    if (pattern[at] === '\\') {
      at++;
    } else if (pattern[at] === '/') {
      return undefined;
    } else if (pattern[at] === ']') {
      return at;
    }
  }
  return undefined;
}

/** A brace-free pattern as its segments' patterns. */
function compilePattern(pattern: string): SegmentPattern[] {
  const segments: SegmentPattern[] = [];
  let tokens: Array<CharToken | { kind: 'star' }> = [];
  let source = '';
  const close = (): void => {
    segments.push(source === '**' ? { kind: 'globstar' } : { kind: 'segment', tokens });
    tokens = [];
    source = '';
  };
  for (let at = 0; at < pattern.length; at++) {
    const char = pattern[at];
    if (char === '\\' && at + 1 < pattern.length) {
      at++;
      tokens.push({ kind: 'literal', char: pattern[at] });
      source += `\\${pattern[at]}`;
    } else if (char === '/') {
      close();
    } else if (char === '*') {
      // Two or more stars in a row are one star within a segment.
      if (tokens[tokens.length - 1]?.kind !== 'star') {
        tokens.push({ kind: 'star' });
      }
      source += '*';
    } else if (char === '?') {
      tokens.push({ kind: 'any' });
      source += '?';
    } else if (char === '[' && findClassEnd(pattern, at) !== undefined) {
      const end = findClassEnd(pattern, at) as number;
      tokens.push(readClass(pattern.slice(at + 1, end)));
      source += pattern.slice(at, end + 1);
      at = end;
    } else {
      tokens.push({ kind: 'literal', char });
      source += char;
    }
  }
  close();
  return segments;
}

/** A class's body, between its brackets, as the characters and ranges it takes. */
function readClass(body: string): CharToken {
  let at = 0;
  const negated = body[0] === '!' || body[0] === '^';
  if (negated) {
    at++;
  }
  const chars: string[] = [];
  for (; at < body.length; at++) {
    if (body[at] === '\\' && at + 1 < body.length) {
      at++;
    }
    chars.push(body[at]);
  }
  const ranges: Array<readonly [string, string]> = [];
  for (let index = 0; index < chars.length; index++) {
    if (chars[index + 1] === '-' && index + 2 < chars.length) {
      ranges.push([chars[index], chars[index + 2]]);
      index += 2;
    } else {
      ranges.push([chars[index], chars[index]]);
    }
  }
  return { kind: 'class', negated, ranges };
}

/** Whether one character token takes the character. */
function matchesChar(token: CharToken, char: string): boolean {
  if (token.kind === 'literal') {
    return token.char === char;
  }
  if (token.kind === 'any') {
    return char !== '/';
  }
  const inside = token.ranges.some(([from, to]) => from <= char && char <= to);
  return char !== '/' && inside !== token.negated;
}

/**
 * Whether the tokens match the whole of one segment: the two-pointer
 * wildcard algorithm, which goes back only to the last `*` seen.
 */
function matchSegment(tokens: ReadonlyArray<CharToken | { kind: 'star' }>, text: string): boolean {
  let token = 0;
  let char = 0;
  let star = -1;
  let starChar = 0;
  while (char < text.length) {
    const current = tokens[token];
    if (current && current.kind !== 'star' && matchesChar(current, text[char])) {
      token++;
      char++;
    } else if (current?.kind === 'star') {
      star = token++;
      starChar = char;
    } else if (star >= 0) {
      token = star + 1;
      char = ++starChar;
    } else {
      return false;
    }
  }
  while (tokens[token]?.kind === 'star') {
    token++;
  }
  return token === tokens.length;
}

/**
 * Whether the segment patterns match the whole path: the same two-pointer
 * algorithm one level up, with `**` as the star over whole segments.
 */
function matchSegments(patterns: readonly SegmentPattern[], segments: readonly string[]): boolean {
  let pattern = 0;
  let segment = 0;
  let star = -1;
  let starSegment = 0;
  while (segment < segments.length) {
    const current = patterns[pattern];
    if (current?.kind === 'segment' && matchSegment(current.tokens, segments[segment])) {
      pattern++;
      segment++;
    } else if (current?.kind === 'globstar') {
      star = pattern++;
      starSegment = segment;
    } else if (star >= 0) {
      pattern = star + 1;
      segment = ++starSegment;
    } else {
      return false;
    }
  }
  while (patterns[pattern]?.kind === 'globstar') {
    pattern++;
  }
  return pattern === patterns.length;
}
