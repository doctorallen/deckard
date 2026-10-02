import { stripTags } from '../../domain/markdown/parser';
import { ParsedFile, Section, TagReference } from '../../core/types';

/**
 * One heading in the document outline.
 *
 * The label is display text only: the `#` markers never reach it because the
 * parser stores heading text without them, and the tags are lifted out of the
 * title so they can be shown as their own column.
 */
export interface OutlineNode {
  /**
   * Identity that survives editing.
   *
   * Built from the slugged heading path rather than the section id, which
   * hashes the line number and would therefore reset the tree's expand and
   * collapse state on every keystroke.
   */
  id: string;
  label: string;
  tags: TagReference[];
  /** True when the heading was nothing but tags and they became the label. */
  labelFromTags: boolean;
  level: number;
  /** One-based line of the heading itself. */
  line: number;
  /** One-based last line the heading owns, including its children. */
  endLine: number;
  children: OutlineNode[];
  /** The tasks under the heading, sub-headings included, when it has any. */
  tasks?: { done: number; total: number };
  /** How many links in other notes name this heading, when any do. */
  links?: number;
}

/** How buildOutline reads a note's tags and where it counts links to each heading from. */
export interface OutlineOptions {
  /** The configured people marker, so stripping matches how tags were parsed. */
  personMarker?: string;
  /** Include front-matter tags that every heading in the file inherits. */
  inheritedTags?: boolean;
  /** Where links to a heading are counted from, with the note's own path. */
  backlinks?: { toHeading(filePath: string, heading: string): readonly unknown[] };
  filePath?: string;
}

const untitledHeadingLabel = 'Untitled heading';

/**
 * Projects a parsed file into the heading tree shown in the outline view.
 *
 * Untagged headings are kept so tagged children stay under the structure the
 * author wrote, and inline tagged entries are left out because they are note
 * content rather than document structure.
 */
export function buildOutline(
  file: ParsedFile,
  options: OutlineOptions = {},
): OutlineNode[] {
  const headings = file.sections
    .filter((section) => !section.isInline)
    .slice()
    .sort((left, right) => left.startLine - right.startLine);
  const roots: OutlineNode[] = [];
  const ancestors: OutlineNode[] = [];
  const usedIds = new Map<string, number>();

  headings.forEach((section) => {
    const node = createNode(section, file, options);
    while (
      ancestors.length > 0 &&
      ancestors[ancestors.length - 1].level >= node.level
    ) {
      ancestors.pop();
    }

    const parent = ancestors[ancestors.length - 1];
    node.id = createNodeId(parent?.id, node.label, usedIds);
    (parent ? parent.children : roots).push(node);
    ancestors.push(node);
  });

  return roots;
}

/**
 * Finds the deepest heading that owns a one-based source line.
 *
 * Child ranges are contained by their parent's, so the first root that matches
 * is the only branch worth descending.
 */
export function findOutlineNodeAt(
  nodes: readonly OutlineNode[],
  line: number,
): OutlineNode | undefined {
  for (const node of nodes) {
    if (line < node.line || line > node.endLine) {
      continue;
    }
    return findOutlineNodeAt(node.children, line) ?? node;
  }

  return undefined;
}

/**
 * Renders a heading's tags as the text shown beside its label.
 *
 * A heading whose title was only tags already shows them as its label, so
 * repeating them beside it would say the same thing twice.
 */
export function formatOutlineTags(node: OutlineNode): string {
  return node.labelFromTags
    ? ''
    : node.tags.map((tag) => tag.label).join(' ');
}

/**
 * What the Outline writes beside a heading: its tasks done of all, the links
 * that name it, and its tags, as `2/5 · ↩3 · #project/atlas`, each part left
 * out when it is empty or turned off.
 */
export function formatOutlineDescription(
  node: OutlineNode,
  show: { tags: boolean; counts: boolean },
): string {
  const parts: string[] = [];
  if (show.counts && node.tasks) {
    parts.push(`${node.tasks.done}/${node.tasks.total}`);
  }
  if (show.counts && node.links) {
    parts.push(`↩${node.links}`);
  }
  const tags = show.tags ? formatOutlineTags(node) : '';
  if (tags) {
    parts.push(tags);
  }
  return parts.join(' · ');
}

