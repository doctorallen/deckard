import * as vscode from 'vscode';

import { readEditorToggle } from '../providers/editorToggles';import { reportFailure, reportNeedsFolder } from './notify';

import { pluralize } from '../../shared/text';
import { measure } from '../../shared/timing';
import { findLinkProblems, LinkProblem } from '../../domain/links/linkProblems';
import { parseWikiTarget } from '../../domain/index/backlinks';
import { getExtractedNoteFileName } from '../../domain/markdown/noteNames';
import { isMarkdownFile } from '../../core/workspace/scanner';
import {
  onIndexUpdateInTurn,
  VIEW_PRIORITY,
} from '../../core/workspace/publishing';
import { LinkNoteService } from '../../services/linkService';
import { vscodeLinkNotes } from './linkMaintenancePorts';
import { WorkspaceIndex } from '../../domain/model';

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

/** How long typing must pause before a changed note is checked again. */
const CHECK_DELAY_MS = 300;
const MISSING_NOTE = 'missing-note';
const AMBIGUOUS_NOTE = 'ambiguous-note';

/**
 * Creates a note for a link's name in a notes folder, titled with the name,
 * unless a note with that file name is already there. Undefined when the name
 * cannot be a file name.
 */
export async function createNoteNamed(
  notesFolderUri: vscode.Uri,
  name: string,
  notes: LinkNoteService<vscode.Uri> = vscodeLinkNotes,
): Promise<vscode.Uri | undefined> {
  const created = await notes.createNoteNamed(notesFolderUri, name);
  return created.kind === 'invalid-name' ? undefined : created.uri;
}

/**
 * Creates the note a link names in the notes folder of the linking note's
 * workspace, and opens it.
 */
export async function createLinkedNote(
  indexer: Pick<LinkHealthSource, 'getNotesFolderUri'>,
  documentUri: vscode.Uri,
  name: string,
  notes: LinkNoteService<vscode.Uri> = vscodeLinkNotes,
): Promise<vscode.Uri | undefined> {
  const folder =
    vscode.workspace.getWorkspaceFolder(documentUri) ??
    vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void reportNeedsFolder();
    return undefined;
  }
  const noteUri = await createNoteNamed(indexer.getNotesFolderUri(folder), name, notes);
  if (!noteUri) {
    void reportFailure({
      outcome: `"${name}" cannot be a file name, so Deckard did not create the note.`,
    });
    return undefined;
  }
  await vscode.window.showTextDocument(noteUri, { preview: false });
  return noteUri;
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
  options: { report?: boolean; notes?: LinkNoteService<vscode.Uri> } = {},
): Promise<number> {
  const folder =
    vscode.workspace.getWorkspaceFolder(documentUri) ??
    vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void reportNeedsFolder();
    return 0;
  }
  const notes = options.notes ?? vscodeLinkNotes;
  const created = await notes.createMissingNotes(indexer.getNotesFolderUri(folder), names);
  if (options.report !== false) {
    reportCreatedNotes(created);
  }
  return created;
}

/** Says how many notes were made for links that named no note. */
export function reportCreatedNotes(created: number): void {
  void vscode.window.showInformationMessage(
    `Created ${pluralize(created, 'note')} for links that named no note.`,
  );
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

  /** Checks open notes against `indexer`'s notes once it is ready, and as they change. */
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
      onIndexUpdateInTurn(
        indexer,
        { name: 'link checks', priority: () => VIEW_PRIORITY.visible },
        () => this.checkOpenNotes(),
      ),
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

  /** Stops checking, and clears the marks and the checks still waiting. */
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
      !readEditorToggle('linkDiagnostics', document.uri)
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

  /** Checks every note open in an editor. */
  private checkOpenNotes(): void {
    vscode.workspace.textDocuments.forEach((document) => this.check(document));
  }

  /** Checks a note once its typing has paused for CHECK_DELAY_MS, replacing a check still waiting. */
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

/** A problem link as a diagnostic: information for a missing note, a warning for an ambiguous name. */
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
