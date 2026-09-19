import { BLOCK_ID_PATTERN } from '../../core/markdown/parser';
import {
  BacklinkIndex,
  createNoteTitleMap,
  findLinkedBlock,
  findLinkedSection,
  findWikiTargetPaths,
  noteTitle,
  WikiLinkOccurrence,
  WikiLinkTarget,
} from '../../core/workspace/backlinks';
import { ParsedFile, Section, Task, WorkspaceIndex } from '../../core/types';
import { getHeadingPath } from './dashboardState';
import { stripTrailingTags } from './queryBlockState';

/**
 * What the editor shows about a note's connections: how often it and its
 * headings are linked to, the open tasks under each heading, and previews of
 * what a link or tag points at.
 */

const PREVIEW_LINES = 12;
const PREVIEW_CHARACTERS = 900;
const TAG_ENTRY_LIMIT = 5;

export interface HeadingReferences {
  /** Zero-based line of the heading. */
  line: number;
  references: WikiLinkOccurrence[];
  /** Open tasks under the heading, its sub-headings included. */
  openTasks: Task[];
}

export interface ReferenceSummary {
  /** Links into the note from other notes. */
  backlinks: WikiLinkOccurrence[];
  /** Headings with at least one reference or open task. */
  headings: HeadingReferences[];
}

export type LinkPreview =
  | { kind: 'missing'; note: string }
  | { kind: 'ambiguous'; note: string; matches: number }
  | {
      kind: 'found';
      /** Note and heading path, such as "Launch plan › Decision". */
      title: string;
      filePath: string;
      /** One-based line the link lands on. */
      line: number;
      excerpt: string;
      truncated: boolean;
      /** A `#Heading` the note does not have, so the preview shows its start. */
      missingHeading?: string;
      /** A `#^id` the note does not carry, so the preview shows its start. */
      missingBlock?: string;
      /** Other notes that link to this one. */
      backlinkCount: number;
    };

export interface TagSummaryEntry {
  title: string;
  fileName: string;
  filePath: string;
  /** One-based line. */
  line: number;
  task: boolean;
  completed: boolean;
}

export interface TagSummary {
  label: string;
  /** Sections and front-matter-only notes that carry the tag. */
  noteCount: number;
  taskCount: number;
  openTaskCount: number;
  /** The note that describes the tag, when one does. */
  hubFilePath?: string;
  /** The most recently updated entries. */
  entries: TagSummaryEntry[];
}

/**
 * Counts what points at a note and its headings. `file` is usually parsed
 * from the editor, so headings and tasks follow unsaved edits while links
 * come from the saved workspace.
 */
export function createReferenceSummary(
  file: ParsedFile,
  backlinks: BacklinkIndex,
): ReferenceSummary {
  const sections = new Map(file.sections.map((section) => [section.id, section]));
  const openTasks = file.tasks.filter((task) => !task.completed);
  const headings = file.sections
    .filter((section) => !section.isInline)
    .map((section) => ({
      line: section.startLine - 1,
      references: backlinks.toHeading(file.filePath, section.heading),
      openTasks: openTasks.filter((task) =>
        isWithin(task.sectionId, section.id, sections),
      ),
    }))
    .filter(
      (heading) => heading.references.length > 0 || heading.openTasks.length > 0,
    );
  return { backlinks: backlinks.toNote(file.filePath), headings };
}

/**
 * Describes what a link points at: the section its `#Heading` names, or the
 * start of the note.
 */
export function createLinkPreview(
  index: WorkspaceIndex,
  backlinks: BacklinkIndex,
  target: WikiLinkTarget,
  sourcePath: string,
): LinkPreview {
  const paths = findWikiTargetPaths(createNoteTitleMap(index), target.note, sourcePath);
  if (paths.length > 1) {
    return { kind: 'ambiguous', note: target.note, matches: paths.length };
  }
  const file = paths[0] ? index.files.get(paths[0]) : undefined;
  if (!file) {
    return { kind: 'missing', note: target.note };
  }

  const title = noteTitle(file.filePath);
  const blockLine = target.block ? findLinkedBlock(file, target.block) : undefined;
  // A link to a line is previewed as that line, under the headings it sits
  // beneath, because the line is what the reader asked to see.
  const section = target.block
    ? blockLine === undefined
      ? undefined
      : findSectionAt(file, blockLine)
    : target.heading
      ? findLinkedSection(file, target.heading)
      : undefined;
  const sections = new Map(file.sections.map((entry) => [entry.id, entry]));
  const path = section ? getHeadingPath(section, sections) : [];
  // A note usually opens with a heading of its own name; do not say it twice.
  const titlePath =
    path[0]?.toLocaleLowerCase() === title.toLocaleLowerCase()
      ? path
      : [title, ...path];
  const excerpt = limitExcerpt(
    blockLine !== undefined
      ? readBlockLine(file, blockLine)
      : section
        ? removeFirstLine(section.rawContent)
        : removeFrontmatter(file.content),
  );

  return {
    kind: 'found',
    title: titlePath.join(' › '),
    filePath: file.filePath,
    line: blockLine ?? (section ? section.startLine : 1),
    excerpt: excerpt.text,
    truncated: excerpt.truncated,
    missingHeading: target.heading && !section ? target.heading : undefined,
    missingBlock:
      target.block && blockLine === undefined ? target.block : undefined,
    backlinkCount: new Set(
      backlinks.toNote(file.filePath).map((occurrence) => occurrence.sourcePath),
    ).size,
  };
}

