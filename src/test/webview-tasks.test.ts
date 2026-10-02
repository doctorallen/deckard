import * as assert from 'assert';

import { tokenizeInline } from '../domain/markdown/inline';
import type { Task } from '../domain/model/tasks';
import type { DashboardTask } from '../ui/protocol/shared';
import { getComponentScript } from '../ui/webview/components';
import { renderMarkdownInline } from '../ui/webview/rendering';
import { normalizeBody } from '../../test/harness/domSnapshot';
import { bundleShared } from './sharedBundle';
import { openWebviewPage, WebviewPage } from './webviewPage';

/**
 * The shared task parts (src/webview/shared: taskRow, taskTitle, tagButton)
 * against the template script they replace: each drawn both ways must be
 * the same DOM, as test:dom normalizes it, so the Task Board, a search's
 * tasks, Home, and the calendar's day can draw them and change nothing.
 */

/** The template script's helpers these replace, by name. */
const LEGACY_NAMES = [
  'renderTaskListRow', 'renderPriorityBadge', 'renderTagButton', 'renderTaskTitle', 'renderInlineTitle',
  'formatTaskDate', 'trimHeadingPath', 'formatSourceLocation', 'renderParkedLabel', 'taskTitleOf',
];

/** A page running the template script, with its helpers on `window.legacy`. */
function legacyPage(): WebviewPage {
  const script = `(function () {\n  const vscode = acquireVsCodeApi();\n${getComponentScript('replicant')}\n  window.legacy = { ${LEGACY_NAMES.join(', ')} };\n}());`;
  return openWebviewPage(`<!DOCTYPE html><html><head></head><body><main id="app"></main><div id="live-status"></div><script>${script}</script></body></html>`);
}

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

/** A task as a list draws it, its title rendered both ways. */
function listed(title: string, extra: Partial<Task> = {}, item: Partial<DashboardTask> = {}): DashboardTask {
  return {
    task: task(title, extra),
    renderedTitle: renderMarkdownInline(title),
    titleTokens: JSON.parse(JSON.stringify(tokenizeInline(title))),
    titleTags: [],
    fileName: 'atlas.md',
    ...item,
  };
}

const ATLAS = { key: '#project/atlas', label: '#project/atlas' };
const PHONE = { key: '#context/phone', label: '#context/phone' };

suite('The shared task parts draw what the template script drew', () => {
  let legacy: WebviewPage;
  let core: WebviewPage;
  suiteSetup(() => {
    legacy = legacyPage();
    core = corePage();
  });
  suiteTeardown(() => {
    legacy.dispose();
    core.dispose();
  });

  const old = (): Helpers => (legacy.window as unknown as { legacy: Helpers }).legacy;
  const shared = (): Helpers => (core.window as unknown as { shared: Helpers }).shared;
  const element = (name: string, props: object): unknown => shared().h(shared()[name], props);

  const drawnBefore = (html: unknown): Element => {
    const container = legacy.document.createElement('div');
    container.innerHTML = String(html);
    return container;
  };
  const drawnNow = (vnode: unknown): Element => {
    const container = core.document.createElement('div');
    shared().render(vnode, container);
    return container;
  };
  const assertSame = (before: Element, now: Element, what: string): void => {
    assert.strictEqual(normalizeBody(now), normalizeBody(before), what);
  };

  test('a priority badge, for each priority and for none', () => {
    for (const priority of ['highest', 'high', 'medium', 'low', 'lowest', 'HIGH', '', undefined, 'urgent']) {
      assertSame(drawnBefore(old().renderPriorityBadge(priority)), drawnNow(element('PriorityBadge', { priority })), String(priority));
    }
  });

  test('a tag that opens its overview, and a title with its tags as controls', () => {
    for (const className of ['inline-tag', undefined]) {
      assertSame(drawnBefore(old().renderTagButton(ATLAS, className)), drawnNow(element('TagButton', { tag: ATLAS, className })), String(className));
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
          drawnBefore(old().renderInlineTitle(title, tags, appendMissing)),
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
          drawnBefore(old().renderTaskTitle(renderMarkdownInline(title), tags)),
          drawnNow(element('TaskTitle', { tokens, tags })),
          `${title} with ${tags.length} tags`,
        );
      }
    }
  });

  test('a task row, with each fact it can carry', () => {
    const dated = Date.UTC(2026, 8, 22, 12);
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
    const options: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ['inline', { titleDisplay: 'inline' }, { titleDisplay: 'inline' }],
      ['separate', { titleDisplay: 'separate' }, { titleDisplay: 'separate' }],
      ['draggable, with a menu', { draggable: true, trailing: '<button class="row-menu">⋯</button>' }, { draggable: true, trailing: shared().h('button', { class: 'row-menu' }, '⋯') }],
      ['a mark in place of the checkbox', { leading: '<span class="repeat-mark" aria-hidden="true">↻</span>' }, { leading: shared().h('span', { class: 'repeat-mark', 'aria-hidden': 'true' }, '↻') }],
    ];
    for (const [what, item] of items) {
      for (const [how, before, now] of options) {
        assertSame(
          drawnBefore(old().renderTaskListRow(item, before)),
          drawnNow(element('TaskListRow', { item, ...now })),
          `${what}, ${how}`,
        );
      }
    }
  });

  test('a date as the note writes it, where an entry is written, and the path above it', () => {
    for (const at of [Date.UTC(2026, 0, 5, 12), Date.UTC(2026, 11, 31, 1)]) {
      assert.strictEqual(shared().formatTaskDate(at), old().formatTaskDate(at));
    }
    for (const name of ['2026-09-22.md', 'Notes.MD', 'plain']) {
      assert.strictEqual(shared().formatSourceLocation(name, 7), old().formatSourceLocation(name, 7));
    }
    const paths: Array<[string[] | undefined, string, string]> = [
      [['Atlas', 'Actions', 'Encrypt the disk'], 'atlas.md', 'Encrypt the disk'],
      [['2026-08-02 #daily', 'Plans'], '2026-08-02.md', ''],
      [['Only'], 'only.md', ''],
      [undefined, 'x.md', ''],
      [['  ', 'Step'], 'x.md', 'step'],
    ];
    for (const [path, file, own] of paths) {
      // Each page's arrays are its own window's, so they are compared as JSON.
      assert.strictEqual(JSON.stringify(shared().trimHeadingPath(path, file, own)), JSON.stringify(old().trimHeadingPath(path, file, own)));
    }
    assertSame(drawnBefore(old().renderParkedLabel()), drawnNow(element('ParkedLabel', {})), 'the parked label');
  });

  test('a task is named by its title, spaces folded, from inside its row', () => {
    const item = listed('Read **the  brief**\nnow');
    const before = drawnBefore(old().renderTaskListRow(item, {}));
    const now = drawnNow(element('TaskListRow', { item }));
    legacy.document.body.appendChild(before);
    core.document.body.appendChild(now);
    try {
      assert.strictEqual(shared().taskTitleOf(now.querySelector('input')), old().taskTitleOf(before.querySelector('input')));
      assert.strictEqual(shared().taskTitleOf(core.document.body), 'the task');
    } finally {
      before.remove();
      now.remove();
    }
  });
});
