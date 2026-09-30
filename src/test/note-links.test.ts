import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { WorkspaceIndex } from '../core/types';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { collectNoteLinks, createLinksSearchQuery } from '../ui/state/noteLinks';
import { createSidebarSnapshot } from '../ui/state/relatedNotesRanking';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 25, 12).getTime();

function createIndex(notes: Record<string, string>, updated: Record<string, number> = {}): WorkspaceIndex {
  const files = new Map(
    Object.entries(notes).map(([path, content]) => [
      path,
      parseMarkdown(path, content, updated[path] !== undefined ? { updatedAt: updated[path] } : undefined),
    ]),
  );
  return buildWorkspaceIndex(files);
}

suite('What links to a note', () => {
  test('lists each linking line under its headings, and each mention without a link', () => {
    const index = createIndex({
      'notes/Atlas.md': '# Atlas\nThe plan.\n',
      'notes/Standup.md': '# Standup\n## Decisions\nWe moved [[Atlas]] to Q4.\n',
      'notes/Budget.md': '# Budget\nAtlas needs more time.\n',
    });
    const links = collectNoteLinks(index, index.files.get('notes/Atlas.md')!, { now: NOW });

    assert.strictEqual(links.linkedFromCount, 1);
    assert.strictEqual(links.linkedFromNoteCount, 1);
    assert.deepStrictEqual(links.linkedFromNotes[0].entries[0], {
      filePath: 'notes/Standup.md',
      title: 'Standup',
      line: 3,
      text: 'We moved [[Atlas]] to Q4.',
      headingPath: ['Decisions'],
      sectionText: 'We moved [[Atlas]] to Q4.',
    });
    assert.strictEqual(links.mentionCount, 1);
    assert.deepStrictEqual(
      [links.mentions[0].filePath, links.mentions[0].line, links.mentions[0].name, links.mentions[0].startColumn],
      ['notes/Budget.md', 2, 'Atlas', 0],
    );
  });

  test('groups the lines by note, newest updated first, and counts notes', () => {
    const index = createIndex(
      {
        'notes/Atlas.md': '# Atlas\n',
        'notes/Old.md': '# Old\nSee [[Atlas]].\n',
        'notes/Standup.md': '# Standup\n## Risks\n[[Atlas]] depends on sign-off.\n## Decisions\nWe moved [[Atlas]] to Q4.\n',
      },
      { 'notes/Old.md': NOW - 40 * DAY, 'notes/Standup.md': NOW - 3 * DAY },
    );
    const links = collectNoteLinks(index, index.files.get('notes/Atlas.md')!, { now: NOW });
    assert.deepStrictEqual(
      links.linkedFromNotes.map((group) => [group.title, group.linkCount, group.entries.map((entry) => entry.line)]),
      [
        ['Standup', 2, [3, 5]],
        ['Old', 1, [2]],
      ],
    );
    assert.strictEqual(links.linkedFromNotes[0].updatedLabel, '3 days ago');
    assert.strictEqual(links.linkedFromCount, 3);
    assert.strictEqual(links.linkedFromNoteCount, 2);
  });

  test('unfolds a line onto its section, cut at fifteen lines', () => {
    const body = Array.from({ length: 20 }, (_, index) => `Line ${index + 1}`).join('\n');
    const index = createIndex({
      'notes/Atlas.md': '# Atlas\n',
      'notes/Long.md': `# Long\nSee [[Atlas]].\n${body}\n## Next\nNot this.\n`,
    });
    const entry = collectNoteLinks(index, index.files.get('notes/Atlas.md')!, { now: NOW }).linkedFromNotes[0].entries[0];
    const lines = entry.sectionText?.split('\n') ?? [];
    assert.strictEqual(lines.length, 15);
    assert.strictEqual(lines[0], 'See [[Atlas]].');
    assert.ok(entry.sectionText?.endsWith('Line 14…'));
    assert.ok(!entry.sectionText?.includes('Not this'));
  });

  test('opens as the search for what links here', () => {
    assert.strictEqual(createLinksSearchQuery({ filePath: 'notes/Atlas plan.md' }), 'link = [[Atlas plan]]');
    assert.strictEqual(
      createLinksSearchQuery({ filePath: 'notes/Atlas plan.md' }, true),
      'link = [[Atlas plan]] -is:periodic',
    );
  });

  test('leaves daily and weekly notes out when asked, and counts them', () => {
    const index = createIndex({
      'notes/Atlas.md': '# Atlas #project/atlas\n',
      'notes/2026-09-24.md': '# Thursday #project/atlas\nSee [[Atlas]].\n',
      'notes/week-2026-09-20-2026-09-26.md': '# Week #project/atlas\nSee [[Atlas]].\n',
      'notes/Budget.md': '# Budget #project/atlas\nSee [[Atlas]].\n',
    });
    const atlas = index.files.get('notes/Atlas.md')!;
    const all = collectNoteLinks(index, atlas, { now: NOW });
    assert.strictEqual(all.linkedFromNoteCount, 3);
    assert.strictEqual(all.hiddenDailyNoteCount, undefined);
    const hidden = collectNoteLinks(index, atlas, { now: NOW, hideDailyNotes: true });
    assert.deepStrictEqual(hidden.linkedFromNotes.map((group) => group.title), ['Budget']);
    assert.strictEqual(hidden.hiddenDailyNoteCount, 2);
    assert.strictEqual(hidden.linkedFromCount, 1);

    const ranked = (hidePeriodicNotes: boolean) =>
      createSidebarSnapshot(index, atlas.filePath, atlas, {
        now: Date.now(),
        enableKeywordLinks: true,
        relatedNotesSortMode: 'tags',
        sectionAccessCounts: {},
        tagTitleDisplayMode: 'inline',
        rankingOptions: { hidePeriodicNotes,
      } })
        .notes.map((note) => note.filePath)
        .sort();
    assert.deepStrictEqual(ranked(false), ['notes/2026-09-24.md', 'notes/Budget.md', 'notes/week-2026-09-20-2026-09-26.md']);
    assert.deepStrictEqual(ranked(true), ['notes/Budget.md']);
  });
});
