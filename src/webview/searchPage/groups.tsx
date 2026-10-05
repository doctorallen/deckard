/**
 * The hierarchy: what a search found, under each tag Refine offers. In the
 * tabs layout the Notes tab groups the notes and the Tasks tab the tasks,
 * with how far along each group's tasks are; side by side, each group is one
 * row, its notes beside its tasks, so the two line up.
 */
import type { SearchPageSnapshot, SearchResultGroup } from '../../ui/protocol/searchPage';
import { ProgressBar } from '../shared/progressBar';
import { type CardDisplay, SearchCard } from '../shared/searchCard';
import { TagLabel } from '../shared/tagLabel';
import { TaskListRow } from '../shared/taskRow';

/** Which of a group's results a place on the page shows. */
type GroupPart = 'notes' | 'tasks' | 'both';

/** "1 note", "4 tasks". */
function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** What a group holds of the part shown, "4 notes · 6 tasks", leaving out a kind it has none of. */
function describeGroup(group: SearchResultGroup, part: GroupPart): string {
  return [
    part !== 'tasks' && group.noteCount ? countOf(group.noteCount, 'note') : '',
    part !== 'notes' && group.taskCount ? countOf(group.taskCount, 'task') : '',
  ].filter(Boolean).join(' · ');
}

/** Whether a group has anything of the part shown. */
function holds(group: SearchResultGroup, part: GroupPart): boolean {
  if (part === 'notes') {
    return group.noteCount > 0;
  }
  return part === 'tasks' ? group.taskCount > 0 : group.noteCount + group.taskCount > 0;
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

/** The group's name, what it holds, and, where its tasks are shown, their progress. */
function GroupHeader({ group, part, headingId, alone }: { readonly group: SearchResultGroup; readonly part: GroupPart; readonly headingId: string; readonly alone: boolean }) {
  return (
    <div class="result-group-header">
      <GroupHeading group={group} headingId={headingId} alone={alone} />
      <span class="result-group-count">{describeGroup(group, part)}</span>
      {part === 'notes' ? null : <GroupProgress group={group} />}
    </div>
  );
}

/**
 * Said when a group holds more than it draws: the tag's group narrows the
 * search to the tag, and the rest can be listed ungrouped.
 */
function GroupMore({ group, part }: { readonly group: SearchResultGroup; readonly part: GroupPart }) {
  const hiddenNotes = part === 'tasks' ? 0 : group.noteCount - group.notes.length;
  const hiddenTasks = part === 'notes' ? 0 : group.taskCount - group.tasks.length;
  if (hiddenNotes + hiddenTasks <= 0) {
    return null;
  }
  if (group.tag) {
    return (
      <p class="result-group-more">
        <button type="button" data-action="facet" data-facet-id={group.tag.facetId} data-clause={group.tag.clause}>
          {`Show all ${describeGroup(group, part)} in ${group.tag.label}`}
        </button>
      </p>
    );
  }
  return (
    <p class="result-group-more">
      {`${hiddenNotes + hiddenTasks} more not shown. `}
      <button type="button" data-action="set-hierarchy" data-value="off">Show the results ungrouped</button>
    </p>
  );
}

/** What the notes and tasks of every group are drawn with. */
interface GroupView {
  readonly snapshot: SearchPageSnapshot;
  readonly openedCards: ReadonlySet<string>;
}

/** A group's note cards, their positions unique across the page, as their ids are drawn from them. */
function GroupNotes({ group, at, firstPosition, view }: { readonly group: SearchResultGroup; readonly at: number; readonly firstPosition: number; readonly view: GroupView }) {
  const { snapshot, openedCards } = view;
  if (!group.notes.length) {
    return null;
  }
  const display: CardDisplay = { renderMode: snapshot.renderMode, preview: snapshot.preview, titleDisplay: snapshot.tagTitleDisplayMode };
  return (
    <div class="cards">
      {group.notes.map((card, offset) => (
        <SearchCard key={`${at}:${card.id}`} card={card} position={firstPosition + offset} display={display} opened={openedCards.has(card.id)} />
      ))}
    </div>
  );
}

/** A group's task rows. */
function GroupTasks({ group, at, snapshot }: { readonly group: SearchResultGroup; readonly at: number; readonly snapshot: SearchPageSnapshot }) {
  if (!group.tasks.length) {
    return null;
  }
  return <div class="task-list">{group.tasks.map((item) => <TaskListRow key={`${at}:${item.task.id}`} item={item} titleDisplay={snapshot.tagTitleDisplayMode} entry="tasks" />)}</div>;
}

/** One group, showing its notes, its tasks, or both, the notes beside the tasks. */
function ResultGroup({ group, at, part, firstPosition, view, alone }: {
  readonly group: SearchResultGroup;
  readonly at: number;
  readonly part: GroupPart;
  readonly firstPosition: number;
  readonly view: GroupView;
  readonly alone: boolean;
}) {
  const headingId = `result-group-${part}-${at}`;
  const notes = part === 'tasks' ? null : <GroupNotes group={group} at={at} firstPosition={firstPosition} view={view} />;
  const tasks = part === 'notes' ? null : <GroupTasks group={group} at={at} snapshot={view.snapshot} />;
  return (
    <section class="result-group" aria-labelledby={headingId}>
      <GroupHeader group={group} part={part} headingId={headingId} alone={alone} />
      {part === 'both'
        ? <div class="result-group-columns"><div class="result-group-column">{notes}</div><div class="result-group-column">{tasks}</div></div>
        : notes || tasks}
      <GroupMore group={group} part={part} />
    </section>
  );
}

/**
 * Every group with something of the part shown, in Refine's order, then the
 * results under none of its tags; nothing when no group has any.
 */
export function ResultGroups({ snapshot, openedCards, part }: { readonly snapshot: SearchPageSnapshot; readonly openedCards: ReadonlySet<string>; readonly part: GroupPart }) {
  const all = snapshot.groups ?? [];
  const groups = all.filter((group) => holds(group, part));
  if (!groups.length) {
    return null;
  }
  const alone = all.length === 1 && !all[0].tag;
  const view = { snapshot, openedCards };
  let position = 0;
  return (
    <div class="result-groups">
      {alone ? <p class="result-groups-note">Refine has no tags to group these results by.</p> : null}
      {groups.map((group) => {
        const at = all.indexOf(group);
        const firstPosition = position;
        position += part === 'tasks' ? 0 : group.notes.length;
        return <ResultGroup key={group.tag ? group.tag.clause : ''} group={group} at={at} part={part} firstPosition={firstPosition} view={view} alone={alone} />;
      })}
    </div>
  );
}
