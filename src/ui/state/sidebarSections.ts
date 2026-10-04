import type { OutlineNode } from './outlineState';
import type { SidebarSection, SidebarSections } from '../protocol/sidebarNotes';

/**
 * The note's headings as the Context view's Sections list draws them: the
 * outline's tree laid out in reading order, each row with how deep it is,
 * and the heading the cursor is in.
 */

/** What the list is drawn from: the outline as it stands, and what the reader set. */
export interface SectionsInput {
  roots: readonly OutlineNode[];
  filter?: { key: string; label: string };
  tags: { key: string; label: string }[];
  /** The cursor's one-based line, when the list follows it. */
  cursorLine?: number;
  showTags: boolean;
  showCounts: boolean;
}

/** The rows, in reading order, and the heading the cursor is in. */
export function buildSidebarSections(input: SectionsInput): SidebarSections {
  const rows: SidebarSection[] = [];
  const walk = (nodes: readonly OutlineNode[], depth: number): void => {
    for (const node of nodes) {
      rows.push({
        line: node.line,
        endLine: node.endLine,
        label: node.label,
        depth,
        tags: input.showTags && !node.labelFromTags ? node.tags.map(({ key, label }) => ({ key, label })) : [],
        ...(node.tasks ? { tasks: node.tasks } : {}),
        ...(node.links ? { links: node.links } : {}),
      });
      walk(node.children, depth + 1);
    }
  };
  walk(input.roots, 0);
  const activeLine = input.cursorLine === undefined ? undefined : findActiveLine(rows, input.cursorLine);
  return {
    rows,
    ...(activeLine === undefined ? {} : { activeLine }),
    ...(input.filter ? { filter: input.filter } : {}),
    tags: input.tags,
    showCounts: input.showCounts,
  };
}

/** The deepest heading whose lines hold the cursor: the last in reading order that does. */
export function findActiveLine(rows: readonly SidebarSection[], cursorLine: number): number | undefined {
  let active: number | undefined;
  for (const row of rows) {
    if (row.line <= cursorLine && cursorLine <= row.endLine) {
      active = row.line;
    }
  }
  return active;
}
