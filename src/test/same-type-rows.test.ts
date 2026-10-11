import * as assert from 'assert';

import { computeParked } from '../domain/index/parked';
import type { WorkspaceIndex } from '../domain/model';
import { createQueryContext } from '../domain/query/queryContext';
import { evaluateTypeRows } from '../domain/query/queryEvaluator';
import { getTypeIndex } from '../domain/types/typeIndex';
import { parseWorkspaceQuery } from '../domain/types/typeQueryFields';
import type { SameTypeRows } from '../ui/protocol/sidebarNotes';
import { describeSameTypeRows, SAME_TYPE_GROUP_LIMIT } from '../ui/state/sameTypeRows';
import { parkedRules } from './parkedFixture';
import { renderPage } from './pages';
import { indexOf, now } from './typedWorkspace';
import { openWebviewPage, WebviewPage } from './webviewPage';

const lines = (...text: string[]): string => text.join('\n');

/** A type note: its key, what its rows are, and its table's rows, `| team | Team | members |`. */
function typeNote(key: string, rows: string, fields: readonly string[]): string {
  return lines(
    '---',
    `deckard-type: ${key}`,
    `rows: ${rows}`,
    '---',
    `# ${key.charAt(0).toUpperCase()}${key.slice(1)}`,
    '',
    '| Field | Kind | Reverse |',
    '| ----- | ---- | ------- |',
    ...fields,
  );
}

/** A hub note: the tag it describes, its front matter, and its title. */
function hub(tag: string, title: string, ...frontmatter: string[]): string {
  return lines('---', `describes: "${tag}"`, ...frontmatter, '---', `# ${title}`);
}

/** A note row: its type, its front matter, and its title. */
function noteRow(type: string, title: string, ...frontmatter: string[]): string {
  return lines('---', `type: ${type}`, ...frontmatter, '---', `# ${title}`);
}

/**
 * People on teams with managers, projects of people, and decisions on
 * projects: a Payments team of four, one of them parked; Jo on Search with
 * the same manager; Kim, on a project, with no note; and a Tier type no
 * relation names.
 */
function workspace(): WorkspaceIndex {
  const index = indexOf({
    'Types/Person.md': typeNote('person', '"@*"', [
      '| role | Text | |',
      '| team | Team | members |',
      '| manager | Person | reports |',
      '| email | Email | |',
    ]),
    'Types/Team.md': typeNote('team', '"#team/*"', ['| lead | Person | lead of |']),
    'Types/Project.md': typeNote('project', 'notes', ['| people | Person, many | works on |', '| team | Team | projects |']),
    'Types/Decision.md': typeNote('decision', 'notes', ['| project | Project | decisions |', '| owner | Person | owns |', '| spec | Note | |']),
    'Types/Tier.md': typeNote('tier', '"#tier/*"', ['| rank | Number | |']),
    'Teams/Payments.md': hub('#team/payments', 'Payments', 'lead: "@alex"'),
    'Teams/Search.md': hub('#team/search', 'Search', 'type: project', 'team: search'),
    'People/Alex Rivera.md': hub('@alex', 'Alex Rivera', 'role: Head of Payments', 'team: "#team/payments"'),
    'People/Sam Okafor.md': hub('@sam', 'Sam Okafor', 'role: Engineer', 'team: payments', 'manager: "@alex"', 'email: sam@example.com'),
    'People/Lee Chen.md': hub('@lee', 'Lee Chen', 'team: Payments', 'manager: alex'),
    'People/Jo Park.md': hub('@jo', 'Jo Park', 'team: "#team/search"', 'manager: "@alex"'),
    'Archive/Pat Old.md': hub('@pat', 'Pat Old', 'role: Former engineer', 'team: payments'),
    'Projects/Checkout v2.md': noteRow('project', 'Checkout v2', 'people: ["@sam", "@kim", "@lee"]', 'team: payments'),
    'Projects/Ledger.md': noteRow('project', 'Ledger', 'people: ["@sam"]'),
    'Decisions/Use Postgres.md': noteRow('decision', 'Use Postgres', 'project: Checkout v2', 'owner: "@sam"', 'spec: "[[Storage spec]]"'),
    'Decisions/Drop Redis.md': noteRow('decision', 'Drop Redis', 'project: "[[Checkout v2]]"', 'spec: Storage spec'),
    'Decisions/Hire.md': noteRow('decision', 'Hire', 'owner: "@sam"'),
    'Decisions/Lone.md': noteRow('decision', 'Lone', 'project: Ledger'),
    'notes/Storage spec.md': '# Storage spec',
    'notes/standup.md': '# Standup @kim',
    'Tiers/Gold.md': hub('#tier/gold', 'Gold', 'rank: 1'),
  });
  index.parked = computeParked(index, parkedRules({ folders: ['Archive'] }));
  return index;
}

