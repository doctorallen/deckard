/**
 * The Stats page: an overview of indexed content and recorded local views.
 * Each row and total opens what it counts by posting the message the host
 * projected for it, or a search; the host checks every tag and line
 * against the index as it is now.
 */
import type { StateMessage } from '../../ui/protocol/messaging';
import type { DeckardStatsSnapshot, OpenTagListMessage, StatsMessage, StatsUsedOnceTag } from '../../ui/protocol/stats';
import { type ActionHandler, listenForActions, onHostMessage, readEmbeddedState, startPage } from '../shared/page';
import { rememberScroll, restoreScroll } from '../shared/scroll';
import { installViewOptions } from '../shared/viewOptions';
import { keepState, keptState, post, vscodeApi } from '../shared/vscode';
import { AttentionSection } from './attention';
import { type DrawnStats, ROW_LISTS, type RowList, type StatsState } from './model';
import { movePairFocus, settlePairFocus, TagPairsSection } from './tagPairs';
import { TagUseSection } from './tagUse';
import { OtherCheckboxesLine, ParkedLine, StatsHeader, StatsMetrics, UnknownStatusesLine } from './totals';
import { ViewsSection } from './views';

/** Sends the host one of the messages Stats may send. */
function send(message: StatsMessage): void {
  post(message);
}

/** The whole page, top to bottom: what needs attention first, then the totals and the lists. */
function StatsPage({ state }: { readonly state: DrawnStats }) {
  const snapshot = state.snapshot;
  return (
    <>
      <StatsHeader updatedAt={snapshot.updatedAt} builtAt={snapshot.builtAt} />
      <AttentionSection state={state} />
      <StatsMetrics snapshot={snapshot} />
      <ParkedLine parked={snapshot.parked} />
      <UnknownStatusesLine unknown={snapshot.unknownStatuses} />
      <OtherCheckboxesLine count={snapshot.otherCheckboxes} />
      <ViewsSection state={state} />
      <TagUseSection usage={snapshot.tagUsage} showUsedOnce={state.showUsedOnce} />
      <TagPairsSection data={snapshot.tagPairs} asTable={state.pairsAsTable} />
    </>
  );
}

/**
 * What the page keeps across a hide or a reload, since it is not kept
 * running while hidden: the reader's three choices, and, from
 * `rememberScroll`, where it was scrolled to.
 */
type Choices = Pick<StatsState, 'showAllOrphans' | 'showUsedOnce' | 'pairsAsTable'>;

/** The choices kept from before, each off unless it was kept on. */
function keptChoices(): Choices {
  const kept = keptState();
  return {
    showAllOrphans: kept.showAllOrphans === true,
    showUsedOnce: kept.showUsedOnce === true,
    pairsAsTable: kept.pairsAsTable === true,
  };
}

let scrolled = false;
const store = startPage<StatsState>({
  initial: { snapshot: readEmbeddedState<DeckardStatsSnapshot>(), ...keptChoices() },
  // A state message with no snapshot draws nothing, as the template's render did.
  ready: (state) => Boolean(state.snapshot),
  view: (state) => <StatsPage state={state as DrawnStats} />,
  afterDraw: () => {
    settlePairFocus();
    // The first page drawn goes back to where the reader left it.
    if (scrolled) {
      return;
    }
    scrolled = true;
    restoreScroll(keptState());
  },
});

// ⋯'s menu, and its Appearance and Help rows.
installViewOptions();

/** Draws the page with a choice changed, and keeps the choices for the next time it is drawn. */
function choose(change: Partial<Choices>): void {
  store.update(change);
  const { showAllOrphans, showUsedOnce, pairsAsTable } = store.state;
  keepState({ showAllOrphans, showUsedOnce, pairsAsTable });
}

/** The snapshot the page shows, if it has one yet. */
function shown(): DeckardStatsSnapshot | undefined {
  return store.state.snapshot;
}

/**
 * A row posts the message the host projected for it, so the page never
 * decides what a tag or a line opens; Shift adds that a line opens where
 * `deckard.openNotesIn` does not. A link that opens no note searches for
 * the links to it.
 */
function openRow(row: HTMLElement, event?: MouseEvent | KeyboardEvent): void {
  const missing = row.getAttribute('data-missing-index');
  if (missing !== null) {
    const target = (shown()?.missingLinkTargets || [])[Number(missing)];
    if (target) {
      send({ type: 'openSearch', query: `link = [[${target.name}]]` });
    }
    return;
  }
  const list = row.getAttribute('data-list') as RowList | null;
  const items = list && ROW_LISTS.includes(list) ? shown()?.[list] : undefined;
  const item = items?.[Number(row.getAttribute('data-index'))];
  if (item && item.open) {
    send(item.open.type === 'openSource' && event?.shiftKey ? { ...item.open, opposite: true } : item.open);
  }
}

/** The row an event happened in, if any. */
function findRow(event: Event): HTMLElement | null {
  const target = event.target as Element | null;
  return target && target.closest ? target.closest<HTMLElement>('.stat-row') : null;
}

