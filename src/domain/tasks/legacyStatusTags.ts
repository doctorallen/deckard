/**
 * The `#status/…` tags Deckard read as statuses before a status was its
 * checkbox's character alone. Nothing reads them as statuses now; the move
 * into checkboxes reads them once more, with the meaning they had, which
 * this module keeps: the namespace they were written in, the character each
 * stood for, and how to find and take one off a task line.
 */
import { escapeRegExp } from '../../shared/text';
import { findCodeAndLinkRanges, isInRanges } from '../markdown/inlineRanges';
import { TAG_WORD_CHARACTERS } from '../markdown/parser';
import { isStatusSymbol } from './taskStatuses';

/** The namespace status tags were written in when `deckard.board.statusNamespace` named none. */
export const LEGACY_STATUS_NAMESPACE = 'status';

/** The character each of Deckard's own status tags stood for. `done` closed no task, and has none. */
const LEGACY_DEFAULT_CHARACTERS: Readonly<Record<string, string>> = {
  todo: ' ',
  doing: '/',
  waiting: 'w',
  someday: 's',
  blocked: '=',
};

/** A namespace as the old setting allowed one: letters first, then letters, digits, marks, `-` and `_`. */
const NAMESPACE = /^\p{L}[\p{L}\p{N}\p{M}_-]*$/u;

/** A tag's part after the namespace as the old settings allowed one. */
const TAG_NAME = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]*$/u;

/** What status tags meant: the namespace they were written in, and the character each tag stood for. */
export interface LegacyStatusTags {
  /** `status` for `#status/doing`, lower case. */
  readonly namespace: string;
  /** By tag as written after the namespace, in lower case, the character it stood for. */
  readonly characters: ReadonlyMap<string, string>;
}

/**
 * What status tags meant, from the raw settings that said so: the namespace
 * from `deckard.board.statusNamespace` (`status` when unset or unreadable),
 * and each tag's character from the `tag` and `symbol` of each
 * `deckard.tasks.statuses` entry, then Deckard's own tags' characters for
 * the tags those leave out.
 */
export function readLegacyStatusTags(namespace: unknown, statuses: unknown): LegacyStatusTags {
  const trimmed = typeof namespace === 'string' ? namespace.trim() : '';
  const characters = new Map<string, string>();
  (Array.isArray(statuses) ? statuses : []).forEach((entry: unknown) => {
    const { tag, symbol, type } = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const name = typeof tag === 'string' ? tag.trim().replace(/^#/, '').toLowerCase() : '';
    if (TAG_NAME.test(name) && isStatusSymbol(symbol) && type !== 'nonTask' && type !== 'done' && type !== 'cancelled' && !characters.has(name)) {
      characters.set(name, symbol);
    }
  });
  Object.entries(LEGACY_DEFAULT_CHARACTERS).forEach(([tag, symbol]) => {
    if (!characters.has(tag)) {
      characters.set(tag, symbol);
    }
  });
  return { namespace: NAMESPACE.test(trimmed) ? trimmed.toLowerCase() : LEGACY_STATUS_NAMESPACE, characters };
}

/** A status tag in `namespace`, with the spaces or tabs before it. */
function statusTagPattern(namespace: string): RegExp {
  return new RegExp(
    `[ \\t]+#${escapeRegExp(namespace)}/[\\p{L}\\p{N}][${TAG_WORD_CHARACTERS}-]*(?![${TAG_WORD_CHARACTERS}/-])`,
    'giu',
  );
}

/** The status tag written on a task line after its box, outside code and links, as written after the namespace, in lower case. */
export function readWrittenStatusTag(line: string, checkboxColumn: number, namespace: string): string | undefined {
  const text = line.slice(checkboxColumn + 2);
  const skipped = findCodeAndLinkRanges(text);
  for (const match of text.matchAll(statusTagPattern(namespace))) {
    if (!isInRanges(skipped, match.index ?? 0)) {
      return match[0].trim().slice(namespace.length + 2).toLowerCase();
    }
  }
  return undefined;
}

/** A task line with every status tag after its box taken off, outside code and links. */
export function removeStatusTags(line: string, checkboxColumn: number, namespace: string): string {
  const head = line.slice(0, checkboxColumn + 2);
  const text = line.slice(checkboxColumn + 2);
  const skipped = findCodeAndLinkRanges(text);
  return head + text.replace(statusTagPattern(namespace), (match, offset: number) => (isInRanges(skipped, offset) ? match : ''));
}
