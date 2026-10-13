import { extractTags, stripTags, type EntityNamespaceAliases } from '../../domain/markdown/parser';
import type { ParsedFile, Section, TagInfo, WorkspaceIndex } from '../../domain/model';
import { getFileName } from '../../shared/paths';

/**
 * Add Task's way to a hub note: a tag written in a new task's words that a
 * hub note describes sends the task there, as `Call Ren #project/atlas`
 * goes to Atlas.md, and a short tag, `#atlas`, does when one hub's tag ends
 * with it. Where in the hub it goes, and whether the line keeps the tag,
 * are decided here, without VS Code, so a test reads each one.
 */

/** A tag that a hub note describes, and the note. */
export interface HubNote {
  /** The tag's key, as the index keeps it: `#project/atlas`. */
  key: string;
  /** The tag as the hub's tag is written in full: `#project/atlas`. */
  label: string;
  filePath: string;
}

/** A hub a task's words name: the hub, and the tag as the words write it. */
export interface HubRoute {
  hub: HubNote;
  /** The tag as typed, `#atlas` for a short one. */
  written: string;
}

/** Where in its hub a task goes, and whether its line keeps the tag. */
export interface HubPlace {
  /** The hub's Tasks heading, when it has one; otherwise after its last list item or text. */
  section?: Section;
  /** False when the place carries the tag already, from a heading above it or front matter. */
  keepsTag: boolean;
}

/**
 * Every tag a hub note describes, by its key in lower case, each with the
 * first of its hub notes by path, as a tag's page leads with it.
 */
export function listHubNotes(files: Iterable<Pick<ParsedFile, 'filePath' | 'hub'>>): Map<string, HubNote> {
  const hubs = new Map<string, HubNote>();
  [...files]
    .filter((file) => file.hub)
    .sort((left, right) => left.filePath.localeCompare(right.filePath))
    .forEach((file) =>
      file.hub?.describes.forEach((tag) => {
        const key = tag.key.toLowerCase();
        if (!hubs.has(key)) {
          hubs.set(key, { key: tag.key, label: fullLabel(tag.key, tag.label), filePath: file.filePath });
        }
      }),
    );
  return hubs;
}

/** A tag written in full: the label when it says the whole key, else the key. */
function fullLabel(key: string, label: string): string {
  return label.toLowerCase() === key.toLowerCase() ? label : key;
}

/** What reading a task's words for a hub needs besides them. */
export interface HubWordsReading {
  hubs: ReadonlyMap<string, HubNote>;
  /** Whether a tag is written anywhere, so `#atlas` in use stays `#atlas`. */
  isTagInUse: (key: string) => boolean;
  entityNamespaceAliases?: EntityNamespaceAliases;
  personMarker?: string;
}

/**
 * The first tag in a task's words that a hub note describes: written in
 * full, or short, `#atlas`, when no tag `#atlas` is written anywhere and
 * exactly one hub's tag ends with `/atlas`. Undefined when the words name
 * no hub.
 */
export function findHubInWords(description: string, reading: HubWordsReading): HubRoute | undefined {
  const tags = extractTags(description, reading.entityNamespaceAliases, reading.personMarker);
  for (const tag of tags) {
    const hub = reading.hubs.get(tag.key.toLowerCase()) ?? findShortHub(tag.key, reading);
    if (hub) {
      return { hub, written: tag.label };
    }
  }
  return undefined;
}

