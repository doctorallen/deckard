import * as assert from 'assert';

import * as vscode from 'vscode';

import { Task, WorkspaceIndex } from '../core/types';
import {
  TaskMetadataCompletionProvider,
  TaskMetadataSuggestionSettings,
} from '../ui/commands/taskMetadataSuggestions';

/** Sunday 2026-09-13, mid-morning. */
const now = new Date(2026, 8, 13, 9).getTime();

suite('Task metadata suggestions', () => {
  const createProvider = (
    settings: TaskMetadataSuggestionSettings = { enabled: true, format: 'emoji' },
  ): TaskMetadataCompletionProvider =>
    new TaskMetadataCompletionProvider(
      { ready: Promise.resolve(), getSnapshot: createIndex },
      () => settings,
      () => now,
    );
  const suggest = (
    provider: TaskMetadataCompletionProvider,
    text: string,
    line = 0,
  ): Thenable<vscode.CompletionItem[]> =>
    provider.provideCompletionItems(
      createDocument(text),
      new vscode.Position(line, text.split('\n')[line].length),
    );

  test('offers emoji metadata after a slash in a task', async () => {
    const provider = createProvider();
    const items = await suggest(provider, '- [ ] Send the proposal /du');

    const due = find(items, 'due today');
    assert.strictEqual(due?.insertText, '📅 2026-09-13');
    assert.strictEqual(due?.filterText, '/due today');
    assert.ok(due?.range instanceof vscode.Range);
    assert.strictEqual(due.range.start.character, 24);
    assert.strictEqual(find(items, 'due in a week')?.insertText, '📅 2026-09-20');
    assert.strictEqual(find(items, 'high priority')?.insertText, '⏫');
    assert.strictEqual(
      find(items, 'repeats every week')?.insertText,
      '🔁 every week',
    );
    assert.strictEqual(
      find(items, 'depends on utility-plan')?.insertText,
      '⛔ utility-plan',
    );
    // A finished task is not worth depending on.
    assert.strictEqual(find(items, 'depends on radio-split'), undefined);

    const onDate = find(items, 'due on a date')?.insertText;
    assert.ok(onDate instanceof vscode.SnippetString);
    assert.strictEqual(onDate.value, '📅 ${1:2026-09-13}');
    provider.dispose();
  });

  test('writes the Dataview format when the task or the setting uses it', async () => {
    const emojiSetting = createProvider();
    assert.strictEqual(
      find(await suggest(emojiSetting, '- [ ] Send [priority:: high] /'), 'due today')
        ?.insertText,
      '[due:: 2026-09-13]',
    );

    const dataviewSetting = createProvider({ enabled: true, format: 'dataview' });
    assert.strictEqual(
      find(await suggest(dataviewSetting, '- [ ] Send /'), 'high priority')
        ?.insertText,
      '[priority:: high]',
    );
    // A task already written with emoji keeps them.
    assert.strictEqual(
      find(await suggest(dataviewSetting, '- [ ] Send 📅 2026-09-20 /'), 'high priority')
        ?.insertText,
      '⏫',
    );
    emojiSetting.dispose();
    dataviewSetting.dispose();
  });

  test('stays quiet away from task text', async () => {
    const provider = createProvider();
    assert.deepStrictEqual(await suggest(provider, '- Send /'), []);
    assert.deepStrictEqual(await suggest(provider, 'Some prose /'), []);
    assert.deepStrictEqual(await suggest(provider, '- [ ] Review a/b'), []);
    assert.deepStrictEqual(
      await suggest(provider, '```\n- [ ] Send /\n```', 1),
      [],
    );

    const disabled = createProvider({ enabled: false, format: 'emoji' });
    assert.deepStrictEqual(await suggest(disabled, '- [ ] Send /'), []);
    provider.dispose();
    disabled.dispose();
  });
});

function find(
  items: vscode.CompletionItem[],
  label: string,
): vscode.CompletionItem | undefined {
  return items.find(
    (item) =>
      (typeof item.label === 'string' ? item.label : item.label.label) === label,
  );
}

function createIndex(): WorkspaceIndex {
  const tasks: Task[] = [
    createTask({ id: 'utility', dependencyId: 'utility-plan' }),
    createTask({ id: 'radio', dependencyId: 'radio-split', completed: true }),
  ];
  return {
    files: new Map(),
    sections: new Map(),
    tasks: new Map(tasks.map((task) => [task.id, task])),
    tags: new Map(),
    entities: new Map(),
    updatedAt: Date.now(),
  };
}

function createTask(values: Partial<Task> & { id: string }): Task {
  return {
    filePath: 'notes/tasks.md',
    title: values.id,
    completed: false,
    tags: [],
    tagLabels: {},
    lineNumber: 1,
    checkboxColumn: 3,
    checkboxValue: ' ',
    sourceLineText: '- [ ] task',
    ...values,
  };
}

function createDocument(text: string): vscode.TextDocument {
  const lines = text.split(/\r?\n/);
  return {
    uri: vscode.Uri.file('/tmp/deckard/notes/case.md'),
    getText: () => text,
    lineAt: (line: number) => ({ text: lines[line] }),
  } as unknown as vscode.TextDocument;
}
