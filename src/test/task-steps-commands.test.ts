import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { formatIsoDate } from '../domain/markdown/taskMetadata';
import { toggleTask } from '../ui/commands/taskActions';
import { toggleTaskLines } from '../ui/commands/toggleTaskDone';
import {
  addTaskSteps,
  buildSuggestPrompt,
  createLanguageModelSuggester,
  describeSuggestFailure,
  readWrittenSteps,
  StepList,
} from '../ui/commands/taskSteps';
import { WorkspaceWriteHistory } from '../ui/commands/workspaceWrites';
import { parseTaskBoardMessage } from '../ui/webview/messages';
import { createTaskWrites } from './taskWrites';

type Shown = unknown[][];

/** Runs `body` with the information and warning messages recorded, answering `answer`. */
async function withMessages<T>(
  body: (shown: Shown) => Promise<T>,
  answer?: string,
): Promise<T> {
  const window = vscode.window as unknown as Record<string, unknown>;
  const info = window.showInformationMessage;
  const warning = window.showWarningMessage;
  const shown: Shown = [];
  const record = async (...args: unknown[]) => {
    shown.push(args);
    return answer;
  };
  window.showInformationMessage = record;
  window.showWarningMessage = record;
  try {
    return await body(shown);
  } finally {
    window.showInformationMessage = info;
    window.showWarningMessage = warning;
  }
}

async function createNote(name: string, content: string): Promise<{ uri: vscode.Uri; root: vscode.Uri }> {
  const root = vscode.Uri.file(
    path.join(os.tmpdir(), `deckard-steps-${Date.now()}-${Math.random().toString(36).slice(2)}`),
  );
  await vscode.workspace.fs.createDirectory(root);
  const uri = vscode.Uri.joinPath(root, name);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  return { uri, root };
}

