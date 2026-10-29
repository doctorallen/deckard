import * as assert from 'assert';

import type { WorkspaceIndex } from '../domain/model';
import { createQueryContext, type QueryContext } from '../domain/query/queryContext';
import { findPromises, formatPromiseTask } from '../domain/tasks/promises';
import { answerDescribeTag } from '../ui/state/assistantDescribe';
import { betweenQueries, collectBetweenLines, countAgendaLines, describeBetween, formatBetweenAgenda, personFirstName } from '../ui/state/betweenYou';
import { createSearchPageSnapshot } from '../ui/state/searchPageState';
import { createPreferences, MemoryStore } from './preferenceServices';
import { indexOf } from './typedWorkspace';

const lines = (...text: string[]): string => text.join('\n');

/** The moment the card is asked at: 14 Oct 2026, noon. */
const now = new Date(2026, 9, 14, 12).getTime();

/** Reading as David, who writes himself as `@david`. */
const asDavid: QueryContext = createQueryContext(now, { identity: '@david' });

/**
 * The lines of the plan's table, with Sam's hub note: each line is said in
 * its own words where it goes.
 */
function samWorkspace(extra: Record<string, string> = {}): WorkspaceIndex {
  return indexOf({
    'People/Sam Okafor.md': lines('---', 'describes: "@sam-okafor"', '---', '# Sam Okafor', 'Quant developer.'),
    'People/Lena Brandt.md': lines('---', 'describes: "@lena-brandt"', '---', '# Lena Brandt'),
    'notes/2026-10-02.md': lines(
      '# 2026-10-02',
      '- [ ] Send @sam-okafor the recon field mapping 📅 2026-10-06',
      '- [ ] Review the loader PR 👤 @david @sam-okafor',
      '- [ ] Rates lineage diagram 👤 @sam-okafor',
      '- [w] Prod read access for FX recon @sam-okafor',
      '- [ ] Chase the vendor @sam-okafor 👤 @lena-brandt',
      '- [x] Send Sam the UAT login @sam-okafor',
      '- [ ] Book the room',
      '- [?] Who approves access to the bond UAT? @sam-okafor',
      '- [?] Where is the runbook? @sam-okafor',
      '  - Answer: in the wiki',
      '- [?] Who signs off on the vendor? @lena-brandt',
    ),
    ...extra,
  });
}

/** Each group's task and question titles, by group, as the card lists them. */
function titles(index: WorkspaceIndex, tagKey: string, context: QueryContext): Record<string, string[]> {
  return Object.fromEntries((collectBetweenLines(index, tagKey, context) ?? []).map((group) => [
    group.kind,
    [...group.tasks, ...group.questions].map((line) => line.title.trim()),
  ]));
}