/** The heading section a line sits under, for a link that names a line. */
function findSectionAt(file: ParsedFile, line: number): Section | undefined {
  let best: Section | undefined;
  for (const section of file.sections) {
    if (
      !section.isInline &&
      section.startLine <= line &&
      (best === undefined || section.startLine > best.startLine)
    ) {
      best = section;
    }
  }
  return best;
}

/** One `^block-id` line, without the id an author wrote to point at it. */
function readBlockLine(file: ParsedFile, line: number): string {
  const text = file.content.split(/\r?\n/)[line - 1] ?? '';
  return text.replace(BLOCK_ID_PATTERN, '').trim();
}

/**
 * Summarizes a tag for its hover: how many notes and tasks use it, and its
 * most recently updated entries.
 */
export function createTagSummary(
  index: WorkspaceIndex,
  tagKey: string,
  limit = TAG_ENTRY_LIMIT,
): TagSummary | undefined {
  const tag = index.tags.get(tagKey);
  if (!tag) {
    return undefined;
  }
  const sections = tag.sectionIds
    .map((id) => index.sections.get(id))
    .filter((section): section is Section => section !== undefined);
  const tasks = tag.taskIds
    .map((id) => index.tasks.get(id))
    .filter((task): task is Task => task !== undefined);

  const entries = [
    ...sections.map((section) => ({
      title: stripTrailingTags(section.heading) || section.heading.trim(),
      filePath: section.filePath,
      line: section.startLine,
      task: false,
      completed: false,
      updatedAt: section.updatedAt,
    })),
    ...tasks.map((task) => ({
      title: stripTrailingTags(task.title) || task.title.trim(),
      filePath: task.filePath,
      line: task.lineNumber,
      task: true,
      completed: task.completed,
      updatedAt: task.updatedAt,
    })),
  ].sort(
    (left, right) =>
      (right.updatedAt ?? 0) - (left.updatedAt ?? 0) ||
      left.title.localeCompare(right.title),
  );

  return {
    label: tag.label,
    ...(tag.hubFilePaths?.length ? { hubFilePath: tag.hubFilePaths[0] } : {}),
    noteCount: sections.length + tag.filePaths.length,
    taskCount: tasks.length,
    openTaskCount: tasks.filter((task) => !task.completed).length,
    entries: entries.slice(0, limit).map((entry) => ({
      title: entry.title,
      fileName: entry.filePath.split('/').pop() ?? entry.filePath,
      filePath: entry.filePath,
      line: entry.line,
      task: entry.task,
      completed: entry.completed,
    })),
  };
}

/**
 * Counts the entries in other notes that carry any of the given tags, the way
 * the index counts a tag's own entries: each section once, a task only when
 * its section is not already counted, and a note tagged only in its front
 * matter once. The note at `filePath` is left out, as Related Notes leaves out
 * the note being edited.
 */
export function countSharedTagEntries(
  index: WorkspaceIndex,
  filePath: string,
  tagKeys: Iterable<string>,
): number {
  const sectionIds = new Set<string>();
  const taskIds = new Set<string>();
  const filePaths = new Set<string>();
  for (const tagKey of tagKeys) {
    const tag = index.tags.get(tagKey);
    if (!tag) {
      continue;
    }
    tag.sectionIds.forEach((id) => {
      const section = index.sections.get(id);
      if (section && section.filePath !== filePath) {
        sectionIds.add(id);
      }
    });
    tag.taskIds.forEach((id) => {
      const task = index.tasks.get(id);
      if (task && task.filePath !== filePath) {
        taskIds.add(id);
      }
    });
    tag.filePaths.forEach((path) => {
      if (path !== filePath) {
        filePaths.add(path);
      }
    });
  }
  const standaloneTasks = [...taskIds].filter((id) => {
    const sectionId = index.tasks.get(id)?.sectionId;
    return !sectionId || !sectionIds.has(sectionId);
  });
  return sectionIds.size + standaloneTasks.length + filePaths.size;
}

function isWithin(
  sectionId: string | undefined,
  ancestorId: string,
  sections: ReadonlyMap<string, Section>,
): boolean {
  const visited = new Set<string>();
  let current = sectionId;
  while (current && !visited.has(current)) {
    if (current === ancestorId) {
      return true;
    }
    visited.add(current);
    current = sections.get(current)?.parentSectionId;
  }
  return false;
}

function removeFirstLine(text: string): string {
  return text.split(/\r?\n/).slice(1).join('\n');
}

function removeFrontmatter(content: string): string {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return content;
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  return end < 0 ? content : lines.slice(end + 1).join('\n');
}

function limitExcerpt(text: string): { text: string; truncated: boolean } {
  const lines = text.replace(/^\s*\n/, '').trimEnd().split(/\r?\n/);
  let excerpt = lines.slice(0, PREVIEW_LINES).join('\n');
  let truncated = lines.length > PREVIEW_LINES;
  if (excerpt.length > PREVIEW_CHARACTERS) {
    excerpt = excerpt.slice(0, PREVIEW_CHARACTERS).trimEnd();
    truncated = true;
  }
  return { text: excerpt, truncated };
}
