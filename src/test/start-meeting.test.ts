import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import type { MeetingNote, MeetingSubject } from '../domain/notes/meetings';
import { buildMeetingItems, readMeetingPicks, writeMeeting } from '../ui/commands/startMeeting';
import { WorkspaceWriteHistory } from '../ui/commands/workspaceWrites';
import { useDiskWorkspace } from './diskWorkspace';

/**
 * Start a Meeting's list (docs/implementation/49-meetings-and-types.md):
 * the rows it offers, and what Enter picks from them.
 */
suite('Start a Meeting: its list and what it writes', () => {
  const subjects: MeetingSubject[] = [
    { tag: { key: '#project/borealis', label: '#project/borealis' }, hubPath: 'projects/Borealis.md', score: 2 },
    { tag: { key: '@priya', label: '@priya' }, score: 1 },
  ];
  const notes: MeetingNote[] = [{ filePath: 'Weekly staff.md', title: 'Weekly staff', lastDay: '2026-11-12' }];

  // In the extension host the suite runs against VS Code; under the e2e
  // stand-in, against a workspace on disk modeled on it.
  let putBack: () => void = () => undefined;
  suiteSetup(() => {
    putBack = useDiskWorkspace();
  });
  suiteTeardown(() => putBack());

  /** Notes on disk under a folder of their own, removed when `run` ends. */
  const withNotes = async (
    notes: Record<string, string>,
    run: (uriOf: (filePath: string) => vscode.Uri, read: (filePath: string) => Promise<string>) => Promise<void>,
  ): Promise<void> => {
    const root = vscode.Uri.file(path.join(os.tmpdir(), `deckard-meeting-${Date.now()}-${Math.random().toString(36).slice(2)}`));
    const uriOf = (filePath: string): vscode.Uri => vscode.Uri.joinPath(root, ...filePath.split('/'));
    try {
      for (const [filePath, content] of Object.entries(notes)) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uriOf(filePath), '..'));
        await vscode.workspace.fs.writeFile(uriOf(filePath), Buffer.from(content, 'utf8'));
      }
      await run(uriOf, async (filePath) => Buffer.from(await vscode.workspace.fs.readFile(uriOf(filePath))).toString('utf8'));
    } finally {
      await vscode.workspace.fs.delete(root, { recursive: true, useTrash: false });
    }
  };

  test('lists today\'s note first, then subjects, meeting notes, and a note of its own', () => {
    const items = buildMeetingItems(subjects, notes);
    assert.deepStrictEqual(
      items.map((item) => [item.label, item.description, item.pick?.kind]),
      [
        ['$(calendar) No one thing', 'in today\'s note', 'today'],
        ['Written about lately', undefined, undefined],
        ['#project/borealis', 'in Borealis', 'subject'],
        ['@priya', 'in a new hub note', 'subject'],
        ['Meeting notes', undefined, undefined],
        ['$(note) Weekly staff', 'last held 2026-11-12', 'note'],
        ['$(new-file) A note of its own…', 'for a meeting that recurs', 'ownNote'],
      ],
    );
    // Enter with nothing checked takes the row the cursor is on; with rows checked, those, in order.
    assert.deepStrictEqual(readMeetingPicks([], [items[2]]), [items[2].pick]);
    assert.deepStrictEqual(readMeetingPicks([items[3], items[2]], [items[0]]), [items[3].pick, items[2].pick]);
    assert.deepStrictEqual(readMeetingPicks([], []), []);
  });

  test('writes a meeting in its subject\'s note and links today\'s note to it, as one change', async () => {
    await withNotes(
      {
        'projects/Borealis.md': '# Borealis\nThe cold-chain tracker.\n\n## 2026-11-09 Kickoff\nTwo depots.\n',
        'journal/2026-11-16.md': '# 2026-11-16\n\n- [ ] Send the depot list\n',
      },
      async (uriOf, read) => {
        const history = new WorkspaceWriteHistory();
        const written = await writeMeeting(history, {
          heading: '2026-11-16 10:00 Vendor sync @priya',
          time: '10:00',
          todayUri: uriOf('journal/2026-11-16.md'),
          homeUri: uriOf('projects/Borealis.md'),
          pathOf: (uri) => (uri.path.endsWith('Borealis.md') ? 'projects/Borealis.md' : 'journal/2026-11-16.md'),
        });
        assert.strictEqual(
          await read('projects/Borealis.md'),
          '# Borealis\nThe cold-chain tracker.\n\n## 2026-11-09 Kickoff\nTwo depots.\n\n## 2026-11-16 10:00 Vendor sync @priya\n\n',
        );
        assert.strictEqual(
          await read('journal/2026-11-16.md'),
          '# 2026-11-16\n\n- [ ] Send the depot list\n- 10:00 [[Borealis#2026-11-16 10:00 Vendor sync]]\n',
        );
        assert.strictEqual(written?.cursorLine, 8, 'the empty line under the heading, where its notes begin');
        assert.strictEqual(written?.document.uri.path, uriOf('projects/Borealis.md').path);

        assert.ok(await history.undo(), 'one Undo takes back both notes');
        assert.strictEqual(await read('projects/Borealis.md'), '# Borealis\nThe cold-chain tracker.\n\n## 2026-11-09 Kickoff\nTwo depots.\n');
        assert.strictEqual(await read('journal/2026-11-16.md'), '# 2026-11-16\n\n- [ ] Send the depot list\n');
      },
    );
  });

  test('writes a meeting about no one thing in today\'s note, with no link', async () => {
    await withNotes({ 'journal/2026-11-16.md': '# 2026-11-16\n' }, async (uriOf, read) => {
      const written = await writeMeeting(new WorkspaceWriteHistory(), {
        heading: '10:00 Vendor sync #project/borealis',
        time: '10:00',
        todayUri: uriOf('journal/2026-11-16.md'),
        pathOf: () => 'journal/2026-11-16.md',
      });
      assert.strictEqual(await read('journal/2026-11-16.md'), '# 2026-11-16\n\n## 10:00 Vendor sync #project/borealis\n\n');
      assert.strictEqual(written?.cursorLine, 4);
    });
  });

  test('with nothing written about lately, still offers today\'s note and a note of its own', () => {
    assert.deepStrictEqual(
      buildMeetingItems([], []).map((item) => item.pick?.kind),
      ['today', undefined, 'ownNote'],
    );
  });
});
