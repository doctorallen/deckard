import { isInCodeOrLink } from './inlineRanges';

/**
 * What the editor's completions are being asked to complete, read from the
 * line the cursor is on: a tag after `#`, `@`, or the person marker, and
 * which tags match what has been typed; or a note, heading, or `^block` id
 * inside an unclosed `[[`.
 *
 * These are the rules behind the completion providers in `ui/providers`,
 * kept free of VS Code so they can be tested without it.
 */

/**
 * Describes the replacement range around the cursor, including any suffix the
 * user has already typed beyond the cursor.
 */
export interface TagCompletionContext {
  marker: string;
  query: string;
  startColumn: number;
  endColumn: number;
}

/**
 * Whether a tag is one to offer for what has been typed after `marker`.
 * The person marker offers people (`@` keys), a bare `@` that is not the
 * person marker offers the `#tag-at/` tags written with it, and anything
 * else offers `#` tags. A tag matches when it, or any of its `/` segments,
 * starts with the query, which is already lowercased.
 */
export function matchesTagCompletion(
  tag: { key: string; label: string },
  marker: string,
  query: string,
  personMarker: string,
): boolean {
  const isPerson = marker === personMarker;
  const isGenericAtTag = marker === '@' && !isPerson;
  if (
    (isPerson && !tag.key.startsWith('@')) ||
    (isGenericAtTag && !tag.key.startsWith('#tag-at/')) ||
    (!isPerson && !isGenericAtTag && !tag.key.startsWith('#'))
  ) {
    return false;
  }
  const value = isGenericAtTag
    ? tag.key.slice('#tag-at/'.length)
    : tag.key.slice(1);
  return (
    value.startsWith(query) ||
    value.split('/').some((segment) => segment.startsWith(query))
  );
}

/**
 * Finds a tag marker at the cursor and calculates a complete replacement range.
 *
 * The complete replacement range lets tag completion coexist with Markdown
 * headings while still preserving text typed after the cursor.
 */
export function getTagCompletionContext(
  line: string,
  character: number,
  personMarker = '@',
): TagCompletionContext | undefined {
  const linePrefix = line.slice(0, character);
  const escapedMarker = personMarker.replace(/[\\\]^]/g, '\\$&');
  const tagTokenPattern = new RegExp(
    `(^|[^\\w#])([#@${escapedMarker}])([A-Za-z0-9][A-Za-z0-9_-]*(?:\\/[A-Za-z0-9][A-Za-z0-9_-]*)*)?$`,
  );
  const match = linePrefix.match(tagTokenPattern);
  if (!match) {
    return undefined;
  }

  const marker = match[2];
  const query = match[3] ?? '';
  const suffix = line.slice(character).match(/^[A-Za-z0-9_/-]*/)?.[0] ?? '';
  const startColumn = (match.index ?? 0) + match[0].lastIndexOf(marker);
  // A `#` or `@` in inline code or a link is text, so it is not completed
  // as a tag; nor is one after a `[[` not closed yet, where the link's own
  // completion offers headings.
  if (
    isInCodeOrLink(line, startColumn) ||
    linePrefix.lastIndexOf('[[') > linePrefix.lastIndexOf(']]')
  ) {
    return undefined;
  }

  return {
    marker,
    query,
    startColumn,
    endColumn: character + suffix.length,
  };
}

/**
 * The note name being typed inside an unclosed `[[`, and the column it
 * starts at, or nothing when the cursor is not in one. A `|` or `]` ends
 * the name, so an alias or a closed link is never completed.
 */
export function getWikiLinkCompletionContext(
  line: string,
  character: number,
): { query: string; startColumn: number } | undefined {
  const prefix = line.slice(0, character);
  const match = prefix.match(/\[\[([^\]|]*)$/);
  if (!match) {
    return undefined;
  }

  return {
    query: match[1],
    startColumn: character - match[1].length,
  };
}

/**
 * The note and partial heading being completed past a `#`, or nothing when
 * the caret is not past one. `##words` searches every note's headings, which
 * is a note of `undefined`; `#words` is the note the link is written in.
 */
export function getHeadingCompletionContext(
  query: string,
): { note: string | undefined; query: string } | undefined {
  if (query.includes('#^')) {
    return undefined;
  }
  if (query.startsWith('##')) {
    return { note: undefined, query: query.slice(2) };
  }
  const hash = query.indexOf('#');
  if (hash < 0) {
    return undefined;
  }
  return { note: query.slice(0, hash).trim(), query: query.slice(hash + 1) };
}

/**
 * The note and partial id being completed past a `#^`, or nothing when the
 * caret is not in one. An empty note means the link points into the note it
 * is written in, as `[[#^id]]` does.
 */
export function getBlockCompletionContext(
  query: string,
): { note: string; query: string } | undefined {
  const caret = query.indexOf('#^');
  if (caret < 0) {
    return undefined;
  }
  return {
    note: query.slice(0, caret).trim(),
    query: query.slice(caret + 2),
  };
}
