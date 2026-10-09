import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import type { ParsedFile, WorkspaceIndex } from '../domain/model';
import { resolveSampleTokens, sampleFileName } from '../domain/notes/sampleNotes';
import { evaluateTypeRows } from '../domain/query/queryEvaluator';
import { createQueryContext } from '../domain/query/queryContext';
import { getTypeIndex } from '../domain/types/typeIndex';
import { parseWorkspaceQuery } from '../domain/types/typeQueryFields';
import { listAnswerItems } from '../ui/state/findAnswers';
import { createQueryBlockSnapshot, findQueryBlocks } from '../ui/state/queryBlockState';

/** The shipped work sample, which `Deckard: Create a Work Sample` copies. */
const SAMPLE = path.join(__dirname, '..', '..', 'resources', 'sample-work');
// A Wednesday, well away from any week's edge, as the sample's other suite dates it.
const today = new Date(2026, 9, 7, 9, 30);
const now = new Date(2026, 9, 7, 12).getTime();

/**
 * The work sample as Deckard indexes it once made: dated from `today`,
 * the templates left out, and the notes in `Types/` read as the types they
 * define. Read with `fs`, so it runs without VS Code.
 */
function indexSample(): { index: WorkspaceIndex; texts: Map<string, string> } {
  const texts = new Map<string, string>();
  const walk = (folder: string, prefix: string): void => {
    for (const name of fs.readdirSync(folder)) {
      const full = path.join(folder, name);
      const written = `${prefix}${sampleFileName(name, today)}`;
      if (fs.statSync(full).isDirectory()) {
        walk(full, `${written}/`);
      } else if (name.endsWith('.md') && !written.startsWith('templates/')) {
        texts.set(written, resolveSampleTokens(fs.readFileSync(full, 'utf8'), today));
      }
    }
  };
  walk(SAMPLE, '');
  const parsed = new Map<string, ParsedFile>(
    [...texts].map(([name, text]) => [name, parseMarkdown(name, text, { createdAt: now, updatedAt: now }, { typeNote: name.startsWith('Types/') })] as const),
  );
  return { index: buildWorkspaceIndex(parsed), texts };
}

suite('The work sample’s types', () => {
  const { index, texts } = indexSample();
  const types = getTypeIndex(index);
  const context = createQueryContext(now, { identity: '@alex-rivera' });

  test('defines a person, a team, an area, and a decision, with nothing to mark', () => {
    assert.deepStrictEqual([...(index.typeNotes?.keys() ?? [])].sort(), ['Types/Area.md', 'Types/Decision.md', 'Types/Person.md', 'Types/Team.md']);
    assert.deepStrictEqual(types.problems, [], 'no value names nothing, and no field takes a built-in’s name');
  });

  test('a type’s search finds its rows, a person with no note among them', () => {
    const rows = (query: string): string[] => {
      const parsed = parseWorkspaceQuery(index, query);
      assert.deepStrictEqual(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), [], query);
      return [...evaluateTypeRows(index, parsed.node!, context)].sort();
    };
    assert.deepStrictEqual(rows('type = person'), ['@alex-rivera', '@ines-duarte', '@noor-haddad', '@sam-okafor', '@theo-park']);
    assert.deepStrictEqual(rows('type = team'), ['#team/payments']);
    assert.deepStrictEqual(rows('type = area'), ['#area/card-payments', '#area/checkout']);
    assert.deepStrictEqual(rows('owned-by.lead = @alex-rivera'), ['#area/card-payments', '#area/checkout'], 'a path through a reverse');
    assert.deepStrictEqual(rows('type = decision AND state = accepted').length, 2);
    assert.strictEqual(types.rowOfTag('@ines-duarte')?.filePath, undefined, 'Ines has no note, and the rows tab says so');
  });

  test('Find answers who leads checkout, who is on payments, and its channel, as the README says', () => {
    const answers = (question: string) => listAnswerItems(index, question, now).map((item) => [item.label, item.detail]);
    assert.deepStrictEqual(answers('checkout lead'), [['Alex Rivera', 'Checkout › owned by Payments › lead']]);
    assert.deepStrictEqual(answers('who is on payments').map(([label]) => label).sort(), ['Noor Haddad', 'Theo Park']);
    assert.deepStrictEqual(answers('payments channel'), [['payments-eng', 'Payments › channel']]);
  });

  test('Find answers who owns checkout from the team that owns it, and knows Noor by a first name', () => {
    const answers = (question: string) => listAnswerItems(index, question, now).map((item) => [item.label, item.detail]);
    const owner = [['Payments', 'Checkout › owned by']];
    assert.deepStrictEqual(answers('who owns checkout'), owner);
    assert.deepStrictEqual(answers('which team owns checkout'), owner);
    assert.deepStrictEqual(answers('checkout owned by'), owner);
    assert.deepStrictEqual(answers('who is responsible for checkout'), owner);
    assert.deepStrictEqual(answers('what does payments own'), [
      ['Checkout', 'Payments › owns'],
      ['Card Payments', 'Payments › owns'],
    ]);
    const email = [['noor@example.com', 'Noor Haddad › email']];
    assert.deepStrictEqual(answers('noor haddad email'), email);
    assert.deepStrictEqual(answers('noor email'), email);
    assert.deepStrictEqual(answers('what does noor own'), [
      ['Checkout', 'Noor Haddad › team Payments › owns'],
      ['Card Payments', 'Noor Haddad › team Payments › owns'],
    ]);
  });

  test('every query block parses and runs, and the two typed ones list what they say', () => {
    const results = new Map<string, ReturnType<typeof createQueryBlockSnapshot>[]>();
    texts.forEach((text, filePath) => {
      findQueryBlocks(text).forEach((block) => {
        const snapshot = createQueryBlockSnapshot(index, block.query, block.options, { queryContext: { ...context, thisNotePath: filePath } });
        assert.deepStrictEqual(snapshot.messages ?? [], [], `${filePath}: ${block.query}`);
        results.set(filePath, [...(results.get(filePath) ?? []), snapshot]);
      });
    });
    const decisions = results.get('projects/Checkout v2.md')?.find((snapshot) => snapshot.query.startsWith('type = decision'));
    assert.deepStrictEqual(
      decisions?.notes.map((note) => [note.title, note.fieldValues?.state, note.fieldValues?.['decided-by']]),
      [['ADR-001 Card form', 'accepted', 'Alex Rivera, Noor Haddad'], ['ADR-002 Feature flags', 'accepted', 'Alex Rivera, Theo Park']],
    );
    const team = results.get('teams/Payments.md')?.[0];
    assert.strictEqual(team?.tasks.length, 4, 'the open tasks in the notes of the people on the team');
  });
});
