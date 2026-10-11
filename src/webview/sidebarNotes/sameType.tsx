/**
 * For a note that is a typed row, under its related notes: the other rows
 * of its type that share a value with it, a group for each field and value,
 * `team` Payments, each row with one fact; the search for every row of the
 * type at the heading, and each group's at its label
 * (docs/implementation/32-same-type-in-context.md). A fold, as Linked from
 * is, kept as the reader leaves it; nothing in it is quieted under Zen.
 */
import type { SameTypeGroup, SameTypeRow, SameTypeRows } from '../../ui/protocol/sidebarNotes';

/** One other row: its title, which opens its note or its tag's page, then its fact, and Parked. */
function Row({ row }: { readonly row: SameTypeRow }) {
  const meta = [row.detail, row.parked ? 'Parked' : ''].filter(Boolean).join(' · ');
  const opens = row.filePath ? 'its note. Cmd/Ctrl-click to open it beside this one.' : 'its tag\'s page';
  return (
    <li class="same-type-row">
      {row.filePath || row.tagKey
        ? <button type="button" class="same-type-open note-text" data-action="open-same-type-row" data-row-id={row.id} data-tip={`Open ${opens}`}>{row.title}</button>
        : <span class="same-type-open note-text">{row.title}</span>}
      {meta ? <span class="same-type-detail">{meta}</span> : null}
    </li>
  );
}

/** A group's label: the field's key, muted and in monospace, in italics for a reverse, then the value they share. */
function GroupLabel({ group }: { readonly group: SameTypeGroup }) {
  const words = (
    <>
      <span class={group.reverse ? 'same-type-key is-reverse' : 'same-type-key'} data-tip={group.tip}>{group.field}</span>
      {' '}
      <span class="same-type-value">{group.value}</span>
    </>
  );
  return group.query
    ? <button type="button" class="same-type-label" data-action="open-same-type-search" data-group={group.id} data-tip={`Search ${group.query}`}>{words}</button>
    : <span class="same-type-label">{words}</span>;
}

/** How many more share a group's value than it lists, which opens its search when it has one. */
function More({ group }: { readonly group: SameTypeGroup }) {
  if (group.more <= 0) {
    return null;
  }
  const words = `+${group.more} more`;
  return group.query
    ? <button type="button" class="links-search same-type-more" data-action="open-same-type-search" data-group={group.id} data-tip={`Search ${group.query}`}>{words}</button>
    : <p class="links-more">{words}</p>;
}

/** One group: its label, its rows, and how many more share the value. */
function Group({ group }: { readonly group: SameTypeGroup }) {
  return (
    <section class="same-type-group" aria-label={`${group.field} ${group.value}`}>
      <GroupLabel group={group} />
      <ul class="link-list same-type-list">{group.rows.map((row) => <Row row={row} />)}</ul>
      <More group={group} />
    </section>
  );
}

/**
 * The section, "Other people", with how many it lists and All people at
 * its right; its groups, or the line saying nothing is shared. Nothing for
 * a note that is no typed row.
 */
export function SameType({ sameType, open }: { readonly sameType: SameTypeRows | undefined; readonly open: boolean }) {
  if (!sameType) {
    return null;
  }
  const heading = `Other ${sameType.plural}`;
  return (
    <section class="same-type" aria-label={heading}>
      {/* First, so focus meets it beside the heading it is drawn at. */}
      <button type="button" class="links-search same-type-all" data-action="open-same-type-search" data-tip={`Search ${sameType.query}`}>{`All ${sameType.plural}`}</button>
      <details class="links-group" data-links-group="sameType" open={open}>
        <summary>{heading}{sameType.count ? <>{' '}<span class="links-count">{sameType.count}</span></> : null}</summary>
        {sameType.groups.map((group) => <Group group={group} />)}
        {sameType.empty ? <p class="links-more">{sameType.empty}</p> : null}
      </details>
    </section>
  );
}
