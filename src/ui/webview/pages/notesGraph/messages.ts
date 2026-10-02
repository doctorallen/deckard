/**
 * The Notes Graph's narrowing table: what each message the page may send
 * must hold. The host still checks each node, line, and tag against the
 * index as it is now.
 */
import type {
  NotesGraphPageToHost,
  NotesGraphSelectNodeMessage,
  NotesGraphSetFilterMessage,
  NotesGraphSetScopeMessage,
} from '../../../protocol/notesGraph';
import {
  Narrower,
  NarrowingTable,
  narrowOpenSource,
  narrowOpenTag,
  narrowWith,
  onlyType,
} from '../../host/narrowing';
import { MAXIMUM_LOCAL_GRAPH_DEPTH } from '../../../../domain/graph/localGraph';

/** A node to select, by any non-empty id; the host finds it in the graph. */
const narrowSelectNode: Narrower<NotesGraphSelectNodeMessage> = (value) =>
  typeof value.nodeId === 'string' && value.nodeId.length > 0
    ? { type: 'selectNode', nodeId: value.nodeId }
    : undefined;

/**
 * The whole workspace or a neighborhood, a whole number of hops out within
 * the deepest the graph draws, and whether daily notes are passed through
 * when the page says.
 */
const narrowSetGraphScope: Narrower<NotesGraphSetScopeMessage> = (value) =>
  typeof value.local === 'boolean' &&
  typeof value.depth === 'number' &&
  Number.isInteger(value.depth) &&
  value.depth >= 1 &&
  value.depth <= MAXIMUM_LOCAL_GRAPH_DEPTH &&
  (value.skipPeriodic === undefined || typeof value.skipPeriodic === 'boolean')
    ? {
        type: 'setGraphScope',
        local: value.local,
        depth: value.depth,
        ...(typeof value.skipPeriodic === 'boolean' ? { skipPeriodic: value.skipPeriodic } : {}),
      }
    : undefined;

/** Which kinds of node the page shows: both kinds, each said. */
const narrowSetGraphFilter: Narrower<NotesGraphSetFilterMessage> = (value) =>
  typeof value.showNotes === 'boolean' && typeof value.showTasks === 'boolean'
    ? { type: 'setGraphFilter', showNotes: value.showNotes, showTasks: value.showTasks }
    : undefined;

/** Each message the Notes Graph may send, and what it must hold. */
export const NOTES_GRAPH_MESSAGES: NarrowingTable<NotesGraphPageToHost> = {
  openSource: narrowOpenSource,
  selectNode: narrowSelectNode,
  clearSelection: onlyType('clearSelection'),
  setGraphScope: narrowSetGraphScope,
  openTag: narrowOpenTag,
  setGraphFilter: narrowSetGraphFilter,
};

/** A message from the Notes Graph, narrowed by its table, or undefined. */
export const narrowNotesGraphMessage = narrowWith(NOTES_GRAPH_MESSAGES);
