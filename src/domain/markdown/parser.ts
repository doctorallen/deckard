import {
  BuiltInEntityKind,
  EntityKind,
  HeadingTagSpan,
  NoteHub,
  ParsedFile,
  Section,
  TagReference,
  Task,
} from '../model';
import { makeDay, MONTH_NUMBERS, parseIsoDate, WEEKDAY_NAMES } from './calendar';
import { findFrontmatterEnd, splitFrontmatterValues, unquote } from './frontmatter';
import { findListParents, findParentTaskLine } from './listNesting';
import {
  findFencedLines,
  isTaskLineOf,
  matchHeading,
  matchTaskLine,
  TaskLineMatch,
  TaskLineShape,
} from './lineShapes';
import { findCodeAndLinkRanges, isInRanges } from './inlineRanges';
import { formatKeyWords, readTagNamespace } from './tagKeys';
import { MIGRATED_TASK_LINE } from './taskLineEdits';
import { BLOCK_ID_PATTERN, parseTaskMetadata } from './taskFields';

/**
 * What the parser produces, named. A change to what a parsed note holds
 * (steps' parent links, say) changes it, so the local cache, which keeps
 * parsed notes, is rebuilt rather than served in the old shape.
 */
export const PARSE_FORMAT = 'code-and-links';

/** A heading as the parser found it: its 1-based line, its level, and its words. */
interface HeadingMatch {
  lineNumber: number;
  level: number;
  text: string;
}

/** A list item's marker, by how far in it is written. */
interface ListItemMatch {
  indentation: number;
}

/** What a note's front matter says, as the parser keeps it. */
interface Frontmatter {
  tags: TagReference[];
  links: string[];
  /** Other names for the note, from `aliases:` or `alias:`. */
  aliases?: string[];
  tagSpans: HeadingTagSpan[];
  endLine?: number;
  hub?: NoteHub;
  /** The note's `date:`, `created:`, and `updated:` values, as YYYY-MM-DD. */
  date?: string;
  created?: string;
  updated?: string;
}

/** Front-matter fields a hub note's property list leaves out. */
const hubPropertyExclusions = new Set(['describes', 'tag', 'tags']);

/** `describes:` names tags exactly as `tags:` does, so both parse the same. */
function getTagField(field: string): string {
  return field === 'describes' ? 'tags' : field;
}

/** Whether a line is a heading as the parser reads one, words and all. */
function isParsedHeading(line: string): boolean {
  return matchHeading(line, 'kept') !== undefined;
}

/**
 * A task the index reads: any mark but `[>]`, a gap after the box, and the
 * rest of the line on one line.
 */
const taskShape: TaskLineShape = { indent: 'whitespace', marks: ' xX', after: 'gap', oneLine: true };
const listItemPattern = /^(\s*)([-*+])[ \t]+/;
const orderedListItemPattern = /^(\s*)\d+[.)][ \t]+/;
const wikiLinkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
const explicitDatePattern = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const monthDatePattern =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i;
const nextWeekdayPattern =
  /\bnext\s+(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/i;
const namespacePattern = /^[a-z][a-z0-9_-]*$/;
const reservedNamespace = 'tag-at';

/** How a note is read: the settings that change what the parser finds. */
export interface MarkdownParseOptions {
  /** False reads tagged lines as `noteBoundaries: 'heading'` does; the setting that preceded it. */
  parseInlineTags?: boolean;
  /** What counts as a note inside a file; see `deckard.noteBoundaries`. */
  noteBoundaries?: NoteBoundaries;
  entityNamespaceAliases?: EntityNamespaceAliases;
  personMarker?: string;
  /**
   * Whether a task with no 👤 field is owned by the first person named in its
   * sentence, as Deckard read it before the field existed; see
   * `deckard.tasks.assigneeFromPersonTag`.
   */
  assigneeFromPersonTag?: boolean;
}

/** Namespace aliases, lowercased, each to the namespace it stands for: `proj` to `project`. */
export type EntityNamespaceAliases = Readonly<Record<string, string>>;

/** The tag settings a note is read with: namespace aliases, and the people marker. */
interface TagSettings {
  aliases?: EntityNamespaceAliases;
  personMarker?: string;
}

/**
 * What every entry of one note is built from, worked out once per parse:
 * its lines, the lines inside code fences and front matter, the dates its
 * entries carry, the front-matter tags they inherit, and the people marker.
 */
interface NoteContext {
  filePath: string;
  lines: string[];
  fencedLines: Set<number>;
  dates: Pick<ParsedFile, 'createdAt' | 'updatedAt'>;
  frontmatterTags: TagReference[];
  personMarker: string;
}

/**
 * Where one note ends and the next begins.
 *
 * `line` — a tagged line is a note of its own, as Deckard has always read it.
 * `heading` — only headings are notes. A tagged line keeps its tags and its
 *   place, and the heading containing it is what a search returns.
 * `marked` — as `heading`, except a line carrying a `^block-id`, which its
 *   author has made addressable and which stays a note of its own.
 */
export type NoteBoundaries = 'line' | 'heading' | 'marked';

const defaultEntityNamespaceAliases: Record<string, string> = {
  project: 'project',
  topic: 'topic',
  meeting: 'meeting',
  org: 'org',
  organization: 'org',
};

/**
 * Normalizes built-in aliases and accepts valid workspace-defined namespace
 * aliases without requiring the target namespace to be predeclared.
 */
export function getEntityNamespaceAliases(
  configured: unknown,
): EntityNamespaceAliases {
  const aliases = { ...defaultEntityNamespaceAliases };
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    return aliases;
  }

  Object.entries(configured).forEach(([alias, entityType]) => {
    const normalizedAlias = alias.trim().toLowerCase();
    const normalizedType =
      typeof entityType === 'string'
        ? entityType.trim().toLowerCase()
        : undefined;
    const namespace =
      normalizedType === 'organization' ? 'org' : normalizedType;
    if (
      namespacePattern.test(normalizedAlias) &&
      namespace !== undefined &&
      namespacePattern.test(namespace) &&
      normalizedAlias !== reservedNamespace &&
      namespace !== reservedNamespace
    ) {
      aliases[normalizedAlias] = namespace;
    }
  });

  Object.keys(aliases).forEach((alias) => {
    aliases[alias] = resolveNamespaceAlias(alias, aliases);
  });

  return aliases;
}

/** Follows an alias through aliases of aliases to the namespace it ends at, stopping at a loop. */
function resolveNamespaceAlias(
  namespace: string,
  aliases: Record<string, string>,
): string {
  let current = namespace;
  const visited = new Set<string>();
  // Own keys only: a namespace such as `constructor` must not walk into
  // what every object inherits.
  while (Object.hasOwn(aliases, current) && !visited.has(current)) {
    visited.add(current);
    current = aliases[current];
  }
  return current;
}

/**
 * Limits people markers to one punctuation character so they remain distinct
 * from Markdown syntax and can be matched safely in editor completion.
 */
export function getPersonMarker(configured: unknown): string {
  return typeof configured === 'string' &&
    /^[!$%&*+,.?:;=@^|~]$/.test(configured)
    ? configured
    : '@';
}

/**
 * Builds every indexable representation of a note from one Markdown pass.
 *
 * Fence detection happens first so headings, tasks, tag decorations, and
 * completion all agree on which source text is real note content.
 */
