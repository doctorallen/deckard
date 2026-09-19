import * as vscode from 'vscode';

import { stripTags } from '../../core/markdown/parser';
import { Section, WorkspaceIndex } from '../../core/types';
import {
  createNoteTitleMap,
  findWikiTargetPaths,
  noteTitle,
  normalizeHeading,
} from '../../core/workspace/backlinks';

/** A link to write, and what to say about it when it will not resolve. */
export interface WikiLinkToInsert {
  text: string;
  /**
   * Present when the link's name means more than one note, so it will not
   * resolve until one of them is renamed. The link is still worth writing:
   * the words are what the author meant, and Deckard would rather write them
   * and say so than write nothing.
   */
  warning?: string;
}

/**
 * The `[[Note#Heading]]` link to an entry in another note.
 *
 * The heading is left out when the entry is the note's own opening section,
 * because `[[Note#Note]]` says nothing `[[Note]]` does not. Tags are taken
 * out of the heading, since a link resolves against headings with their tags
 * removed, and a link carrying `#project/atlas` would read as part of the
 * heading rather than as the tag it is.
 */
export function createWikiLink(
  index: WorkspaceIndex,
  filePath: string,
  sectionId: string | undefined,
): WikiLinkToInsert {
  const title = noteTitle(filePath);
  const heading = headingFor(findHeadingSection(index, sectionId), title);
  const text = heading ? `[[${title}#${heading}]]` : `[[${title}]]`;
  const paths = findWikiTargetPaths(
    createNoteTitleMap(index),
    title,
    filePath,
  );
  return paths.length > 1
    ? {
        text,
        warning: `${paths.length} notes are called “${title}”, so this link will not resolve until one of them is renamed.`,
      }
    : { text };
}

/**
 * The heading section an entry belongs to.
 *
 * A tagged line or task is a section of its own with no heading to link to,
 * so the search climbs to the heading it was written under, which is the
 * nearest thing a `[[Note#Heading]]` link can name.
 */
function findHeadingSection(
  index: WorkspaceIndex,
  sectionId: string | undefined,
): Section | undefined {
  const visited = new Set<string>();
  let current = sectionId ? index.sections.get(sectionId) : undefined;
  while (current?.isInline && !visited.has(current.id)) {
    visited.add(current.id);
    current = current.parentSectionId
      ? index.sections.get(current.parentSectionId)
      : undefined;
  }
  return current;
}

/**
 * The heading a link should name, or nothing when naming it would add
 * nothing.
 */
function headingFor(
  section: Section | undefined,
  title: string,
): string | undefined {
  if (!section || section.isInline) {
    return undefined;
  }
  const heading = stripTags(section.heading).replace(/\s+/g, ' ').trim();
  return heading && normalizeHeading(heading) !== normalizeHeading(title)
    ? heading
    : undefined;
}

/**
 * Writes a link at the cursor of the Markdown note being edited, replacing a
 * selection when there is one.
 *
 * The editor is the one the sidebar ranked its results from, which is still
 * the active editor while the sidebar has focus, so the link lands where the
 * author was last writing.
 */
export async function insertWikiLink(
  link: WikiLinkToInsert,
): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    void vscode.window.showWarningMessage(
      'Open the Markdown note you want the link written in, then insert it.',
    );
    return false;
  }
  const inserted = await editor.edit((builder) => {
    editor.selections.forEach((selection) =>
      builder.replace(selection, link.text),
    );
  });
  if (inserted && link.warning) {
    void vscode.window.showWarningMessage(link.warning);
  }
  return inserted;
}
