/**
 * Needs attention: what needs doing, first, and only what has rows: notes
 * that could not be read, links that open no note, tags that look alike,
 * notes nothing links to. With none, one line says the workspace is in
 * order.
 */
import type { ComponentChildren } from 'preact';

import type { StatsMissingLink, StatsUnreadableItem, TagMergeCandidate } from '../../ui/protocol/stats';
import { TagLabel } from '../shared/tagLabel';
import { counted, type DrawnStats, ORPHANS_SHOWN } from './model';
import { AccessList } from './views';

/** A panel's heading: its title with how many it holds, and a control beside it, if any. */
function PanelHeading({ title, count, id, action }: {
  readonly title: string;
  readonly count: number;
  readonly id?: string;
  readonly action?: ComponentChildren;
}) {
  const text = `${title} (${count})`;
  const tabIndex = id ? -1 : undefined;
  return action
    ? <h3 class="with-action" id={id} tabIndex={tabIndex}><span>{text}</span>{action}</h3>
    : <h3 id={id} tabIndex={tabIndex}>{text}</h3>;
}

/** "And 12 more.", under a list that shows only some of what it counts. */
function AndMore({ count }: { readonly count: number }) {
  return count > 0 ? <p class="empty">{`And ${count} more.`}</p> : null;
}

/**
 * Notes the workspace has that the index does not. A note the index does
 * not have looks, from a search, like a note that was never written, so it
 * is said here, with why, where a reader will look.
 */
