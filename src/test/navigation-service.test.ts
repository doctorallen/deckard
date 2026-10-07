import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import { NavigationService, SourceLocation, SourcePolicy, TagPolicy } from '../services/navigationService';
import type { SidebarNotesSnapshot } from '../ui/protocol/sidebarNotes';
import { collectNoteLinks } from '../ui/state/noteLinks';
import { createSidebarSnapshot } from '../ui/state/relatedNotesRanking';

// The fixture navigation.e2e.js pins the hosts with: one note of each shape
// the rules tell apart.
const NOTES: Array<[string, string]> = [
  // An entry at line 1, a plain line at 2, and a task at 3.
  ['/notes/atlas.md', '# Atlas #project/relay\nSome words about it.\n- [ ] Call the vendor\n'],
  // No entry; tagged in its front matter only. Line 4 is its text.
  ['/notes/tagged.md', '---\ntags: [relay]\n---\nOnly front matter tags.\n'],
  // No entry and no tag; one link.
  ['/notes/linking.md', 'See [[atlas]] for more.\n'],
  // No entry, no tag, no link.
  ['/notes/plain.md', 'Nothing to see here.\n'],
];

const index = buildWorkspaceIndex(
  new Map(NOTES.map(([filePath, text]) => [filePath, parseMarkdown(filePath, text)])),
);
const entry = [...index.sections.values()].find((section) => section.filePath === '/notes/atlas.md')?.id;
const navigation = new NavigationService();

/** Where each policy lands a line: `visit`, `open`, or `none`. */
const SOURCES: Array<[string, number, Record<SourcePolicy, 'visit' | 'open' | 'none'>]> = [
  ['/notes/atlas.md', 1, { entries: 'visit', graphNodes: 'open', tasks: 'none', notes: 'visit' }],
  ['/notes/atlas.md', 2, { entries: 'none', graphNodes: 'none', tasks: 'none', notes: 'open' }],
  ['/notes/atlas.md', 3, { entries: 'open', graphNodes: 'open', tasks: 'open', notes: 'open' }],
  ['/notes/tagged.md', 1, { entries: 'open', graphNodes: 'open', tasks: 'none', notes: 'open' }],
  ['/notes/tagged.md', 4, { entries: 'none', graphNodes: 'none', tasks: 'none', notes: 'open' }],
  ['/notes/linking.md', 1, { entries: 'none', graphNodes: 'open', tasks: 'none', notes: 'open' }],
  ['/notes/plain.md', 1, { entries: 'none', graphNodes: 'none', tasks: 'none', notes: 'open' }],
  ['/notes/missing.md', 1, { entries: 'none', graphNodes: 'none', tasks: 'none', notes: 'none' }],
];

suite('NavigationService', () => {
  test('opens a line only where its policy accepts it, counting an entry\'s visit where the policy does', () => {
    for (const [filePath, line, expected] of SOURCES) {
      for (const policy of Object.keys(expected) as SourcePolicy[]) {
        const want = {
          visit: { kind: 'open', filePath, line, visit: entry },
          open: { kind: 'open', filePath, line },
          none: { kind: 'unknown' },
        }[expected[policy]];
        assert.deepStrictEqual(
          navigation.resolveSourceLocation(index, filePath, line, policy),
          want,
          `${filePath}:${line} under ${policy}`,
        );
      }
    }
  });

  test('finds a tag as the reader wrote it, or only by its exact key', () => {
    const cases: Array<[string, Record<TagPolicy, string | undefined>]> = [
      ['#project/relay', { lenient: '#project/relay', exact: '#project/relay' }],
      ['project/relay', { lenient: '#project/relay', exact: undefined }],
      ['#Project/Relay', { lenient: '#project/relay', exact: undefined }],
      [' #project/relay ', { lenient: '#project/relay', exact: undefined }],
      ['relay', { lenient: '#relay', exact: undefined }],
      ['#gone', { lenient: undefined, exact: undefined }],
      ['', { lenient: undefined, exact: undefined }],
    ];
    for (const [tagKey, expected] of cases) {
      for (const policy of ['lenient', 'exact'] as TagPolicy[]) {
        const found = expected[policy];
        assert.deepStrictEqual(
          navigation.resolveTag(index, tagKey, policy),
          found === undefined ? { kind: 'unknown' } : { kind: 'open', tagKey: found },
          `${JSON.stringify(tagKey)} under ${policy}`,
        );
      }
    }
  });
});

// Related Notes' rows: a note shares a tag with atlas, links to it, and
// names it without a link; another only links; a daily note does all
// three; and an untagged note has wording two others share.
const RELATED_NOTES: Array<[string, string]> = [
  ['/notes/atlas.md', '# Atlas #project/relay\nThe plan.\n- [ ] Call the vendor #project/relay\n'],
  ['/notes/standup.md', '# Standup #project/relay\n[[atlas]] depends on sign-off.\nThe atlas review is late.\n## Risks #project/relay\nNone yet.\n'],
  ['/notes/budget.md', '# Budget #finance\nSee [[atlas]].\n'],
  ['/notes/2026-09-24.md', '# Thursday #project/relay\nSee [[atlas]] and the atlas notes.\n'],
  ['/notes/today.md', '# Thursday\nThe northern route audit found Northwind late on deliveries again.\n'],
  ['/notes/audit.md', '# Northwind audit #risk/vendor\nNorthwind deliveries on the northern route are late.\n'],
];