export function parseMarkdown(
  filePath: string,
  content: string,
  metadata?: Pick<ParsedFile, 'createdAt' | 'updatedAt'>,
  options: MarkdownParseOptions = {},
): ParsedFile {
  const lines = content.split(/\r?\n/);
  const personMarker = getPersonMarker(options.personMarker);
  const frontmatter = parseFrontmatter(lines, {
    aliases: options.entityNamespaceAliases,
    personMarker,
  });
  const fencedLines = findFencedLines(lines);
  if (frontmatter.endLine !== undefined) {
    for (let lineIndex = 0; lineIndex <= frontmatter.endLine; lineIndex += 1) {
      fencedLines.add(lineIndex);
    }
  }
  const headings = findHeadings(lines, fencedLines);
  const dailyDate = findDailyNoteDate(
    filePath,
    headings
      .filter((heading) => heading.level === 1)
      .map((heading) => heading.text),
  );
  const { dateAnchor, dates } = readNoteDates(frontmatter, dailyDate, metadata);
  const context: NoteContext = {
    filePath,
    lines,
    fencedLines,
    dates,
    frontmatterTags: frontmatter.tags,
    personMarker,
  };
  // Outside `line`, a tagged line is not a note: its tags stay on the line
  // and the heading holding it is what a search returns. The old
  // `parseInlineTags: false` dropped those tags entirely; read as `heading`
  // they keep answering, through the heading that holds them.
  const boundaries =
    options.parseInlineTags === false
      ? 'heading'
      : options.noteBoundaries ?? 'line';
  const sections = buildSections(context, headings, boundaries);
  const tasks = findTasks(context, sections, {
    dateAnchor,
    assigneeFromPersonTag: options.assigneeFromPersonTag ?? false,
  });

  const blockIds = findBlockIds(lines, fencedLines);

  return normalizeParsedTagReferences({
    filePath,
    content,
    sections,
    tasks,
    ...(Object.keys(blockIds).length > 0 ? { blockIds } : {}),
    frontmatterTags: frontmatter.tags,
    links: [...new Set([...frontmatter.links, ...extractWikiLinks(content)])],
    ...(frontmatter.aliases ? { aliases: frontmatter.aliases } : {}),
    ...(frontmatter.hub ? { hub: frontmatter.hub } : {}),
    createdAt: dates.createdAt,
    updatedAt: dates.updatedAt,
    ...(metadata
      ? {
          fileTimes: {
            createdAt: metadata.createdAt,
            updatedAt: metadata.updatedAt,
          },
        }
      : {}),
  }, options.entityNamespaceAliases);
}

/**
 * The days a note's dates count from: the day loose task dates such as
 * "next Friday" are read from, and the created and updated times its
 * entries carry.
 */
function readNoteDates(
  frontmatter: Frontmatter,
  dailyDate: string | undefined,
  metadata?: Pick<ParsedFile, 'createdAt' | 'updatedAt'>,
): { dateAnchor: number | undefined; dates: Pick<ParsedFile, 'createdAt' | 'updatedAt'> } {
  // Loose task dates such as "next Friday" are read from the day the note is
  // about. The file's modified time changes whenever the note is edited or
  // the repository is cloned, so it is only the last resort.
  const dateAnchor =
    firstIsoDate(
      dailyDate,
      frontmatter.date,
      frontmatter.created,
      frontmatter.updated,
    ) ?? metadata?.updatedAt;
  // A clone resets file times too, so the dates a note states come first. A
  // daily note keeps the earlier of its day and its file's creation: a clone
  // never moves it past its day, and a plan written ahead keeps its own day.
  const dailyAt = firstIsoDate(dailyDate);
  const fileCreatedAt = metadata?.createdAt;
  const dates: Pick<ParsedFile, 'createdAt' | 'updatedAt'> = {
    createdAt:
      firstIsoDate(frontmatter.created, frontmatter.date) ??
      (dailyAt !== undefined && fileCreatedAt !== undefined
        ? Math.min(dailyAt, fileCreatedAt)
        : (dailyAt ?? fileCreatedAt)),
    updatedAt: firstIsoDate(frontmatter.updated) ?? metadata?.updatedAt,
  };
  return { dateAnchor, dates };
}

/**
 * The note's entries in line order: a section for each heading, and the
 * tagged lines the boundaries keep as notes of their own, the rest folded
 * into the heading that holds them.
 */
function buildSections(
  context: NoteContext,
  headings: HeadingMatch[],
  boundaries: NoteBoundaries,
): Section[] {
  const headingSections = headings.map((_heading, headingIndex) =>
    createSection(context, headings, headingIndex),
  );
  const taggedLines = findInlineSections(context, headingSections);
  const inlineSections = foldTaggedLines(
    taggedLines,
    headingSections,
    context.lines,
    boundaries,
  );
  return [...headingSections, ...inlineSections].sort(
    (left, right) => left.startLine - right.startLine,
  );
}

/** The first of these YYYY-MM-DD values that is a real date. */
function firstIsoDate(...values: (string | undefined)[]): number | undefined {
  for (const value of values) {
    const date = parseIsoDate(value);
    if (date !== undefined) {
      return date;
    }
  }
  return undefined;
}

/**
 * Normalizes tag identity without rewriting the spelling shown to users.
 *
 * The marker is part of the key, keeping people (`@`) distinct from `#` tags
 * while retaining the source spelling for display in the editor and webviews.
 */
export function extractTags(
  text: string,
  entityNamespaceAliases?: EntityNamespaceAliases,
  personMarker?: string,
): TagReference[] {
  const tags: TagReference[] = [];
  const seen = new Set<string>();

  for (const match of findTagMatches(
    text,
    entityNamespaceAliases,
    personMarker,
  )) {
    const key = match.key;

    if (!seen.has(key)) {
      seen.add(key);
      tags.push({ key, label: match.label });
    }
  }

  return tags;
}

/**
 * Extracts workspace-local Wiki link targets without treating their labels as
 * paths. Resolution happens against the current workspace index.
 */
export function extractWikiLinks(text: string): string[] {
  const links = new Set<string>();

  for (const match of text.matchAll(wikiLinkPattern)) {
    const target = match[1].trim();
    if (target.length > 0) {
      links.add(target);
    }
  }

  return [...links];
}

/**
 * Identifies the entity class encoded by a canonical tag.
 *
 * Internally normalized @ tags are people. Namespaced # tags name workspace
 * entities, while unnamespaced # tags remain lightweight labels.
 */
export function getEntityKind(
  tag: TagReference,
  entityNamespaceAliases?: EntityNamespaceAliases,
): EntityKind | undefined {
  const key = normalizeTagKey(tag.key, entityNamespaceAliases);
  if (key.startsWith('@')) {
    return 'person';
  }

  const namespace = getEntityNamespace(tag, entityNamespaceAliases);
  return namespace === 'org' || namespace === 'organization'
    ? 'organization'
    : namespace;
}

/**
 * Returns the namespace encoded by a namespaced hash tag.
 *
 * Every namespace creates an entity on first use. The internal `tag-at`
 * namespace remains excluded because it represents a generic `@` tag when the
 * people marker is customized.
 */
export function getEntityNamespace(
  tag: TagReference,
  entityNamespaceAliases?: EntityNamespaceAliases,
): string | undefined {
  return readTagNamespace(normalizeTagKey(tag.key, entityNamespaceAliases))?.toLowerCase();
}

/**
 * Identifies the fixed entity kinds that have dedicated front matter groups
 * and Dashboard filters.
 */
export function isBuiltInEntityKind(
  kind: EntityKind | undefined,
): kind is BuiltInEntityKind {
  return (
    kind === 'person' ||
    kind === 'project' ||
    kind === 'topic' ||
    kind === 'organization' ||
    kind === 'meeting'
  );
}

/**
 * Formats an entity title for overview tabs and panel titles.
 */
export function formatEntityTitle(kind: string, name: string): string {
  return `${formatKeyWords(kind)}: ${formatKeyWords(name)}`;
}

/**
 * Parses the small YAML subset used for portable entity metadata. Unsupported
 * YAML remains ordinary Markdown and does not prevent notes from indexing.
 */