/** The section's groups as `field value: title (detail)` lines, a parked row marked. */
function describe(section: SameTypeRows | undefined): string[] {
  return (section?.groups ?? []).map((group) => {
    const rows = group.rows.map((row) => `${row.title}${row.detail ? ` (${row.detail})` : ''}${row.parked ? ' [parked]' : ''}`);
    return `${group.reverse ? '~' : ''}${group.field} ${group.value}: ${rows.join('; ')}${group.more ? ` +${group.more}` : ''}`;
  });
}

/** The rows a search finds, by id, sorted, parsed with the workspace's types as the search page parses it. */
function rowsFound(index: WorkspaceIndex, query: string): string[] {
  const parsed = parseWorkspaceQuery(index, query);
  assert.deepStrictEqual(parsed.diagnostics, [], query);
  return evaluateTypeRows(index, parsed.node, createQueryContext(now)).sort();
}

suite('Other rows of a note\'s type', () => {
  const index = workspace();

  test('groups the other people by each relation\'s value, then each reverse\'s', () => {
    const section = describeSameTypeRows(index, 'People/Sam Okafor.md');
    assert.deepStrictEqual(describe(section), [
      'team Payments: Alex Rivera (Head of Payments); Lee Chen (manager Alex Rivera); Pat Old (Former engineer) [parked]',
      'manager Alex Rivera: Jo Park (team Search); Lee Chen (team Payments)',
      // Sam works on Checkout v2 and Ledger; no one else works on Ledger.
      '~works on Checkout v2: Kim (No hub note); Lee Chen (team Payments)',
    ]);
    assert.strictEqual(section?.plural, 'people');
    assert.strictEqual(section?.query, 'type = person');
    assert.strictEqual(section?.count, 5, 'Alex, Lee, Pat, Jo, and Kim, each once');
    const reverse = section?.groups[2];
    assert.strictEqual(reverse?.tip, 'From each project\'s people');
  });

  test('a row opens its note, or its tag\'s page when it has none', () => {
    const rows = (describeSameTypeRows(index, 'People/Sam Okafor.md')?.groups ?? []).flatMap((group) => group.rows);
    const kim = rows.find((row) => row.id === '@kim');
    assert.deepStrictEqual(kim, { id: '@kim', title: 'Kim', detail: 'No hub note', tagKey: '@kim' });
    assert.deepStrictEqual(rows.find((row) => row.id === '@alex'), {
      id: '@alex',
      title: 'Alex Rivera',
      detail: 'Head of Payments',
      filePath: 'People/Alex Rivera.md',
    });
  });

  test('each group\'s search finds exactly its rows and the note\'s own', () => {
    const notes = ['People/Sam Okafor.md', 'People/Lee Chen.md', 'Decisions/Use Postgres.md', 'Projects/Checkout v2.md'];
    let checked = 0;
    for (const filePath of notes) {
      const section = describeSameTypeRows(index, filePath);
      const own = getTypeIndex(index).rowsOfFile(filePath)[0].id;
      assert.deepStrictEqual(rowsFound(index, section?.query ?? ''), getTypeIndex(index).rows(section?.typeKey).map((row) => row.id).sort());
      for (const group of section?.groups ?? []) {
        assert.ok(group.query, `${filePath}: ${group.field} ${group.value}`);
        assert.strictEqual(group.more, 0);
        assert.deepStrictEqual(rowsFound(index, group.query), [own, ...group.rows.map((row) => row.id)].sort(), group.query);
        checked += 1;
      }
    }
    assert.ok(checked >= 8, `checked ${checked} groups`);
  });

  test('writes each value as a search resolves it: a tag, a quoted title, field. for a built-in\'s name', () => {
    assert.deepStrictEqual(describeSameTypeRows(index, 'People/Sam Okafor.md')?.groups.map((group) => group.query), [
      'type = person AND team = #team/payments',
      'type = person AND manager = @alex',
      'type = person AND works-on = "Checkout v2"',
    ]);
    const decision = describeSameTypeRows(index, 'Decisions/Use Postgres.md');
    assert.deepStrictEqual(describe(decision), [
      'project Checkout v2: Drop Redis (spec Storage spec)',
      'owner Sam Okafor: Hire',
      'spec Storage spec: Drop Redis (project Checkout v2)',
    ]);
    assert.deepStrictEqual(decision?.groups.map((group) => group.query), [
      'type = decision AND project = "Checkout v2"',
      'type = decision AND field.owner = @sam',
      'type = decision AND spec = "Storage spec"',
    ]);
  });

  test('a row in no group says what it was compared by', () => {
    const lone = describeSameTypeRows(index, 'Decisions/Lone.md');
    assert.deepStrictEqual(lone?.groups, []);
    assert.strictEqual(lone?.count, 0);
    assert.strictEqual(lone?.empty, 'No other decision shares a project, owner, or spec.');
    // One field is named alone, with `an` before a vowel.
    const alone = indexOf({
      'Types/Item.md': typeNote('item', 'notes', ['| owner | Person | |', '| team | Text | |']),
      'Items/Ann.md': noteRow('item', 'Ann'),
    });
    assert.strictEqual(describeSameTypeRows(alone, 'Items/Ann.md')?.empty, 'No other item shares an owner.');
  });

  test('none for an untyped note, a type with no relation, or a workspace with no types', () => {
    assert.strictEqual(describeSameTypeRows(index, 'notes/standup.md'), undefined);
    assert.strictEqual(describeSameTypeRows(index, 'Tiers/Gold.md'), undefined);
    assert.strictEqual(describeSameTypeRows(indexOf({ 'notes/a.md': '# A #team/x' }), 'notes/a.md'), undefined);
  });

  test('a note that holds two rows is read as its first by type key, as the Note page reads it', () => {
    // Search's note describes #team/search and is a project row too.
    assert.deepStrictEqual(getTypeIndex(index).rowsOfFile('Teams/Search.md').map((row) => row.typeKey).sort(), ['project', 'team']);
    const section = describeSameTypeRows(index, 'Teams/Search.md');
    assert.strictEqual(section?.typeKey, 'project');
    assert.strictEqual(section?.empty, 'No other project shares a people, team, or decisions.');
  });

  test('lists eight to a group, the parked last, and counts the rest', () => {
    const people = Array.from({ length: 11 }, (_, at) => at);
    const notes: Record<string, string> = {
      'Types/Person.md': typeNote('person', '"@*"', ['| team | Team | members |']),
      'Types/Team.md': typeNote('team', '"#team/*"', []),
    };
    people.forEach((at) => {
      // Two of them, A0 and A1, are parked, though their names come first.
      const folder = at < 2 ? 'Archive' : 'People';
      notes[`${folder}/A${at}.md`] = hub(`@a${at}`, `A${at}`, 'team: "#team/big"');
    });
    const big = indexOf(notes);
    big.parked = computeParked(big, parkedRules({ folders: ['Archive'] }));
    const section = describeSameTypeRows(big, 'People/A10.md');
    const group = section?.groups[0];
    assert.strictEqual(group?.rows.length, SAME_TYPE_GROUP_LIMIT);
    assert.strictEqual(group?.more, 2);
    assert.deepStrictEqual(group?.rows.map((row) => row.title), ['A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9']);
    assert.strictEqual(section?.count, 10);
    assert.strictEqual(rowsFound(big, group?.query ?? '').length, 11);
  });
});