/** The index of the notes given, each dated so the ranking is stable. */
function relatedIndex(notes: Array<[string, string]>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(notes.map(([filePath, text], at) => [filePath, parseMarkdown(filePath, text, { createdAt: 1 + at, updatedAt: 2 + at }, {})])),
  );
}

/** When the rows are built, for the ranking's recency and the links' ages. */
const NOW = 10_000;

/**
 * The rows Related Notes draws for a note, built as the sidebar's
 * createSnapshot builds them for the note in the editor: the ranking,
 * then what links to the note when the index has it.
 */
function relatedRows(index: WorkspaceIndex, filePath: string, hideDailyNotes = false): SidebarNotesSnapshot {
  const file = index.files.get(filePath);
  const snapshot = createSidebarSnapshot(index, filePath, file, {
    now: NOW,
    enableKeywordLinks: true,
    relatedNotesSortMode: 'tags',
    sectionAccessCounts: {},
    rankingOptions: { associationMinimumSupport: 1, recencyHalfLifeDays: 0, hidePeriodicNotes: hideDailyNotes, excludedTagNamespaces: ['status'] },
  });
  return file
    ? { ...snapshot, hideDailyNotes, previewLines: 1, links: collectNoteLinks(index, file, { now: NOW, hideDailyNotes }) }
    : { ...snapshot, hideDailyNotes, previewLines: 1 };
}

/**
 * What the sidebar's five handlers accepted before the policy, written as
 * they were: each found its row in a snapshot built for the click. The one
 * change since is that an entry listed as similar wording, for a note with
 * no tags, opens and takes a link as a related note does.
 */
const BEFORE = {
  openSource(snapshot: SidebarNotesSnapshot, filePath: string, line: number): SourceLocation {
    const link = [
      ...(snapshot.links?.linkedFromNotes.flatMap((group) => group.entries) ?? []),
      ...(snapshot.links?.mentions ?? []),
    ].find((candidate) => candidate.filePath === filePath && candidate.line === line);
    if (link) {
      return { kind: 'open', filePath: link.filePath, line: link.line };
    }
    const note = [...snapshot.notes, ...(snapshot.similar?.notes ?? [])].find(
      (candidate) => candidate.filePath === filePath && candidate.sourceLine === line,
    );
    if (!note) {
      return { kind: 'unknown' };
    }
    return { kind: 'open', filePath: note.filePath, line: note.sourceLine, ...(note.sectionId ? { visit: note.sectionId } : {}) };
  },
  insertLink: (snapshot: SidebarNotesSnapshot, filePath: string, line: number) =>
    [...snapshot.notes, ...(snapshot.similar?.notes ?? [])].find(
      (candidate) => candidate.filePath === filePath && candidate.sourceLine === line,
    ),
  linkMention: (snapshot: SidebarNotesSnapshot, filePath: string, line: number, startColumn: number) =>
    snapshot.links?.mentions.find(
      (candidate) => candidate.filePath === filePath && candidate.line === line && candidate.startColumn === startColumn,
    ),
  addSuggestedTag: (snapshot: SidebarNotesSnapshot, tagKey: string) =>
    snapshot.similar?.tags.find((candidate) => candidate.key === tagKey),
  linkAllMentions: (snapshot: SidebarNotesSnapshot) => Boolean(snapshot.links),
};

/**
 * Asserts the policy answers every click the way the old handlers did, for
 * rows built once: every line of every note and of a missing one, every
 * column around each mention, and every tag the index or the rows name.
 * Returns how many clicks each accepted, so a caller can see the rows were
 * not empty.
 */
function assertSameAsBefore(index: WorkspaceIndex, rows: SidebarNotesSnapshot, label: string): Record<string, number> {
  const accepted = { openSource: 0, insertLink: 0, linkMention: 0, addSuggestedTag: 0 };
  const paths = [...index.files.keys(), '/notes/missing.md'];
  for (const filePath of paths) {
    const lineCount = (index.files.get(filePath)?.content.split('\n').length ?? 1) + 1;
    for (let line = 0; line <= lineCount; line += 1) {
      const where = `${label}: ${filePath}:${line}`;
      const source = navigation.resolveRelatedSource(rows, filePath, line);
      assert.deepStrictEqual(source, BEFORE.openSource(rows, filePath, line), `openSource ${where}`);
      accepted.openSource += source.kind === 'open' ? 1 : 0;
      const note = navigation.findRelatedNote(rows, filePath, line);
      assert.strictEqual(note, BEFORE.insertLink(rows, filePath, line), `insertLink ${where}`);
      accepted.insertLink += note ? 1 : 0;
      for (let startColumn = -1; startColumn <= 40; startColumn += 1) {
        const mention = navigation.findNoteMention(rows, filePath, line, startColumn);
        assert.strictEqual(mention, BEFORE.linkMention(rows, filePath, line, startColumn), `linkMention ${where}:${startColumn}`);
        accepted.linkMention += mention ? 1 : 0;
      }
    }
  }
  const tagKeys = [...index.tags.keys(), ...(rows.similar?.tags.map((tag) => tag.key) ?? []), '#gone', ''];
  for (const tagKey of tagKeys) {
    const tag = navigation.findSuggestedTag(rows, tagKey);
    assert.strictEqual(tag, BEFORE.addSuggestedTag(rows, tagKey), `addSuggestedTag ${label}: ${tagKey}`);
    accepted.addSuggestedTag += tag ? 1 : 0;
  }
  assert.strictEqual(navigation.listsNoteLinks(rows), BEFORE.linkAllMentions(rows), `linkAllMentions ${label}`);
  return accepted;
}

