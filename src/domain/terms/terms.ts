import { noteTitle } from '../index/backlinks';
import { findFrontmatterEnd } from '../markdown/frontmatter';
import { findCodeAndLinkRanges, InlineRange, isInRanges } from '../markdown/inlineRanges';
import { findFencedLines, readHeading } from '../markdown/lineShapes';
import { stripTags } from '../markdown/parser';
import { isTaskLine } from '../markdown/taskDraft';
import type { ParsedFile, WorkspaceIndex } from '../model';

/**
 * Terms (docs/implementation/42-terms.md): the short terms work notes are
 * full of, such as UAT, NDF, or RATES-UAT, how often each is used, and
 * where each was defined: by a term note (`type: term`), which wins, or
 * inline, in the surest form it was written in, the first time by date it
 * was: `NDF (non-deliverable forward)` or `non-deliverable forward (NDF)`,
 * then `NDF means words`, then `NDF: words`.
 *
 * The table is read from the index: each note's terms once per version of
 * the note, and the table once per index, so hovering reads a table that
 * is already there.
 */

/** How many entries must use a token before it is a term. */
export const TERM_MIN_ENTRIES = 3;

/** Where a term was used or defined: a note's line, the note's date, and the heading it is under. */
export interface TermPlace {
  filePath: string;
  /** One-based. */
  line: number;
  /** The note's date, created or the day it states, in milliseconds; 0 when it has none. */
  date: number;
  /** The heading the line is under, its tags taken out; absent above the first heading. */
  heading?: string;
}

/** Where a term's definition comes from, and what it says. */
export interface TermDefinition extends TermPlace {
  text: string;
  /** `note`, a term note's first paragraph; `inline`, words written beside the term in a note. */
  source: 'note' | 'inline';
  /** The line it was written on, trimmed, for an inline one. */
  quote?: string;
}

/** One term: how many entries use it, its first use, and its definition when it has one. */
export interface TermEntry {
  term: string;
  /** How many entries use it, its definition's among them. */
  count: number;
  firstUse?: TermPlace;
  definition?: TermDefinition;
}

/** Every term of a workspace: those used in at least three entries, and those a term note defines. */
export interface TermTable {
  readonly terms: ReadonlyMap<string, TermEntry>;
}

/** A term written in a line, by its columns. */
export interface TermSpan {
  term: string;
  start: number;
  end: number;
}

/**
 * Words written in capitals that are no term: Markdown's and English's,
 * and the month and day abbreviations.
 */
const NOT_TERMS: ReadonlySet<string> = new Set([
  'OK', 'TODO', 'FIXME', 'XXX', 'HACK', 'DONE', 'NOTE', 'NB', 'FYI', 'ASAP', 'TBD', 'WIP', 'PS', 'RE', 'FW', 'FWD',
  'TIP', 'WARNING', 'CAUTION', 'INFO',
  'AM', 'PM', 'US', 'UK', 'EU', 'ID', 'IDS', 'IE', 'EG', 'ETC', 'VS', 'TL', 'DR', 'TLDR',
  'I', 'A', 'AN', 'THE', 'AND', 'OR', 'NOT', 'NO', 'YES', 'IS', 'IT', 'IF', 'IN', 'ON', 'AT', 'TO', 'OF', 'BY',
  'BE', 'DO', 'GO', 'SO', 'UP', 'WE', 'ME', 'MY', 'ALL', 'NEW', 'NOW', 'BUT', 'FOR', 'ARE', 'WAS', 'ANY',
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUNE', 'JUL', 'JULY', 'AUG', 'SEP', 'SEPT', 'OCT', 'NOV', 'DEC',
  'MON', 'TUE', 'TUES', 'WED', 'THU', 'THUR', 'THURS', 'FRI', 'SAT', 'SUN',
]);

