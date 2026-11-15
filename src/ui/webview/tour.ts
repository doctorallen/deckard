import * as vscode from 'vscode';

import { formatLocalDate } from '../../domain/notes/periodicNotes';
import {
  hasLineWithAll,
  lineChanged,
  lineHolding,
  readTourProgress,
  resolveTourPath,
  TOUR_SCENES,
  type TourOpen,
  type TourProgress,
  type TourScene,
} from '../state/tour';
import { pageRegistry } from './host/pageRegistry';

/** The context key that is set while the Tour is being presented, for its keys. */
export const TOUR_PRESENTING_KEY = 'deckard.tourPresenting';
/** Where the Tour keeps its place, in the sample's workspace state. */
const PROGRESS_KEY = 'deckard.tour.progress';
/** Whether Help closes while presenting, in Deckard's global state. */
const HIDE_HELP_KEY = 'deckard.tour.hideHelp';
/** The command that ends presenting, which the status bar item's tooltip links. */
const END_PRESENTING = 'deckard.tour.endPresenting';
/** When a page a scene opened is rung, in milliseconds after it opens: a page takes a moment to draw. */
const RING_AFTER = [400, 1200, 2500];

/** What the Tour needs from around it. */
export interface TourServiceOptions {
  workspaceState: vscode.Memento;
  globalState: vscode.Memento;
  /** The work sample's folder name, which the Tour runs in. */
  sampleFolderName: string;
  /** Shows Help beside the page, on its Tour tab. */
  showHelp(): Promise<void>;
  /** Closes Help, while presenting with Help hidden. */
  closeHelp(): void;
}

/** What Help's Tour tab is drawn from. */
export interface TourState {
  inSample: boolean;
  /** Whether a scene has been opened since the window opened. */
  started: boolean;
  progress: TourProgress;
  presenting: boolean;
  hideHelp: boolean;
}

/**
 * Runs the Tour (plan 48, section 4): opens each scene's page beside Help,
 * rings what it points at, watches for its step to be done, and, while
 * presenting, keeps a status bar item and the keys that move it on. Its
 * place is kept with the sample.
 */
