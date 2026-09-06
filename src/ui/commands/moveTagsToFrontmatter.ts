import * as vscode from 'vscode';

import {
  EntityNamespaceAliases,
  extractTagSpans,
  getEntityKind,
  getEntityNamespaceAliases,
  getPersonMarker,
} from '../../core/markdown/parser';
import { TagReference } from '../../core/types';
import { isMarkdownFile } from '../../core/workspace/scanner';

type FrontmatterTagGroup =
  | 'people'
  | 'projects'
  | 'topics'
  | 'organizations'
  | 'meetings'
  | 'tags';

const frontmatterGroups: FrontmatterTagGroup[] = [
  'people',
  'projects',
  'topics',
  'organizations',
  'meetings',
  'tags',
];

/**
 * Moves every explicit tag in the active note into merged note-level metadata.
 */
export async function moveInlineTagsToFrontmatter(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMarkdownFile(editor.document.uri)) {
    void vscode.window.showWarningMessage(
      'Open a Markdown note before moving tags to front matter.',
    );
    return;
  }

  const configuration = vscode.workspace.getConfiguration(
    'deckard',
    editor.document.uri,
  );
  const content = moveInlineTagsToFrontmatterContent(
    editor.document.getText(),
    getEntityNamespaceAliases(
      configuration.get<unknown>('entityNamespaceAliases', {}),
    ),
    getPersonMarker(configuration.get<unknown>('personMarker', '@')),
  );
  if (!content) {
    void vscode.window.showInformationMessage(
      'Deckard found no inline tags to move into front matter.',
    );
    return;
  }

  const document = editor.document;
  const replacementRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length),
  );
  const applied = await editor.edit((editBuilder) => {
    editBuilder.replace(replacementRange, content);
  });
  if (!applied) {
    void vscode.window.showWarningMessage(
      'Deckard could not move the note tags into front matter.',
    );
    return;
  }

  await document.save();
}

/**
 * Builds the complete transformed note so it can be applied atomically and
 * exercised without a live editor.
 */
export function moveInlineTagsToFrontmatterContent(
  content: string,
  entityNamespaceAliases: EntityNamespaceAliases = {},
  personMarker = '@',
): string | undefined {
  const lines = content.split(/\r?\n/);
  const frontmatter = getFrontmatterBounds(lines);
  const spans = extractTagSpans(
    content,
    true,
    entityNamespaceAliases,
    personMarker,
  ).filter((span) => span.lineNumber - 1 > (frontmatter?.end ?? -1));
  if (spans.length === 0) {
    return undefined;
  }

  const groupedValues = collectFrontmatterValues(lines, frontmatter);
  spans.forEach((span) => {
    const tag = { key: span.key, label: span.label };
    addFrontmatterValue(
      groupedValues,
      getFrontmatterGroup(tag),
      getFrontmatterValue(tag),
    );
  });

  const spansByLine = new Map<number, typeof spans>();
  spans.forEach((span) => {
    const lineSpans = spansByLine.get(span.lineNumber - 1) ?? [];
    lineSpans.push(span);
    spansByLine.set(span.lineNumber - 1, lineSpans);
  });
  spansByLine.forEach((lineSpans, lineIndex) => {
    let line = lines[lineIndex];
    lineSpans
      .sort((left, right) => right.startColumn - left.startColumn)
      .forEach((span) => {
        const startsWithWhitespace =
          span.startColumn > 0 && /[ \t]/.test(line[span.startColumn - 1]);
        const start = startsWithWhitespace
          ? span.startColumn - 1
          : span.startColumn;
        line = `${line.slice(0, start)}${line.slice(span.endColumn)}`;
      });
    lines[lineIndex] = line.replace(/[ \t]+$/g, '');
  });

  const bodyStart = frontmatter ? frontmatter.end + 1 : 0;
  const retainedFrontmatter = frontmatter
    ? getRetainedFrontmatterLines(lines.slice(1, frontmatter.end))
    : [];
  const generatedFrontmatter = frontmatterGroups.flatMap((group) => {
    const values = groupedValues.get(group) ?? [];
    return values.length > 0 ? [`${group}: [${values.join(', ')}]`] : [];
  });
  const normalizedFrontmatter = [
    '---',
    ...retainedFrontmatter,
    ...generatedFrontmatter,
    '---',
  ];

  return [...normalizedFrontmatter, ...lines.slice(bodyStart)].join('\n');
}

