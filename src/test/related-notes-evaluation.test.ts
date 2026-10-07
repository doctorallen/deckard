import * as assert from 'assert';

import { createSidebarSnapshot } from '../ui/state/relatedNotesRanking';
import { createEntryScope } from '../ui/state/entryScope';
import { parseMarkdown } from '../domain/markdown/parser';
import {
  createEvaluationWorkspace,
  EvaluationCase,
  precisionAt,
  UNTAGGED_NOTE,
  UNTAGGED_RELEVANT,
} from './relatedNotesFixture';
import { RankedNote } from '../domain/model';

/** The ranked results for a case, as `path:line`. */
function rank(workspace: ReturnType<typeof createEvaluationWorkspace>, testCase: EvaluationCase): RankedNote[] {
  const file = workspace.files.get(testCase.activeFilePath);
  assert.ok(file);
  const scope = testCase.cursorLine ? createEntryScope(file, testCase.cursorLine) : undefined;
  return createSidebarSnapshot(workspace.index, testCase.activeFilePath, scope?.file ?? file, {
    now: Date.now(),
    enableKeywordLinks: true,
    relatedNotesSortMode: 'tags',
    sectionAccessCounts: {},
    activeEntryTitle: scope ? scope.file.sections[0]?.heading : undefined,
    activeTagWeights: scope?.tagWeights,
  }).notes;
}

const idOf = (note: RankedNote): string => `${note.filePath}:${note.sourceLine}`;

/**
 * Related Notes measured by its first five, since a sidebar is chosen from
 * its first screen. The floors are what the ranking scores now, so a change
 * that makes it worse fails here; the value measured is beside each.
 */
suite('Related Notes evaluation', () => {
  const workspace = createEvaluationWorkspace();
  const [entry, whole] = workspace.cases;

  test('from the Vendor review entry, the first five are related, and wording alone is never listed', () => {
    const ranked = rank(workspace, entry).map(idOf);
    // Measured at 0.8 when the fixture was written: the four #risk/vendor
    // entries lead, and a standup that shares only the note's #daily takes
    // the fifth place from the Atlas entries and the note linking here.
    assert.ok(precisionAt(5, ranked, entry.relevant) >= 0.8, ranked.slice(0, 5).join('\n'));
    assert.deepStrictEqual(
      ranked.slice(0, 4).sort(),
      ['vendors/acme-review.md:1', 'vendors/escalations.md:2', 'vendors/escalations.md:4', 'vendors/northwind-audit.md:1'],
      'every entry the selected heading\'s own tag names comes first',
    );
    ranked.slice(0, 5).forEach((id) => assert.ok(!entry.never.has(id), id));
    assert.ok(!ranked.includes('misc/road-trip.md:1'), 'shared wording alone never makes a note related');
  });

  test('from the whole daily note, #daily does not lead the list', () => {
    const ranked = rank(workspace, whole).map(idOf);
    // Measured at 1.0 when the fixture was written.
    assert.strictEqual(precisionAt(5, ranked, whole.relevant), 1, ranked.slice(0, 5).join('\n'));
    ranked.slice(0, 5).forEach((id) => assert.ok(!whole.never.has(id), id));
  });
});

suite('Related Notes for a note with no tags', () => {
  const workspace = createEvaluationWorkspace();
  const snapshotFor = (filePath: string, content?: string, keywordLinks = true) => {
    const file = content === undefined ? workspace.files.get(filePath) : parseMarkdown(filePath, content);
    assert.ok(file);
    return createSidebarSnapshot(workspace.index, filePath, file, {
      now: Date.now(),
      enableKeywordLinks: keywordLinks,
      relatedNotesSortMode: 'tags',
      sectionAccessCounts: {},
      rankingOptions: { excludedTagNamespaces: ['status'] },
    });
  };

  test('lists entries worded like it, weak and apart, and the tags they use', () => {
    const snapshot = snapshotFor(UNTAGGED_NOTE);
    assert.strictEqual(snapshot.state, 'noTags');
    assert.deepStrictEqual(snapshot.notes, []);
    const similar = snapshot.similar;
    assert.ok(similar);
    const ranked = similar.notes.map(idOf);
    // Measured at 0.6 when written: four results, three judged related.
    assert.ok(precisionAt(5, ranked, UNTAGGED_RELEVANT) >= 0.6, ranked.join('\n'));
    similar.notes.forEach((note) => {
      assert.strictEqual(note.kind, 'wording');
      assert.ok(note.relevanceScore <= 30, `${idOf(note)} is weak at most`);
      assert.match(note.reasons?.[0] ?? '', /^Similar wording: /);
    });
    const perFile = new Map<string, number>();
    similar.notes.forEach((note) => perFile.set(note.filePath, (perFile.get(note.filePath) ?? 0) + 1));
    assert.ok([...perFile.values()].every((count) => count <= 2));
    assert.ok(similar.notes.length <= 10);
    assert.strictEqual(similar.tags[0]?.key, '#risk/vendor');
    assert.ok(similar.tags.every((tag) => tag.key !== '#daily' && !tag.key.startsWith('@')), 'never #daily or a person');
  });

  test('a note with a tag gets no similar list: wording alone never makes a note related', () => {
    assert.strictEqual(snapshotFor('journal/2026-09-20.md').similar, undefined);
  });

  test('a note with no tags but a link keeps its linked note related, and apart from the similar list', () => {
    const snapshot = snapshotFor(
      'journal/2026-09-22.md',
      '# 2026-09-22\nThe northern route and Northwind again, see [[northwind-audit]] for the audit.',
    );
    assert.strictEqual(snapshot.state, 'ready');
    const related = snapshot.notes.map(idOf);
    assert.ok(related.includes('vendors/northwind-audit.md:1'));
    assert.ok(!(snapshot.similar?.notes ?? []).map(idOf).includes('vendors/northwind-audit.md:1'));
  });

  test('with keyword links off, a note with no tags is suggested nothing', () => {
    assert.strictEqual(snapshotFor(UNTAGGED_NOTE, undefined, false).similar, undefined);
  });
});
