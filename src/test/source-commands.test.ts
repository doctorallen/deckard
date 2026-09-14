import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../core/markdown/parser';
import { formatIsoDate } from '../core/markdown/taskMetadata';
import { createDailyNote } from '../ui/commands/dailyNote';
import {
  extractHeadingNote,
  findTaggedHeadingAtLine,
  getExtractedNoteFileName,
} from '../ui/commands/extractHeading';
import { openSourceAt, resolveSourceUri } from '../ui/commands/navigation';
import { buildWorkspaceIndex } from '../core/workspace/indexer';
import {
  applyHubTemplate,
  createHubNoteContent,
  getHubNoteName,
} from '../ui/commands/hubNote';
import {
  parseRenameTag,
  replaceIndexedTag,
  summarizeTagMerge,
} from '../ui/commands/renameTag';
import { toggleTask } from '../ui/commands/taskActions';

suite('Source commands', () => {
  test('toggles a checklist character and adds only its completion date', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const fileUri = vscode.Uri.joinPath(temporaryRoot, 'notes.md');
    const originalContent = '# Today\n\n- [ ] Follow the lead\n';
    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from(originalContent, 'utf8'),
    );

    const parsed = parseMarkdown(fileUri.fsPath, originalContent);
    const updated = await toggleTask(parsed.tasks[0], true);
    const content = Buffer.from(
      await vscode.workspace.fs.readFile(fileUri),
    ).toString('utf8');

    assert.strictEqual(updated, true);
    assert.strictEqual(
      content,
      `# Today\n\n- [x] Follow the lead ✅ ${formatIsoDate(Date.now())}\n`,
    );
    await deleteTemporaryRoot(temporaryRoot);
  });

  test('writes the next occurrence above a completed recurring task', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const fileUri = vscode.Uri.joinPath(temporaryRoot, 'weekly.md');
    const originalContent = '- [ ] Review 📅 2026-09-10 🔁 every week\n';
    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from(originalContent, 'utf8'),
    );
    const readContent = async (): Promise<string> =>
      Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf8');
    const today = formatIsoDate(Date.now());

    const completed = await toggleTask(
      parseMarkdown(fileUri.fsPath, originalContent).tasks[0],
      true,
    );
    const afterCompleting = await readContent();
    assert.strictEqual(completed, true);
    assert.strictEqual(
      afterCompleting,
      `- [ ] Review 📅 2026-09-17 🔁 every week\n- [x] Review 📅 2026-09-10 🔁 every week ✅ ${today}\n`,
    );

    // Reopening removes the done date but leaves the next occurrence alone.
    const reopened = await toggleTask(
      parseMarkdown(fileUri.fsPath, afterCompleting).tasks[1],
      false,
    );
    assert.strictEqual(reopened, true);
    assert.strictEqual(
      await readContent(),
      '- [ ] Review 📅 2026-09-17 🔁 every week\n- [ ] Review 📅 2026-09-10 🔁 every week\n',
    );
    await deleteTemporaryRoot(temporaryRoot);
  });

  test('rejects a task whose source line changed after indexing', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const fileUri = vscode.Uri.joinPath(temporaryRoot, 'stale.md');
    const originalContent = '- [ ] Original title\n';
    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from(originalContent, 'utf8'),
    );
    const parsed = parseMarkdown(fileUri.fsPath, originalContent);
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document, { preview: false });

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      fileUri,
      new vscode.Range(0, 0, 0, document.lineAt(0).text.length),
      '- [ ] Changed title',
    );
    assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
    assert.strictEqual(await toggleTask(parsed.tasks[0], true), false);
    assert.strictEqual(document.lineAt(0).text, '- [ ] Changed title');
    await deleteTemporaryRoot(temporaryRoot);
  });

  test('renames matching tag spans without touching prose or fenced code', () => {
    const originalContent = [
      '# Today #old #older',
      '',
      'A note with #old and #oldish.',
      '- [ ] Follow up #old',
      '',
      '```markdown',
      '#old',
      '```',
    ].join('\n');

    const result = replaceIndexedTag(originalContent, '#old', {
      key: '#new',
      label: '#new',
    });

    assert.strictEqual(result.occurrenceCount, 3);
    assert.strictEqual(
      result.content,
      [
        '# Today #new #older',
        '',
        'A note with #new and #oldish.',
        '- [ ] Follow up #new',
        '',
        '```markdown',
        '#old',
        '```',
      ].join('\n'),
    );
  });

  test('preserves front-matter value shapes while renaming tags', () => {
    const originalContent = [
      '---',
      'tags: [old, #old]',
      '---',
      '# Today #old',
    ].join('\n');

    const result = replaceIndexedTag(originalContent, '#old', {
      key: '#new',
      label: '#new',
    });

    assert.strictEqual(result.occurrenceCount, 3);
    assert.strictEqual(
      result.content,
      ['---', 'tags: [new, #new]', '---', '# Today #new'].join('\n'),
    );
  });

  test('infers a selected namespace for a bare replacement name', () => {
    assert.deepStrictEqual(
      parseRenameTag('new-performance', {
        key: '#management/performance',
        label: '#management/performance',
      }),
      {
        key: '#management/new-performance',
        label: '#management/new-performance',
      },
    );
  });

  test('merges into an existing tag without repeating it in tag runs or lists', () => {
    const result = replaceIndexedTag(
      [
        '---',
        'tags: [atlas, apollo]',
        '---',
        '# Plan #atlas #apollo',
        '- [ ] Ship #apollo #atlas',
        'Talked to #atlas about #apollo.',
      ].join('\n'),
      '#apollo',
      { key: '#atlas', label: '#atlas' },
    );

    assert.strictEqual(result.occurrenceCount, 4);
    assert.strictEqual(
      result.content,
      [
        '---',
        'tags: [atlas]',
        '---',
        '# Plan #atlas',
        '- [ ] Ship #atlas',
        'Talked to #atlas about #atlas.',
      ].join('\n'),
    );
  });

  test('removes merged front-matter list items but keeps a rename’s own repeats', () => {
    const atlas = { key: '#atlas', label: '#atlas' };
    assert.strictEqual(
      replaceIndexedTag(
        ['---', 'tags:', '  - atlas', '  - "apollo"', '---', '# Note'].join('\n'),
        '#apollo',
        atlas,
      ).content,
      ['---', 'tags:', '  - atlas', '---', '# Note'].join('\n'),
    );
    assert.strictEqual(
      replaceIndexedTag(
        ['---', 'tags: ["apollo", "atlas"]', '---'].join('\n'),
        '#apollo',
        atlas,
      ).content,
      ['---', 'tags: ["atlas"]', '---'].join('\n'),
    );
    assert.strictEqual(
      replaceIndexedTag('# Plan #apollo #apollo #atlas', '#apollo', atlas)
        .content,
      '# Plan #atlas',
    );
    // Without the new tag already there, a rename replaces every copy.
    assert.strictEqual(
      replaceIndexedTag('# Today #old #old', '#old', {
        key: '#new',
        label: '#new',
      }).content,
      '# Today #new #new',
    );
  });

  test('counts the entries a merge keeps', () => {
    const index = buildWorkspaceIndex(
      new Map([
        [
          'notes/a.md',
          parseMarkdown(
            'notes/a.md',
            '# One #apollo\n\n# Two #apollo #atlas\n\n# Three #atlas',
          ),
        ],
      ]),
    );
    const summary = summarizeTagMerge(index, '#apollo', '#atlas');
    assert.strictEqual(summary?.source.count, 2);
    assert.strictEqual(summary?.target.count, 2);
    assert.strictEqual(summary?.mergedCount, 3);
    assert.strictEqual(summary?.sharedCount, 1);
    assert.strictEqual(summarizeTagMerge(index, '#apollo', '#nowhere'), undefined);
  });

  test('renames hub note describes values in their written form', () => {
    const apollo = { key: '#project/apollo', label: '#project/apollo' };
    assert.strictEqual(
      replaceIndexedTag(
        ['---', 'describes: project/atlas', '---', '# Atlas'].join('\n'),
        '#project/atlas',
        apollo,
      ).content,
      ['---', 'describes: project/apollo', '---', '# Atlas'].join('\n'),
    );
    assert.strictEqual(
      replaceIndexedTag(
        ['---', 'describes: "#project/atlas"', '---'].join('\n'),
        '#project/atlas',
        apollo,
      ).content,
      ['---', 'describes: "#project/apollo"', '---'].join('\n'),
    );
  });

  test('names and writes a hub note the parser reads back', () => {
    const project = {
      key: '#project/skybridge-signal',
      label: '#project/skybridge-signal',
    };
    const person = { key: '@dana', label: '@dana' };
    assert.strictEqual(getHubNoteName(project), 'Skybridge Signal');
    assert.strictEqual(getHubNoteName(person), 'Dana');
    assert.strictEqual(
      createHubNoteContent(project, 'Skybridge Signal'),
      '---\ndescribes: project/skybridge-signal\n---\n# Skybridge Signal\n\n',
    );
    for (const tag of [project, person]) {
      assert.deepStrictEqual(
        parseMarkdown('notes/hub.md', createHubNoteContent(tag, 'Hub')).hub
          ?.describes,
        [tag],
      );
    }
  });

  test("starts a hub note from its namespace's template", () => {
    const project = { key: '#project/atlas', label: '#project/atlas' };
    const now = new Date(2026, 8, 3, 9, 5);
    const template =
      '---\ntags: [meeting]\nowner: {ask:Owner}\n---\n# {title}\nNotes on {tag} from {date}.\n';

    const content = applyHubTemplate(template, project, 'Atlas', now, new Map([['Owner', 'Mara']]));
    assert.strictEqual(
      content,
      '---\ndescribes: project/atlas\ntags: [meeting]\nowner: Mara\n---\n# Atlas\nNotes on #project/atlas from 2026-09-03.\n',
    );
    assert.deepStrictEqual(parseMarkdown('notes/atlas.md', content).hub?.describes, [project]);

    assert.strictEqual(
      applyHubTemplate('# {title}\n', project, 'Atlas', now),
      '---\ndescribes: project/atlas\n---\n# Atlas\n',
      'front matter is added when the template has none',
    );
    assert.strictEqual(
      applyHubTemplate('---\n---\n# {title}\n', project, 'Atlas', now),
      '---\ndescribes: project/atlas\n---\n# Atlas\n',
      'empty front matter gains describes',
    );
    const ownDescribes = '---\ndescribes: project/atlas-program\n---\n# {title}\n';
    assert.strictEqual(
      applyHubTemplate(ownDescribes, project, 'Atlas', now),
      '---\ndescribes: project/atlas-program\n---\n# Atlas\n',
      "the template's own describes is kept",
    );

    const person = { key: '@dana', label: '@dana' };
    const personNote = applyHubTemplate('# {title}\nRole: \n', person, 'Dana', now);
    assert.ok(personNote.startsWith('---\ndescribes: "@dana"\n---\n'));
    assert.deepStrictEqual(parseMarkdown('notes/dana.md', personNote).hub?.describes, [person]);
  });

  test('opens a source document at the requested one-based line', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const fileUri = vscode.Uri.joinPath(temporaryRoot, 'navigation.md');
    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from('first\nsecond\nthird\n', 'utf8'),
    );

    const editor = await openSourceAt(fileUri.fsPath, 2);

    assert.ok(editor);
    assert.strictEqual(editor.document.uri.toString(), fileUri.toString());
    assert.strictEqual(editor.selection.active.line, 1);
    await deleteTemporaryRoot(temporaryRoot);
  });

  test('treats Windows drive paths as file paths', async () => {
    const uri = await resolveSourceUri(
      'C:\\Users\\david\\deckard\\notes\\case.md',
      [],
    );

    assert.ok(uri);
    assert.strictEqual(uri.scheme, 'file');
  });

  test('creates a daily note and does not overwrite an existing one', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const workspaceFolder = {
      uri: temporaryRoot,
      name: 'temporary',
      index: 0,
    } as vscode.WorkspaceFolder;

    const noteUri = await createDailyNote(workspaceFolder);
    assert.ok(noteUri);
    const firstContent = Buffer.from(
      await vscode.workspace.fs.readFile(noteUri!),
    ).toString('utf8');
    assert.match(firstContent, /^# \d{4}-\d{2}-\d{2}\n\n$/);

    const preservedContent = '# Preserved\n';
    await vscode.workspace.fs.writeFile(
      noteUri!,
      Buffer.from(preservedContent, 'utf8'),
    );
    await createDailyNote(workspaceFolder);
    const secondContent = Buffer.from(
      await vscode.workspace.fs.readFile(noteUri!),
    ).toString('utf8');

    assert.strictEqual(secondContent, preservedContent);
    await deleteTemporaryRoot(temporaryRoot);
  });

  test('moves a tagged heading section and leaves a link in its place', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const notesUri = vscode.Uri.joinPath(temporaryRoot, 'notes');
    const sourceUri = vscode.Uri.joinPath(notesUri, 'source.md');
    const sourceContent = [
      '# Case #case',
      'Introduction.',
      '',
      '## Lead #clue',
      'Lead details.',
      '',
      '### Detail #detail',
      'Nested details.',
      '',
      '## Next',
      'Next section.',
    ].join('\n');
    await vscode.workspace.fs.createDirectory(notesUri);
    await vscode.workspace.fs.writeFile(
      sourceUri,
      Buffer.from(sourceContent, 'utf8'),
    );

    const parsed = parseMarkdown('notes/source.md', sourceContent);
    const section = findTaggedHeadingAtLine(parsed.sections, 7);
    assert.strictEqual(section?.heading, 'Detail #detail');

    const extractedUri = await extractHeadingNote(
      parsed.sections[1],
      sourceUri,
      notesUri,
      'lead-note.md',
    );
    assert.ok(extractedUri);
    const extractedContent = Buffer.from(
      await vscode.workspace.fs.readFile(extractedUri!),
    ).toString('utf8');
    assert.strictEqual(
      extractedContent,
      [
        '## Lead #clue',
        'Lead details.',
        '',
        '### Detail #detail',
        'Nested details.',
        '',
      ].join('\n'),
    );
    assert.strictEqual(
      Buffer.from(await vscode.workspace.fs.readFile(sourceUri)).toString(
        'utf8',
      ),
      [
        '# Case #case',
        'Introduction.',
        '',
        '[[lead-note]]',
        '',
        '## Next',
        'Next section.',
      ].join('\n'),
    );

    await deleteTemporaryRoot(temporaryRoot);
  });

  test('leaves a link when extracting the last section of a note', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const notesUri = vscode.Uri.joinPath(temporaryRoot, 'notes');
    const sourceUri = vscode.Uri.joinPath(notesUri, 'source.md');
    const sourceContent = [
      '# Case #case',
      'Introduction.',
      '',
      '## Lead #clue',
      'Lead details.',
    ].join('\n');
    await vscode.workspace.fs.createDirectory(notesUri);
    await vscode.workspace.fs.writeFile(
      sourceUri,
      Buffer.from(sourceContent, 'utf8'),
    );

    const parsed = parseMarkdown('notes/source.md', sourceContent);
    assert.ok(
      await extractHeadingNote(parsed.sections[1], sourceUri, notesUri, 'lead'),
    );
    assert.strictEqual(
      Buffer.from(await vscode.workspace.fs.readFile(sourceUri)).toString(
        'utf8',
      ),
      ['# Case #case', 'Introduction.', '', '[[lead]]'].join('\n'),
    );

    await deleteTemporaryRoot(temporaryRoot);
  });

  test('rejects unsafe extraction names and preserves conflicts', async () => {
    assert.strictEqual(
      getExtractedNoteFileName('lead note.md'),
      'lead note.md',
    );
    assert.strictEqual(getExtractedNoteFileName('../lead-note'), undefined);
    assert.strictEqual(getExtractedNoteFileName('lead/note'), undefined);

    const temporaryRoot = await createTemporaryRoot();
    const notesUri = vscode.Uri.joinPath(temporaryRoot, 'notes');
    const parsed = parseMarkdown('notes/source.md', '# Case #case\nDetails.');
    const sourceUri = vscode.Uri.joinPath(notesUri, 'source.md');
    const noteUri = vscode.Uri.joinPath(notesUri, 'existing.md');
    await vscode.workspace.fs.createDirectory(notesUri);
    await vscode.workspace.fs.writeFile(
      sourceUri,
      Buffer.from('# Case #case\nDetails.', 'utf8'),
    );
    await vscode.workspace.fs.writeFile(
      noteUri,
      Buffer.from('Keep this note.\n', 'utf8'),
    );

    assert.strictEqual(
      await extractHeadingNote(
        parsed.sections[0],
        sourceUri,
        notesUri,
        'existing',
      ),
      undefined,
    );
    assert.strictEqual(
      Buffer.from(await vscode.workspace.fs.readFile(noteUri)).toString('utf8'),
      'Keep this note.\n',
    );
    assert.strictEqual(
      Buffer.from(await vscode.workspace.fs.readFile(sourceUri)).toString(
        'utf8',
      ),
      '# Case #case\nDetails.',
    );

    await deleteTemporaryRoot(temporaryRoot);
  });
});

async function createTemporaryRoot(): Promise<vscode.Uri> {
  const directoryName = `deckard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const temporaryRoot = vscode.Uri.file(path.join(os.tmpdir(), directoryName));
  await vscode.workspace.fs.createDirectory(temporaryRoot);
  return temporaryRoot;
}

async function deleteTemporaryRoot(temporaryRoot: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.delete(temporaryRoot, {
    recursive: true,
    useTrash: false,
  });
}