export class TourService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Fires when anything the Tour tab draws changed. */
  public readonly onDidChange = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [this.changeEmitter];
  private readonly decoration: vscode.TextEditorDecorationType;
  private progress: TourProgress;
  private started = false;
  private presenting = false;
  private statusItem: vscode.StatusBarItem | undefined;
  /** The text of the scene's watched file when the scene began, for a `changed` step. */
  private baseline: string | undefined;
  private checkTimer: ReturnType<typeof setTimeout> | undefined;
  private ringTimers: Array<ReturnType<typeof setTimeout>> = [];

  /** Reads where the Tour was, and starts watching the sample's notes for each step. */
  public constructor(private readonly options: TourServiceOptions) {
    this.progress = readTourProgress(options.workspaceState.get(PROGRESS_KEY));
    this.decoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
      border: '1px solid',
      borderColor: new vscode.ThemeColor('focusBorder'),
      overviewRulerColor: new vscode.ThemeColor('focusBorder'),
      overviewRulerLane: vscode.OverviewRulerLane.Full,
    });
    this.disposables.push(
      this.decoration,
      vscode.workspace.onDidChangeTextDocument((event) => this.checkSoon(event.document.uri)),
      vscode.workspace.onDidSaveTextDocument((document) => this.checkSoon(document.uri)),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor) {
          return;
        }
        this.checkOpened(editor.document.uri);
        this.decorate(editor);
      }),
    );
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
    this.disposables.push(watcher, watcher.onDidChange((uri) => this.checkSoon(uri)), watcher.onDidCreate((uri) => this.checkSoon(uri)));
  }

  /** What the Tour tab is drawn from now. */
  public get state(): TourState {
    return {
      inSample: this.sampleRoot() !== undefined,
      started: this.started,
      progress: this.progress,
      presenting: this.presenting,
      hideHelp: this.options.globalState.get(HIDE_HELP_KEY) === true,
    };
  }

  /** The sample's folder, when the window has it open. */
  public sampleRoot(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.find((folder) => folder.name === this.options.sampleFolderName || folder.uri.path.endsWith(`/${this.options.sampleFolderName}`))?.uri;
  }

  /** Opens Help on the Tour. */
  public async open(): Promise<void> {
    await this.options.showHelp();
  }

  /** Shows a scene: opens its page beside Help, rings what it points at, and starts watching its step. */
  public async go(index: number): Promise<void> {
    const root = this.sampleRoot();
    if (!root || index < 0 || index >= TOUR_SCENES.length) {
      return;
    }
    this.started = true;
    await this.setProgress({ ...this.progress, scene: index });
    const scene = TOUR_SCENES[index];
    this.clearRings();
    this.baseline = scene.done.kind === 'changed' ? await this.readSampleFile(root, scene.done.file) : undefined;
    await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    for (const open of scene.open) {
      await this.openPart(root, open);
    }
    this.ringPage(scene);
    this.updateStatus();
    this.changeEmitter.fire();
  }

  /** The next scene; past the last, presenting stops. */
  public async next(): Promise<void> {
    const next = this.progress.scene + 1;
    if (next >= TOUR_SCENES.length) {
      if (this.presenting) {
        await this.stopPresenting();
      }
      return;
    }
    await this.go(next);
  }

  /** The scene before, if there is one. */
  public async previous(): Promise<void> {
    if (this.progress.scene > 0) {
      await this.go(this.progress.scene - 1);
    }
  }

  /** Rings the scene's page again. */
  public async again(): Promise<void> {
    await this.go(this.progress.scene);
  }

  /** Ticks or clears a scene's step by hand. */
  public async tick(id: string, on: boolean): Promise<void> {
    const done = new Set(this.progress.done);
    if (on) {
      done.add(id);
    } else {
      done.delete(id);
    }
    await this.setProgress({ ...this.progress, done: [...done] });
    this.changeEmitter.fire();
  }

  /** The scene's Do it: runs its command, or shows the hover or the lightbulb on its words. */
  public async doIt(): Promise<void> {
    const scene = TOUR_SCENES[this.progress.scene];
    const action = scene.do;
    if (!action) {
      return;
    }
    if (action.kind === 'command') {
      await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
      await vscode.commands.executeCommand(action.command);
    } else {
      const root = this.sampleRoot();
      const opened = scene.open.find((part): part is Extract<TourOpen, { kind: 'note' }> => part.kind === 'note');
      if (!root || !opened) {
        return;
      }
      const editor = await this.showNote(root, opened.file, action.text);
      if (!editor) {
        return;
      }
      await vscode.commands.executeCommand(action.kind === 'hover' ? 'editor.action.showHover' : 'editor.action.quickFix');
    }
    if (scene.done.kind === 'tick') {
      await this.tick(scene.id, true);
    }
  }

  /** Whether Help closes while presenting. */
  public async setHideHelp(on: boolean): Promise<void> {
    await this.options.globalState.update(HIDE_HELP_KEY, on);
    this.changeEmitter.fire();
  }

  /** Starts presenting the scenes, from the first. */
  public async present(): Promise<void> {
    if (!this.sampleRoot()) {
      return;
    }
    this.presenting = true;
    await vscode.commands.executeCommand('setContext', TOUR_PRESENTING_KEY, true);
    if (this.state.hideHelp) {
      this.options.closeHelp();
    }
    await this.go(0);
  }

  /** Stops presenting. */
  public async stopPresenting(): Promise<void> {
    this.presenting = false;
    await vscode.commands.executeCommand('setContext', TOUR_PRESENTING_KEY, false);
    this.statusItem?.dispose();
    this.statusItem = undefined;
    this.changeEmitter.fire();
  }

  /** The scene's talking point, for a presenter who asks, in a message only they read. */
  public showTalkingPoint(): void {
    const scene = TOUR_SCENES[this.progress.scene];
    void vscode.window.showInformationMessage(`${scene.title}: ${scene.note}`);
  }

  /** Ends the Tour: rings and the line's mark go, and presenting stops. */
  public async end(): Promise<void> {
    this.started = false;
    this.clearRings();
    vscode.window.visibleTextEditors.forEach((editor) => editor.setDecorations(this.decoration, []));
    if (this.presenting) {
      await this.stopPresenting();
    }
    this.changeEmitter.fire();
  }

  /** Stops every ring, watcher, and the status bar item. */
  public dispose(): void {
    this.clearRings();
    clearTimeout(this.checkTimer);
    this.statusItem?.dispose();
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }

  private async setProgress(progress: TourProgress): Promise<void> {
    this.progress = progress;
    await this.options.workspaceState.update(PROGRESS_KEY, progress);
  }

  /** A file of the sample, as `{today}` or a path from its folder. */
  private sampleUri(root: vscode.Uri, file: string): vscode.Uri {
    return vscode.Uri.joinPath(root, ...resolveTourPath(file, formatLocalDate(new Date())).split('/'));
  }

  private async readSampleFile(root: vscode.Uri, file: string): Promise<string | undefined> {
    const uri = this.sampleUri(root, file);
    const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
    if (open) {
      return open.getText();
    }
    try {
      return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch {
      return undefined;
    }
  }

  /** Opens one part of a scene: a note at a line, in the first group, or a command there. */
  private async openPart(root: vscode.Uri, open: TourOpen): Promise<void> {
    if (open.kind === 'note') {
      await this.showNote(root, open.file, open.at);
      return;
    }
    await vscode.commands.executeCommand(open.command, ...(open.args ?? []));
  }

  /** Shows a note of the sample in the first group, at the line holding `at`, with the scene's line marked. */
  private async showNote(root: vscode.Uri, file: string, at?: string): Promise<vscode.TextEditor | undefined> {
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(this.sampleUri(root, file));
    } catch {
      return undefined;
    }
    const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
    if (at) {
      const line = document.getText().split(/\r?\n/).findIndex((text) => text.toLowerCase().includes(at.toLowerCase()));
      if (line >= 0) {
        const column = document.lineAt(line).text.toLowerCase().indexOf(at.toLowerCase());
        const position = new vscode.Position(line, Math.max(0, column));
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    }
    this.decorate(editor);
    return editor;
  }

  /** Marks the scene's line in an editor showing its note, and no line elsewhere. */
  private decorate(editor: vscode.TextEditor): void {
    const scene = TOUR_SCENES[this.progress.scene];
    const ring = scene.ring;
    const root = this.sampleRoot();
    const note = scene.open.find((part): part is Extract<TourOpen, { kind: 'note' }> => part.kind === 'note');
    if (!this.started || ring?.kind !== 'line' || !root || !note || editor.document.uri.toString() !== this.sampleUri(root, note.file).toString()) {
      editor.setDecorations(this.decoration, []);
      return;
    }
    const lines = editor.document.getText().split(/\r?\n/);
    const line = lines.findIndex((text) => text.toLowerCase().includes(ring.text.toLowerCase()));
    editor.setDecorations(this.decoration, line < 0 ? [] : [new vscode.Range(line, 0, line, lines[line].length)]);
  }

  /** Rings what a scene points at on its page, a few times while the page draws. */
  private ringPage(scene: TourScene): void {
    const ring = scene.ring;
    if (ring?.kind !== 'page') {
      return;
    }
    const message = { type: 'spotlight' as const, hold: true, ...(ring.id ? { id: ring.id } : {}), ...(ring.text ? { text: ring.text } : {}) };
    this.ringTimers = RING_AFTER.map((delay) => setTimeout(() => pageRegistry.broadcast(message), delay));
  }

  private clearRings(): void {
    this.ringTimers.forEach(clearTimeout);
    this.ringTimers = [];
    pageRegistry.broadcast({ type: 'spotlight' });
  }

  private checkSoon(uri: vscode.Uri): void {
    if (!this.started || uri.scheme !== 'file') {
      return;
    }
    clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => void this.checkDone(), 300);
  }

  /** Ticks the scene's step when its file now shows it done. */
  private async checkDone(): Promise<void> {
    const root = this.sampleRoot();
    const scene = TOUR_SCENES[this.progress.scene];
    if (!root || this.progress.done.includes(scene.id)) {
      return;
    }
    const done = scene.done;
    if (done.kind !== 'line' && done.kind !== 'changed') {
      return;
    }
    const text = await this.readSampleFile(root, done.file);
    if (text === undefined) {
      return;
    }
    const isDone = done.kind === 'line' ? hasLineWithAll(text, done.all) : lineChanged(this.baseline, text, done.text) || (this.baseline !== undefined && lineHolding(text, done.text) === undefined);
    if (isDone) {
      await this.tick(scene.id, true);
    }
  }

  /** Ticks an `opened` step when the note it names is opened. */
  private checkOpened(uri: vscode.Uri): void {
    const root = this.sampleRoot();
    const scene = TOUR_SCENES[this.progress.scene];
    if (!this.started || !root || scene.done.kind !== 'opened' || this.progress.done.includes(scene.id)) {
      return;
    }
    const prefix = `${root.path}/`;
    if (!uri.path.startsWith(prefix)) {
      return;
    }
    if (new RegExp(scene.done.pattern).test(uri.path.slice(prefix.length))) {
      void this.tick(scene.id, true);
    }
  }

  /** While presenting, the status bar item names the scene and carries its talking point. */
  private updateStatus(): void {
    if (!this.presenting) {
      return;
    }
    const scene = TOUR_SCENES[this.progress.scene];
    this.statusItem ??= vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
    this.statusItem.text = `$(play) Tour ${this.progress.scene + 1}/${TOUR_SCENES.length} · ${scene.title}`;
    const tooltip = new vscode.MarkdownString(`**${scene.title}**\n\n${scene.note}\n\nNext: Ctrl+Alt+] · Previous: Ctrl+Alt+[ · [End](command:${END_PRESENTING})`);
    tooltip.isTrusted = { enabledCommands: [END_PRESENTING] };
    this.statusItem.tooltip = tooltip;
    this.statusItem.command = 'deckard.tour.next';
    this.statusItem.accessibilityInformation = { label: `Tour scene ${this.progress.scene + 1} of ${TOUR_SCENES.length}: ${scene.title}. Select for the next scene.` };
    this.statusItem.show();
  }
}
