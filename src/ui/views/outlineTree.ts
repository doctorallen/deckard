import * as vscode from 'vscode';

import { Debouncer } from '../../shared/debounce';
import { isMarkdownFile } from '../../core/workspace/scanner';
import { measure } from '../../shared/timing';
import { settingTarget, writeSetting } from '../commands/settings';
import type { IndexReader, IndexUpdates } from '../../core/workspace/indexReader';
import {
  buildOutline,
  collectOutlineTags,
  describeOutlineCounts,
  filterOutline,
  findOutlineNodeAt,
  formatOutlineDescription,
  formatOutlineTags,
  mapOutlineParents,
  OutlineNode,
} from '../state/outlineState';
import { getBacklinkIndex } from '../../domain/index/backlinks';
import { revealLine } from '../commands/navigation';
import { reportFailure } from '../commands/notify';

/** Context key backing the follow-cursor toggle in the view title. */
export const outlineFollowCursorContextKey = 'deckard.outlineFollowCursor';
/** Context key for whether the Outline shows only the headings with a tag. */
export const outlineFilteredContextKey = 'deckard.outlineFiltered';

const noDocumentMessage = 'Open a Markdown file to see its outline.';
const noHeadingsMessage = 'This file has no headings.';
const unreadableMessage = 'Deckard could not read this file.';
const rebuildDelayMs = 200;
const followCursorDelayMs = 100;

/** The settings that change what the Outline shows, so a change rebuilds it. */
const OUTLINE_SETTINGS = [
  'deckard.outline',
  'deckard.zenMode',
  'deckard.personMarker',
  'deckard.entityNamespaceAliases',
];

/**
 * Shows the active Markdown file's headings as a tree the reader can pull into
 * either sidebar.
 *
 * The tree is built from editor text rather than the workspace index, which
 * only updates on save, so the outline keeps up with typing the way VS Code's
 * own outline does. Tags are lifted out of each heading and shown beside it.
 */