/** An action on one of the tags used once, given the tag its button names. */
function onUsedOnce(act: (tag: StatsUsedOnceTag, element: HTMLElement) => void): ActionHandler {
  return (element) => {
    const tag = shown()?.tagUsage.usedOnce[Number(element.dataset.index)];
    if (tag) {
      act(tag, element);
    }
  };
}

/** Merge on a tag used once: into its lookalike when it has one, or into a tag the reader chooses. */
function mergeUsedOnce(tag: StatsUsedOnceTag): void {
  if (tag.lookalike) {
    send({ type: 'mergeTags', sourceKey: tag.key, targetKey: tag.lookalike.key });
    return;
  }
  send({ type: 'mergeTagInto', sourceKey: tag.key });
}

/** A pair of lookalike tags, by the index its button carries. */
function lookalikeAt(element: HTMLElement) {
  return shown()?.lookalikeTags[Number(element.dataset.index)];
}

/** Moves focus to the element a control names, and scrolls it to the top. */
function jumpTo(element: HTMLElement): void {
  const target = document.getElementById(String(element.dataset.target));
  if (!target) {
    return;
  }
  target.focus();
  if (target.scrollIntoView) {
    target.scrollIntoView({ block: 'start' });
  }
}

/** Opens a band's tags to choose from: those used from its least to its most, or more with no most. */
function openBand(element: HTMLElement): void {
  const band = shown()?.tagUsage.bands[Number(element.dataset.band)];
  if (!band) {
    return;
  }
  const message: OpenTagListMessage = { type: 'openTagList', namespaced: false, min: band.min };
  if (band.max !== undefined) {
    message.max = band.max;
  }
  send(message);
}

/** Opens the search for a cell's or a list row's two tags. */
function openPair(element: HTMLElement): void {
  const tags = shown()?.tagPairs.tags;
  const left = tags?.[Number(element.dataset.row)];
  const right = tags?.[Number(element.dataset.column)];
  if (left && right) {
    send({ type: 'openSearch', query: `${left[0]} ${right[0]}` });
  }
}

/** Every control's action, by its `data-action`. */
const ACTIONS: Readonly<Record<string, ActionHandler>> = {
  'open-search': (element) => send({ type: 'openSearch', query: element.dataset.query as string }),
  'open-tag-list': (element) => send({ type: 'openTagList', namespaced: element.dataset.namespaced === 'true' }),
  'open-pair': openPair,
  'toggle-pairs-table': () => choose({ pairsAsTable: !store.state.pairsAsTable }),
  'toggle-used-once': () => choose({ showUsedOnce: !store.state.showUsedOnce }),
  'open-tag-band': openBand,
  'open-used-once': onUsedOnce((tag, element) => send({
    type: 'openTag',
    tagKey: element.dataset.side === 'target' && tag.lookalike ? tag.lookalike.key : tag.key,
  })),
  'merge-used-once': onUsedOnce(mergeUsedOnce),
  'merge-used-once-into': onUsedOnce((tag) => send({ type: 'mergeTagInto', sourceKey: tag.key })),
  'open-graph': () => send({ type: 'openNotesGraph', onlyWrittenLinks: true }),
  jump: jumpTo,
  'show-more-orphans': () => {
    choose({ showAllOrphans: true });
    document.querySelector<HTMLElement>('.orphan-list .is-more .stat-row')?.focus();
  },
  reindex: () => send({ type: 'reindexWorkspace' }),
  'open-lookalike': (element) => {
    const pair = lookalikeAt(element);
    if (pair) {
      send({ type: 'openTag', tagKey: element.dataset.side === 'target' ? pair.targetKey : pair.sourceKey });
    }
  },
  'create-missing-note': (element) => {
    const target = (shown()?.missingLinkTargets || [])[Number(element.dataset.index)];
    if (target) {
      send({ type: 'createMissingNotes', names: [target.name] });
    }
  },
  'create-all-missing-notes': () => send({ type: 'createMissingNotes', names: [] }),
  'merge-lookalike': (element) => {
    const pair = lookalikeAt(element);
    if (pair) {
      send({ type: 'mergeTags', sourceKey: pair.sourceKey, targetKey: pair.targetKey });
    }
  },
};

const app = document.getElementById('app') as HTMLElement;
listenForActions(app, ACTIONS, (event) => {
  const row = findRow(event);
  if (row) {
    openRow(row, event);
  }
});
// The arrows walk the grid of pairs; Enter and Space open a row.
app.addEventListener('keydown', (event) => {
  const target = event.target as Element | null;
  const pairCell = target && target.closest ? target.closest<HTMLElement>('.pair-grid .pair-cell') : null;
  if (pairCell && movePairFocus(pairCell, event.key, shown()?.tagPairs.tags.length ?? 0)) {
    event.preventDefault();
    return;
  }
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }
  // Only a row itself: a button in a row, such as Create or Merge, takes
  // its own keys, which the row would otherwise swallow and act on instead.
  const row = findRow(event);
  if (!row || row !== event.target) {
    return;
  }
  event.preventDefault();
  openRow(row, event);
});
onHostMessage<StateMessage<DeckardStatsSnapshot>>('state', (message) => store.update({ snapshot: message.data }));
rememberScroll(keptState, (value) => vscodeApi().setState(value));
