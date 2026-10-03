import * as assert from 'assert';

import { getCaptureInsertion } from '../domain/capture/captureLines';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import { PinnedNote, Section, WorkspaceIndex } from '../domain/model';
import { CaptureNotes, CaptureService } from '../services/captureService';

/** Notes by path, as they stand now; `refuse` makes every edit fail. */
class FakeNotes implements CaptureNotes<string> {
  public readonly texts: Map<string, string>;

  public constructor(texts: Record<string, string>, private readonly refuse = false) {
    this.texts = new Map(Object.entries(texts));
  }

  public async uriOf(filePath: string): Promise<string | undefined> {
    return this.texts.has(filePath) ? filePath : undefined;
  }

  public async sectionsOf(uri: string): Promise<readonly Section[]> {
    return parseMarkdown(uri, this.texts.get(uri) ?? '').sections;
  }

  public async append(
    uri: string,
    line: string,
    section?: Pick<Section, 'startLine' | 'endLine'>,
  ): Promise<number | undefined> {
    if (this.refuse) {
      return undefined;
    }
    const content = this.texts.get(uri) ?? '';
    const insertion = getCaptureInsertion(content, line, section);
    const lines = content.split('\n');
    const offset =
      lines.slice(0, insertion.line).reduce((total, each) => total + each.length + 1, 0) + insertion.character;
    this.texts.set(uri, content.slice(0, offset) + insertion.text + content.slice(offset));
    return insertion.taskLine;
  }
}

function indexOf(notes: Record<string, string>): WorkspaceIndex {
  return buildWorkspaceIndex(
    new Map(Object.entries(notes).map(([filePath, content]) => [filePath, parseMarkdown(filePath, content)])),
  );
}

/** A service over `notes`, recording each draft cleared and heading remembered. */
function service(index: WorkspaceIndex, notes: FakeNotes) {
  const events: string[] = [];
  const captures = new CaptureService({
    index: { getSnapshot: () => index },
    notes,
    drafts: {
      clear: async () => {
        events.push('draft cleared');
      },
    },
    recentHeadings: {
      recordRecentHeading: async (pin: PinnedNote) => {
        events.push(`remembered ${pin.heading}`);
      },
    },
  });
  return { captures, events };
}

suite('CaptureService', () => {
  const day = '# Day\n## Calls\n- [ ] One\n\n## Later\nText\n';

  test('today: the line is added, and only then is the draft let go', async () => {
    const notes = new FakeNotes({ 'daily/2026-09-25.md': '# 2026-09-25\n' });
    const { captures, events } = service(indexOf({}), notes);

    assert.deepStrictEqual(await captures.captureToToday('daily/2026-09-25.md', '- [ ] Call Ren'), {
      kind: 'added',
      uri: 'daily/2026-09-25.md',
      taskLine: 2,
    });
    assert.strictEqual(notes.texts.get('daily/2026-09-25.md'), '# 2026-09-25\n\n- [ ] Call Ren\n');
    assert.deepStrictEqual(events, ['draft cleared']);
  });

  test('today: a note that refuses the edit keeps the draft', async () => {
    const { captures, events } = service(indexOf({}), new FakeNotes({ 'today.md': '' }, true));

    assert.deepStrictEqual(await captures.captureToToday('today.md', '- [ ] Call Ren'), {
      kind: 'refused',
      uri: 'today.md',
    });
    assert.deepStrictEqual(events, []);
  });

  test('under a heading: found again in the note as it is now, added, and remembered', async () => {
    const index = indexOf({ 'day.md': day });
    const chosen = index.files.get('day.md')!.sections.find((section) => section.heading === 'Calls')!;
    // A line written above the heading since the index read the note.
    const notes = new FakeNotes({ 'day.md': `Intro\n${day}` });
    const { captures, events } = service(index, notes);

    assert.deepStrictEqual(await captures.captureUnderHeading('- [ ] Call Ren', chosen), {
      kind: 'added',
      uri: 'day.md',
      taskLine: 4,
    });
    assert.strictEqual(notes.texts.get('day.md'), 'Intro\n# Day\n## Calls\n- [ ] One\n- [ ] Call Ren\n\n## Later\nText\n');
    assert.deepStrictEqual(events, ['draft cleared', 'remembered Calls']);
  });

  test('under a heading: found and remembered when the index read the note again while the heading was being chosen', async () => {
    const chosen = indexOf({ 'day.md': day }).files.get('day.md')!.sections.find((section) => section.heading === 'Calls')!;
    // A line written above the heading, saved, and read by the index before the pick was made.
    const now = `# Day\nA line added above.\n${day.slice('# Day\n'.length)}`;
    const notes = new FakeNotes({ 'day.md': now });
    const { captures, events } = service(indexOf({ 'day.md': now }), notes);

    assert.deepStrictEqual(await captures.captureUnderHeading('- [ ] Call Ren', chosen), {
      kind: 'added',
      uri: 'day.md',
      taskLine: 4,
    });
    assert.strictEqual(notes.texts.get('day.md'), '# Day\nA line added above.\n## Calls\n- [ ] One\n- [ ] Call Ren\n\n## Later\nText\n');
    assert.deepStrictEqual(events, ['draft cleared', 'remembered Calls']);
  });

  test('under a heading: a note that is gone, a heading that is gone, or a refused edit writes nothing', async () => {
    const index = indexOf({ 'day.md': day });
    const chosen = index.files.get('day.md')!.sections.find((section) => section.heading === 'Calls')!;

    const gone = service(index, new FakeNotes({}));
    assert.deepStrictEqual(await gone.captures.captureUnderHeading('- [ ] Call Ren', chosen), { kind: 'missing-note' });

    const renamed = service(index, new FakeNotes({ 'day.md': day.replace('## Calls', '## Phone') }));
    assert.deepStrictEqual(await renamed.captures.captureUnderHeading('- [ ] Call Ren', chosen), {
      kind: 'missing-heading',
    });

    const refused = service(index, new FakeNotes({ 'day.md': day }, true));
    assert.deepStrictEqual(await refused.captures.captureUnderHeading('- [ ] Call Ren', chosen), {
      kind: 'refused',
      uri: 'day.md',
    });

    assert.deepStrictEqual([...gone.events, ...renamed.events, ...refused.events], [], 'every draft is kept');
  });
});
