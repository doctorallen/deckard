import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseMarkdown } from '../domain/markdown/parser';
import { createDailyNote, readPeriodicTemplate } from '../ui/commands/dailyNote';
import {
  describeExtractFailure,
  extractHeadingNote,
  getSuggestedNoteName,
  validateExtractedNoteName,
} from '../ui/commands/extractHeading';
import { openSourceAt, resolveSourceUri, sourceScopeUri } from '../ui/commands/navigation';
import { buildWorkspaceIndex } from '../domain/index/indexState';
import {
  applyHubTemplate,
  createHubNoteContent,
  getHubNoteName,
} from '../ui/commands/hubNote';
import { summarizeTagMerge } from '../domain/index/tagMerge';
import { replaceIndexedTag } from '../domain/markdown/tagRename';
import { parseRenameTag, renameIndexedTag } from '../ui/commands/renameTag';
import { WorkspaceWriteHistory } from '../ui/commands/workspaceWrites';
import { toggleTask } from '../ui/commands/taskActions';
import { createTaskWrites } from './taskWrites';
import { getExtractedNoteFileName } from '../domain/markdown/noteNames';
import { findHeadingAtLine } from '../domain/notes/headingLookup';
import { formatIsoDate } from '../domain/markdown/calendar';

suite('Source commands', () => {
  // The history these edits write to, which no other suite shares.
  const writes = createTaskWrites();

  test('toggles a checklist character and adds only its completion date', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const fileUri = vscode.Uri.joinPath(temporaryRoot, 'notes.md');
    const originalContent = '# Today\n\n- [ ] Follow the lead\n';
    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from(originalContent, 'utf8'),
    );

    const parsed = parseMarkdown(fileUri.fsPath, originalContent);
    const updated = await toggleTask(writes, parsed.tasks[0], true);
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
      writes,
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
      writes,
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
    assert.strictEqual(await toggleTask(writes, parsed.tasks[0], true), false);
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

    const content = applyHubTemplate({ template, tag: project, title: 'Atlas', now, answers: new Map([['Owner', 'Mara']]) });
    assert.strictEqual(
      content,
      '---\ndescribes: project/atlas\ntags: [meeting]\nowner: Mara\n---\n# Atlas\nNotes on #project/atlas from 2026-09-03.\n',
    );
    assert.deepStrictEqual(parseMarkdown('notes/atlas.md', content).hub?.describes, [project]);

    assert.strictEqual(
      applyHubTemplate({ template: '# {title}\n', tag: project, title: 'Atlas', now }),
      '---\ndescribes: project/atlas\n---\n# Atlas\n',
      'front matter is added when the template has none',
    );
    assert.strictEqual(
      applyHubTemplate({ template: '---\n---\n# {title}\n', tag: project, title: 'Atlas', now }),
      '---\ndescribes: project/atlas\n---\n# Atlas\n',
      'empty front matter gains describes',
    );
    const ownDescribes = '---\ndescribes: project/atlas-program\n---\n# {title}\n';
    assert.strictEqual(
      applyHubTemplate({ template: ownDescribes, tag: project, title: 'Atlas', now }),
      '---\ndescribes: project/atlas-program\n---\n# Atlas\n',
      "the template's own describes is kept",
    );
    assert.strictEqual(
      applyHubTemplate({ template: '---\ntags: [meeting]\n...\n# {title}\n', tag: project, title: 'Atlas', now }),
      '---\ndescribes: project/atlas\ntags: [meeting]\n...\n# Atlas\n',
      'front matter closed by ... gains describes, not a second block',
    );
    assert.strictEqual(
      applyHubTemplate({ template: '---\r\ntags: [meeting]\r\n---\r\n# {title}\r\n', tag: project, title: 'Atlas', now }),
      '---\r\ndescribes: project/atlas\r\ntags: [meeting]\r\n---\r\n# Atlas\r\n',
      'describes is written in the line ending the template uses',
    );

    const person = { key: '@dana', label: '@dana' };
    const personNote = applyHubTemplate({ template: '# {title}\nRole: \n', tag: person, title: 'Dana', now });
    assert.ok(personNote.startsWith('---\ndescribes: "@dana"\n---\n'));
    assert.deepStrictEqual(parseMarkdown('notes/dana.md', personNote).hub?.describes, [person]);
  });

  test('renames a tag in the notes it changes when a note it does not change has no file', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const tagged = vscode.Uri.joinPath(temporaryRoot, 'tagged.md');
    await vscode.workspace.fs.writeFile(tagged, Buffer.from('# Alpha #apollo\n', 'utf8'));
    // A relative path, which no workspace folder of the test host holds.
    const untouched = 'notes/untouched.md';
    assert.strictEqual(await resolveSourceUri(untouched), undefined, 'the test host has no workspace folder');
    const index = buildWorkspaceIndex(new Map([
      [tagged.fsPath, parseMarkdown(tagged.fsPath, '# Alpha #apollo\n')],
      [untouched, parseMarkdown(untouched, '# Gamma\n')],
    ]));
    const indexer = {
      ready: Promise.resolve(),
      getSnapshot: () => index,
      refresh: async () => undefined,
    } as unknown as Parameters<typeof renameIndexedTag>[0];
    const window = vscode.window as unknown as Record<string, unknown>;
    const originals = [window.showInputBox, window.showInformationMessage, window.showErrorMessage];
    const errors: unknown[] = [];
    window.showInputBox = async () => '#hermes';
    window.showInformationMessage = async () => undefined;
    window.showErrorMessage = async (message: unknown) => void errors.push(message);
    try {
      const renamed = await renameIndexedTag(indexer, '#apollo', { history: new WorkspaceWriteHistory() });

      assert.deepStrictEqual(errors, []);
      assert.strictEqual(renamed?.key, '#hermes');
      assert.strictEqual((await vscode.workspace.openTextDocument(tagged)).getText(), '# Alpha #hermes\n');
    } finally {
      [window.showInputBox, window.showInformationMessage, window.showErrorMessage] = originals;
      await deleteTemporaryRoot(temporaryRoot);
    }
  });

  test('opens a source document at the requested one-based line', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const fileUri = vscode.Uri.joinPath(temporaryRoot, 'navigation.md');
    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from('first\nsecond\nthird\n', 'utf8'),
    );

    const editor = await openSourceAt({ filePath: fileUri.fsPath, line: 2 });

    assert.ok(editor);
    assert.strictEqual(editor.document.uri.toString(), fileUri.toString());
    assert.strictEqual(editor.selection.active.line, 1);
    await deleteTemporaryRoot(temporaryRoot);
  });

  test('finds the second of two workspace folders with the same name by its numbered key', async () => {
    const work = { uri: vscode.Uri.file('/home/me/work/notes'), name: 'notes', index: 0 } as vscode.WorkspaceFolder;
    const personal = { uri: vscode.Uri.file('/home/me/personal/notes'), name: 'notes', index: 1 } as vscode.WorkspaceFolder;
    const folders = [work, personal];
    assert.strictEqual(sourceScopeUri('notes/plan.md', folders)?.path, '/home/me/work/notes/plan.md');
    assert.strictEqual(sourceScopeUri('notes (2)/plan.md', folders)?.path, '/home/me/personal/notes/plan.md');
    const resolved = await resolveSourceUri('notes (2)/plan.md', folders);
    assert.strictEqual(resolved?.path, '/home/me/personal/notes/plan.md');
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

  test('starts a periodic note from Daily.md, Weekly.md, or Monthly.md in the templates folder, else its own line', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const workspaceFolder = { uri: temporaryRoot, name: 'temporary', index: 0 } as vscode.WorkspaceFolder;
    const templates = vscode.Uri.joinPath(temporaryRoot, 'templates');
    await vscode.workspace.fs.createDirectory(templates);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(templates, 'Weekly.md'), Buffer.from('# Week of {date}\n', 'utf8'));
    try {
      assert.strictEqual(await readPeriodicTemplate(workspaceFolder, 'week'), '# Week of {date}\n');
      assert.strictEqual(await readPeriodicTemplate(workspaceFolder, 'day'), '# {date}\n\n', 'no Daily.md');
      assert.strictEqual(await readPeriodicTemplate(workspaceFolder, 'month'), '# {month}\n\n', 'no Monthly.md');
    } finally {
      await deleteTemporaryRoot(temporaryRoot);
    }
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
    const section = findHeadingAtLine(parsed.sections, 7);
    assert.strictEqual(section?.heading, 'Detail #detail');
    // Any heading, tagged or not, is found under the cursor.
    assert.strictEqual(findHeadingAtLine(parsed.sections, 11)?.heading, 'Next');

    const extractedUri = await extractHeadingNote({
      section: parsed.sections[1],
      sourceUri,
      notesFolderUri: notesUri,
      name: 'lead-note.md',
    });
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
      await extractHeadingNote({ section: parsed.sections[1], sourceUri, notesFolderUri: notesUri, name: 'lead' }),
    );
    assert.strictEqual(
      Buffer.from(await vscode.workspace.fs.readFile(sourceUri)).toString(
        'utf8',
      ),
      ['# Case #case', 'Introduction.', '', '[[lead]]'].join('\n'),
    );

    await deleteTemporaryRoot(temporaryRoot);
  });

  test('keeps the new note when the old one could not be saved or put back', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const notesUri = vscode.Uri.joinPath(temporaryRoot, 'notes');
    const sourceUri = vscode.Uri.joinPath(notesUri, 'source.md');
    const content = '# Case #case\nIntro.\n\n## Lead #clue\nLead details.';
    await vscode.workspace.fs.createDirectory(notesUri);
    await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(content, 'utf8'));
    const parsed = parseMarkdown('notes/source.md', content);
    const exists = async (uri: vscode.Uri) =>
      vscode.workspace.fs.stat(uri).then(() => true, () => false);

    assert.strictEqual(
      await extractHeadingNote({ section: parsed.sections[1], sourceUri, notesFolderUri: notesUri, name: 'half', replace: async () => 'half' }),
      undefined,
    );
    assert.ok(
      await exists(vscode.Uri.joinPath(notesUri, 'half.md')),
      'the heading stays in the new note while the old note is unsaved',
    );

    await extractHeadingNote({ section: parsed.sections[1], sourceUri, notesFolderUri: notesUri, name: 'undone', replace: async () => 'unchanged' });
    assert.ok(
      !(await exists(vscode.Uri.joinPath(notesUri, 'undone.md'))),
      'nothing changed, so the new note goes',
    );
    await deleteTemporaryRoot(temporaryRoot);
  });

  test('says what became of each note when extracting fails', () => {
    assert.strictEqual(
      describeExtractFailure('unchanged', 'save', 'source.md', 'lead.md'),
      'Deckard could not save source.md, so the heading was not extracted and nothing was written.',
    );
    assert.strictEqual(
      describeExtractFailure('half', 'remove', 'source.md', 'lead.md'),
      'Deckard wrote lead.md but could not remove the heading from source.md, so the heading is in both notes. source.md is open with the link in its place: save it to finish, or undo the change in it and delete lead.md.',
    );
  });

  test('suggests and accepts only a name its link can open', () => {
    assert.ok(validateExtractedNoteName('Issue #42'), 'a # is refused');
    assert.ok(validateExtractedNoteName('Plan [draft]'), 'brackets are refused');
    assert.strictEqual(validateExtractedNoteName('Plan draft'), undefined);
    for (const heading of ['Issue #42 follow-up', 'Plan [draft] ^p1', 'Q3: budget | costs']) {
      const suggestion = getSuggestedNoteName(heading);
      assert.strictEqual(validateExtractedNoteName(suggestion), undefined, `${heading} -> ${suggestion}`);
    }
    assert.strictEqual(getSuggestedNoteName('Plan [draft]'), 'Plan draft');
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
      await extractHeadingNote({
        section: parsed.sections[0],
        sourceUri,
        notesFolderUri: notesUri,
        name: 'existing',
      }),
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
