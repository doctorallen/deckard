/**
 * File this (docs/implementation/43-file-this.md): a fact written in today's
 * note, carried where it belongs. A line that mentions a row offers, on its
 * lightbulb, to copy itself to that row's hub note under **Notes**, with a
 * link back (D23); and, when it says what one of a type's fields holds, in
 * the words the type's `Words` column lists, to set that field (D24).
 *
 * - **Filing.** A tag on the line that has a hub note is a place to file
 *   it, at most four, in the order they are written. The line is added as
 *   the last list item under the hub's Notes heading, at any level, which
 *   is made at the end of the note when it has none, as
 *   `- 2026-10-14: <the line> ([[2026-10-14#Org news]])`.
 * - **Setting a field.** A phrase of a field's Words, after a row the line
 *   mentions, sets that field on the row before it to the row after it, or,
 *   when the field is the other row's type's, the other way round: in
 *   "@priya now leads #team/fx", "leads" is Team's `lead`, so FX's lead
 *   becomes Priya. A select's value is one of its options written after
 *   the phrase.
 *
 * Everything here is worked out from the line and the index; the lightbulb
 * and the writes are `ui/commands/fileThis.ts`'s.
 */
import { createNoteTitleMap, noteTitle, normalizeHeading, parseWikiTarget, resolveWikiTarget, WIKI_LINK_WITH_TEXT } from '../../domain/index/backlinks';
import { findFrontmatterEnd } from '../../domain/markdown/frontmatter';
import { findFencedLines, readHeading } from '../../domain/markdown/lineShapes';
import { lineIndent, isListItemLine } from '../../domain/markdown/listNesting';
import { extractTagSpans, findFileDailyNoteDate, stripTags, type EntityNamespaceAliases } from '../../domain/markdown/parser';
import { formatNoteLink, type NoteLinkStyle } from '../../domain/markdown/wikiLinks';
import type { FieldKind, ParsedFile, TypeField, WorkspaceIndex } from '../../domain/model';
import type { TypeIndex, TypeRow } from '../../domain/types/typeIndex';
import { formatIsoDate } from '../../domain/markdown/calendar';

/** How many hub notes the lightbulb offers to file a line in. */
export const MAX_FILING_TARGETS = 4;

/** A row, or a tag with a hub note, that a line mentions, and where it is written on the line. */
export interface LineMention {
  /** The columns of what names it: the tag, or the whole `[[link]]`. */
  start: number;
  end: number;
  /** The tag written, for a tag. */
  tagKey?: string;
  /** The row it names, when a type has it. */
  row?: TypeRow;
  /** The tag's hub note, which a line is filed in. */
  hubPath?: string;
}

/**
 * The rows and tags a line mentions, in the order they are written: each
 * tag, with its hub note and its row, and each `[[link]]` to a row's note.
 */
export function findLineMentions(
  index: WorkspaceIndex,
  types: TypeIndex,
  line: string,
  { sourcePath, aliases }: { sourcePath: string; aliases: EntityNamespaceAliases },
): LineMention[] {
  const tags: LineMention[] = extractTagSpans(line, true, aliases).map((span) => {
    const row = types.isEmpty ? undefined : types.rowOfTag(span.key);
    const hubPath = index.tags.get(span.key)?.hubFilePaths?.[0] ?? (row && row.tagKeys.length ? row.filePath : undefined);
    return { start: span.startColumn, end: span.endColumn, tagKey: span.key, ...(row ? { row } : {}), ...(hubPath ? { hubPath } : {}) };
  });
  const links: LineMention[] = [];
  if (!types.isEmpty && line.includes('[[')) {
    const titles = createNoteTitleMap(index);
    for (const match of line.matchAll(WIKI_LINK_WITH_TEXT)) {
      const filePath = resolveWikiTarget(titles, parseWikiTarget(match[1]).note, sourcePath);
      const row = filePath ? types.rowsOfFile(filePath)[0] : undefined;
      if (row) {
        links.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, row });
      }
    }
  }
  return [...tags, ...links].sort((left, right) => left.start - right.start);
}

/** A hub note a line can be filed in: its path, and its name for the action. */
export interface FilingTarget {
  hubPath: string;
  title: string;
}

/**
 * The hub notes a line can be filed in: each tag's on the line, in the
 * order written, each once, at most {@link MAX_FILING_TARGETS}, never the
 * note the line is in.
 */
