import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import {
  shouldPreview,
  WorkspaceWrite,
  WorkspaceWriteHistory,
  WriteHandle,
} from '../ui/commands/workspaceWrites';
import { useDiskWorkspace } from './diskWorkspace';

/**
 * In the extension host the suites run against VS Code; under the e2e
 * stand-in, against a workspace on disk modeled on it.
 */
function onDisk(): void {
  let putBack: () => void = () => undefined;
  suiteSetup(() => {
    putBack = useDiskWorkspace();
  });
  suiteTeardown(() => putBack());
}

suite('Workspace writes', () => {
  onDisk();

  test('shows a write that reaches more than one note', () => {
    assert.strictEqual(shouldPreview('severalNotes', 1), false);
    assert.strictEqual(shouldPreview('severalNotes', 2), true);
    assert.strictEqual(shouldPreview('always', 1), true);
    assert.strictEqual(shouldPreview('always', 0), false, 'nothing to show');
    assert.strictEqual(shouldPreview('never', 9), false);
  });

  test('says when there is a write to take back, for the palette', () => {
    const history = new WorkspaceWriteHistory();
    const heard: boolean[] = [];
    history.onDidChange((canUndo) => heard.push(canUndo));
    const uri = vscode.Uri.file('/notes/a.md');
    const write = { label: 'a write', at: 0, notes: [{ uri, before: 'a', after: 'b' }] };

    history.remember({ ...write, notes: [] });
    assert.deepStrictEqual(heard, [], 'a write that changed nothing is not one to undo');
    history.remember(write);
    history.remember(write);
    assert.deepStrictEqual(heard, [true], 'told once, when it starts being true');
    history.clear();
    assert.deepStrictEqual(heard, [true, false]);
  });

  test('saves what it wrote, and puts every note back on an undo', async () => {
    const root = await createTemporaryRoot();
    const first = vscode.Uri.joinPath(root, 'first.md');
    const second = vscode.Uri.joinPath(root, 'second.md');
    await write(first, '# Atlas #project/atlas\n');
    await write(second, 'Also #project/atlas here.\n');
    const history = new WorkspaceWriteHistory();

    const edit = new vscode.WorkspaceEdit();
    edit.replace(first, lineRange(0, 8, 22), '#project/argent');
    edit.replace(second, lineRange(0, 5, 19), '#project/argent');
    const written = await history.write(edit, {
      label: 'the rename of #project/atlas',
      preview: 'never',
    });

    assert.strictEqual(written.applied, true);
    assert.strictEqual(written.notes.length, 2);
    assert.strictEqual(await read(first), '# Atlas #project/argent\n');
    assert.strictEqual(await read(second), 'Also #project/argent here.\n');
    assert.strictEqual(
      history.lastWrite?.label,
      'the rename of #project/atlas',
    );

    const undone = await history.undo();
    assert.deepStrictEqual(undone, {
      label: 'the rename of #project/atlas',
      restored: 2,
      skipped: 0,
      skippedUris: [],
    });
    assert.strictEqual(await read(first), '# Atlas #project/atlas\n');
    assert.strictEqual(await read(second), 'Also #project/atlas here.\n');
    assert.strictEqual(
      history.lastWrite,
      undefined,
      'one write is kept, and an undo spends it',
    );
    await deleteTemporaryRoot(root);
  });

  test('leaves a note changed since the write as its author left it', async () => {
    const root = await createTemporaryRoot();
    const note = vscode.Uri.joinPath(root, 'note.md');
    const other = vscode.Uri.joinPath(root, 'other.md');
    await write(note, 'One #a tag.\n');
    await write(other, 'Another #a tag.\n');
    const history = new WorkspaceWriteHistory();

    const edit = new vscode.WorkspaceEdit();
    edit.replace(note, lineRange(0, 4, 6), '#b');
    edit.replace(other, lineRange(0, 8, 10), '#b');
    await history.write(edit, { label: 'the rename of #a', preview: 'never' });
    await write(other, 'Rewritten by hand.\n');

    const undone = await history.undo();
    assert.deepStrictEqual(
      { ...undone, skippedUris: undone?.skippedUris.map(String) },
      {
        label: 'the rename of #a',
        restored: 1,
        skipped: 1,
        skippedUris: [other.toString()],
      },
    );
    assert.strictEqual(await read(note), 'One #a tag.\n');
    assert.strictEqual(await read(other), 'Rewritten by hand.\n');
    await deleteTemporaryRoot(root);
  });

  test('puts back what the write changed outside the notes', async () => {
    const root = await createTemporaryRoot();
    const note = vscode.Uri.joinPath(root, 'note.md');
    await write(note, 'One #a tag.\n');
    const history = new WorkspaceWriteHistory();
    let favorites = ['#b'];

    const edit = new vscode.WorkspaceEdit();
    edit.replace(note, lineRange(0, 4, 6), '#b');
    await history.write(edit, {
      label: 'the rename of #a',
      preview: 'never',
      restore: async () => {
        favorites = ['#a'];
      },
    });

    await history.undo();
    assert.deepStrictEqual(favorites, ['#a']);
    await deleteTemporaryRoot(root);
  });

  test('has nothing to undo until something is written', async () => {
    const history = new WorkspaceWriteHistory();
    assert.strictEqual(history.lastWrite, undefined);
    assert.strictEqual(await history.undo(), undefined);

    const edit = new vscode.WorkspaceEdit();
    const written = await history.write(edit, { label: 'nothing', preview: 'never' });
    assert.strictEqual(written.applied, true);
    assert.deepStrictEqual(written.notes, []);
    assert.strictEqual(history.lastWrite, undefined);
  });

  test('a write\'s handle takes it back, and only while it is the last', async () => {
    const root = await createTemporaryRoot();
    const note = vscode.Uri.joinPath(root, 'note.md');
    const other = vscode.Uri.joinPath(root, 'other.md');
    await write(note, 'One #a tag.\n');
    await write(other, 'Another #a tag.\n');
    const history = new WorkspaceWriteHistory();

    const first = new vscode.WorkspaceEdit();
    first.replace(note, lineRange(0, 4, 6), '#b');
    const written = await history.write(first, { label: 'the first', preview: 'never' });
    assert.ok(written.applied);
    assert.strictEqual(written.handle.isLatest(), true);

    const second = new vscode.WorkspaceEdit();
    second.replace(other, lineRange(0, 8, 10), '#b');
    const later = await history.write(second, { label: 'the second', preview: 'never' });
    assert.ok(later.applied);
    assert.strictEqual(written.handle.isLatest(), false, 'Deckard has written since');
    assert.strictEqual(await written.handle.undo(), undefined, 'a stale handle writes nothing');
    assert.strictEqual(await read(other), 'Another #b tag.\n');

    const undone = await later.handle.undo();
    assert.strictEqual(undone?.label, 'the second');
    assert.strictEqual(await read(other), 'Another #a tag.\n');
    assert.strictEqual(later.handle.isLatest(), false, 'an undo spends the write');
    await deleteTemporaryRoot(root);
  });

  test('two writes made at once land one after the other, and an Undo takes back only the last', async () => {
    const root = await createTemporaryRoot();
    const note = vscode.Uri.file(path.join(root.fsPath, 'note.md'));
    await write(note, 'one\ntwo\n');
    const history = new WorkspaceWriteHistory();

    const first = new vscode.WorkspaceEdit();
    first.replace(note, lineRange(0, 3, 3), ' #a');
    const second = new vscode.WorkspaceEdit();
    second.replace(note, lineRange(1, 3, 3), ' #b');
    const [one, two] = await Promise.all([
      history.write(first, { label: 'adding #a', preview: 'never' }),
      history.write(second, { label: 'adding #b', preview: 'never' }),
    ]);
    assert.ok(one.applied && two.applied);
    assert.strictEqual(await read(note), 'one #a\ntwo #b\n');
    assert.deepStrictEqual(
      two.notes.map(({ before, after }) => ({ before, after })),
      [{ before: 'one #a\ntwo\n', after: 'one #a\ntwo #b\n' }],
      'the second write found the note as the first left it',
    );
    assert.strictEqual(one.handle.isLatest(), false);

    const undone = await history.undo();
    assert.strictEqual(undone?.label, 'adding #b');
    assert.strictEqual(await read(note), 'one #a\ntwo\n', 'the first write stays');
    await deleteTemporaryRoot(root);
  });

  test('an Undo asked for while a write is landing waits for it, and then takes nothing back', async () => {
    const root = await createTemporaryRoot();
    const note = vscode.Uri.file(path.join(root.fsPath, 'note.md'));
    await write(note, 'one\ntwo\n');
    const history = new WorkspaceWriteHistory();
    const first = new vscode.WorkspaceEdit();
    first.replace(note, lineRange(0, 3, 3), ' #a');
    const written = await history.write(first, { label: 'adding #a', preview: 'never' });
    assert.ok(written.applied);

    const second = new vscode.WorkspaceEdit();
    second.replace(note, lineRange(1, 3, 3), ' #b');
    const later = history.write(second, { label: 'adding #b', preview: 'never' });
    assert.strictEqual(await written.handle.undo(), undefined, 'the write it was for is no longer the last');
    await later;
    assert.strictEqual(await read(note), 'one #a\ntwo #b\n');
    assert.strictEqual(history.lastWrite?.label, 'adding #b');
    await deleteTemporaryRoot(root);
  });

  test('a write\'s saves are marked as Deckard\'s own, for the index', async () => {
    const root = await createTemporaryRoot();
    const note = vscode.Uri.joinPath(root, 'note.md');
    await write(note, 'One #a tag.\n');
    const history = new WorkspaceWriteHistory();

    const edit = new vscode.WorkspaceEdit();
    edit.replace(note, lineRange(0, 4, 6), '#b');
    await history.write(edit, { label: 'the rename of #a', preview: 'never' });
    assert.strictEqual(history.ownWrites.take(note.toString()), true);
    assert.strictEqual(new WorkspaceWriteHistory().ownWrites.take(note.toString()), false);
    await deleteTemporaryRoot(root);
  });
});

