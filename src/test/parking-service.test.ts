import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import type { ParkedRules } from '../domain/index/parked';
import { parseMarkdown } from '../domain/markdown/parser';
import type { WorkspaceIndex } from '../domain/model';
import type { ResourceUri, WorkspaceFolder } from '../ports/uri';
import {
  ParkingEdit,
  ParkingService,
  ParkingWriteLabel,
  ParkingWriteOutcome,
  SettingPlace,
} from '../services/parkingService';
import { FakeSettings, fileUri } from './fakeWorkspace';

// ParkingService decides what Park and Unpark may do to notes, folders, and
// tags; these run it over an index built from plain text, settings held in
// memory, and a write that records what it was asked to change.

const ROOT: WorkspaceFolder = { uri: fileUri('/ws'), name: 'ws', index: 0 };

/** A note's URI by its index path. */
const noteUri = (filePath: string): ResourceUri => fileUri(`/ws/${filePath}`);

/** An index of the notes, by path, as the scanner would build it. */
function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(Object.entries(notes).map(([filePath, content]) => [filePath, parseMarkdown(filePath, content)])),
  );
}

/** Parked rules for these tags and folders, as the scanner reads the settings. */
function rulesOf(tags: string[], folders: string[] = []): ParkedRules {
  return {
    tags,
    hasFolders: folders.length > 0,
    isParkedPath: (filePath) => folders.some((folder) => filePath === folder || filePath.startsWith(`${folder}/`)),
  };
}

/** One write of the notes: what each note read as, what replaced it, and how it was labeled. */
class FakeEdit implements ParkingEdit<ResourceUri, string> {
  public readonly replaced = new Map<string, string>();
  public label: ParkingWriteLabel | undefined;

  public constructor(
    private readonly texts: Map<string, string>,
    private readonly applied: boolean,
  ) {}

  public read(uri: ResourceUri): Promise<string> {
    return Promise.resolve(this.texts.get(uri.path) ?? '');
  }

  public replace(uri: ResourceUri, content: string): void {
    this.replaced.set(uri.path, content);
  }

  public write(label: ParkingWriteLabel): Promise<ParkingWriteOutcome<string>> {
    this.label = label;
    return Promise.resolve(this.applied ? { applied: true, handle: 'handle' } : { applied: false });
  }
}

/** Each place a setting was written, with every value written there. */
interface PlaceRecord {
  key: string;
  scope: ResourceUri | undefined;
  unset: 'default' | 'global' | undefined;
  writes: unknown[];
}