/** A run of capitals and digits, its parts joined by hyphens; where it may stand is checked apart. */
const TOKEN = /[A-Z0-9]+(?:-[A-Z0-9]+)*/g;
/** A letter, a digit, or `_`: what a term may not touch on either side. */
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;
/** What a term may not follow besides a word character: `#`, `@`, `/`, `.`, `\`, or `-`, so `#UAT` and `path/UAT` are none. */
const NOT_BEFORE = new Set(['#', '@', '/', '.', '\\', '-']);
/** Two capitals, or a capital and a digit, side by side: a line without them holds no term. */
const MAY_HOLD_TERM = /[A-Z0-9][A-Z]|[A-Z][0-9]/;

/** Whether a run at `start` to `end` stands alone in its line. */
function standsAlone(text: string, start: number, end: number): boolean {
  const before = text[start - 1];
  const after = text[end];
  return (
    (before === undefined || (!NOT_BEFORE.has(before) && !WORD_CHARACTER.test(before))) &&
    (after === undefined || !WORD_CHARACTER.test(after))
  );
}

/**
 * Whether a token has a term's shape: two to six capitals and digits, or
 * up to twelve with hyphens between its parts, with a letter, and not
 * starting with a number such as a year.
 */
export function isTermShape(token: string): boolean {
  const length = token.length;
  if (length < 2 || length > 12) {
    return false;
  }
  // Read by hand rather than by pattern: every capitalized word in every
  // note comes through here.
  let letters = 0;
  let hyphens = 0;
  let part = 0;
  for (let at = 0; at < length; at += 1) {
    const code = token.charCodeAt(at);
    if (code >= 65 && code <= 90) {
      letters += 1;
      part += 1;
    } else if (code >= 48 && code <= 57) {
      part += 1;
    } else if (code === 45 && part > 0 && (hyphens > 0 || letters > 0)) {
      hyphens += 1;
      part = 0;
    } else {
      return false;
    }
  }
  return part > 0 && letters > 0 && (hyphens > 0 || length <= 6);
}

/**
 * A number with a time or a simple quantity after it, written in capitals:
 * `10AM`, `5PM`, `24H`, `30M`, `5K`, `2BN`, `64GB`, `10X`, `1ST`. Not a
 * term, though `2FA` and `3DS` are.
 */
const QUANTITY = /^\d+(?:AM|PM|H|HR|HRS|MIN|MINS|S|SEC|MS|K|M|B|BN|KB|MB|GB|TB|BPS|X|ST|ND|RD|TH)$/;

/** Whether a token is a term: its shape, and not a capitalized common word, a time, or a quantity. */
export function isTermToken(token: string): boolean {
  return isTermShape(token) && !NOT_TERMS.has(token) && !QUANTITY.test(token);
}

/**
 * Whether a line is shouted, every letter a capital, as a heading in
 * capitals is: its words are not terms.
 */
function isShouted(text: string): boolean {
  return !/\p{Ll}/u.test(text) && (text.match(/\p{L}+/gu) ?? []).length >= 2;
}

/**
 * The terms written in one line, outside code, links, web addresses, and
 * tags; none in a shouted line.
 */
export function findTermSpans(text: string): TermSpan[] {
  if (!MAY_HOLD_TERM.test(text) || isShouted(text)) {
    return [];
  }
  let skipped: InlineRange[] | undefined;
  const spans: TermSpan[] = [];
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(text); match; match = TOKEN.exec(text)) {
    const start = match.index;
    const end = start + match[0].length;
    if (match[0].length > 1 && standsAlone(text, start, end) && isTermToken(match[0])) {
      skipped ??= findCodeAndLinkRanges(text);
      if (!isInRanges(skipped, start)) {
        spans.push({ term: match[0], start, end });
      }
    }
  }
  return spans;
}

/** One line of a note where terms can be written, with where it is. */
export interface TermLine {
  text: string;
  /** One-based. */
  line: number;
  /** The heading above it as written, tags and all; absent above the first. */
  heading?: string;
  /** Which entry of the note it is in: 0 above the first heading, then one more at each heading. */
  entry: number;
}

/** A line that may open a heading: up to three spaces, then `#`. */
const MAY_BE_HEADING = /^ {0,3}#/;

