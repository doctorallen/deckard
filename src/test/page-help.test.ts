import * as assert from 'assert';

import * as fs from 'fs';
import * as path from 'path';

import { guideSlug, isGuidePage } from '../ui/webview/guide';
import { entryForPick, PAGE_HELP_MAPS, ringOf, splitGuideRef, TASK_BOARD_HELP } from '../ui/state/pageHelp';
import { describeSetting, listSettingSchemas, readSettingWrite } from '../ui/webview/pages/help/helpSettings';

const root = path.resolve(__dirname, '..', '..');
const guide = (page: string): string => fs.readFileSync(path.join(root, 'docs', 'guide', `${page}.md`), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { contributes: { configuration: unknown } };

/** A guide page's sections by anchor, each its Markdown up to the next heading as high. */
function sectionsOf(page: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = guide(page).split('\n');
  lines.forEach((line, at) => {
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    if (!heading) {
      return;
    }
    const level = heading[1].length;
    const end = lines.findIndex((next, after) => after > at && /^(#{1,6}) /.test(next) && (/^#+/.exec(next)?.[0].length ?? 7) <= level);
    sections.set(guideSlug(heading[2]), lines.slice(at + 1, end < 0 ? undefined : end).join('\n'));
  });
  return sections;
}

/** Every page source file's text, to find the data-help-ids the pages draw. */
function pageSources(): string {
  const files: string[] = [];
  const walk = (folder: string): void => {
    fs.readdirSync(folder, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        files.push(fs.readFileSync(full, 'utf8'));
      }
    });
  };
  walk(path.join(root, 'src', 'webview'));
  return files.join('\n');
}

suite('Page maps', () => {
  const sources = pageSources();

  test('every entry points at a guide section that names it, and the page draws what it rings', () => {
    for (const map of PAGE_HELP_MAPS) {
      assert.ok(isGuidePage(map.guidePage), map.guidePage);
      for (const entry of map.entries) {
        const { page, anchor } = splitGuideRef(entry.guide);
        assert.ok(isGuidePage(page) && anchor, entry.guide);
        assert.ok(sectionsOf(page).has(anchor ?? ''), `${map.title}: ${entry.id} points at ${entry.guide}, which the guide has`);
        if (entry.onThisPage) {
          const where = splitGuideRef(entry.onThisPage.guide);
          const section = sectionsOf(where.page).get(where.anchor ?? '') ?? '';
          assert.ok(section.toLowerCase().includes(entry.onThisPage.mentions.toLowerCase()), `${entry.onThisPage.guide} names ${entry.onThisPage.mentions}`);
        }
        for (const id of [ringOf(entry), ...(entry.picks ?? [])]) {
          assert.match(sources, new RegExp(`data-help-id(="|': '|=\\{[^}]*')${id}['"]`), `the page draws data-help-id ${id}`);
        }
      }
    }
  });

  test('every setting a map lists is contributed, and This page can show it', () => {
    const schemas = listSettingSchemas(manifest.contributes);
    for (const map of PAGE_HELP_MAPS) {
      for (const key of [...map.settings, ...map.entries.flatMap((entry) => entry.settings ?? [])]) {
        assert.ok(schemas.has(`deckard.${key}`), `deckard.${key} is a setting`);
      }
    }
  });

  test('a pick on the page selects the entry it stands for', () => {
    assert.strictEqual(entryForPick(TASK_BOARD_HELP, 'column-add')?.id, 'add');
    assert.strictEqual(entryForPick(TASK_BOARD_HELP, 'lanes')?.id, 'lanes');
    assert.strictEqual(entryForPick(TASK_BOARD_HELP, 'card-menu')?.id, 'card-menu', 'the control, not the feature that rings it');
    assert.strictEqual(entryForPick(TASK_BOARD_HELP, 'limits')?.id, 'limits');
    assert.strictEqual(entryForPick(TASK_BOARD_HELP, 'nothing'), undefined);
  });

  test('settings are drawn from their schemas, and a write is checked against them', () => {
    const schemas = listSettingSchemas(manifest.contributes);
    const view = (key: string, inspected: Parameters<typeof describeSetting>[2]) => describeSetting(key, schemas.get(`deckard.${key}`) ?? {}, inspected);
    const zen = view('display.zen', { defaultValue: false, globalValue: true });
    assert.deepStrictEqual([zen.kind, zen.value, zen.source, zen.label], ['boolean', true, 'User', 'Display: Zen']);
    const theme = view('theme', { defaultValue: 'mimic', workspaceValue: 'cooper' });
    assert.deepStrictEqual([theme.kind, theme.value, theme.source], ['enum', 'cooper', 'Workspace']);
    assert.ok(theme.options?.some((option) => option.value === 'razorback'));
    const details = view('display.cardDetails', { defaultValue: { fileAndLine: true, created: false, updated: false } });
    assert.strictEqual(details.kind, 'flags');
    assert.deepStrictEqual(readSettingWrite(details, schemas.get('deckard.display.cardDetails') ?? {}, { name: 'created', on: true }), {
      value: { fileAndLine: true, created: true, updated: false },
    });
    const limits = view('board.limits', { defaultValue: {}, globalValue: { 'in-progress': 3 } });
    assert.deepStrictEqual([limits.kind, limits.summary], ['other', 'in-progress: 3']);
    assert.strictEqual(readSettingWrite(limits, {}, { 'in-progress': 9 }), undefined, 'not edited in place');
    const days = view('tasks.needsNewDateAfterDays', { defaultValue: 30 });
    assert.deepStrictEqual(readSettingWrite(days, schemas.get('deckard.tasks.needsNewDateAfterDays') ?? {}, '14'), { value: 14 });
    assert.strictEqual(readSettingWrite(theme, {}, 'no-such-theme'), undefined);
  });
});
