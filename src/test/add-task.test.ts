import * as assert from 'assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as vscode from 'vscode';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import { getPeriodicNote } from '../domain/notes/periodicNotes';
import { CaptureService } from '../services/captureService';
import { addTaskCommand, AddTaskContext } from '../ui/commands/addTask';
import { createCaptureNotes } from '../ui/commands/capture';
import { startColumnTask } from '../ui/commands/taskBoardActions';

/** A row of a pick, as the editor and its own picks list them. */
interface Row {
  label: string;
  description?: string;
  field?: string;
  done?: boolean;
  target?: string;
  filePath?: string;
  destination?: { kind: string };
}

/** What one quick input showed when it opened, read as it opened. */
interface Shown {
  title?: string;
  placeholder?: string;
  rows: Row[];
  active: Row[];
}

/**
 * One answer to one quick input, in the order they open: a row of a pick to
 * choose, words to enter in a box, or nothing, which leaves it as Escape does.
 */
type Answer = (shown: Shown) => Row | string | undefined;

/**
 * Stands in for VS Code's quick picks and input boxes, answering each as it
 * opens, in turn, and recording what each showed. Returns what was shown,
 * and a way to put VS Code's own back.
 */
function answerInputs(answers: Answer[]): { shown: Shown[]; restore: () => void } {
  const window = vscode.window as unknown as Record<string, unknown>;
  const { createQuickPick, createInputBox } = window;
  const shown: Shown[] = [];
  const make = () => {
    const accepted: (() => void)[] = [];
    const hidden: (() => void)[] = [];
    const input = {
      title: undefined as string | undefined,
      placeholder: undefined as string | undefined,
      value: '',
      items: [] as Row[],
      activeItems: [] as Row[],
      selectedItems: [] as Row[],
      onDidAccept: (handler: () => void) => accepted.push(handler),
      onDidHide: (handler: () => void) => hidden.push(handler),
      onDidChangeValue: () => undefined,
      onDidTriggerButton: () => undefined,
      hide: () => hidden.splice(0).forEach((handler) => handler()),
      dispose: () => undefined,
      show: () =>
        setTimeout(() => {
          const seen: Shown = { title: input.title, placeholder: input.placeholder, rows: [...input.items], active: [...input.activeItems] };
          shown.push(seen);
          const answer = answers.shift()?.(seen);
          if (answer === undefined) {
            input.hide();
          } else {
            if (typeof answer === 'string') {
              input.value = answer;
            } else {
              input.selectedItems = [answer];
              input.activeItems = [answer];
            }
            accepted.forEach((handler) => handler());
          }
        }, 0),
    };
    return input;
  };
  window.createQuickPick = make;
  window.createInputBox = make;
  return {
    shown,
    restore: () => {
      window.createQuickPick = createQuickPick;
      window.createInputBox = createInputBox;
    },
  };
}

/** Records the information messages shown while `run` runs, answering none. */
async function recordMessages<T>(run: () => Promise<T>): Promise<{ result: T; messages: string[] }> {
  const window = vscode.window as unknown as Record<string, unknown>;
  const { showInformationMessage } = window;
  const messages: string[] = [];
  window.showInformationMessage = async (text: string) => void messages.push(text);
  try {
    return { result: await run(), messages };
  } finally {
    window.showInformationMessage = showInformationMessage;
  }
}

/** The row of `shown` for a field, a place, or a note. */
function row(shown: Shown, find: (candidate: Row) => boolean): Row {
  const found = shown.rows.find(find);
  assert.ok(found, `a row in ${shown.title}`);
  return found;
}

