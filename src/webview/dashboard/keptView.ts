/**
 * What the Dashboard keeps with `setState`, and reads back from what VS Code
 * kept: the tab shown, the tag columns, the Tags tab's search and namespace
 * filter, whether Home is being arranged, and whether its hint was put away
 * (row 22 of docs/architecture/inventories/persisted-formats.md).
 *
 * The record a release wrote must keep reopening the page it was written
 * from, so each field is read as the template read it: the tab only as
 * `browse`, the columns only as 1 to 4, the filter only as a string, the
 * two flags as anything truthy. The Tags tab's search is written, and never
 * read back; the host keeps the search the page draws.
 */
import type { DashboardColumnCount } from '../../ui/protocol/dashboard';
import { keptState, vscodeApi } from '../shared/vscode';
import type { DashboardView } from './model';

/** The fields of the view the page keeps. */
type KeptFields = Pick<DashboardView, 'mode' | 'tagColumns' | 'browseQuery' | 'tagNamespaceFilter' | 'editingHome' | 'homeHintDismissed'>;

/** The tag columns a kept value names, or nothing for a value that is not 1 to 4. */
function readColumns(value: unknown): DashboardColumnCount | undefined {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : undefined;
}

/** The view the page starts from, from what VS Code kept for it, field by field. */
export function readKeptView(): KeptFields {
  const kept = keptState();
  return {
    mode: kept.dashboardMode === 'browse' ? 'browse' : 'home',
    tagColumns: readColumns(kept.tagColumns),
    // The search is written but never read back.
    browseQuery: '',
    tagNamespaceFilter: typeof kept.tagNamespaceFilter === 'string' ? kept.tagNamespaceFilter : '',
    editingHome: Boolean(kept.editingHome),
    homeHintDismissed: Boolean(kept.homeHintDismissed),
  };
}

/**
 * Keeps the view's presentation state, so a data refresh keeps the tab shown:
 * the whole record each time, in the order the template wrote it.
 */
export function keepView(view: DashboardView): void {
  vscodeApi().setState({
    dashboardMode: view.mode,
    tagColumns: view.tagColumns,
    browseQuery: view.browseQuery,
    tagNamespaceFilter: view.tagNamespaceFilter,
    editingHome: view.editingHome,
    homeHintDismissed: view.homeHintDismissed,
  });
}
