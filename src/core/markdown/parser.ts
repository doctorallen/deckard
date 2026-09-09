import {
  BuiltInEntityKind,
  EntityKind,
  HeadingTagSpan,
  ParsedFile,
  Section,
  TagReference,
  Task,
} from '../types';

interface HeadingMatch {
  lineNumber: number;
  level: number;
  text: string;
}

interface ListItemMatch {
  indentation: number;
}

interface Frontmatter {
  tags: TagReference[];
  links: string[];
  tagSpans: HeadingTagSpan[];
  endLine?: number;
}

const headingPattern = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/;
const taskPattern = /^(\s*)([-*+])[ \t]+\[([ xX])\][ \t]+(.*)$/;
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

export interface MarkdownParseOptions {
  parseInlineTags?: boolean;
  entityNamespaceAliases?: EntityNamespaceAliases;
  personMarker?: string;
}

export type EntityNamespaceAliases = Readonly<Record<string, string>>;

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

function resolveNamespaceAlias(
  namespace: string,
  aliases: Record<string, string>,
): string {
  let current = namespace;
  const visited = new Set<string>();
  while (aliases[current] && !visited.has(current)) {
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
  const frontmatter = parseFrontmatter(
    lines,
    options.entityNamespaceAliases,
    personMarker,
  );
  const fencedLines = findFencedLines(lines);
  if (frontmatter.endLine !== undefined) {
    for (let lineIndex = 0; lineIndex <= frontmatter.endLine; lineIndex += 1) {
      fencedLines.add(lineIndex);
    }
  }
  const headings = findHeadings(lines, fencedLines);
  const headingSections = headings.map((heading, headingIndex) =>
    createSection(
      filePath,
      lines,
      headings,
      heading,
      headingIndex,
      metadata,
      frontmatter.tags,
      personMarker,
    ),
  );
  const inlineSections =
    options.parseInlineTags === false
      ? []
      : findInlineSections(
          filePath,
          lines,
          fencedLines,
          metadata,
          frontmatter.tags,
          personMarker,
        );
  const sections = [...headingSections, ...inlineSections].sort(
    (left, right) => left.startLine - right.startLine,
  );
  const tasks = findTasks(
    filePath,
    lines,
    sections,
    fencedLines,
    metadata,
    frontmatter.tags,
    personMarker,
  );

  return normalizeParsedTagReferences({
    filePath,
    content,
    sections,
    tasks,
    frontmatterTags: frontmatter.tags,
    links: [...new Set([...frontmatter.links, ...extractWikiLinks(content)])],
    createdAt: metadata?.createdAt,
    updatedAt: metadata?.updatedAt,
  }, options.entityNamespaceAliases);
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
  const key = normalizeTagKey(tag.key, entityNamespaceAliases);
  if (!key.startsWith('#')) {
    return undefined;
  }

  const [namespace, ...name] = key.slice(1).split('/');
  if (!namespace || name.length === 0 || namespace.toLowerCase() === 'tag-at') {
    return undefined;
  }

  return namespace.toLowerCase();
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
  return `${formatTitlePart(kind)}: ${formatTitlePart(name)}`;
}

function formatTitlePart(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

  /**
   * Parses the small YAML subset used for portable entity metadata. Unsupported
   * YAML remains ordinary Markdown and does not prevent notes from indexing.
   */
  function parseFrontmatter(
    lines: string[],
    entityNamespaceAliases?: EntityNamespaceAliases,
    personMarker?: string,
  ): Frontmatter {
    if (lines[0]?.trim() !== '---') {
      return { tags: [], links: [], tagSpans: [] };
    }
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end < 0) {
      return { tags: [], links: [], tagSpans: [] };
    }

    const values = new Map<string, string[]>();
    const tagSpans: HeadingTagSpan[] = [];
    let currentKey: string | undefined;
    lines.slice(1, end).forEach((line, lineIndex) => {
      const lineNumber = lineIndex + 2;
      const property = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
      if (property) {
        currentKey = property[1].toLowerCase();
        values.set(currentKey, splitFrontmatterValues(property[2]));
        const valueStart = line.indexOf(property[2], property[1].length + 1);
        tagSpans.push(
          ...createFrontmatterTagSpans(
            currentKey,
            property[2],
            lineNumber,
            valueStart,
            entityNamespaceAliases,
            personMarker,
          ),
        );
        return;
      }
      const listItem = line.match(/^\s*-\s+(.+?)\s*$/);
      if (listItem && currentKey) {
        values.get(currentKey)?.push(unquote(listItem[1]));
        tagSpans.push(
          ...createFrontmatterTagSpans(
            currentKey,
            listItem[1],
            lineNumber,
            line.indexOf(listItem[1]),
            entityNamespaceAliases,
            personMarker,
          ),
        );
      }
    });

    const tags: TagReference[] = [];
    const links: string[] = [];
    values.forEach((fieldValues, key) => {
      if (key === 'links') {
        fieldValues.forEach((value) => links.push(...extractWikiLinks(value)));
        return;
      }
      fieldValues.forEach((value) => {
        const tag = frontmatterValueToTag(
          key,
          value,
          entityNamespaceAliases,
          personMarker,
        );
        if (tag) {
          tags.push(tag);
        }
      });
    });

    return {
      tags: deduplicateTagReferences(tags),
      links: [...new Set(links)],
      tagSpans,
      endLine: end,
    };
  }

  function splitFrontmatterValues(value: string): string[] {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      return trimmed
        .slice(1, -1)
        .split(',')
        .map((item) => unquote(item.trim()))
        .filter(Boolean);
    }
    return [unquote(trimmed)];
  }

  function unquote(value: string): string {
    return value.replace(/^['"]|['"]$/g, '');
  }

  function frontmatterValueToTag(
    field: string,
    value: string,
    entityNamespaceAliases?: EntityNamespaceAliases,
    personMarker?: string,
  ): TagReference | undefined {
    const existing = extractTags(
      value,
      entityNamespaceAliases,
      personMarker,
    )[0];
    if (existing) {
      return existing;
    }
    if (field === 'tag' || field === 'tags') {
      const namespacedValue = value
        .trim()
        .match(
          /^#?([A-Za-z][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)+)$/,
        );
      if (namespacedValue) {
        const label = `#${namespacedValue[1]}`;
        return {
          key: normalizeTagKey(label.toLowerCase(), entityNamespaceAliases),
          label,
        };
      }
    }
    const slug = toSlug(value);
    if (!slug) {
      return undefined;
    }
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

  function createFrontmatterTagSpans(
    field: string,
    rawValue: string,
    lineNumber: number,
    valueStart: number,
    entityNamespaceAliases?: EntityNamespaceAliases,
    personMarker?: string,
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
      const tag = frontmatterValueToTag(
        field,
        value,
        entityNamespaceAliases,
        personMarker,
      );
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
  return collectTagSpans(content, false, false);
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
    parseInlineTags,
    true,
    entityNamespaceAliases,
    personMarker,
  );
}

function collectTagSpans(
  content: string,
  parseInlineTags: boolean,
  includeFrontmatter: boolean,
  entityNamespaceAliases?: EntityNamespaceAliases,
  personMarker?: string,
): HeadingTagSpan[] {
  const lines = content.split(/\r?\n/);
  const frontmatter = parseFrontmatter(
    lines,
    entityNamespaceAliases,
    personMarker,
  );
  const fencedLines = findFencedLines(lines);

  const contentSpans = lines.flatMap((line, lineIndex) => {
    if (frontmatter.endLine !== undefined && lineIndex <= frontmatter.endLine) {
      return [];
    }
    if (fencedLines.has(lineIndex)) {
      return [];
    }

    const heading = line.match(headingPattern);
    if (heading) {
      const headingTextStart = heading[0].indexOf(heading[2]);
      return createTagSpans(
        heading[2],
        lineIndex + 1,
        headingTextStart,
        entityNamespaceAliases,
        personMarker,
      );
    }

    if (!parseInlineTags) {
      return [];
    }

    return createTagSpans(
      line,
      lineIndex + 1,
      0,
      entityNamespaceAliases,
      personMarker,
    );
  });

  return includeFrontmatter
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
  lineNumber: number,
  columnOffset: number,
  entityNamespaceAliases?: EntityNamespaceAliases,
  personMarker?: string,
): HeadingTagSpan[] {
  return findTagMatches(
    text,
    entityNamespaceAliases,
    personMarker,
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
  [...parsed.sections, ...parsed.tasks].forEach((item) => {
    if ('headingTags' in item) {
      item.headingTags = normalizeTagReferences(
        item.headingTags ?? [],
        entityNamespaceAliases,
      );
    }
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

  const canonicalNamespace = getEntityNamespaceAliases(entityNamespaceAliases)[
    namespace.toLowerCase()
  ];
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
  return text
    .replace(
      createTagPattern(getPersonMarker(personMarker)),
      (fullMatch, prefix: string, marker: string, rawName: string) =>
        isNumericHashTag(marker, rawName) ? fullMatch : prefix,
    )
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

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
  return [...text.matchAll(createTagPattern(activePersonMarker))].flatMap((match) => {
    const marker = match[2];
    const rawName = match[3];
    if (isNumericHashTag(marker, rawName)) {
      return [];
    }

    const markerIndex = (match.index ?? 0) + match[0].lastIndexOf(marker);
    return [
      {
        key:
          marker === activePersonMarker
            ? `@${rawName.toLowerCase()}`
            : marker === '@'
              ? `#tag-at/${rawName.toLowerCase()}`
            : normalizeTagKey(
                `${marker}${rawName.toLowerCase()}`,
                entityNamespaceAliases,
              ),
        label: `${marker}${rawName}`,
        start: markerIndex,
        end: markerIndex + marker.length + rawName.length,
      },
    ];
  });
}

function createTagPattern(personMarker: string): RegExp {
  const escapedMarker = personMarker.replace(/[\\\]^]/g, '\\$&');
  return new RegExp(
    `(^|[^\\w#])([#@${escapedMarker}])([A-Za-z0-9][A-Za-z0-9_-]*(?:\\/[A-Za-z0-9][A-Za-z0-9_-]*)*)\\b`,
    'g',
  );
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
    const match = line.match(headingPattern);
    if (match) {
      headings.push({
        lineNumber: lineIndex + 1,
        level: match[1].length,
        text: stripClosingHeadingHashes(match[2].trim()),
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
  filePath: string,
  lines: string[],
  headings: HeadingMatch[],
  heading: HeadingMatch,
  headingIndex: number,
  metadata?: Pick<ParsedFile, 'createdAt' | 'updatedAt'>,
  frontmatterTags: TagReference[] = [],
  personMarker?: string,
): Section {
  const nextBoundary = headings
    .slice(headingIndex + 1)
    .find((candidate) => candidate.level <= heading.level);
  const endLine = nextBoundary ? nextBoundary.lineNumber - 1 : lines.length;
  const headingTags = extractTags(heading.text, undefined, personMarker);
  const sectionTags = mergeTagReferences(frontmatterTags, headingTags);
  const tagLabels = Object.fromEntries(
    sectionTags.map((tag) => [tag.key, tag.label]),
  );
  const rawContent = lines.slice(heading.lineNumber - 1, endLine).join('\n');
  const parentHeading = findNearestParentHeading(headings, headingIndex);

  return {
    id: createHeadingSectionId(filePath, heading),
    filePath,
    heading: heading.text,
    headingLevel: heading.level,
    headingTags,
    parentSectionId: parentHeading
      ? createHeadingSectionId(filePath, parentHeading)
      : undefined,
    tags: sectionTags.map((tag) => tag.key),
    tagLabels,
    links: extractWikiLinks(rawContent),
    rawContent,
    startLine: heading.lineNumber,
    endLine,
    createdAt: metadata?.createdAt,
    updatedAt: metadata?.updatedAt,
  };
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
  filePath: string,
  lines: string[],
  fencedLines: Set<number>,
  metadata?: Pick<ParsedFile, 'createdAt' | 'updatedAt'>,
  frontmatterTags: TagReference[] = [],
  personMarker?: string,
): Section[] {
  const sections: Section[] = [];
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    if (
      fencedLines.has(lineIndex) ||
      headingPattern.test(line) ||
      taskPattern.test(line)
    ) {
      lineIndex += 1;
      continue;
    }

    const listItem = getListItemMatch(line);
    if (listItem) {
      const localTags = extractTags(line, undefined, personMarker);
      if (localTags.length > 0) {
        const lineNumber = lineIndex + 1;
        const endLine = findListItemEndLine(
          lines,
          lineIndex,
          listItem.indentation,
        );
        const rawContent = lines.slice(lineIndex, endLine).join('\n');
        sections.push(
          createInlineSection(
            filePath,
            line,
            lineNumber,
            endLine,
            rawContent,
            localTags,
            frontmatterTags,
            metadata,
          ),
        );
      }
      lineIndex += 1;
      continue;
    }

    const localTags = extractTags(line, undefined, personMarker);
    if (localTags.length === 0) {
      lineIndex += 1;
      continue;
    }

    const startLineIndex = lineIndex;
    const paragraphLines = [line];
    lineIndex += 1;
    while (lineIndex < lines.length) {
      const continuation = lines[lineIndex];
      if (
        fencedLines.has(lineIndex) ||
        headingPattern.test(continuation) ||
        taskPattern.test(continuation) ||
        getListItemMatch(continuation) ||
        extractTags(continuation, undefined, personMarker).length === 0
      ) {
        break;
      }
      paragraphLines.push(continuation);
      lineIndex += 1;
    }

    const lineNumber = startLineIndex + 1;
    const rawContent =
      paragraphLines.length > 1 ? paragraphLines.join('\n') : '';
    sections.push(
      createInlineSection(
        filePath,
        line,
        lineNumber,
        lineNumber + paragraphLines.length - 1,
        rawContent,
        paragraphLines.flatMap((paragraphLine) =>
          extractTags(paragraphLine, undefined, personMarker),
        ),
        frontmatterTags,
        metadata,
      ),
    );
  }

  return sections;
}

function createInlineSection(
  filePath: string,
  sourceLine: string,
  lineNumber: number,
  endLine: number,
  rawContent: string,
  localTags: TagReference[],
  frontmatterTags: TagReference[],
  metadata?: Pick<ParsedFile, 'createdAt' | 'updatedAt'>,
): Section {
  const inlineTags = mergeTagReferences(frontmatterTags, localTags);
  return {
    id: createId('inline', `${filePath}:${lineNumber}:${sourceLine}`),
    filePath,
    heading: sourceLine.trim(),
    headingLevel: 0,
    isInline: true,
    headingTags: [],
    tags: inlineTags.map((tag) => tag.key),
    tagLabels: Object.fromEntries(
      inlineTags.map((tag) => [tag.key, tag.label]),
    ),
    links: extractWikiLinks(rawContent || sourceLine),
    rawContent,
    startLine: lineNumber,
    endLine,
    createdAt: metadata?.createdAt,
    updatedAt: metadata?.updatedAt,
  };
}

/**
 * Captures the exact source line as well as parsed task data.
 *
 * The source snapshot lets checkbox updates verify that the note has not
 * changed before applying a one-character edit.
 */
function findTasks(
  filePath: string,
  lines: string[],
  sections: Section[],
  fencedLines: Set<number>,
  metadata?: Pick<ParsedFile, 'createdAt' | 'updatedAt'>,
  frontmatterTags: TagReference[] = [],
  personMarker?: string,
): Task[] {
  return lines.flatMap((line, lineIndex) => {
    if (fencedLines.has(lineIndex)) {
      return [];
    }
    const match = line.match(taskPattern);
    if (!match) {
      return [];
    }

    const lineNumber = lineIndex + 1;
    const section = findNearestSection(sections, lineNumber);
    const inlineTags = extractTags(match[4], undefined, personMarker);
    const inheritedTags = section?.tags ?? frontmatterTags.map((tag) => tag.key);
    const inheritedLabels =
      section?.tagLabels ??
      Object.fromEntries(frontmatterTags.map((tag) => [tag.key, tag.label]));
    const tags = mergeTags(
      inheritedTags,
      inlineTags.map((tag) => tag.key),
    );
    const tagLabels = mergeTagLabels(inheritedLabels, inlineTags);
    const checkboxColumn = match[1].length + match[2].length + 2;
    const checkboxValue = match[3] as ' ' | 'x' | 'X';
    const dueDate = findTaskDate(match[4], metadata?.updatedAt);

    return [
      {
        id: createId('task', `${filePath}:${lineNumber}:${match[4]}`),
        filePath,
        sectionId: section?.id,
        title: match[4],
        completed: checkboxValue !== ' ',
        tags,
        tagLabels,
        dueAt: dueDate?.at,
        dueText: dueDate?.text,
        lineNumber,
        checkboxColumn,
        checkboxValue,
        sourceLineText: line,
        createdAt: metadata?.createdAt,
        updatedAt: metadata?.updatedAt,
      },
    ];
  });
}

interface TaskDate {
  at: number;
  text: string;
}

/**
 * Resolves clear task dates without guessing when a relative date has no
 * trustworthy note timestamp to anchor it.
 */
function findTaskDate(text: string, anchor?: number): TaskDate | undefined {
  const explicit = text.match(explicitDatePattern);
  if (explicit) {
    const at = createLocalDate(
      Number(explicit[1]),
      Number(explicit[2]) - 1,
      Number(explicit[3]),
    );
    return at === undefined ? undefined : { at, text: explicit[0] };
  }

  const monthDate = text.match(monthDatePattern);
  if (monthDate && anchor !== undefined) {
    const month = monthNumbers[monthDate[1].toLowerCase()];
    const year = monthDate[3]
      ? Number(monthDate[3])
      : new Date(anchor).getFullYear();
    const at =
      month === undefined
        ? undefined
        : createLocalDate(year, month, Number(monthDate[2]));
    return at === undefined ? undefined : { at, text: monthDate[0] };
  }

  const nextWeekday = text.match(nextWeekdayPattern);
  if (nextWeekday && anchor !== undefined) {
    const date = new Date(anchor);
    const targetDay = weekdayNames.indexOf(nextWeekday[1].toLowerCase());
    const offset = ((targetDay - date.getDay() + 7) % 7) || 7;
    date.setDate(date.getDate() + offset);
    date.setHours(0, 0, 0, 0);
    return { at: date.getTime(), text: nextWeekday[0] };
  }

  return undefined;
}

const monthNumbers: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const weekdayNames = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

function createLocalDate(
  year: number,
  month: number,
  day: number,
): number | undefined {
  const date = new Date(year, month, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return undefined;
  }
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Marks fence delimiters and their contents in one pass so every Markdown
 * feature can ignore examples without maintaining a second parser.
 */
export function findFencedLines(lines: string[]): Set<number> {
  const fencedLines = new Set<number>();
  let fenceCharacter: '`' | '~' | undefined;

  lines.forEach((line, lineIndex) => {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      fencedLines.add(lineIndex);
      const nextFenceCharacter = fence[1][0] as '`' | '~';
      if (fenceCharacter === undefined) {
        fenceCharacter = nextFenceCharacter;
      } else if (fenceCharacter === nextFenceCharacter) {
        fenceCharacter = undefined;
      }
      return;
    }

    if (fenceCharacter !== undefined) {
      fencedLines.add(lineIndex);
    }
  });

  return fencedLines;
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

function getListItemMatch(line: string): ListItemMatch | undefined {
  const match = line.match(listItemPattern) ?? line.match(orderedListItemPattern);
  return match ? { indentation: match[1].length } : undefined;
}

/**
 * Extends a tagged list item through its indented descendants, using the
 * same boundary rule as a heading section: the next sibling or ancestor item
 * ends the note.
 */
function findListItemEndLine(
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

function getLeadingWhitespaceLength(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

/**
 * Combines inherited and local tags while preventing duplicate filter entries.
 */
function mergeTags(sectionTags: string[], inlineTags: string[]): string[] {
  return [...new Set([...sectionTags, ...inlineTags])];
}

function mergeTagReferences(
  inherited: TagReference[],
  local: TagReference[],
): TagReference[] {
  return deduplicateTagReferences([...inherited, ...local]);
}

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
  const match = line.match(headingPattern);
  if (!match) {
    return false;
  }

  const text = match[2].trim();
  return stripClosingHeadingHashes(text) !== text;
}

/**
 * Applies the optional closing-hash rule from ATX headings to display text.
 */
function stripClosingHeadingHashes(text: string): string {
  return text.replace(/[ \t]+#+[ \t]*$/, '').trim();
}

/**
 * Creates deterministic IDs so persisted ranks and access counts survive a
 * workspace rescan without storing metadata in the Markdown source.
 */
function createId(prefix: string, value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }

  return `${prefix}-${Math.abs(hash).toString(36)}`;
}
