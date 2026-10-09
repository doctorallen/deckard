/**
 * What the hover on a typed row says, apart from VS Code
 * (docs/implementation/30-databases.md § Surfaces 2): who or what the row
 * is, what it is related to and what names it, how to reach it, and how
 * much the notes say of it, each as a line of Markdown.
 *
 * ```
 * **Dana Whitfield** `@dana` · Person · Head of Rates
 * Team Rates · lead of Rates
 * Email dana@example.com
 * 14 notes · 5 tasks, 3 open · last mentioned today · 2026-10-08
 * ```
 */
import { describeDistance } from '../../domain/markdown/dates';
import { formatDisplayDate, type DateFormats } from '../../domain/markdown/dateFormat';
import { isRowKind } from '../../domain/types/fieldKinds';
import type { ComputedFields, RowField, TypeIndex, TypeRow } from '../../domain/types/typeIndex';
import { escapeMarkdown, pluralize } from '../../shared/text';
import { valueTitle } from './typeRows';

/** The counts a tag's hover already gives, which a row's activity line starts with. */
export interface RowActivityCounts {
  noteCount: number;
  taskCount: number;
  openTaskCount: number;
}

/** What a typed row's hover says, each line Markdown, and what its links open. */
export interface RowHover {
  /** The title in bold, the tag in code, the type, and the first Text field. */
  heading: string;
  /** Its relations and reverses, then how to reach it: one line each, none when it has none. */
  facts: string[];
  /** `14 notes · 5 tasks, 3 open · last mentioned today · 2026-10-08`. */
  activity: string;
  /** The row's tag, for its Open link: its key, and as written. */
  tag?: { key: string; label: string };
  /** The note that holds its fields, for Open Dana Whitfield.md. */
  filePath?: string;
  /** The first email, for Copy email. */
  email?: string;
}

/** Text fields that say how to reach a row, by their names or the words they are also called. */
const CONTACT_WORDS = /^(?:channel|slack|teams|chat|pager|on-?call|phone|mobile|email|mail|url|site|web|website|handle|discord|matrix)$/i;

/** What a row's hover reads its dates by. */
export interface RowHoverOptions {
  now: number;
  dateFormats?: DateFormats;
  /** The counts the hovered tag's summary gives; a note row's are worked out from the note. */
  counts?: RowActivityCounts;
}

/**
 * A typed row's hover, or undefined for a row no type has. Its first line
 * names it, its tag, its type, and its first Text field that is not a way
 * to reach it; then its relations and reverses on one line; its ways to be
 * reached on another; then how much the notes say of it, with the day it
 * was last mentioned in words and in full.
 */
export function describeRowHover(types: TypeIndex, rowId: string, options: RowHoverOptions): RowHover | undefined {
  const row = types.row(rowId);
  const type = row ? types.registry.get(row.typeKey) : undefined;
  if (!row || !type) {
    return undefined;
  }
  const fields = types.fields(rowId);
  const contacts = fields.filter((field) => isContactField(field) && field.values.length > 0);
  const summary = findRowSummary(types, rowId);
  const tag = rowTag(row);
  const heading = [
    `**${escapeMarkdown(row.title)}**${tag ? ` \`${tag.label}\`` : ''}`,
    escapeMarkdown(type.name),
    ...(summary ? [escapeMarkdown(summary)] : []),
  ].join(' · ');

  const relations = fields
    .filter((field) => isRowKind(field.kind) && field.values.length > 0)
    .map((field) => `${escapeMarkdown(field.name)} ${field.values.map((value) => escapeMarkdown(valueTitle(types, value))).join(', ')}`);
  const reach = contacts.map((field) => `${escapeMarkdown(field.name)} ${field.values.map((value) => writeContact(field, value.text)).join(', ')}`);
  const facts = [relations, reach].filter((line) => line.length > 0).map((parts) => capitalize(parts.join(' · ')));
  const email = fields.find((field) => field.kind.name === 'email' && field.values.length > 0)?.values[0]?.text;
  return {
    heading,
    facts,
    activity: describeActivity(types.computed(rowId, options.now), options),
    ...(tag ? { tag } : {}),
    ...(row.filePath ? { filePath: row.filePath } : {}),
    ...(email ? { email } : {}),
  };
}

/**
 * What a row is, in a few words: the values of its first written Text
 * field that is not a way to reach it, `Head of Rates`. What its hover's
 * first line, and a Find answer's description, end with.
 */
export function findRowSummary(types: TypeIndex, rowId: string): string | undefined {
  const summary = types
    .fields(rowId)
    .find((field) => field.kind.name === 'text' && field.source === 'written' && field.values.length > 0 && !isContactField(field));
  return summary?.values.map((value) => value.text).join(', ');
}

/** A tag row's tag, for its hover's code span and Open link: a person as `@dana`, any other as written. */
export function rowTag(row: TypeRow): RowHover['tag'] {
  if (row.tagKeys.length === 0) {
    return undefined;
  }
  const key = row.tagKeys.includes(row.id) ? row.id : row.tagKeys[0];
  return { key, label: row.id.startsWith('@') ? row.id : (row.label ?? row.id) };
}

/**
 * How much the notes say of a row: the hovered tag's counts, or a note
 * row's links and open tasks; what is overdue; and the day it was last
 * mentioned, in words and in full.
 */
function describeActivity(computed: ComputedFields, options: RowHoverOptions): string {
  const counts = options.counts;
  const parts = counts
    ? [
        pluralize(counts.noteCount, 'note'),
        ...(counts.taskCount > 0 ? [`${pluralize(counts.taskCount, 'task')}, ${counts.openTaskCount} open`] : []),
      ]
    : [
        ...(computed.linkedFrom.length > 0 ? [`linked from ${pluralize(computed.linkedFrom.length, 'note')}`] : []),
        ...(computed.openTasks > 0 ? [pluralize(computed.openTasks, 'open task')] : []),
      ];
  if (computed.overdue > 0) {
    parts.push(`${computed.overdue} overdue`);
  }
  if (computed.lastMentioned !== undefined) {
    parts.push(`last mentioned ${describeDay(computed.lastMentioned, options)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Not mentioned in any note yet';
}

/** Whether a field says how to reach a row: an Email, Phone, or Link, or a Text field named like a channel. */
function isContactField(field: RowField): boolean {
  const kind = field.kind.name;
  if (kind === 'email' || kind === 'phone' || kind === 'link') {
    return true;
  }
  if (kind !== 'text' || !field.field) {
    return false;
  }
  return [field.field.name, ...field.field.alsoCalled].some((word) => CONTACT_WORDS.test(word.trim()));
}

/** A way to reach a row: an email or URL as a link it opens, anything else as written. */
function writeContact(field: RowField, text: string): string {
  if (field.kind.name === 'email' && /^[^\s@()<>]+@[^\s@()<>]+$/.test(text)) {
    return `[${escapeMarkdown(text)}](mailto:${text})`;
  }
  if (field.kind.name === 'link' && /^https?:\/\/[^\s()<>]+$/i.test(text)) {
    return `[${escapeMarkdown(text)}](${text})`;
  }
  return escapeMarkdown(text);
}

/** A day in words and in full: `today · 2026-10-08`, or the full date alone beyond a month. */
function describeDay(at: number, options: RowHoverOptions): string {
  const date = formatDisplayDate(at, options.dateFormats);
  const words = describeDistance(at, options.now);
  return words ? `${words} · ${date}` : date;
}

/** A line with its first letter in capitals, as `team` starts `Team Rates`. */
function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

