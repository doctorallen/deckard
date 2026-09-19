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

    const title = (id: string) => String(page.find(`#${id}`).getAttribute('title'));
    assert.match(title('search'), /Filter note, task, and tag titles/);
    assert.match(title('show-tags'), /hidden tags still guide clustering/);
    assert.match(title('link-density'), /strongest links remain/);
    assert.match(title('tag-specificity'), /rare and common tag populations/);
    assert.match(title('cluster-cohesion'), /toward their detected community/);
    assert.match(title('community-spacing'), /distance between detected communities/);
    assert.match(title('link-distance'), /length of visible links/);
    assert.match(title('reset-graph-settings'), /Restore all graph controls/);
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
});
