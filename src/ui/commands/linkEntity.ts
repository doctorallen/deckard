import * as vscode from 'vscode';

import {
  extractTags,
  getPersonMarker,
  stripTags,
} from '../../core/markdown/parser';
import { Entity, EntityKind } from '../../core/types';
import { WorkspaceIndexer } from '../../core/workspace/indexer';
import { isMarkdownFile } from '../../core/workspace/scanner';

interface EntityChoice extends vscode.QuickPickItem {
  entity?: Entity;
  create?: boolean;
}

interface EntityKindChoice extends vscode.QuickPickItem {
  value: EntityKind;
}

/**
 * Lets the user explicitly attach the current heading to a canonical entity.
 */
export async function linkCurrentHeading(
  indexer: WorkspaceIndexer,
): Promise<void> {
  await indexer.ready;
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMarkdownFile(editor.document.uri)) {
    void vscode.window.showWarningMessage(
      'Open a Markdown heading before linking it to an entity.',
    );
    return;
  }

  const line = editor.document.lineAt(editor.selection.active.line);
  const heading = line.text.match(/^ {0,3}#{1,6}[ \t]+(.+?)\s*$/);
  if (!heading) {
    void vscode.window.showWarningMessage(
      'Place the cursor on a Markdown heading before linking it to an entity.',
    );
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
        label: '$(add) Create a new entity',
        description: 'Insert a canonical tag in this heading',
        create: true,
      },
    ],
    { placeHolder: `Link "${headingName}" to an entity` },
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
      `${entity.label} is already linked to this heading.`,
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
    { placeHolder: 'Choose entity type' },
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

function toSlug(value: string): string | undefined {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || undefined;
}
