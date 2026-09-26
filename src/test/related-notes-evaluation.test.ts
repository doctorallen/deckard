import * as assert from 'assert';

import { RankedNote } from '../core/types';
import { createSidebarSnapshot } from '../ui/state/relatedNotesRanking';
import { createEntryScope } from '../ui/webview/sidebarNotes';
import { createEvaluationWorkspace, EvaluationCase, precisionAt } from './relatedNotesFixture';

/** The ranked results for a case, as `path:line`. */
function rank(workspace: ReturnType<typeof createEvaluationWorkspace>, testCase: EvaluationCase): RankedNote[] {
  const file = workspace.files.get(testCase.activeFilePath);
  assert.ok(file);
  const scope = testCase.cursorLine ? createEntryScope(file, testCase.cursorLine) : undefined;
  return createSidebarSnapshot(
    workspace.index,
    testCase.activeFilePath,
    scope?.file ?? file,
    true,
    'tags',
    {},
    'inline',
    scope ? scope.file.sections[0]?.heading : undefined,
    scope?.tagWeights,
  ).notes;
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
