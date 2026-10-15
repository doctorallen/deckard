/**
 * Find's answers from the types, as rows it lists under Answer, and the
 * type and fact a typed tag's row under Tags is described by
 * (docs/implementation/30-databases.md § Surfaces 3); and above them, a
 * term's definition (docs/implementation/42-terms.md).
 *
 * ```
 * $(person) Dana Whitfield   @dana · Person · Head of Rates
 *           Bond Trading › owned by Rates › lead
 * ```
 */
import { noteTitle } from '../../domain/index/backlinks';
import { formatKeyWords } from '../../domain/markdown/tagKeys';
import type { WorkspaceIndex } from '../../domain/model';
import { isRowKind } from '../../domain/types/fieldKinds';
import { getTermTable, readTermQuestion } from '../../domain/terms/terms';
import { answerQuestion, MAX_ANSWERS, type TypeAnswer } from '../../domain/types/typeAnswers';
import { getTypeIndex, type TypeIndex, type TypeRow } from '../../domain/types/typeIndex';
import { findRowSummary, rowTag } from './typeHover';
import { valueTitle } from './typeRows';

/** What an answer's value is, which its icon shows: a person, another tag row, a note, text, or a term's definition. */
export type AnswerKind = 'person' | 'tag' | 'note' | 'value' | 'term';

/**
 * An answer as Find lists it: a tag row, opened on its tag page, or a note
 * row, opened at a line, as Find's own rows of those kinds are.
 */
export interface AnswerItem {
  kind: 'tag' | 'note';
  answer: AnswerKind;
  label: string;
  description?: string;
  /** The path from the row asked about to the value: `Bond Trading › owned by Rates › lead`. */
  detail?: string;
  tagKey?: string;
  filePath?: string;
  line?: number;
}

/** How many values a typed tag's fact lists before it says there are more. */
const FACT_VALUE_LIMIT = 3;

/**
 * Find's answers to what is typed, best first, at most three, each a row
 * that opens the value's page: a row's tag page or note, or, for a value
 * that is text, the page of the row that holds it. A defined term, or a
 * question about one, leads with its definition, which opens where it was
 * defined. Empty for words no term, row, and field answer.
 */
export function listAnswerItems(index: WorkspaceIndex, input: string, now: number): AnswerItem[] {
  const term = answerTerm(index, input);
  const types = getTypeIndex(index);
  if (types.isEmpty) {
    return term ? [term] : [];
  }
  return [...(term ? [term] : []), ...answerQuestion(types, input, now).map((answer) => toAnswerItem(index, types, answer))].slice(0, MAX_ANSWERS);
}

/**
 * A term's definition, when what is typed is a defined term or asks what
 * one is, `NDF` or `what is NDF` (docs/implementation/42-terms.md): a row
 * that opens where it was defined.
 */
function answerTerm(index: WorkspaceIndex, input: string): AnswerItem | undefined {
  const asked = readTermQuestion(input);
  const entry = asked === undefined ? undefined : getTermTable(index).terms.get(asked);
  const definition = entry?.definition;
  if (!entry || !definition) {
    return undefined;
  }
  return {
    kind: 'note',
    answer: 'term',
    label: definition.text,
    description: `${entry.term} · ${definition.source === 'note' ? noteTitle(definition.filePath) : `defined in ${definition.heading ?? noteTitle(definition.filePath)}`}`,
    filePath: definition.filePath,
    line: definition.line,
  };
}

/** One answer as a Find row: what it opens, its icon, and its path as the detail. */
function toAnswerItem(index: WorkspaceIndex, types: TypeIndex, answer: TypeAnswer): AnswerItem {
  const { value } = answer;
  const detail = [
    answer.from.title,
    ...answer.hops.map((hop) => `${hop.field} ${types.row(hop.rowId)?.title ?? hop.rowId}`),
    answer.field.name,
  ].join(' › ');
  const row = value.rowId ? types.row(value.rowId) : undefined;
  if (row) {
    return { ...openRow(row), label: row.title, description: describeAnswerRow(types, row), detail };
  }
  if (value.rowId?.startsWith('@')) {
    // A person no type has as a row.
    const tagKey = [value.rowId, `#person/${value.rowId.slice(1)}`].find((key) => index.tags.has(key)) ?? value.rowId;
    return { kind: 'tag', answer: 'person', label: valueTitle(types, value), description: `${value.rowId} · Person`, detail, tagKey };
  }
  if (value.notePath) {
    return { kind: 'note', answer: 'note', label: noteTitle(value.notePath), description: value.notePath, detail, filePath: value.notePath, line: 1 };
  }
  return {
    ...openRow(answer.holder),
    answer: 'value',
    label: value.text,
    description: `${answer.field.name} of ${answer.holder.title}`,
    detail,
  };
}

/** What a row's answer opens: a tag row's tag page, or a note row's note. */
function openRow(row: TypeRow): Pick<AnswerItem, 'kind' | 'answer' | 'tagKey' | 'filePath' | 'line'> {
  const tag = rowTag(row);
  if (tag) {
    return { kind: 'tag', answer: row.id.startsWith('@') ? 'person' : 'tag', tagKey: tag.key };
  }
  if (row.filePath) {
    return { kind: 'note', answer: 'note', filePath: row.filePath, line: 1 };
  }
  // A namespace level no tag is written for: its page lists the tags under it.
  return { kind: 'tag', answer: 'tag', tagKey: row.id };
}

/** A row answer's description: its tag, its type, and what it is, `@dana · Person · Head of Rates`. */
function describeAnswerRow(types: TypeIndex, row: TypeRow): string {
  const summary = findRowSummary(types, row.id);
  return [
    rowTag(row)?.label ?? row.filePath,
    types.registry.get(row.typeKey)?.name ?? formatKeyWords(row.typeKey),
    ...(summary ? [summary] : []),
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * What a typed tag's row under Tags leads its description with: its type
 * and one fact, its first relation that names something, with its values,
 * `Team · owns Bond Trading, FX`; else what it is, `Person · Head of
 * Rates`; else its type alone. Undefined for a tag no type has.
 */
export function describeTypedTag(index: WorkspaceIndex, tagKey: string): string | undefined {
  const types = getTypeIndex(index);
  const row = types.isEmpty ? undefined : types.rowOfTag(tagKey);
  if (!row) {
    return undefined;
  }
  const typeName = types.registry.get(row.typeKey)?.name ?? formatKeyWords(row.typeKey);
  const relation = types
    .fields(row.id)
    .find((field) => field.field && field.source !== 'reverse' && isRowKind(field.kind) && field.values.length > 0);
  if (relation) {
    const titles = relation.values.map((value) => valueTitle(types, value));
    const listed = titles.slice(0, FACT_VALUE_LIMIT).join(', ');
    return `${typeName} · ${relation.name} ${listed}${titles.length > FACT_VALUE_LIMIT ? ', …' : ''}`;
  }
  const summary = findRowSummary(types, row.id);
  return summary ? `${typeName} · ${summary}` : typeName;
}
