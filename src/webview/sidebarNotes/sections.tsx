/**
 * The note's headings, in the Context view: its Outline, drawn where its
 * related notes and links already are. Each heading opens where it is,
 * shows its own tags, how many of its tasks are done and how many links
 * name it, and folds the rest of the note away with Focus. The heading
 * the cursor is in is marked; a tag narrows the list.
 */
import type { SidebarSection, SidebarSections } from '../../ui/protocol/sidebarNotes';
import { TagButton } from '../shared/tagButton';

/** How many headings show before Show all, so a long note leaves room for its related notes. */
export const SECTION_PAGE_SIZE = 12;

/** What the list is drawn with besides the headings: whether it is open, and whether every heading shows. */
export interface SectionsView {
  readonly open: boolean;
  readonly showAll: boolean;
}

/** One heading: its title, which opens it, its tags, its counts, and Focus. */
function SectionRow({ row, active, showCounts }: { readonly row: SidebarSection; readonly active: boolean; readonly showCounts: boolean }) {
  const counts: string[] = [];
  if (showCounts && row.tasks) {
    counts.push(`${row.tasks.done}/${row.tasks.total}`);
  }
  if (showCounts && row.links) {
    counts.push(`↩${row.links}`);
  }
  const described = [
    row.tasks && showCounts ? `${row.tasks.done} of ${row.tasks.total} tasks done` : '',
    row.links && showCounts ? `named by ${row.links} ${row.links === 1 ? 'link' : 'links'}` : '',
  ].filter(Boolean).join(', ');
  return (
    <li class={`section-row depth-${Math.min(row.depth, 5)}${active ? ' is-active' : ''}`}>
      <button
        type="button"
        class="section-open"
        data-action="reveal-section"
        data-line={row.line}
        aria-current={active ? 'location' : undefined}
        data-tip="Open this heading in the editor"
      >
        {row.label}
      </button>
      {row.tags.map((tag) => <TagButton tag={tag} className="inline-tag section-tag" />)}
      {counts.length ? <span class="section-counts" aria-label={described}>{counts.join(' ')}</span> : null}
      <button
        type="button"
        class="section-focus"
        data-action="focus-section"
        data-line={row.line}
        aria-label={`Focus ${row.label}: fold the rest of the note away`}
        data-tip="Focus: fold the rest of the note away"
      >
        Focus
      </button>
    </li>
  );
}

/** The tag the list is narrowed by, or every heading. */
function SectionsFilter({ sections }: { readonly sections: SidebarSections }) {
  if (!sections.tags.length) {
    return null;
  }
  return (
    <label class="sections-filter">
      {'Show '}
      <select data-action="filter-sections" aria-label="Show the headings that carry a tag">
        <option value="" selected={!sections.filter}>every heading</option>
        {sections.tags.map((tag) => <option value={tag.key} selected={sections.filter?.key === tag.key}>{`those with ${tag.label}`}</option>)}
      </select>
    </label>
  );
}

/** The Sections group: nothing while no note is in the editor. */
export function Sections({ sections, view }: { readonly sections: SidebarSections | undefined; readonly view: SectionsView }) {
  if (!sections) {
    return null;
  }
  const shown = view.showAll ? sections.rows : sections.rows.slice(0, SECTION_PAGE_SIZE);
  const hidden = sections.rows.length - shown.length;
  return (
    <section class="note-links note-sections" aria-label="Sections of this note">
      <details class="links-group" data-links-group="sections" open={view.open}>
        <summary>Sections <span class="links-count">{sections.rows.length}</span></summary>
        <SectionsFilter sections={sections} />
        {shown.length
          ? <ul class="sections-list">{shown.map((row) => <SectionRow row={row} active={row.line === sections.activeLine} showCounts={sections.showCounts} />)}</ul>
          : <p class="links-more">{sections.filter ? `No heading carries ${sections.filter.label}.` : 'This note has no headings.'}</p>}
        {hidden > 0
          ? <p class="links-more"><button type="button" class="links-search" data-action="show-all-sections">{`Show all ${sections.rows.length} headings`}</button></p>
          : null}
      </details>
    </section>
  );
}
