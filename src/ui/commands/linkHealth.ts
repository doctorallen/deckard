import * as vscode from 'vscode';

import { findFencedLines } from '../../core/markdown/parser';
import { measure } from '../../core/timing';
import { WorkspaceIndex } from '../../core/types';
import {
  createNoteTitleMap,
  findWikiTargetPaths,
  parseWikiTarget,
} from '../../core/workspace/backlinks';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { getExtractedNoteFileName } from './extractHeading';

/** A `[[link]]` that opens no note. */
export interface LinkProblem {
  /** Zero-based line, and the columns of the whole `[[…]]`. */
  line: number;
  startColumn: number;
  endColumn: number;
  /** The note name the link uses, as written. */
  name: string;
  /** No note has the name, or several do. */
  kind: 'missing' | 'ambiguous';
  /** The notes that share the name, when several do. */
  paths: readonly string[];
}

interface LinkHealthSource {
  readonly ready: Promise<void>;
  readonly onDidUpdate: vscode.Event<unknown>;
  getSnapshot(): WorkspaceIndex;
  getFilePath(uri: vscode.Uri): string;
  isNotesFile(uri: vscode.Uri): boolean;
  getNotesFolderUri(workspaceFolder: vscode.WorkspaceFolder): vscode.Uri;
}

/** The command the Create note quick fix runs. */
export const CREATE_LINKED_NOTE_COMMAND = 'deckard.createLinkedNote';
/** The command the Create missing notes lens runs. */
export const CREATE_MISSING_NOTES_COMMAND = 'deckard.createMissingNotes';

const WIKI_LINK = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
/** How long typing must pause before a changed note is checked again. */
const CHECK_DELAY_MS = 300;
const MISSING_NOTE = 'missing-note';
const AMBIGUOUS_NOTE = 'ambiguous-note';

/**
 * The links in a note that open no note: a name no note has, or one several
 * notes share. Links in code fences and `[[#Heading]]` links into the note
 * itself are left alone, as is a heading a note lacks, since the link still
 * opens the note.
 */
export function findLinkProblems(
  content: string,
  index: WorkspaceIndex,
  sourcePath: string,
): LinkProblem[] {
  const titles = createNoteTitleMap(index);
  const lines = content.split(/\r?\n/);
  const fenced = findFencedLines(lines);
  const problems: LinkProblem[] = [];
  lines.forEach((text, line) => {
    if (fenced.has(line)) {
      return;
    }
    for (const match of text.matchAll(WIKI_LINK)) {
      const { note } = parseWikiTarget(match[1]);
      if (!note) {
        continue;
      }
      const paths = findWikiTargetPaths(titles, note, sourcePath);
      if (paths.length === 1) {
        continue;
      }
      const startColumn = match.index ?? 0;
      problems.push({
        line,
        startColumn,
        endColumn: startColumn + match[0].length,
        name: note,
        kind: paths.length === 0 ? 'missing' : 'ambiguous',
        paths: [...paths].sort(),
      });
    }
  });
  return problems;
}

/**
 * Creates a note for a link's name in a notes folder, titled with the name,
 * unless a note with that file name is already there. Undefined when the name
 * cannot be a file name.
 */
export async function createNoteNamed(
  notesFolderUri: vscode.Uri,
  name: string,
): Promise<vscode.Uri | undefined> {
  const fileName = getExtractedNoteFileName(name);
  if (!fileName) {
    return undefined;
  }
  const noteUri = vscode.Uri.joinPath(notesFolderUri, fileName);
  try {
    await vscode.workspace.fs.stat(noteUri);
  } catch {
    await vscode.workspace.fs.createDirectory(notesFolderUri);
    await vscode.workspace.fs.writeFile(
      noteUri,
      Buffer.from(`# ${name}\n\n`, 'utf8'),
    );
  }
  return noteUri;
}

/**
 * Creates the note a link names in the notes folder of the linking note's
 * workspace, and opens it.
 */
export async function createLinkedNote(
  indexer: Pick<LinkHealthSource, 'getNotesFolderUri'>,
  documentUri: vscode.Uri,
  name: string,
): Promise<vscode.Uri | undefined> {
  const folder =
    vscode.workspace.getWorkspaceFolder(documentUri) ??
    vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showWarningMessage(
      'Open a workspace folder to create notes.',
    );
    return undefined;
  }
  const noteUri = await createNoteNamed(indexer.getNotesFolderUri(folder), name);
  if (!noteUri) {
    void vscode.window.showWarningMessage(
      `"${name}" cannot be a file name, so Deckard cannot create the note.`,
    );
    return undefined;
  }
  await vscode.window.showTextDocument(noteUri, { preview: false });
  return noteUri;
}

/**
 * The note names a note's missing links use, once each whatever their letter
 * case, that could be file names. A name several notes share is not missing:
 * another note would only make it more ambiguous.
 */
export function findMissingNoteNames(
  problems: readonly LinkProblem[],
): string[] {
  const names = new Map<string, string>();
  for (const problem of problems) {
    const key = problem.name.trim().toLocaleLowerCase();
    if (
      problem.kind === 'missing' &&
      !names.has(key) &&
      getExtractedNoteFileName(problem.name)
    ) {
      names.set(key, problem.name.trim());
    }
  }
  return [...names.values()];
}

/**
 * Creates a note for each name in the notes folder of the linking note's
 * workspace, leaving any note already there as it is, and says how many it
 * made. The notes are not opened: there may be several, and the note being
 * read is where the reader already is.
 */