function parseFrontmatter(lines: string[], settings: TagSettings): Frontmatter {
  const end = findFrontmatterEnd(lines);
  if (end === undefined) {
    return { tags: [], links: [], tagSpans: [] };
  }
  const { values, tagSpans } = readFrontmatterValues(lines, end, settings);
  const { tags, links } = frontmatterToTags(values, settings);
  const aliases = [
    ...new Set(
      [...(values.get('aliases') ?? []), ...(values.get('alias') ?? [])]
        .map((alias) => alias.trim())
        .filter(Boolean),
    ),
  ];

  return {
    tags: deduplicateTagReferences(tags),
    links: [...new Set(links)],
    ...(aliases.length > 0 ? { aliases } : {}),
    tagSpans,
    endLine: end,
    ...createHub(values, settings),
    ...findFrontmatterDates(values),
  };
}

/**
 * The front matter's fields, lowercased, each with its values: those on the
 * field's own line, then the `- item` lines under it. Also the spans of the
 * tags those values name, for the editor to draw.
 */
function readFrontmatterValues(
  lines: string[],
  end: number,
  settings: TagSettings,
): { values: Map<string, string[]>; tagSpans: HeadingTagSpan[] } {
  const values = new Map<string, string[]>();
  const tagSpans: HeadingTagSpan[] = [];
  let currentKey: string | undefined;
  lines.slice(1, end).forEach((line, lineIndex) => {
    const lineNumber = lineIndex + 2;
    const property = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (property) {
      currentKey = property[1].toLowerCase();
      values.set(currentKey, splitFrontmatterValues(property[2], { keepEmptyValue: true }));
      const valueStart = line.indexOf(property[2], property[1].length + 1);
      tagSpans.push(
        ...createFrontmatterTagSpans(
          { field: currentKey, rawValue: property[2], lineNumber, valueStart },
          settings,
        ),
      );
      return;
    }
    const listItem = line.match(/^\s*-\s+(.+?)\s*$/);
    if (!listItem || !currentKey) {
      return;
    }
    values.get(currentKey)?.push(unquote(listItem[1]));
    tagSpans.push(
      ...createFrontmatterTagSpans(
        { field: currentKey, rawValue: listItem[1], lineNumber, valueStart: line.indexOf(listItem[1]) },
        settings,
      ),
    );
  });
  return { values, tagSpans };
}

/**
 * The tags the front matter's values name, field by field, and the wiki
 * links its `links:` field holds. Aliases name the note, not a tag.
 */
function frontmatterToTags(
  values: Map<string, string[]>,
  settings: TagSettings,
): { tags: TagReference[]; links: string[] } {
  const tags: TagReference[] = [];
  const links: string[] = [];
  values.forEach((fieldValues, key) => {
    if (key === 'links') {
      fieldValues.forEach((value) => links.push(...extractWikiLinks(value)));
      return;
    }
    if (key === 'aliases' || key === 'alias') {
      return;
    }
    fieldValues.forEach((value) => {
      const tag = frontmatterValueToTag(getTagField(key), value, settings);
      if (tag) {
        tags.push(tag);
      }
    });
  });
  return { tags, links };
}

/** The `date:`, `created:`, and `updated:` values that start with a date. */
function findFrontmatterDates(
  values: Map<string, string[]>,
): Pick<Frontmatter, 'date' | 'created' | 'updated'> {
  const read = (key: string) =>
    values.get(key)?.[0]?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return {
    date: read('date'),
    created: read('created'),
    updated: read('updated'),
  };
}

/**
 * Reads a hub note: the tags its `describes:` names, and the rest of its
 * front matter as properties whose values may themselves be tags.
 */
function createHub(
  values: Map<string, string[]>,
  settings: TagSettings,
): { hub?: NoteHub } {
  const describes = (values.get('describes') ?? [])
    .map((value) => frontmatterValueToTag('tags', value, settings))
    .filter((tag): tag is TagReference => tag !== undefined);
  if (describes.length === 0) {
    return {};
  }

  return {
    hub: {
      describes: deduplicateTagReferences(describes),
      properties: [...values]
        .filter(([name]) => !hubPropertyExclusions.has(name))
        .map(([name, fieldValues]) => ({
          name,
          values: fieldValues.map((text) => {
            const tag = frontmatterValueToTag(name, text, settings);
            return tag ? { text, tag } : { text };
          }),
        })),
    },
  };
}

/**
 * The tag a front-matter value names, read by its field: a value written as
 * a tag is that tag; under `tags:` a `namespace/name` path is a namespaced
 * tag, and any other word a plain one; under `person:`, `project:`,
 * `topic:`, `organization:`, `meeting:` and their plurals, the value names
 * an entity of that kind. Undefined for any other field, or a value with
 * nothing a tag can be made of.
 */
function frontmatterValueToTag(
  field: string,
  value: string,
  settings: TagSettings,
): TagReference | undefined {
  const existing = extractTags(value, settings.aliases, settings.personMarker)[0];
  if (existing) {
    return existing;
  }
  const namespaced = readNamespacedTagValue(field, value, settings.aliases);
  if (namespaced) {
    return namespaced;
  }
  const slug = toSlug(value);
  if (!slug) {
    return undefined;
  }
  return slugToTag(field, slug, settings.personMarker);
}

/** A `namespace/name` path written under `tags:` without its `#`, as the tag it names. */
function readNamespacedTagValue(
  field: string,
  value: string,
  aliases?: EntityNamespaceAliases,
): TagReference | undefined {
  if (field !== 'tag' && field !== 'tags') {
    return undefined;
  }
  const namespacedValue = value
    .trim()
    .match(
      /^#?([A-Za-z][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)+)$/,
    );
  if (!namespacedValue) {
    return undefined;
  }
  const label = `#${namespacedValue[1]}`;
  return {
    key: normalizeTagKey(label.toLowerCase(), aliases),
    label,
  };
}

/** The tag a slugged value makes under its field: a person, an entity, a plain tag, or none. */
function slugToTag(field: string, slug: string, personMarker?: string): TagReference | undefined {
  if (field === 'person' || field === 'people') {
    return {
      key: `@${slug}`,
      label: `${getPersonMarker(personMarker)}${slug}`,
    };
  }
  const namespace =
    field === 'organization' || field === 'organizations'
      ? 'org'
      : field.replace(/s$/, '');
  if (
    namespace === 'project' ||
    namespace === 'topic' ||
    namespace === 'org' ||
    namespace === 'meeting'
  ) {
    return {
      key: `#${namespace}/${slug}`,
      label: `#${namespace}/${slug}`,
    };
  }
  if (field === 'tag' || field === 'tags') {
    return { key: `#${slug}`, label: `#${slug}` };
  }
  return undefined;
}

/** One front-matter value as written, and where: its field, its 1-based line, and its first column. */
interface FrontmatterValueAt {
  field: string;
  rawValue: string;
  lineNumber: number;
  valueStart: number;
}

/**
 * The spans of the tags a front-matter value names, one per comma-separated
 * item, or per item of a `[a, b]` list, each starting past any quote.
 */