export function listFilingTargets(mentions: readonly LineMention[], sourcePath: string): FilingTarget[] {
  const seen = new Set<string>([sourcePath]);
  const targets: FilingTarget[] = [];
  mentions.forEach((mention) => {
    if (!mention.tagKey || !mention.hubPath || seen.has(mention.hubPath) || targets.length >= MAX_FILING_TARGETS) {
      return;
    }
    seen.add(mention.hubPath);
    targets.push({ hubPath: mention.hubPath, title: noteTitle(mention.hubPath) });
  });
  return targets;
}

/** One value of a field, as written and as a reader names it. */
export interface ReadingValue {
  /** As Deckard writes it: `@priya-natarajan`, `#team/rates`, `[[ADR-001]]`, `accepted`. */
  text: string;
  /** Its row's title, or the option as the schema spells it. */
  title: string;
}

/** A field a line says something of: the row it is set on, the field, and the value. */
export interface FieldReading {
  /** The row whose field is set, by id, its title, and its type's key. */
  rowId: string;
  rowTitle: string;
  typeKey: string;
  /** The note that holds the row's fields, its hub note or the row's note; none for a tag row with no hub note yet. */
  filePath?: string;
  field: Pick<TypeField, 'key' | 'name' | 'kind'>;
  value: ReadingValue;
  /** What the row's note writes for the field now. */
  was: ReadingValue[];
}

/** A phrase of a field's Words found on a line: the field, its type, and its columns. */
interface PhraseFound {
  typeKey: string;
  field: TypeField;
  start: number;
  end: number;
}

/**
 * Every field a line says something of, in the order its phrases are
 * written, each once: a phrase of a field's Words, of the type of any row
 * the line mentions, with the row that holds the field on one side of it
 * and a value that fits the field on the other. A value the field already
 * holds is not offered again.
 */
export function findFieldReadings(types: TypeIndex, line: string, mentions: readonly LineMention[]): FieldReading[] {
  const rows = mentions.filter((mention): mention is LineMention & { row: TypeRow } => mention.row !== undefined);
  if (rows.length === 0) {
    return [];
  }
  const readings = new Map<string, FieldReading>();
  findPhrases(types, maskMentions(line, mentions), rows).forEach((found) => {
    readPhrase(types, line, rows, found).forEach((reading) => {
      const key = `${reading.rowId}\u0000${reading.field.key}\u0000${reading.value.text.toLowerCase()}`;
      if (!readings.has(key) && !holdsAlready(reading)) {
        readings.set(key, reading);
      }
    });
  });
  return [...readings.values()];
}

/** The line with what names each mention blanked, so a phrase is never read inside a tag or a link. */
function maskMentions(line: string, mentions: readonly LineMention[]): string {
  let masked = line;
  mentions.forEach((mention) => {
    masked = `${masked.slice(0, mention.start)}${' '.repeat(mention.end - mention.start)}${masked.slice(mention.end)}`;
  });
  return masked.toLowerCase();
}

/** Where each field's phrases are written on the line, for the types of the rows it mentions, in order. */
function findPhrases(types: TypeIndex, masked: string, rows: ReadonlyArray<{ row: TypeRow }>): PhraseFound[] {
  const found: PhraseFound[] = [];
  [...new Set(rows.map(({ row }) => row.typeKey))].forEach((typeKey) => {
    types.registry.get(typeKey)?.fields.forEach((field) => {
      (field.words ?? []).forEach((phrase) => {
        for (const at of findWholePhrase(masked, phrase)) {
          found.push({ typeKey, field, start: at, end: at + phrase.length });
        }
      });
    });
  });
  return found.sort((left, right) => left.start - right.start);
}

