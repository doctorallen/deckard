// VS Code's workspace over the real disk, for a host suite that should also
// run under plain mocha with the e2e stand-in (test/e2e/vscodeStub.js),
// which has no documents, no edits, and no file system of its own.
import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';
// The module itself, not the namespace object `import *` makes of it, whose
// properties cannot be replaced; every importer reads through to this one.
import vscodeModule = require('vscode');

/** A position as the stand-in's Position holds one. */
interface Place {
  line: number;
  character: number;
}

/** A range as either API makes one. */
interface Span {
  start: Place;
  end: Place;
}

/** The three bytes of a UTF-8 byte order mark. */
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * A file's text as VS Code's document holds it: without the byte order mark,
 * which the document remembers and writes back when it is saved.
 */
function decode(bytes: Buffer): { text: string; bom: boolean } {
  const bom = bytes.subarray(0, 3).equals(BOM);
  return { text: (bom ? bytes.subarray(3) : bytes).toString('utf8'), bom };
}

/** A range from two positions or four numbers, as VS Code's Range is made. */
class Range implements Span {
  public readonly start: Place;
  public readonly end: Place;

  /** Either `(start, end)` positions or `(startLine, startCharacter, endLine, endCharacter)`. */
  public constructor(a: Place | number, b: Place | number, c?: number, d?: number) {
    this.start = typeof a === 'number' ? new vscode.Position(a, b as number) : a;
    this.end = typeof a === 'number' ? new vscode.Position(c ?? 0, d ?? 0) : (b as Place);
  }
}

/** An edit across notes: replacements and inserts kept per note, in order. */
class WorkspaceEdit {
  private readonly edits = new Map<string, [vscode.Uri, { range: Span; newText: string }[]]>();

  /** Replaces `range` in the note with `newText`. */
  public replace(uri: vscode.Uri, range: Span, newText: string): void {
    const entry = this.edits.get(uri.toString()) ?? [uri, []];
    entry[1].push({ range, newText });
    this.edits.set(uri.toString(), entry);
  }

  /** Puts `newText` in the note at `position`. */
  public insert(uri: vscode.Uri, position: Place, newText: string): void {
    this.replace(uri, { start: position, end: position }, newText);
  }

  /** Each note and its edits, in the order the notes were first edited. */
  public entries(): [vscode.Uri, { range: Span; newText: string }[]][] {
    return [...this.edits.values()];
  }
}

/** A note open in the model, as much of VS Code's TextDocument as the writes read. */
class DiskDocument {
  public isDirty = false;
  public text: string;
  public bom: boolean;

  /** Reads the note from disk. */
  public constructor(public readonly uri: vscode.Uri) {
    ({ text: this.text, bom: this.bom } = decode(fs.readFileSync(uri.fsPath)));
  }

  /** The note's lines, without their endings. */
  private get lines(): string[] {
    return this.text.split(/\r?\n/);
  }

  /** The note's line ending's length: 2 for CRLF, else 1. */
  private get eolLength(): number {
    return this.text.includes('\r\n') ? 2 : 1;
  }

  /** How many lines there are, as VS Code counts them. */
  public get lineCount(): number {
    return this.lines.length;
  }

  /** The whole text, or the text in `range`. */
  public getText(range?: Span): string {
    return range ? this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end)) : this.text;
  }

  /** One line's text and range; throws past the last line, as VS Code's does. */
  public lineAt(line: number): { text: string; range: Span } {
    const text = this.lines[line];
    if (text === undefined) {
      throw new Error('Illegal value for `line`');
    }
    return { text, range: new Range(line, 0, line, text.length) };
  }

  /** The offset of a position in the text. */
  public offsetAt(position: Place): number {
    const lines = this.lines;
    let offset = 0;
    for (let line = 0; line < position.line && line < lines.length; line += 1) {
      offset += lines[line].length + this.eolLength;
    }
    return offset + position.character;
  }

  /** Saves the text, with the byte order mark the file had. */
  public async save(): Promise<boolean> {
    fs.writeFileSync(this.uri.fsPath, Buffer.concat([this.bom ? BOM : Buffer.alloc(0), Buffer.from(this.text, 'utf8')]));
    this.isDirty = false;
    return true;
  }
}

/**
 * Makes `vscode` a workspace over the real disk, modeled on what VS Code
 * does, when the suite runs under the stand-in: documents that leave the
 * byte order mark out of their text and keep it when saved, `applyEdit`,
 * `fs`, a `WorkspaceEdit` that inserts, and a `Range` made from positions.
 * In the extension host it changes nothing, so there the suite runs against
 * VS Code itself. Returns what puts the stand-in back.
 */
export function useDiskWorkspace(): () => void {
  if (typeof (vscode.workspace as { applyEdit?: unknown }).applyEdit === 'function') {
    return () => undefined;
  }
  const documents = new Map<string, DiskDocument>();
  const open = (uri: vscode.Uri): DiskDocument => {
    const document = documents.get(uri.toString()) ?? new DiskDocument(uri);
    documents.set(uri.toString(), document);
    return document;
  };
  const workspace = vscode.workspace as unknown as Record<string, unknown>;
  const api = vscodeModule as unknown as Record<string, unknown>;
  const uri = vscode.Uri as unknown as Record<string, unknown>;
  const replaced: [Record<string, unknown>, string, unknown][] = [
    [api, 'Range', Range],
    [api, 'WorkspaceEdit', WorkspaceEdit],
    [uri, 'joinPath', (base: vscode.Uri, ...parts: string[]) => vscode.Uri.file(path.join(base.fsPath, ...parts))],
    [workspace, 'openTextDocument', async (target: vscode.Uri) => open(target)],
    [
      workspace,
      'applyEdit',
      async (edit: WorkspaceEdit) => {
        for (const [target, edits] of edit.entries()) {
          const document = open(target);
          const spans = edits
            .map(({ range, newText }) => ({
              from: document.offsetAt(range.start),
              to: document.offsetAt(range.end),
              newText,
            }))
            .sort((a, b) => b.from - a.from);
          for (const { from, to, newText } of spans) {
            document.text = document.text.slice(0, from) + newText + document.text.slice(to);
          }
          document.isDirty = true;
        }
        return true;
      },
    ],
    [
      workspace,
      'fs',
      {
        readFile: async (target: vscode.Uri) => new Uint8Array(fs.readFileSync(target.fsPath)),
        writeFile: async (target: vscode.Uri, content: Uint8Array) => {
          fs.writeFileSync(target.fsPath, content);
          // A document with no unsaved changes follows its file, as VS Code's does.
          const document = documents.get(target.toString());
          if (document && !document.isDirty) {
            ({ text: document.text, bom: document.bom } = decode(Buffer.from(content)));
          }
        },
        createDirectory: async (target: vscode.Uri) => {
          fs.mkdirSync(target.fsPath, { recursive: true });
        },
        delete: async (target: vscode.Uri) => {
          fs.rmSync(target.fsPath, { recursive: true, force: true });
        },
      },
    ],
  ];
  const kept = replaced.map(([owner, key]) => Object.getOwnPropertyDescriptor(owner, key));
  replaced.forEach(([owner, key, value]) =>
    Object.defineProperty(owner, key, { configurable: true, writable: true, value }),
  );
  return () =>
    replaced.forEach(([owner, key], at) => {
      const descriptor = kept[at];
      if (descriptor) {
        Object.defineProperty(owner, key, descriptor);
      } else {
        delete owner[key];
      }
    });
}