function createFrontmatterTagSpans(
  { field, rawValue, lineNumber, valueStart }: FrontmatterValueAt,
  settings: TagSettings,
): HeadingTagSpan[] {
  const trimmed = rawValue.trim();
  if (!trimmed || valueStart < 0) {
    return [];
  }

  const isArray = trimmed.startsWith('[') && trimmed.endsWith(']');
  const content = isArray ? trimmed.slice(1, -1) : rawValue;
  const contentStart =
    valueStart +
    (isArray
      ? rawValue.indexOf('[') + 1
      : 0);
  let offset = 0;

  return content.split(',').flatMap((item) => {
    const leading = item.length - item.trimStart().length;
    const sourceValue = item.trim();
    const value = unquote(sourceValue);
    const tag = frontmatterValueToTag(getTagField(field), value, settings);
    const quoteOffset = /^['"]/.test(sourceValue) ? 1 : 0;
    const startColumn = contentStart + offset + leading + quoteOffset;
    offset += item.length + 1;

    if (!tag || !value) {
      return [];
    }

    return [
      {
        key: tag.key,
        label: tag.label,
        lineNumber,
        startColumn,
        endColumn: startColumn + value.length,
      },
    ];
  });
}

/** A value as a tag name: lowercased, each run of other characters a hyphen, none at the ends. */
function toSlug(value: string): string | undefined {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || undefined;
}

/**
 * Keeps the older heading-only span contract for callers that need it.
 *
 * Heading spans remain useful as the conservative default for editor links;
 * callers that opt into inline tags use `extractTagSpans` directly.
 */
export function extractHeadingTagSpans(content: string): HeadingTagSpan[] {
  return collectTagSpans(content, { parseInlineTags: false, includeFrontmatter: false }, {});
}

/**
 * Produces source ranges using the same fence and inline-tag rules as parsing.
 *
 * The column offset is preserved because heading text is scanned as a
 * substring, but the resulting ranges must still point into the full editor.
 */
export function extractTagSpans(
  content: string,
  parseInlineTags = true,
  entityNamespaceAliases?: EntityNamespaceAliases,
  personMarker?: string,
): HeadingTagSpan[] {
  return collectTagSpans(
    content,
    { parseInlineTags, includeFrontmatter: true },
    { aliases: entityNamespaceAliases, personMarker },
  );
}

/** Which tag spans collectTagSpans reads besides the headings'. */
interface SpanScope {
  /** Tags on lines other than headings. */
  parseInlineTags: boolean;
  /** Tags the front matter names. */
  includeFrontmatter: boolean;
}

/**
 * The spans of a note's tags in line order, the front matter's first when
 * asked for, and nothing inside a fence or, as content, inside front matter.
 */
function collectTagSpans(
  content: string,
  scope: SpanScope,
  settings: TagSettings,
): HeadingTagSpan[] {
  const lines = content.split(/\r?\n/);
  const frontmatter = parseFrontmatter(lines, settings);
  const fencedLines = findFencedLines(lines);

  const contentSpans = lines.flatMap((line, lineIndex) => {
    if (frontmatter.endLine !== undefined && lineIndex <= frontmatter.endLine) {
      return [];
    }
    if (fencedLines.has(lineIndex)) {
      return [];
    }

    const heading = matchHeading(line, 'kept');
    if (heading) {
      const headingTextStart = line.indexOf(heading.text);
      return createTagSpans(
        heading.text,
        { lineNumber: lineIndex + 1, columnOffset: headingTextStart },
        settings,
      );
    }

    if (!scope.parseInlineTags) {
      return [];
    }

    return createTagSpans(line, { lineNumber: lineIndex + 1, columnOffset: 0 }, settings);
  });

  return scope.includeFrontmatter
    ? [...frontmatter.tagSpans, ...contentSpans]
    : contentSpans;
}

/**
 * Converts matches in a substring back into document coordinates.
 *
 * Keeping this offset calculation beside tag matching prevents decorations
 * and document links from drifting when a heading has Markdown indentation.
 */
function createTagSpans(
  text: string,
  at: { lineNumber: number; columnOffset: number },
  settings: TagSettings,
): HeadingTagSpan[] {
  const { lineNumber, columnOffset } = at;
  return findTagMatches(
    text,
    settings.aliases,
    settings.personMarker,
  ).map((match) => ({
    key: match.key,
    label: match.label,
    lineNumber,
    startColumn: columnOffset + match.start,
    endColumn: columnOffset + match.end,
  }));
}

/**
 * Collapses configured aliases onto one key so views, favorites, and search
 * treat `#proj/atlas` and `#project/atlas` as the same entity.
 */
function normalizeParsedTagReferences(
  parsed: ParsedFile,
  entityNamespaceAliases?: EntityNamespaceAliases,
): ParsedFile {
  parsed.frontmatterTags = normalizeTagReferences(
    parsed.frontmatterTags,
    entityNamespaceAliases,
  );
  if (parsed.hub) {
    parsed.hub.describes = normalizeTagReferences(
      parsed.hub.describes,
      entityNamespaceAliases,
    );
    parsed.hub.properties.forEach((property) => {
      property.values.forEach((value) => {
        if (value.tag) {
          value.tag = normalizeTagReferences(
            [value.tag],
            entityNamespaceAliases,
          )[0];
        }
      });
    });
  }
  [...parsed.sections, ...parsed.tasks].forEach((item) => {
    if ('headingTags' in item) {
      item.headingTags = normalizeTagReferences(
        item.headingTags ?? [],
        entityNamespaceAliases,
      );
    }
    item.associationTagGroups = (item.associationTagGroups ?? []).map((group) =>
      normalizeTagReferences(group, entityNamespaceAliases),
    );
    const normalized = normalizeTagReferences(
      item.tags.map((key) => ({
        key,
        label: item.tagLabels[key] ?? key,
      })),
      entityNamespaceAliases,
    );
    item.tags = normalized.map((tag) => tag.key);
    item.tagLabels = Object.fromEntries(
      normalized.map((tag) => [tag.key, tag.label]),
    );
  });

  return parsed;
}

/** References with their keys normalized, each key once, keeping the first spelling met. */
function normalizeTagReferences(
  references: TagReference[],
  entityNamespaceAliases?: EntityNamespaceAliases,
): TagReference[] {
  const normalized = new Map<string, TagReference>();
  references.forEach((reference) => {
    const key = normalizeTagKey(reference.key, entityNamespaceAliases);
    normalized.set(key, normalized.get(key) ?? { key, label: reference.label });
  });
  return [...normalized.values()];
}

/**
 * The person a task is for: the one its 👤 field names, and nobody otherwise.
 *
 * A name in the sentence says only that the task mentions them — notes are
 * written about people as often as for them — so asking someone to do
 * something is written down rather than guessed. `assigneeFromPersonTag`
 * restores the older reading, where the first person on the line owned it.
 *
 * The written name is answered with the tag key from the line itself when one
 * matches, so the person the task points at is the person the index holds.
 */
function readAssignee(
  written: string | undefined,
  inlineTags: readonly TagReference[],
  assigneeFromPersonTag: boolean,
): string | undefined {
  const people = inlineTags.filter((tag) => isPersonTag(tag.key));
  if (written === undefined) {
    return assigneeFromPersonTag ? people[0]?.key : undefined;
  }
  const name = personTagName(written);
  return (
    people.find((tag) => personTagName(tag.key) === name)?.key ?? written
  );
}

/** A person's name without its marker or namespace, for comparing the two. */
function personTagName(value: string): string {
  const text = value.trim().toLocaleLowerCase();
  const bare = text.startsWith('@') ? text.slice(1) : text;
  const separator = bare.lastIndexOf('/');
  return separator < 0 ? bare : bare.slice(separator + 1);
}

/**
 * Whether a tag key names a person: an `@` tag, whatever marker was typed for
 * it, or one under the `#person/` namespace.
 */
export function isPersonTag(key: string): boolean {
  return key.startsWith('@') || key.toLocaleLowerCase().startsWith('#person/');
}

/**
 * A person as a task's 👤 field should name them, or nothing when the words
 * are not one person: `dana`, `@dana` and `#person/dana` all come back as the
 * tag they are, so the field and the people index hold the same string.
 */
export function readPerson(
  written: string,
  personMarker = '@',
): string | undefined {
  const text = written.trim();
  for (const candidate of [text, `${personMarker}${text}`]) {
    const tags = extractTags(candidate, undefined, personMarker);
    if (
      tags.length === 1 &&
      isPersonTag(tags[0].key) &&
      tags[0].label === candidate
    ) {
      return tags[0].label;
    }
  }
  return undefined;
}

/**
 * A `#namespace/name` key with its namespace resolved through the aliases,
 * so `#proj/atlas` becomes `#project/atlas`. Any other key is returned as is.
 */
function normalizeTagKey(
  key: string,
  entityNamespaceAliases?: EntityNamespaceAliases,
): string {
  if (!key.startsWith('#')) {
    return key;
  }

  const [namespace, ...name] = key.slice(1).split('/');
  if (!namespace || name.length === 0) {
    return key;
  }

  // The namespace is the note's text, so only the record's own keys count:
  // `#constructor/x` must not read Object's constructor as its namespace.
  const aliases = getEntityNamespaceAliases(entityNamespaceAliases);
  const lowered = namespace.toLowerCase();
  const canonicalNamespace = Object.hasOwn(aliases, lowered) ? aliases[lowered] : undefined;
  return canonicalNamespace
    ? `#${canonicalNamespace}/${name.join('/')}`
    : key;
}

/**
 * Removes tag syntax from display titles while preserving numeric hash text.
 *
 * Numeric hashes can be dates or ordinary heading content, so stripping them
 * would make related-note titles misleading even though they are not tags.
 */
export function stripTags(text: string, personMarker?: string): string {
  const skipped = findCodeAndLinkRanges(text);
  return text
    .replace(
      getTagPattern(getPersonMarker(personMarker)),
      (fullMatch: string, prefix: string, ...rest: [string, string, number]) => {
        const [marker, rawName, offset] = rest;
        return isNumericHashTag(marker, rawName) ||
          isInRanges(skipped, offset + prefix.length)
          ? fullMatch
          : prefix;
      },
    )
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** A tag found in some text, with the columns of its marker and name. */
interface TagMatch extends TagReference {
  start: number;
  end: number;
}

/**
 * Finds the canonical tag token used by every parser consumer.
 *
 * Centralizing normalization and numeric-hash filtering keeps counts,
 * navigation ranges, and rendered titles consistent with one another.
 */
function findTagMatches(
  text: string,
  entityNamespaceAliases?: EntityNamespaceAliases,
  personMarker?: string,
): TagMatch[] {
  const activePersonMarker = getPersonMarker(personMarker);
  const skipped = findCodeAndLinkRanges(text);
  return [...text.matchAll(getTagPattern(activePersonMarker))].flatMap((match) => {
    const marker = match[2];
    const rawName = match[3];
    const markerIndex = (match.index ?? 0) + match[0].lastIndexOf(marker);
    if (isNumericHashTag(marker, rawName) || isInRanges(skipped, markerIndex)) {
      return [];
    }

    return [
      {
        key: tagKeyFor(marker, rawName, activePersonMarker, entityNamespaceAliases),
        label: `${marker}${rawName}`,
        start: markerIndex,
        end: markerIndex + marker.length + rawName.length,
      },
    ];
  });
}

/**
 * The key a tag is indexed by. The people marker makes a person, `@dana`,
 * whatever character it is; an `@` that is not the people marker is a plain
 * tag kept apart under `#tag-at/`; a `#` tag has its namespace's alias
 * resolved. Names are lowercased, so spelling never splits a tag.
 */
function tagKeyFor(
  marker: string,
  rawName: string,
  activePersonMarker: string,
  entityNamespaceAliases?: EntityNamespaceAliases,
): string {
  if (marker === activePersonMarker) {
    return `@${rawName.toLowerCase()}`;
  }
  if (marker === '@') {
    return `#tag-at/${rawName.toLowerCase()}`;
  }
  return normalizeTagKey(`${marker}${rawName.toLowerCase()}`, entityNamespaceAliases);
}

/** The tag pattern for one people marker, compiled. */
function compileTagPattern(personMarker: string): RegExp {
  const escapedMarker = personMarker.replace(/[\\\]^]/g, '\\$&');
  return new RegExp(
    `(^|[^\\w#])([#@${escapedMarker}])([A-Za-z0-9][A-Za-z0-9_-]*(?:\\/[A-Za-z0-9][A-Za-z0-9_-]*)*)\\b`,
    'g',
  );
}

/** Every people marker getPersonMarker accepts. */
const PERSON_MARKERS = '!$%&*+,.?:;=@^|~';

/**
 * One compiled pattern per people marker, made once when the parser loads:
 * getPersonMarker accepts only these, so the table never grows. Building a
 * RegExp is costly and `stripTags` runs for every heading ranking shows.
 * Sharing a global pattern is safe here because `replace` and `matchAll`,
 * its only users, never carry `lastIndex` from one call to the next.
 */
const TAG_PATTERNS: ReadonlyMap<string, RegExp> = new Map(
  [...PERSON_MARKERS].map((marker) => [marker, compileTagPattern(marker)]),
);

/** The tag pattern for a people marker getPersonMarker has read. */
function getTagPattern(personMarker: string): RegExp {
  return TAG_PATTERNS.get(personMarker) ?? compileTagPattern(personMarker);
}

/**
 * Distinguishes numeric hash text from a real tag without rejecting numeric
 * `@` tags, which are valid identifiers for dates or other user conventions.
 */
function isNumericHashTag(marker: string, rawName: string): boolean {
  return marker === '#' && /^\d+$/.test(rawName);
}

/**
 * Collects headings before sections are built so section boundaries and task
 * inheritance use one fence-aware source of truth.
 */
function findHeadings(
  lines: string[],
  fencedLines: Set<number>,
): HeadingMatch[] {
  const headings: HeadingMatch[] = [];

  lines.forEach((line, lineIndex) => {
    if (fencedLines.has(lineIndex)) {
      return;
    }
    const match = matchHeading(line, 'kept');
    if (match) {
      headings.push({
        lineNumber: lineIndex + 1,
        level: match.level,
        text: stripClosingHeadingHashes(match.text.trim()),
      });
    }
  });

  return headings;
}

/**
 * Builds a heading section whose end is controlled by the next heading at the
 * same or higher level, matching Markdown's nested-section structure.
 */
function createSection(
  context: NoteContext,
  headings: HeadingMatch[],
  headingIndex: number,
): Section {
  const { filePath, lines, dates, frontmatterTags, personMarker } = context;
  const heading = headings[headingIndex];
  const nextBoundary = headings
    .slice(headingIndex + 1)
    .find((candidate) => candidate.level <= heading.level);
  const endLine = nextBoundary ? nextBoundary.lineNumber - 1 : lines.length;
  // The section's own body stops at the next heading of any level, so a
  // parent's text does not contain its children's and a line belongs to the
  // text of exactly one entry.
  const nextHeading = headings[headingIndex + 1];
  const bodyEndLine = nextHeading
    ? Math.min(nextHeading.lineNumber - 1, endLine)
    : endLine;
  const headingTags = extractTags(heading.text, undefined, personMarker);
  const sectionTags = mergeTagReferences(frontmatterTags, headingTags);
  const tagLabels = Object.fromEntries(
    sectionTags.map((tag) => [tag.key, tag.label]),
  );
  const rawContent = lines.slice(heading.lineNumber - 1, endLine).join('\n');
  const bodyContent = lines
    .slice(heading.lineNumber - 1, bodyEndLine)
    .join('\n');
  const parentHeading = findNearestParentHeading(headings, headingIndex);

  return {
    id: createHeadingSectionId(filePath, heading),
    filePath,
    heading: heading.text,
    headingLevel: heading.level,
    headingTags,
    associationTagGroups: [headingTags],
    parentSectionId: parentHeading
      ? createHeadingSectionId(filePath, parentHeading)
      : undefined,
    tags: sectionTags.map((tag) => tag.key),
    tagLabels,
    links: extractWikiLinks(rawContent),
    rawContent,
    bodyContent,
    startLine: heading.lineNumber,
    endLine,
    bodyEndLine,
    createdAt: dates.createdAt,
    updatedAt: dates.updatedAt,
  };
}

/**
 * Decides which tagged lines stay notes of their own, and hands the rest to
 * the heading that holds them.
 *
 * A folded line is not copied onto its heading: its tags are recorded against
 * the line they are written on, so the heading matches a search for one of
 * them because it contains that line, and the match can say which line. The
 * heading's own tags stay what its author wrote on it.
 *
 * A line with no heading above it is kept as a note whatever the setting
 * says, because folding it would drop its tags on the floor.
 */
function foldTaggedLines(
  taggedLines: Section[],
  headingSections: Section[],
  lines: string[],
  boundaries: NoteBoundaries,
): Section[] {
  if (boundaries === 'line') {
    return taggedLines;
  }
  const byId = new Map(headingSections.map((section) => [section.id, section]));
  const kept: Section[] = [];
  for (const line of taggedLines) {
    const host = line.parentSectionId
      ? byId.get(line.parentSectionId)
      : undefined;
    // Consecutive tagged lines are read as one entry, so a marker written on
    // any of them marks the entry they form.
    const marked =
      boundaries === 'marked' &&
      lines
        .slice(line.startLine - 1, line.endLine)
        .some((text) => BLOCK_ID_PATTERN.test(text));
    if (!host || marked) {
      kept.push(line);
      continue;
    }
    const labels = line.tagLabels ?? {};
    const bodyTags = line.tags.map((key) => ({
      key,
      label: labels[key] ?? key,
      line: line.startLine,
    }));
    host.bodyTags = [...(host.bodyTags ?? []), ...bodyTags];
    // The tags of one line stay one group, so "written together" keeps
    // meaning "written on the same line" rather than "under one heading".
    host.associationTagGroups = [
      ...(host.associationTagGroups ?? []),
      bodyTags.map(({ key, label }) => ({ key, label })),
    ];
  }
  return kept;
}

/**
 * Finds the nearest structurally containing heading, even when that heading
 * does not carry a tag itself. The index can then walk farther upward to find
 * the nearest tagged ancestor.
 */
function findNearestParentHeading(
  headings: HeadingMatch[],
  headingIndex: number,
): HeadingMatch | undefined {
  const heading = headings[headingIndex];
  if (!heading) {
    return undefined;
  }

  for (let index = headingIndex - 1; index >= 0; index -= 1) {
    if (headings[index].level < heading.level) {
      return headings[index];
    }
  }

  return undefined;
}

/** A heading section's id, from its note, its line, and its words. */
function createHeadingSectionId(
  filePath: string,
  heading: HeadingMatch,
): string {
  return createId(
    'section',
    `${filePath}:${heading.lineNumber}:${heading.text}`,
  );
}

/**
 * Represents tagged prose as an entry only when it is not already a heading or
 * task, avoiding duplicate dashboard counts for checklist lines.
 */
function findInlineSections(
  context: NoteContext,
  headingSections: Section[],
): Section[] {
  const sections: Section[] = [];
  let lineIndex = 0;
  while (lineIndex < context.lines.length) {
    const read = readTaggedEntry(context, headingSections, lineIndex);
    if (read.section) {
      sections.push(read.section);
    }
    lineIndex = read.nextIndex;
  }
  return sections;
}

/** What reading from one line found: an entry, or none, and the line to read next. */
interface EntryReading {
  section?: Section;
  nextIndex: number;
}

/**
 * The tagged entry that starts on a line, if one does. A line in a fence,
 * a heading, or a task, open, done, or migrated, starts none.
 */
function readTaggedEntry(
  context: NoteContext,
  headingSections: Section[],
  lineIndex: number,
): EntryReading {
  const line = context.lines[lineIndex];
  if (
    context.fencedLines.has(lineIndex) ||
    isParsedHeading(line) ||
    isTaskLineOf(line, taskShape) ||
    // A task migrated to another day is neither a task nor a note.
    isTaskLineOf(line, MIGRATED_TASK_LINE)
  ) {
    return { nextIndex: lineIndex + 1 };
  }
  const listItem = getListItemMatch(line);
  if (listItem) {
    return {
      section: readTaggedListItem(context, headingSections, lineIndex, listItem.indentation),
      nextIndex: lineIndex + 1,
    };
  }
  return readTaggedParagraph(context, headingSections, lineIndex);
}

/**
 * A tagged list item as an entry, running through its indented children;
 * undefined when the item's own line has no tag. Its children are read as
 * lines of their own after it.
 */
function readTaggedListItem(
  context: NoteContext,
  headingSections: Section[],
  lineIndex: number,
  indentation: number,
): Section | undefined {
  const { lines, personMarker } = context;
  const line = lines[lineIndex];
  const localTags = extractTags(line, undefined, personMarker);
  if (localTags.length === 0) {
    return undefined;
  }
  const lineNumber = lineIndex + 1;
  const endLine = findListItemEndLine(lines, lineIndex, indentation);
  return createInlineSection(context, {
    sourceLine: line,
    lineNumber,
    endLine,
    rawContent: lines.slice(lineIndex, endLine).join('\n'),
    associationTagGroups: [localTags],
    parentSectionId: findNearestSection(headingSections, lineNumber)?.id,
  });
}

/**
 * A tagged paragraph as one entry: the line and each tagged line after it,
 * up to a fence, a heading, a task, a list item, or an untagged line. A
 * line with no tag starts none.
 */
function readTaggedParagraph(
  context: NoteContext,
  headingSections: Section[],
  lineIndex: number,
): EntryReading {
  const { lines, fencedLines, personMarker } = context;
  const line = lines[lineIndex];
  const localTags = extractTags(line, undefined, personMarker);
  if (localTags.length === 0) {
    return { nextIndex: lineIndex + 1 };
  }

  const paragraphLines = [line];
  let next = lineIndex + 1;
  while (next < lines.length) {
    const continuation = lines[next];
    if (
      fencedLines.has(next) ||
      isParsedHeading(continuation) ||
      isTaskLineOf(continuation, taskShape) ||
      getListItemMatch(continuation) ||
      extractTags(continuation, undefined, personMarker).length === 0
    ) {
      break;
    }
    paragraphLines.push(continuation);
    next += 1;
  }

  const lineNumber = lineIndex + 1;
  return {
    section: createInlineSection(context, {
      sourceLine: line,
      lineNumber,
      endLine: lineNumber + paragraphLines.length - 1,
      rawContent: paragraphLines.length > 1 ? paragraphLines.join('\n') : '',
      associationTagGroups: paragraphLines.map((paragraphLine) =>
        extractTags(paragraphLine, undefined, personMarker),
      ),
      parentSectionId: findNearestSection(headingSections, lineNumber)?.id,
    }),
    nextIndex: next,
  };
}

/** A tagged line or paragraph, as findInlineSections found it. */
interface InlineEntry {
  /** The entry's first line, which names it and makes its id. */
  sourceLine: string;
  lineNumber: number;
  endLine: number;
  /** The whole entry's text, or empty for a one-line paragraph. */
  rawContent: string;
  /** Each line's tags, a group per line. */
  associationTagGroups: TagReference[][];
  parentSectionId: string | undefined;
}

/**
 * A tagged line as a section: its words are its heading, it carries the
 * front matter's tags with its own, and its links are read from its text.
 */
function createInlineSection(context: NoteContext, entry: InlineEntry): Section {
  const { filePath, frontmatterTags, dates } = context;
  const { sourceLine, lineNumber, endLine, rawContent, associationTagGroups, parentSectionId } = entry;
  const localTags = associationTagGroups.flat();
  const inlineTags = mergeTagReferences(frontmatterTags, localTags);
  return {
    id: createId('inline', `${filePath}:${lineNumber}:${sourceLine}`),
    filePath,
    heading: sourceLine.trim(),
    headingLevel: 0,
    isInline: true,
    headingTags: [],
    associationTagGroups,
    parentSectionId,
    tags: inlineTags.map((tag) => tag.key),
    tagLabels: Object.fromEntries(
      inlineTags.map((tag) => [tag.key, tag.label]),
    ),
    links: extractWikiLinks(rawContent || sourceLine),
    rawContent,
    bodyContent: rawContent,
    startLine: lineNumber,
    endLine,
    bodyEndLine: endLine,
    createdAt: dates.createdAt,
    updatedAt: dates.updatedAt,
  };
}

/**
 * Captures the exact source line as well as parsed task data.
 *
 * The source snapshot lets checkbox updates verify that the note has not
 * changed before applying a one-character edit.
 */
function findTasks(
  context: NoteContext,
  sections: Section[],
  options: TaskReadOptions,
): Task[] {
  const { filePath, lines, fencedLines } = context;
  const listParents = findListParents(lines, fencedLines);
  const idsByLine = new Map<number, string>();
  const tasks = lines.flatMap((line, lineIndex): Task[] => {
    if (fencedLines.has(lineIndex)) {
      return [];
    }
    const match = matchTaskLine(line, taskShape);
    if (!match) {
      return [];
    }
    const id = createId('task', `${filePath}:${lineIndex + 1}:${match.body}`);
    idsByLine.set(lineIndex, id);
    const parentLine = findParentTaskLine(lines, listParents, lineIndex);
    const parentTaskId = parentLine === undefined ? undefined : idsByLine.get(parentLine);
    return [readTask(context, sections, { line, lineIndex, match, id, parentTaskId }, options)];
  });
  return summarizeSteps(tasks);
}

/** How a note's tasks are read beyond the note itself. */
interface TaskReadOptions {
  /** The day loose dates such as "next Friday" count from. */
  dateAnchor?: number;
  /** See `readAssignee`. */
  assigneeFromPersonTag: boolean;
}

/** A task line findTasks found, with its id and its parent task's. */
interface FoundTask {
  line: string;
  lineIndex: number;
  match: TaskLineMatch;
  id: string;
  parentTaskId: string | undefined;
}

/**
 * One task line as a task: its own tags with those of the section around
 * it, or the front matter's when no section holds it, and the fields its
 * metadata gives it.
 */
function readTask(
  context: NoteContext,
  sections: Section[],
  found: FoundTask,
  options: TaskReadOptions,
): Task {
  const { filePath, frontmatterTags, personMarker, dates } = context;
  const { line, lineIndex, match, id, parentTaskId } = found;
  const lineNumber = lineIndex + 1;
  const section = findNearestSection(sections, lineNumber);
  const inlineTags = extractTags(match.body, undefined, personMarker);
  const inheritedTags = section?.tags ?? frontmatterTags.map((tag) => tag.key);
  const inheritedLabels =
    section?.tagLabels ??
    Object.fromEntries(frontmatterTags.map((tag) => [tag.key, tag.label]));
  const tags = mergeTags(
    inheritedTags,
    inlineTags.map((tag) => tag.key),
  );
  const tagLabels = mergeTagLabels(inheritedLabels, inlineTags);
  const checkboxColumn = match.opening.length;
  const checkboxValue = match.mark as ' ' | 'x' | 'X';
  // Obsidian Tasks markers become fields and leave the title, so a ✅ date
  // is never read as a due date and titles read the way Tasks shows them.
  const { metadata: fields, title } = parseTaskMetadata(match.body);
  const dueDate =
    fields.due === undefined
      ? findTaskDate(title, options.dateAnchor)
      : toTaskDate(fields.due);

  return {
    id,
    filePath,
    sectionId: section?.id,
    title: title || match.body,
    completed: checkboxValue !== ' ',
    tags,
    tagLabels,
    associationTagGroups: [inlineTags],
    dueAt: dueDate?.at,
    dueText: dueDate?.text,
    ...omitUndefined({
      assignee: readAssignee(
        fields.assignee,
        inlineTags,
        options.assigneeFromPersonTag,
      ),
      scheduledAt: parseIsoDate(fields.scheduled),
      startAt: parseIsoDate(fields.start),
      doneAt: parseIsoDate(fields.done),
      priority: fields.priority,
      recurrence: fields.recurrence,
      dependencyId: fields.id,
      dependsOn: fields.dependsOn.length > 0 ? fields.dependsOn : undefined,
    }),
    lineNumber,
    checkboxColumn,
    checkboxValue,
    sourceLineText: line,
    createdAt: dates.createdAt,
    updatedAt: dates.updatedAt,
    ...(parentTaskId === undefined ? {} : { parentTaskId }),
  };
}

/**
 * Gives each task with steps a summary of them: how many, how many are
 * done, and which open one comes first. Only direct steps count.
 */
function summarizeSteps(tasks: Task[]): Task[] {
  const byId = new Map<string, Task>();
  tasks.forEach((task) => {
    byId.set(task.id, task);
    const parent = task.parentTaskId === undefined ? undefined : byId.get(task.parentTaskId);
    if (!parent) {
      return;
    }
    const steps = parent.steps ?? (parent.steps = { ids: [], total: 0, done: 0 });
    steps.ids.push(task.id);
    steps.total += 1;
    if (task.completed) {
      steps.done += 1;
    } else if (steps.next === undefined) {
      steps.next = task.title;
    }
  });
  return tasks;
}

/**
 * Whether a note is named for a week or a month, as
 * `week-2026-09-13-2026-09-19.md` and `month-september-2026.md` are, or as
 * `2026-W37.md` and `2026-09.md` were.
 */
export function isPeriodicNotePath(filePath: string): boolean {
  const name = (filePath.split('/').pop() ?? '').replace(/\.md$/i, '');
  return (
    /^week-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}$/i.test(name) ||
    /^month-[a-z]+-\d{4}$/i.test(name) ||
    /^\d{4}-(?:W\d{2}|\d{2})$/i.test(name)
  );
}

