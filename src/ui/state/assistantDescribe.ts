/**
 * What `deckard_describe_tag` answers: one tag, or one typed row, described
 * in plain text for an assistant, with its type, its fields and reverses,
 * its open tasks, and its latest entries; and the line that names the
 * workspace's types and their fields, which `deckard_query` and
 * `deckard_list_tags` lead with (docs/implementation/30-databases.md
 * § Surfaces 4).
 *
 * ```
 * Team: Rates (#team/rates), Teams/Rates.md
 * lead: Dana Whitfield (@dana)
 * members (reverse of Person.team): Dana Whitfield (@dana), Priya Natarajan (@priya)
 * Open tasks: 2, 1 overdue
 * Latest entries:
 * - 2026-10-08 Standup — notes/standup.md:1
 * ```
 */
import { getBacklinkIndex, noteTitle } from '../../domain/index/backlinks';
import { resolveIndexedTagKey } from '../../domain/index/tagNavigation';
import { formatIsoDate, startOfDay } from '../../domain/markdown/calendar';
import { stripTags } from '../../domain/markdown/parser';
import { fileEntryId } from '../../domain/markdown/noteEntries';
import { formatKeyWords } from '../../domain/markdown/tagKeys';
import type { ParsedFile, Section, TagInfo, WorkspaceIndex } from '../../domain/model';
import { isObject } from '../../shared/guards';
import { pluralize } from '../../shared/text';
import { isRowKind, reverseNameOf } from '../../domain/types/fieldKinds';
import { findRowsByPhrase } from '../../domain/types/typeAnswers';
import { getTypeIndex, type FieldValue, type RowField, type TypeIndex, type TypeRow } from '../../domain/types/typeIndex';
import { describeTagMatches } from './querySuggestions';
import { rowTag } from './typeHover';
import { valueTitle } from './typeRows';

/** The describe tool's name, as the manifest declares it. */
export const DESCRIBE_TAG_TOOL_NAME = 'deckard_describe_tag';

/** How many latest entries a description lists. */
const LATEST_ENTRY_LIMIT = 3;
/** How many other matches a description names when a phrase matches several. */
const OTHER_MATCH_LIMIT = 5;

/** A describe call, read: the tag, title, or phrase to describe. */
export interface DescribeTagToolInput {
  tag: string;
}

/**
 * Reads a describe call. VS Code checks input against the declared schema,
 * but an extension can call a tool directly, so it is checked again.
 */
export function readDescribeTagToolInput(value: unknown): DescribeTagToolInput | undefined {
  if (!isObject(value) || typeof value.tag !== 'string' || !value.tag.trim()) {
    return undefined;
  }
  return { tag: value.tag.trim() };
}

/**
 * Describes a tag, a title, or a phrase: the typed row it names, with its
 * type, fields, reverses, open tasks, and latest entries; or, for a tag no
 * type has, how much carries it and its hub note. A phrase that names
 * several rows is described by the best, and the others are named.
 */
export function answerDescribeTag(index: WorkspaceIndex, input: DescribeTagToolInput, now: number): string {
  const types = getTypeIndex(index);
  const text = input.tag.trim();
  const tagKey = resolveIndexedTagKey(index.tags, text);
  const tagRow = types.isEmpty ? undefined : types.rowOfTag(tagKey ?? text.toLowerCase());
  if (tagRow) {
    return describeRow(index, types, tagRow, now);
  }
  if (tagKey) {
    return describeTag(index, types, tagKey, now);
  }
  const matches = findRowsByPhrase(types, text);
  if (matches.length > 0) {
    const best = matches[0].row;
    const others = [...new Set(matches.slice(1).map((match) => match.row))].filter((row) => row !== best);
    const lines = [describeRow(index, types, best, now)];
    if (others.length > 0) {
      lines.push(
        '',
        `"${text}" also matches: ${others
          .slice(0, OTHER_MATCH_LIMIT)
          .map((row) => `${row.title} (${rowReference(row)})`)
          .join(', ')}${others.length > OTHER_MATCH_LIMIT ? ', …' : ''}.`,
      );
    }
    return lines.join('\n');
  }
  const tags = findTagsByName(index, text);
  if (tags.length > 0) {
    const lines = [describeTag(index, types, tags[0].key, now)];
    if (tags.length > 1) {
      lines.push('', `"${text}" also matches: ${tags.slice(1, OTHER_MATCH_LIMIT + 1).map((tag) => tag.label).join(', ')}.`);
    }
    return lines.join('\n');
  }
  return `No tag or row matches "${text}". Call deckard_list_tags to see the tags that exist.`;
}

/**
 * One line naming the workspace's types, each with its fields and the
 * reverses other types' relations give it, and how to query them; undefined
 * in a workspace with no types.
 */
