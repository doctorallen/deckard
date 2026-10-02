import * as assert from 'assert';

import { tokenizeInline } from '../domain/markdown/inline';
import type { Task } from '../domain/model/tasks';
import type { DashboardTask } from '../ui/protocol/shared';
import { normalizeBody } from '../../test/harness/domSnapshot';
import { bundleShared } from './sharedBundle';
import { templateRecords } from './templateRecords';
import { openWebviewPage, WebviewPage } from './webviewPage';

/**
 * The shared task parts (src/webview/shared: taskRow, taskTitle, tagButton)
 * against the template script they replaced (deleted in Phase 6 step 7):
 * each must draw the DOM the template's helper drew, as test:dom normalizes
 * it, so the Task Board, a search's tasks, Home, and the calendar's day draw
 * what they drew. The template's side is its recording (templateRecords.ts);
 * the title it was handed was the HTML legacyMarkdown.ts writes.
 *
 * The dates are local times, as a note's are, so the recording holds in
 * every time zone.
 */

/** What the template drew, by case. */
const drawnByTemplate = templateRecords('webview-tasks');

/** A page running the shared parts, with their exports on `window.shared`. */
function corePage(): WebviewPage {
  const bundle = bundleShared(['taskRow', 'taskTitle', 'tagButton', 'strokeIcons']);
  return openWebviewPage(`<!DOCTYPE html><html><head></head><body><main id="app"></main><div id="live-status"></div><script>${bundle}</script></body></html>`);
}

type Helpers = Record<string, (...args: unknown[]) => unknown>;

/** A task as the index holds one, with what a test gives it. */
function task(title: string, extra: Partial<Task> = {}): Task {
  return {
    id: `notes/atlas.md:${title.length}`,
    filePath: 'notes/atlas.md',
    title,
    completed: false,
    tags: [],
    tagLabels: {},
    lineNumber: 7,
    checkboxColumn: 3,
    checkboxValue: ' ',
    sourceLineText: `- [ ] ${title}`,
    ...extra,
  };
}

/** A task as a list draws it, its title as tokens. */
function listed(title: string, extra: Partial<Task> = {}, item: Partial<DashboardTask> = {}): DashboardTask {
  return {
    task: task(title, extra),
    titleTokens: JSON.parse(JSON.stringify(tokenizeInline(title))),
    titleTags: [],
    fileName: 'atlas.md',
    ...item,
  };
}

const ATLAS = { key: '#project/atlas', label: '#project/atlas' };
const PHONE = { key: '#context/phone', label: '#context/phone' };

