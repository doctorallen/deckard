/**
 * What the Notes Graph says in words: its status line, and what a node is
 * joined by in the tooltip.
 */
import { type GraphSettings, type GraphState, isRendered, type ViewNode } from './model';

/**
 * The status line: the group let go and the search's matches, when there
 * are any, then, with Only links I wrote, how many wiki links are drawn and
 * how many nodes have none; otherwise the notes, tasks, links drawn of all
 * the graph holds, and groups.
 */
export function describeStatus(state: GraphState, settings: GraphSettings): string {
  const snapshot = state.snapshot as NonNullable<GraphState['snapshot']>;
  const { edges, nodes } = state;
  const visibleEdgeCount = edges.filter((edge) =>
    edge.drawn && isRendered(state, settings, edge.a) && isRendered(state, settings, edge.b)).length;
  const matchCount = state.matchSet ? Object.keys(state.matchSet).length : -1;
  const searchNote = (state.groupNotice ? state.groupNotice + ' · ' : '') + (matchCount >= 0
    ? matchCount + (matchCount === 1 ? ' match' : ' matches') + ' · '
    : '');
  if (settings.onlyWrittenLinks) {
    const linked: Record<number, true> = {};
    edges.forEach((edge) => {
      if (!edge.drawn) {
        return;
      }
      linked[edge.a] = true;
      linked[edge.b] = true;
    });
    let without = 0;
    nodes.forEach((node, index) => {
      if (node.kind !== 'tag' && !linked[index]) {
        without += 1;
      }
    });
    return searchNote + visibleEdgeCount +
      (visibleEdgeCount === 1 ? ' wiki link · ' : ' wiki links · ') +
      without + (without === 1 ? ' node with none' : ' nodes with none');
  }
  const indexed = snapshot.edgeCount === undefined ? snapshot.edges.length : snapshot.edgeCount;
  const { communityCount } = state;
  return searchNote + snapshot.totalNoteCount + ' notes · ' +
    snapshot.totalTaskCount + ' tasks · ' + visibleEdgeCount + ' of ' +
    indexed + ' links drawn · ' +
    communityCount + (communityCount === 1 ? ' group' : ' groups');
}

/** "1 wiki link", "4 wiki links"; nothing for none. */
function countWords(count: number | undefined, one: string, many: string): string {
  return count ? count + ' ' + (count === 1 ? one : many) : '';
}

/**
 * What a node is joined to, by kind, from the index's counts:
 * "atlas.md:12 · 4 wiki links · 2 headings · 7 tags".
 */
export function describeNode(node: ViewNode): string {
  const links = node.links || {};
  const parts: string[] = [];
  if (node.kind === 'tag') {
    parts.push('Tag');
    if (links.tag) {
      parts.push('on ' + countWords(links.tag, 'note or task', 'notes and tasks'));
    }
    if (links.related) {
      parts.push(countWords(links.related, 'related tag', 'related tags'));
    }
  } else {
    if (node.kind === 'task') {
      parts.push('Task');
    }
    const fileName = node.filePath ? node.filePath.split('/').pop() : '';
    parts.push(fileName + ':' + node.line);
    [
      countWords(links.wiki, 'wiki link', 'wiki links'),
      countWords(links.heading, 'heading', 'headings'),
      countWords(links.tag, 'tag', 'tags'),
    ].forEach((words) => {
      if (words) {
        parts.push(words);
      }
    });
  }
  if (!links.wiki && !links.heading && !links.tag && !links.related) {
    parts.push('No links');
  }
  return parts.join(' · ');
}
