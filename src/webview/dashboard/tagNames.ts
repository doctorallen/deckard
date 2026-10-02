/**
 * How the Tags tab reads its tags: each tag's namespace and the name it is
 * shown by, and which tags a search and a namespace filter leave showing.
 * A key is read with the domain's tag-key reader, as the host reads it.
 */
import { formatKeyWords, readTagNamespace } from '../../domain/markdown/tagKeys';
import type { DashboardTag } from '../../ui/protocol/dashboard';

/** The namespace filter's choice for tags with no namespace. A namespace never contains "/", so it cannot clash with one. */
export const NO_TAG_NAMESPACE = '/';

/** The namespace of a #namespace/name tag, as written in its key; an @ tag names a person. Empty for none. */
export function tagNamespaceOf(tag: Pick<DashboardTag, 'key'>): string {
  const key = String(tag.key || '');
  if (key.startsWith('@')) {
    return 'person';
  }
  return readTagNamespace(key) ?? '';
}

/** A tag's name and its namespace, as its row shows them: dashes and underscores as spaces. */
export function formatTagDisplay(tag: DashboardTag): { name: string; namespace: string } {
  const label = String(tag.label || tag.key || '');
  const labelValue = label.replace(/^[@#]/, '');
  const name = labelValue.slice(labelValue.lastIndexOf('/') + 1).replace(/[-_]+/g, ' ');
  const namespace = tagNamespaceOf(tag).replace(/[-_]+/g, ' ');
  return { name: name || label, namespace };
}

/** What the Tags tab shows of its tags, for a search and a namespace filter. */
export interface TagFilter {
  /** The namespaces the tags are written under, A to Z. */
  readonly namespaces: string[];
  readonly hasTagsWithoutNamespace: boolean;
  /** The namespace the filter holds, or empty when it holds none or one no tag uses any more. */
  readonly activeNamespace: string;
  /** The namespace filter's words, such as `Project` or `None`, or empty for none. */
  readonly namespaceLabel: string;
  /** The search as matched: trimmed and in lower case. */
  readonly query: string;
  /** The tags the search and the filter leave showing, in the host's order. */
  readonly shown: DashboardTag[];
}

/**
 * Which tags a search and a namespace filter leave showing. A namespace no
 * tag uses any more, after a rename, shows every tag.
 */
export function filterTags(tags: readonly DashboardTag[], search: string, namespaceFilter: string): TagFilter {
  const query = search.trim().toLowerCase();
  const namespaces = Array.from(new Set(tags.map(tagNamespaceOf).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right));
  const hasTagsWithoutNamespace = tags.some((tag) => !tagNamespaceOf(tag));
  const activeNamespace = namespaces.includes(namespaceFilter) || (namespaceFilter === NO_TAG_NAMESPACE && hasTagsWithoutNamespace)
    ? namespaceFilter
    : '';
  const wanted = activeNamespace === NO_TAG_NAMESPACE ? '' : activeNamespace;
  const shown = tags.filter((tag) =>
    (!activeNamespace || tagNamespaceOf(tag) === wanted) &&
    (!query || `${tag.label} ${tag.key}`.toLowerCase().includes(query)));
  let namespaceLabel = '';
  if (activeNamespace) {
    namespaceLabel = activeNamespace === NO_TAG_NAMESPACE ? 'None' : formatKeyWords(activeNamespace);
  }
  return { namespaces, hasTagsWithoutNamespace, activeNamespace, namespaceLabel, query, shown };
}
