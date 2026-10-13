import * as assert from 'assert';

import { parseMarkdown } from '../domain/markdown/parser';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import type { WorkspaceIndex } from '../domain/model';
import {
  findHubInWords,
  isUnderHub,
  listHubNotes,
  listTagSuggestions,
  placeInHub,
  rewriteHubTag,
  type HubWordsReading,
} from '../ui/state/hubRoute';

/** An index of the notes given, each as its lines. */
function indexOf(notes: Record<string, readonly string[]>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(Object.entries(notes).map(([file, lines]) => [file, parseMarkdown(file, lines.join('\n'))])),
  );
}

const index = indexOf({
  'projects/Atlas.md': ['---', 'describes: project/atlas', '---', '# Atlas', '## Tasks #project/atlas', '- [ ] brief', '### Later', '## Notes'],
  'projects/Borealis.md': ['---', 'describes: project/borealis', '---', '# Borealis', 'Text.', '- [ ] one'],
  'projects/Cobalt.md': ['---', 'describes: project/cobalt', 'tags: [project/cobalt]', '---', '# Cobalt', '## tasks'],
  'areas/Cobalt.md': ['---', 'describes: area/cobalt', '---', '# Cobalt area'],
  'misc.md': ['# Misc', '- [ ] tagged #ember', '## Atlas work #project/atlas', '- [ ] inside'],
});

const reading: HubWordsReading = {
  hubs: listHubNotes(index.files.values()),
  isTagInUse: (key) => index.tags.has(key),
};

/** The hub path a description names, or none. */
function hubOf(description: string): string | undefined {
  return findHubInWords(description, reading)?.hub.filePath;
}

suite('Hub routes', () => {
  test('a tag a hub describes names its hub, the first such tag in the words', () => {
    assert.strictEqual(hubOf('Call Ren #project/atlas friday'), 'projects/Atlas.md');
    assert.strictEqual(hubOf('Call #project/borealis about #project/atlas'), 'projects/Borealis.md');
    assert.strictEqual(hubOf('Call Ren friday'), undefined);
    assert.strictEqual(hubOf('Call #ember'), undefined, 'a tag no hub describes');
  });

  test('a short tag names the one hub whose tag ends with it, unless it is in use or two hubs share it', () => {
    const route = findHubInWords('Call Ren #atlas', reading);
    assert.strictEqual(route?.hub.filePath, 'projects/Atlas.md');
    assert.strictEqual(route?.written, '#atlas');
    assert.strictEqual(hubOf('Call #cobalt'), undefined, 'project/cobalt and area/cobalt');
    assert.strictEqual(hubOf('Call #ember'), undefined);
  });

  test('a task goes under the hub’s Tasks heading, and keeps the tag only where it is not carried', () => {
    const atlas = placeInHub(index, reading.hubs.get('#project/atlas')!);
    assert.strictEqual(atlas.section?.heading, 'Tasks #project/atlas');
    assert.strictEqual(atlas.keepsTag, false);
    const borealis = placeInHub(index, reading.hubs.get('#project/borealis')!);
    assert.strictEqual(borealis.section, undefined, 'no Tasks heading: after the last list item');
    assert.strictEqual(borealis.keepsTag, false, 'describes: is a front-matter tag of the hub');
    const cobalt = placeInHub(index, reading.hubs.get('#project/cobalt')!);
    assert.strictEqual(cobalt.section?.heading, 'tasks', 'any case');
    assert.strictEqual(cobalt.keepsTag, false, 'the front matter carries it');
    const elsewhere = indexOf({ 'Dune.md': ['---', 'describes: project/dune', '---', '# Dune', '## Tasks'] });
    const dune = listHubNotes(elsewhere.files.values()).get('#project/dune')!;
    assert.strictEqual(placeInHub(elsewhere, { ...dune, filePath: 'gone.md' }).keepsTag, true, 'a hub no longer indexed');
  });

  test('a task written in the hub or under its tag is there already', () => {
    const hub = reading.hubs.get('#project/atlas')!;
    assert.strictEqual(isUnderHub(index.files.get('projects/Atlas.md'), 1, hub), true);
    assert.strictEqual(isUnderHub(index.files.get('misc.md'), 4, hub), true, 'under ## Atlas work #project/atlas');
    assert.strictEqual(isUnderHub(index.files.get('misc.md'), 2, hub), false);
    assert.strictEqual(isUnderHub(undefined, 1, hub), false);
  });

  test('the line leaves the tag off, or writes a short one in full', () => {
    const route = findHubInWords('Call Ren #atlas p2', reading)!;
    assert.strictEqual(rewriteHubTag('Call Ren #atlas p2', route, false), 'Call Ren p2');
    assert.strictEqual(rewriteHubTag('Call Ren #atlas p2', route, true), 'Call Ren #project/atlas p2');
    assert.strictEqual(rewriteHubTag('#atlas Call Ren', route, false), 'Call Ren');
    const full = findHubInWords('Call #project/atlas', reading)!;
    assert.strictEqual(rewriteHubTag('Call #project/atlas', full, true), 'Call #project/atlas');
    assert.strictEqual(rewriteHubTag('Call #project/atlas', full, false), 'Call');
  });

  test('Add a tag lists the tags with a hub first, saying so, then the most used', () => {
    const offered = listTagSuggestions(index, 3);
    assert.deepStrictEqual(offered.slice(0, 2).map((tag) => tag.description.startsWith('Hub: ')), [true, true]);
    assert.ok(offered.some((tag) => tag.description === 'Hub: Atlas.md · 3 entries'), JSON.stringify(offered));
    assert.strictEqual(offered.length, 3);
  });
});
