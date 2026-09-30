import { findFrontmatterEnd } from './frontmatter';
import { findFencedLines, isHeadingLine, matchTaskLine, TaskLineShape } from './lineShapes';
import { stripTags } from './parser';
import { BLOCK_ID_PATTERN, parseTaskMetadata } from './taskMetadata';

/**
 * Markdown as preview text: the one place a note's words are turned into the
 * line or two a result card shows under its title. Related Notes uses it for
 * excerpts; anything else that previews an entry should too, so every
 * preview drops the same Markdown the same way.
 */

const TABLE_ROW = /^\s*\|/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const IMAGE_ONLY = /^\s*(?:!\[[^\]]*\]\([^)]*\)|!\[\[[^\]]*\]\])\s*$/;
/** A task line of any kind, migrated `[>]` included, with a gap before its words. */
const TASK: TaskLineShape = { indent: 'whitespace', marks: ' xX>', after: 'gap' };
const LIST_OR_QUOTE = /^\s*(?:>\s*)*(?:(?:[-*+]|\d+[.)])[ \t]+)?/;

/** One line's words: links read as their text, and marks, tags, and ids gone. */
function cleanLine(line: string, personMarker?: string): string {
  const text = line
    .replace(LIST_OR_QUOTE, '')
    .replace(BLOCK_ID_PATTERN, '')
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/!?\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, '$1$2');
  // A tag taken from before a stop would leave "with ." behind.
  return stripTags(text, personMarker).replace(/\s+/g, ' ').replace(/ ([.,;:!?])/g, '$1').trim();
}

/**
 * The prose lines of some Markdown, cleaned: headings, front matter, fenced
 * code, blank lines, tables, rules, image-only lines, and lines that are
 * only tags are left out; tags, task metadata, block ids, and Markdown marks
 * are taken off. Task lines are used only when there is no other prose.
 */
export function readProseLines(markdown: string, options: { personMarker?: string } = {}): string[] {
  let lines = markdown.split(/\r?\n/);
  const frontmatterEnd = findFrontmatterEnd(lines, 'dashes-or-dots');
  if (frontmatterEnd !== undefined) {
    lines = lines.slice(frontmatterEnd + 1);
  }
  const fenced = findFencedLines(lines);
  const prose: string[] = [];
  const tasks: string[] = [];
  lines.forEach((line, index) => {
    if (
      fenced.has(index) ||
      line.trim() === '' ||
      isHeadingLine(line, { allowBare: true }) ||
      TABLE_ROW.test(line) ||
      RULE.test(line) ||
      IMAGE_ONLY.test(line)
    ) {
      return;
    }
    const task = matchTaskLine(line, TASK);
    if (task) {
      const words = cleanLine(parseTaskMetadata(task.body).title, options.personMarker);
      if (words) {
        tasks.push(words);
      }
      return;
    }
    const words = cleanLine(line, options.personMarker);
    if (words) {
      prose.push(words);
    }
  });
  return prose.length > 0 ? prose : tasks;
}

/** Whether a line holds a term at the start of one of its words. */
function holdsTerm(line: string, terms: readonly string[]): boolean {
  const lower = line.toLowerCase();
  return terms.some((term) => {
    const wanted = term.toLowerCase();
    let at = lower.indexOf(wanted);
    while (at >= 0) {
      if (at === 0 || !/[\p{L}\p{N}]/u.test(lower[at - 1])) {
        return true;
      }
      at = lower.indexOf(wanted, at + 1);
    }
    return false;
  });
}

/**
 * An excerpt of up to `maxChars` characters: from the first line holding one
 * of the terms, or from the first line, through the lines after it, cut at a
 * word with `…`. Starting after the first line, it opens with `…` too.
 */
export function formatExcerpt(
  lines: readonly string[],
  terms: readonly string[] = [],
  maxChars = 240,
): string | undefined {
  if (lines.length === 0) {
    return undefined;
  }
  const found = terms.length > 0 ? lines.findIndex((line) => holdsTerm(line, terms)) : -1;
  const start = Math.max(0, found);
  const text = lines.slice(start).join(' ');
  const lead = start > 0 ? '…' : '';
  if (text.length + lead.length <= maxChars) {
    return lead + text;
  }
  const room = maxChars - lead.length - 1;
  const cut = text.slice(0, room + 1);
  const space = cut.lastIndexOf(' ');
  const kept = (space > room / 2 ? cut.slice(0, space) : cut.slice(0, room)).replace(/[\s,;:.-]+$/, '');
  return `${lead}${kept}…`;
}
