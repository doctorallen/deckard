import * as vscode from 'vscode';

import type { Services } from '../../../composition/services';
import type { WorkspaceIndex } from '../../../domain/model';
import { linkItHere, notSameKey } from '../../../domain/ranking/writtenBefore';
import { createWikiLink } from '../insertLink';
import { describeRejectedEdit, noteName, reportFailure, reportStale } from '../notify';
import { registerCommand } from '../runCommand';

/**
 * You've written this before's commands, which its hover and Context run:
 * Link it here, which writes a link to the older line at the end of the
 * line being written, and Not the same, which sets the pair aside for good
 * (docs/implementation/39-written-before.md). Open is `deckard.openNote`.
 */
export function register(context: vscode.ExtensionContext, services: Services): void {
  const { indexer } = services;
  const { memory } = services.writtenBefore;
  context.subscriptions.push(
    registerCommand('deckard.writtenBefore.linkHere', (argument?: unknown) => {
      const asked = readLinkHereArgument(argument);
      return asked ? linkHere(indexer.getSnapshot(), asked.place, asked.target) : undefined;
    }),
    registerCommand('deckard.writtenBefore.notSame', (lineText?: unknown, matchText?: unknown) =>
      typeof lineText === 'string' && typeof matchText === 'string' ? memory.reject(notSameKey(lineText, { text: matchText })) : undefined,
    ),
  );
}

/**
 * Link it here's argument, as the hover's link and Context send it: the
 * line, its note, and its words when the older line was found, and the
 * older line's note and line. Undefined for anything else.
 */
function readLinkHereArgument(value: unknown): { place: LinkPlace; target: { filePath: string; line: number } } | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const { documentUri, line, lineText, filePath, targetLine } = value as Record<string, unknown>;
  return typeof documentUri === 'string' && typeof line === 'number' && typeof lineText === 'string' && typeof filePath === 'string' && typeof targetLine === 'number'
    ? { place: { documentUri: vscode.Uri.parse(documentUri), line, lineText }, target: { filePath, line: targetLine } }
    : undefined;
}

/** The line a link is written on, as it was when the older line was found. */
export interface LinkPlace {
  documentUri: vscode.Uri;
  /** Zero-based. */
  line: number;
  lineText: string;
}

/**
 * Link it here: appends ` (see [[2026-03-12#Rates desk standup]])` to the
 * line, the link to the heading the older line is under, in Deckard's link
 * format. Nothing is written when the line has changed since.
 */
export async function linkHere(index: WorkspaceIndex, place: LinkPlace, target: { filePath: string; line: number }): Promise<boolean> {
  const document = await vscode.workspace.openTextDocument(place.documentUri);
  if (place.line >= document.lineCount || document.lineAt(place.line).text !== place.lineText) {
    void reportStale([place.documentUri]);
    return false;
  }
  const section = index.files
    .get(target.filePath)
    ?.sections.filter((candidate) => candidate.startLine <= target.line && candidate.endLine >= target.line)
    .sort((left, right) => right.startLine - left.startLine)[0];
  const link = createWikiLink(index, target.filePath, section?.id);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(place.documentUri, document.lineAt(place.line).range, linkItHere(place.lineText, link.text));
  if (!(await vscode.workspace.applyEdit(edit))) {
    void reportFailure(describeRejectedEdit(noteName(place.documentUri)));
    return false;
  }
  if (link.warning) {
    void vscode.window.showWarningMessage(link.warning);
  }
  return true;
}
