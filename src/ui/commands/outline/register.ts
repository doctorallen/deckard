import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { OutlineTreeProvider, pickOutlineTag } from '../../views/outlineTree';
import { asOutlineNode } from '../commandArguments';
import { renameIndexedTag } from '../renameTag';
import { registerCommand } from '../runCommand';

/**
 * The Outline and its sections: revealing a heading, a heading's tags, Focus
 * Section and Unfold All Sections, and the Outline's tag filter.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer, sectionFocus } = services;
  const { outline } = services.views;
  const searchPanels = services.pages.search;
  context.subscriptions.push(
    registerCommand(
      'deckard.outline.revealSection',
      (node?: unknown) => {
        const outlineNode = asOutlineNode(node);
        return outlineNode ? outline.revealSection(outlineNode) : undefined;
      },
    ),
    registerCommand(
      'deckard.outline.openTagOverview',
      async (node?: unknown) => {
        const tagKey = await pickOutlineTag(
          asOutlineNode(node),
          'Choose a tag from this heading',
        );
        if (tagKey) {
          await searchPanels.show(tagKey);
        }
      },
    ),
    registerCommand(
      'deckard.outline.renameTag',
      async (node?: unknown) => {
        const tagKey = await pickOutlineTag(
          asOutlineNode(node),
          'Choose a tag to rename',
        );
        if (tagKey) {
          await renameIndexedTag(indexer, tagKey, services.writes.tags);
        }
      },
    ),
    registerCommand('deckard.focusSection', async (node?: unknown) => {
      const outlineNode = asOutlineNode(node);
      if (outlineNode) {
        await outline.revealSection(outlineNode);
      }
      await sectionFocus.focus(outlineNode?.line);
    }),
    registerCommand('deckard.unfoldAllSections', () =>
      sectionFocus.unfoldAll(),
    ),
    registerCommand('deckard.outline.filterByTag', (node?: unknown) =>
      filterOutlineByTag(outline, node),
    ),
    registerCommand('deckard.outline.clearTagFilter', () =>
      outline.setTagFilter(undefined),
    ),
  );
}

/**
 * Filters the Outline to the headings that carry one tag: a heading's own
 * tag when run from one in the tree, else any tag in the note, chosen from a
 * list.
 */
async function filterOutlineByTag(outline: OutlineTreeProvider, node?: unknown): Promise<void> {
  const outlineNode = asOutlineNode(node);
  if (outlineNode) {
    const key = await pickOutlineTag(outlineNode, 'Choose a tag to filter the Outline by');
    const tag = outlineNode.tags.find((candidate) => candidate.key === key);
    if (tag) {
      outline.setTagFilter(tag);
    }
    return;
  }
  const tags = outline.listTags();
  if (tags.length === 0) {
    void vscode.window.showInformationMessage('No heading in this note carries a tag to filter by.');
    return;
  }
  const chosen = await vscode.window.showQuickPick(
    tags.map((tag) => ({ label: tag.label, tag })),
    { placeHolder: 'Show only the headings that carry a tag' },
  );
  if (chosen) {
    outline.setTagFilter(chosen.tag);
  }
}
