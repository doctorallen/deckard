import * as vscode from 'vscode';

import { findFrontmatterEnd } from '../../domain/markdown/frontmatter';
import type { ParsedFile, TypeNote, WorkspaceIndex } from '../../domain/model';
import { getTypeIndex } from '../../domain/types/typeIndex';
import { readColumnRole, type ColumnRole } from '../../domain/types/typeNotes';
import { findTableCellAt } from '../../domain/types/typeNoteWriter';
import { editSchemaTable } from '../../domain/types/typeSchemaEdits';
import { EDIT_TYPE_COMMAND } from '../commands/typeBuilder';

/** What the type note helpers read from the index. */
interface TypeNoteSource {
  getSnapshot(): WorkspaceIndex;
  parse(uri: vscode.Uri, content: string): ParsedFile;
}

/** Type notes, by where the scanner reads them: a Markdown note in a `Types` folder. */
const TYPE_NOTES: vscode.DocumentSelector = { pattern: '**/Types/*.md' };

/** What each column of a schema table holds, as its header's hover says. */
const COLUMN_HELP: Readonly<Record<ColumnRole, string>> = {
  field: 'The field’s name, which is its key in a row’s front matter: `lead`, `on-call`, or `Distribution List`. A search names it with hyphens for spaces.',
  kind: [
    'What the field holds:',
    '',
    '| Kind | A value |',
    '| --- | --- |',
    '| `Text` | anything, as typed |',
    '| `Number` | 12, 1,200, 1.5 |',
    '| `Date` | 2026-03-01, or next friday |',
    '| `Checkbox` | true or false |',
    '| `Select: gold, silver` | one of the options listed |',
    '| `Person` | "@dana" |',
    '| `Note` | "[[Title]]" |',
    '| `Team`, `Team or Area` | a row of a type in this workspace |',
    '| `Link`, `Email`, `Phone` | a URL, an address, a number |',
    '',
    'Add `, many` for a field that holds several: `Person, many`.',
  ].join('\n'),
  reverse: 'For a field that names rows: what the page of a row it names calls the link, such as `lead of`. Empty, it is the field’s name and *of*.',
  alsoCalled: 'Other words for the field, separated by commas, which Find and assistants read in a question.',
  words: 'Phrases a line uses to say the field, separated by commas, such as `now leads, took over`, so File this offers to set it.',
};

/**
 * Helps a type note's schema table be written by hand
 * (docs/implementation/44-type-builder.md § In the editor): a CodeLens over
 * the table that opens the type form and its Add field steps and counts
 * the type's fields and rows; a hover on each header cell saying what the
 * column holds; and Format Document, which realigns the table.
 */
export class TypeNoteEditor implements vscode.CodeLensProvider, vscode.HoverProvider, vscode.DocumentFormattingEditProvider, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  /** Takes the index to read type notes with; nothing is registered until `register`. */
  public constructor(private readonly indexer: TypeNoteSource) {}

  /** Registers the lens, hover, and formatter for type notes. Returns it, so the composition root can build and register it in one expression. */
  public register(): this {
    this.disposables.push(
      vscode.languages.registerCodeLensProvider(TYPE_NOTES, this),
      vscode.languages.registerHoverProvider(TYPE_NOTES, this),
      vscode.languages.registerDocumentFormattingEditProvider(TYPE_NOTES, this),
    );
    return this;
  }

  /** Stops providing. */
  public dispose(): void {
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /** The lens over the schema table, or over the heading of a type note with none. */
  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const note = this.read(document);
    if (!note) {
      return [];
    }
    const line = note.table ? note.table.startLine - 1 : findHeadingLine(document);
    const range = new vscode.Range(line, 0, line, 0);
    const rows = getTypeIndex(this.indexer.getSnapshot()).rows(note.key).length;
    const fields = note.fields.length;
    return [
      new vscode.CodeLens(range, { title: 'Edit Type…', command: EDIT_TYPE_COMMAND, arguments: [document.uri], tooltip: 'Add, change, move, or remove the fields in a form' }),
      new vscode.CodeLens(range, { title: 'Add field…', command: EDIT_TYPE_COMMAND, arguments: [document.uri, { add: true }], tooltip: 'Name a field and choose its kind; Deckard writes its row' }),
      new vscode.CodeLens(range, {
        title: `${fields} ${fields === 1 ? 'field' : 'fields'}, ${rows} ${rows === 1 ? 'row' : 'rows'}`,
        command: 'deckard.search',
        arguments: [`type = ${note.key}`],
        tooltip: `Open the ${note.name} rows`,
      }),
    ];
  }

  /** What a header cell's column holds, on the schema table's header line. */
  public provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const note = this.read(document);
    if (!note?.table || position.line !== note.table.startLine - 1) {
      return undefined;
    }
    const text = document.lineAt(position.line).text;
    const cell = findTableCellAt(text, position.character);
    const role = cell === undefined ? undefined : readColumnRole(note.columns?.[cell] ?? '');
    if (!role) {
      return undefined;
    }
    const markdown = new vscode.MarkdownString(`${COLUMN_HELP[role]}\n\n[Edit Type…](command:${EDIT_TYPE_COMMAND}?${encodeURIComponent(JSON.stringify([note.key]))})`);
    markdown.isTrusted = { enabledCommands: [EDIT_TYPE_COMMAND] };
    return new vscode.Hover(markdown);
  }

  /** The schema table realigned, when it needs it. */
  public provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
    if (!this.read(document)) {
      return [];
    }
    const planned = editSchemaTable(document.getText(), { kind: 'realign' });
    if (planned.kind !== 'edit') {
      return [];
    }
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const last = planned.start + planned.deleted - 1;
    return [vscode.TextEdit.replace(new vscode.Range(planned.start, 0, last, document.lineAt(last).text.length), planned.lines.join(eol))];
  }

  /** The type note a document is, as the editor holds it; undefined for any other note. */
  private read(document: vscode.TextDocument): TypeNote | undefined {
    return this.indexer.parse(document.uri, document.getText()).typeNote;
  }
}

/** The zero-based line of a note's first heading after its front matter, or the line after the front matter. */
function findHeadingLine(document: vscode.TextDocument): number {
  const lines = Array.from({ length: document.lineCount }, (_, at) => document.lineAt(at).text);
  const start = (findFrontmatterEnd(lines) ?? -1) + 1;
  for (let line = start; line < document.lineCount; line += 1) {
    if (/^#{1,6}\s/.test(document.lineAt(line).text)) {
      return line;
    }
  }
  return Math.min(start, document.lineCount - 1);
}
