/**
 * The nodes of the notes graph, before any edge joins them: one for every
 * note (a section that is a note of its own, or a note tagged in its front
 * matter as a whole), every task, and every note that has no sections but
 * tags or links, each with
 * the Wiki links it writes and where it sits in its note's outline, and one
 * for every tag.
 */
import { extractNoteLinks, stripTags } from '../markdown/parser';
import { NotesGraphNode, ParsedFile, Section, WorkspaceIndex } from '../model';
import { getFileName } from '../../shared/paths';
import { entryIdOf, fileEntryId, isEntrySection } from '../markdown/noteEntries';
import { getEntryParts, isFileEntry } from '../index/noteEntryIndex';

/** A node that stands for something written, with what it links to. */
export interface GraphSource {
  node: NotesGraphNode;
  links: string[];
  sectionId?: string;
  parentSectionId?: string;
}

/**
 * Every section, task, and metadata-only note as a node, in the index's
 * order: sections, then tasks, then notes that hold no heading but carry
 * front-matter tags or links.
 */
export function createGraphSources(index: WorkspaceIndex): GraphSource[] {
  const sources: GraphSource[] = [];

  // One node per note (noteEntries.ts): an untagged heading under a tagged
  // one is part of its node, its links with it, and a note tagged in its
  // front matter that owns untagged headings is one node, the file's.
  const parts = getEntryParts(index);
  const ownerOf = (sectionId: string | undefined): string | undefined => {
    const section = sectionId ? index.sections.get(sectionId) : undefined;
    return section ? entryIdOf(section) : undefined;
  };
  for (const section of index.sections.values()) {
    if (!isEntrySection(section)) {
      continue;
    }
    const owned = parts.get(section.id) ?? [section];
    sources.push({
      node: {
        id: `section:${section.id}`,
        kind: 'note',
        title:
          stripTags(section.heading).trim() || getFileName(section.filePath),
        filePath: section.filePath,
        line: section.startLine,
        tagKeys: getGraphTagKeys(
          section.tags,
          section.parentSectionId,
          index.sections,
        ),
        degree: 0,
      },
      links: [...new Set(owned.flatMap((part) => part.links))],
      sectionId: section.id,
      parentSectionId: ownerOf(section.parentSectionId),
    });
  }

  for (const task of index.tasks.values()) {
    sources.push({
      node: {
        id: `task:${task.id}`,
        kind: 'task',
        title: stripTags(task.title).trim() || 'Untitled task',
        filePath: task.filePath,
        line: task.lineNumber,
        tagKeys: getGraphTagKeys(
          task.tags,
          task.sectionId,
          index.sections,
        ),
        degree: 0,
      },
      links: extractNoteLinks(task.sourceLineText, task.filePath),
      parentSectionId: task.entryId ?? task.sectionId,
    });
  }

  for (const file of index.files.values()) {
    const source = createFileSource(file, parts);
    if (source) {
      sources.push(source);
    }
  }

  return sources;
}

/**
 * A note as a node of its own: one with no headings that carries
 * front-matter tags or links, or one tagged in its front matter that owns
 * untagged headings, as a whole note does (noteEntries.ts).
 */
function createFileSource(file: ParsedFile, parts: ReadonlyMap<string, Section[]>): GraphSource | undefined {
  const wholeNote = file.sections.length > 0 && isFileEntry(file);
  if (
    (file.sections.length > 0 && !wholeNote) ||
    (file.frontmatterTags.length === 0 && file.links.length === 0)
  ) {
    return undefined;
  }
  return {
    node: {
      id: `file:${file.filePath}`,
      kind: 'note',
      title: getFileName(file.filePath).replace(/\.md$/i, ''),
      filePath: file.filePath,
      line: 1,
      tagKeys: uniqueSorted(file.frontmatterTags.map((tag) => tag.key)),
      degree: 0,
    },
    links: wholeNote
      ? [...new Set((parts.get(fileEntryId(file.filePath)) ?? []).flatMap((part) => part.links))]
      : file.links,
    // The untagged headings and tasks the note owns hang from it.
    sectionId: fileEntryId(file.filePath),
  };
}

/** A node for every indexed tag, keyed by the tag. */
export function createTagNodes(
  index: WorkspaceIndex,
): Map<string, NotesGraphNode> {
  const nodes = new Map<string, NotesGraphNode>();
  for (const tag of index.tags.values()) {
    nodes.set(tag.key, {
      id: `tag:${tag.key}`,
      kind: 'tag',
      title: tag.label,
      tagKeys: [],
      degree: 0,
    });
  }
  return nodes;
}

/** Marks the parked entries, tasks, and notes, and the tags only they carry. */
export function markParked(
  index: WorkspaceIndex,
  sources: GraphSource[],
  tagNodes: Map<string, NotesGraphNode>,
): void {
  const parked = index.parked;
  if (!parked) {
    return;
  }
  sources.forEach(({ node }) => {
    const [kind, ...rest] = node.id.split(':');
    const id = rest.join(':');
    if (isParkedSource(parked, kind, id)) {
      node.parked = true;
    }
  });
  parked.tags.forEach((key) => {
    const node = tagNodes.get(key);
    if (node) {
      node.parked = true;
    }
  });
}

/** Whether the section, task, or note a node's id names is parked. */
function isParkedSource(
  parked: NonNullable<WorkspaceIndex['parked']>,
  kind: string,
  id: string,
): boolean {
  if (kind === 'section') {
    return parked.sections.has(id);
  }
  if (kind === 'task') {
    return parked.tasks.has(id);
  }
  return parked.files.has(id);
}

/** The values once each, in code-unit order. */
function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * An entry's own tags and the heading tags of every section above it, since
 * a heading's tag describes everything written under it.
 */
function getGraphTagKeys(
  directTags: readonly string[],
  parentSectionId: string | undefined,
  sections: ReadonlyMap<string, Section>,
): string[] {
  const keys = new Set(directTags);
  const visited = new Set<string>();
  let currentId = parentSectionId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const parent = sections.get(currentId);
    if (!parent) {
      break;
    }
    parent.headingTags?.forEach((tag) => keys.add(tag.key));
    currentId = parent.parentSectionId;
  }
  return [...keys].sort();
}