suite('Other rows of a note\'s type, in Context', () => {
  let page: WebviewPage | undefined;
  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  /** Sam's note in Context, with the other people. */
  const open = (savedState: unknown = {}): WebviewPage => {
    page = openWebviewPage(renderPage('sidebarNotes'), {
      activeFileName: 'Sam Okafor.md',
      activeTags: [],
      notes: [],
      state: 'noMatches',
      sameType: describeSameTypeRows(workspace(), 'People/Sam Okafor.md'),
      links: {
        linkedFromNotes: [{ filePath: 'notes/standup.md', title: 'standup', entries: [{ filePath: 'notes/standup.md', title: 'standup', line: 1, text: '[[Sam Okafor]]', headingPath: [] }], linkCount: 1 }],
        linkedFromCount: 1,
        linkedFromNoteCount: 1,
        mentions: [],
        mentionCount: 0,
      },
      parkedTags: [],
    }, { savedState });
    return page;
  };

  test('draws the heading, its All link, each group\'s label, and its rows', () => {
    const view = open();
    assert.strictEqual(view.text('.same-type summary'), 'Other people 5');
    assert.strictEqual(view.text('.same-type-all'), 'All people');
    assert.deepStrictEqual(view.findAll('.same-type-label').map((label) => label.textContent), [
      'team Payments',
      'manager Alex Rivera',
      'works on Checkout v2',
    ]);
    assert.strictEqual(view.findAll('.same-type-key.is-reverse').length, 1);
    assert.deepStrictEqual(
      view.findAll('.same-type-group')[0].querySelectorAll('.same-type-detail')[2].textContent,
      'Former engineer · Parked',
    );
    // It sits above what links here.
    assert.ok(view.find('.same-type').compareDocumentPosition(view.find('.note-links')) & view.window.Node.DOCUMENT_POSITION_FOLLOWING);
  });

  test('a row opens itself, and a label or All opens its search, by id', () => {
    const view = open();
    view.click('[data-action="open-same-type-row"][data-row-id="@kim"]');
    assert.deepStrictEqual(view.lastPosted('openSameTypeRow'), { type: 'openSameTypeRow', rowId: '@kim' });
    view.click('.same-type-label');
    assert.deepStrictEqual(view.lastPosted('openSameTypeSearch'), { type: 'openSameTypeSearch', group: 'team=#team/payments' });
    view.click('.same-type-all');
    assert.deepStrictEqual(view.lastPosted('openSameTypeSearch'), { type: 'openSameTypeSearch' });
  });

  test('says what it compared by when nothing is shared', () => {
    page = openWebviewPage(renderPage('sidebarNotes'), {
      activeFileName: 'Lone.md',
      activeTags: [],
      notes: [],
      state: 'noMatches',
      sameType: describeSameTypeRows(workspace(), 'Decisions/Lone.md'),
      parkedTags: [],
    });
    assert.strictEqual(page.text('.same-type summary'), 'Other decisions');
    assert.strictEqual(page.text('.same-type .links-more'), 'No other decision shares a project, owner, or spec.');
    assert.strictEqual(page.text('.same-type-all'), 'All decisions');
  });

  test('stays folded as the reader left it', () => {
    const folded = open({ linksOpen: { linked: true, mentions: false, sameType: false } });
    assert.strictEqual((folded.find('[data-links-group="sameType"]') as HTMLDetailsElement).open, false);
    assert.deepStrictEqual((folded.savedState() as { linksOpen: unknown }).linksOpen, { linked: true, mentions: false, sameType: false });
  });
});