suite('Between you', () => {
  test('each group is one search the language already says', () => {
    assert.deepStrictEqual(betweenQueries('@sam-okafor'), {
      youOwe: 'is:open is:mine -is:waiting -is:parked @sam-okafor',
      theyOwe: 'is:open -is:parked (assignee = @sam-okafor OR (is:waiting is:mine @sam-okafor))',
      toAsk: 'is:unanswered @sam-okafor',
    });
  });

  test('sorts the lines of the plan’s table into what you owe and what you are owed', () => {
    assert.deepStrictEqual(titles(samWorkspace(), '@sam-okafor', asDavid), {
      // Your task that mentions Sam (D10), and one assigned to you that does.
      youOwe: ['Send @sam-okafor the recon field mapping', 'Review the loader PR @sam-okafor'],
      // Assigned to Sam, and waiting with a mention (D11). Lena's task is
      // hers, and the done one has left the card.
      theyOwe: ['Rates lineage diagram', 'Prod read access for FX recon @sam-okafor'],
      // The open question that names Sam; the answered one, and Lena's, are not here.
      toAsk: ['Who approves access to the bond UAT? @sam-okafor'],
    });
  });

  test('lists the open questions that name the person on their own line to ask them, oldest first', () => {
    const index = indexOf({
      'notes/2026-10-01.md': lines('# 2026-10-01', '- [?] Older one @sam'),
      'notes/2026-10-05.md': lines('# 2026-10-05', '- [?] Newer one @sam', '## With @sam', '- [?] Under his heading'),
    });
    assert.deepStrictEqual(titles(index, '@sam', asDavid).toAsk, ['Older one @sam', 'Newer one @sam']);
    const toAsk = describeBetween(index, '@sam', asDavid)?.groups.find((group) => group.kind === 'toAsk');
    assert.strictEqual(toAsk?.count, 2, 'a person with only questions open still has a card');
    assert.deepStrictEqual(toAsk?.questions?.map((question) => [question.text, question.filePath, question.line, question.answered]), [
      ['Older one @sam', 'notes/2026-10-01.md', 2, false],
      ['Newer one @sam', 'notes/2026-10-05.md', 2, false],
    ]);
    assert.deepStrictEqual(toAsk?.tasks, []);
  });

  test('a task assigned to a third person shows on their page, and not as owed by them to Sam', () => {
    const lena = titles(samWorkspace(), '@lena-brandt', asDavid);
    assert.deepStrictEqual(lena, { youOwe: [], theyOwe: ['Chase the vendor @sam-okafor'], toAsk: ['Who signs off on the vendor? @lena-brandt'] });
  });

  test('a task assigned to Sam that mentions you is still Sam’s to do', () => {
    const index = samWorkspace({ 'notes/more.md': lines('# More', '- [ ] Send @david the curve notes 👤 @sam-okafor') });
    assert.ok(titles(index, '@sam-okafor', asDavid).theyOwe.includes('Send @david the curve notes'));
    assert.ok(!titles(index, '@sam-okafor', asDavid).youOwe.includes('Send @david the curve notes'));
  });

  test('your own waiting task that mentions Sam is Sam’s, whether or not it names you', () => {
    const index = samWorkspace({ 'notes/more.md': lines('# More', '- [w] Sign-off from @sam-okafor 👤 @david') });
    assert.ok(titles(index, '@sam-okafor', asDavid).theyOwe.includes('Sign-off from @sam-okafor'));
    assert.ok(!titles(index, '@sam-okafor', asDavid).youOwe.includes('Sign-off from @sam-okafor'));
  });

  test('a promise tracked from today’s note, a waiting task assigned to Sam, is Sam’s to do', () => {
    const today = ['# 2026-10-14', '- @sam-okafor says the loader retry fix lands by Friday'];
    const promise = findPromises(today, { now, identity: '@david' })[0];
    const tracked = [...today, formatPromiseTask(today, promise, { format: 'emoji' })];
    assert.strictEqual(tracked[2], '  - [w] Loader retry fix lands 📅 2026-10-16 👤 @sam-okafor');
    const groups = titles(samWorkspace({ 'notes/2026-10-14.md': lines(...tracked) }), '@sam-okafor', asDavid);
    assert.ok(groups.theyOwe.includes('Loader retry fix lands'));
    assert.ok(!groups.youOwe.includes('Loader retry fix lands'));
  });

  test('a person whose name is not ASCII is owed what is assigned to them, and their promise reads back as tracked', () => {
    const index = indexOf({ 'notes/a.md': lines('# A', '- [ ] Send it @józef', '- [ ] Do it 👤 @józef') });
    assert.deepStrictEqual(titles(index, '@józef', asDavid), { youOwe: ['Send it @józef'], theyOwe: ['Do it'], toAsk: [] });
    const today = ['- @józef says the loader fix lands by Friday'];
    const tracked = formatPromiseTask(today, findPromises(today, { now, identity: '@david' })[0], { format: 'emoji' });
    assert.strictEqual(tracked, '  - [w] Loader fix lands 📅 2026-10-16 👤 @józef');
    assert.deepStrictEqual(findPromises([...today, tracked], { now, identity: '@david' }), []);
  });

  test('puts what is overdue first, the longest overdue first, then the oldest', () => {
    const index = indexOf({
      'notes/a.md': lines(
        '# A',
        '- [ ] Newer @sam ➕ 2026-10-10',
        '- [ ] Late a little @sam 📅 2026-10-12 ➕ 2026-10-11',
        '- [ ] Older @sam ➕ 2026-09-01',
        '- [ ] Late a lot @sam 📅 2026-10-01 ➕ 2026-10-11',
      ),
    });
    assert.deepStrictEqual(titles(index, '@sam', asDavid).youOwe, ['Late a lot @sam', 'Late a little @sam', 'Older @sam', 'Newer @sam']);
  });

  test('names the person by the first word of their hub note’s title, else of their tag', () => {
    const index = samWorkspace();
    assert.strictEqual(personFirstName(index, '@sam-okafor'), 'Sam');
    assert.strictEqual(personFirstName(indexOf({ 'notes/a.md': '# A @noor-haddad' }), '@noor-haddad'), 'Noor');
    assert.deepStrictEqual(collectBetweenLines(index, '@sam-okafor', asDavid)?.map((group) => group.label), ['You owe Sam', 'Sam owes you', 'To ask Sam']);
  });

  test('gives no card to a tag that is no person, to your own page, or to someone with nothing open between you', () => {
    const index = samWorkspace({ 'notes/team.md': lines('# Team #team/rates', '- [ ] Rates thing @sam-okafor #team/rates') });
    assert.strictEqual(describeBetween(index, '#team/rates', asDavid), undefined);
    assert.strictEqual(describeBetween(samWorkspace({ 'notes/me.md': '# Me @david\n- [ ] Mine @david' }), '@david', asDavid), undefined);
    assert.strictEqual(describeBetween(samWorkspace(), '@sam-okafor', createQueryContext(now, { identity: '#person/sam-okafor' })), undefined, 'the reader’s own page, however their tag is written');
    assert.strictEqual(describeBetween(indexOf({ 'notes/a.md': '# A @quiet\n- [x] Done @quiet' }), '@quiet', asDavid), undefined);
  });

  test('draws each group’s first ten lines, and counts them all', () => {
    const tasks = Array.from({ length: 12 }, (_, at) => `- [ ] Thing ${at + 1} @sam ➕ 2026-09-${String(at + 1).padStart(2, '0')}`);
    const between = describeBetween(indexOf({ 'notes/a.md': lines('# A', ...tasks) }), '@sam', asDavid);
    const owe = between?.groups.find((group) => group.kind === 'youOwe');
    assert.strictEqual(owe?.count, 12);
    assert.strictEqual(owe?.tasks.length, 10);
    assert.strictEqual(owe?.tasks[0].task.title.trim(), 'Thing 1 @sam');
    assert.strictEqual(between?.groups.find((group) => group.kind === 'theyOwe')?.count, 0, 'an empty group is still drawn');
  });

  test('says so while deckard.me names nobody, when only what names nobody is yours', () => {
    const between = describeBetween(samWorkspace(), '@sam-okafor', createQueryContext(now));
    assert.strictEqual(between?.needsIdentity, true);
    assert.deepStrictEqual(between?.groups.map((group) => group.tasks.map((item) => item.task.title.trim())), [
      ['Send @sam-okafor the recon field mapping'],
      ['Rates lineage diagram', 'Prod read access for FX recon @sam-okafor'],
      [],
    ]);
    assert.strictEqual(describeBetween(samWorkspace(), '@sam-okafor', asDavid)?.needsIdentity, undefined);
  });

  test('copies the groups as an agenda: a heading each, then the lines as tasks with their due dates, and the questions as questions', () => {
    const groups = collectBetweenLines(samWorkspace(), '@sam-okafor', asDavid) ?? [];
    assert.strictEqual(
      formatBetweenAgenda(groups),
      lines(
        '## You owe Sam',
        '- [ ] Send @sam-okafor the recon field mapping (due 2026-10-06)',
        '- [ ] Review the loader PR @sam-okafor',
        '',
        '## Sam owes you',
        '- [ ] Rates lineage diagram',
        '- [ ] Prod read access for FX recon @sam-okafor',
        '',
        '## To ask Sam',
        '- [?] Who approves access to the bond UAT? @sam-okafor',
      ),
    );
    assert.strictEqual(countAgendaLines(groups), 5);
    assert.strictEqual(formatBetweenAgenda(groups.map((group) => (group.kind === 'theyOwe' ? { ...group, tasks: [] } : group))).includes('owes you'), false, 'an empty group is left out');
  });

  test('a person’s page carries the card under its fields, and a search that narrows it does not', () => {
    const index = samWorkspace();
    const preferences = createPreferences(new MemoryStore()).reader.value;
    const page = createSearchPageSnapshot(index, preferences, '@sam-okafor', { queryContext: asDavid });
    assert.deepStrictEqual(page.between?.groups.map((group) => [group.label, group.count]), [['You owe Sam', 2], ['Sam owes you', 2], ['To ask Sam', 1]]);
    assert.strictEqual(createSearchPageSnapshot(index, preferences, '@sam-okafor is:overdue', { queryContext: asDavid }).between, undefined);
    assert.strictEqual(createSearchPageSnapshot(index, preferences, 'is:open', { queryContext: asDavid }).between, undefined);
  });

  test('the describe tool counts each group for a person, and says nothing of it for a tag that is none', () => {
    const index = samWorkspace({ 'notes/team.md': '# Team #team/rates' });
    assert.match(answerDescribeTag(index, { tag: '@sam-okafor' }, now, asDavid), /\nBetween you: You owe Sam: 2\. Sam owes you: 2\. To ask Sam: 1\.$/m);
    assert.match(answerDescribeTag(index, { tag: '@sam-okafor' }, now, createQueryContext(now)), /the "Me" setting names nobody/);
    assert.doesNotMatch(answerDescribeTag(index, { tag: '#team/rates' }, now, asDavid), /Between you/);
    assert.doesNotMatch(answerDescribeTag(index, { tag: '@sam-okafor' }, now), /Between you/, 'nothing without a context to ask in');
  });
});
