import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { evaluateQuery } from '../domain/query/queryEvaluator';
import { parseQuery } from '../domain/query/queryParser';
import { QUERY_FIELDS, QUERY_HAS_VALUES, QUERY_IS_VALUES, QueryNode } from '../domain/query/queryTypes';
import { findMissingLinkTargets } from '../domain/index/backlinks';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { computeParked } from '../domain/index/parked';
import { buildHubTree, findBreadcrumbs } from '../ui/state/hubTree';
import { computeTagProgress, describeTagProgress } from '../domain/tasks/tagProgress';
import { createAgenda } from '../ui/state/agendaState';
import { rankSimilarWording } from '../ui/state/relatedNotesRanking';
import { createQueryContext } from '../domain/query/queryContext';
import { findTagLookalikes, findTagMergeCandidates } from '../domain/ranking/tagHygiene';
import { listDailyNotes } from '../domain/notes/periodicNotes';
import { ParsedFile, WorkspaceIndex } from '../domain/model';
import { parseRecurrence } from '../domain/markdown/recurrence';
import { createNextOccurrence } from '../domain/markdown/taskLineEdits';
import { sampleNotes } from './indexCorpus';

/**
 * The sample corpus, test/fixtures/sample-corpus: the Story Tour that
 * shipped until the Work Sample became the one sample, kept for the tests.
 * Its notes say what each search finds, and between them use every query
 * field and state, so they hold the query language and the index to what
 * a reader was told.
 */