suite('NavigationService: Related Notes', () => {
  test('accepts exactly what the sidebar\'s rows, built for the click, list', () => {
    const index = relatedIndex(RELATED_NOTES);
    const atlas = relatedRows(index, '/notes/atlas.md');
    assert.ok(atlas.notes.length > 0 && (atlas.links?.mentions.length ?? 0) > 0 && (atlas.links?.linkedFromNotes.length ?? 0) > 0, 'atlas has related notes, links, and mentions');
    const onAtlas = assertSameAsBefore(index, atlas, 'atlas');
    assert.ok(onAtlas.openSource > 0 && onAtlas.insertLink > 0 && onAtlas.linkMention > 0);

    const hidingDaily = relatedRows(index, '/notes/atlas.md', true);
    assertSameAsBefore(index, hidingDaily, 'atlas, hiding daily notes');

    const today = relatedRows(index, '/notes/today.md');
    assert.ok((today.similar?.tags.length ?? 0) > 0, 'the untagged note is offered tags');
    const onToday = assertSameAsBefore(index, today, 'today');
    assert.ok(onToday.addSuggestedTag > 0);

    // A note the index does not have lists nothing, and no links.
    const missing = relatedRows(index, '/notes/missing.md');
    assert.deepStrictEqual(assertSameAsBefore(index, missing, 'missing'), { openSource: 0, insertLink: 0, linkMention: 0, addSuggestedTag: 0 });
  });

  test('an entry listed only as similar wording opens, counting its visit, and takes a link', () => {
    const index = relatedIndex(RELATED_NOTES);
    const today = relatedRows(index, '/notes/today.md');
    const similar = today.similar?.notes[0];
    assert.ok(similar, 'the untagged note lists similar wording');
    assert.ok(!today.notes.some((note) => note.filePath === similar.filePath), 'and only as similar wording');
    assert.ok(similar.sectionId);
    assert.deepStrictEqual(navigation.resolveRelatedSource(today, similar.filePath, similar.sourceLine), {
      kind: 'open',
      filePath: similar.filePath,
      line: similar.sourceLine,
      visit: similar.sectionId,
    });
    assert.strictEqual(navigation.findRelatedNote(today, similar.filePath, similar.sourceLine), similar);
    assert.strictEqual(navigation.findRelatedNote(today, similar.filePath, similar.sourceLine + 1), undefined, 'but not a line it does not start on');
  });

  test('after an index update, accepts what rows built from the new index list, and not what the old rows did', () => {
    const index = relatedIndex(RELATED_NOTES);
    const old = relatedRows(index, '/notes/atlas.md');
    // Standup loses its tags, its link, and its mention; a new note takes the tag.
    const updated = relatedIndex([
      ...RELATED_NOTES.filter(([filePath]) => filePath !== '/notes/standup.md'),
      ['/notes/standup.md', '# Standup\nNothing about it now.\n'],
      ['/notes/relay.md', '# Relay #project/relay\nThe atlas launch.\n'],
    ]);
    const fresh = relatedRows(updated, '/notes/atlas.md');
    assertSameAsBefore(updated, fresh, 'atlas, updated');

    const standup = old.notes.find((note) => note.filePath === '/notes/standup.md');
    assert.ok(standup, 'standup was related');
    assert.strictEqual(navigation.findRelatedNote(old, standup.filePath, standup.sourceLine), standup);
    assert.strictEqual(navigation.findRelatedNote(fresh, standup.filePath, standup.sourceLine), undefined, 'and is not now');
    assert.deepStrictEqual(navigation.resolveRelatedSource(fresh, standup.filePath, standup.sourceLine), { kind: 'unknown' });
    const relay = fresh.notes.find((note) => note.filePath === '/notes/relay.md');
    assert.ok(relay, 'relay is related now');
    assert.strictEqual(navigation.findRelatedNote(old, relay.filePath, relay.sourceLine), undefined, 'and was not before');
    const oldMention = old.links?.mentions.find((mention) => mention.filePath === '/notes/standup.md');
    assert.ok(oldMention, 'standup named atlas');
    assert.strictEqual(navigation.findNoteMention(fresh, oldMention.filePath, oldMention.line, oldMention.startColumn), undefined, 'and does not now');
  });
});
