/**
 * The weight rail where Related Notes draws it: beside each of the note's
 * own tags, drawn as a related tag is in Refine, and as each result's
 * relevance, which opens the breakdown of how the result was scored.
 */
import type { RankedNote, SidebarTag } from '../../ui/protocol/sidebarNotes';
import { getWeightLevel, WeightRail } from '../shared/facets';
import { TagLabel } from '../shared/tagLabel';

/** The note's own tag rows say how much a tag weighs to two places. */
function formatWeight(weight: number): string {
  return weight.toFixed(2);
}

/**
 * One of the note's tags, drawn as a related tag is in Refine: a full-width
 * row of its weight, its name, and how much a search for it finds.
 */
export function ActiveTag({ tag }: { readonly tag: SidebarTag }) {
  const weight = Number(tag.weight);
  const hasWeight = Number.isFinite(weight) && weight > 0;
  const matches = tag.matches || { notes: 0, tasks: 0 };
  const total = matches.notes + matches.tasks;
  const found = `${matches.notes} note${matches.notes === 1 ? '' : 's'} · ${matches.tasks} task${matches.tasks === 1 ? '' : 's'}`;
  const weightText = hasWeight ? `Related Notes weight ${formatWeight(weight)}. ` : '';
  return (
    <button
      type="button"
      class="tag-open active-tag-open"
      data-action="open-tag"
      data-tag-key={tag.key}
      data-tip={`${weightText}${found}. Open its page.`}
      aria-label={`Open ${tag.label} overview (${hasWeight ? `Related Notes weight ${formatWeight(weight)}, ` : ''}${found})`}
    >
      {hasWeight ? <WeightRail level={getWeightLevel(weight)} title={`Segmented rail, Related Notes weight ${formatWeight(weight)}`} /> : null}
      <TagLabel label={tag.label} />
      <span class="refine-count">{total}</span>
    </button>
  );
}

/** A reason that only lists tags, as the ranking words it: "Shared: a, b" or "Associated: a". */
const TAG_LIST_REASON = /^(Shared|Associated): (.+)$/;

/**
 * The reasons a result's card gives for it, after those that only list
 * tags its chips already name: a reason saying "Shared: …" or
 * "Associated: …" of tags drawn as chips on the card said them twice, so it
 * goes, and the line moves on to the next reason, or to nothing. A result
 * with no reasons at all is a "Related note".
 */
export function explainRelevance(note: RankedNote, chipLabels: readonly string[]): string[] {
  const namesOnlyChips = (reason: string): boolean => {
    const match = TAG_LIST_REASON.exec(reason);
    if (!match) {
      return false;
    }
    const listed = match[2].split(', ');
    return listed.length > 0 && listed.every((label) => chipLabels.includes(label));
  };
  const all = note.reasons || [];
  const kept = all.filter((reason) => !namesOnlyChips(reason));
  if (kept.length) {
    return kept;
  }
  return all.some(namesOnlyChips) ? [] : ['Related note'];
}

/** What a result's score is made of, when the ranking did not say: its association alone. */
function evidenceOf(note: RankedNote): NonNullable<RankedNote['relevanceEvidence']> {
  return note.relevanceEvidence || {
    directTagWeight: 0,
    associationWeight: note.associationWeight || 0,
    normalizedAssociationWeight: note.associationWeight || 0,
    appliedAssociationWeight: note.associationWeight || 0,
    entryLinkWeight: 0,
    fileLinkWeight: 0,
    lexicalWeight: 0,
    recencyWeight: 0,
    specificityPenalty: 0,
    lexicalTerms: [],
  };
}

/** The signals that raised a result's score, each named, the ones that added nothing left out. */
function scoredWeights(evidence: NonNullable<RankedNote['relevanceEvidence']>): Array<[string, number]> {
  const weights: Array<[string, number]> = [
    ['Shared-tag weight', evidence.directTagWeight],
    ['Association weight', evidence.appliedAssociationWeight],
    ['Direct entry-link weight', evidence.entryLinkWeight],
    ['File-link weight', evidence.fileLinkWeight],
    ['Lexical weight', evidence.lexicalWeight],
    ['Recency tie-breaker', evidence.recencyWeight],
  ];
  return weights.filter((item) => item[1] > 0);
}

/** The words a level of the rail is said in. */
function describeLevel(level: number): string {
  if (level >= 3) {
    return 'strong';
  }
  return level === 2 ? 'moderate' : 'weak';
}

/**
 * The breakdown of a result's score: the score itself, the reasons, and
 * each signal's weight, with the adjustment for a tag too common to say
 * much.
 */
function RelevanceBreakdown({ note, reasons }: { readonly note: RankedNote; readonly reasons: readonly string[] }) {
  const evidence = evidenceOf(note);
  return (
    <span class="relevance-tooltip popover is-tip" role="tooltip">
      <span class="relevance-tooltip-header"><strong>Relevance score</strong><strong>{`${note.relevanceScore}%`}</strong></span>
      <ul>{reasons.map((reason) => <li>{reason}</li>)}</ul>
      <div class="relevance-weights">
        {scoredWeights(evidence).map(([label, value]) => [<span>{label}</span>, <strong>{Number(value).toFixed(2)}</strong>])}
        {evidence.specificityPenalty > 0
          ? [<span>Specificity adjustment</span>, <strong>{`-${Math.round(evidence.specificityPenalty * 100)} pts`}</strong>]
          : null}
      </div>
    </span>
  );
}

/**
 * A result's relevance, as its rail: strong, moderate, or weak, which a
 * press opens into the breakdown hovering shows. A precise-looking
 * percentage from a heuristic ranker invites a reader to build a model of
 * it that two close scores then break, so the number waits in the
 * breakdown for anyone who wants it.
 */
export function RelevanceScore({ note, reasons }: { readonly note: RankedNote; readonly reasons: readonly string[] }) {
  const level = getWeightLevel(note.relevanceScore / 100);
  return (
    <span class="relevance-wrap">
      <button
        type="button"
        class="relevance-score"
        data-action="show-relevance"
        aria-expanded="false"
        aria-label={`Relevance ${describeLevel(level)}, ${note.relevanceScore} of 100. Show how this was scored.`}
      >
        <WeightRail level={level} />
      </button>
      <RelevanceBreakdown note={note} reasons={reasons} />
    </span>
  );
}
