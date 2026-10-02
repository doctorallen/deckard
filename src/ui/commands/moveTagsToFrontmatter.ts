import * as vscode from 'vscode';
import { describeRejectedEdit, noteName, reportFailure } from './notify';

import {
  EntityNamespaceAliases,
  extractTagSpans,
  getEntityKind,
  getEntityNamespaceAliases,
  getPersonMarker,
  isBuiltInEntityKind,
} from '../../domain/markdown/parser';
import {
  endsInComment,
  formatYamlValue,
  getFrontmatterBounds,
  splitValues,
} from '../../domain/markdown/frontmatterTags';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { TagReference } from '../../domain/model';
import { unquote } from '../../domain/markdown/frontmatter';

/** A front-matter field tags are moved into, by the entity kind they name. */
type FrontmatterTagGroup =
  | 'people'
  | 'projects'
  | 'topics'
  | 'organizations'
  | 'meetings'
  | 'tags';

/** The fields in the order they are written into the front matter. */
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
    void vscode.window.showInformationMessage(
      'Open a note to move its tags into front matter.',
    );
    return;
  }

  const commented = findCommentedTagField(editor.document.getText());
  if (commented) {
    void reportFailure({
      outcome: `Deckard did not move the tags: the ${commented} field in the front matter ends in a comment, which rewriting the field would lose.`,
      fix: 'Move the comment onto a line of its own, then try again.',
    });
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
    void reportFailure(describeRejectedEdit(noteName(document.uri)));
    return;
  }

  await document.save();
}

/**
 * Builds the complete transformed note so it can be applied atomically and
 * exercised without a live editor. Undefined when there is no inline tag to
 * move, or when a field it would write again ends in a YAML comment, which
 * `findCommentedTagField` names.
 */
export function moveInlineTagsToFrontmatterContent(
  content: string,
  entityNamespaceAliases: EntityNamespaceAliases = {},
  personMarker = '@',
): string | undefined {
  if (findCommentedTagField(content)) {
    return undefined;
  }
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
    return values.length > 0
      ? [`${group}: [${values.map((value) => formatYamlValue(value, 'list')).join(', ')}]`]
      : [];
  });
  const normalizedFrontmatter = [
    '---',
    ...retainedFrontmatter,
    ...generatedFrontmatter,
    '---',
  ];

  // The note keeps its own line endings: a CRLF note stays CRLF.
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  return [...normalizedFrontmatter, ...lines.slice(bodyStart)].join(eol);
}

/**
 * The first tag field, as written, whose line or list item ends in a YAML
 * comment, or undefined when none does. Moving tags writes every tag field
 * again, which would lose the comment or read it as a tag.
 */
export function findCommentedTagField(content: string): string | undefined {
  const lines = content.split(/\r?\n/);
  const frontmatter = getFrontmatterBounds(lines);
  if (!frontmatter) {
    return undefined;
  }
  let current: string | undefined;
  for (const line of lines.slice(1, frontmatter.end)) {
    const property = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (property) {
      current = getFrontmatterGroupForField(property[1]) ? property[1] : undefined;
      if (current && endsInComment(property[2])) {
        return current;
      }
      continue;
    }
    const listItem = line.match(/^\s*-\s+(.+?)\s*$/);
    if (listItem && current && endsInComment(listItem[1])) {
      return current;
    }
  }
  return undefined;
}

/** The values the note's front matter already holds, by the field they are under. */
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

/**
 * The front-matter lines that are kept as they are: every field except the
 * tag fields, which are written again with the moved tags merged in.
 */
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

/** The field a tag is moved into: its entity kind's, or `tags` for any other. */
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
    case undefined:
    default:
      return 'tags';
  }
}

/** How a tag is written in front matter: without its marker or its kind's namespace. */
function getFrontmatterValue(tag: TagReference): string {
  if (tag.key.startsWith('@')) {
    return tag.key.slice(1);
  }

  const kind = getEntityKind(tag);
  if (isBuiltInEntityKind(kind)) {
    return tag.key.slice(tag.key.indexOf('/') + 1);
  }

  return tag.label.startsWith('#') ? tag.label.slice(1) : tag.label;
}

/** The tag field a front-matter key is, singular or plural; undefined for any other key. */
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

/** Adds a value to its field, unless it is blank or the field holds it already, in any case. */
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
  if (groupValues.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
    return;
  }
  groupValues.push(normalized);
  values.set(group, groupValues);
}
