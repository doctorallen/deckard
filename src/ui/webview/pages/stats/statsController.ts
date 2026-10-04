import * as vscode from 'vscode';

import type { PreferenceServices } from '../../../../core/storage/preferences';
import type { IndexReader, IndexScanStatus, IndexUpdates } from '../../../../core/workspace/indexReader';
import { findMissingLinkTargets } from '../../../../domain/index/backlinks';
import { getExtractedNoteFileName } from '../../../../domain/markdown/noteNames';
import type { WorkspaceIndex } from '../../../../domain/model';
import type { NavigationService } from '../../../../services/navigationService';
import type { DeckardStatsSnapshot, StatsPageToHost } from '../../../protocol/stats';
import { createMissingNotes, reportCreatedNotes } from '../../../commands/linkHealth';
import { resolveSourceUri } from '../../../commands/navigation';
import type { MessageHandlers, PageContext, PageController, PageOptions } from '../../host/pageController';
import { goToPage, listGoTo, openGoTo, openSource, openTag } from '../../host/sharedHandlers';
import { getStatsHtml } from '../../statsHtml';
import type { PageChrome } from '../../components';
import { narrowStatsMessage } from './messages';
import { createDeckardStatsSnapshot } from '../../../state/statsState';

/** What the Stats page reads, and whom it asks to open a tag. */
export interface StatsControllerOptions {
  indexer: IndexReader<vscode.Uri> & IndexScanStatus & IndexUpdates;
  /** The blob Stats counts from, and the visits it records. */
  preferences: Pick<PreferenceServices, 'reader' | 'usage'>;
  onOpenTag: (tagKey: string) => void | Promise<void>;
  /** What a row's tag or line may open. */
  navigation: NavigationService;
  /** The extension's folder, which the page's style sheets are under. */
  extensionUri: vscode.Uri;
}

/**
 * The Stats page: an overview of indexed content and recorded local views.
 * Each row opens the tag overview or note entry it counts, if the index
 * still has it, since the page may hold a snapshot from before a tag was
 * renamed or a note was edited.
 */
export class StatsController implements PageController<DeckardStatsSnapshot, StatsPageToHost> {
  public readonly name = 'Stats';
  /**
   * Not kept running while hidden: what the reader chose on the page and
   * where it was scrolled are kept with `setState`, and a hidden page is
   * drawn again from the last snapshot it was sent, which its HTML carries.
   */
  public readonly options: PageOptions = { retainContextWhenHidden: false, enableFindWidget: true, readsInertState: true };
  public readonly narrow = narrowStatsMessage;
  public readonly handlers: MessageHandlers<StatsPageToHost>;

  /** Reads from `stats.indexer` and `stats.preferences`, and opens tags through `stats.onOpenTag`. */
  public constructor(private readonly stats: StatsControllerOptions) {
    const { indexer, navigation } = stats;
    this.handlers = {
      openGoTo: openGoTo(),
      listGoTo: listGoTo({ indexer, current: 'stats' }),
      goToPage: goToPage(),
      openTag: openTag({ indexer, navigation, policy: 'lenient', openTag: (tagKey) => stats.onOpenTag(tagKey) }),
      // A row listing a whole note, such as one nothing links to, opens it
      // without counting a view of one of its entries.
      openSource: openSource({ indexer, navigation, policy: 'notes', usage: stats.preferences.usage }),
      // A total opens the notes and tasks it counted, so the page is a way in
      // rather than a list of numbers.
      openSearch: (message) => vscode.commands.executeCommand('deckard.search', message.query),
      mergeTags: (message) => this.mergeTags(message.sourceKey, message.targetKey),
      // The Tags totals open a tag, chosen from the tags they count.
      openTagList: async (message) => {
        const tagKey = await pickStatsTag(indexer.getSnapshot(), message.namespaced, vscode.window, message);
        if (tagKey) {
          await stats.onOpenTag(tagKey);
        }
      },
      // The Wiki links total counts the links written, which only the graph
      // can show apart from the rest.
      openNotesGraph: () => vscode.commands.executeCommand('deckard.showNotesGraph', { onlyWrittenLinks: true }),
      mergeTagInto: (message) => this.mergeTagInto(message.sourceKey),
      // The page is where staleness shows, so it is also where it is fixed.
      reindexWorkspace: () => vscode.commands.executeCommand('deckard.reindexWorkspace'),
      createMissingNotes: (message) => this.createMissingNotes(message.names),
    };
  }

  /** The Stats page's HTML, carrying `state` for the page to draw at once when given one. */
  public html(webview: vscode.Webview, chrome: PageChrome, state?: DeckardStatsSnapshot): string {
    return getStatsHtml(webview, this.stats.extensionUri, chrome, state);
  }

  /** The totals, trends, and lists, drawn at this moment, which the trends end on. */
  public buildSnapshot(): DeckardStatsSnapshot {
    return createDeckardStatsSnapshot(
      this.stats.indexer.getSnapshot(),
      this.stats.preferences.reader.value,
      this.stats.indexer.getUnreadable(),
      Date.now(),
    );
  }

  /** Stats counts visits, so it redraws when they are recorded. */
  public subscribe(page: PageContext): vscode.Disposable[] {
    return [this.stats.preferences.reader.onDidChange(() => page.refresh())];
  }