/** Add Task's context over notes at absolute paths, as an index with no workspace holds them. */
function contextOf(notes: Record<string, string>): AddTaskContext {
  const index = buildWorkspaceIndex(new Map(Object.entries(notes).map(([path, text]) => [path, parseMarkdown(path, text)])));
  const indexer = {
    ready: Promise.resolve(),
    getSnapshot: () => index,
    isNotesFile: () => false,
    getFilePath: () => '',
    parse: (uri: vscode.Uri, text: string) => parseMarkdown(uri.fsPath, text),
  };
  return {
    indexer: indexer as never,
    preferences: { value: {} } as never,
    captures: new CaptureService({
      index: indexer,
      notes: createCaptureNotes(indexer as never),
      recentHeadings: { recordRecentHeading: async () => undefined },
    }),
  };
}

suite('Add Task', () => {
  // Friday 2026-09-25, noon.
  const now = new Date(2026, 8, 25, 12).getTime();
  const today = `${getPeriodicNote('day', new Date(now)).name}.md`;
  let directory: string;
  let restore: (() => void) | undefined;

  setup(async () => {
    directory = mkdtempSync(join(tmpdir(), 'deckard-add-task-'));
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  teardown(async () => {
    restore?.();
    restore = undefined;
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    rmSync(directory, { recursive: true, force: true });
  });

  /** A note written to the temporary folder, and its path. */
  const note = (name: string, text: string): string => {
    const file = join(directory, name);
    writeFileSync(file, text);
    return file;
  };

  test('with no note open, it names today’s note, leads with the Note row, and opens on Description', async () => {
    const inputs = answerInputs([() => undefined]);
    restore = inputs.restore;
    assert.strictEqual(await addTaskCommand(contextOf({}), {}, now), undefined, 'left without writing');
    const [editor] = inputs.shown;
    assert.strictEqual(editor.title, `Add a task to ${today}`);
    assert.deepStrictEqual([editor.rows[0].label, editor.rows[0].description], ['$(file) Note', `${today} · today’s note`]);
    assert.deepStrictEqual(editor.active.map((active) => active.field), ['description']);
  });

  test('a note open in an editor that is not Markdown is not a note to write in', async () => {
    const plain = await vscode.workspace.openTextDocument({ content: 'not markdown', language: 'plaintext' });
    await vscode.window.showTextDocument(plain);
    const inputs = answerInputs([() => undefined]);
    restore = inputs.restore;
    await addTaskCommand(contextOf({}), {}, now);
    assert.strictEqual(inputs.shown[0].title, `Add a task to ${today}`);
  });

  test('in a Markdown note, plain words on the cursor’s line become the task there', async () => {
    const file = note('plan.md', '# Plan\n\nCall Ren\n');
    const editor = await vscode.window.showTextDocument(vscode.Uri.file(file));
    editor.selection = new vscode.Selection(2, 0, 2, 0);
    const inputs = answerInputs([(shown) => row(shown, (candidate) => candidate.done === true)]);
    restore = inputs.restore;

    assert.strictEqual(await addTaskCommand(contextOf({}), {}, now), '- [ ] Call Ren');
    assert.strictEqual(inputs.shown[0].title, 'Add a task to plan.md');
    assert.ok(inputs.shown[0].rows[0].description?.endsWith('plan.md · this note'));
    assert.strictEqual(editor.document.getText(), '# Plan\n\n- [ ] Call Ren\n');
  });

  test('on a task, the new one goes below it, its last words read into its fields', async () => {
    const file = note('plan.md', '# Plan\n- [ ] One\n');
    const editor = await vscode.window.showTextDocument(vscode.Uri.file(file));
    editor.selection = new vscode.Selection(1, 3, 1, 3);
    const inputs = answerInputs([
      (shown) => row(shown, (candidate) => candidate.field === 'description'),
      () => 'Two tomorrow p2',
      (shown) => row(shown, (candidate) => candidate.done === true),
    ]);
    restore = inputs.restore;

    await addTaskCommand(contextOf({}), {}, now);
    assert.strictEqual(inputs.shown[2].placeholder, '- [ ] Two ⏫ 📅 2026-09-26', 'the editor shows the line it will write');
    assert.strictEqual(editor.document.getText(), '# Plan\n- [ ] One\n- [ ] Two ⏫ 📅 2026-09-26\n');
  });

  test('the Note row offers each place, and another note takes the task, saying where it went', async () => {
    const plan = note('plan.md', '# Plan\nCall Ren\n');
    const other = note('other.md', '# Other\n- [ ] Before\n');
    const editor = await vscode.window.showTextDocument(vscode.Uri.file(plan));
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    const inputs = answerInputs([
      (shown) => row(shown, (candidate) => candidate.field === 'note'),
      (shown) => row(shown, (candidate) => candidate.target === 'note'),
      (shown) => row(shown, (candidate) => candidate.filePath === other),
      (shown) => row(shown, (candidate) => candidate.done === true),
    ]);
    restore = inputs.restore;

    const { result, messages } = await recordMessages(() => addTaskCommand(contextOf({ [other]: readFileSync(other, 'utf8') }), {}, now));
    assert.strictEqual(result, '- [ ] Call Ren');
    const [, places, notes, editorAgain] = inputs.shown;
    assert.deepStrictEqual(places.rows.map((place) => place.target), ['here', 'today', 'note', 'heading']);
    assert.ok(places.rows[0].description?.endsWith('plan.md · now'), 'this note is where it goes now');
    assert.deepStrictEqual(notes.rows.map((each) => each.label), ['other.md']);
    assert.strictEqual(editorAgain.title, 'Add a task to other.md');
    assert.strictEqual(editorAgain.rows[0].description, other);
    assert.strictEqual(readFileSync(other, 'utf8'), '# Other\n- [ ] Before\n- [ ] Call Ren\n');
    assert.strictEqual(editor.document.getText(), '# Plan\nCall Ren\n', 'the note open is left as it was');
    assert.deepStrictEqual(messages, ['Added it to other.md.']);
  });

  test('under a heading puts the task under that heading’s own lines', async () => {
    const other = note('other.md', '# Other\n## Calls\n- [ ] One\n\n## Later\nText\n');
    const inputs = answerInputs([
      (shown) => row(shown, (candidate) => candidate.field === 'note'),
      (shown) => row(shown, (candidate) => candidate.target === 'heading'),
      (shown) => row(shown, (candidate) => candidate.label === 'Calls'),
      (shown) => row(shown, (candidate) => candidate.field === 'description'),
      () => 'Call Ren',
      (shown) => row(shown, (candidate) => candidate.done === true),
    ]);
    restore = inputs.restore;

    const { messages } = await recordMessages(() => addTaskCommand(contextOf({ [other]: readFileSync(other, 'utf8') }), {}, now));
    assert.deepStrictEqual(inputs.shown[1].rows.map((place) => place.target), ['today', 'note', 'heading'], 'no note open, no This note');
    assert.strictEqual(inputs.shown[3].title, 'Add a task under Calls in other.md');
    assert.strictEqual(readFileSync(other, 'utf8'), '# Other\n## Calls\n- [ ] One\n- [ ] Call Ren\n\n## Later\nText\n');
    assert.deepStrictEqual(messages, ['Added it to other.md.']);
  });

  test('a board column starts the task in the column, in today’s note', async () => {
    const started = startColumnTask('priority:high');
    assert.deepStrictEqual(started, { kind: 'capture', line: '- [ ] ⏫' });
    const inputs = answerInputs([() => undefined]);
    restore = inputs.restore;
    await addTaskCommand(contextOf({}), { line: started.kind === 'capture' ? started.line : '' }, now);
    const [editor] = inputs.shown;
    assert.strictEqual(editor.title, `Add a task to ${today}`);
    assert.strictEqual(row(editor, (candidate) => candidate.field === 'priority').description, 'high');
    assert.deepStrictEqual(startColumnTask('due:later'), {
      kind: 'refused',
      reason: 'Drop a task on Today, Tomorrow, or No due date to change its due date.',
    });
  });
});
