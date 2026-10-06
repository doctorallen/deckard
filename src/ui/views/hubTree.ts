import * as vscode from 'vscode';

import { onIndexUpdateInTurn, VIEW_PRIORITY, ViewUpdateSource } from '../../core/workspace/publishing';
import { measure } from '../../shared/timing';
import { buildHubTree, HubTreeNode } from '../state/hubTree';
import { WorkspaceIndex } from '../../domain/model';
import { speakRow } from './spokenRow';

/** What the tree reads from the indexer: its snapshots, when they change, and where each note is. */
export interface HubTreeIndexSource extends ViewUpdateSource {
  getSnapshot(): WorkspaceIndex;
  getUri(filePath: string): vscode.Uri | undefined;
}

/**
 * The Hubs view: each tag namespace with a hub note, its hubs, and under
 * each the notes about its tag or that name it in `up:`, as Notion's sidebar
 * keeps pages under the pages they belong to. Selecting a hub opens its
 * tag's search page, and its inline button opens the hub note itself;
 * selecting any other note opens it.
 */
export class HubTreeProvider implements vscode.TreeDataProvider<HubTreeNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<HubTreeNode | undefined>();
  public readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [this.changeEmitter];
  private view: vscode.TreeView<HubTreeNode> | undefined;
  private roots: HubTreeNode[] | undefined;

  /** Redraws after each index update, in a turn of its own. */
  public constructor(private readonly indexer: HubTreeIndexSource) {
    this.disposables.push(
      onIndexUpdateInTurn(
        indexer,
        { name: 'Hubs', priority: () => (this.view?.visible ? VIEW_PRIORITY.visible : VIEW_PRIORITY.hidden) },
        () => {
          this.roots = undefined;
          this.changeEmitter.fire(undefined);
        },
      ),
    );
  }

  /** The view this provider fills, which says whether it is on screen. */
  public attach(view: vscode.TreeView<HubTreeNode>): void {
    this.view = view;
  }

  /** The namespaces at the top, or a row's notes. */
  public getChildren(node?: HubTreeNode): HubTreeNode[] {
    if (node) {
      return node.children;
    }
    this.roots ??= measure(
      'Hubs',
      () => buildHubTree(this.indexer.getSnapshot(), Date.now()),
      (roots) => `${roots.length} groups`,
    );
    return this.roots;
  }

  /** A row: a namespace, open; a hub, with its progress and Open tag page; a note that opens. */
  public getTreeItem(node: HubTreeNode): vscode.TreeItem {
    let state = vscode.TreeItemCollapsibleState.None;
    if (node.kind === 'namespace') {
      state = vscode.TreeItemCollapsibleState.Expanded;
    } else if (node.children.length) {
      state = vscode.TreeItemCollapsibleState.Collapsed;
    }
    const item = new vscode.TreeItem(node.label, state);
    item.id = node.id;
    item.description = node.description;
    const spoken = speakRow(node.label, node.description);
    if (spoken) {
      item.accessibilityInformation = spoken;
    }
    if (node.kind === 'namespace') {
      item.contextValue = 'hubNamespace';
      return item;
    }
    const uri = node.filePath ? this.indexer.getUri(node.filePath) : undefined;
    item.resourceUri = uri;
    item.contextValue = node.tagKey ? 'hubNote' : 'hubChild';
    item.iconPath = new vscode.ThemeIcon(node.tagKey ? 'tag' : 'note');
    item.tooltip = node.filePath;
    if (node.tagKey) {
      item.command = { title: 'Open Tag Page', command: 'deckard.showTagOverview', arguments: [node.tagKey] };
    } else if (uri) {
      // Where the reader reads notes, the editor or the note page.
      item.command = { title: 'Open', command: 'deckard.openNote', arguments: [node.filePath] };
    }
    return item;
  }

  /** Stops listening. */
  public dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }
}
