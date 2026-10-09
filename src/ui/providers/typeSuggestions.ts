import * as vscode from 'vscode';

import { isMarkdownFile } from '../../core/workspace/scanner';
import { whenPublished } from '../../core/workspace/publishing';
import type { ParsedFile, WorkspaceIndex } from '../../domain/model';
import { getTypeIndex } from '../../domain/types/typeIndex';
import {
  findFrontmatterCompletionContext,
  findKindCellContext,
  listFieldKeyCompletions,
  listFieldValueCompletions,
  listKindCompletions,
  listRowsCompletions,
  TypeCompletion,
} from '../state/typeCompletions';
import { findRowTypes } from '../state/typeRows';

/** What typed-field completion reads from the indexer. */
interface TypeSuggestionSource {
  readonly ready: Promise<void>;
  readonly published?: Promise<void>;
  getSnapshot(): WorkspaceIndex;
  isNotesFile(uri: vscode.Uri): boolean;
  parse(uri: vscode.Uri, content: string): ParsedFile;
}

/**
 * The characters after which a typed field's value is completed: the
 * colon and space after its key, a quote, and an inline list's `[` and
 * `,`. A key is completed when asked, or as VS Code suggests while typing.
 */
const TRIGGER_CHARACTERS = [':', ' ', '"', '[', ',', '|'];

/** The icon each kind of completion is drawn with. */
const ICONS: Readonly<Record<TypeCompletion['icon'], vscode.CompletionItemKind>> = {
  field: vscode.CompletionItemKind.Field,
  row: vscode.CompletionItemKind.Reference,
  option: vscode.CompletionItemKind.EnumMember,
  value: vscode.CompletionItemKind.Value,
  kind: vscode.CompletionItemKind.TypeParameter,
  rows: vscode.CompletionItemKind.Folder,
};

/**
 * Completes typed notes (docs/implementation/30-databases.md § Surfaces 2):
 * in a row note's front matter, its types' field names on a new line and,
 * after `key: `, the rows, options, or words the field's kind takes, each
 * written as Deckard writes it; in a type note, the Kind column's kinds and
 * type names, and what `rows:` can name. A workspace with no types gets
 * nothing.
 */
export class TypeFieldSuggestions implements vscode.Disposable {
  private readonly registrations: vscode.Disposable[] = [];

  /** Takes the index to complete from; nothing is registered until `register`. */
  public constructor(private readonly indexer: TypeSuggestionSource) {}

  /** Registers the provider for Markdown files. Returns it, so the composition root can build and register it in one expression. */
  public register(): this {
    this.registrations.push(
      vscode.languages.registerCompletionItemProvider(
        { pattern: '**/*.md' },
        { provideCompletionItems: (document, position) => this.provideCompletionItems(document, position) },
        ...TRIGGER_CHARACTERS,
      ),
    );
    return this;
  }

  /** Unregisters the provider. */
  public dispose(): void {
    this.registrations.forEach((registration) => registration.dispose());
  }

  /** The completions at a position in a typed note, or none. */
  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[]> {
    if (!isMarkdownFile(document.uri) || !this.indexer.isNotesFile(document.uri)) {
      return [];
    }
    // Most trigger characters are typed in a note's body, so the cursor's
    // line is checked before the index is waited for.
    const lineText = document.lineAt(position.line).text;
    if (position.line > 0 && !/^\s*\|/.test(lineText) && !/^[A-Za-z][\w-]*\s*:|^[A-Za-z][\w-]*$|^$/.test(lineText)) {
      return [];
    }
    await whenPublished(this.indexer);
    const index = this.indexer.getSnapshot();
    const types = getTypeIndex(index);
    if (types.isEmpty) {
      return [];
    }
    const lines = document.getText().split(/\r?\n/);
    const file = this.indexer.parse(document.uri, document.getText());
    const context = findFrontmatterCompletionContext(lines, position.line, position.character);

    if (file.typeNote) {
      if (context?.kind === 'value' && context.key === 'rows') {
        return toItems(listRowsCompletions(index), position.line, context);
      }
      const cell = findKindCellContext(file.typeNote, lines, position.line, position.character);
      return cell ? toItems(listKindCompletions(types.registry.types), position.line, cell) : [];
    }
    if (!context) {
      return [];
    }
    const rowTypes = findRowTypes(types.registry, file);
    if (rowTypes.length === 0) {
      return [];
    }
    const completions =
      context.kind === 'key'
        ? listFieldKeyCompletions(rowTypes, context.present)
        : listFieldValueCompletions(types, index, rowTypes, context);
    return toItems(completions, position.line, context);
  }
}

/** Completions that replace the columns `range` spans on a line, in the order given. */
function toItems(
  completions: readonly TypeCompletion[],
  line: number,
  range: { start: number; end: number },
): vscode.CompletionItem[] {
  return completions.map((completion, at) => {
    const item = new vscode.CompletionItem(completion.label, ICONS[completion.icon]);
    item.detail = completion.detail;
    item.documentation = new vscode.MarkdownString(completion.documentation);
    item.insertText = completion.insertText;
    item.filterText = completion.filterText;
    item.sortText = String(at).padStart(5, '0');
    item.range = new vscode.Range(line, range.start, line, range.end);
    if (completion.icon === 'field') {
      // A key is followed by its value, so the value's list opens next.
      item.command = { title: 'Suggest a value', command: 'editor.action.triggerSuggest' };
    }
    return item;
  });
}
