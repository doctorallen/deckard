import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { ParsedFile, WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import {
  findLinkProblems,
  findMissingNoteNames,
} from '../ui/commands/linkHealth';
import { linkMentions } from '../ui/commands/unlinkedMentions';
import {
  findDailyNoteActions,
  findEmbedProblems,
  findTaskDependencies,
  findUnlinkedMentions,
} from '../ui/state/editorLensState';

suite('Editor lenses', () => {
  suite('task dependencies', () => {
    const index = createIndex({
      'notes/Plan.md': [
        '# Plan',
        '- [ ] Draft the memo 🆔 memo',
        '- [ ] Send the memo ⛔ memo 🆔 send',
        '- [ ] Book the room ⛔ room',
        '- [ ] Just a task',
        '- [x] Old step 🆔 old',
        '- [ ] After the old step ⛔ old',
      ].join('\n'),
      'notes/Other.md': [
        '# Other',
        '- [ ] Review the memo ⛔ memo',
        '- [x] Done already ⛔ send',
        '- [ ] Follow up ⛔ send, send',
      ].join('\n'),
    });
    const plan = index.files.get('notes/Plan.md') as ParsedFile;
    const byLine = new Map(
      findTaskDependencies(plan, index).map((task) => [task.line, task]),
    );
    const titles = (tasks: { title: string }[]) =>
      tasks.map((task) => task.title.trim()).sort();

    test('counts the open tasks that wait on a task, across notes', () => {
      assert.deepStrictEqual(titles(byLine.get(1)?.blocking ?? []), [
        'Review the memo',
        'Send the memo',
      ]);
      assert.deepStrictEqual(byLine.get(1)?.waitingOn, []);
    });

    test('counts what a task waits on, and what it holds up, once each', () => {
      const send = byLine.get(2);
      assert.deepStrictEqual(titles(send?.waitingOn ?? []), ['Draft the memo']);
      // The done task no longer waits, and naming "send" twice is one wait.
      assert.deepStrictEqual(titles(send?.blocking ?? []), ['Follow up']);
    });

    test('names a ⛔ id no task carries', () => {
      assert.deepStrictEqual(byLine.get(3)?.missingIds, ['room']);
    });

    test('shows nothing for a task with no dependency, or none still open', () => {
      assert.ok(!byLine.has(4), 'a plain task');
      assert.ok(!byLine.has(5), 'a done task blocks nothing');
      assert.ok(!byLine.has(6), 'waiting only on a done task');
    });

    test('shows nothing for a note without dependencies', () => {
      const note = parseMarkdown('notes/Loose.md', '# Loose\n- [ ] One\n- [ ] Two');
      assert.deepStrictEqual(findTaskDependencies(note, index), []);
    });

    test('reads the note being edited, not the index, for its own tasks', () => {
      // An unsaved edit that completes the memo draft frees the send.
      const edited = parseMarkdown(
        'notes/Plan.md',
        plan.content.replace('- [ ] Draft the memo', '- [x] Draft the memo'),
      );
      const send = findTaskDependencies(edited, index).find(
        (task) => task.line === 2,
      );
      assert.deepStrictEqual(send?.waitingOn ?? [], []);
    });
  });

  suite('daily notes', () => {
    const index = createIndex({
      'notes/2026-09-18.md': '# 2026-09-18\n- [ ] Call the vendor\n- [x] Done already',
      'notes/2026-09-21.md': '# 2026-09-21\n- [ ] Write the brief\n- [ ] Book travel',
      'notes/2026-09-22.md': '# 2026-09-22\n- [ ] Book travel\n',
      'notes/Plan.md': '# Plan\n- [ ] Not a daily task',
    });
    const note = (filePath: string) => index.files.get(filePath) as ParsedFile;

    test("offers today's note the unfinished tasks it does not already hold", () => {
      const actions = findDailyNoteActions(
        note('notes/2026-09-22.md'),
        index,
        '2026-09-22',
      );
      assert.deepStrictEqual(
        actions?.carryIn.map((task) => task.title.trim()),
        // "Book travel" was carried already; the done task stays behind.
        ['Call the vendor', 'Write the brief'],
      );
      assert.strictEqual(actions?.previous, '2026-09-21');
      assert.strictEqual(actions?.next, undefined);
    });

    test('offers an earlier daily note only its neighbors', () => {
      const actions = findDailyNoteActions(
        note('notes/2026-09-21.md'),
        index,
        '2026-09-22',
      );
      assert.deepStrictEqual(actions?.carryIn, []);
      assert.strictEqual(actions?.previous, '2026-09-18');
      assert.strictEqual(actions?.next, '2026-09-22');
    });

    test('reaches only as far back as the lookback allows', () => {
      const actions = findDailyNoteActions(
        note('notes/2026-09-22.md'),
        index,
        '2026-09-22',
        2,
      );
      assert.deepStrictEqual(
        actions?.carryIn.map((task) => task.title.trim()),
        ['Write the brief'],
      );
    });

    test('shows nothing for a note that is not a daily note', () => {
      assert.strictEqual(
        findDailyNoteActions(note('notes/Plan.md'), index, '2026-09-22'),
        undefined,
      );
    });

    test('shows nothing for a lone daily note with nothing to carry', () => {
      const alone = createIndex({ 'notes/2026-09-22.md': '# 2026-09-22\n' });
      assert.strictEqual(
        findDailyNoteActions(
          alone.files.get('notes/2026-09-22.md') as ParsedFile,
          alone,
          '2026-09-22',
        ),
        undefined,
      );
    });
  });

  suite('link problems', () => {
    const index = createIndex({
      'notes/Atlas.md': '# Atlas',
      'notes/a/Log.md': '# Log',
      'notes/b/Log.md': '# Log',
    });
    const names = (content: string) =>
      findMissingNoteNames(findLinkProblems(content, index, 'notes/Here.md'));

    test('names each missing note once, whatever its case', () => {
      assert.deepStrictEqual(
        names('[[Vendor]] and [[vendor#Terms]], then [[Budget|the budget]]'),
        ['Vendor', 'Budget'],
      );
    });

    test('does not offer to create a note for a name several notes share', () => {
      const problems = findLinkProblems('[[Log]]', index, 'notes/Here.md');
      assert.strictEqual(problems.length, 1, 'the link is still a problem');
      assert.deepStrictEqual(findMissingNoteNames(problems), []);
    });

    test('finds nothing to create when every link opens a note', () => {
      assert.deepStrictEqual(
        findLinkProblems('[[Atlas]] and [[#Heading]]', index, 'notes/Here.md'),
        [],
      );
    });
  });

  suite('embeds', () => {
    const index = createIndex({
      'notes/Atlas.md': '# Atlas\n## Decision\nWe chose it. ^choice',
    });
    const here = parseMarkdown(
      'notes/Here.md',
      [
        '# Here',
        '![[Atlas#Decision]]',
        '![[Atlas#Gone]]',
        '![[Atlas#^nope]]',
        '![[Missing#Anything]]',
        '![[#Here]]',
        '![[#Nowhere]]',
        '![[photo.png]]',
        'Inline ![[Atlas#Gone]] is only text.',
        '```',
        '![[Atlas#Gone]]',
        '```',
        '![[Atlas#^choice]]',
      ].join('\n'),
    );

    test('names each embed the preview cannot draw, and the note it names', () => {
      assert.deepStrictEqual(findEmbedProblems(here, index), [
        {
          line: 2,
          reason: 'Atlas has no heading "Gone"',
          filePath: 'notes/Atlas.md',
        },
        {
          line: 3,
          reason: 'Nothing in Atlas is marked ^nope',
          filePath: 'notes/Atlas.md',
        },
        { line: 6, reason: 'This note has no heading "Nowhere"' },
      ]);
    });

    test('shows nothing for a note whose embeds all draw', () => {
      const fine = parseMarkdown('notes/Fine.md', '# Fine\n![[Atlas#Decision]]');
      assert.deepStrictEqual(findEmbedProblems(fine, index), []);
    });
  });

  suite('unlinked mentions', () => {
    const index = createIndex({
      'notes/Atlas.md':
        '---\naliases: [Atlas Program]\n---\n# Atlas\nAtlas mentions itself.',
      'notes/Log.md': [
        '# Log about Atlas',
        'The atlas plan and the Atlas Program launch.',
        'Already [[Atlas]] linked, `Atlas` code, #atlas tag, [Atlas](https://x.test/Atlas).',
        'Atlases and MyAtlas do not count.',
        '```',
        'Atlas',
        '```',
      ].join('\n'),
      'notes/Other.md': '---\nproject: Atlas\n---\nSee Atlas.',
      'notes/a/Plan.md': '# Plan',
      'notes/b/Plan.md': '# Plan\nThe Plan is shared.',
      'notes/AI.md': '# AI',
      'notes/Talk.md': 'Some AI talk and a Plan.',
    });
    const mentionsOf = (filePath: string) =>
      findUnlinkedMentions(index.files.get(filePath) as ParsedFile, index).map(
        (mention) => [
          mention.filePath,
          mention.line,
          mention.startColumn,
          mention.endColumn,
          mention.text,
        ],
      );

    // Every other Atlas in the fixture is in a link, code, a tag, a Markdown
    // link, a heading, front matter, part of a word, or the note itself.
    test('finds the title and aliases in other notes, as written, and only in prose', () => {
      assert.deepStrictEqual(mentionsOf('notes/Atlas.md'), [
        ['notes/Log.md', 1, 4, 9, 'atlas'],
        ['notes/Log.md', 1, 23, 36, 'Atlas Program'],
        ['notes/Other.md', 3, 4, 9, 'Atlas'],
      ]);
    });

    test('does not look for a name another note shares, or a short one', () => {
      assert.deepStrictEqual(mentionsOf('notes/a/Plan.md'), []);
      assert.deepStrictEqual(mentionsOf('notes/AI.md'), []);
    });

    test('shows nothing for a note no other note names', () => {
      assert.deepStrictEqual(mentionsOf('notes/Talk.md'), []);
    });

    test('links each mention as written, and leaves one changed since alone', async () => {
      const root = vscode.Uri.file(
        path.join(os.tmpdir(), `deckard-mentions-${Date.now()}`),
      );
      const atlas = vscode.Uri.joinPath(root, 'Atlas.md');
      const log = vscode.Uri.joinPath(root, 'Log.md');
      const indexed = 'The atlas plan.\nAtlas again.\n';
      await vscode.workspace.fs.writeFile(atlas, Buffer.from('# Atlas\n', 'utf8'));
      // The second line changed after the index read it.
      await vscode.workspace.fs.writeFile(
        log,
        Buffer.from('The atlas plan.\nThe atlas moved.\n', 'utf8'),
      );
      const snapshot = createIndex({
        [atlas.fsPath]: '# Atlas\n',
        [log.fsPath]: indexed,
      });
      try {
        await linkMentions(
          {
            ready: Promise.resolve(),
            getSnapshot: () => snapshot,
            parse: (uri, content) => parseMarkdown(uri.fsPath, content),
            refresh: async () => undefined,
          },
          atlas,
        );
        const written = (await vscode.workspace.openTextDocument(log)).getText();
        assert.strictEqual(written, 'The [[atlas]] plan.\nThe atlas moved.\n');
      } finally {
        await vscode.workspace.fs.delete(root, { recursive: true });
      }
    });
  });
});

function createIndex(files: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(
      Object.entries(files).map(([filePath, content]) => [
        filePath,
        parseMarkdown(filePath, content),
      ]),
    ),
  );
}
