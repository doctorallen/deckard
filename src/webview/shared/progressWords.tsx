/** A progress line's words, each part that counts tasks a link that searches just those tasks. */
export interface ProgressWordsPart {
  readonly text: string;
  readonly query?: string;
  readonly tip?: string;
  /** The page's search is this part's: drawn on, and a click goes back. */
  readonly active?: true;
}

/**
 * "3 of 8 done · 1 overdue · next due today", the parts with a search as
 * links: `action` is the `data-action` each runs, and `attributes` what
 * else it carries, such as which part it is.
 */
export function ProgressWords({ parts, action, attributes }: {
  readonly parts: readonly ProgressWordsPart[];
  readonly action: string;
  readonly attributes: (part: ProgressWordsPart, at: number) => Record<string, string | number>;
}) {
  return (
    <>
      {parts.map((part, at) => [
        at > 0 ? ' · ' : null,
        part.query
          ? (
            <button
              type="button"
              class={part.active ? 'progress-link is-on' : 'progress-link'}
              data-action={action}
              data-tip={part.active ? 'Show all of the tag’s entries again' : part.tip}
              aria-pressed={part.active ? 'true' : undefined}
              {...attributes(part, at)}
            >
              {part.text}
            </button>
          )
          : part.text,
      ])}
    </>
  );
}
