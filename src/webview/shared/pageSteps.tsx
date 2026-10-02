/**
 * Previous, the page numbers, and Next: the control that walks a list a
 * page at a time. Every list that pages uses it, so a search page and a
 * widget on Home are walked the same way.
 */

/** Which page of a list is shown, of how many, and how many entries there are. */
export interface Paging {
  /** 1-based. */
  readonly page: number;
  /** How many entries a page holds. */
  readonly size: number;
  readonly pageCount: number;
  readonly total: number;
}

/**
 * The page numbers worth offering: all of them when there are few, else the
 * ends, which a reader goes back to, and the pages either side of the
 * current one, because they are the next step. A gap is a null.
 */
export function pageNumbers(current: number, pageCount: number): Array<number | null> {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const pages = [1, pageCount, current, current - 1, current + 1]
    .filter((page) => page >= 1 && page <= pageCount)
    .filter((page, index, all) => all.indexOf(page) === index)
    .sort((left, right) => left - right);
  const withGaps: Array<number | null> = [];
  pages.forEach((page, index) => {
    if (index > 0 && page - pages[index - 1] > 1) {
      withGaps.push(null);
    }
    withGaps.push(page);
  });
  return withGaps;
}

/** "271–300 of 3760", the part of a list a page is showing; empty for an empty list. */
export function describePageRange(paging: Paging | undefined): string {
  if (!paging || !paging.total) {
    return '';
  }
  const first = (paging.page - 1) * paging.size + 1;
  const last = Math.min(paging.page * paging.size, paging.total);
  return `${first}–${last} of ${paging.total}`;
}

/** What the steps run and say: their `data-action`, the attributes that say whose list it is, and what its entries are called. */
export interface PageStepsProps {
  readonly paging: Paging | undefined;
  readonly action: string;
  /** Attributes every step carries, such as `data-kind`, by name. */
  readonly attributes?: Readonly<Record<string, string>>;
  /** The entries, for a screen reader: "Next page of notes". */
  readonly noun: string;
}

/**
 * Previous, the page numbers with the current one marked, and Next, each a
 * button carrying the page it goes to in `data-page`; nothing for a list of
 * one page.
 */
export function PageSteps({ paging, action, attributes, noun }: PageStepsProps) {
  if (!paging || paging.pageCount <= 1) {
    return null;
  }
  const step = (page: number, label: string, enabled: boolean) => (
    <button class="page-step" data-action={action} data-page={page} {...attributes} disabled={!enabled} aria-label={`${label} page of ${noun}`}>{label}</button>
  );
  return (
    <>
      {step(paging.page - 1, 'Previous', paging.page > 1)}
      {pageNumbers(paging.page, paging.pageCount).map((page) => {
        if (page === null) {
          return <span class="page-gap" aria-hidden="true">…</span>;
        }
        const current = page === paging.page;
        return (
          <button
            class={current ? 'page-number is-current' : 'page-number'}
            data-action={action}
            data-page={page}
            {...attributes}
            aria-current={current ? 'page' : undefined}
            aria-label={`Page ${page} of ${noun}`}
          >
            {page}
          </button>
        );
      })}
      {step(paging.page + 1, 'Next', paging.page < paging.pageCount)}
    </>
  );
}