function getFrontmatterBounds(
  lines: string[],
): { end: number } | undefined {
  if (lines[0]?.trim() !== '---') {
    return undefined;
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  return end >= 0 ? { end } : undefined;
}

function collectFrontmatterValues(
  lines: string[],
  frontmatter: { end: number } | undefined,
): Map<FrontmatterTagGroup, string[]> {
  const values = new Map<FrontmatterTagGroup, string[]>();
  if (!frontmatter) {
    return values;
  }

  let currentGroup: FrontmatterTagGroup | undefined;
  lines.slice(1, frontmatter.end).forEach((line) => {
    const property = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (property) {
      currentGroup = getFrontmatterGroupForField(property[1]);
      if (currentGroup) {
        splitValues(property[2]).forEach((value) =>
          addFrontmatterValue(values, currentGroup!, value),
        );
      }
      return;
    }

    const listItem = line.match(/^\s*-\s+(.+?)\s*$/);
    if (listItem && currentGroup) {
      addFrontmatterValue(values, currentGroup, unquote(listItem[1]));
    }
  });

  return values;
}

function getRetainedFrontmatterLines(lines: string[]): string[] {
  const retained: string[] = [];
  let skippingSupportedField = false;

  lines.forEach((line) => {
    const property = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (property) {
      skippingSupportedField = getFrontmatterGroupForField(property[1]) !== undefined;
      if (!skippingSupportedField) {
        retained.push(line);
      }
      return;
    }

    if (!skippingSupportedField) {
      retained.push(line);
    }
  });

  return retained;
}

function getFrontmatterGroup(tag: TagReference): FrontmatterTagGroup {
  switch (getEntityKind(tag)) {
    case 'person':
      return 'people';
    case 'project':
      return 'projects';
    case 'topic':
      return 'topics';
    case 'organization':
      return 'organizations';
    case 'meeting':
      return 'meetings';
    default:
      return 'tags';
  }
}

function getFrontmatterValue(tag: TagReference): string {
  if (tag.key.startsWith('@')) {
    return tag.key.slice(1);
  }

  const kind = getEntityKind(tag);
  if (kind) {
    return tag.key.slice(tag.key.indexOf('/') + 1);
  }

  return tag.label.startsWith('#') ? tag.label.slice(1) : tag.label;
}

function getFrontmatterGroupForField(
  field: string,
): FrontmatterTagGroup | undefined {
  switch (field.toLowerCase()) {
    case 'person':
    case 'people':
      return 'people';
    case 'project':
    case 'projects':
      return 'projects';
    case 'topic':
    case 'topics':
      return 'topics';
    case 'organization':
    case 'organizations':
      return 'organizations';
    case 'meeting':
    case 'meetings':
      return 'meetings';
    case 'tag':
    case 'tags':
      return 'tags';
    default:
      return undefined;
  }
}

function addFrontmatterValue(
  values: Map<FrontmatterTagGroup, string[]>,
  group: FrontmatterTagGroup,
  value: string,
): void {
  const normalized = value.trim();
  if (!normalized) {
    return;
  }
  const groupValues = values.get(group) ?? [];
  if (!groupValues.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
    groupValues.push(normalized);
    values.set(group, groupValues);
  }
}

function splitValues(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  return (trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1).split(',')
    : [trimmed]
  )
    .map((item) => unquote(item.trim()))
    .filter(Boolean);
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}