function UnreadablePanel({ notes }: { readonly notes: readonly StatsUnreadableItem[] }) {
  const one = notes.length === 1;
  const detail = `${notes.length}${one ? ' note is' : ' notes are'} in the workspace but not in the index, so no search finds ${one ? 'it' : 'them'}. Fix the cause, then reindex.`;
  return (
    <article class="view-panel unreadable">
      <PanelHeading title="Notes Deckard could not read" count={notes.length} />
      <p class="detail">{detail}</p>
      <ol class="list">
        {notes.map((note, index) => (
          <li>
            <div class="row stat-row" role="button" tabIndex={0} data-tip="Open this note" data-list="unreadable" data-index={index}>
              <div>
                <div class="label">{note.filePath}</div>
                <div class="detail">{note.reason}</div>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}

/** The notes a missing name's links are in, in words: "2 links from standup and plan". */
export function describeSources(target: StatsMissingLink): string {
  const names = target.sources.slice();
  const more = target.sourceCount - names.length;
  if (more > 0) {
    names.push(`${more} more ${more === 1 ? 'note' : 'notes'}`);
  }
  let list = names.join('');
  if (names.length === 2) {
    list = `${names[0]} and ${names[1]}`;
  } else if (names.length > 2) {
    list = `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  }
  return `${counted(target.count, 'link', 'links')} from ${list}`;
}

/**
 * Names links write that no note carries. A row opens the search for the
 * links; Create makes the note, and Create all makes every one.
 */
function MissingLinksPanel({ targets, total }: { readonly targets: readonly StatsMissingLink[]; readonly total: number }) {
  const createAll = targets.some((target) => target.creatable)
    ? <button type="button" class="merge" data-action="create-all-missing-notes" data-tip="Create a note for every name links write that no note carries">Create all</button>
    : null;
  return (
    <article class="view-panel">
      <PanelHeading title="Links that open no note" count={total || targets.length} action={createAll} />
      <ol class="list">
        {targets.map((target, index) => (
          <li>
            <div class="row stat-row" role="button" tabIndex={0} data-missing-index={index} data-tip="Search for the links to it">
              <div>
                <div class="label">{target.name}</div>
                <div class="detail">{describeSources(target) + (target.creatable ? '' : ' · cannot be a file name')}</div>
              </div>
              {target.creatable
                ? <button type="button" class="merge" data-action="create-missing-note" data-index={index} aria-label={`Create ${target.name}`} data-tip={`Create an empty note named ${target.name} in the notes folder`}>Create</button>
                : null}
            </div>
          </li>
        ))}
      </ol>
      <AndMore count={(total || 0) - targets.length} />
    </article>
  );
}

/** One side of a pair of tags, which opens that tag in a search page. */
function PairTag({ index, side, label, action }: { readonly index: number; readonly side?: 'source' | 'target'; readonly label: string; readonly action: string }) {
  return (
    <button type="button" class="tag-open pair-tag" data-action={action} data-index={index} data-side={side} data-tip="Open this tag in a search page">
      <TagLabel label={label} />
    </button>
  );
}

/**
 * Two tags that look like one idea spelled twice, pointing from the rarer
 * spelling to the one the workspace already uses. Merge hands both keys to
 * the host, which confirms the merge the way the tag list does.
 */
function LookalikePanel({ pairs, total }: { readonly pairs: readonly TagMergeCandidate[]; readonly total: number }) {
  return (
    <article class="view-panel">
      <PanelHeading title="Tags that look alike" count={total} />
      <ol class="list">
        {pairs.map((pair, index) => {
          const merge = `Merge ${pair.sourceLabel} into ${pair.targetLabel}`;
          return (
            <li>
              <div class="row stat-row">
                <div>
                  <div class="label pair">
                    <PairTag index={index} side="source" label={pair.sourceLabel} action="open-lookalike" />
                    <span class="pair-arrow" aria-hidden="true">→</span>
                    <PairTag index={index} side="target" label={pair.targetLabel} action="open-lookalike" />
                  </div>
                  <div class="detail">{pair.detail}</div>
                </div>
                <button type="button" class="merge" data-action="merge-lookalike" data-index={index} data-tip={merge} aria-label={merge}>Merge</button>
              </div>
            </li>
          );
        })}
      </ol>
      <AndMore count={total - pairs.length} />
    </article>
  );
}

/** Notes no other note links to: the first ten, then the rest sent on request. */
function OrphanPanel({ state }: { readonly state: DrawnStats }) {
  const { orphanNotes, orphanNoteCount } = state.snapshot;
  const unlisted = orphanNoteCount - orphanNotes.length;
  const hidden = orphanNotes.length - ORPHANS_SHOWN;
  return (
    <article class="view-panel">
      <PanelHeading title="Notes nothing links to" count={orphanNoteCount} id="orphans-heading" />
      <AccessList name="orphanNotes" items={orphanNotes} empty="" hint="Open note" shown={ORPHANS_SHOWN} showAll={state.showAllOrphans} />
      {hidden > 0 && !state.showAllOrphans
        ? <button type="button" class="show-more" data-action="show-more-orphans">{`Show ${hidden} more`}</button>
        : null}
      {state.showAllOrphans || hidden <= 0 ? <AndMore count={unlisted} /> : null}
    </article>
  );
}

/** Needs attention, first on the page: each panel that has rows, or one line saying none does. */
export function AttentionSection({ state }: { readonly state: DrawnStats }) {
  const snapshot = state.snapshot;
  const unreadable = snapshot.unreadable || [];
  const missing = snapshot.missingLinkTargets || [];
  // Keyed, so a panel that comes or goes never hands its elements to
  // another kind of panel, whose heading would keep an emptied id.
  const panels = [
    unreadable.length ? <UnreadablePanel key="unreadable" notes={unreadable} /> : null,
    missing.length ? <MissingLinksPanel key="missing" targets={missing} total={snapshot.missingLinkTargetCount} /> : null,
    snapshot.lookalikeTags.length ? <LookalikePanel key="lookalike" pairs={snapshot.lookalikeTags} total={snapshot.lookalikeTagCount} /> : null,
    snapshot.orphanNotes.length ? <OrphanPanel key="orphans" state={state} /> : null,
  ].filter(Boolean);
  return (
    <section class="stats-section attention" aria-labelledby="attention-heading">
      <h2 id="attention-heading">Needs attention</h2>
      {panels.length
        ? <div class="views">{panels}</div>
        : <p class="attention-clear">Nothing needs attention: every note was read, every link opens a note, no two tags look alike, and every note is linked from another.</p>}
    </section>
  );
}
