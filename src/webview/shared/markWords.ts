/**
 * The searched words marked where they appear in the results, so a reader
 * can tell at a glance why each one was found (Hearst, Search User
 * Interfaces, ch. 5). Only text is marked, never a tag or a control.
 *
 * Marking changes text nodes a draw made, outside the draw, so a page puts
 * them back before it draws again: `markWords` returns what puts them back,
 * and the next draw finds the page as Preact left it, unmarked, as each of
 * the template's draws did.
 */

/** One text node marked, and the nodes it was replaced with. */
interface Marked {
  readonly original: Text;
  readonly replacement: readonly ChildNode[];
}

/** Takes the marks out again, putting back each text node they replaced. */
export type Unmark = () => void;

/**
 * A word as a pattern that matches it as written. Every character a pattern
 * reads specially is escaped, so `a.b` matches only `a.b`, and `c++` is a
 * word rather than a pattern that throws. Each is a syntax character, which
 * may be escaped under the `u` flag as well.
 */
function literal(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** The words as one pattern, each matched as written. */
function patternOf(words: readonly string[], wordStart: boolean): RegExp {
  return new RegExp(`${wordStart ? '(?<![\\p{L}\\p{N}])' : ''}(${words.map(literal).join('|')})`, wordStart ? 'giu' : 'gi');
}

/** The text nodes under `root` that a pattern finds, outside controls, tags, code, and marks. */
function textToMark(root: Element, pattern: RegExp): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement && node.parentElement.closest('button, a, mark, [data-tag-key], .inline-tag, .tag-open, code')) {
      continue;
    }
    pattern.lastIndex = 0;
    if (pattern.test(String(node.nodeValue))) {
      found.push(node as Text);
    }
  }
  return found;
}

/**
 * A text's words marked: the text as the reader sees it, cut where the
 * pattern finds a word, each word in a `<mark>` and the text between as
 * text. Matching the text itself, never its HTML, keeps a word such as
 * "amp" or "lt" from being found inside `&amp;` or `&lt;`, the HTML a `&`
 * or `<` is written as, which marked half of it and showed the reader the
 * entity as text.
 */
function markedNodes(text: string, pattern: RegExp): ChildNode[] {
  const nodes: ChildNode[] = [];
  let from = 0;
  // matchAll starts where the pattern's last search left off.
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > from) {
      nodes.push(document.createTextNode(text.slice(from, match.index)));
    }
    const mark = document.createElement('mark');
    mark.textContent = match[0];
    nodes.push(mark);
    from = match.index + match[0].length;
  }
  if (from < text.length) {
    nodes.push(document.createTextNode(text.slice(from)));
  }
  return nodes;
}

/**
 * Marks each word of two letters or more where it appears under `root`, in
 * `<mark>`. `wordStart` marks a word only where one starts, so "route"
 * marks "routes" but "art" does not mark "start". Returns what takes the
 * marks out again.
 */
export function markWords(root: Element | null, words: readonly unknown[] | undefined, options?: { readonly wordStart?: boolean }): Unmark {
  const wanted = (words || []).map((word) => String(word).toLowerCase()).filter((word) => word.length >= 2);
  if (!wanted.length || !root || !document.createTreeWalker) {
    return () => undefined;
  }
  const pattern = patternOf(wanted, Boolean(options && options.wordStart));
  const marked: Marked[] = textToMark(root, pattern).map((node) => {
    const replacement = markedNodes(String(node.nodeValue), pattern);
    node.replaceWith(...replacement);
    return { original: node, replacement };
  });
  return () => {
    for (const { original, replacement } of marked.reverse()) {
      const first = replacement[0];
      if (first && first.parentNode) {
        first.parentNode.insertBefore(original, first);
        replacement.forEach((node) => node.remove());
      }
    }
  };
}