/**
 * Hands over each line of a note where terms can be written, in order: not
 * its front matter, not fenced code, each with the heading above it.
 */
export function forEachTermLine(content: string, visit: (text: string, line: number, heading: string | undefined, entry: number) => void): void {
  const lines = content.split(/\r?\n/);
  const fenced = findFencedLines(lines);
  const start = (findFrontmatterEnd(lines) ?? -1) + 1;
  let heading: string | undefined;
  let entry = 0;
  for (let at = start; at < lines.length; at += 1) {
    if (fenced.has(at)) {
      continue;
    }
    const text = lines[at];
    const found = MAY_BE_HEADING.test(text) ? readHeading(text) : undefined;
    if (found) {
      heading = found.text;
      entry += 1;
    }
    visit(text, at + 1, heading, entry);
  }
}

/** A heading's words as a place names it: its tags taken out, or none. */
function headingWords(heading: string | undefined): string | undefined {
  return heading === undefined ? undefined : stripTags(heading).trim() || undefined;
}

/** Small words a phrase may hold that no letter of its term stands for. */
const SMALL_WORDS: ReadonlySet<string> = new Set(['of', 'and', 'the', 'for', 'to', 'in', 'on', 'a', 'an', 'at', 'by', 'with', 'or', '&']);

/**
 * Whether a phrase plausibly spells a term's initials: each letter or
 * digit of the term starts a word, in order, and every other word is a
 * small one such as *of* or *and*. Hyphens and slashes part words, so
 * "non-deliverable forward" is NDF and "3-D Secure" is 3DS.
 */
export function matchesInitials(term: string, phrase: string): boolean {
  const letters = [...term.replace(/[^A-Za-z0-9]/g, '').toLowerCase()];
  const words = phrase.toLowerCase().split(/[\s/-]+/).map((word) => word.replace(/^[^\p{L}\p{N}&]+|[^\p{L}\p{N}&]+$/gu, '')).filter(Boolean);
  if (letters.length < 2 || words.length === 0) {
    return false;
  }
  // Each letter and word pair is tried once, so a long line of small words
  // takes letters × words steps, not one for each way to skip them.
  const tried = new Map<number, boolean>();
  const match = (letter: number, word: number): boolean => {
    if (word === words.length) {
      return letter === letters.length;
    }
    const key = letter * (words.length + 1) + word;
    const known = tried.get(key);
    if (known !== undefined) {
      return known;
    }
    const found =
      (letter < letters.length && words[word].startsWith(letters[letter]) && match(letter + 1, word + 1)) ||
      (SMALL_WORDS.has(words[word]) && match(letter, word + 1));
    tried.set(key, found);
    return found;
  };
  return match(0, 0);
}

/** A definition written in one line: the term, its words, and how sure its form is. */
export interface InlineDefinition {
  term: string;
  text: string;
  /**
   * 0 for a parenthesized form, whose initials match; 1 for `NDF means
   * words`; 2 for `NDF: words`, which a status line is written in too. Of
   * a term's definitions, the surest form wins, then the earliest.
   */
  rank: number;
}

