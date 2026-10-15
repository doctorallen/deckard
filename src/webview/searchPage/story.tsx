/**
 * The story so far (docs/implementation/40-story-so-far.md): a tag's page's
 * Story tab, every line about the tag on one timeline, under its months,
 * newest first unless Oldest first is on. Each row is its day, a mark for
 * its kind, the line as written, cut to two lines, with the lines indented
 * under it smaller after it, and, muted at its right, the heading it is
 * under. A task's box is its mark, and completes it as the board's does;
 * selecting a row opens its line. The filters are a row of chips, which
 * Zen leaves drawn: they are what the tab shows, not controls to quiet.
 */
import type { SearchPageStory, SearchPageStoryRow, StoryKind } from '../../ui/protocol/searchPage';
import { TaskBox } from '../shared/taskBox';
import { TaskTitle } from '../shared/taskTitle';

/** What a kind's mark is, and what it says to a screen reader and in its tip. */
const KIND_MARKS: Readonly<Record<StoryKind, { mark: string; label: string }>> = {
  decision: { mark: 'D', label: 'Decision' },
  done: { mark: '✓', label: 'Done' },
  open: { mark: '☐', label: 'Open task' },
  question: { mark: '?', label: 'Question' },
  note: { mark: '·', label: 'Note' },
};

/** What each filter's chip says it does, for its tip. */
const FILTER_TIPS: Readonly<Record<SearchPageStory['filters'][number]['id'], string>> = {
  all: 'Show every line',
  decisions: 'Show only the decisions',
  done: 'Show only the tasks done',
  questions: 'Show only the questions',
};

/** The filters, then Oldest first, as one row of toggle chips. */
function StoryFilters({ story }: { readonly story: SearchPageStory }) {
  return (
    <div class="story-filters" role="group" aria-label="Filter the story">
      {story.filters.map((filter) => (
        <button
          key={filter.id}
          type="button"
          class={filter.active ? 'story-chip is-active' : 'story-chip'}
          data-action="story-filter"
          data-filter={filter.id}
          aria-pressed={filter.active === true}
          data-tip={FILTER_TIPS[filter.id]}
        >
          {filter.label}
        </button>
      ))}
      <button
        key="order"
        type="button"
        class={story.oldestFirst ? 'story-chip story-order is-active' : 'story-chip story-order'}
        data-action="story-order"
        aria-pressed={story.oldestFirst === true}
        data-tip={story.oldestFirst ? 'Show the newest lines first' : 'Show the oldest lines first'}
      >
        Oldest first
      </button>
    </div>
  );
}

/** A row's mark: a task's box, which completes it, or its kind's letter. */
function StoryMark({ row }: { readonly row: SearchPageStoryRow }) {
  if (row.task) {
    return <TaskBox taskId={row.task.id} completed={row.task.completed} status={row.task.status} title={row.task.title} className="story-box" />;
  }
  const kind = KIND_MARKS[row.kind];
  return <span class="story-kind" role="img" aria-label={kind.label} data-tip={kind.label}>{kind.mark}</span>;
}

/** One row: its day, its mark, its line and the lines under it, and where it is. */
function StoryRow({ row }: { readonly row: SearchPageStoryRow }) {
  return (
    <li class={row.task?.completed ? 'story-row is-done' : 'story-row'} data-kind={row.kind} data-file-path={row.filePath} data-line={row.line} tabIndex={0}>
      <span class="story-day">{row.day}</span>
      <span class="story-mark">
        <StoryMark row={row} />
      </span>
      <span class="story-body">
        <span class="story-text"><TaskTitle tokens={row.tokens} tags={row.tags} /></span>
        {row.children
          ? (
            <span class="story-children">
              {row.children.map((child, at) => (
                <span key={at} class="story-child">
                  {child.mark ? <span class="story-child-mark" aria-hidden="true">{`${child.mark} `}</span> : null}
                  <TaskTitle tokens={child.tokens} tags={child.tags} />
                </span>
              ))}
            </span>
          )
          : null}
      </span>
      <span class="story-where">{row.where}</span>
    </li>
  );
}

/** What the tab says with no rows to draw: none at all, or none the filter keeps. */
function emptyStory(story: SearchPageStory): string {
  if (story.count === 0) {
    return 'No lines about this tag yet.';
  }
  return 'No lines match this filter.';
}

/**
 * The tab: its filters, then each month's heading and rows, then Show
 * more while the filter keeps rows past those drawn.
 */
export function StoryTab({ story }: { readonly story: SearchPageStory }) {
  const drawn = story.months.reduce((count, month) => count + month.rows.length, 0);
  const more = story.total - drawn;
  return (
    <div class="story">
      <StoryFilters story={story} />
      {story.months.length
        ? story.months.map((month) => (
          <section key={month.label} class="story-month" aria-label={month.label}>
            <h3 class="story-month-heading">{month.label}</h3>
            <ol class="story-rows">{month.rows.map((row) => <StoryRow key={`${row.filePath}:${row.line}`} row={row} />)}</ol>
          </section>
        ))
        : <div class="empty">{emptyStory(story)}</div>}
      {more > 0
        ? <p class="story-more"><button type="button" class="story-more-link" data-action="story-more" data-tip={`${more} more ${more === 1 ? 'line' : 'lines'}`}>Show more</button></p>
        : null}
    </div>
  );
}