/**
 * Whether a note is a daily note: named for a day, as `2026-09-25.md` is, or
 * with a day in its top heading. Every place that tells a daily note from
 * any other asks this.
 */
export function isDailyNoteFile(file: Pick<ParsedFile, 'filePath' | 'sections'>): boolean {
  return findFileDailyNoteDate(file) !== undefined;
}

/** The day a daily note is for, read as `isDailyNoteFile` reads it. */
export function findFileDailyNoteDate(
  file: Pick<ParsedFile, 'filePath' | 'sections'>,
): string | undefined {
  return findDailyNoteDate(
    file.filePath,
    file.sections
      .filter((section) => section.headingLevel === 1 && !section.isInline)
      .map((section) => section.heading),
  );
}

/** Whether a note is a daily, weekly, or monthly note. */
export function isPeriodicNoteFile(file: Pick<ParsedFile, 'filePath' | 'sections'>): boolean {
  return isPeriodicNotePath(file.filePath) || isDailyNoteFile(file);
}

/**
 * The day a daily note is for: a YYYY-MM-DD file name, or failing that a
 * top-level heading that holds such a date.
 */
export function findDailyNoteDate(
  filePath: string,
  topLevelHeadings: readonly string[],
): string | undefined {
  const fromPath = filePath.match(/(?:^|\/)(\d{4}-\d{2}-\d{2})(?:\.md)?$/);
  if (fromPath) {
    return fromPath[1];
  }
  return topLevelHeadings
    .map((heading) => heading.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0])
    .find((date): date is string => date !== undefined);
}

