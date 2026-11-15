import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { evaluateQuery } from '../domain/query/queryEvaluator';
import { parseQuery } from '../domain/query/queryParser';
import { findMissingLinkTargets } from '../domain/index/backlinks';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import {
  getSampleStorageUri,
  installSample,
  isSampleNote,
  WORK_SAMPLE_FOLDER_NAME,
  takeSampleReadme,
} from '../ui/commands/sampleWorkspace';
import { resolveSampleTokens, sampleFileName } from '../domain/notes/sampleNotes';
import { createQueryContext } from '../domain/query/queryContext';
import { ParsedFile, WorkspaceIndex } from '../domain/model';
import { findPromises } from '../domain/tasks/promises';
import { planRollover } from '../domain/notes/rolloverPlan';
import { ROLLOVER_LOOKBACK_DAYS } from '../ui/commands/rollover';
import { buildHubTree, HubTreeNode } from '../ui/state/hubTree';

suite('Work sample', () => {
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

  /** The installed sample's notes, parsed and indexed as Deckard reads them: the templates left out, `Types/` read as types. */
  function indexInstalled(files: ReadonlyMap<string, string>): { parsed: Map<string, ParsedFile>; index: WorkspaceIndex } {
    const parsed = new Map<string, ParsedFile>(
      [...files]
        .filter(([name]) => name.endsWith('.md') && !name.startsWith('templates/'))
        .map(([name, text]) => [name, parseMarkdown(name, text, undefined, { typeNote: name.startsWith('Types/') })] as const),
    );
    return { parsed, index: buildWorkspaceIndex(parsed) };
  }

  test('the work sample is six weeks aboard the Petrel: every link opens a note, and today has work due', async () => {
    const { target, notes } = await installSample({ extensionUri, storageUri: storage, today });
    assert.strictEqual(path.basename(target.fsPath), WORK_SAMPLE_FOLDER_NAME);
    const files = await installed(target);
    for (const [name, text] of files) {
      assert.ok(!text.includes('{{'), `${name} has no token left`);
    }
    const { parsed, index } = indexInstalled(files);
    assert.strictEqual(notes, index.files.size - 1, 'every note but the README, and no type note');
    assert.deepStrictEqual([...(index.typeNotes?.keys() ?? [])].sort(), [
      'Types/Contract.md',
      'Types/Decision.md',
      'Types/Person.md',
      'Types/System.md',
      'Types/Team.md',
      'Types/Term.md',
    ]);
    assert.deepStrictEqual(findMissingLinkTargets(index), [], 'no link names a missing note');
    assert.ok(files.has('2026-10-07.md') && files.has('2026-10-06.md'), 'briefings dated to the days before it was made');
    const daily = [...files.keys()].filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name)).sort();
    assert.ok(daily.length >= 20 && daily[0] <= '2026-08-27.md', `six weeks of daily notes, not ${daily.length} from ${daily[0]}`);
    const context = createQueryContext(new Date(2026, 9, 7, 12).getTime());
    const due = (query: string) => evaluateQuery(index, parseQuery(query).node!, context).tasks.length;
    assert.ok(due('is:today') >= 2, 'work due today');
    assert.ok(due('is:overdue') >= 1, 'something slipped');
    assert.ok(due('assignee = @tomas-vey') >= 1, 'a task handed to someone');
    assert.ok([...parsed.values()].some((file) => file.hub?.describes.some((tag) => tag.key === '#contract/relay-survey')), 'a contract hub');
    assert.match(files.get('README.md') ?? '', /Cmd.*macOS|macOS.*Cmd/s, 'keys for macOS beside Windows and Linux');
    assert.match(files.get('README.md') ?? '', /Run \*\*Deckard: Take the Tour\*\*/, 'the README offers the tour');
    assert.deepStrictEqual(
      ['templates/Briefing.md', 'templates/One-on-one.md', 'templates/Decision record.md', 'templates/contract.md'].filter((name) => !files.has(name)),
      [],
    );
  });

  test('holds what the tour points at', async () => {
    const { target } = await installSample({ extensionUri, storageUri: storage, today });
    const files = await installed(target);
    const { parsed, index } = indexInstalled(files);
    const now = new Date(2026, 9, 7, 12).getTime();
    const context = createQueryContext(now, { identity: '@rhea-calder' });
    const find = (query: string) => evaluateQuery(index, parseQuery(query).node!, context).tasks;
    const tasks = [...index.tasks.values()];
    const titled = (title: string) => tasks.filter((task) => task.title === title);

    // Today's briefing, with one promise from the crew and one from the broker.
    const lines = (files.get('2026-10-07.md') ?? '').split('\n');
    assert.strictEqual(lines[0], '# 2026-10-07');
    const briefing = lines.indexOf('## Morning briefing #meeting/briefing');
    assert.strictEqual(lines[briefing + 1], '- @juno-achterberg: coolant pump is apart; seals ordered from Pallas Yard.');
    assert.ok(lines.includes('## Relay survey #contract/relay-survey #team/flight'));
    assert.ok(lines.some((line) => line.includes('[[DEC-002 Burn profile]]')));
    const engineering = lines.indexOf('## Engineering #system/reactor');
    assert.strictEqual(lines[engineering + 1], '- @juno-achterberg says the coolant pump rebuild is done by Tuesday.');
    assert.deepStrictEqual(
      findPromises(lines, { now, identity: '@rhea-calder' }).map((promise) => [lines[promise.line], promise.due]),
      [
        ['- @juno-achterberg says the coolant pump rebuild is done by Tuesday.', '2026-10-13'],
        ['- @amara-kibet says the survey payment clears by Friday.', '2026-10-09'],
      ],
      'the two promises, and no other line read as one',
    );

    // The Relay survey: open work for its pilot, every kind of status, one task late, and most of it done.
    const [recalibrate] = titled('Recalibrate the survey array');
    assert.strictEqual(recalibrate?.filePath, 'contracts/Relay survey.md');
    assert.strictEqual(recalibrate?.status.type, 'todo');
    assert.strictEqual(recalibrate?.assignee, '@tomas-vey');
    const survey = find('#contract/relay-survey').filter((task) => !task.parentTaskId);
    const done = survey.filter((task) => task.completed).length;
    assert.ok(done / survey.length >= 0.55 && done / survey.length <= 0.7, `about 60% done, not ${done}/${survey.length}`);
    assert.deepStrictEqual(
      ['todo', 'inProgress', 'onHold'].filter((type) => !survey.some((task) => !task.completed && task.status.type === type)),
      [],
      'open tasks to do, in progress, and waiting',
    );
    assert.ok(find('#contract/relay-survey is:overdue').length >= 1, 'a survey task is overdue');
    assert.ok(find('#contract/relay-survey assignee = @tomas-vey is:open').length >= 3, 'three open for Tomas');
    const relayHub = buildHubTree(index, now)
      .find((group) => group.label === 'Contracts')
      ?.children.find((hub: HubTreeNode) => hub.label === 'Relay survey');
    assert.deepStrictEqual(
      ['Survey flight plan', 'Buoy checklist'].filter((label) => !relayHub?.children.some((note) => note.label === label)),
      [],
      'the flight plan and the checklist filed under the Relay survey',
    );

    // Upkeep, a bid, and a hull to inspect.
    const [hull] = titled('Hull inspection');
    assert.strictEqual(hull?.filePath, 'systems/Hull.md');
    assert.strictEqual(hull?.dueAt, new Date(2026, 9, 12).getTime());
    assert.match(files.get('contracts/Medical supply run.md') ?? '', /^state: bidding$/m);
    assert.strictEqual(titled('Replace CO2 scrubber cartridges').find((task) => !task.completed)?.recurrence, 'every week');

    // Yesterday left two tasks open, and nothing else in the last week was.
    assert.deepStrictEqual(
      planRollover(index, '2026-10-07', ROLLOVER_LOOKBACK_DAYS)?.tasks.map((task) => task.sourceLineText),
      ['- [ ] Port clearance for the ice haul 📅 2026-10-05', '- [ ] Order spare scrubber cartridges 📅 2026-10-06'],
    );
    // A week's review has work done to list.
    const weekStart = new Date(2026, 9, 3).getTime();
    assert.ok(tasks.filter((task) => task.completed && (task.doneAt ?? 0) >= weekStart).length >= 4, 'done in the last five days');
    // An open question, which a later line answers.
    assert.deepStrictEqual(
      parsed.get('2026-09-28.md')?.questions?.map((question) => [question.title, question.answer]),
      [['Does Pallas Yard need a new hull certificate before the ice haul? @ottilie-brandt', undefined]],
    );
  });

  test('reads its dates from the day it is made', () => {
    assert.strictEqual(resolveSampleTokens('{{date}} {{date-9}} {{date+3}}', today), '2026-10-07 2026-09-28 2026-10-10');
    assert.strictEqual(resolveSampleTokens('{{month+1}} {{month-1}}', today), '2026-11-15 2026-09-15');
    assert.strictEqual(resolveSampleTokens('{{month+1}}', new Date(2026, 11, 31)), '2027-01-15', 'into the next year');
    assert.strictEqual(sampleFileName('day-1.md', today), '2026-10-06.md');
    assert.strictEqual(sampleFileName('Harbor.md', today), 'Harbor.md');
    assert.strictEqual(sampleFileName('dot-vscode', today), '.vscode');
    assert.ok(isSampleNote('contracts/Relay survey.md'));
    assert.ok(!isSampleNote('README.md') && !isSampleNote('templates/Briefing.md') && !isSampleNote('Types/Contract.md'));
  });

  test('is replaced only when asked, and never merged onto what is there', async () => {
    const { target } = await installSample({ extensionUri, storageUri: storage, today });
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(target, 'mine.md'), Buffer.from('# Mine\n'));
    await assert.rejects(() => installSample({ extensionUri, storageUri: storage, today }), /already a sample/);
    await installSample({ extensionUri, storageUri: storage, today, fs: vscode.workspace.fs, replace: true });
    assert.ok(!(await installed(target)).has('mine.md'), 'a fresh copy');
  });

  test('shows its README only in the folder it opened', () => {
    const sample = vscode.Uri.file('/storage/deckard-work-sample');
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