export class OutlineTreeProvider
  implements vscode.TreeDataProvider<OutlineNode>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<
    OutlineNode | undefined
  >();
  public readonly onDidChangeTreeData = this.changeEmitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private view: vscode.TreeView<OutlineNode> | undefined;
  private roots: OutlineNode[] = [];
  /** Every heading of the note, before any tag filter. */
  private allRoots: OutlineNode[] = [];
  private parents = new Map<string, OutlineNode>();
  private documentUri: vscode.Uri | undefined;
  private readonly pendingRebuild = new Debouncer(rebuildDelayMs);
  private readonly pendingFollow = new Debouncer(followCursorDelayMs);
  private rebuildPending = false;
  /**
   * The tag the Outline is narrowed to, kept across notes until it is
   * cleared or the window reloads.
   */
  private tagFilter: { key: string; label: string } | undefined;

  /**
   * Starts listening at once to the active editor, its text, its saves and
   * cursor, the index, and the Outline's settings.
   */
  public constructor(private readonly indexer: IndexReader & IndexUpdates) {
    this.disposables.push(this.changeEmitter);
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.rebuildNow()),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === vscode.window.activeTextEditor?.document) {
          this.scheduleRebuild();
        }
      }),
    );
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (document === vscode.window.activeTextEditor?.document) {
          this.rebuildNow();
        }
      }),
    );
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.scheduleFollowCursor();
        }
      }),
    );
    // Links into a heading are counted from the index, which moves on save.
    this.disposables.push(indexer.onDidUpdate(() => this.scheduleRebuild()));
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!OUTLINE_SETTINGS.some((section) => event.affectsConfiguration(section))) {
          return;
        }
        void syncOutlineFollowCursorContext();
        this.rebuildNow();
      }),
    );
  }

  /**
   * Binds the created view so the provider can set its message and reveal nodes.
   */
  public attach(view: vscode.TreeView<OutlineNode>): void {
    this.view = view;
    this.disposables.push(
      view.onDidChangeVisibility((event) => {
        if (event.visible && this.rebuildPending) {
          this.rebuildNow();
        }
      }),
    );
    this.rebuildNow();
  }

  /**
   * A heading's row: its tags and counts beside it as the settings say, its
   * full text in the tooltip, and a click that reveals it in the editor.
   */
  public getTreeItem(node: OutlineNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    const tags = formatOutlineTags(node);
    item.id = node.id;
    item.description =
      formatOutlineDescription(node, { tags: this.areTagsShown(), counts: this.areCountsShown() }) ||
      undefined;
    item.tooltip = createTooltip(node, tags);
    item.iconPath = new vscode.ThemeIcon('symbol-string');
    item.contextValue =
      node.tags.length > 0 ? 'deckardOutlineTagged' : 'deckardOutlineHeading';
    item.command = {
      command: 'deckard.outline.revealSection',
      title: 'Reveal Heading',
      arguments: [node],
    };
    return item;
  }

  /** The tags written on the current note's headings, for the filter. */
  public listTags(): { key: string; label: string }[] {
    return collectOutlineTags(this.allRoots);
  }

  /** The tag the Outline is narrowed to, if any. */
  public get filter(): { key: string; label: string } | undefined {
    return this.tagFilter;
  }

  /** Narrows the Outline to the headings that carry a tag, or clears it. */
  public setTagFilter(tag: { key: string; label: string } | undefined): void {
    this.tagFilter = tag;
    void vscode.commands.executeCommand('setContext', outlineFilteredContextKey, tag !== undefined);
    this.rebuildNow();
  }

  /**
   * What the Context view's Sections list draws: the headings shown, the
   * filter narrowing them, and every tag the note's headings carry.
   */
  public readSections(): { roots: readonly OutlineNode[]; documentUri?: vscode.Uri; filter?: { key: string; label: string }; tags: { key: string; label: string }[] } {
    return { roots: this.roots, documentUri: this.documentUri, filter: this.tagFilter, tags: this.listTags() };
  }

  /** Opens the heading on a line of the note the sections are read from. */
  public async revealLine(line: number): Promise<void> {
    const find = (nodes: readonly OutlineNode[]): OutlineNode | undefined => {
      for (const node of nodes) {
        const found = node.line === line ? node : find(node.children);
        if (found) {
          return found;
        }
      }
      return undefined;
    };
    const node = find(this.allRoots);
    if (node) {
      await this.revealSection(node);
    }
  }

  /** The headings under a heading, or the top-level headings shown. */
  public getChildren(node?: OutlineNode): OutlineNode[] {
    return node ? node.children : this.roots;
  }

  /**
   * Required for reveal: a node the view cannot walk upward from is never shown.
   */
  public getParent(node: OutlineNode): OutlineNode | undefined {
    return this.parents.get(node.id);
  }

  /**
   * Opens the heading without changing the document.
   *
   * Navigation uses the document URI rather than an indexed path so a Markdown
   * file outside the configured notes folder still opens from the outline.
   */
  public async revealSection(node: OutlineNode): Promise<void> {
    if (!this.documentUri) {
      return;
    }

    try {
      const document = await vscode.workspace.openTextDocument(
        this.documentUri,
      );
      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
      });
      revealLine(editor, node.line);
    } catch (error) {
      void reportFailure({ outcome: 'Deckard could not open that heading.', error });
    }
  }

  /**
   * Releases timers and listeners so a late rebuild cannot outlive the view.
   */
  public dispose(): void {
    this.pendingRebuild.dispose();
    this.pendingFollow.dispose();
    this.view = undefined;
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  /**
   * Rebuilds after a pause so a burst of keystrokes reparses the file once.
   */
  private scheduleRebuild(): void {
    if (this.view && !this.view.visible) {
      this.rebuildPending = true;
      return;
    }
    this.pendingRebuild.schedule(() => this.rebuild());
  }

  /**
   * Rebuilds at once, dropping any rebuild waiting for typing to pause; a
   * hidden view only notes that it is owed one.
   */
  private rebuildNow(): void {
    this.pendingRebuild.cancel();
    if (this.view && !this.view.visible) {
      this.rebuildPending = true;
      return;
    }
    this.rebuild();
  }

  /**
   * Reparses the active editor's text and republishes the whole tree.
   *
   * A full refresh is cheaper than tracking which headings moved, and the
   * stable node ids mean the view keeps its expanded rows across one.
   */
  private rebuild(): void {
    this.rebuildPending = false;
    const document = vscode.window.activeTextEditor?.document;
    if (!document || !isMarkdownFile(document.uri)) {
      this.publish([], undefined, noDocumentMessage);
      return;
    }

    try {
      const roots = measure(
        'Outline',
        () =>
          buildOutline(this.indexer.parse(document.uri, document.getText()), {
            personMarker: vscode.workspace
              .getConfiguration('deckard', document.uri)
              .get<string>('personMarker'),
            inheritedTags: this.areInheritedTagsShown(document.uri),
            backlinks: getBacklinkIndex(this.indexer.getSnapshot()),
            filePath: this.indexer.getFilePath(document.uri),
          }),
        () => `${document.lineCount} lines`,
      );
      this.allRoots = roots;
      const shown = this.tagFilter ? filterOutline(roots, this.tagFilter.key) : roots;
      this.publish(shown, document.uri, describeOutlineMessage(roots, shown, this.tagFilter));
      void this.followCursor();
    } catch {
      this.publish([], undefined, unreadableMessage);
    }
  }

  /**
   * Replaces the tree and the view's message, and fires one change for the
   * whole tree. With no document, the unfiltered headings are forgotten too.
   */
  private publish(
    roots: OutlineNode[],
    documentUri: vscode.Uri | undefined,
    message: string | undefined,
  ): void {
    this.roots = roots;
    this.parents = mapOutlineParents(roots);
    this.documentUri = documentUri;
    if (!documentUri) {
      this.allRoots = [];
    }
    if (this.view) {
      this.view.message = message;
      this.view.description = this.tagFilter?.label;
    }
    this.changeEmitter.fire(undefined);
  }

  /**
   * Follows the cursor after a pause so a held arrow key does not thrash reveal.
   */
  private scheduleFollowCursor(): void {
    this.pendingFollow.schedule(() => void this.followCursor());
  }

  /**
   * Selects the heading the cursor is under, when the view is visible, the
   * setting is on, and the active editor is the note the tree was built from.
   */
  private async followCursor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (
      !this.view?.visible ||
      !editor ||
      !this.documentUri ||
      !isOutlineFollowCursorEnabled() ||
      editor.document.uri.toString() !== this.documentUri.toString()
    ) {
      return;
    }

    const node = findOutlineNodeAt(
      this.roots,
      editor.selection.active.line + 1,
    );
    if (!node) {
      return;
    }

    try {
      await this.view.reveal(node, {
        select: true,
        focus: false,
        expand: true,
      });
    } catch {
      // The tree changed while revealing; the next rebuild resynchronizes it.
    }
  }

  /** Whether headings show their tags beside them, from `deckard.outline.showTags`. */
  private areTagsShown(): boolean {
    return vscode.workspace
      .getConfiguration('deckard')
      .get<boolean>('outline.showTags', true);
  }

  /** Counts are hidden in zen, like the reference counts above headings. */
  private areCountsShown(): boolean {
    const configuration = vscode.workspace.getConfiguration('deckard');
    return (
      configuration.get<boolean>('outline.showCounts', true) &&
      !configuration.get<boolean>('zenMode', false)
    );
  }

  /**
   * Whether a heading lists the tags it inherits from the headings and front
   * matter above it, from `deckard.outline.inheritedTags` for the note's folder.
   */
  private areInheritedTagsShown(uri: vscode.Uri): boolean {
    return vscode.workspace
      .getConfiguration('deckard', uri)
      .get<boolean>('outline.inheritedTags', false);
  }
}

