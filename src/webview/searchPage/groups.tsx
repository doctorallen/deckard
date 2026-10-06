/**
 * The hierarchy: what a search found, under each tag Refine offers. In the
 * tabs layout the Notes tab groups the notes and the Tasks tab the tasks,
 * with how far along each group's tasks are; side by side, each group is one
 * row, its notes beside its tasks, so the two line up.
 */
import { formatProgressCount } from '../../domain/tasks/progressCount';
import type { SearchPageSnapshot, SearchResultGroup } from '../../ui/protocol/searchPage';
import { ProgressBar } from '../shared/progressBar';
import { ProgressText } from '../shared/progressText';
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

/** Where a group sits: its depth, which names its heading's level, and the id its heading is drawn with. */
interface GroupPlace {
  readonly depth: number;
  readonly id: string;
}

/** What the results under no group are called: by tag, none of Refine's tags; by heading, no tagged heading. */
function looseName(snapshot: SearchPageSnapshot, alone: boolean): string {
  if (alone) {
    return 'Results';
  }
  if (snapshot.hierarchy !== 'headings') {
    return 'Under none of these tags';
  }
  // On a tag's page, what is under the tag's own heading and no part of it.
  return snapshot.tag ? 'Not in any part' : 'Under no tagged heading';
}

/**
 * The group's name: its tag, which narrows the search to it as Refine's
 * value does, or a plain heading for the results under none of the tags.
 * A part's heading is a level below its project's.
 */
function GroupHeading({ group, place, looseLabel }: { readonly group: SearchResultGroup; readonly place: GroupPlace; readonly looseLabel: string }) {
  const Heading = (['h2', 'h3', 'h4'] as const)[Math.min(place.depth, 2)];
  if (!group.tag) {
    return <Heading id={place.id} class="result-group-heading">{looseLabel}</Heading>;
  }
  return (
    <Heading id={place.id} class="result-group-heading">
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
    </Heading>
  );
}

/** How far along the group's tasks are, its parts' among them: a bar and "3/8 done (38%)". */
function GroupProgress({ group }: { readonly group: SearchResultGroup }) {
  if (!group.progressTotal) {
    return null;
  }
  return (
    <span class="result-group-progress">
      <ProgressBar done={group.doneCount} total={group.progressTotal} />
      <span class="result-group-progress-label"><ProgressText text={formatProgressCount(group.doneCount, group.progressTotal)} /></span>
    </span>
  );
}

/** The group's name, what it holds, and, on the Tasks tab, its progress; side by side the progress heads the tasks' column. */
function GroupHeader({ group, part, place, looseLabel }: { readonly group: SearchResultGroup; readonly part: GroupPart; readonly place: GroupPlace; readonly looseLabel: string }) {
  return (
    <div class="result-group-header">
      <GroupHeading group={group} place={place} looseLabel={looseLabel} />
      <span class="result-group-count">{describeGroup(group, part)}</span>
      {part === 'tasks' ? <GroupProgress group={group} /> : null}
    </div>
  );
}

/**
 * Said when a group holds more of its own than it draws: the tag's group
 * narrows the search to the tag, and the rest can be listed ungrouped.
 */
