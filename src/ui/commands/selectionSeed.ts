import * as vscode from 'vscode';

import { isTaskLineOf, STATUS_MARKS, TaskLineShape } from '../../domain/markdown/lineShapes';
import { parseTaskDraft, formatTaskDraft } from '../../domain/markdown/taskDraft';
import { createWikiLink } from './insertLink';
import { createPinForLine, findPinnedSection } from '../../domain/notes/pins';
import { WorkspaceIndex } from '../../domain/model';
import { TaskMetadataFormat } from '../../domain/markdown/taskFields';

/** The longest selection, in characters, that Find and Add Task start from. */
export const SHORT_SELECTION_LIMIT = 120;

/**
 * Find and Add Task start from the words selected in the editor, when they
 * are a few words on one line: something to search for or write down, not
 * a passage, which Move to… is for. Undefined for no selection, one over
 * more than a line or SHORT_SELECTION_LIMIT, or only whitespace.
 */
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

/** What Add Task starts from: the selected words, and a link back to them. */
export interface CaptureSeed {
  text: string;
  /** `[[Note#Heading]]` for the heading the words were selected under. */
  link?: string;
}

/**
 * What Add Task starts from in this editor: the short selection, with a link
 * to the heading it was selected under when the editor holds an indexed
 * note. Undefined when there is no short selection.
 */
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

/** A line the link goes into as part of a task's words rather than after them. */
const SEEDED_TASK: TaskLineShape = { indent: 'whitespace', marks: STATUS_MARKS };

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
  if (!isTaskLineOf(line, SEEDED_TASK)) {
    return `${line.replace(/[ \t]+$/, '')} ${link}`;
  }
  const draft = parseTaskDraft(line, format);
  return formatTaskDraft({ ...draft, description: `${draft.description.trim()} ${link}` });
}