/**
 * Reads the follow-cursor setting that both the view and its toggle share.
 */
export function isOutlineFollowCursorEnabled(): boolean {
  return vscode.workspace
    .getConfiguration('deckard')
    .get<boolean>('outline.followCursor', true);
}

/**
 * Publishes the setting as a context key so the title shows the current state.
 */
export async function syncOutlineFollowCursorContext(): Promise<void> {
  await vscode.commands.executeCommand(
    'setContext',
    outlineFollowCursorContextKey,
    isOutlineFollowCursorEnabled(),
  );
}

/**
 * Turns following on or off where the value in force is set: the
 * workspace's settings when they set it, else the user's. It was always
 * written to the user's, so in a workspace that set it the toggle wrote,
 * nothing changed, and the title kept offering the same button.
 */
export async function setOutlineFollowCursor(enabled: boolean): Promise<void> {
  const written = await writeSetting('outline.followCursor', enabled, settingTarget('outline.followCursor'));
  if (written) {
    await syncOutlineFollowCursorContext();
  }
}

/**
 * Chooses which of a heading's tags an action applies to.
 *
 * A heading usually carries one tag, so the picker only appears when the
 * choice is real.
 */
export async function pickOutlineTag(
  node: OutlineNode | undefined,
  placeHolder: string,
): Promise<string | undefined> {
  const tags = node?.tags ?? [];
  if (tags.length === 0) {
    return undefined;
  }
  if (tags.length === 1) {
    return tags[0].key;
  }

  const choice = await vscode.window.showQuickPick(
    tags.map((tag) => ({ label: tag.label, key: tag.key })),
    { placeHolder },
  );
  return choice?.key;
}

/**
 * What the view says above the tree: that the note has no headings, that
 * none carries the tag it is narrowed to, or nothing when headings are shown.
 */
function describeOutlineMessage(
  roots: readonly OutlineNode[],
  shown: readonly OutlineNode[],
  filter: { label: string } | undefined,
): string | undefined {
  if (roots.length === 0) {
    return noHeadingsMessage;
  }
  if (shown.length === 0 && filter) {
    return `No heading in this note carries ${filter.label}.`;
  }
  return undefined;
}

/**
 * Describes the heading in full, including the tags the label leaves out.
 */
function createTooltip(node: OutlineNode, tags: string): string {
  const lines = [`${'#'.repeat(node.level)} ${node.label}`];
  if (tags) {
    lines.push(tags);
  }
  lines.push(...describeOutlineCounts(node));
  lines.push(`Line ${node.line}`);
  return lines.join('\n');
}
