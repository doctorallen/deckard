import * as assert from 'assert';

import { describeNoteProblems, NOTE_PROBLEM_FIXES, NoteProblemCounts } from '../ui/state/editorLensState';

/** No problem of either kind, for each case to add to. */
const NONE: NoteProblemCounts = { missing: 0, ambiguous: 0, creatable: 0, mentions: 0, mentionNotes: 0 };

suite('The problems lens', () => {
  test('draws nothing for a note with no problem', () => {
    assert.strictEqual(describeNoteProblems(NONE), undefined);
  });

  test('counts each kind in one line, as "2 missing · 4 unlinked"', () => {
    const both = describeNoteProblems({ ...NONE, missing: 2, creatable: 2, mentions: 4, mentionNotes: 3 });
    assert.strictEqual(both?.title, '2 missing · 4 unlinked');
    assert.strictEqual(both?.tooltip, '2 links name no note; 3 notes mention this one without a link. Select to choose a fix');
    const ambiguous = describeNoteProblems({ ...NONE, missing: 1, ambiguous: 1, creatable: 1 });
    assert.strictEqual(ambiguous?.title, '1 missing · 1 ambiguous');
  });

  test('with only broken links, creates the missing notes, or shows the links when none can be created', () => {
    const missing = describeNoteProblems({ ...NONE, missing: 2, creatable: 2 });
    assert.strictEqual(missing?.action, 'createMissingNotes');
    assert.deepStrictEqual(missing?.fixes, ['showBrokenLinks', 'createMissingNotes']);
    assert.match(missing?.tooltip ?? '', /Select to create the 2 missing notes in your notes folder$/);
    const shared = describeNoteProblems({ ...NONE, ambiguous: 1 });
    assert.strictEqual(shared?.title, '1 ambiguous');
    assert.strictEqual(shared?.action, 'showBrokenLinks');
    assert.deepStrictEqual(shared?.fixes, ['showBrokenLinks'], 'a name several notes share is not created again');
  });

  test('with only unlinked mentions, links them', () => {
    const mentions = describeNoteProblems({ ...NONE, mentions: 1, mentionNotes: 1 });
    assert.strictEqual(mentions?.title, '1 unlinked');
    assert.strictEqual(mentions?.action, 'linkMentions');
    assert.strictEqual(mentions?.tooltip, '1 note mentions this one without a link. Select to turn each mention into a [[link]] to this note');
  });

  test('with both kinds, lists each fix in order', () => {
    const both = describeNoteProblems({ ...NONE, missing: 1, ambiguous: 1, creatable: 1, mentions: 2, mentionNotes: 1 });
    assert.strictEqual(both?.action, 'pick');
    assert.deepStrictEqual(
      both?.fixes.map((fix) => NOTE_PROBLEM_FIXES[fix]),
      ['Show broken links', 'Create missing notes', 'Show unlinked mentions', 'Link mentions'],
    );
    const nothingToCreate = describeNoteProblems({ ...NONE, ambiguous: 1, mentions: 2, mentionNotes: 2 });
    assert.deepStrictEqual(nothingToCreate?.fixes, ['showBrokenLinks', 'showMentions', 'linkMentions']);
  });
});
