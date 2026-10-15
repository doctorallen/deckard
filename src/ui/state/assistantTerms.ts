/**
 * What `deckard_define_term` answers (docs/implementation/42-terms.md): a
 * short term's definition, from a term note or the first time it was
 * written beside its meaning, with where it comes from; or that the notes
 * define none, with how often they use it.
 *
 * ```
 * NDF: non-deliverable forward
 * Source: defined inline in notes/kickoff.md:2 (under FX recon kickoff), written 2026-03-03: "Book the NDF (non-deliverable forward) trades.".
 * Used in 4 entries.
 * ```
 */
import { formatIsoDate } from '../../domain/markdown/calendar';
import type { WorkspaceIndex } from '../../domain/model';
import { getTermTable, readTermQuestion, type TermPlace } from '../../domain/terms/terms';
import { isObject } from '../../shared/guards';
import { pluralize } from '../../shared/text';

/** The define tool's name, as the manifest declares it. */
export const DEFINE_TERM_TOOL_NAME = 'deckard_define_term';

/** A define call, read: the term asked about. */
export interface DefineTermToolInput {
  term: string;
}

/**
 * Reads a define call. VS Code checks input against the declared schema,
 * but an extension can call a tool directly, so it is checked again.
 */
export function readDefineTermToolInput(value: unknown): DefineTermToolInput | undefined {
  return isObject(value) && typeof value.term === 'string' && value.term.trim() !== '' ? { term: value.term.trim() } : undefined;
}

/** Where a place is, as `path:line`, with its heading and day when it has them. */
function describePlace(place: TermPlace): string {
  const heading = place.heading ? ` (under ${place.heading})` : '';
  const day = place.date > 0 ? `, written ${formatIsoDate(place.date)}` : '';
  return `${place.filePath}:${place.line}${heading}${day}`;
}

/**
 * A term's definition and its source, or the plain statement that the
 * notes define none, with how many entries use it and where first. The
 * term is read in capitals, so `ndf` and `what is NDF` ask about NDF.
 */
export function answerDefineTerm(index: WorkspaceIndex, input: DefineTermToolInput): string {
  const term = readTermQuestion(input.term) ?? input.term.toUpperCase();
  const entry = getTermTable(index).terms.get(term);
  if (!entry) {
    return `The notes define no term ${term}, and do not use it in three entries or more.`;
  }
  const used = `Used in ${pluralize(entry.count, 'entry', 'entries')}.`;
  const { definition } = entry;
  if (!definition) {
    return [
      `The notes do not define ${term}.`,
      `${used}${entry.firstUse ? ` First used in ${describePlace(entry.firstUse)}.` : ''}`,
    ].join('\n');
  }
  const source =
    definition.source === 'note'
      ? `Source: the term note ${definition.filePath}:${definition.line}.`
      : `Source: defined inline in ${describePlace(definition)}${definition.quote ? `: "${definition.quote}"` : ''}.`;
  return [`${term}: ${definition.text}`, source, used].join('\n');
}