/** `NDF (non-deliverable forward)`: a term, then a phrase in parentheses. */
const TERM_THEN_PHRASE = /(?<![\p{L}\p{N}_#@/.-])([A-Z0-9]+(?:-[A-Z0-9]+)*)[ \t]*\(([^()]{3,120})\)/gu;
/** `non-deliverable forward (NDF)`: a term alone in parentheses, after its phrase. */
const PHRASE_THEN_TERM = /\(([A-Z0-9]+(?:-[A-Z0-9]+)*)\)/g;
/** `NDF: words`, or `**NDF**: words`, as a line of its own, or a list item: its list mark, its emphasis, the term, and the words. */
const TERM_COLON = /^[ \t]*((?:[-*+]|\d+[.)])[ \t]+)?(\*\*|__)?([A-Z0-9]+(?:-[A-Z0-9]+)*)(?:\*\*|__)?[ \t]*:[ \t]+(.+)$/;
/** `NDF means words` and `NDF stands for words`. */
const TERM_MEANS = /(?<![\p{L}\p{N}_#@/.-])([A-Z0-9]+(?:-[A-Z0-9]+)*)[ \t]+(?:means|stands for)[ \t]+([^.;!?]+)/gu;

/**
 * The definitions a line writes, in the four forms; a parenthesized form
 * only when its phrase spells the term's initials. Code and links are
 * left out. `NDF: words` is read only when it reads as a definition and
 * not as a status, *UAT: blocked*: never on a task's line, never a single
 * word, and in a list item only when its term is emphasized, as a
 * glossary's is, or its words spell its initials; elsewhere, three words
 * or more, or words that spell its initials.
 */
export function readInlineDefinitions(text: string): InlineDefinition[] {
  // Each form has a mark of its own; most lines have none, and are read no further.
  const parenthesized = text.includes('(');
  const colon = text.includes(':');
  const means = text.includes(' means ') || text.includes(' stands for ');
  if ((!parenthesized && !colon && !means) || !/[A-Z]/.test(text)) {
    return [];
  }
  const skipped = findCodeAndLinkRanges(text);
  const found: InlineDefinition[] = [];
  const add = (rank: number) => (term: string, words: string, at: number): void => {
    const definition = tidyDefinition(words);
    if (isTermToken(term) && definition && !isInRanges(skipped, at) && !found.some((known) => known.term === term)) {
      found.push({ term, text: definition, rank });
    }
  };
  // The surest form first, so it is the one a line that writes two keeps.
  if (parenthesized) {
    readParenthesized(text, add(0));
  }
  if (means) {
    for (const match of text.matchAll(TERM_MEANS)) {
      add(1)(match[1], match[2], match.index);
    }
  }
  const line = colon && !isTaskLine(text) ? TERM_COLON.exec(text) : null;
  if (line && isColonDefinition(line[3], line[4], { listItem: line[1] !== undefined, emphasized: line[2] !== undefined })) {
    add(2)(line[3], line[4], text.indexOf(line[3]));
  }
  return found;
}

/** Whether `NDF: words` reads as a definition rather than a status; see readInlineDefinitions. */
function isColonDefinition(term: string, words: string, { listItem, emphasized }: { listItem: boolean; emphasized: boolean }): boolean {
  const tidy = tidyDefinition(words);
  if (matchesInitials(term, tidy)) {
    return true;
  }
  return (!listItem || emphasized) && tidy.split(/\s+/).filter(Boolean).length >= 3;
}

/**
 * The two parenthesized forms in a line, each handed to `add` with its
 * column when its phrase spells the term's initials.
 */
function readParenthesized(text: string, add: (term: string, words: string, at: number) => void): void {
  for (const match of text.matchAll(TERM_THEN_PHRASE)) {
    if (matchesInitials(match[1], match[2])) {
      add(match[1], match[2], match.index);
    }
  }
  for (const match of text.matchAll(PHRASE_THEN_TERM)) {
    const phrase = findInitialsPhrase(match[1], text.slice(0, match.index));
    if (phrase) {
      add(match[1], phrase, match.index);
    }
  }
}

/**
 * The words before a parenthesized term that spell its initials: the
 * fewest that do, from the term's letter count up to four more for small
 * words, or undefined.
 */
function findInitialsPhrase(term: string, before: string): string | undefined {
  const words = before.trimEnd().split(/[ \t]+/).filter(Boolean);
  const letters = term.replace(/[^A-Za-z0-9]/g, '').length;
  for (let count = 1; count <= Math.min(words.length, letters + 4); count += 1) {
    const phrase = words.slice(words.length - count).join(' ');
    if (matchesInitials(term, phrase)) {
      return phrase;
    }
  }
  return undefined;
}

/** A definition's words: Markdown emphasis and the closing punctuation off, cut to 200 characters. */
function tidyDefinition(words: string): string {
  const tidy = words
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[,:;–—-]+\s*/, '')
    .replace(/[\s.,;:!–—-]+$/, '');
  return tidy.length > 200 ? `${tidy.slice(0, 199)}…` : tidy;
}

/** What one note adds to the table, read once per version of the note. */
interface FileTerms {
  /** Each term the note uses: how many of its entries, and the first line. */
  uses: Map<string, { entries: number; first: { line: number; heading: string | undefined } }>;
  /** Each term the note defines inline, its first definition in the surest form it is written in. */
  inline: Map<string, { text: string; line: number; heading: string | undefined; quote: string; rank: number }>;
  /** The term the note is about, when it is a term note. */
  note?: { term: string; text: string; line: number };
}

/** Each note's terms, kept while the note's parsed version lives. */
const fileTerms = new WeakMap<ParsedFile, FileTerms>();
/** Each index's table, kept while the index lives. */
const tables = new WeakMap<WorkspaceIndex, TermTable>();

/** A note's terms, read from its text once. */
function readFileTerms(file: ParsedFile): FileTerms {
  const cached = fileTerms.get(file);
  if (cached) {
    return cached;
  }
  const uses: FileTerms['uses'] = new Map();
  const inline: FileTerms['inline'] = new Map();
  const entriesOf = new Map<string, Set<number>>();
  forEachTermLine(file.content, (text, line, heading, entry) => {
    // A line with no two capitals side by side neither uses nor defines a term.
    if (!MAY_HOLD_TERM.test(text)) {
      return;
    }
    for (const { term } of findTermSpans(text)) {
      const entries = entriesOf.get(term) ?? new Set<number>();
      entries.add(entry);
      entriesOf.set(term, entries);
      if (!uses.has(term)) {
        uses.set(term, { entries: 0, first: { line, heading } });
      }
    }
    for (const definition of readInlineDefinitions(text)) {
      if ((inline.get(definition.term)?.rank ?? Infinity) > definition.rank) {
        inline.set(definition.term, { text: definition.text, line, heading, quote: text.trim(), rank: definition.rank });
      }
    }
  });
  entriesOf.forEach((entries, term) => {
    const use = uses.get(term);
    if (use) {
      use.entries = entries.size;
    }
  });
  const read: FileTerms = { uses, inline, ...withTermNote(file) };
  fileTerms.set(file, read);
  return read;
}

/**
 * A term note's term and definition: a note whose `type:` is `term`, its
 * term its `term:` field, or its title, and its definition its first
 * paragraph under the title. Nothing when the term is no term's shape, or
 * the note has no paragraph.
 */
function withTermNote(file: ParsedFile): Pick<FileTerms, 'note'> {
  if (file.typeKey?.trim().toLowerCase() !== 'term') {
    return {};
  }
  const written = file.properties?.find((property) => property.name.toLowerCase() === 'term')?.values[0]?.text.trim();
  const term = (written || noteTitle(file.filePath)).trim().toUpperCase();
  if (!isTermShape(term)) {
    return {};
  }
  const paragraph = readFirstParagraph(file.content);
  return paragraph ? { note: { term, text: paragraph.text, line: paragraph.line } } : {};
}

/** A note's first paragraph after its front matter and its headings: its lines joined, and where it starts. */
function readFirstParagraph(content: string): { text: string; line: number } | undefined {
  const lines: TermLine[] = [];
  forEachTermLine(content, (text, line, heading, entry) => lines.push({ text, line, heading, entry }));
  const start = lines.findIndex(({ text }) => text.trim() !== '' && !readHeading(text));
  if (start < 0) {
    return undefined;
  }
  const end = lines.findIndex(({ text }, at) => at > start && (text.trim() === '' || readHeading(text) !== undefined));
  const text = tidyDefinition(
    lines
      .slice(start, end < 0 ? undefined : end)
      .map(({ text: line }) => line.trim())
      .join(' '),
  );
  return text ? { text, line: lines[start].line } : undefined;
}

/** Whether one place comes before another: by date, then path, then line. */
function isEarlier(date: number, filePath: string, line: number, right: TermPlace | undefined): boolean {
  if (!right) {
    return true;
  }
  if (date !== right.date) {
    return date < right.date;
  }
  return filePath === right.filePath ? line < right.line : filePath < right.filePath;
}

/** A place as the table keeps it: its heading's words, tags taken out, or no heading. */
function placed<Place extends TermPlace>(place: Place): Place {
  const { heading, ...rest } = place;
  const words = headingWords(heading);
  return (words ? { ...rest, heading: words } : rest) as Place;
}

/**
 * The workspace's terms, read once per index: every token used in at
 * least three entries, and every term a term note defines, each with its
 * count, first use, and definition. A term note's definition wins; failing
 * one, the inline definition in the surest form, the first by date of
 * those, for a term used often enough to be one.
 */
export function getTermTable(index: WorkspaceIndex): TermTable {
  const cached = tables.get(index);
  if (cached) {
    return cached;
  }
  const table = buildTermTable(index.files.values());
  tables.set(index, table);
  return table;
}

/** The table of these notes, built afresh, reading each note's terms once. */
export function buildTermTable(files: Iterable<ParsedFile>): TermTable {
  const counts = new Map<string, number>();
  const firstUses = new Map<string, TermPlace>();
  const inline = new Map<string, TermDefinition & { rank: number }>();
  const notes = new Map<string, TermDefinition>();
  for (const file of files) {
    const read = readFileTerms(file);
    const { filePath } = file;
    const date = file.createdAt ?? file.updatedAt ?? 0;
    read.uses.forEach((use, term) => {
      counts.set(term, (counts.get(term) ?? 0) + use.entries);
      if (isEarlier(date, filePath, use.first.line, firstUses.get(term))) {
        firstUses.set(term, { filePath, date, line: use.first.line, heading: use.first.heading });
      }
    });
    read.inline.forEach((definition, term) => {
      const known = inline.get(term);
      if (!known || definition.rank < known.rank || (definition.rank === known.rank && isEarlier(date, filePath, definition.line, known))) {
        inline.set(term, { filePath, date, source: 'inline', ...definition });
      }
    });
    if (read.note && isEarlier(date, filePath, read.note.line, notes.get(read.note.term))) {
      const { term, text, line } = read.note;
      notes.set(term, { filePath, date, line, text, source: 'note' });
    }
  }
  const terms = new Map<string, TermEntry>();
  for (const term of new Set([...counts.keys(), ...notes.keys()])) {
    const count = counts.get(term) ?? 0;
    if (count < TERM_MIN_ENTRIES && !notes.has(term)) {
      continue;
    }
    const definition = notes.get(term) ?? withoutRank(inline.get(term));
    const firstUse = firstUses.get(term);
    terms.set(term, {
      term,
      count,
      ...(firstUse ? { firstUse: placed(firstUse) } : {}),
      ...(definition ? { definition: placed(definition) } : {}),
    });
  }
  return { terms };
}

/** An inline definition as the table gives it, without the rank it was chosen by. */
function withoutRank(definition: (TermDefinition & { rank: number }) | undefined): TermDefinition | undefined {
  if (!definition) {
    return undefined;
  }
  const { rank: _rank, ...rest } = definition;
  return rest;
}

/**
 * The term a question asks about, as Find reads one: the term alone, or
 * `what is NDF`, `what's NDF`, `what does NDF mean`, `define NDF`, a
 * closing `?` allowed, in any case.
 */
export function readTermQuestion(input: string): string | undefined {
  const text = input.trim().replace(/\?+$/, '').trim();
  const asked =
    /^(?:what\s+is|what's|whats|define|meaning\s+of)\s+(\S+)$/i.exec(text)?.[1] ??
    /^what\s+does\s+(\S+)\s+(?:mean|stand\s+for)$/i.exec(text)?.[1] ??
    (/^\S+$/.test(text) ? text : undefined);
  return asked === undefined ? undefined : asked.toUpperCase();
}
