import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { createNextOccurrence, parseRecurrence } from '../core/markdown/taskMetadata';
import { evaluateQuery, getQueryIdentity, setQueryIdentity } from '../core/query/queryEvaluator';
import { parseQuery } from '../core/query/queryParser';
import { QUERY_FIELDS, QUERY_HAS_VALUES, QUERY_IS_VALUES, QueryNode } from '../core/query/queryTypes';
import { ParsedFile, WorkspaceIndex } from '../core/types';
import { findMissingLinkTargets } from '../core/workspace/backlinks';
import { buildWorkspaceIndex } from '../core/workspace/indexState';
import { computeParked } from '../core/workspace/parked';
import { listDailyNotes } from '../ui/commands/dailyNote';
import {
  getSampleStorageUri,
  installSample,
  isSampleNote,
  resolveSampleTokens,
  SAMPLE_FOLDER_NAME,
  sampleFileName,
  takeSampleReadme,
} from '../ui/commands/sampleWorkspace';
import { createAgenda } from '../ui/state/agendaState';
import { rankSimilarWording } from '../ui/state/relatedNotesRanking';
import { findTagLookalikes, findTagMergeCandidates } from '../ui/state/tagHygiene';

suite('Sample workspace', () => {
  const extensionUri = vscode.Uri.file(path.resolve(__dirname, '..', '..'));
  // A Wednesday, well away from any week's edge.
  const today = new Date(2026, 9, 7, 9, 30);
  let storage: vscode.Uri;

  setup(async () => {
    storage = vscode.Uri.file(path.join(os.tmpdir(), `deckard-sample-${Date.now()}-${Math.random().toString(36).slice(2)}`));
    await vscode.workspace.fs.createDirectory(storage);
  });
  teardown(async () => {
    await vscode.workspace.fs.delete(storage, { recursive: true, useTrash: false });
  });

  const read = async (uri: vscode.Uri) => Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');

  /** Every file installed, as path → text. */
  async function installed(target: vscode.Uri): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const walk = async (folder: vscode.Uri, prefix: string) => {
      for (const [name, type] of await vscode.workspace.fs.readDirectory(folder)) {
        const uri = vscode.Uri.joinPath(folder, name);
        if (type === vscode.FileType.Directory) {
          await walk(uri, `${prefix}${name}/`);
        } else {
          files.set(`${prefix}${name}`, await read(uri));
        }
      }
    };
    await walk(target, '');
    return files;
  }

  /**
   * The sample as Deckard indexes it when made on `day`: every Markdown file
   * but the templates, with the parked tag parked as the default setting
   * parks it.
   */
  async function indexSample(day: Date): Promise<{ files: Map<string, string>; index: WorkspaceIndex }> {
    const { target } = await installSample(extensionUri, storage, day, vscode.workspace.fs, { replace: true });
    const files = await installed(target);
    const parsed = new Map<string, ParsedFile>(
      [...files]
        .filter(([name]) => name.endsWith('.md') && !name.startsWith('templates/'))
        .map(([name, text]) => [name, parseMarkdown(name, text)] as const),
    );
    const index = buildWorkspaceIndex(parsed);
    index.parked = computeParked(index, { isParkedPath: () => false, hasFolders: false, tags: ['#parked'] });
    return { files, index };
  }

  /** The numbered notes of the tour, from the installed files. */
  const tourNotes = (files: Map<string, string>) => [...files].filter(([name]) => /^\d\d .*\.md$/.test(name));

  test('reads its dates from the day it is made', () => {
    assert.strictEqual(resolveSampleTokens('{{date}} {{date-9}} {{date+3}}', today), '2026-10-07 2026-09-28 2026-10-10');
    assert.strictEqual(resolveSampleTokens('{{month+1}} {{month-1}}', today), '2026-11-15 2026-09-15');
    assert.strictEqual(resolveSampleTokens('{{month+1}}', new Date(2026, 11, 31)), '2027-01-15', 'into the next year');
    assert.strictEqual(sampleFileName('day-1.md', today), '2026-10-06.md');
    assert.strictEqual(sampleFileName('Harbor.md', today), 'Harbor.md');
    assert.strictEqual(sampleFileName('dot-vscode', today), '.vscode');
    assert.ok(isSampleNote('projects/Ghostline Relay.md'));
    assert.ok(!isSampleNote('README.md') && !isSampleNote('templates/Meeting.md'));
  });

  test('is a tour whose README links every note, with the settings it relies on', async () => {
    const { target, notes } = await installSample(extensionUri, storage, today);
    assert.strictEqual(path.basename(target.fsPath), SAMPLE_FOLDER_NAME);
    const files = await installed(target);
    for (const [name, text] of files) {
      assert.ok(!text.includes('{{'), `${name} has no token left`);
    }
    const noteNames = [...files.keys()].filter(isSampleNote);
    assert.strictEqual(notes, noteNames.length);
    assert.strictEqual(tourNotes(files).length, 10, 'ten tour notes');
    const readme = files.get('README.md') ?? '';
    for (const name of noteNames) {
      assert.ok(readme.includes(`(<${name}>)`), `the README links ${name}`);
    }
    // Each tour note explains, shows, and ends with what to try.
    for (const [name, text] of tourNotes(files)) {
      assert.match(text, /^## Try it$/m, `${name} has Try it`);
    }
    assert.ok(files.has('templates/Meeting.md') && files.has('templates/project.md'), 'a templates folder');

    const settings = JSON.parse(files.get('.vscode/settings.json') ?? '{}') as Record<string, unknown>;
    assert.strictEqual(settings['deckard.notesFolder'], '');
    assert.strictEqual(settings['deckard.me'], '#person/juno-hale');
    assert.strictEqual(settings['deckard.calendar.dayPanel'], true);
    assert.strictEqual(settings['deckard.dailyNote.rollover'], 'migrate');
    assert.deepStrictEqual(settings['deckard.board.limits'], { doing: 2 });
    assert.deepStrictEqual(settings['deckard.periodicNote.reviewSections'], [
      { title: 'Waiting on others', query: 'is:waiting' },
    ]);
  });

  test('every search the tour gives parses, and every query block runs', async () => {
    const { files } = await indexSample(today);
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
    assert.strictEqual(blocks, 5, 'the Query blocks note has five blocks');
  });

  test('finds what each tour note says it finds', async () => {
    // Made today, since a search reads the clock.
    const now = new Date();
    const { files, index } = await indexSample(now);
    const identity = getQueryIdentity();
    setQueryIdentity('#person/juno-hale');
    try {
      const found = (query: string) => {
        const parsed = parseQuery(query);
        assert.ok(parsed.node, `${query} parses`);
        return evaluateQuery(index, parsed.node);
      };
      const tasks = (query: string) => found(query).tasks.map((task) => task.title);
      const claims: Array<[string, number]> = [
        ['#project/ghostline-relay', 23],
        ['#person/ren-kade', 3],
        ['#project/ghostline-relay is:open', 20],
        ['(#person/ren-kade OR #person/leena-sato) AND is:open', 5],
        ['is:open', 49],
        ['is:done', 10],
        ['is:overdue', 3],
        ['is:overdue -is:needs-date', 2],
        ['is:needs-date', 1],
        ['is:today', 4],
        ['is:waiting', 4],
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
        ['#status/doing', 3],
      ];
      for (const [query, count] of claims) {
        assert.strictEqual(found(query).tasks.length, count, query);
      }
      assert.deepStrictEqual(tasks('is:needs-date'), ['Renew the Praxis Loom receiver lease']);
      assert.deepStrictEqual(tasks('is:blocked'), ['Run the passive-ping comparison #status/todo']);
      assert.deepStrictEqual(tasks('start > today'), ['Rerun the falloff test at the east exits']);
      const nextMonth = tasks('due = next-month');
      assert.ok(nextMonth.includes("Write the pilot's close-out report"), 'the close-out report is due next month');
      assert.ok(nextMonth.includes('Submit the quarterly oversight report'), 'so is the quarterly report');
      const available = tasks('is:available');
      for (const left of ['Run the passive-ping comparison', 'Hear back from Praxis Loom', 'Try a second vendor', 'Rerun the falloff test']) {
        assert.ok(!available.some((title) => title.startsWith(left)), `${left} cannot be started now`);
      }
      assert.ok(found('created = last-month').sections.some((section) => section.filePath === 'projects/Argent Protocol.md'));

      const parked = found('is:parked');
      assert.deepStrictEqual([...new Set(parked.sections.map((section) => section.filePath))], ['archive/Velvet Circuit.md']);
      assert.strictEqual(parked.tasks.length, 1);
      assert.strictEqual(new Set(found('is:daily').sections.map((section) => section.filePath)).size, 6, 'six daily notes');
      const linking = (query: string) => found(query).sections.map((section) => section.filePath).sort();
      assert.deepStrictEqual(linking('[[Relay]]'), linking('[[Ghostline Relay]]'), 'the alias finds the same entries');
      assert.strictEqual(linking('[[Ghostline Relay]]').length, 3);
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
      const agenda = createAgenda(index, Date.now(), {
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
        '#team/harbor',
        '#team/wardens',
      ]);
      assert.ok((index.tags.get('#project/ashen-mirror')?.count ?? 0) >= 3, 'Ashen Mirror is used enough to want a hub');
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
      assert.ok(rankSimilarWording(index, loose.filePath, loose).length > 0, 'Loose ends has notes worded like it');

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
    } finally {
      setQueryIdentity(identity);
    }
  });

  test('is replaced only when asked, and never merged onto what is there', async () => {
    const { target } = await installSample(extensionUri, storage, today);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(target, 'mine.md'), Buffer.from('# Mine\n'));
    await assert.rejects(() => installSample(extensionUri, storage, today), /already a sample/);
    await installSample(extensionUri, storage, today, vscode.workspace.fs, { replace: true });
    assert.ok(!(await installed(target)).has('mine.md'), 'a fresh copy');
  });

  test('shows its README only in the folder it opened', () => {
    const sample = vscode.Uri.file('/storage/deckard-sample');
    assert.strictEqual(
      takeSampleReadme(sample.toString(), [{ uri: sample }])?.toString(),
      vscode.Uri.joinPath(sample, 'README.md').toString(),
    );
    assert.strictEqual(takeSampleReadme(sample.toString(), [{ uri: vscode.Uri.file('/work') }]), undefined);
    assert.strictEqual(takeSampleReadme(undefined, [{ uri: sample }]), undefined);
  });

  test('opens as a file folder, which VS Code can search', () => {
    // A `vscode-userdata:` folder has no file search, so its first scan
    // never finished.
    const userData = vscode.Uri.from({
      scheme: 'vscode-userdata',
      path: '/Users/reader/Library/Application Support/Code/User/globalStorage/esperinnovations.deckard-notes',
    });
    const opened = getSampleStorageUri(userData);
    assert.strictEqual(opened.scheme, 'file');
    assert.strictEqual(opened.fsPath, userData.fsPath);
    const file = vscode.Uri.file(os.tmpdir());
    assert.strictEqual(getSampleStorageUri(file), file);
  });
});

/** The day `offset` days from `day`, as a daily note is named. */
function formatDay(day: Date, offset: number): string {
  const at = new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}