/** Where a phrase is written as whole words, any case, its spaces any run of spaces. */
function findWholePhrase(masked: string, phrase: string): number[] {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${phrase.split(' ').map(escapeRegExp).join('[ \\t]+')}(?![\\p{L}\\p{N}_])`, 'gu');
  return [...masked.matchAll(pattern)].map((match) => match.index ?? 0);
}

/** A string matched as itself in a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * What one phrase says: the row of the field's type nearest before it set
 * to a value after it, and, for a field that names a row, the row of its
 * type nearest after it set to a value before it.
 */
function readPhrase(types: TypeIndex, line: string, rows: ReadonlyArray<LineMention & { row: TypeRow }>, found: PhraseFound): FieldReading[] {
  const before = rows.filter((mention) => mention.end <= found.start).reverse();
  const after = rows.filter((mention) => mention.start >= found.end);
  const ofType = (mention: { row: TypeRow }): boolean => mention.row.typeKey === found.typeKey;
  const readings: FieldReading[] = [];
  const holderBefore = before.find(ofType);
  if (holderBefore) {
    const value = found.field.kind.name === 'select'
      ? findOption(found.field.kind, line.slice(found.end))
      : rowValue(found.field.kind, after.find((mention) => fitsField(found.field.kind, mention.row) && mention.row.id !== holderBefore.row.id)?.row);
    if (value) {
      readings.push(toReading(types, holderBefore.row, found.field, value));
    }
  }
  const holderAfter = isRowField(found.field.kind) ? after.find(ofType) : undefined;
  const valueBefore = holderAfter ? before.find((mention) => fitsField(found.field.kind, mention.row) && mention.row.id !== holderAfter.row.id) : undefined;
  if (holderAfter && valueBefore) {
    readings.push(toReading(types, holderAfter.row, found.field, rowValue(found.field.kind, valueBefore.row) as ReadingValue));
  }
  return readings;
}

/** Whether a field's values name rows: a person, or a relation. */
function isRowField(kind: FieldKind): boolean {
  return kind.name === 'person' || kind.name === 'relation';
}

/** Whether a row can be a field's value: a person for a Person field, a row of one of a relation's types. */
function fitsField(kind: FieldKind, row: TypeRow): boolean {
  const person = row.id.startsWith('@');
  if (kind.name === 'person') {
    return person;
  }
  return kind.name === 'relation' && ((kind.targets ?? []).includes(row.typeKey) || (kind.people === true && person));
}

/** A row as a field's value: its tag, or a link to its note, with its title. */
function rowValue(kind: FieldKind, row: TypeRow | undefined): ReadingValue | undefined {
  if (!row || !isRowField(kind)) {
    return undefined;
  }
  const text = row.id.startsWith('file:') ? `[[${noteTitle(row.id.slice('file:'.length))}]]` : row.id;
  return { text, title: row.title };
}

/** The first of a select's options written as a whole word in the text, as the schema spells it. */
function findOption(kind: FieldKind, text: string): ReadingValue | undefined {
  const lower = text.toLowerCase();
  const found = (kind.options ?? [])
    .map((option) => ({ option, at: findWholePhrase(lower, option.toLowerCase().replace(/\s+/g, ' '))[0] }))
    .filter((candidate): candidate is { option: string; at: number } => candidate.at !== undefined)
    .sort((left, right) => left.at - right.at)[0];
  return found ? { text: found.option, title: found.option } : undefined;
}

/** A reading of a field of a row, with what the row's note writes for it now. */
function toReading(types: TypeIndex, row: TypeRow, field: TypeField, value: ReadingValue): FieldReading {
  const written = row.filePath
    ? (types.field(row.id, `field.${field.name}`)?.values ?? []).filter((held) => held.filePath === row.filePath)
    : [];
  return {
    rowId: row.id,
    rowTitle: row.title,
    typeKey: row.typeKey,
    ...(row.filePath ? { filePath: row.filePath } : {}),
    field: { key: field.key, name: field.name, kind: field.kind },
    value,
    was: written.map((held) => ({
      text: held.text,
      title: (held.rowId ? types.row(held.rowId)?.title : undefined) ?? held.option ?? held.text,
    })),
  };
}

/** Whether the row's note already writes the value for the field. */
function holdsAlready(reading: FieldReading): boolean {
  const wanted = reading.value.text.toLowerCase();
  return reading.was.some((held) => held.text.toLowerCase() === wanted || held.title.toLowerCase() === reading.value.title.toLowerCase());
}

/**
 * What a field reading writes: the value alone, for a field that holds one;
 * added after the values written, for one that holds several.
 */
export function readingValues(reading: FieldReading): string[] {
  return reading.field.kind.many ? [...reading.was.map((held) => held.text), reading.value.text] : [reading.value.text];
}

/**
 * What a reading's action says: `Set FX’s lead to Priya Natarajan (was
 * Alex Rivera)`, or, for a field that holds several, `Add Checkout to
 * Payments’ owns`.
 */
export function describeReading(reading: FieldReading): string {
  const owner = possessive(reading.rowTitle);
  if (reading.field.kind.many) {
    return `Add ${reading.value.title} to ${owner} ${reading.field.name}`;
  }
  const was = reading.was.length ? ` (was ${reading.was.map((held) => held.title).join(', ')})` : '';
  return `Set ${owner} ${reading.field.name} to ${reading.value.title}${was}`;
}

/** A name with its possessive: `Priya’s`, `Payments’`. */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}’` : `${name}’s`;
}

/** A line's words, its list mark and box aside: what is filed. */
export function filedWords(line: string): string {
  return line.replace(/^\s*(?:[-*+]|\d+[.)])[ \t]+(?:\[[^\]]\][ \t]+)?/, '').trim();
}

