import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { createLexicalModel, createMoreLikeThisModel, getLexicalWeight } from '../domain/ranking/wordSimilarity';

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

  test('front matter is left out only where a note opens with it, and prose between two rules is read', () => {
    const content = '---\nsummary: quokka\n---\n# Plan\nIntro.\n\n---\n\nMarmalade pipeline.\n\n---\n\nThe end.\n';
    const active = parseMarkdown('notes/a.md', content);
    const index = buildWorkspaceIndex(
      new Map([
        ['notes/a.md', active],
        note('notes/b.md', '# Quokka\nMarmalade pipeline, and a quokka.\n'),
      ]),
    );
    const model = createLexicalModel(index, active);
    assert.ok(model.queryTerms.has('marmalade'), 'the prose between the rules');
    assert.ok(!model.queryTerms.has('quokka'), 'the front matter, from the title as from the text');
    assert.ok(!model.queryTerms.has('summary'));
    const asked = createMoreLikeThisModel(index, active);
    assert.ok(asked.queryTerms.has('marmalade'));
    assert.ok(!asked.queryTerms.has('quokka'));
    // An entry's text never opens a note, and its rules are rules.
    const words = getLexicalWeight(model, 'Plan', 'Intro.\n\n---\n\nMarmalade pipeline.\n\n---\n\nThe end.').terms.map((term) => term.term);
    assert.ok(words.includes('marmalade') && words.includes('pipeline'), words.join(', '));
  });

  test('a note with nothing else to go on is queried by its 25 rarest shared words', () => {
    const words = Array.from({ length: 40 }, (_, at) => `word${String.fromCharCode(97 + (at % 26))}${String.fromCharCode(97 + Math.floor(at / 26))}`);
    const active = parseMarkdown('notes/a.md', `# Long\n${words.join(' ')}\n`);
    const index = buildWorkspaceIndex(
      new Map([
        ['notes/a.md', active],
        note('notes/b.md', `# Other\n${words.slice(0, 30).join(' ')}\n`),
        note('notes/c.md', `# Third\n${words.slice(0, 10).join(' ')}\n`),
        note('notes/d.md', '# Unrelated\nNothing alike here.\n'),
      ]),
    );
    const model = createMoreLikeThisModel(index, active);
    assert.strictEqual(model.queryTerms.size, 25, 'at most 25 terms');
    assert.ok(!model.queryTerms.has(words[35]), 'a word no other note holds is not asked for');
    assert.ok(model.queryTerms.has(words[20]), 'the rarer shared words come first');
    const evidence = getLexicalWeight(model, 'Other', words.slice(0, 30).join(' '));
    assert.ok(evidence.rawWeight >= evidence.weight);
  });
});
