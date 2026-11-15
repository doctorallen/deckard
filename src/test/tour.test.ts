import * as assert from 'assert';

import * as fs from 'fs';
import * as path from 'path';

import { guideSlug } from '../ui/webview/guide';
import {
  hasLineWithAll,
  lineChanged,
  readTourProgress,
  TOUR_CHAPTERS,
  TOUR_SCENES,
  tourSceneFor,
} from '../ui/state/tour';
import { TASK_BOARD_HELP } from '../ui/state/pageHelp';

const root = path.resolve(__dirname, '..', '..');
const sample = path.join(root, 'resources', 'sample-work');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  contributes: { commands: Array<{ command: string }>; views: Record<string, Array<{ id: string }>> };
};

/** A sample file as shipped: `{today}` is day-0.md, before its dates are filled in. */
function sampleText(file: string): string {
  return fs.readFileSync(path.join(sample, file === '{today}' ? 'day-0.md' : file), 'utf8');
}

/** Every text of the sample, to find what a page scene rings. */
function allSampleText(): string {
  const texts: string[] = [];
  const walk = (folder: string): void => {
    fs.readdirSync(folder, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        texts.push(fs.readFileSync(full, 'utf8'));
      }
    });
  };
  walk(sample);
  return texts.join('\n');
}

/** A guide page's headings' anchors. */
function anchorsOf(page: string): Set<string> {
  const text = fs.readFileSync(path.join(root, 'docs', 'guide', `${page}.md`), 'utf8');
  return new Set(text.split('\n').filter((line) => /^#{1,6} /.test(line)).map((line) => guideSlug(line.replace(/^#+/, ''))));
}

suite('The Tour', () => {
  const commands = new Set(manifest.contributes.commands.map((command) => command.command));
  const viewFocus = new Set(Object.values(manifest.contributes.views).flat().map((view) => `${view.id}.focus`));
  const everything = allSampleText().toLowerCase();

  test('its scenes come in its chapters’ order, each with an id of its own, and the optional ones last', () => {
    assert.strictEqual(TOUR_SCENES.length, 15);
    const chapters = TOUR_SCENES.map((scene) => TOUR_CHAPTERS.indexOf(scene.chapter));
    assert.deepStrictEqual(chapters, [...chapters].sort((a, b) => a - b));
    assert.strictEqual(new Set(TOUR_SCENES.map((scene) => scene.id)).size, TOUR_SCENES.length);
    assert.deepStrictEqual(TOUR_SCENES.filter((scene) => scene.optional).map((scene) => scene.id), ['rollover', 'review']);
  });

  test('every command a scene runs is Deckard’s or a view’s focus, and every guide section it names is there', () => {
    for (const scene of TOUR_SCENES) {
      const run = [
        ...scene.open.flatMap((part) => (part.kind === 'command' ? [part.command] : [])),
        ...(scene.do?.kind === 'command' ? [scene.do.command] : []),
      ];
      run.forEach((command) => assert.ok(commands.has(command) || viewFocus.has(command), `${scene.id}: ${command}`));
      const [page, anchor] = scene.guide.split('#');
      assert.ok(anchorsOf(page).has(anchor), `${scene.id}: ${scene.guide}`);
    }
  });

  test('every note and line a scene opens or rings is in the sample, and no step is done before the reader does it', () => {
    for (const scene of TOUR_SCENES) {
      for (const part of scene.open) {
        if (part.kind === 'note') {
          const text = sampleText(part.file).toLowerCase();
          assert.ok(!part.at || text.includes(part.at.toLowerCase()), `${scene.id}: ${part.file} holds ${part.at}`);
        }
      }
      if (scene.ring?.kind === 'page' && scene.ring.text) {
        // Words the page writes itself, not the sample.
        const pageWords = ['overdue', 'No hub note'];
        assert.ok(everything.includes(scene.ring.text.toLowerCase()) || pageWords.includes(scene.ring.text), `${scene.id}: the sample has ${scene.ring.text}`);
      }
      if (scene.done.kind === 'line') {
        assert.ok(!hasLineWithAll(sampleText(scene.done.file), scene.done.all), `${scene.id}: not done already`);
      }
      if (scene.done.kind === 'changed') {
        assert.ok(sampleText(scene.done.file).includes(scene.done.text), `${scene.id}: ${scene.done.file} holds ${scene.done.text}`);
      }
    }
    assert.match(sampleText('{today}'), /@juno-achterberg says the coolant pump rebuild is done by Tuesday\./);
    assert.match(sampleText('contracts/Medical supply run.md'), /^state: bidding$/m);
  });

  test('a step is seen done from the line it changes', () => {
    assert.ok(hasLineWithAll('  - [w] Coolant pump rebuild is done 📅 2026-11-17 👤 @juno-achterberg', ['[w]', 'coolant pump rebuild', '@juno-achterberg']));
    assert.ok(!hasLineWithAll('- [w] Coolant pump\n rebuild @juno-achterberg', ['[w]', 'coolant pump rebuild']), 'on one line');
    const before = '- [ ] Recalibrate the survey array 📅 2026-11-19';
    assert.ok(lineChanged(before, '- [/] Recalibrate the survey array 📅 2026-11-19', 'Recalibrate the survey array'));
    assert.ok(!lineChanged(before, before, 'Recalibrate the survey array'));
    assert.ok(!lineChanged(undefined, before, 'Recalibrate'), 'nothing to compare with');
  });

  test('where the Tour was is read back safely', () => {
    assert.deepStrictEqual(readTourProgress({ scene: 6, done: ['board', 'nonsense', 3] }), { scene: 6, done: ['board'] });
    assert.deepStrictEqual(readTourProgress({ scene: 99 }), { scene: 0, done: [] });
    assert.deepStrictEqual(readTourProgress('junk'), { scene: 0, done: [] });
  });

  test('This page marks the board’s entry the Tour shows', () => {
    const board = TOUR_SCENES.findIndex((scene) => scene.id === 'board') + 1;
    assert.strictEqual(tourSceneFor('move'), board);
    TOUR_SCENES.filter((scene) => scene.helpEntry).forEach((scene) => {
      assert.ok(TASK_BOARD_HELP.entries.some((entry) => entry.id === scene.helpEntry), scene.id);
    });
  });
});