export function describeWorkspaceTypes(index: WorkspaceIndex): string | undefined {
  const types = getTypeIndex(index);
  if (types.isEmpty) {
    return undefined;
  }
  const reverses = new Map<string, Set<string>>();
  const peopleTypes = types.registry.tagTypes.filter((type) => type.rows?.kind === 'tags' && type.rows.prefix === '@');
  types.registry.types.forEach((type) => {
    type.fields.forEach((field) => {
      if (!isRowKind(field.kind)) {
        return;
      }
      const targets = [
        ...(field.kind.targets ?? []),
        ...(field.kind.name === 'person' || field.kind.people ? peopleTypes.map((target) => target.key) : []),
      ];
      targets.forEach((target) => {
        const names = reverses.get(target) ?? new Set<string>();
        names.add(reverseNameOf(field));
        reverses.set(target, names);
      });
    });
  });
  const described = types.registry.types.map((type) => {
    const fields = type.fields.map((field) => field.name);
    const reverse = [...(reverses.get(type.key) ?? [])].sort();
    const parts = [fields.join(', '), reverse.length > 0 ? `reverses: ${reverse.join(', ')}` : ''].filter(Boolean);
    return `${type.name} (${parts.length > 0 ? parts.join('; ') : 'no fields'})`;
  });
  const first = types.registry.types[0];
  return `Types in this workspace: ${described.join(', ')}. Query a type's rows with type = ${first.key}, a field by its name (with spaces as hyphens), and describe one row with ${DESCRIBE_TAG_TOOL_NAME}.`;
}

/** A typed row: its type, name, and note; its fields and reverses; its open tasks; and its latest entries. */
function describeRow(index: WorkspaceIndex, types: TypeIndex, row: TypeRow, now: number): string {
  const typeName = types.registry.get(row.typeKey)?.name ?? formatKeyWords(row.typeKey);
  const reference = rowReference(row);
  const lines = [
    row.filePath
      ? `${typeName}: ${row.title} (${reference}), ${row.filePath}`
      : `${typeName}: ${row.title} (${reference}). No hub note.`,
  ];
  const empty: string[] = [];
  types.fields(row.id).forEach((field) => {
    if (field.values.length === 0) {
      if (field.field) {
        empty.push(field.name);
      }
      return;
    }
    const values = field.values.map((value) => describeValue(types, value)).join(', ');
    lines.push(`${describeFieldName(types, field)}: ${values}`);
  });
  const computed = types.computed(row.id, now);
  if (computed.parent) {
    const parent = types.row(computed.parent);
    lines.push(`parent: ${parent ? `${parent.title} (${rowReference(parent)})` : computed.parent}`);
  }
  if (computed.children.length > 0) {
    lines.push(
      `children: ${computed.children.map((id) => types.row(id)).flatMap((child) => (child ? [`${child.title} (${rowReference(child)})`] : [])).join(', ')}`,
    );
  }
  if (empty.length > 0) {
    lines.push(`Empty: ${empty.join(', ')}`);
  }
  lines.push(describeOpenTasks(computed.openTasks, computed.overdue));
  if (computed.lastMentioned !== undefined) {
    lines.push(`Last mentioned ${formatIsoDate(computed.lastMentioned)}, ${pluralize(computed.mentions, 'entry', 'entries')} in the last 30 days.`);
  }
  lines.push(...describeLatest(row.tagKeys.length > 0 ? taggedEntries(index, row.tagKeys, row.filePath) : linkingEntries(index, row.filePath)));
  return lines.join('\n');
}

/** A field's name, and, for a reverse, the relations it is computed from: `members (reverse of Person.team)`. */
function describeFieldName(types: TypeIndex, field: RowField): string {
  if (field.source !== 'reverse') {
    return field.name;
  }
  const sources = [
    ...new Set(
      field.values.flatMap((value) => {
        if (!value.via) {
          return [];
        }
        const type = types.typeOf(value.via.rowId);
        return [`${type?.name ?? 'row'}.${value.via.field}`];
      }),
    ),
  ];
  return sources.length > 0 ? `${field.name} (reverse of ${sources.join(', ')})` : field.name;
}

/** A value as the description lists it: a row's title with its tag or note, or the value as written. */
function describeValue(types: TypeIndex, value: FieldValue): string {
  if (value.rowId) {
    const row = types.row(value.rowId);
    return row ? `${row.title} (${rowReference(row)})` : `${valueTitle(types, value)} (${value.rowId})`;
  }
  if (value.notePath) {
    return `${noteTitle(value.notePath)} (${value.notePath})`;
  }
  return value.unresolved ? `${value.text} (names nothing yet)` : value.text;
}

/** How a row is named beside its title: its tag, `#team/rates`, or its type and note, `type: incident`. */
function rowReference(row: TypeRow): string {
  const tag = rowTag(row);
  if (tag) {
    return tag.label;
  }
  return row.tagKeys.length === 0 && row.filePath ? `type: ${row.typeKey}` : row.id;
}