async function readNote(uri: vscode.Uri): Promise<string> {
  return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

suite('Break into Steps', () => {
  // Each test writes to a history of its own, so one test's Undo never
  // reaches another's write.
  let history: WorkspaceWriteHistory;
  setup(() => {
    history = new WorkspaceWriteHistory();
  });

  test('the list adds what is typed, changes a step, moves and removes them, and defaults to Write', () => {
    const list = new StepList([{ title: 'Book the venue', done: true }], undefined, 'Plan the offsite');
    let items = list.items('Draft the email');
    assert.strictEqual(items[0].label, '$(add) Add "Draft the email"');
    assert.strictEqual(list.defaultRow(items, 'Draft the email'), items[0]);
    assert.deepStrictEqual(
      items.filter((item) => item.row.kind === 'written').map((item) => item.label),
      ['$(pass-filled) Book the venue'],
    );
    list.take('Draft the email');
    list.take('- [ ] Send   the invite');
    list.take('   ');
    assert.deepStrictEqual(list.steps.map((step) => step.text), ['Draft the email', 'Send the invite']);
    items = list.items('');
    const write = items.find((item) => item.row.kind === 'write');
    assert.strictEqual(write?.label, '$(check) Write 2 steps');
    assert.strictEqual(list.defaultRow(items, ''), write);
    assert.strictEqual(items.some((item) => item.row.kind === 'suggest'), false, 'no model, no Suggest steps');

    list.editing = 1;
    assert.strictEqual(list.items('Send the invites')[0].label, '$(edit) Change step 2 to "Send the invites"');
    list.take('Send the invites');
    assert.strictEqual(list.editing, undefined);
    list.moveUp(1);
    assert.deepStrictEqual(list.steps.map((step) => step.text), ['Send the invites', 'Draft the email']);
    list.remove(0);
    assert.deepStrictEqual(list.steps.map((step) => step.text), ['Draft the email']);
    assert.strictEqual(list.items('').find((item) => item.row.kind === 'write')?.label, '$(check) Write 1 step');

    list.take('One\nTwo');
    assert.deepStrictEqual(list.steps.map((step) => step.text), ['Draft the email', 'One', 'Two'], 'a pasted list is several steps');
  });

  test('offers Suggest steps only with a model, and marks what it suggested', () => {
    const list = new StepList([], { label: 'GPT-4o', vendor: 'copilot' }, 'Plan the offsite');
    const suggest = list.items('').find((item) => item.row.kind === 'suggest');
    assert.strictEqual(suggest?.label, '$(sparkle) Suggest steps');
    assert.strictEqual(suggest?.description, 'asks copilot · GPT-4o');
    assert.strictEqual(
      suggest?.detail,
      'Sends only this task\'s words, "Plan the offsite". Nothing is written until you choose Write.',
    );
    list.suggestSteps(['Pick a date']);
    assert.strictEqual(list.items('').find((item) => item.row.kind === 'new')?.description, 'suggested');
    assert.strictEqual(
      describeSuggestFailure('GPT-4o', Object.assign(new Error('denied'), { code: 'NoPermissions' })),
      'Deckard was not allowed to use GPT-4o, so it suggested nothing. Type the steps instead.',
    );
    assert.strictEqual(
      describeSuggestFailure('GPT-4o', new Error('offline')),
      'GPT-4o could not suggest steps (offline). Type the steps instead.',
    );
  });

  test('asks a model with the task’s words alone, and offers nothing without one', async () => {
    assert.strictEqual(
      buildSuggestPrompt('Plan the offsite'),
      'Break this task into small, concrete steps one person can do one at a time, in order. Reply with 3 to 7 steps, one per line, each under 80 characters, with no numbering, bullets, or other text.\n\nTask: Plan the offsite',
    );
    // The test host runs with extensions off, so no model is installed.
    assert.strictEqual(await createLanguageModelSuggester().model(), undefined);
  });

  test('reads the steps already written under a task', () => {
    assert.deepStrictEqual(
      readWrittenSteps(['- [ ] Plan', '  - [x] Book ✅ 2026-09-20', '  - [ ] Email #x', '- [ ] Next'], 0),
      [
        { title: 'Book', done: true },
        { title: 'Email #x', done: false },
      ],
    );
  });

  test('writes steps after what is under the task, and Undo takes them back', async () => {
    const content = '# Offsite\n\n- [ ] Plan the offsite 📅 2026-10-09\n  - [x] Book the venue\n    call first\n\nAfter.\n';
    const { uri, root } = await createNote('offsite.md', content);
    try {
      const [task] = parseMarkdown(uri.fsPath, content).tasks;
      const shown = await withMessages(async (messages) => {
        assert.strictEqual(await addTaskSteps(createTaskWrites(history), task, ['Draft the email', 'Send the invite']), true);
        return messages;
      });
      assert.strictEqual(
        await readNote(uri),
        '# Offsite\n\n- [ ] Plan the offsite 📅 2026-10-09\n  - [x] Book the venue\n    call first\n  - [ ] Draft the email\n  - [ ] Send the invite\n\nAfter.\n',
      );
      assert.deepStrictEqual(shown[0], ['Wrote 2 steps under "Plan the offsite".', 'Undo']);
      assert.strictEqual(history.lastWrite?.label, 'writing 2 steps under "Plan the offsite"');
      await history.undo();
      assert.strictEqual(await readNote(uri), content);
    } finally {
      await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
    }
  });

  test('the message’s Undo takes the steps back out', async () => {
    const content = '- [ ] Plan';
    const { uri, root } = await createNote('plan.md', content);
    try {
      const [task] = parseMarkdown(uri.fsPath, content).tasks;
      await withMessages(async () => {
        assert.strictEqual(await addTaskSteps(createTaskWrites(history), task, ['One']), true);
        await settle();
      }, 'Undo');
      await settle();
      assert.strictEqual(await readNote(uri), content, 'the note ends as it did, without a newline');
    } finally {
      await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
    }
  });

  test('writes nothing when the task line changed since it was read', async () => {
    const { uri, root } = await createNote('changed.md', '- [ ] Plan the offsite\n');
    try {
      const [task] = parseMarkdown(uri.fsPath, '- [ ] Plan the party\n').tasks;
      const written = await withMessages(() => addTaskSteps(createTaskWrites(history), task, ['One']));
      assert.strictEqual(written, false);
      assert.strictEqual(await readNote(uri), '- [ ] Plan the offsite\n');
    } finally {
      await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
    }
  });
});

suite('Completing steps', () => {
  // Each test writes to a history of its own, so one test's Undo never
  // reaches another's write.
  let history: WorkspaceWriteHistory;
  setup(() => {
    history = new WorkspaceWriteHistory();
  });

  const today = formatIsoDate(Date.now());

  test('the last open step offers to complete its task, and does only when asked', async () => {
    const content = '- [ ] Plan the offsite\n  - [x] Book the venue\n  - [ ] Draft the email\n';
    const { uri, root } = await createNote('last.md', content);
    try {
      const step = parseMarkdown(uri.fsPath, content).tasks[2];
      const shown = await withMessages(async (messages) => {
        assert.strictEqual(await toggleTask(createTaskWrites(history), step, true), true);
        await settle();
        return messages;
      });
      assert.deepStrictEqual(shown[0], [
        'Completed "Draft the email", the last open step of "Plan the offsite".',
        'Complete Task',
        'Undo',
      ]);
      assert.strictEqual(
        await readNote(uri),
        `- [ ] Plan the offsite\n  - [x] Book the venue\n  - [x] Draft the email ✅ ${today}\n`,
        'nothing is completed for the reader',
      );

      const again = await readNote(uri);
      const reopened = parseMarkdown(uri.fsPath, again).tasks[2];
      await withMessages(() => toggleTask(createTaskWrites(history), reopened, false));
      const fresh = parseMarkdown(uri.fsPath, await readNote(uri)).tasks[2];
      await withMessages(async () => {
        await toggleTask(createTaskWrites(history), fresh, true);
        await settle();
        await settle();
      }, 'Complete Task');
      assert.strictEqual(
        await readNote(uri),
        `- [x] Plan the offsite ✅ ${today}\n  - [x] Book the venue\n  - [x] Draft the email ✅ ${today}\n`,
      );
    } finally {
      await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
    }
  });

  test('a task with open steps offers to complete them, in one change', async () => {
    const content = '- [ ] Plan the offsite\n  - [ ] Book the venue\n  - [x] Pay\n  - [ ] Draft the email\n- [ ] Next\n';
    const { uri, root } = await createNote('open.md', content);
    try {
      const [task] = parseMarkdown(uri.fsPath, content).tasks;
      const shown = await withMessages(async (messages) => {
        await toggleTask(createTaskWrites(history), task, true);
        // The steps are written after the choice, and said once written.
        for (let tries = 0; tries < 40 && !messages.some((message) => String(message[0]).startsWith('Completed 2 steps')); tries += 1) {
          await settle();
        }
        return messages;
      }, 'Complete Steps');
      assert.deepStrictEqual(shown[0], [
        'Completed "Plan the offsite". 2 of its steps are still open.',
        'Complete Steps',
        'Undo',
      ]);
      assert.strictEqual(
        await readNote(uri),
        `- [x] Plan the offsite ✅ ${today}\n  - [x] Book the venue ✅ ${today}\n  - [x] Pay\n  - [x] Draft the email ✅ ${today}\n- [ ] Next\n`,
      );
      assert.strictEqual(history.lastWrite?.label, 'completing 2 steps of "Plan the offsite"');
      assert.ok(shown.some((message) => message[0] === 'Completed 2 steps of "Plan the offsite".'));
    } finally {
      await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
    }
  });

  test('a repeating task’s steps come back, unchecked, with its next occurrence', async () => {
    const content = '- [ ] Weekly review 📅 2026-09-10 🔁 every week\n  - [x] Inbox to zero ✅ 2026-09-09\n  - [ ] Plan the week\n';
    const { uri, root } = await createNote('weekly.md', content);
    try {
      const [task] = parseMarkdown(uri.fsPath, content).tasks;
      await withMessages(async () => {
        await toggleTask(createTaskWrites(history), task, true);
      }, 'Undo');
      await settle();
      await settle();
      assert.strictEqual(await readNote(uri), content, 'Undo takes back the next occurrence and its steps too');
      await withMessages(() => toggleTask(createTaskWrites(history), task, true));
      assert.strictEqual(
        await readNote(uri),
        [
          '- [ ] Weekly review 📅 2026-09-17 🔁 every week',
          '  - [ ] Inbox to zero',
          '  - [ ] Plan the week',
          `- [x] Weekly review 📅 2026-09-10 🔁 every week ✅ ${today}`,
          '  - [x] Inbox to zero ✅ 2026-09-09',
          '  - [ ] Plan the week',
          '',
        ].join('\n'),
      );
    } finally {
      await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
    }
  });

  test('Toggle Task Done brings the steps back with the next occurrence too', () => {
    const lines = ['- [ ] Weekly review 📅 2026-09-10 🔁 every week', '  - [x] Inbox ✅ 2026-09-09'];
    const result = toggleTaskLines([{ line: 0, text: lines[0] }], Date.now(), {
      addDoneDate: false,
      format: 'emoji',
      eol: '\n',
      documentLines: lines,
    });
    assert.deepStrictEqual(result.lines[0].after.split('\n').slice(0, 2), [
      '- [ ] Weekly review 📅 2026-09-17 🔁 every week',
      '  - [ ] Inbox',
    ]);
  });

  test('a task without steps says what it always did', async () => {
    const content = '- [ ] Alone\n';
    const { uri, root } = await createNote('alone.md', content);
    try {
      const [task] = parseMarkdown(uri.fsPath, content).tasks;
      const shown = await withMessages(async (messages) => {
        await toggleTask(createTaskWrites(history), task, true);
        return messages;
      });
      assert.deepStrictEqual(shown[0], ['Completed "Alone".', 'Undo']);
    } finally {
      await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
    }
  });
});

suite('Break into Steps from the board', () => {
  test('the board asks for steps with the task id alone', () => {
    assert.deepStrictEqual(parseTaskBoardMessage({ type: 'breakIntoSteps', taskId: 'task-1' }), {
      type: 'breakIntoSteps',
      taskId: 'task-1',
    });
    assert.strictEqual(parseTaskBoardMessage({ type: 'breakIntoSteps' }), undefined);
    assert.strictEqual(parseTaskBoardMessage({ type: 'breakIntoSteps', taskId: 'x', extra: 1 }), undefined);
  });
});