suite('Sample corpus', () => {
  // A Wednesday, well away from any week's edge.
  const today = new Date(2026, 9, 7, 9, 30);

  /**
   * The corpus as Deckard indexes it when dated from `day`: every Markdown
   * file but the templates, with the parked tag parked as the default
   * setting parks it.
   */
  function indexCorpus(day: Date): { files: Map<string, string>; index: WorkspaceIndex } {
    const files = new Map(sampleNotes(day));
    const parsed = new Map<string, ParsedFile>(
      [...files].map(([name, text]) => [name, parseMarkdown(name, text)] as const),
    );
    const index = buildWorkspaceIndex(parsed);
    index.parked = computeParked(index, { isParkedPath: () => false, hasFolders: false, tags: ['#parked'] });
    return { files, index };
  }

  test('every search it gives parses, and every query block runs', () => {
    const { files } = indexCorpus(today);
    let blocks = 0;
    const used = new Set<string>();
    const collect = (node: QueryNode | undefined): void => {
      if (!node) {
        return;
      }
      if (node.type === 'condition') {
        used.add(node.field);
        used.add(`${node.field}:${node.value}`);
      } else if (node.type === 'not') {
        collect(node.child);
      } else {
        node.children.forEach(collect);
      }
    };
    for (const [name, text] of files) {
      if (!name.endsWith('.md')) {
        continue;
      }
      for (const fence of text.matchAll(/^```(search|deckard)[^\n]*\n([\s\S]*?)^```$/gm)) {
        const lines = fence[2].split('\n').map((line) => line.trim()).filter(Boolean);
        const queries = fence[1] === 'deckard' ? [lines.join(' ')] : lines;
        blocks += fence[1] === 'deckard' ? 1 : 0;
        for (const query of queries) {
          const parsed = parseQuery(query);
          const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
          assert.deepStrictEqual(errors, [], `${name}: ${query}`);
          assert.ok(parsed.node, `${name}: ${query} parses`);
          collect(parsed.node);
        }
      }
    }
    // A search for every field, every state, and every field a task can lack.
    for (const field of QUERY_FIELDS) {
      assert.ok(used.has(field), `a search uses ${field}`);
    }
    for (const value of QUERY_IS_VALUES) {
      assert.ok(used.has(`is:${value}`), `a search uses is:${value}`);
    }
    for (const value of QUERY_HAS_VALUES) {
      assert.ok(used.has(`has:${value}`), `a search uses has:${value}`);
    }
    assert.strictEqual(blocks, 6, 'the Query blocks note has six blocks');
  });

  test('finds what each of its notes says it finds', () => {
    // Dated from today, since a search reads the clock.
    const now = new Date();
    const { files, index } = indexCorpus(now);
    // The tour is written for Juno Hale, as the sample's settings name her.
    const context = createQueryContext(Date.now(), { identity: '#person/juno-hale' });
    const found = (query: string) => {
      const parsed = parseQuery(query);
      assert.ok(parsed.node, `${query} parses`);
      return evaluateQuery(index, parsed.node, context);
    };
    const tasks = (query: string) => found(query).tasks.map((task) => task.title);
    const claims: Array<[string, number]> = [
      ['#project/ghostline-relay', 24],
      ['#person/ren-kade', 3],
      ['#project/ghostline-relay is:open', 20],
      ['(#person/ren-kade OR #person/leena-sato) AND is:open', 5],
      ['is:open', 49],
      ['is:done', 10],
      ['is:overdue', 3],
      ['is:overdue -is:needs-date', 2],
      ['is:needs-date', 1],
      ['is:today', 4],
      ['is:waiting', 5],
      ['is:in-progress', 3],
      ['is:cancelled', 1],
      ['is:closed', 11],
      ['has:cancelled', 1],
      ['cancelled = 7d', 1],
      ['status:in-progress', 3],
      ['status:waiting', 1],
      ['status:[-]', 1],
      ['-status:someday is:waiting', 4],
      ['is:blocked', 1],
      ['is:blocking', 1],
      ['is:assigned', 4],
      ['is:step', 3],
      ['has:scheduled', 2],
      ['has:start', 2],
      ['has:id', 1],
      ['has:dependsOn', 1],
      ['has:steps', 1],
      ['no:due is:open', 23],
      ['due < today', 3],
      ['due = today', 3],
      ['due < 7d', 17],
      ['scheduled = today', 1],
      ['start > today', 1],
      ['done = today', 2],
      ['assignee = #person/ren-kade', 2],
      ['priority >= high', 2],
      ['kind = context', 4],
    ];
    for (const [query, count] of claims) {
      assert.strictEqual(found(query).tasks.length, count, query);
    }
    assert.deepStrictEqual(tasks('is:needs-date'), ['Renew the Praxis Loom receiver lease']);
    assert.deepStrictEqual(tasks('is:blocked'), ['Run the passive-ping comparison']);
    assert.deepStrictEqual(tasks('start > today'), ['Rerun the falloff test at the east exits']);
    const nextMonth = tasks('due = next-month');
    assert.ok(nextMonth.includes("Write the pilot's close-out report"), 'the close-out report is due next month');
    assert.ok(nextMonth.includes('Submit the quarterly oversight report'), 'so is the quarterly report');
    const available = tasks('is:available');
    for (const left of ['Run the passive-ping comparison', 'Hear back from Praxis Loom', 'Try a second vendor', 'Rerun the falloff test']) {
      assert.ok(!available.some((title) => title.startsWith(left)), `${left} cannot be started now`);
    }
    // Its front matter names people, so the hub is one note, found as a whole.
    const lastMonth = found('created = last-month');
    assert.ok([...lastMonth.sections, ...lastMonth.files].some((entry) => entry.filePath === 'projects/Argent Protocol.md'));

    const parked = found('is:parked');
    // Parked in its front matter, the archived note is one note, found as a whole.
    assert.deepStrictEqual([...new Set([...parked.sections, ...parked.files].map((entry) => entry.filePath))], ['archive/Velvet Circuit.md']);
    assert.strictEqual(parked.tasks.length, 1);
    assert.strictEqual(new Set(found('is:daily').sections.map((section) => section.filePath)).size, 6, 'six daily notes');
    const linking = (query: string) => found(query).sections.map((section) => section.filePath).sort();
    assert.deepStrictEqual(linking('[[Relay]]'), linking('[[Ghostline Relay]]'), 'the alias finds the same entries');
    // Three notes link it as [[Ghostline Relay]], and the README as a Markdown link.
    assert.strictEqual(linking('[[Ghostline Relay]]').length, 4);
    assert.deepStrictEqual(
      [...new Set(linking('[[Ghostline Relay#^threshold]]'))],
      ['07 Links.md', `${formatDay(now, 0)}.md`],
      'the Links note and today link the threshold line',
    );
    assert.strictEqual(found('[[Relay field test plan]]').sections.length, 1);
    assert.deepStrictEqual(
      linking('[[07 Links#Try it]]'),
      ['07 Links.md'],
      'the Links note links its own Try it heading, and that link is no tag',
    );
    assert.ok(
      found('text = "rainshadow mesh" -#project/rainshadow-mesh').sections.some(
        (section) => section.filePath === '06 Tags and people.md',
      ),
      'the Tags note names the mesh project without its tag',
    );

    // The Tasks view, as the Tasks note describes it.
    const agenda = createAgenda(index, createQueryContext(Date.now()), {
      upcomingDays: 7,
      doneToday: true,
      tasks: [...index.tasks.values()].filter((task) => !index.parked?.tasks.has(task.id)),
    });
    const group = (id: string) => agenda.find((entry) => entry.id === id)?.entries.map((entry) => entry.task.title) ?? [];
    assert.deepStrictEqual(group('overdue'), [
      'Set a minimum confidence threshold for range-ping alerts',
      'Return the calibrated lens to the evidence custodian',
    ]);
    assert.strictEqual(group('today').length, 4);
    assert.deepStrictEqual(group('needsdate'), ['Renew the Praxis Loom receiver lease']);
    assert.strictEqual(group('donetoday').length, 2);
    const listed = agenda.flatMap((entry) => entry.entries.map((row) => row.task.title));
    assert.ok(!listed.includes('Send the final audit letter to the clinic board'), 'the parked task is left out');
    assert.ok(!listed.includes('Pack the rain shells'), 'a step rides on its task');

    // The board, as the Task board note describes it.
    const open = [...index.tasks.values()].filter((task) => !task.completed && !index.parked?.tasks.has(task.id));
    const people = new Map<string, number>();
    open.forEach((task) => task.assignee && people.set(task.assignee, (people.get(task.assignee) ?? 0) + 1));
    assert.deepStrictEqual(Object.fromEntries(people), {
      '#person/ren-kade': 2,
      '#person/juno-hale': 1,
      '#person/leena-sato': 1,
    });
    assert.deepStrictEqual(
      open.filter((task) => task.tags.filter((tag) => tag.startsWith('#context/')).length > 1).map((task) => task.title),
      ['Photograph the flooded exits and upload them #context/field #context/desk'],
    );

    // Tags: the lookalike, the hubs, and the tag without one.
    assert.deepStrictEqual(
      findTagMergeCandidates(index, 10).candidates.map((pair) => [pair.sourceKey, pair.targetKey]),
      [['#person/mara-vle', '#person/mara-vale']],
      'one pair of tags looks alike, for Stats and Try next',
    );
    assert.ok(findTagLookalikes(index, '#person/mara-vale').some((pair) => pair.sourceKey === '#person/mara-vle'));
    const hubs = [...index.tags.values()].filter((tag) => tag.hubFilePaths?.length).map((tag) => tag.key).sort();
    assert.deepStrictEqual(hubs, [
      '#person/sable-ortiz',
      '#project/argent-protocol',
      '#project/ghostline-relay',
      '#project/receiver-firmware',
      '#team/harbor',
      '#team/wardens',
    ]);
    assert.ok((index.tags.get('#project/ashen-mirror')?.count ?? 0) >= 3, 'Ashen Mirror is used enough to want a hub');

    // The Hubs view, as the Tags note draws it: a sub-project by up:, a note
    // under it by up: alone, and a note under the relay by its tag.
    const tree = (nodes: ReturnType<typeof buildHubTree>, depth = 0): string[] =>
      nodes.flatMap((node) => [`${'  '.repeat(depth)}${node.label}${node.description ? `: ${node.description}` : ''}`, ...tree(node.children, depth + 1)]);
    assert.deepStrictEqual(tree(buildHubTree(index, Date.now())), [
      'People',
      '  Sable Ortiz',
      'Projects',
      '  Argent Protocol: 1/3 done (33%)',
      '  Ghostline Relay: 3/23 done (13%)',
      '    Receiver firmware',
      '      Firmware bench log',
      '    Relay route survey',
      'Teams',
      '  Harbor: 0/2 done (0%)',
      '  Wardens: 3/21 done (14%)',
    ]);
    assert.deepStrictEqual(findBreadcrumbs(index, 'projects/Firmware bench log.md').map((crumb) => crumb.labels.join(' › ')), [
      'Projects › Ghostline Relay › Receiver firmware › Firmware bench log',
    ]);
    const relay = computeTagProgress(index, '#project/ghostline-relay', Date.now());
    assert.ok(relay);
    assert.strictEqual(
      describeTagProgress(relay, Date.now(), createQueryContext(Date.now()).taskPolicy),
      '3/23 done (13%) · 2 overdue · 1 needs a new date · next due today',
      'the progress the Tags note quotes',
    );
    // A tag is written only where the tour means one: every tag is
    // namespaced, but for the parked tag and two headings of the log.
    const stray = [...index.tags.keys()].filter(
      (key) => !key.includes('/') && !['#parked', '#operations', '#management'].includes(key),
    );
    assert.deepStrictEqual(stray, []);

    // Links: the one missing note, and the untagged note Related Notes words.
    assert.deepStrictEqual(findMissingLinkTargets(index).map((target) => target.name), ['Relay field test plan']);
    const loose = index.files.get('Loose ends.md');
    assert.ok(loose);
    assert.deepStrictEqual([...loose.frontmatterTags, ...loose.sections.flatMap((section) => section.tags)], []);
    assert.ok(rankSimilarWording({ index, activeFilePath: loose.filePath, activeFile: loose }).length > 0, 'Loose ends has notes worded like it');

    // Daily notes: yesterday and today, and a migrated line left behind.
    const days = listDailyNotes(index).map((entry) => entry.date);
    assert.ok(days.includes(formatDay(now, 0)), 'today has a daily note');
    assert.ok(days.includes(formatDay(now, -1)), 'yesterday has a daily note');
    assert.match(
      files.get(`${formatDay(now, -5)}.md`) ?? '',
      new RegExp(`^- \\[>\\] Confirm the rain-route timings with Kenji → \\[\\[${formatDay(now, -1)}\\]\\]$`, 'm'),
    );
    assert.strictEqual(tasks('"rain-route timings"').length, 1, 'a migrated line is not a task');

    // Repeats: every rule reads but the two written wrong on purpose.
    const routines = [...index.tasks.values()].filter((task) => task.filePath === '03 Repeats and dates.md');
    assert.deepStrictEqual(
      routines.filter((task) => !parseRecurrence(task.recurrence ?? '')).map((task) => task.recurrence),
      ['every tuesdya', 'weekly'],
    );
    const quarterly = (files.get('03 Repeats and dates.md') ?? '').split('\n').find((line) => line.includes('quarterly'));
    const next = createNextOccurrence(quarterly ?? '', 3, Date.now());
    const due = new Date(now.getFullYear(), now.getMonth() + 4, 15);
    assert.ok(next?.includes(`📅 ${formatDay(due, 0)}`), `the quarterly report comes back three months on: ${next}`);
  });
});

/** The day `offset` days from `day`, as a daily note is named. */
function formatDay(day: Date, offset: number): string {
  const at = new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}