/** A tag no type has: how much carries it, its open tasks, its hub note, and its latest entries. */
function describeTag(index: WorkspaceIndex, types: TypeIndex, tagKey: string, now: number): string {
  const tag = index.tags.get(tagKey);
  if (!tag) {
    return `No tag or row matches "${tagKey}". Call deckard_list_tags to see the tags that exist.`;
  }
  const hub = tag.hubFilePaths?.find((path) => index.files.has(path));
  const today = startOfDay(now);
  let open = 0;
  let overdue = 0;
  tag.taskIds.forEach((id) => {
    const task = index.tasks.get(id);
    if (!task || task.completed || task.status.type === 'cancelled') {
      return;
    }
    open += 1;
    if (task.dueAt !== undefined && task.dueAt < today) {
      overdue += 1;
    }
  });
  const lines = [
    `Tag: ${tag.label} (${describeTagMatches(index, tag.key)})`,
    hub ? `Hub note: ${hub}` : 'No hub note.',
    describeOpenTasks(open, overdue),
    ...(types.isEmpty ? [] : ['No type has this tag as a row.']),
    ...describeLatest(taggedEntries(index, [tag.key], hub)),
  ];
  return lines.join('\n');
}

/** `Open tasks: 2, 1 overdue`, or `Open tasks: none`. */
function describeOpenTasks(open: number, overdue: number): string {
  if (open === 0) {
    return 'Open tasks: none';
  }
  return `Open tasks: ${open}${overdue > 0 ? `, ${overdue} overdue` : ''}`;
}

/** One entry that mentions a row or tag: its title, where it is, and when it was last changed. */
interface MentionEntry {
  title: string;
  filePath: string;
  line: number;
  updatedAt?: number;
}

/** The latest entries, newest first, each with its date, title, and place; nothing when there are none. */
function describeLatest(entries: readonly MentionEntry[]): string[] {
  if (entries.length === 0) {
    return [];
  }
  const latest = [...entries]
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || left.filePath.localeCompare(right.filePath) || left.line - right.line)
    .slice(0, LATEST_ENTRY_LIMIT);
  return [
    'Latest entries:',
    ...latest.map((entry) => `- ${entry.updatedAt === undefined ? 'undated' : formatIsoDate(entry.updatedAt)} ${entry.title} — ${entry.filePath}:${entry.line}`),
  ];
}

/** The entries tags are on, their hub note's aside: headings that carry them, and notes whose front matter does. */
function taggedEntries(index: WorkspaceIndex, tagKeys: readonly string[], hub: string | undefined): MentionEntry[] {
  const entries = new Map<string, MentionEntry>();
  tagKeys.forEach((key) => {
    const tag = index.tags.get(key);
    tag?.sectionIds.forEach((id) => {
      const section = index.sections.get(id);
      if (section && section.filePath !== hub) {
        entries.set(id, sectionEntry(section));
      }
    });
    tag?.filePaths.forEach((path) => {
      const file = index.files.get(path);
      if (file && path !== hub && !entries.has(fileEntryId(path))) {
        entries.set(fileEntryId(path), fileEntry(file));
      }
    });
  });
  return [...entries.values()];
}

/** The entries that link to a note row's note: each linking heading, or note, once. */
function linkingEntries(index: WorkspaceIndex, filePath: string | undefined): MentionEntry[] {
  if (!filePath) {
    return [];
  }
  const entries = new Map<string, MentionEntry>();
  getBacklinkIndex(index)
    .toNote(filePath)
    .forEach((link) => {
      const source = index.files.get(link.sourcePath);
      if (!source) {
        return;
      }
      const section = sectionAtLine(source, link.line + 1);
      if (section) {
        entries.set(section.id, sectionEntry(section));
      } else {
        entries.set(fileEntryId(source.filePath), fileEntry(source));
      }
    });
  return [...entries.values()];
}

/** A heading as an entry. */
function sectionEntry(section: Section): MentionEntry {
  return {
    title: stripTags(section.heading) || noteTitle(section.filePath),
    filePath: section.filePath,
    line: section.startLine,
    ...(section.updatedAt === undefined ? {} : { updatedAt: section.updatedAt }),
  };
}

/** A whole note as an entry. */
function fileEntry(file: ParsedFile): MentionEntry {
  return {
    title: noteTitle(file.filePath),
    filePath: file.filePath,
    line: 1,
    ...(file.updatedAt === undefined ? {} : { updatedAt: file.updatedAt }),
  };
}

/** The innermost heading of a note holding a one-based line, or undefined above its first. */
function sectionAtLine(file: ParsedFile, line: number): Section | undefined {
  let found: Section | undefined;
  file.sections.forEach((section) => {
    if (section.startLine <= line && line <= section.endLine && (!found || section.startLine >= found.startLine)) {
      found = section;
    }
  });
  return found;
}

/**
 * The tags a word names when it is no whole tag: those whose last part, or
 * whole key without its marker, is the word, written with hyphens for
 * spaces, most used first.
 */
function findTagsByName(index: WorkspaceIndex, text: string): TagInfo[] {
  const wanted = text
    .trim()
    .toLowerCase()
    .replace(/^[#@]/, '')
    .replace(/\s+/g, '-');
  if (!wanted) {
    return [];
  }
  return [...index.tags.values()]
    .filter((tag) => {
      const bare = tag.key.replace(/^[#@]/, '');
      return bare === wanted || bare.slice(bare.lastIndexOf('/') + 1) === wanted;
    })
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}