/** The day a filed line is dated: its daily note's, or today's. */
export function filedDate(file: Pick<ParsedFile, 'filePath' | 'sections'> | undefined, now: number): string {
  return (file ? findFileDailyNoteDate(file) : undefined) ?? formatIsoDate(now);
}

/**
 * The link back to a line from the note it is filed in, in Deckard's link
 * style: to the heading it is under, `[[2026-10-14#Org news]]`, or to its
 * note when it is under none, or under one named as the note is.
 */
export function linkToLine(
  lines: readonly string[],
  lineIndex: number,
  { sourcePath, fromPath, style }: { sourcePath: string; fromPath: string; style: NoteLinkStyle },
): string {
  const title = noteTitle(sourcePath);
  const heading = headingAbove(lines, lineIndex);
  const named = heading && normalizeHeading(heading) !== normalizeHeading(title) ? `${title}#${heading}` : title;
  return formatNoteLink(named, fromPath, sourcePath, style);
}

/** The words of the nearest heading above a line, tags aside, outside code and front matter. */
function headingAbove(lines: readonly string[], lineIndex: number): string | undefined {
  const frontmatterEnd = findFrontmatterEnd(lines) ?? -1;
  const fenced = findFencedLines(lines);
  for (let at = lineIndex - 1; at > frontmatterEnd; at -= 1) {
    const heading = fenced.has(at) ? undefined : readHeading(lines[at]);
    if (heading) {
      return stripTags(heading.text).replace(/\s+/g, ' ').trim() || undefined;
    }
  }
  return undefined;
}

/** A filed line: `- 2026-10-14: the line (link)`. */
export function formatFiledLine(words: string, date: string, link: string): string {
  return `- ${date}: ${words} (${link})`;
}

/** Lines to put into a note: before the zero-based line `at`, or at its end when `at` is its line count. */
export interface LineInsert {
  at: number;
  lines: string[];
}

/**
 * Where a filed line goes in a hub note: as the last list item under its
 * Notes heading, at any level; or, with none, under a `## Notes` made at
 * the end of the note.
 */
export function placeUnderNotes(content: string, entry: string): LineInsert {
  const lines = content.split(/\r?\n/);
  const notes = findHeadingLine(lines, (words) => words.toLowerCase() === 'notes');
  if (notes !== undefined) {
    return placeUnderHeading(lines, notes, entry);
  }
  // A note that ends with a line break ends with an empty line here, which stays last.
  const end = lines.length > 1 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  const gap = end > 0 && lines[end - 1].trim() !== '' ? [''] : [];
  return { at: end, lines: [...gap, '## Notes', '', entry] };
}

/** The zero-based line of the first heading whose words, tags aside, pass `test`, outside code and front matter. */
function findHeadingLine(lines: readonly string[], test: (words: string) => boolean): number | undefined {
  const frontmatterEnd = findFrontmatterEnd(lines) ?? -1;
  const fenced = findFencedLines(lines);
  for (let at = frontmatterEnd + 1; at < lines.length; at += 1) {
    const heading = fenced.has(at) ? undefined : readHeading(lines[at]);
    if (heading && test(stripTags(heading.text).replace(/\s+/g, ' ').trim())) {
      return at;
    }
  }
  return undefined;
}

/**
 * Where a line goes under a heading: after the last list item of the
 * heading's own lines, with the lines indented under that item; with no
 * list there, after its last line of text, a blank line between; with
 * nothing under it, right under it.
 */
export function placeUnderHeading(lines: readonly string[], headingLine: number, entry: string): LineInsert {
  const fenced = findFencedLines(lines);
  let end = headingLine + 1;
  while (end < lines.length && (fenced.has(end) || !readHeading(lines[end]))) {
    end += 1;
  }
  let lastText: number | undefined;
  let lastList: number | undefined;
  let inList = false;
  for (let at = headingLine + 1; at < end; at += 1) {
    const text = lines[at];
    if (!text.trim()) {
      continue;
    }
    lastText = at;
    inList = !fenced.has(at) && (isListItemLine(text) || (inList && lineIndent(text) > 0));
    if (inList) {
      lastList = at;
    }
  }
  if (lastList !== undefined) {
    return { at: lastList + 1, lines: [entry] };
  }
  if (lastText !== undefined) {
    return { at: lastText + 1, lines: ['', entry] };
  }
  return { at: headingLine + 1, lines: [entry] };
}

/** A note's text with lines put in, in its own line endings: what a write leaves. */
export function applyLineInsert(content: string, insert: LineInsert): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  return [...lines.slice(0, insert.at), ...insert.lines, ...lines.slice(insert.at)].join(eol);
}
