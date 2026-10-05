import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import { OutlineTreeProvider, pickOutlineTag } from '../../views/outlineTree';
import { asOutlineNode } from '../commandArguments';
import { registerCommand } from '../runCommand';

/**
 * A note's sections, which the Context view lists: Focus Section and Unfold
 * All Sections, and the Sections list's tag filter.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { sectionFocus } = services;
  const { outline } = services.views;
  context.subscriptions.push(
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
 * Narrows the Sections list to the headings that carry one tag, chosen
 * from the tags the note's headings carry.
 */
async function filterOutlineByTag(outline: OutlineTreeProvider, node?: unknown): Promise<void> {
  const outlineNode = asOutlineNode(node);
  if (outlineNode) {
    const key = await pickOutlineTag(outlineNode, 'Choose a tag to show only its sections');
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
    { placeHolder: 'Show only the sections that carry a tag' },
  );
  if (chosen) {
    outline.setTagFilter(chosen.tag);
  }
}