suite('An Undo offered on a message', () => {
  onDisk();

  const WRITTEN_SINCE = 'Deckard has changed your notes again since, so use Deckard: Undo Last Change.';

  /** A write to one note, as the history keeps it; nothing on disk. */
  function writeOf(label: string): WorkspaceWrite {
    return { label, at: 0, notes: [{ uri: vscode.Uri.file(`/notes/${label}.md`), before: 'a', after: 'b' }] };
  }

  /**
   * The handle of `label`'s write, as its command holds it once it lands:
   * the write is kept as the last, and the handle marks it so.
   */
  async function writeWithHandle(history: WorkspaceWriteHistory, label: string): Promise<WriteHandle> {
    history.remember(writeOf(label));
    // An edit with no entries leaves the last write as it is, and hands
    // back the handle that marks it.
    const empty = { entries: () => [] } as unknown as vscode.WorkspaceEdit;
    const written = await history.write(empty, { label, preview: 'never' });
    assert.ok(written.applied);
    return written.handle;
  }

  /** Every message said, answered by `answer`, until `restore`. */
  function listen(answer: (text: string) => string | undefined = () => undefined) {
    const window = vscode.window as unknown as Record<string, unknown>;
    const names = ['showInformationMessage', 'showWarningMessage', 'showErrorMessage'];
    const originals = names.map((name) => window[name]);
    const said: string[] = [];
    names.forEach((name) => {
      window[name] = async (text: string) => {
        said.push(text);
        return answer(text);
      };
    });
    return { said, restore: () => names.forEach((name, at) => (window[name] = originals[at])) };
  }

  test("a rollover's or a review's Undo takes nothing back once Deckard has written since", async () => {
    const history = new WorkspaceWriteHistory();
    const rollover = await writeWithHandle(history, 'carrying 2 tasks forward');
    history.remember(writeOf('the rename of #a'));
    let refreshed = 0;
    const messages = listen();
    try {
      await rollover.takeBack({
        guard: 'latest',
        refresh: async () => {
          refreshed += 1;
        },
        done: 'Put 2 notes back.',
      });
      assert.deepStrictEqual(messages.said, [WRITTEN_SINCE]);
      assert.strictEqual(history.lastWrite?.label, 'the rename of #a', 'the later write is still there to take back');
      assert.strictEqual(refreshed, 0);
    } finally {
      messages.restore();
    }
  });

  test("a rollover's or a review's Undo takes it back while it is the last, and reads the notes again", async () => {
    const root = await createTemporaryRoot();
    const note = vscode.Uri.joinPath(root, 'week.md');
    await write(note, '# Week 40\n');
    const history = new WorkspaceWriteHistory();
    const edit = new vscode.WorkspaceEdit();
    edit.insert(note, new vscode.Position(1, 0), '\n## Review\n');
    const written = await history.write(edit, { label: 'the review of Week 40', preview: 'never' });
    assert.ok(written.applied);
    let refreshed = 0;
    const messages = listen();
    try {
      await written.handle.takeBack({
        guard: 'latest',
        refresh: async () => {
          refreshed += 1;
        },
        done: 'Took the review back out of the note.',
      });
      assert.strictEqual(await read(note), '# Week 40\n');
      assert.strictEqual(refreshed, 1);
      assert.deepStrictEqual(messages.said, ['Took the review back out of the note.']);
    } finally {
      messages.restore();
      await deleteTemporaryRoot(root);
    }
  });

  /**
   * Stands in for an editor holding `name`'s note as `text` and the same on
   * disk, and for VS Code, which refuses every edit; until the returned
   * function puts the real ones back.
   */
  function refuseEditsTo(name: string, text: string): () => void {
    const uri = vscode.Uri.file(`/notes/${name}.md`);
    const document = {
      uri,
      isDirty: false,
      lineCount: 1,
      getText: () => text,
      lineAt: () => ({ range: { end: new vscode.Position(0, text.length) } }),
    };
    const workspace = vscode.workspace as unknown as Record<string, unknown>;
    const window = vscode.window as unknown as Record<string, unknown>;
    const replaced: [Record<string, unknown>, string, unknown][] = [
      [workspace, 'openTextDocument', async () => document],
      [workspace, 'fs', { readFile: async () => Buffer.from(text, 'utf8') }],
      [workspace, 'applyEdit', async () => false],
      [window, 'visibleTextEditors', [{ document }]],
    ];
    const kept = replaced.map(([owner, key]) => Object.getOwnPropertyDescriptor(owner, key));
    replaced.forEach(([owner, key, value]) =>
      Object.defineProperty(owner, key, { configurable: true, get: () => value }),
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

  const REFUSED =
    'VS Code did not accept the undo in plan.md, so the note keeps the edit. Check that the note is not read-only, then try again.';

  test("a message's Undo says VS Code refused it, rather than that the note changed", async () => {
    const history = new WorkspaceWriteHistory();
    const written = await writeWithHandle(history, 'plan');
    const putBack = refuseEditsTo('plan', 'b');
    const messages = listen();
    try {
      await written.takeBack({ guard: 'latest', done: 'Took it back.' });
      assert.deepStrictEqual(messages.said, [REFUSED]);
      assert.strictEqual(history.lastWrite?.label, 'plan', 'the write is kept, to try again');
    } finally {
      messages.restore();
      putBack();
    }
  });

  test('Undo Last Change says VS Code refused it, rather than that the note changed', async () => {
    const history = new WorkspaceWriteHistory();
    await writeWithHandle(history, 'plan');
    const putBack = refuseEditsTo('plan', 'b');
    const messages = listen((text) => (text.startsWith('Undo ') ? 'Undo' : undefined));
    try {
      await history.undoLast(async () => undefined);
      assert.deepStrictEqual(messages.said, ['Undo plan?', REFUSED]);
    } finally {
      messages.restore();
      putBack();
    }
  });

  test('an Undo still says a note changed since, when it did', async () => {
    const history = new WorkspaceWriteHistory();
    const written = await writeWithHandle(history, 'plan');
    // The write left "b"; the note now reads otherwise.
    const putBack = refuseEditsTo('plan', 'changed by hand');
    const messages = listen();
    try {
      await written.takeBack({ guard: 'latest', done: 'Took it back.' });
      assert.deepStrictEqual(messages.said, ['plan.md changed after Deckard last read it, so nothing was written.']);
    } finally {
      messages.restore();
      putBack();
    }
  });

  test("Park Note's Undo refuses before it asks once Deckard has written since", async () => {
    const history = new WorkspaceWriteHistory();
    const park = await writeWithHandle(history, 'parking a.md');
    history.remember(writeOf('the rename of #a'));
    const messages = listen((text) => (text.startsWith('Undo ') ? 'Undo' : undefined));
    try {
      await park.takeBack({ guard: 'ask', refresh: async () => undefined });
      assert.deepStrictEqual(messages.said, [WRITTEN_SINCE], 'nothing is asked');
      assert.strictEqual(history.lastWrite?.label, 'the rename of #a');
    } finally {
      messages.restore();
    }
  });

  test("Park Note's Undo takes nothing back when Deckard writes while it asks", async () => {
    const history = new WorkspaceWriteHistory();
    const park = await writeWithHandle(history, 'parking a.md');
    const messages = listen((text) => {
      if (!text.startsWith('Undo ')) {
        return undefined;
      }
      history.remember(writeOf('the rename of #a'));
      return 'Undo';
    });
    try {
      await park.takeBack({ guard: 'ask', refresh: async () => undefined });
      assert.deepStrictEqual(messages.said, ['Undo parking a.md?', WRITTEN_SINCE]);
      assert.strictEqual(history.lastWrite?.label, 'the rename of #a');
    } finally {
      messages.restore();
    }
  });
});

function lineRange(line: number, start: number, end: number): vscode.Range {
  return new vscode.Range(line, start, line, end);
}

async function write(uri: vscode.Uri, content: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
}

async function read(uri: vscode.Uri): Promise<string> {
  return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
}

async function createTemporaryRoot(): Promise<vscode.Uri> {
  const directoryName = `deckard-writes-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const temporaryRoot = vscode.Uri.file(path.join(os.tmpdir(), directoryName));
  await vscode.workspace.fs.createDirectory(temporaryRoot);
  return temporaryRoot;
}

async function deleteTemporaryRoot(temporaryRoot: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.delete(temporaryRoot, {
    recursive: true,
    useTrash: false,
  });
}