/** A task's due date as a local midnight, with the words it was read from. */
interface TaskDate {
  at: number;
  text: string;
}

/** A Tasks due date as a task date, or undefined when it is no real day. */
function toTaskDate(value: string): TaskDate | undefined {
  const at = parseIsoDate(value);
  return at === undefined ? undefined : { at, text: value };
}

/**
 * Drops absent optional fields, so a task without Tasks metadata keeps the
 * shape it always had.
 */
function omitUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

/**
 * Resolves clear task dates without guessing when a relative date has no
 * trustworthy note timestamp to anchor it.
 */
function findTaskDate(text: string, anchor?: number): TaskDate | undefined {
  const explicit = text.match(explicitDatePattern);
  if (explicit) {
    const at = makeDay(
      Number(explicit[1]),
      Number(explicit[2]) - 1,
      Number(explicit[3]),
    );
    return at === undefined ? undefined : { at, text: explicit[0] };
  }

  const monthDate = text.match(monthDatePattern);
  if (monthDate && anchor !== undefined) {
    const month = MONTH_NUMBERS[monthDate[1].toLowerCase()];
    const year = monthDate[3]
      ? Number(monthDate[3])
      : new Date(anchor).getFullYear();
    const at =
      month === undefined
        ? undefined
        : makeDay(year, month, Number(monthDate[2]));
    return at === undefined ? undefined : { at, text: monthDate[0] };
  }

  const nextWeekday = text.match(nextWeekdayPattern);
  if (nextWeekday && anchor !== undefined) {
    const date = new Date(anchor);
    const targetDay = WEEKDAY_NAMES.indexOf(nextWeekday[1].toLowerCase());
    const offset = ((targetDay - date.getDay() + 7) % 7) || 7;
    date.setDate(date.getDate() + offset);
    date.setHours(0, 0, 0, 0);
    return { at: date.getTime(), text: nextWeekday[0] };
  }

  return undefined;
}

