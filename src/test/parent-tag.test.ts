import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createQueryContext } from '../domain/query/queryContext';
import { findParentTag } from '../domain/tasks/parentTag';
import { createTaskBoard, layoutTaskBoard, type TaskBoardOptions } from '../ui/state/taskBoardState';
import type { TaskBoardGroupBy, WorkspaceIndex } from '../domain/model';
import { createPreferences } from './preferenceServices';

/** An index of the notes given, each as its lines. */
function indexOf(notes: Record<string, readonly string[]>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(Object.entries(notes).map(([file, lines]) => [file, parseMarkdown(file, lines.join('\n'))])),
  );
}

const index = indexOf({
  'atlas.md': [
    '---',
    'tags: [area/work]',
    '---',
    '# Atlas',
    '- [ ] loose',
    '## Launch #project/atlas',
    '- [ ] brief',
    '- [ ] own #project/atlas',
    '### Copy',
    '- [ ] headline',
    '## Doing #status/doing #team/web',
    '- [ ] styled',
  ],
  'plain.md': ['# Plain', '- [ ] alone'],
});

const options: TaskBoardOptions = {
  queryContext: createQueryContext(new Date(2026, 9, 6).getTime()),
  format: 'emoji',
};

/** The task whose title starts with the word given. */
function taskNamed(word: string) {
  const task = [...index.tasks.values()].find((each) => each.title.startsWith(word));
  assert.ok(task, `a task named ${word}`);
  return task;
}

/** The parent tag's key for the task named, or none. */
function parentOf(word: string, groupNamespace?: string): string | undefined {
  return findParentTag(index, taskNamed(word), { ...(groupNamespace ? { groupNamespace } : {}) })?.key;
}

suite('Parent tags', () => {
  test('a task takes the tag of the nearest tagged heading above it', () => {
    assert.strictEqual(parentOf('brief'), '#project/atlas');
    assert.strictEqual(parentOf('headline'), '#project/atlas', 'an untagged heading passes to the one above it');
  });

  test('a task under no tagged heading takes its note front matter tag, and a plain note gives none', () => {
    assert.strictEqual(parentOf('loose'), '#area/work');
    assert.strictEqual(parentOf('alone'), undefined);
  });

  test('a tag the card already says is skipped: its own line and the grouped namespace', () => {
    assert.strictEqual(parentOf('own'), '#area/work', 'its own line writes #project/atlas');
    assert.strictEqual(parentOf('styled'), '#status/doing', 'a status tag is a tag like any other');
    assert.strictEqual(parentOf('styled', 'status'), '#team/web', 'columns grouped by status tags already name it');
    assert.strictEqual(parentOf('brief', 'project'), '#area/work', 'columns grouped by project already name it');
  });

  test('cards carry the parent tag only when the board shows them', () => {
    const cards = (boardOptions: TaskBoardOptions, groupBy: TaskBoardGroupBy = 'status', namespace?: string) =>
      layoutTaskBoard({ index, tasks: [...index.tasks.values()], requestedGroupBy: groupBy, options: boardOptions, namespace })
        .columns.flatMap((column) => column.cards)
        .find((card) => card.taskId === taskNamed('brief').id);
    assert.strictEqual(cards(options)?.parentTag, undefined);
    assert.strictEqual(cards({ ...options, parentTag: true })?.parentTag?.key, '#project/atlas');
    assert.strictEqual(cards({ ...options, parentTag: true }, 'tag', 'project')?.parentTag?.key, '#area/work');
  });

  test('the settings say whether the parent tag shows', () => {
    const store = createPreferences({ get: () => undefined, keys: () => [], update: async () => undefined } as never);
    const preferences = { ...store.reader.value, taskBoardLayout: 'board' as const };
    store.repository.dispose();
    const shown = createTaskBoard({ index, preferences, search: { query: '' }, options: { ...options, parentTag: true } });
    assert.strictEqual(shown.settings.parentTag, true);
    const card = shown.columns.flatMap((column) => column.cards).find((candidate) => candidate.taskId === taskNamed('headline').id);
    assert.strictEqual(card?.parentTag?.key, '#project/atlas');
  });
});
