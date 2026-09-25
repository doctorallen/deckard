import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import { createLexicalModel, getLexicalWeight } from '../ui/state/wordSimilarity';

/** What the wording two entries share counts for, and what it does not. */
suite('Word similarity', () => {
  const note = (path: string, body: string) => [path, parseMarkdown(path, body)] as const;

  test('function words are not evidence', () => {
    const active = parseMarkdown('notes/a.md', '# Interview\nThe witness said that they saw the van, and that the plates were covered.\n');
    const index = buildWorkspaceIndex(
      new Map([
        ['notes/a.md', active],
        note('notes/b.md', '# Errand\nBuy the milk and the eggs, and then the bread.\n'),
        note('notes/c.md', '# Witness\nThe witness statement and the timeline.\n'),
      ]),
    );
    const model = createLexicalModel(index, active);
    // "the", "and", and "that" were the similar terms once, and made two
    // unrelated notes weakly alike.
    const errand = getLexicalWeight(model, 'Errand', 'Buy the milk and the eggs, and then the bread.');
    assert.deepStrictEqual(errand.terms, []);
    assert.strictEqual(errand.weight, 0);
    const witness = getLexicalWeight(model, 'Witness', 'The witness statement and the timeline.');
    assert.deepStrictEqual(witness.terms.map((term) => term.term), ['witness']);
    assert.ok(witness.weight > 0);
  });

  test('a word most entries carry is not evidence either', () => {
    const active = parseMarkdown('notes/today.md', '# Today\nStandup: the witness was recorded.\n');
    const others = Array.from({ length: 12 }, (_, at) =>
      note(`notes/n${at}.md`, `# Standup\nStandup outcome ${at === 0 ? 'witness' : 'noted'} recorded.\n`),
    );
    const index = buildWorkspaceIndex(new Map([['notes/today.md', active], ...others]));
    const model = createLexicalModel(index, active);
    const first = getLexicalWeight(model, 'Standup', 'Standup outcome witness recorded.');
    assert.deepStrictEqual(first.terms.map((term) => term.term), ['witness'], 'standup and recorded are in every entry');
    const another = getLexicalWeight(model, 'Standup', 'Standup outcome noted recorded.');
    assert.deepStrictEqual(another.terms, []);
    assert.strictEqual(another.weight, 0);
  });
});