/** The one hub whose tag ends with a short `#tag`'s name, when the short tag is not one of its own. */
function findShortHub(key: string, reading: HubWordsReading): HubNote | undefined {
  if (!key.startsWith('#') || key.includes('/') || reading.isTagInUse(key)) {
    return undefined;
  }
  const ending = `/${key.slice(1).toLowerCase()}`;
  const matches = [...reading.hubs.values()].filter((hub) => hub.key.toLowerCase().endsWith(ending));
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * The tags a place in a note carries without writing them: those on the
 * heading it is under and each heading above that, and the note's front
 * matter's, by key in lower case.
 */
export function listInheritedTagKeys(file: Pick<ParsedFile, 'sections' | 'frontmatterTags'>, section: Section | undefined): Set<string> {
  const byId = new Map(file.sections.map((each) => [each.id, each]));
  const keys = new Set(file.frontmatterTags.map((tag) => tag.key.toLowerCase()));
  for (let current = section; current; current = current.parentSectionId ? byId.get(current.parentSectionId) : undefined) {
    current.headingTags?.forEach((tag) => keys.add(tag.key.toLowerCase()));
  }
  return keys;
}

/** The heading a one-based line is under, the deepest one that holds it. */
export function findHeadingAt(file: Pick<ParsedFile, 'sections'>, line: number): Section | undefined {
  return file.sections
    .filter((section) => !section.isInline && section.startLine <= line && section.endLine >= line)
    .sort((left, right) => right.startLine - left.startLine)[0];
}

/** Whether a heading reads `Tasks`, its tags and case aside. */
function isTasksHeading(section: Section): boolean {
  return !section.isInline && stripTags(section.heading).trim().toLowerCase() === 'tasks';
}

/**
 * Where a task goes in its hub: under the hub's first heading named
 * Tasks, else after the note's last list item or text, and whether its
 * line keeps the tag, which it does not need where the place carries it.
 */
export function placeInHub(index: Pick<WorkspaceIndex, 'files'>, hub: HubNote): HubPlace {
  const file = index.files.get(hub.filePath);
  if (!file) {
    return { keepsTag: true };
  }
  const section = [...file.sections].sort((left, right) => left.startLine - right.startLine).find(isTasksHeading);
  const keepsTag = !listInheritedTagKeys(file, section).has(hub.key.toLowerCase());
  return section ? { section, keepsTag } : { keepsTag };
}

/** Whether a task written at a one-based line of a note is already the hub's: the hub itself, or under its tag. */
export function isUnderHub(file: Pick<ParsedFile, 'filePath' | 'sections' | 'frontmatterTags'> | undefined, line: number, hub: HubNote): boolean {
  if (!file) {
    return false;
  }
  return file.filePath === hub.filePath || listInheritedTagKeys(file, findHeadingAt(file, line)).has(hub.key.toLowerCase());
}

/**
 * The words with the hub's tag as the place needs it: left off where the
 * place carries it, and otherwise written in full, `#project/atlas` for
 * `#atlas`.
 */
export function rewriteHubTag(description: string, route: HubRoute, keep: boolean): string {
  const written = new RegExp(`(^|\\s)${escapeRegExp(route.written)}(?=\\s|$)`, 'u');
  if (!keep) {
    return description.replace(written, '').trim();
  }
  return route.written === route.hub.label ? description : description.replace(written, `$1${route.hub.label}`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** A tag Add a tag offers, and what it says of it. */
export interface TagSuggestion {
  label: string;
  description: string;
}

/**
 * The tags Add a tag offers: those with a hub note first, each said to be
 * one, as a new task with one goes to its hub, then the others, the most
 * used first, `limit` in all.
 */
export function listTagSuggestions(index: Pick<WorkspaceIndex, 'tags' | 'files'>, limit: number): TagSuggestion[] {
  const hubOf = (tag: TagInfo): string | undefined => tag.hubFilePaths?.find((path) => index.files.has(path));
  const entries = (count: number): string => `${count} ${count === 1 ? 'entry' : 'entries'}`;
  return [...index.tags.values()]
    .map((tag) => ({ tag, hub: hubOf(tag) }))
    .sort((left, right) => Number(right.hub !== undefined) - Number(left.hub !== undefined) || right.tag.count - left.tag.count)
    .slice(0, limit)
    .map(({ tag, hub }) => ({
      label: tag.label,
      description: hub === undefined ? entries(tag.count) : `Hub: ${getFileName(hub)} · ${entries(tag.count)}`,
    }));
}
