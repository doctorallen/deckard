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

suite('Parent tags beside the task line and hub notes', () => {
  const hubbed = indexOf({
    'Atlas.md': ['---', 'describes: project/atlas', '---', '# Atlas', '- [ ] in the hub'],
    '2026-10-13.md': [
      '# 2026-10-13',
      '- [ ] call ren #project/atlas',
      '- [ ] errand #context/phone',
      '- [ ] both #context/phone #project/atlas',
      '- [ ] pair with #project/atlas today',
      '## Web #team/web',
      '- [ ] hubbed #project/atlas',
      '- [ ] mixed #context/phone',
    ],
  });

  /** The parent tag's key for the task named in the hubbed index, or none. */
  function parentIn(word: string, groupNamespace?: string): string | undefined {
    const task = [...hubbed.tasks.values()].find((each) => each.title.startsWith(word));
    assert.ok(task, `a task named ${word}`);
    return findParentTag(hubbed, task, { ...(groupNamespace ? { groupNamespace } : {}) })?.key;
  }

  test('a tag the line writes is never lifted, at its end or in its words, hub note or not', () => {
    assert.strictEqual(parentIn('call'), undefined, 'a daily note with no heading has nothing above it');
    assert.strictEqual(parentIn('both'), undefined);
    assert.strictEqual(parentIn('errand'), undefined);
    assert.strictEqual(parentIn('pair'), undefined);
  });

  test('a task under a tagged heading takes the heading tag, whatever its line ends with', () => {
    assert.strictEqual(parentIn('hubbed'), '#team/web', 'its own hub tag is in its title');
    assert.strictEqual(parentIn('mixed'), '#team/web');
  });

  test('a task in a hub note is under the tag the note describes', () => {
    assert.strictEqual(parentIn('in the hub'), '#project/atlas');
  });

  test('a card reads the same whether its line ends with its tag or with a period after it', () => {
    const punctuated = indexOf({
      'Atlas.md': ['---', 'describes: project/atlas', '---', '# Atlas'],
      'work.md': ['# Work', '## Web #team/web', '- [ ] Ask the leads about #project/atlas', '- [ ] Ask the leads about #project/atlas.'],
    });
    const cards = layoutTaskBoard({ index: punctuated, tasks: [...punctuated.tasks.values()], requestedGroupBy: 'status', options: { ...options, parentTag: true } })
      .columns.flatMap((column) => column.cards);
    assert.deepStrictEqual(
      cards.map((card) => [card.title, card.parentTag?.key, card.titleTags.map((tag) => tag.key)]),
      [
        ['Ask the leads about #project/atlas', '#team/web', ['#project/atlas']],
        ['Ask the leads about #project/atlas.', '#team/web', ['#project/atlas']],
      ],
    );
  });

  test('the grouped namespace is skipped in every step', () => {
    assert.strictEqual(parentIn('hubbed', 'team'), undefined);
    assert.strictEqual(parentIn('in the hub', 'project'), undefined);
  });
});