export async function createMissingNotes(
  indexer: Pick<LinkHealthSource, 'getNotesFolderUri'>,
  documentUri: vscode.Uri,
  names: readonly string[],
): Promise<number> {
  const folder =
    vscode.workspace.getWorkspaceFolder(documentUri) ??
    vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showWarningMessage(
      'Open a workspace folder to create notes.',
    );
    return 0;
  }
  const notesFolderUri = indexer.getNotesFolderUri(folder);
  let created = 0;
  for (const name of names) {
    const fileName = getExtractedNoteFileName(name);
    if (
      fileName &&
      !(await exists(vscode.Uri.joinPath(notesFolderUri, fileName))) &&
      (await createNoteNamed(notesFolderUri, name))
    ) {
      created += 1;
    }
  }
  void vscode.window.showInformationMessage(
    `Created ${created} ${created === 1 ? 'note' : 'notes'} for links that named no note.`,
  );
  return created;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Marks `[[links]]` that open no note in open notes, and offers to create a
 * missing note. Only open notes are checked, so the cost follows what is on
 * screen rather than the size of the workspace.
 */
export class LinkHealth implements vscode.Disposable {
  /** Settles once the index is ready and open notes have been checked. */
  public readonly ready: Promise<void>;
  private readonly diagnostics =
    vscode.languages.createDiagnosticCollection('deckard-links');
  private readonly disposables: vscode.Disposable[] = [this.diagnostics];
  /** Checks waiting for typing to pause, by document URI. */
  private readonly pendingChecks = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  /** Before the first scan every link would look missing. */
  private isReady = false;

  public constructor(private readonly indexer: LinkHealthSource) {
    this.disposables.push(
      vscode.languages.registerCodeActionsProvider(
        { pattern: '**/*.md' },
        {
          provideCodeActions: (document, _range, context) =>
            this.provideCodeActions(document, context),
        },
        { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
      ),
      indexer.onDidUpdate(() => this.checkOpenNotes()),
      vscode.workspace.onDidOpenTextDocument((document) => this.check(document)),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length > 0) {
          this.scheduleCheck(event.document);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        clearTimeout(this.pendingChecks.get(document.uri.toString()));
        this.diagnostics.delete(document.uri);
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard.editor.linkDiagnostics')) {
          this.checkOpenNotes();
        }
      }),
    );
    this.ready = indexer.ready.then(() => {
      this.isReady = true;
      this.checkOpenNotes();
    });
  }

  public dispose(): void {
    this.pendingChecks.forEach((handle) => clearTimeout(handle));
    this.pendingChecks.clear();
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /** Checks one note's links now, or clears them when it is not a note. */
  public check(document: vscode.TextDocument): void {
    if (
      !this.isReady ||
      !isMarkdownFile(document.uri) ||
      !this.indexer.isNotesFile(document.uri) ||
      !vscode.workspace
        .getConfiguration('deckard', document.uri)
        .get<boolean>('editor.linkDiagnostics', true)
    ) {
      this.diagnostics.delete(document.uri);
      return;
    }
    const problems = measure(
      'Link diagnostics',
      () =>
        findLinkProblems(
          document.getText(),
          this.indexer.getSnapshot(),
          this.indexer.getFilePath(document.uri),
        ),
      (found) => `${found.length} problems, ${document.lineCount} lines`,
    );
    this.diagnostics.set(document.uri, problems.map(toDiagnostic));
  }

  /**
   * Offers to create the note a missing link names. The name is read back
   * from the link under the diagnostic, as the note is written now.
   */
  public provideCodeActions(
    document: vscode.TextDocument,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    return context.diagnostics
      .filter(
        (diagnostic) =>
          diagnostic.source === 'Deckard' && diagnostic.code === MISSING_NOTE,
      )
      .flatMap((diagnostic) => {
        const link = /^\[\[([^\]|]+)/.exec(document.getText(diagnostic.range));
        const name = link ? parseWikiTarget(link[1]).note : '';
        if (!name || !getExtractedNoteFileName(name)) {
          return [];
        }
        const title = `Create note "${name}"`;
        const action = new vscode.CodeAction(
          title,
          vscode.CodeActionKind.QuickFix,
        );
        action.diagnostics = [diagnostic];
        action.isPreferred = true;
        action.command = {
          command: CREATE_LINKED_NOTE_COMMAND,
          title,
          arguments: [document.uri.toString(), name],
        };
        return [action];
      });
  }

  private checkOpenNotes(): void {
    vscode.workspace.textDocuments.forEach((document) => this.check(document));
  }

  private scheduleCheck(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    clearTimeout(this.pendingChecks.get(key));
    this.pendingChecks.set(
      key,
      setTimeout(() => {
        this.pendingChecks.delete(key);
        this.check(document);
      }, CHECK_DELAY_MS),
    );
  }
}

function toDiagnostic(problem: LinkProblem): vscode.Diagnostic {
  const range = new vscode.Range(
    problem.line,
    problem.startColumn,
    problem.line,
    problem.endColumn,
  );
  const diagnostic =
    problem.kind === 'missing'
      ? new vscode.Diagnostic(
          range,
          `No note is named "${problem.name}" yet.`,
          vscode.DiagnosticSeverity.Information,
        )
      : new vscode.Diagnostic(
          range,
          `"${problem.name}" names ${problem.paths.length} notes, so the link opens none: ${problem.paths.join(', ')}.`,
          vscode.DiagnosticSeverity.Warning,
        );
  diagnostic.source = 'Deckard';
  diagnostic.code = problem.kind === 'missing' ? MISSING_NOTE : AMBIGUOUS_NOTE;
  return diagnostic;
}