function GroupMore({ group, part }: { readonly group: SearchResultGroup; readonly part: GroupPart }) {
  const hiddenNotes = part === 'tasks' ? 0 : (group.ownNoteCount ?? group.noteCount) - group.notes.length;
  const hiddenTasks = part === 'notes' ? 0 : (group.ownTaskCount ?? group.taskCount) - group.tasks.length;
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

/** What the notes and tasks of every group are drawn with, and the next card's position, unique across the page as card ids are drawn from it. */
interface GroupView {
  readonly snapshot: SearchPageSnapshot;
  readonly openedCards: ReadonlySet<string>;
  readonly looseLabel: string;
  readonly positions: { next: number };
}

/** A group's note cards. */
function GroupNotes({ group, place, view }: { readonly group: SearchResultGroup; readonly place: GroupPlace; readonly view: GroupView }) {
  const { snapshot, openedCards } = view;
  if (!group.notes.length) {
    return null;
  }
  const display: CardDisplay = { renderMode: snapshot.renderMode, preview: snapshot.preview, titleDisplay: snapshot.tagTitleDisplayMode };
  const first = view.positions.next;
  view.positions.next += group.notes.length;
  return (
    <div class="cards">
      {group.notes.map((card, offset) => (
        <SearchCard key={`${place.id}:${card.id}`} card={card} position={first + offset} display={display} opened={openedCards.has(card.id)} />
      ))}
    </div>
  );
}

/** A group's task rows. */
function GroupTasks({ group, place, snapshot }: { readonly group: SearchResultGroup; readonly place: GroupPlace; readonly snapshot: SearchPageSnapshot }) {
  if (!group.tasks.length) {
    return null;
  }
  return <div class="task-list">{group.tasks.map((item) => <TaskListRow key={`${place.id}:${item.task.id}`} item={item} titleDisplay={snapshot.tagTitleDisplayMode} entry="tasks" />)}</div>;
}

/**
 * One group, showing its notes, its tasks, or both, the notes beside the
 * tasks, then the parts inside it, each a group of its own.
 */
function ResultGroup({ group, part, place, view }: {
  readonly group: SearchResultGroup;
  readonly part: GroupPart;
  readonly place: GroupPlace;
  readonly view: GroupView;
}) {
  const notes = part === 'tasks' ? null : <GroupNotes group={group} place={place} view={view} />;
  const tasks = part === 'notes' ? null : <GroupTasks group={group} place={place} snapshot={view.snapshot} />;
  const children = (group.children ?? []).filter((child) => holds(child, part));
  // The only group, when nothing could be grouped, would only repeat the tab
  // over it: its results are drawn with no header.
  const alone = view.looseLabel === 'Results';
  return (
    <section class={place.depth ? 'result-group is-part' : 'result-group'} {...(alone ? {} : { 'aria-labelledby': place.id })}>
      {alone ? null : <GroupHeader group={group} part={part} place={place} looseLabel={view.looseLabel} />}
      {part === 'both'
        ? (
          <div class="result-group-columns">
            <div class="result-group-column">{notes}</div>
            <div class="result-group-column"><GroupProgress group={group} />{tasks}</div>
          </div>
        )
        : notes || tasks}
      <GroupMore group={group} part={part} />
      {children.length
        ? (
          <div class="result-subgroups">
            {children.map((child, at) => (
              <ResultGroup key={child.tag ? child.tag.clause : ''} group={child} part={part} place={{ depth: place.depth + 1, id: `${place.id}-${at}` }} view={view} />
            ))}
          </div>
        )
        : null}
    </section>
  );
}

/**
 * Every group with something of the part shown, in Refine's order or nested
 * by heading, then the results under none of them; nothing when no group
 * has any.
 */
export function ResultGroups({ snapshot, openedCards, part }: { readonly snapshot: SearchPageSnapshot; readonly openedCards: ReadonlySet<string>; readonly part: GroupPart }) {
  const all = snapshot.groups ?? [];
  const groups = all.filter((group) => holds(group, part));
  if (!groups.length) {
    return null;
  }
  const alone = all.length === 1 && !all[0].tag;
  const view: GroupView = { snapshot, openedCards, looseLabel: looseName(snapshot, alone), positions: { next: 0 } };
  const note = snapshot.hierarchy === 'headings' ? 'None of these results is under a tagged heading.' : 'Refine has no tags to group these results by.';
  return (
    <div class="result-groups">
      {alone ? <p class="result-groups-note">{note}</p> : null}
      {groups.map((group) => {
        const at = all.indexOf(group);
        return <ResultGroup key={group.tag ? group.tag.clause : ''} group={group} part={part} place={{ depth: 0, id: `result-group-${part}-${at}` }} view={view} />;
      })}
    </div>
  );
}
