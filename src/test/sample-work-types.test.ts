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
import { getTermTable } from '../domain/terms/terms';
import { getEntityNamespaceAliases } from '../domain/markdown/parser';
import { describeReading, findFieldReadings, findLineMentions } from '../ui/state/fileThis';
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
  const context = createQueryContext(now, { identity: '@rhea-calder' });
  const answers = (question: string) => listAnswerItems(index, question, now).map((item) => [item.label, item.detail]);

  test('defines a person, a team, a contract, a system, a decision, and a term, with nothing to mark', () => {
    assert.deepStrictEqual([...(index.typeNotes?.keys() ?? [])].sort(), [
      'Types/Contract.md',
      'Types/Decision.md',
      'Types/Person.md',
      'Types/System.md',
      'Types/Team.md',
      'Types/Term.md',
    ]);
    assert.deepStrictEqual(types.problems, [], 'no value names nothing, and no field takes a built-in’s name');
  });

  test('a type’s search finds its rows, a person with no note among them', () => {
    const rows = (query: string): string[] => {
      const parsed = parseWorkspaceQuery(index, query);
      assert.deepStrictEqual(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), [], query);
      return [...evaluateTypeRows(index, parsed.node!, context)].sort();
    };
    assert.deepStrictEqual(rows('type = person'), [
      '@amara-kibet',
      '@dev-laurent',
      '@juno-achterberg',
      '@lio-marsh',
      '@ottilie-brandt',
      '@rhea-calder',
      '@tomas-vey',
    ]);
    assert.deepStrictEqual(rows('type = team'), ['#team/command', '#team/engineering', '#team/flight']);
    assert.deepStrictEqual(rows('type = contract'), [
      '#contract/comet-sample-return',
      '#contract/ice-haul',
      '#contract/medical-supply-run',
      '#contract/probe-recovery',
      '#contract/relay-survey',
    ]);
    assert.deepStrictEqual(rows('type = contract AND state = bidding'), ['#contract/comet-sample-return', '#contract/medical-supply-run']);
    assert.deepStrictEqual(rows('type = system'), ['#system/drive', '#system/hull', '#system/life-support', '#system/reactor']);
    assert.deepStrictEqual(rows('members.reports-to = @juno-achterberg'), ['#team/engineering'], 'a path through a reverse');
    assert.deepStrictEqual(rows('type = decision AND state = accepted').length, 2);
    assert.strictEqual(types.rowOfTag('@lio-marsh')?.filePath, undefined, 'Lio has no note, and the rows tab says so');
  });

  test('Find answers who leads engineering, who is on it, and its channel, as the README says', () => {
    assert.deepStrictEqual(answers('engineering lead'), [['Juno Achterberg', 'Engineering › lead']]);
    assert.deepStrictEqual(answers('who is on engineering').map(([label]) => label).sort(), ['Dev Laurent', 'Juno Achterberg']);
    assert.deepStrictEqual(answers('engineering channel'), [['engine-room', 'Engineering › channel']]);
    assert.deepStrictEqual(answers('relay survey lead'), [['Tomas Vey', 'Relay survey › lead']]);
  });

  test('Find answers what Juno keeps from the systems that name Juno, and knows Juno by a first name', () => {
    // The order of answers follows the order the notes were read in, which differs by platform.
    const sorted = (rows: Array<Array<string | undefined>>): Array<Array<string | undefined>> => [...rows].sort(([a], [b]) => String(a).localeCompare(String(b)));
    assert.deepStrictEqual(sorted(answers('what does juno keep')), [
      ['Drive', 'Juno Achterberg › keeps'],
      ['Reactor', 'Juno Achterberg › keeps'],
    ]);
    assert.deepStrictEqual(answers('reactor owner'), [['Juno Achterberg', 'Reactor › keeper']], 'a field by a word it is also called');
    assert.deepStrictEqual(sorted(answers('who reports to rhea calder')), [
      ['Juno Achterberg', 'Rhea Calder › reports'],
      ['Ottilie Brandt', 'Rhea Calder › reports'],
      ['Tomas Vey', 'Rhea Calder › reports'],
    ]);
    const email = [['juno@corvid.example', 'Juno Achterberg › email']];
    assert.deepStrictEqual(answers('juno achterberg email'), email);
    assert.deepStrictEqual(answers('juno email'), email);
    assert.deepStrictEqual(answers('dev team'), [['Engineering', 'Dev Laurent › team']]);
  });

  test('every query block parses and runs, and the typed ones list what they say', () => {
    const results = new Map<string, ReturnType<typeof createQueryBlockSnapshot>[]>();
    texts.forEach((text, filePath) => {
      findQueryBlocks(text).forEach((block) => {
        const snapshot = createQueryBlockSnapshot(index, block.query, block.options, { queryContext: { ...context, thisNotePath: filePath } });
        assert.deepStrictEqual(snapshot.messages ?? [], [], `${filePath}: ${block.query}`);
        results.set(filePath, [...(results.get(filePath) ?? []), snapshot]);
      });
    });
    const decisions = results.get('contracts/Relay survey.md')?.find((snapshot) => snapshot.query.startsWith('type = decision'));
    assert.deepStrictEqual(
      decisions?.notes.map((note) => [note.title, note.fieldValues?.state, note.fieldValues?.['decided-by']]),
      [['DEC-001 Survey route', 'accepted', 'Rhea Calder, Ottilie Brandt'], ['DEC-002 Burn profile', 'accepted', 'Rhea Calder, Tomas Vey']],
    );
    const proposed = results.get('contracts/Ice haul.md')?.find((snapshot) => snapshot.query.startsWith('type = decision'));
    assert.deepStrictEqual(proposed?.notes.map((note) => [note.title, note.fieldValues?.state]), [['DEC-003 Ice haul route', 'proposed']]);
    const team = results.get('teams/Engineering.md')?.[0];
    assert.strictEqual(team?.tasks.length, 3, 'the open tasks in the notes of the people on the team');
  });

  test('EVA is a term its term note defines, which the README says to hover and Find answers', () => {
    const entry = getTermTable(index).terms.get('EVA');
    assert.strictEqual(entry?.definition?.source, 'note');
    assert.strictEqual(entry?.definition?.filePath, 'terms/EVA.md');
    assert.match(entry?.definition?.text ?? '', /^Extravehicular activity: time outside the ship/);
    assert.ok((entry?.count ?? 0) >= 3, 'used across the briefings, the crew, and the contract');
    assert.deepStrictEqual(listAnswerItems(index, 'what is EVA', now).map((item) => [item.answer, item.filePath]), [['term', 'terms/EVA.md']]);
    assert.match(texts.get('README.md') ?? '', /Point at `EVA`/);
  });

  test('RCS and TCM are terms their notes define, each used three times or more', () => {
    for (const term of ['RCS', 'TCM']) {
      const entry = getTermTable(index).terms.get(term);
      assert.strictEqual(entry?.definition?.filePath, `terms/${term}.md`, term);
      assert.ok((entry?.count ?? 0) >= 3, `${term} used three times`);
    }
  });

  test('File this reads the sample’s Words: is on point for sets a contract’s lead, and reports to only the person’s own field', () => {
    const offers = (line: string): string[] =>
      findFieldReadings(types, line, findLineMentions(index, types, line, { sourcePath: 'notes/day.md', aliases: getEntityNamespaceAliases(undefined) })).map(describeReading);
    // Not Dev's team set to Ice haul by *is on*, which *is on point for* starts with.
    assert.deepStrictEqual(offers('- @dev-laurent is on point for #contract/ice-haul this week'), ['Set Ice haul’s lead to Dev Laurent (was Ottilie Brandt)']);
    // Not Juno's reports-to set to Tomas the other way round.
    assert.deepStrictEqual(offers('- @tomas-vey now reports to @juno-achterberg'), ['Set Tomas Vey’s reports-to to Juno Achterberg (was Rhea Calder)']);
  });
});
