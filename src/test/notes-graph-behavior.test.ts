import * as assert from 'assert';

import { getNotesGraphHtml } from '../ui/webview/notesGraphHtml';
import { openWebviewPage, WebviewPage } from './webviewPage';

/**
 * The Notes Graph's controls, driven as VS Code drives them.
 *
 * The graph draws into a canvas, which jsdom has no context for, so what it
 * paints cannot be asserted here. Its controls and the settings they carry
 * can be, and the clustering itself is still held to its source text in
 * `messages-rendering.test.ts` — see the note there.
 */
suite('Notes Graph behavior', () => {
  let page: WebviewPage | undefined;

  teardown(() => {
    page?.dispose();
    page = undefined;
  });

  const open = (): WebviewPage => {
    page = openWebviewPage(
      getNotesGraphHtml({ cspSource: 'vscode-webview://deckard' }),
    );
    return page;
  };

  test('offers every filter and force the graph is tuned by', () => {
    const page = open();

    const control = (id: string) => page.find(`#${id}`);
    ['show-notes', 'show-tasks', 'show-tags', 'show-orphans'].forEach((id) => {
      assert.strictEqual(
        (control(id) as HTMLInputElement).type,
        'checkbox',
        `${id} is a switch`,
      );
    });
    [
      'link-density',
      'tag-specificity',
      'bridge-strength',
      'cluster-cohesion',
      'community-spacing',
      'node-size',
      'link-thickness',
      'label-threshold',
      'center-strength',
      'repel-strength',
      'link-strength',
      'link-distance',
    ].forEach((id) => {
      assert.strictEqual(
        (control(id) as HTMLInputElement).type,
        'range',
        `${id} is a slider`,
      );
    });

    // Notes and tasks are drawn to begin with. Tag nodes are not: they
    // would crowd the graph, and they guide the clustering either way.
    assert.strictEqual((control('show-notes') as HTMLInputElement).checked, true);
    assert.strictEqual((control('show-tasks') as HTMLInputElement).checked, true);
    assert.strictEqual((control('show-tags') as HTMLInputElement).checked, false);
  });

  test('says what each control does', () => {
    const page = open();

    const title = (id: string) => String(page.find(`#${id}`).getAttribute('data-tip'));
    assert.match(title('search'), /Filter note, task, and tag titles/);
    assert.match(title('show-tags'), /hidden tags still guide clustering/);
    assert.match(title('link-density'), /strongest links are drawn/);
    assert.match(title('tag-specificity'), /tag on a few notes/);
    assert.match(title('cluster-cohesion'), /toward their detected community/);
    assert.match(title('community-spacing'), /distance between detected communities/);
    assert.match(title('link-distance'), /length of visible links/);
    assert.match(title('reset-graph-settings'), /Restore all graph controls/);
  });

  test('says the link sliders in words, with the rarer ones folded under Advanced', () => {
    const page = open();

    ['link-density', 'tag-specificity', 'bridge-strength'].forEach((id) => {
      assert.strictEqual(page.document.getElementById(`${id}-out`), null, `${id} shows no number`);
      assert.ok(page.find(`#${id}`).getAttribute('aria-valuetext'), `${id} is said in a word`);
    });
    const density = page.find('#link-density') as HTMLInputElement;
    const before = density.getAttribute('aria-valuetext');
    density.value = density.max;
    density.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    assert.strictEqual(density.getAttribute('aria-valuetext'), 'most');
    assert.notStrictEqual(before, 'most');

    const advanced = page.document.querySelector('details.advanced') as HTMLDetailsElement;
    assert.strictEqual(advanced.querySelector('summary')?.textContent, 'Advanced');
    assert.strictEqual(advanced.open, false, 'closed to begin with');
    ['tag-specificity', 'bridge-strength', 'show-all-links'].forEach((id) => {
      assert.ok(advanced.querySelector(`#${id}`), `${id} is under Advanced`);
    });
    assert.strictEqual(advanced.querySelector('#link-density'), null);
  });

  test('tells the host which kinds of node it shows, at load and on each toggle', () => {
    const page = open();
    const filters = () => page.posted.filter((message) => message.type === 'setGraphFilter');
    assert.deepStrictEqual(filters(), [
      { type: 'setGraphFilter', showNotes: true, showTasks: true },
    ]);

    const tasks = page.find('#show-tasks') as HTMLInputElement;
    tasks.checked = false;
    tasks.dispatchEvent(new page.window.Event('change', { bubbles: true }));
    assert.deepStrictEqual(filters().at(-1), { type: 'setGraphFilter', showNotes: true, showTasks: false });

    page.click('#reset-graph-settings');
    assert.deepStrictEqual(filters().at(-1), { type: 'setGraphFilter', showNotes: true, showTasks: true }, 'a reset shows tasks again');
  });

  test('draws a graph sent without edge ids or hidden kinds, and still counts the whole of it', () => {
    const page = open();
    const node = (id: string, kind: string) => ({ id, kind, title: id, tagKeys: [], degree: 1 });
    page.send({
      updatedAt: 1,
      nodes: [node('section:a', 'note'), node('section:b', 'note'), node('tag:#x', 'tag')],
      edges: [
        { source: 'section:a', target: 'section:b', weight: 2, types: ['wiki-link'] },
        { source: 'section:a', target: 'tag:#x', weight: 1, types: ['tag-membership'] },
      ],
      tags: [['#x', '#x', 1]],
      totalNoteCount: 2,
      totalTaskCount: 3,
      hiddenNodeCount: 3,
      edgeCount: 7,
    });
    assert.match(page.text('#status-counts') ?? '', /\/ 7 indexed/, 'the indexed count is the whole graph');
    assert.notStrictEqual((page.find('#empty-state') as HTMLElement).style.display, 'grid');

    page.send({
      updatedAt: 2,
      nodes: [],
      edges: [],
      tags: [],
      totalNoteCount: 0,
      totalTaskCount: 3,
      hiddenNodeCount: 3,
      edgeCount: 0,
    });
    assert.notStrictEqual(
      (page.find('#empty-state') as HTMLElement).style.display,
      'grid',
      'hiding every task is not an empty workspace',
    );
  });

  test('offers the zoom and framing controls', () => {
    const page = open();

    assert.ok(page.document.querySelector('.graph-zoom-controls'));
    ['zoom-in', 'zoom-out', 'zoom-fit'].forEach((id) => {
      assert.strictEqual(page.find(`#${id}`).tagName, 'BUTTON');
    });
  });

  test('puts a moved slider back where it started', () => {
    const page = open();

    const density = page.find('#link-density') as HTMLInputElement;
    const started = density.value;
    density.value = String(Number(started) === 1 ? 2 : 1);
    density.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    assert.notStrictEqual(density.value, started);

    page.click('#reset-graph-settings');

    assert.strictEqual(density.value, started, 'Reset restores the control');
  });

  test('a reset can be undone for a few seconds, until another control moves', () => {
    const page = open();

    const density = page.find('#link-density') as HTMLInputElement;
    const started = density.value;
    const moved = String(Number(started) === 1 ? 2 : 1);
    density.value = moved;
    density.dispatchEvent(new page.window.Event('input', { bubbles: true }));

    page.click('#reset-graph-settings');
    assert.strictEqual(density.value, started);
    const undo = page.find('[data-action="undo-graph-reset"]');
    assert.strictEqual(undo.textContent, 'Undo');
    assert.strictEqual(page.document.activeElement, undo, 'the focus is on Undo');

    page.click('[data-action="undo-graph-reset"]');
    assert.strictEqual(density.value, moved, 'Undo puts the slider back');
    assert.strictEqual(
      (page.savedState() as { linkDensity: number }).linkDensity,
      Number(moved),
      'and keeps it',
    );
    assert.strictEqual(page.text('#graph-reset-undo'), 'Graph settings restored.');

    page.click('#reset-graph-settings');
    density.value = moved;
    density.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    assert.strictEqual(
      page.document.querySelector('[data-action="undo-graph-reset"]'),
      null,
      'a later change takes the offer away',
    );
  });
});