suite('The shared task parts draw what the template script drew', () => {
  let core: WebviewPage;
  suiteSetup(() => {
    core = corePage();
  });
  suiteTeardown(() => {
    core.dispose();
  });

  const shared = (): Helpers => (core.window as unknown as { shared: Helpers }).shared;
  const element = (name: string, props: object): unknown => shared().h(shared()[name], props);

  const drawnNow = (vnode: unknown): Element => {
    const container = core.document.createElement('div');
    shared().render(vnode, container);
    return container;
  };
  /** The part drawn now is what the template drew for the case `name`. */
  const assertSame = (name: string, now: Element, what = name): void => {
    assert.strictEqual(normalizeBody(now), drawnByTemplate(name), what);
  };

  test('a priority badge, for each priority and for none', () => {
    for (const priority of ['highest', 'high', 'medium', 'low', 'lowest', 'HIGH', '', undefined, 'urgent']) {
      assertSame(`priority ${String(priority)}`, drawnNow(element('PriorityBadge', { priority })), String(priority));
    }
  });

  test('a tag that opens its overview, and a title with its tags as controls', () => {
    for (const className of ['inline-tag', undefined]) {
      assertSame(`tag button ${String(className)}`, drawnNow(element('TagButton', { tag: ATLAS, className })), String(className));
    }
    const titles: Array<[string, Array<{ key: string; label: string }>]> = [
      ['Call Ren #context/phone about #project/atlas', [ATLAS, PHONE]],
      ['Call Ren', [ATLAS]],
      ['#project/atlas first', [ATLAS]],
      ['Nothing tagged', []],
      ['A.b+c? #a.b+c?', [{ key: '#a.b+c?', label: '#a.b+c?' }]],
      ['Empty label', [{ key: '#x', label: '' }]],
    ];
    for (const [title, tags] of titles) {
      for (const appendMissing of [true, false]) {
        assertSame(
          `title with tags ${title}, appending ${appendMissing}`,
          drawnNow(element('TitleWithTags', { title, tags, appendMissing })),
          `${title}, appending ${appendMissing}`,
        );
      }
    }
  });

  test('a task title in inline Markdown, with the tags written in it as controls', () => {
    const titles = [
      'Send the proposal #project/atlas',
      'Read **the brief for #project/atlas** and `#context/phone` today',
      'Line one #project/atlas\nLine two #context/phone',
      '[A link #project/atlas](https://example.com) then #project/atlas',
      'Escapes \\*not em\\* &amp; #project/atlas',
      'A [[Wiki #project/atlas]] stays',
      'Plain words',
    ];
    for (const title of titles) {
      const tokens = JSON.parse(JSON.stringify(tokenizeInline(title)));
      for (const tags of [[ATLAS, PHONE], []]) {
        assertSame(
          `task title ${title} with ${tags.length} tags`,
          drawnNow(element('TaskTitle', { tokens, tags })),
          `${title} with ${tags.length} tags`,
        );
      }
    }
  });

  test('a task row, with each fact it can carry', () => {
    const dated = new Date(2026, 8, 22, 12).getTime();
    const items: Array<[string, DashboardTask]> = [
      ['plain', listed('Send the proposal')],
      ['done', listed('Send the proposal', { completed: true, checkboxValue: 'x' })],
      ['due and overdue', listed('Pay rent', {}, { dueLabel: 'Overdue 3 days · 2026-09-18', overdue: true })],
      ['due and stale', listed('Pay rent', {}, { dueLabel: 'Was due 2026-06-01', stale: true })],
      ['due, on time', listed('Pay rent', {}, { dueLabel: 'Due tomorrow · 2026-09-22' })],
      ['due as written', listed('Pay rent', { dueText: 'next week' })],
      ['scheduled, priority, repeat, steps', listed('Plan **the trip**', { scheduledAt: dated, priority: 'high', recurrence: 'every week' }, { stepsLabel: '2 of 5 steps · next: Book' })],
      ['parked, with a heading path', listed('Tidy', {}, { parked: true, headingPath: ['Atlas', 'Actions', 'Tidy'] })],
      ['a path whose first step is the file', listed('Tidy', {}, { headingPath: ['atlas', 'Actions'] })],
      ['tags in the title', listed('Call Ren #context/phone', {}, { titleTags: [PHONE] })],
    ];
    const options: Array<[string, Record<string, unknown>]> = [
      ['inline', { titleDisplay: 'inline' }],
      ['separate', { titleDisplay: 'separate' }],
      ['draggable, with a menu', { draggable: true, trailing: shared().h('button', { class: 'row-menu' }, '⋯') }],
      ['a mark in place of the checkbox', { leading: shared().h('span', { class: 'repeat-mark', 'aria-hidden': 'true' }, '↻') }],
    ];
    for (const [what, item] of items) {
      for (const [how, now] of options) {
        assertSame(`task row ${what}, ${how}`, drawnNow(element('TaskListRow', { item, ...now })), `${what}, ${how}`);
      }
    }
  });

  test('a date as the note writes it, where an entry is written, and the path above it', () => {
    for (const [when, at] of [['noon on 5 January', new Date(2026, 0, 5, 12).getTime()], ['1 am on 31 December', new Date(2026, 11, 31, 1).getTime()]] as const) {
      assert.strictEqual(shared().formatTaskDate(at), drawnByTemplate(`task date ${when}`));
    }
    for (const name of ['2026-09-22.md', 'Notes.MD', 'plain']) {
      assert.strictEqual(shared().formatSourceLocation(name, 7), drawnByTemplate(`source location ${name}`));
    }
    const paths: Array<[string[] | undefined, string, string]> = [
      [['Atlas', 'Actions', 'Encrypt the disk'], 'atlas.md', 'Encrypt the disk'],
      [['2026-08-02 #daily', 'Plans'], '2026-08-02.md', ''],
      [['Only'], 'only.md', ''],
      [undefined, 'x.md', ''],
      [['  ', 'Step'], 'x.md', 'step'],
    ];
    for (const [path, file, own] of paths) {
      // The page's arrays are its own window's, so they are compared as JSON.
      assert.strictEqual(JSON.stringify(shared().trimHeadingPath(path, file, own)), drawnByTemplate(`heading path ${JSON.stringify([path ?? null, file, own])}`));
    }
    assertSame('parked label', drawnNow(element('ParkedLabel', {})), 'the parked label');
  });

  test('a task is named by its title, spaces folded, from inside its row', () => {
    const item = listed('Read **the  brief**\nnow');
    const now = drawnNow(element('TaskListRow', { item }));
    core.document.body.appendChild(now);
    try {
      assert.strictEqual(shared().taskTitleOf(now.querySelector('input')), drawnByTemplate('task title of a row'));
      assert.strictEqual(shared().taskTitleOf(core.document.body), 'the task');
    } finally {
      now.remove();
    }
  });
});