  /**
   * A pair that looks alike is merged by the same command the tag list
   * uses, so the merge is confirmed, previewed, and undoable as usual.
   */
  private async mergeTags(source: string, target: string): Promise<void> {
    const index = this.stats.indexer.getSnapshot();
    const sourceTag = this.stats.navigation.resolveTag(index, source, 'lenient');
    const targetTag = this.stats.navigation.resolveTag(index, target, 'lenient');
    if (sourceTag.kind === 'open' && targetTag.kind === 'open' && sourceTag.tagKey !== targetTag.tagKey) {
      await vscode.commands.executeCommand('deckard.mergeTag', sourceTag.tagKey, targetTag.tagKey);
    }
  }

  /**
   * A tag used once with no lookalike is merged into one the reader
   * chooses, by the command that asks for it.
   */
  private async mergeTagInto(source: string): Promise<void> {
    const sourceTag = this.stats.navigation.resolveTag(this.stats.indexer.getSnapshot(), source, 'lenient');
    if (sourceTag.kind === 'open') {
      await vscode.commands.executeCommand('deckard.mergeTag', sourceTag.tagKey);
    }
  }

  /**
   * Makes the notes links name and no note carries. The names are read
   * again from the index as it is now, so only a name still missing and
   * able to be a file name is made; each goes in the notes folder of the
   * workspace folder its first link is in. Creating every one is confirmed
   * first.
   */
  private async createMissingNotes(requested: readonly string[]): Promise<void> {
    const wanted = new Set(requested.map((name) => name.toLocaleLowerCase()));
    const missing = findMissingLinkTargets(this.stats.indexer.getSnapshot()).filter(
      (target) =>
        getExtractedNoteFileName(target.name) !== undefined &&
        (wanted.size === 0 || wanted.has(target.key)),
    );
    if (missing.length === 0) {
      return;
    }
    if (wanted.size === 0 && !(await confirmCreateAll(missing.length))) {
      return;
    }
    const byFolder = new Map<string, { uri: vscode.Uri; names: string[] }>();
    for (const target of missing) {
      const uri = await resolveSourceUri(target.sourcePaths[0]);
      if (!uri) {
        continue;
      }
      const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() ?? '';
      const group = byFolder.get(folder) ?? { uri, names: [] };
      group.names.push(target.name);
      byFolder.set(folder, group);
    }
    if (byFolder.size === 0) {
      return;
    }
    let created = 0;
    for (const group of byFolder.values()) {
      created += await createMissingNotes(this.stats.indexer, group.uri, group.names, { report: false });
    }
    reportCreatedNotes(created);
  }
}

/** Asks before Create all makes a note for each of `count` names. */
async function confirmCreateAll(count: number): Promise<boolean> {
  const create = 'Create';
  const choice = await vscode.window.showWarningMessage(
    `Create ${count} ${count === 1 ? 'note' : 'notes'} for links that open no note?`,
    {
      modal: true,
      detail: 'Each is an empty note named as the links write it, in the notes folder.',
    },
    create,
  );
  return choice === create;
}

/**
 * The tags a Tags total counts, as a quick pick: every tag, or only the
 * namespaced ones, most used first, each with how many entries carry it.
 * Returns the key chosen.
 */
export async function pickStatsTag(
  index: WorkspaceIndex,
  namespaced: boolean,
  window: Pick<typeof vscode.window, 'showQuickPick'> = vscode.window,
  band: { min?: number; max?: number } = {},
): Promise<string | undefined> {
  const items = listStatsTags(index, namespaced, band);
  const choice = await window.showQuickPick(items, {
    title: describePick(namespaced, band),
    placeHolder: namespaced ? 'Choose a namespaced tag to open' : 'Choose a tag to open',
    matchOnDescription: true,
  });
  return choice?.tagKey;
}

/** The rows of that quick pick. */
export function listStatsTags(
  index: WorkspaceIndex,
  namespaced: boolean,
  band: { min?: number; max?: number } = {},
): (vscode.QuickPickItem & { tagKey: string })[] {
  const rows = namespaced
    ? [...index.entities.values()].map((entity) => ({ key: entity.key, label: entity.label, count: entity.count }))
    : [...index.tags.values()].map((tag) => ({ key: tag.key, label: tag.label, count: tag.count }));
  return rows
    .filter((row) => (band.min === undefined || row.count >= band.min) && (band.max === undefined || row.count <= band.max))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .map((row) => ({
      label: row.label,
      description: `${row.count} ${row.count === 1 ? 'entry' : 'entries'}`,
      tagKey: row.key,
    }));
}

/** The quick pick's title: the band it lists, or which tags. */
function describePick(namespaced: boolean, band: { min?: number; max?: number }): string {
  if (band.min !== undefined) {
    return describeBand(band);
  }
  return namespaced ? 'Namespaced tags' : 'Tags';
}

/** A band of tag use, as a title: "Tags used 3–5 times". */
function describeBand(band: { min?: number; max?: number }): string {
  const { min = 1, max } = band;
  if (max === min) {
    return describeOnce(min);
  }
  return max === undefined ? `Tags used ${min} or more times` : `Tags used ${min}–${max} times`;
}

/** A band of one count, as a title: "Tags used once", "twice", or "3 times". */
function describeOnce(count: number): string {
  if (count === 1) {
    return 'Tags used once';
  }
  return count === 2 ? 'Tags used twice' : `Tags used ${count} times`;
}