/**
 * The headings that carry a tag, or a tag under it — `#project` keeps
 * `#project/atlas` — with their ancestors kept for structure. Ids are
 * unchanged, so the tree keeps what it had expanded.
 */
export function filterOutline(nodes: readonly OutlineNode[], tagKey: string): OutlineNode[] {
  const carries = (node: OutlineNode) =>
    node.tags.some((tag) => tag.key === tagKey || tag.key.startsWith(`${tagKey}/`));
  return nodes.flatMap((node) => {
    const children = filterOutline(node.children, tagKey);
    return carries(node) || children.length > 0 ? [{ ...node, children }] : [];
  });
}

/** Every tag written on a note's headings, once each, in order. */
export function collectOutlineTags(nodes: readonly OutlineNode[]): TagReference[] {
  const seen = new Map<string, TagReference>();
  const visit = (list: readonly OutlineNode[]) =>
    list.forEach((node) => {
      node.tags.forEach((tag) => {
        if (!seen.has(tag.key)) {
          seen.set(tag.key, tag);
        }
      });
      visit(node.children);
    });
  visit(nodes);
  return [...seen.values()];
}

/** The counts beside a heading, spelled out for its tooltip. */
export function describeOutlineCounts(node: OutlineNode): string[] {
  const lines: string[] = [];
  if (node.tasks) {
    lines.push(`${node.tasks.done} of ${node.tasks.total} ${node.tasks.total === 1 ? 'task' : 'tasks'} done`);
  }
  if (node.links) {
    lines.push(node.links === 1 ? 'Linked once' : `Linked ${node.links} times`);
  }
  return lines;
}

/**
 * Maps every node id to its parent so the view can reveal a node directly.
 */
export function mapOutlineParents(
  nodes: readonly OutlineNode[],
  parent?: OutlineNode,
  parents = new Map<string, OutlineNode>(),
): Map<string, OutlineNode> {
  nodes.forEach((node) => {
    if (parent) {
      parents.set(node.id, parent);
    }
    mapOutlineParents(node.children, node, parents);
  });

  return parents;
}

function createNode(
  section: Section,
  file: ParsedFile,
  options: OutlineOptions,
): OutlineNode {
  const tags = collectTags(section, file, options);
  const strippedHeading = stripTags(section.heading, options.personMarker);
  const tagLabel = tags.map((tag) => tag.label).join(' ');
  const labelFromTags = strippedHeading.length === 0 && tagLabel.length > 0;
  const under = file.tasks.filter(
    (task) => task.lineNumber > section.startLine && task.lineNumber <= section.endLine,
  );
  const links =
    options.backlinks && options.filePath
      ? options.backlinks.toHeading(options.filePath, section.heading).length
      : 0;

  return {
    ...(under.length > 0
      ? { tasks: { done: under.filter((task) => task.completed).length, total: under.length } }
      : {}),
    ...(links > 0 ? { links } : {}),
    id: '',
    label: labelFromTags
      ? tagLabel
      : strippedHeading || section.heading.trim() || untitledHeadingLabel,
    tags,
    labelFromTags,
    level: section.headingLevel,
    line: section.startLine,
    endLine: section.endLine,
    children: [],
  };
}

/**
 * Keeps tags written on the heading ahead of the ones it merely inherits.
 */
function collectTags(
  section: Section,
  file: ParsedFile,
  options: OutlineOptions,
): TagReference[] {
  const tags = [...(section.headingTags ?? [])];
  if (!options.inheritedTags) {
    return tags;
  }

  const keys = new Set(tags.map((tag) => tag.key));
  file.frontmatterTags.forEach((tag) => {
    if (keys.has(tag.key)) {
      return;
    }
    keys.add(tag.key);
    tags.push(tag);
  });

  return tags;
}

/**
 * Names a node by its position in the heading path.
 *
 * Identically named siblings are disambiguated by occurrence so two "Notes"
 * headings under one parent do not share expand and collapse state.
 */
function createNodeId(
  parentId: string | undefined,
  label: string,
  usedIds: Map<string, number>,
): string {
  const base = parentId ? `${parentId}/${slug(label)}` : slug(label);
  const seen = usedIds.get(base) ?? 0;
  usedIds.set(base, seen + 1);
  return seen === 0 ? base : `${base}~${seen + 1}`;
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'heading'
  );
}
