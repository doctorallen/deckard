/**
 * The Hierarchy layout: what a search found, under each tag Refine offers,
 * each group with its notes, its tasks, and how far along those tasks are.
 */
import type { SearchPageSnapshot, SearchResultGroup } from '../../ui/protocol/searchPage';
import { ProgressBar } from '../shared/progressBar';
import { type CardDisplay, SearchCard } from '../shared/searchCard';
import { TagLabel } from '../shared/tagLabel';
import { TaskListRow } from '../shared/taskRow';

/** "1 note", "4 tasks". */
function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** What a group holds, "4 notes · 6 tasks", leaving out a kind it has none of. */
function describeGroup(group: SearchResultGroup): string {
  return [
    group.noteCount ? countOf(group.noteCount, 'note') : '',
    group.taskCount ? countOf(group.taskCount, 'task') : '',
  ].filter(Boolean).join(' · ');
}

/**
 * The group's name: its tag, which narrows the search to it as Refine's
 * value does, or a plain heading for the results under none of the tags.
 */
function GroupHeading({ group, headingId, alone }: { readonly group: SearchResultGroup; readonly headingId: string; readonly alone: boolean }) {
  if (!group.tag) {
    return <h2 id={headingId} class="result-group-heading">{alone ? 'Results' : 'Under none of these tags'}</h2>;
  }
  return (
    <h2 id={headingId} class="result-group-heading">
      <button
        type="button"
        class="result-group-tag"
        data-action="facet"
        data-facet-id={group.tag.facetId}
        data-clause={group.tag.clause}
        data-tip={`Narrow the search to ${group.tag.label}`}
      >
        <TagLabel label={group.tag.label} />
      </button>
    </h2>
  );
}

/** How far along the group's tasks are: a bar and "3 of 8 done". */
function GroupProgress({ group }: { readonly group: SearchResultGroup }) {
  if (!group.taskCount) {
    return null;
  }
  return (
    <span class="result-group-progress">
      <ProgressBar done={group.doneCount} total={group.taskCount} />
      <span class="result-group-progress-label">{`${group.doneCount} of ${group.taskCount} done`}</span>
    </span>
  );
}

/**
 * Said when a group holds more than it draws: the tag's group narrows the
 * search to the tag, and the rest can be paged through in Tabs.
 */
function GroupMore({ group }: { readonly group: SearchResultGroup }) {
  const hidden = group.noteCount - group.notes.length + group.taskCount - group.tasks.length;
  if (hidden <= 0) {
    return null;
  }
  if (group.tag) {
    return (
      <p class="result-group-more">
        <button type="button" data-action="facet" data-facet-id={group.tag.facetId} data-clause={group.tag.clause}>
          {`Show all ${describeGroup(group)} in ${group.tag.label}`}
        </button>
      </p>
    );
  }
  return (
    <p class="result-group-more">
      {`${hidden} more not shown. `}
      <button type="button" data-action="set-layout" data-layout="tabs">Page through them in Tabs</button>
    </p>
  );
}

/** One group: its heading, what it holds, its progress, its notes and tasks. */
function ResultGroup({ group, at, firstPosition, snapshot, openedCards, alone }: {
  readonly group: SearchResultGroup;
  readonly at: number;
  /** The first of its cards' positions, which are unique across the page, as their ids are drawn from them. */
  readonly firstPosition: number;
  readonly snapshot: SearchPageSnapshot;
  readonly openedCards: ReadonlySet<string>;
  readonly alone: boolean;
}) {
  const display: CardDisplay = { renderMode: snapshot.renderMode, preview: snapshot.preview, titleDisplay: snapshot.tagTitleDisplayMode };
  const headingId = `result-group-${at}`;
  return (
    <section class="result-group" aria-labelledby={headingId}>
      <div class="result-group-header">
        <GroupHeading group={group} headingId={headingId} alone={alone} />
        <span class="result-group-count">{describeGroup(group)}</span>
        <GroupProgress group={group} />
      </div>
      {group.notes.length
        ? (
          <div class="cards">
            {group.notes.map((card, offset) => (
              <SearchCard key={`${at}:${card.id}`} card={card} position={firstPosition + offset} display={display} opened={openedCards.has(card.id)} />
            ))}
          </div>
        )
        : null}
      {group.tasks.length
        ? <div class="task-list">{group.tasks.map((item) => <TaskListRow key={`${at}:${item.task.id}`} item={item} titleDisplay={snapshot.tagTitleDisplayMode} entry="tasks" />)}</div>
        : null}
      <GroupMore group={group} />
    </section>
  );
}

/** Every group, in Refine's order, then the results under none of its tags. */
export function ResultGroups({ snapshot, openedCards }: { readonly snapshot: SearchPageSnapshot; readonly openedCards: ReadonlySet<string> }) {
  const groups = snapshot.groups ?? [];
  if (!groups.length) {
    return <div class="empty">No notes or tasks match this search.</div>;
  }
  const alone = groups.length === 1 && !groups[0].tag;
  let position = 0;
  return (
    <div class="result-groups">
      {alone ? <p class="result-groups-note">Refine has no tags to group these results by.</p> : null}
      {groups.map((group, at) => {
        const firstPosition = position;
        position += group.notes.length;
        return <ResultGroup key={group.tag ? group.tag.clause : ''} group={group} at={at} firstPosition={firstPosition} snapshot={snapshot} openedCards={openedCards} alone={alone} />;
      })}
    </div>
  );
}