/** A service over fakes, and what each fake saw. */
function parkingWith(options: {
  notes?: Record<string, string>;
  rules?: ParkedRules;
  /** Each setting's value at the place it is written, by key. */
  places?: Record<string, unknown>;
  /** The effective settings, by full name. */
  settings?: Record<string, unknown>;
  writesLand?: boolean;
  settingsSave?: boolean;
} = {}) {
  const texts = new Map(Object.entries(options.notes ?? {}).map(([filePath, text]) => [`/ws/${filePath}`, text]));
  const edits: FakeEdit[] = [];
  const places: PlaceRecord[] = [];
  let rules = options.rules ?? rulesOf(['#parked']);
  const service = new ParkingService<ResourceUri, string>({
    index: {
      getFilePath: (uri) => uri.path.replace(/^\/ws\//, ''),
      isNotesFile: (uri) => uri.path.endsWith('.md'),
      getParkedRules: () => rules,
    },
    workspace: {
      workspaceFolders: [ROOT],
      getWorkspaceFolder: (uri) => (uri.path.startsWith('/ws/') || uri.path === '/ws' ? ROOT : undefined),
    },
    configuration: new FakeSettings(options.settings ?? {}),
    settings: {
      place: (key, scope, unset): SettingPlace => {
        const record: PlaceRecord = { key, scope, unset, writes: [] };
        places.push(record);
        return {
          current: options.places?.[key],
          write: (value) => {
            record.writes.push(value);
            return Promise.resolve(options.settingsSave ?? true);
          },
        };
      },
    },
    edits: () => {
      const edit = new FakeEdit(texts, options.writesLand ?? true);
      edits.push(edit);
      return edit;
    },
  });
  return {
    service,
    edits,
    places,
    texts,
    setRules: (next: ParkedRules) => {
      rules = next;
    },
  };
}

const PARKED = '---\ntags: [parked]\n---\n# Old\n';
const PLAIN = '# Plain\n';
const UNREADABLE = '---\ntags: [a,\n  b]\n---\n# Broken\n';

suite('ParkingService', () => {
  suite('Park Note', () => {
    test('writes the parked tag into each note, as one write', async () => {
      const notes = { 'a.md': PLAIN, 'b.md': '# B\n' };
      const { service, edits } = parkingWith({ notes });
      const result = await service.parkNotes(indexOf(notes), [noteUri('a.md'), noteUri('b.md')]);

      assert.deepStrictEqual(result, { kind: 'parked', filePaths: ['a.md', 'b.md'], handle: 'handle' });
      assert.deepStrictEqual(edits[0].label, { action: 'parking', notes: 2 });
      assert.strictEqual(edits[0].replaced.get('/ws/a.md'), '---\ntags: [parked]\n---\n# Plain\n');
    });

    test('has nothing to write when the setting names no # tag', async () => {
      const { service } = parkingWith({ rules: rulesOf(['@ren']) });
      assert.deepStrictEqual(await service.parkNotes(indexOf({ 'a.md': PLAIN }), [noteUri('a.md')]), {
        kind: 'refused',
        reason: 'no-parked-tag',
      });
    });

    test('refuses one note three different ways', async () => {
      const notes = { 'a.md': PLAIN, 'old/b.md': PLAIN, 'c.md': PARKED };
      const index = indexOf(notes);
      const { service, edits } = parkingWith({ notes, rules: rulesOf(['#parked'], ['old']) });

      const readme = noteUri('readme.txt');
      assert.deepStrictEqual(await service.parkNotes(index, [readme]), {
        kind: 'refused',
        reason: 'not-indexed',
        uri: readme,
      });
      assert.deepStrictEqual(await service.parkNotes(index, [noteUri('old/b.md')]), {
        kind: 'refused',
        reason: 'parked-by-folder',
        filePath: 'old/b.md',
        folder: 'old',
      });
      assert.deepStrictEqual(await service.parkNotes(index, [noteUri('c.md')]), {
        kind: 'refused',
        reason: 'already-parked',
        filePath: 'c.md',
      });
      assert.ok(edits.every((edit) => edit.label === undefined), 'nothing written');
    });

    test('passes over parked notes among several, and says when none was left', async () => {
      const notes = { 'old/b.md': PLAIN, 'c.md': PARKED };
      const { service } = parkingWith({ notes, rules: rulesOf(['#parked'], ['old']) });
      assert.deepStrictEqual(
        await service.parkNotes(indexOf(notes), [noteUri('readme.txt'), noteUri('old/b.md'), noteUri('c.md')]),
        { kind: 'refused', reason: 'all-parked' },
      );
    });

    test('says which front matter it could not read when it parked nothing', async () => {
      const notes = { 'a.md': UNREADABLE };
      const { service } = parkingWith({ notes });
      assert.deepStrictEqual(await service.parkNotes(indexOf(notes), [noteUri('a.md')]), {
        kind: 'unreadable',
        filePath: 'a.md',
        tag: 'parked',
      });
    });

    test('reports a write VS Code did not apply', async () => {
      const notes = { 'a.md': PLAIN };
      const { service } = parkingWith({ notes, writesLand: false });
      assert.deepStrictEqual(await service.parkNotes(indexOf(notes), [noteUri('a.md')]), { kind: 'not-applied' });
    });
  });

  suite('Unpark Note', () => {
    test('takes the parked tag out', async () => {
      const notes = { 'a.md': PARKED };
      const { service, edits } = parkingWith({ notes });
      const result = await service.unparkNotes(indexOf(notes), [noteUri('a.md')]);

      assert.deepStrictEqual(result, { kind: 'unparked', filePaths: ['a.md'], handle: 'handle' });
      assert.deepStrictEqual(edits[0].label, { action: 'unparking', notes: 1 });
      assert.strictEqual(edits[0].replaced.get('/ws/a.md'), '# Old\n');
    });

    test('refuses a note parked by its folder, and one not parked', async () => {
      const notes = { 'old/a.md': PLAIN, 'b.md': PLAIN };
      const index = indexOf(notes);
      const { service } = parkingWith({ notes, rules: rulesOf(['#parked'], ['old']) });
      assert.deepStrictEqual(await service.unparkNotes(index, [noteUri('old/a.md')]), {
        kind: 'refused',
        reason: 'parked-by-folder',
        filePath: 'old/a.md',
        folder: 'old',
      });
      assert.deepStrictEqual(await service.unparkNotes(index, [noteUri('b.md')]), {
        kind: 'refused',
        reason: 'not-parked',
        filePath: 'b.md',
      });
    });

    test('says when the front matter cannot be read as it is now', async () => {
      const { service } = parkingWith({ notes: { 'a.md': UNREADABLE } });
      assert.deepStrictEqual(await service.unparkNotes(indexOf({ 'a.md': PARKED }), [noteUri('a.md')]), {
        kind: 'unreadable',
        filePath: 'a.md',
      });
    });

    test('asks about a tag Park Note did not write, and takes it out only when asked', async () => {
      const archived = '---\ntags: [archive]\n---\n# Old\n';
      const { service, edits, texts } = parkingWith({ notes: { 'a.md': archived }, rules: rulesOf(['#parked', '#archive']) });
      const result = await service.unparkNotes(indexOf({ 'a.md': archived }), [noteUri('a.md')]);

      assert.strictEqual(result.kind, 'parked-by-tag');
      if (result.kind !== 'parked-by-tag') {
        return;
      }
      assert.deepStrictEqual([result.filePath, result.tag, result.label], ['a.md', '#archive', '#archive']);
      assert.strictEqual(edits[0].label, undefined, 'nothing written while the reader is asked');

      // The note is read again as it is once the reader answers.
      texts.set('/ws/a.md', '---\ntags: [archive, x]\n---\n# Old, edited\n');
      assert.deepStrictEqual(await result.removeTag(), { kind: 'unparked', filePaths: ['a.md'], handle: 'handle' });
      assert.strictEqual(edits[0].replaced.get('/ws/a.md'), '---\ntags: [x]\n---\n# Old, edited\n');
    });

    test('passes over notes it would have to ask about among several', async () => {
      const archived = '---\ntags: [archive]\n---\n# Old\n';
      const notes = { 'a.md': archived, 'b.md': PLAIN };
      const { service } = parkingWith({ notes, rules: rulesOf(['#parked', '#archive']) });
      assert.deepStrictEqual(await service.unparkNotes(indexOf(notes), [noteUri('a.md'), noteUri('b.md')]), {
        kind: 'nothing',
      });
    });

    test('reports a write VS Code did not apply', async () => {
      const notes = { 'a.md': PARKED };
      const { service } = parkingWith({ notes, writesLand: false });
      assert.deepStrictEqual(await service.unparkNotes(indexOf(notes), [noteUri('a.md')]), { kind: 'not-applied' });
    });
  });

  suite('Park Folder', () => {
    const notes = { 'drafts/a.md': PLAIN, 'drafts/deep/b.md': PLAIN, 'c.md': PLAIN };

    test('adds the folder to the parked folders, where the setting is written, with its Undo', async () => {
      const { service, places } = parkingWith({ notes, places: { 'parked.folders': { old: true } } });
      const result = await service.parkFolder(indexOf(notes), noteUri('drafts'));

      assert.strictEqual(result.kind, 'parked');
      assert.deepStrictEqual(result.kind === 'parked' && [result.name, result.notes], ['drafts', 2]);
      assert.deepStrictEqual(places[0].writes, [{ old: true, drafts: true }]);
      assert.strictEqual(places[0].scope?.path, '/ws');
      await (result.kind === 'parked' ? result.undo() : undefined);
      assert.deepStrictEqual(places[0].writes[1], { old: true }, 'Undo writes back what was there');
    });

    test('refuses a folder outside the workspace, and the workspace folder itself', async () => {
      const { service } = parkingWith({ notes });
      for (const uri of [fileUri('/elsewhere/drafts'), fileUri('/ws')]) {
        assert.deepStrictEqual(await service.parkFolder(indexOf(notes), uri), {
          kind: 'refused',
          reason: 'outside-workspace',
        });
      }
    });

    test('says a folder is parked already', async () => {
      const { service, places } = parkingWith({ notes, rules: rulesOf(['#parked'], ['drafts']) });
      assert.deepStrictEqual(await service.parkFolder(indexOf(notes), noteUri('drafts')), {
        kind: 'refused',
        reason: 'already-parked',
        name: 'drafts',
      });
      assert.deepStrictEqual(places[0].writes, []);
    });

    test('offers to park an excluded folder instead, taking its key out of the exclude setting', async () => {
      const { service, places } = parkingWith({
        notes,
        settings: { 'deckard.exclude': { drafts: true } },
        places: { exclude: { drafts: true, other: true } },
      });
      const result = await service.parkFolder(indexOf(notes), noteUri('drafts'));

      assert.strictEqual(result.kind, 'excluded');
      assert.ok(result.kind === 'excluded' && result.parkInstead, 'an exact key can be taken out');
      assert.strictEqual(places.length, 0, 'nothing written before the reader answers');
      const parked = await (result.kind === 'excluded' ? result.parkInstead?.() : undefined);
      assert.strictEqual(parked?.kind, 'parked');
      assert.deepStrictEqual(
        places.map((place) => [place.key, place.unset, place.writes]),
        [
          ['exclude', 'global', [{ other: true }]],
          ['parked.folders', undefined, [{ drafts: true }]],
        ],
      );
    });

    test('has nothing to offer for a folder a pattern excludes', async () => {
      const { service } = parkingWith({ notes, settings: { 'deckard.exclude': { 'draft*': true } } });
      assert.deepStrictEqual(await service.parkFolder(indexOf(notes), noteUri('drafts')), {
        kind: 'excluded',
        name: 'drafts',
      });
    });

    test('stops when the setting could not be saved', async () => {
      const { service } = parkingWith({ notes, settingsSave: false });
      assert.deepStrictEqual(await service.parkFolder(indexOf(notes), noteUri('drafts')), { kind: 'not-written' });
    });
  });

  suite('Unpark Folder', () => {
    const notes = { 'drafts/a.md': PLAIN };

    test('takes the key it was written with out of the parked folders', async () => {
      const { service, places } = parkingWith({ notes, places: { 'parked.folders': { 'drafts/': true, old: true } } });
      assert.deepStrictEqual(await service.unparkFolder(indexOf(notes), noteUri('drafts')), {
        kind: 'unparked',
        name: 'drafts',
        notes: 1,
      });
      assert.deepStrictEqual(places[0].writes, [{ old: true }]);
    });

    test('names the pattern that parks a folder with no key of its own', async () => {
      const { service } = parkingWith({ notes, settings: { 'deckard.parked.folders': { 'draft*': true } } });
      assert.deepStrictEqual(await service.unparkFolder(indexOf(notes), noteUri('drafts')), {
        kind: 'parked-by-pattern',
        name: 'drafts',
        pattern: 'draft*',
      });
    });

    test('says a folder is not parked, and refuses one outside the workspace', async () => {
      const { service } = parkingWith({ notes });
      assert.deepStrictEqual(await service.unparkFolder(indexOf(notes), noteUri('drafts')), {
        kind: 'refused',
        reason: 'not-parked',
        name: 'drafts',
      });
      assert.deepStrictEqual(await service.unparkFolder(indexOf(notes), fileUri('/elsewhere')), {
        kind: 'refused',
        reason: 'outside-workspace',
      });
    });

    test('stops when the setting could not be saved', async () => {
      const { service } = parkingWith({ notes, places: { 'parked.folders': { drafts: true } }, settingsSave: false });
      assert.deepStrictEqual(await service.unparkFolder(indexOf(notes), noteUri('drafts')), { kind: 'not-written' });
    });
  });

  suite('Park Tag', () => {
    const notes = { 'a.md': '# A #project/old\n\n- [ ] Task #project/old\n' };

    test('adds the tag to the parked tags, counting what it parks, with its Undo', async () => {
      const { service, places } = parkingWith({ notes, places: { 'parked.tags': ['parked'] } });
      const result = await service.parkTag(indexOf(notes), '#project/old');

      assert.strictEqual(result.kind, 'parked');
      if (result.kind !== 'parked') {
        return;
      }
      assert.deepStrictEqual([result.label, result.notes, result.tasks], ['#project/old', 1, 1]);
      assert.deepStrictEqual(places[0].writes, [['parked', 'project/old']]);
      await result.undo();
      assert.deepStrictEqual(places[0].writes[1], ['parked']);
    });

    test('says a tag is parked already, or through its parent', async () => {
      const { service, setRules } = parkingWith({ notes, rules: rulesOf(['#project/old']) });
      assert.deepStrictEqual(await service.parkTag(indexOf(notes), '#project/old'), {
        kind: 'refused',
        reason: 'already-parked',
        label: '#project/old',
      });
      setRules(rulesOf(['#project']));
      assert.deepStrictEqual(await service.parkTag(indexOf(notes), 'project/old'), {
        kind: 'parked-through',
        label: '#project/old',
        parent: '#project',
      });
    });

    test('refuses what is not a tag, and stops when the setting could not be saved', async () => {
      const { service } = parkingWith({ notes, settingsSave: false });
      assert.deepStrictEqual(await service.parkTag(indexOf(notes), '#'), { kind: 'refused', reason: 'not-a-tag' });
      assert.deepStrictEqual(await service.parkTag(indexOf(notes), '#new'), { kind: 'not-written' });
    });
  });

  suite('Unpark Tag', () => {
    const notes = { 'a.md': '# A #project/old\n' };
    const index = indexOf(notes);

    test('takes the tag out of the parked tags, however it was written there', async () => {
      const { service, places } = parkingWith({ notes, places: { 'parked.tags': ['parked', '#Project/Old'] } });
      assert.deepStrictEqual(await service.unparkTag(index, '#project/old', rulesOf(['#parked', '#project/old'])), {
        kind: 'unparked',
        label: '#project/old',
      });
      assert.deepStrictEqual(places[0].writes, [['parked']]);
    });

    test('says why a tag the setting does not list here cannot be unparked', async () => {
      const { service } = parkingWith({ notes, places: { 'parked.tags': ['parked'] } });
      assert.deepStrictEqual(await service.unparkTag(index, '#project/old', rulesOf(['#project'])), {
        kind: 'parked-through',
        label: '#project/old',
        parent: '#project',
      });
      assert.deepStrictEqual(await service.unparkTag(index, '#project/old', rulesOf(['#project/old'])), {
        kind: 'parked-elsewhere',
        label: '#project/old',
      });
      assert.deepStrictEqual(await service.unparkTag(index, '#project/old', rulesOf(['#parked'])), {
        kind: 'refused',
        reason: 'not-parked',
        label: '#project/old',
      });
    });

    test('refuses what is not a tag, and stops when the setting could not be saved', async () => {
      const { service } = parkingWith({ notes, places: { 'parked.tags': ['project/old'] }, settingsSave: false });
      assert.deepStrictEqual(await service.unparkTag(index, '@', rulesOf([])), { kind: 'refused', reason: 'not-a-tag' });
      assert.deepStrictEqual(await service.unparkTag(index, 'project/old', rulesOf(['#project/old'])), {
        kind: 'not-written',
      });
    });
  });
});