/**
 * The block ids a note carries, each with the one-based line it marks.
 *
 * The first of a repeated id wins, because a link can only mean one line and
 * the first is the one an author reading down the note would think of. Ids
 * inside fenced code are left alone, like everything else in a fence.
 */
export function findBlockIds(
  lines: string[],
  fencedLines: Set<number>,
): Record<string, number> {
  const blockIds: Record<string, number> = {};
  lines.forEach((line, lineIndex) => {
    if (fencedLines.has(lineIndex)) {
      return;
    }
    const match = BLOCK_ID_PATTERN.exec(line);
    // Own keys only: `in` would count `^constructor` as already seen.
    if (match && !Object.hasOwn(blockIds, match[1])) {
      blockIds[match[1]] = lineIndex + 1;
    }
  });
  return blockIds;
}

/**
 * Finds the nearest containing section so inherited tags follow source order.
 */
function findNearestSection(
  sections: Section[],
  lineNumber: number,
): Section | undefined {
  return sections
    .filter(
      (section) =>
        section.startLine < lineNumber && section.endLine >= lineNumber,
    )
    .sort(
      (left, right) =>
        right.startLine - left.startLine ||
        right.headingLevel - left.headingLevel,
    )[0];
}

/** A list item's indentation, or undefined for a line that is not one. */
export function listItemIndentation(line: string): number | undefined {
  return getListItemMatch(line)?.indentation;
}

