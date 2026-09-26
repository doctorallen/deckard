import * as vscode from 'vscode';

import { parseTaskDraft, formatTaskDraft } from '../../core/markdown/taskDraft';
import { TaskMetadataFormat } from '../../core/markdown/taskMetadata';
import { WorkspaceIndex } from '../../core/types';
import { createPinForLine, findPinnedSection } from '../state/pinnedNotes';
import { createWikiLink } from './insertLink';

/**
 * Find and Capture start from the words selected in the editor, when they
 * are a few words on one line: something to search for or write down, not
 * a passage, which Move to… is for.
 */
export const SHORT_SELECTION_LIMIT = 120;

export function shortSelection(
  editor: Pick<vscode.TextEditor, 'document' | 'selection'> | undefined,
): string | undefined {
  const selection = editor?.selection;
  if (!editor || !selection || selection.isEmpty || selection.start.line !== selection.end.line) {
    return undefined;
  }
  const text = editor.document.getText(selection);
  return text.trim() && text.length <= SHORT_SELECTION_LIMIT ? text.trim() : undefined;
}

/** What Capture starts from: the selected words, and a link back to them. */
export interface CaptureSeed {
  text: string;
  /** `[[Note#Heading]]` for the heading the words were selected under. */
  link?: string;
}

export function captureSeed(
  editor: Pick<vscode.TextEditor, 'document' | 'selection'> | undefined,
  index: WorkspaceIndex,
  filePathOf: (uri: vscode.Uri) => string | undefined,
): CaptureSeed | undefined {
  const text = shortSelection(editor);
  if (!text || !editor) {
    return undefined;
  }
  const filePath = filePathOf(editor.document.uri);
  const file = filePath ? index.files.get(filePath) : undefined;
  if (!filePath || !file) {
    return { text };
  }
  const pin = createPinForLine(index, filePath, editor.selection.start.line + 1);
  const section = pin?.heading ? findPinnedSection(file.sections, pin) : undefined;
  return { text, link: createWikiLink(index, filePath, section?.id).text };
}

/**
 * A captured line with a link back to where it came from: after the words
 * and before any task metadata, so the date and priority stay last, as
 * Tasks reads them; at the end of a plain note line.
 */
export function withSourceLink(
  line: string,
  link: string | undefined,
  format: TaskMetadataFormat = 'emoji',
): string {
  if (!link) {
    return line;
  }
  if (!/^\s*[-*+][ \t]+\[[ xX]\]/.test(line)) {
    return `${line.replace(/[ \t]+$/, '')} ${link}`;
  }
  const draft = parseTaskDraft(line, format);
  return formatTaskDraft({ ...draft, description: `${draft.description.trim()} ${link}` });
}
