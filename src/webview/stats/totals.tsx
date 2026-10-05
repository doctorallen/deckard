/**
 * The top of the Stats page: when the index was last refreshed, the totals,
 * and how much is parked.
 */
import type { DeckardStatsSnapshot, StatsTrend } from '../../ui/protocol/stats';
import { Eyebrow } from '../shared/eyebrow';
import { Metric, type MetricTrend } from '../shared/metric';
import { counted } from './model';

/** A moment ago, in words. */
export function describeAge(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return hours + (hours === 1 ? ' hour ago' : ' hours ago');
  }
  const days = Math.round(hours / 24);
  return days + (days === 1 ? ' day ago' : ' days ago');
}

/**
 * The page's title, and when the index was last refreshed: how long ago, in
 * words, as due dates are, with the exact time on hover. "9/20/2026,
 * 7:58:24 PM" asked a reader to subtract it from now. Reindex reads every
 * note again.
 */
export function StatsHeader({ updatedAt, builtAt }: { readonly updatedAt: number; readonly builtAt: number }) {
  return (
    <header>
      <div>
        <Eyebrow trail="STATS" />
        <h1>Workspace Stats</h1>
      </div>
      <p class="updated">
        {updatedAt
          ? ['Index last refreshed: ', <span title={new Date(updatedAt).toLocaleString()}>{describeAge(builtAt - updatedAt)}</span>, ' ']
          : 'Index last refreshed: Not indexed yet '}
        <button type="button" class="reindex" data-action="reindex" data-tip="Read every note again">Reindex</button>
      </p>
    </header>
  );
}

/** A total's twelve weeks, with what its line counts by, for its tip. */
function trendOf(snapshot: DeckardStatsSnapshot, name: keyof DeckardStatsSnapshot['trends'], noun: string): MetricTrend | undefined {
  const trend: StatsTrend | undefined = snapshot.trends && snapshot.trends[name];
  return trend
    ? { points: trend.points, change: trend.change, note: `The line counts ${noun} by the date each note was written, over the last 12 weeks.` }
    : undefined;
}

/** What a tile that is not a search does when it is pressed. */
interface ActionTile {
  readonly label: string;
  readonly value: number;
  readonly action: string;
  readonly hint: string;
  /** Any other attribute its action reads, by name. */
  readonly attributes?: Readonly<Record<string, string>>;
}

/**
 * One tile that opens what it counts without a search: a tag to choose, the
 * graph, or the list further down the page. Nothing to count is a plain
 * number.
 */
function ActionMetric({ label, value, action, hint, attributes }: ActionTile) {
  if (!value) {
    return <Metric label={label} value={value} />;
  }
  return (
    <button
      type="button"
      class="metric metric-open"
      data-action={action}
      {...attributes}
      data-tip={hint}
      aria-label={`${label}, ${value}. ${hint}`}
    >
      <span class="metric-label">{label}</span>
      <strong class="metric-value">{value}</strong>
    </button>
  );
}

/**
 * The totals. A tile that opens what it counts is a button: a search, a tag
 * to choose, the graph, or the list further down the page; the totals were
 * a dead end, even where a page existed that listed exactly what was being
 * counted.
 */
export function StatsMetrics({ snapshot }: { readonly snapshot: DeckardStatsSnapshot }) {
  return (
    <section class="metrics stats-section" aria-label="Index statistics">
      <Metric label="Files" value={snapshot.fileCount} />
      <Metric label="Notes" value={snapshot.sectionCount} query="is:note" hint="Open a search for every note. A heading with tags of its own is a note, with the untagged headings under it, and so is each tagged line, so a file can hold several" trend={trendOf(snapshot, 'notes', 'notes')} />
      <Metric label="Tasks" value={snapshot.taskCount} query="is:task" hint="Open a search for every task" trend={trendOf(snapshot, 'tasks', 'tasks')} />
      <Metric label="Open tasks" value={snapshot.activeTaskCount} query="is:open" hint="Open a search for every open task" trend={trendOf(snapshot, 'openTasks', 'open tasks')} />
      <ActionMetric label="Tags" value={snapshot.tagCount} action="open-tag-list" hint="Choose a tag to open" attributes={{ 'data-namespaced': 'false' }} />
      <ActionMetric label="Namespaced tags" value={snapshot.entityCount} action="open-tag-list" hint="Choose a namespaced tag to open" attributes={{ 'data-namespaced': 'true' }} />
      <ActionMetric label="Links" value={snapshot.wikiLinkCount} action="open-graph" hint="Open the Notes Graph showing only the links you wrote" />
      <ActionMetric label="Unlinked notes" value={snapshot.orphanNoteCount} action="jump" hint="Go to the list of notes nothing links to" attributes={{ 'data-target': 'orphans-heading' }} />
    </section>
  );
}

/** How much is parked, as a search for it; nothing when nothing is. */
export function ParkedLine({ parked }: { readonly parked: DeckardStatsSnapshot['parked'] }) {
  if (!parked) {
    return null;
  }
  const words = `Parked: ${counted(parked.notes, 'note', 'notes')}, ${counted(parked.openTasks, 'open task', 'open tasks')}`;
  return (
    <p class="parked-line">
      <button type="button" class="text-button" data-action="open-search" data-query="is:parked" data-tip="Search everything that is parked">{words}</button>
    </p>
  );
}

/**
 * The checkbox lines no total counts: a `- [/]` or `- [-]` line, as
 * Obsidian writes in-progress and cancelled tasks, is text to Deckard. An
 * Obsidian vault's task count came up short with nothing saying why.
 */
export function OtherCheckboxesLine({ count }: { readonly count: number | undefined }) {
  if (!count) {
    return null;
  }
  return (
    <p class="parked-line">
      {`Not counted: ${counted(count, 'checkbox line', 'checkbox lines')} marked with something other than a space or an x, such as [/] or [-]. Only - [ ] and - [x] lines are tasks.`}
    </p>
  );
}