/** A bullet or numbered list item's marker, or undefined for any other line. */
function getListItemMatch(line: string): ListItemMatch | undefined {
  const match = line.match(listItemPattern) ?? line.match(orderedListItemPattern);
  return match ? { indentation: match[1].length } : undefined;
}

/**
 * Extends a tagged list item through its indented descendants, using the
 * same boundary rule as a heading section: the next sibling or ancestor item
 * ends the note.
 */
export function findListItemEndLine(
  lines: string[],
  startIndex: number,
  indentation: number,
): number {
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const listItem = getListItemMatch(line);
    if (listItem && listItem.indentation <= indentation) {
      return index;
    }

    if (
      line.trim().length > 0 &&
      getLeadingWhitespaceLength(line) <= indentation
    ) {
      return index;
    }
  }

  return lines.length;
}

/** How many whitespace characters a line starts with. */
function getLeadingWhitespaceLength(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

/**
 * Combines inherited and local tags while preventing duplicate filter entries.
 */
function mergeTags(sectionTags: string[], inlineTags: string[]): string[] {
  return [...new Set([...sectionTags, ...inlineTags])];
}

/** Inherited tags then local ones, each key once, with the last spelling of a key kept. */
function mergeTagReferences(
  inherited: TagReference[],
  local: TagReference[],
): TagReference[] {
  return deduplicateTagReferences([...inherited, ...local]);
}

/**
 * Each key once, in the place it is first met, with the spelling it is last
 * met with.
 */
function deduplicateTagReferences(tags: TagReference[]): TagReference[] {
  const deduplicated = new Map<string, TagReference>();
  tags.forEach((tag) => deduplicated.set(tag.key, tag));
  return [...deduplicated.values()];
}

/**
 * Preserves the heading's display spelling when a task repeats the same key.
 *
 * This keeps labels stable across a section while still adding labels for
 * tags introduced only on the task line.
 */
function mergeTagLabels(
  sectionLabels: Record<string, string>,
  inlineTags: TagReference[],
): Record<string, string> {
  const labels = { ...sectionLabels };

  inlineTags.forEach((tag) => {
    labels[tag.key] ??= tag.label;
  });

  return labels;
}

/**
 * Tells completion whether a trailing hash belongs to ATX syntax, not a tag.
 */
export function hasAtxHeadingClosingHashes(line: string): boolean {
  const match = matchHeading(line, 'kept');
  if (!match) {
    return false;
  }

  const text = match.text.trim();
  return stripClosingHeadingHashes(text) !== text;
}

/**
 * Applies the optional closing-hash rule from ATX headings to display text.
 */
function stripClosingHeadingHashes(text: string): string {
  return text.replace(/[ \t]+#+[ \t]*$/, '').trim();
}

/**
 * The id a task line gets, so an edit that rewrites the line can carry the
 * task's place in the rank order across to the line it becomes.
 *
 * A task's id is made from its file, its line, and the text after its
 * checkbox, so stamping a done date on it makes it a different task as far as
 * anything keyed by id is concerned.
 */
export function getTaskLineId(
  filePath: string,
  lineNumber: number,
  lineText: string,
): string | undefined {
  const match = matchTaskLine(lineText, taskShape);
  return match
    ? createId('task', `${filePath}:${lineNumber}:${match.body}`)
    : undefined;
}

/**
 * A deterministic id, so persisted ranks and access counts survive a
 * workspace rescan without storing metadata in the Markdown source.
 *
 * An id is two independent 32-bit hashes of the same text. One alone let two
 * of 5,000 notes' sections share an id about one time in five, and the index
 * keeps one entry per id, so the other vanished. Two make that about one in
 * a billion billion.
 *
 * The first hash is the one ids were made of before 1.23, so an id written
 * then is this id without its last part: `legacyIdOf` reads it back, and
 * what was kept under the old id is carried over to the new one.
 */
function createId(prefix: string, value: string): string {
  let hash = 0;
  // FNV-1a, which shares nothing with the hash above.
  let second = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hash = ((hash << 5) - hash + code) | 0;
    second = Math.imul(second ^ code, 0x01000193);
  }

  return `${prefix}-${Math.abs(hash).toString(36)}-${(second >>> 0).toString(36)}`;
}

/**
 * The id an entry had before ids were widened, or undefined for an id that
 * is already of the old kind.
 */
export function legacyIdOf(id: string): string | undefined {
  const match = /^([a-z]+-[0-9a-z]+)-[0-9a-z]+$/.exec(id);
  return match ? match[1] : undefined;
}
