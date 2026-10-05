import * as assert from 'assert';

import { buildWorkspaceIndex } from '../domain/index/indexState';
import { parseMarkdown } from '../domain/markdown/parser';
import { STARTER_TEMPLATES } from '../domain/notes/starterTemplates';
import { fillTemplate, findTemplatePrompts, getTemplateVariables } from '../domain/notes/templates';
import { listTagsWithoutHub } from '../ui/commands/hubs/register';

suite('Starter templates and hub notes for tags', () => {
  test('each starter template asks its questions and fills to a tagged note', () => {
    assert.deepStrictEqual(STARTER_TEMPLATES.map((template) => template.fileName), ['Meeting.md', 'One-on-one.md', 'Decision record.md']);
    const oneOnOne = STARTER_TEMPLATES[1];
    assert.deepStrictEqual(findTemplatePrompts(oneOnOne.content), ['Who is the 1:1 with?']);
    const filled = fillTemplate(oneOnOne.content, getTemplateVariables('Dana 1:1', new Date(2026, 9, 4, 9, 5)), new Map([['Who is the 1:1 with?', 'dana']]));
    const note = parseMarkdown('notes/Dana 1:1.md', filled);
    assert.match(filled, /^# Dana 1:1 #meeting\/1-1\n\n2026-10-04 with @dana/);
    assert.ok(note.sections[0].tags.includes('#meeting/1-1'));
    assert.strictEqual(note.tasks.length, 0, 'no empty task lines');
  });

  test('the tags offered a hub note are those none describes, the most used first', () => {
    const index = buildWorkspaceIndex(new Map([
      ['atlas.md', parseMarkdown('atlas.md', '---\ndescribes: project/atlas\n---\n# Atlas\n')],
      ['a.md', parseMarkdown('a.md', '# A #project/atlas #topic/mesh\n- [ ] y #risk/vendor')],
      ['b.md', parseMarkdown('b.md', '# B #topic/mesh')],
      ['c.md', parseMarkdown('c.md', '# C #topic/mesh')],
    ]));
    const offered = listTagsWithoutHub(index).map((tag) => tag.key);
    assert.ok(!offered.includes('#project/atlas'));
    assert.deepStrictEqual(offered.slice(0, 2), ['#topic/mesh', '#risk/vendor']);
  });
});
