import * as vscode from 'vscode';

import { readEditorToggle } from './editorToggles';
import { isMarkdownFile } from '../../core/workspace/scanner';
import type { NoteFiles } from '../../core/workspace/indexReader';
import { findFencedLines } from '../../domain/markdown/lineShapes';
import { findSlashQuery, isOutsideProse, listSlashChoices, SlashChoice, templateToSnippet } from '../../domain/markdown/slashMenu';
import { getTemplateVariables } from '../../domain/notes/templates';
import { formatLocalDate } from '../../domain/notes/periodicNotes';
import { getFileName } from '../../shared/paths';
import { listTemplates } from '../commands/templates';

/** The most templates the menu lists, so a large templates folder does not bury the rest. */
const TEMPLATE_LIMIT = 30;

/** What the menu reads from the indexer: which files are notes, and where the templates are. */
type SlashMenuIndexSource = Pick<NoteFiles<vscode.Uri>, 'getTemplatesFolderUri'> & {
  isNotesFile?(uri: vscode.Uri): boolean;
};

/**
 * The `/` menu: a `/` typed alone at the start of a line in a note offers
 * what to write there, from a task or a heading to a query block, a table
 * of notes, or one of the templates, as Notion's menu does. A `/` anywhere
 * else is writing, and offers nothing; inside a task, the task metadata
 * suggestions answer it instead.
 */
export class SlashMenuProvider implements vscode.Disposable {
  private readonly registrations: vscode.Disposable[] = [];

  /** Takes the notes and templates it offers from; nothing is registered until `register`. */
  public constructor(
    private readonly indexer: SlashMenuIndexSource,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Registers the menu for Markdown files, after `/`, and returns the provider. */
  public register(): this {
    this.registrations.push(
      vscode.languages.registerCompletionItemProvider(
        { pattern: '**/*.md' },
        { provideCompletionItems: (document, position) => this.provideCompletionItems(document, position) },
        '/',
      ),
    );
    return this;
  }

  /** Unregisters the menu. */
  public dispose(): void {
    this.registrations.forEach((registration) => registration.dispose());
  }

  /**
   * The menu, after a `/` alone at a line's start in a note, outside fenced
   * code; nothing while `deckard.editor.slashMenu` is off.
   */
  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[]> {
    if (
      !readEditorToggle('slashMenu', document.uri) ||
      !isMarkdownFile(document.uri) ||
      !(this.indexer.isNotesFile?.(document.uri) ?? true)
    ) {
      return [];
    }
    const query = findSlashQuery(document.lineAt(position.line).text.slice(0, position.character));
    if (!query) {
      return [];
    }
    const lines = document.getText().split(/\r?\n/);
    if (findFencedLines(lines).has(position.line) || isOutsideProse(lines, position.line)) {
      return [];
    }
    const range = new vscode.Range(position.line, query.start, position.line, position.character);
    const now = this.now();
    const choices = [
      ...listSlashChoices({
        today: formatLocalDate(now),
        time: {
          local: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
          utc: now.toISOString().slice(11, 16),
        },
      }),
      ...(await this.listTemplateChoices(document, now)),
    ];
    return choices.map((choice, index) => toCompletionItem(choice, range, index));
  }

  /**
   * Each template in the note's folder's templates folder, written with the
   * note's title, today's date, and the time filled in, and each question
   * it asks a tab stop. None when there is no templates folder.
   */
  private async listTemplateChoices(document: vscode.TextDocument, now: Date): Promise<SlashChoice[]> {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const templatesUri = folder ? this.indexer.getTemplatesFolderUri(folder) : undefined;
    if (!templatesUri) {
      return [];
    }
    const title = (getFileName(document.uri.path) ?? '').replace(/\.md$/i, '');
    const variables = getTemplateVariables(title, now);
    const uris = (await listTemplates(templatesUri)).slice(0, TEMPLATE_LIMIT);
    const choices = await Promise.all(
      uris.map(async (uri): Promise<SlashChoice | undefined> => {
        try {
          const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
          const name = uri.path.slice(templatesUri.path.length + 1).replace(/\.md$/i, '');
          return {
            label: `Template: ${name}`,
            detail: `Writes ${name} from your templates here`,
            keywords: ['template', name],
            snippet: templateToSnippet(text, variables),
          };
        } catch {
          return undefined;
        }
      }),
    );
    return choices.filter((choice): choice is SlashChoice => choice !== undefined);
  }
}

/**
 * A choice as the completion that writes it over the `/word` typed, found
 * by its label and keywords, kept at its place in the list, and opening
 * suggestions after it when it leaves a link's name to choose.
 */
function toCompletionItem(choice: SlashChoice, range: vscode.Range, index: number): vscode.CompletionItem {
  const item = new vscode.CompletionItem(
    { label: choice.label, description: choice.detail },
    vscode.CompletionItemKind.Snippet,
  );
  item.insertText = new vscode.SnippetString(choice.snippet);
  item.filterText = `/${[choice.label, ...(choice.keywords ?? [])].join(' ')}`;
  item.range = range;
  item.sortText = String(index).padStart(3, '0');
  if (choice.suggestAfter) {
    item.command = { title: 'Suggest', command: 'editor.action.triggerSuggest' };
  }
  return item;
}
