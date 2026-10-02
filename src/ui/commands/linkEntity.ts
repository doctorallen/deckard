import * as vscode from 'vscode';

import {
  extractTags,
  getPersonMarker,
  stripTags,
} from '../../domain/markdown/parser';
import { Entity, EntityKind } from '../../core/types';
import type { IndexReader } from '../../core/workspace/indexReader';
import { isMarkdownFile } from '../../core/workspace/scanner';

/** A picker row: an entity the index knows, or the row that makes a new one. */
interface EntityChoice extends vscode.QuickPickItem {
  entity?: Entity;
  create?: boolean;
}

/** A picker row for the kind of entity being made. */
interface EntityKindChoice extends vscode.QuickPickItem {
  value: EntityKind;
}

/** What is said when the cursor is not on a heading in a note. */
const HEADING_FIRST = 'Put the cursor on a heading in a note to tag it with a person or project.';

/**
 * Lets the user explicitly attach the current heading to a canonical entity:
 * one the index knows, or a new one, written as a tag at the heading's end.
 * Does nothing when the heading already carries that tag, and says so.
 */
export async function linkCurrentHeading(
  indexer: IndexReader,
): Promise<void> {
  await indexer.ready;
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMarkdownFile(editor.document.uri)) {
    void vscode.window.showInformationMessage(HEADING_FIRST);
    return;
  }

  const line = editor.document.lineAt(editor.selection.active.line);
  const heading = line.text.match(/^ {0,3}#{1,6}[ \t]+(.+?)\s*$/);
  if (!heading) {
    void vscode.window.showInformationMessage(HEADING_FIRST);
    return;
  }

  const personMarker = getPersonMarker(
    vscode.workspace
      .getConfiguration('deckard', editor.document.uri)
      .get<unknown>('personMarker', '@'),
  );
  const headingName = stripTags(heading[1], personMarker);
  const entities = [...indexer.getSnapshot().entities.values()];
  const choice = await vscode.window.showQuickPick(
    [
      ...entities
        .filter((entity) =>
          entity.name.toLowerCase().includes(headingName.toLowerCase()),
        )
        .map<EntityChoice>((entity) => ({
          label: entity.label,
          description: entity.kind,
          detail: entity.name,
          entity,
        })),
      {
        label: '$(add) A new person, project, or topic…',
        description: 'Writes its tag at the end of the heading',
        create: true,
      },
    ],
    { placeHolder: `Tag "${headingName}" with a person, project, or other namespaced tag` },
  );
  if (!choice) {
    return;
  }

  const entity = choice.entity ?? (await createEntity(headingName, personMarker));
  if (!entity) {
    return;
  }

  if (
    extractTags(line.text, undefined, personMarker).some(
      (tag) => tag.key === entity.key,
    )
  ) {
    void vscode.window.showInformationMessage(
      `The heading is already tagged ${entity.label}.`,
    );
    return;
  }

  await editor.edit((editBuilder) => {
    editBuilder.insert(
      new vscode.Position(line.lineNumber, line.text.length),
      ` ${entity.label}`,
    );
  });
}

/**
 * Asks for a new entity's kind and name, and returns the tag it is written
 * as; undefined when either prompt is dismissed or the name has no slug.
 */
async function createEntity(
  defaultName: string,
  personMarker: string,
): Promise<Pick<Entity, 'key' | 'label'> | undefined> {
  const kinds: EntityKindChoice[] = [
    { label: 'Person', value: 'person' },
    { label: 'Project', value: 'project' },
    { label: 'Topic', value: 'topic' },
    { label: 'Organization', value: 'organization' },
    { label: 'Meeting', value: 'meeting' },
  ];
  const kind = await vscode.window.showQuickPick<EntityKindChoice>(
    kinds,
    { placeHolder: 'What is it?' },
  );
  if (!kind) {
    return undefined;
  }
  const name = await vscode.window.showInputBox({
    prompt: `Name the ${kind.value}`,
    value: defaultName,
    validateInput: (value) =>
      toSlug(value) ? undefined : 'Use letters, numbers, spaces, hyphens, or underscores.',
  });
  if (name === undefined) {
    return undefined;
  }

  const slug = toSlug(name);
  if (!slug) {
    return undefined;
  }
  const marker = kind.value === 'person' ? personMarker : '#';
  const namespace =
    kind.value === 'organization' ? 'org' : kind.value;
  const label =
    kind.value === 'person' ? `${marker}${slug}` : `${marker}${namespace}/${slug}`;
  return {
    key: kind.value === 'person' ? `@${slug}` : label.toLowerCase(),
    label,
  };
}

/** The name as a tag's slug: lowercase, with runs of other characters as hyphens; undefined when nothing is left. */
function toSlug(value: string): string | undefined {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || undefined;
}
