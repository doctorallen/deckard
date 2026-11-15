import * as vscode from 'vscode';

import type { Release } from '../../../../core/changelog';
import type { HelpAction, HelpActionMessage, HelpGuideMessage, HelpPageToHost, HelpPanelMessage, HelpRevealMessage, HelpSettingMessage, HelpTab } from '../../../protocol/help';
import type { WhatsNew } from '../../../commands/whatsNew';
import { GUIDE_PAGES, type HelpPlace, isGuidePage } from '../../guide';
import { getHelpHtml } from '../../helpHtml';
import { guideUnavailableHtml, renderGuidePage, warmGuideRenderer } from './guidePage';
import { describeHelpCommands, HelpManifest, isRunnableFromHelp, linkCommandNames } from './helpManifest';
import type { MessageHandlers, PageContext, PageController, PageOptions } from '../../host/pageController';
import type { PageChrome } from '../../components';
import { narrowHelpMessage } from './messages';
import type { IndexReader } from '../../../../core/workspace/indexReader';
import { goToPage, listGoTo, openGoTo } from '../../host/sharedHandlers';
import { pageRegistry, type PagePick } from '../../host/pageRegistry';
import { entryForPick, findHelpEntry, pageHelpFor, PAGE_HELP_MAPS, type PageHelpChoice, type PageHelpEntry, type PageHelpMap, ringOf, splitGuideRef } from '../../../state/pageHelp';
import { tourSceneFor } from '../../../state/tour';
import { TASK_SORT_LABELS } from '../../../../domain/model/sortOrders';
import { TASK_SORT_MODES, type PersistedPreferences, type TaskBoardGroupBy, type TaskSortMode } from '../../../../domain/model/preferences';
import { listLaneAxes } from '../../../../domain/tasks/boardLanes';
import { settingTarget, writeSetting } from '../../../commands/settings';
import { setZenMode } from '../../zenMode';
import type { TourService } from '../../tour';
import { findGuideSection, firstSentence, sentenceNaming } from './guideSections';
import { describeSetting, listSettingSchemas, readSettingWrite, type SettingSchema, type SettingView } from './helpSettings';
import { renderThisPage, type ThisPageChoice, type ThisPageEntry, type ThisPageModel } from './thisPageHtml';
import { renderTour } from './tourHtml';

/** What This page reads and changes besides the guide and VS Code's settings. */
export interface HelpThisPagePort {
  /** The board's own choices, kept as preferences. */
  preferences: { readonly current: PersistedPreferences; readonly onDidChange: vscode.Event<unknown> };
  taskLayout: {
    setTaskBoardGroup(group: TaskBoardGroupBy, namespace?: string): Promise<void>;
    setTaskBoardLanes(lanes: TaskBoardGroupBy | undefined, namespace?: string): Promise<void>;
    setTaskSortMode(mode: TaskSortMode): Promise<void>;
    setTaskBoardLayout(layout: 'board' | 'table'): Promise<void>;
  };
  /** The Task board's panel, for Can start now. */
  taskBoard: { isOpen(): boolean; isAvailableOnly(): boolean; toggleAvailable(): Promise<void> };
}

/** The Tour, as Help's Tour tab drives it. */
export type HelpTourPort = Pick<
  TourService,
  'state' | 'onDidChange' | 'go' | 'next' | 'previous' | 'again' | 'doIt' | 'tick' | 'end' | 'present' | 'stopPresenting' | 'setDemo' | 'setHideHelp'
>;

/** What each axis is called in the board's Group and Lanes, but tags. */
const AXIS_NAMES: Readonly<Record<Exclude<TaskBoardGroupBy, 'tag'>, string>> = { status: 'Status', priority: 'Priority', due: 'Due date', assignee: 'Person' };
/** Why a choice is the page's own, not a setting. */
const KEPT_BY_BOARD = 'Not a setting: the board keeps your choice, on this machine.';

/** The commands This page's buttons run, by action. */
const PAGE_COMMANDS: Partial<Record<HelpAction, string>> = {
  'edit-statuses': 'deckard.editTaskStatuses',
  'open-board': 'deckard.showTaskBoard',
  'tour-create-sample': 'deckard.createWorkSample',
  'tour-reset': 'deckard.createWorkSample',
};

/** What each of the Tour tab's controls asks of the Tour. */
const TOUR_ACTIONS: Partial<Record<HelpAction, (tour: HelpTourPort, message: HelpActionMessage) => Promise<void>>> = {
  'tour-go': (tour, message) => tour.go(message.index ?? 0),
  'tour-next': (tour) => tour.next(),
  'tour-previous': (tour) => tour.previous(),
  'tour-again': (tour) => tour.again(),
  'tour-do': (tour) => tour.doIt(),
  'tour-tick': async (tour, message) => {
    if (message.id) {
      await tour.tick(message.id, message.on === true);
    }
  },
  'tour-end': (tour) => tour.end(),
  'tour-present': (tour) => tour.present(),
  'tour-stop': (tour) => tour.stopPresenting(),
  'tour-demo': async (tour, message) => {
    if (message.id) {
      await tour.setDemo(message.id, message.on === true);
    }
  },
  'tour-hide-help': (tour, message) => tour.setHideHelp(message.on === true),
};

/** What a choice is set to, in its option's words. */
function describeChoice(choice: ThisPageChoice | undefined): string | undefined {
  return choice?.options.find((option) => option.value === choice.current)?.label;
}

/** An axis of the board's Group or Lanes, but tags, by name. */
function readAxis(value: string): Exclude<TaskBoardGroupBy, 'tag'> | undefined {
  return (Object.keys(AXIS_NAMES) as Array<Exclude<TaskBoardGroupBy, 'tag'>>).find((axis) => axis === value);
}

/** How each of the board's own choices is written, as its controls write it. */
const CHOICE_WRITERS: Readonly<Record<PageHelpChoice, (port: HelpThisPagePort, value: string) => Promise<void>>> = {
  group: async (port, value) => {
    const axis = readAxis(value);
    if (axis) {
      await port.taskLayout.setTaskBoardGroup(axis);
    }
  },
  lanes: async (port, value) => {
    const axis = readAxis(value);
    if (axis || value === 'none') {
      await port.taskLayout.setTaskBoardLanes(axis);
    }
  },
  sort: async (port, value) => {
    const mode = TASK_SORT_MODES.find((known) => known === value);
    if (mode) {
      await port.taskLayout.setTaskSortMode(mode);
    }
  },
  layout: async (port, value) => {
    if (value === 'board' || value === 'table') {
      await port.taskLayout.setTaskBoardLayout(value);
    }
  },
  available: async (port, value) => {
    if (port.taskBoard.isOpen() && (value === 'on') !== port.taskBoard.isAvailableOnly()) {
      await port.taskBoard.toggleAvailable();
    }
  },
};

/** What Help is drawn from. */
export interface HelpControllerOptions {
  extensionUri: vscode.Uri;
  /**
   * What the extension contributes, so a command a guide page names runs
   * from it only when Help may run it.
   */
  manifest: HelpManifest;
  /** The shipped changelog's Highlights, for What's new. */
  whatsNew?: Pick<WhatsNew, 'releases' | 'newSince'>;
  /** What DECKARD's menu reads its hints from; without one it lists the pages bare. */
  indexer?: Pick<IndexReader, 'getSnapshot'>;
  /** What This page reads and changes; without it, This page lists only what the guide says. */
  thisPage?: HelpThisPagePort;
  /** The Tour; without it, the Tour tab says so. */
  tour?: HelpTourPort;
}

/**
 * The Help page: Deckard's guide, docs/guide, its contents beside the page
 * being read, and What's new from the changelog. It is sent no snapshot;
 * it asks to run a command, to read a guide page, or to open the changelog.
 */
export class HelpController implements PageController<never, HelpPageToHost> {
  public readonly name = 'Help';
  public readonly options: PageOptions;
  public readonly narrow = narrowHelpMessage;
  public readonly handlers: MessageHandlers<HelpPageToHost>;
  /** What's new's releases, read when Help opens and drawn from then on. */
  private releases: Release[] = [];
  /** The place the HTML being drawn opens at, while one is asked for. */
  private place: HelpPlace | undefined;
  /** The page Help was last asked from, by its host's name. */
  private askedPage: string | undefined;
  /** The entry This page shows, or its list. */
  private selected: string | undefined;
  /** Whether Point at something is on. */
  private exploring = false;
  /** The tab the page shows, as it last said. */
  private tab: HelpTab = 'guide';
  /** The Tour, once it is given. */
  private tourPort: HelpTourPort | undefined;
  private tourListener: vscode.Disposable | undefined;
  /** Help's host, which the Tour's changes redraw. */
  private pageContext: PageContext | undefined;
  /** Guide pages rendered once, for This page's sections. */
  private readonly renderedGuide = new Map<string, Promise<string>>();

  /** Draws from `help.manifest` and `help.whatsNew`, and reads the guide under `help.extensionUri`. */
  public constructor(private readonly help: HelpControllerOptions) {
    this.options = {
      // Help is not kept running while hidden (Q1 of the webviews plan): its
      // page saves the guide page it shows and its scroll with setState, and
      // comes back there when shown.
      retainContextWhenHidden: false,
      enableFindWidget: true,
      // The page's own script asks for the guide page it shows. A
      // panel restored after a reload keeps the options it was made with,
      // which before 1.23 had no scripts, so they are kept and scripts set.
      scripts: 'merge',
      // A theme or zen change draws Help again from the top; it has no
      // snapshot to send.
      onChromeChange: 'reload',
      // Help is drawn whole in its HTML, so a restore or a show refreshes
      // nothing and writes nothing to the log.
      hasSnapshot: false,
      restore: () => this.loadReleases(),
    };
    this.handlers = {
      runCommand: async (message) => {
        if (isRunnableFromHelp(help.manifest, message.command)) {
          await vscode.commands.executeCommand(message.command);
        }
      },
      openGuide: (message, page) => this.showGuide(page, message.page, message.anchor),
      openChangelog: () =>
        vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.joinPath(help.extensionUri, 'CHANGELOG.md')),
      openGoTo: openGoTo(),
      listGoTo: listGoTo({ indexer: help.indexer, current: 'help' }),
      goToPage: goToPage(),
      helpTab: async (message, page) => {
        this.tab = message.tab;
        await this.repaint(page);
      },
      helpAction: (message, page) => this.act(message, page),
      helpSetting: (message, page) => this.writeSetting(message, page),
    };
    if (help.tour) {
      this.setTour(help.tour);
    }
  }

  /** Gives Help the Tour, which is made after it. */
  public setTour(tour: HelpTourPort): void {
    this.tourPort = tour;
    this.tourListener?.dispose();
    this.tourListener = tour.onDidChange(() => {
      if (this.pageContext) {
        void this.repaint(this.pageContext);
      }
    });
  }

  /** Stops listening to the Tour. */
  public dispose(): void {
    this.tourListener?.dispose();
  }

  /**
   * The page Help is asked from, by its host's name, which This page
   * explains; and whether Help has a map of it, so it opens on This page.
   */
  public askFrom(page: string | undefined): boolean {
    if (page !== this.askedPage) {
      this.selected = undefined;
      this.setExploring(false);
    }
    this.askedPage = page;
    return pageHelpFor(page) !== undefined;
  }

  /** Redraws This page or the Tour, and keeps them current while Help is open. */
  public subscribe(page: PageContext): vscode.Disposable[] {
    this.pageContext = page;
    const repaint = (): void => void this.repaint(page);
    const parts: vscode.Disposable[] = [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deckard')) {
          repaint();
        }
      }),
      pageRegistry.onPicked((pick) => void this.picked(pick, page)),
    ];
    if (this.help.thisPage) {
      parts.push(this.help.thisPage.preferences.onDidChange(repaint));
    }
    return parts;
  }

  /** Point at something ends when Help closes. */
  public onDidDetach(): void {
    this.setExploring(false);
  }

  /** Reads What's new's releases again, before Help is drawn in a panel. */
  public async loadReleases(): Promise<void> {
    this.releases = (await this.help.whatsNew?.releases()) ?? [];
  }

  /**
   * Runs `draw` with Help's HTML opening at `place`. Only a new panel's
   * first HTML takes one; a redraw after a theme change opens at the
   * guide's contents.
   */
  public drawingAt<T>(place: HelpPlace | undefined, draw: () => T, tab: HelpTab = 'guide'): T {
    this.place = place;
    this.tab = tab;
    try {
      return draw();
    } finally {
      this.place = undefined;
    }
  }

  /** The map This page explains now: the page asked from, or the only page Help has a map of. */
  private currentMap(): PageHelpMap | undefined {
    return pageHelpFor(this.askedPage) ?? (this.askedPage === undefined ? PAGE_HELP_MAPS[0] : undefined);
  }

  /** Sends the tab shown its content, while it is This page or the Tour. */
  private async repaint(page: PageContext): Promise<void> {
    if (!page.surface?.visible || this.tab === 'guide') {
      return;
    }
    const html = this.tab === 'page' ? renderThisPage(await this.thisPageModel()) : this.tourHtml();
    const message: HelpPanelMessage = { type: 'helpPanel', tab: this.tab, html };
    page.post(message);
  }

  /** The Tour tab's HTML. */
  private tourHtml(): string {
    const tour = this.tourPort;
    return tour
      ? renderTour(tour.state)
      : '<p>The tour is not available in this window.</p>';
  }

  /** A guide page as Help renders it, once. */
  private renderedPage(name: string): Promise<string> {
    let rendered = this.renderedGuide.get(name);
    if (!rendered) {
      rendered = this.guideHtml(name);
      this.renderedGuide.set(name, rendered);
    }
    return rendered;
  }

  /** What This page draws now. */
  private async thisPageModel(): Promise<ThisPageModel> {
    const map = this.currentMap();
    const board = this.help.thisPage?.taskBoard;
    if (!map) {
      return { askedTitle: this.askedPage, entries: [], settings: [], choices: {}, exploring: false, pageOpen: false };
    }
    const choices = this.choices();
    const entries: ThisPageEntry[] = [];
    for (const entry of map.entries) {
      entries.push(await this.describeEntry(entry, choices));
    }
    return {
      map,
      entries,
      settings: this.settingViews(map),
      choices,
      ...(this.selected ? { selected: this.selected } : {}),
      exploring: this.exploring,
      pageOpen: board?.isOpen() ?? pageRegistry.openPages().includes(map.page),
    };
  }

  /** A guide section by its `page#anchor`, as rendered, with its page's title. */
  private async sectionAt(ref: string): Promise<{ title: string; html: string; pageTitle: string } | undefined> {
    const { page, anchor } = splitGuideRef(ref);
    const section = anchor ? findGuideSection(await this.renderedPage(page), anchor) : undefined;
    return section ? { title: section.title, html: section.html, pageTitle: GUIDE_PAGES[page] ?? page } : undefined;
  }

  /** One entry of the map, in the guide's words, with its choice's value and its Tour scene. */
  private async describeEntry(entry: PageHelpEntry, choices: Partial<Record<PageHelpChoice, ThisPageChoice>>): Promise<ThisPageEntry> {
    const section = await this.sectionAt(entry.guide);
    const title = section?.title ?? entry.id;
    const item: ThisPageEntry = {
      entry,
      title,
      summary: section ? firstSentence(section.html) : '',
      sectionHtml: section?.html ?? '',
      from: `${section?.pageTitle ?? entry.guide} › ${title}`,
    };
    const onThisPage = await this.onThisPage(entry);
    const current = describeChoice(entry.choice ? choices[entry.choice] : undefined);
    const scene = tourSceneFor(entry.id);
    return { ...item, ...(onThisPage ? { onThisPage } : {}), ...(current ? { current } : {}), ...(scene ? { tourScene: scene } : {}) };
  }

  /** For a control the same on every page, the sentence of this page's guide that names it. */
  private async onThisPage(entry: PageHelpEntry): Promise<ThisPageEntry['onThisPage']> {
    const where = entry.onThisPage;
    const other = where ? await this.sectionAt(where.guide) : undefined;
    const sentence = other && where ? sentenceNaming(other.html, where.mentions) : undefined;
    return other && sentence && where ? { sentence, words: where.mentions, from: `${other.pageTitle} › ${other.title}` } : undefined;
  }

  /** Every setting This page lists, as it is now. */
  private settingViews(map: PageHelpMap): SettingView[] {
    const schemas = listSettingSchemas(this.help.manifest);
    const configuration = vscode.workspace.getConfiguration('deckard');
    return map.settings.flatMap((key) => {
      const schema = schemas.get(`deckard.${key}`);
      return schema ? [describeSetting(key, schema, configuration.inspect(key))] : [];
    });
  }

  /** The board's own choices, with their options and the ones taken. */
  private choices(): Partial<Record<PageHelpChoice, ThisPageChoice>> {
    const port = this.help.thisPage;
    if (!port) {
      return {};
    }
    const current = port.preferences.current;
    const group = current.taskBoardGroup ?? 'status';
    const axes = (Object.keys(AXIS_NAMES) as Array<Exclude<TaskBoardGroupBy, 'tag'>>);
    const tagged = (by: TaskBoardGroupBy | undefined, namespace: string | undefined) =>
      by === 'tag' && namespace ? [{ value: 'tag', label: `#${namespace}` }] : [];
    const onBoard = 'Choose a namespace with Tag… on the board';
    const boardOpen = port.taskBoard.isOpen();
    return {
      group: {
        current: group,
        options: [
          ...axes.map((axis) => ({ value: axis, label: AXIS_NAMES[axis] })),
          ...tagged(group, current.taskBoardGroupNamespace),
          ...(group === 'tag' ? [] : [{ value: 'tag-pick', label: 'Tag…', disabled: onBoard }]),
        ],
        kept: KEPT_BY_BOARD,
      },
      lanes: {
        current: current.taskBoardLanes ?? 'none',
        options: [
          { value: 'none', label: 'None' },
          ...listLaneAxes(group).filter((axis): axis is Exclude<TaskBoardGroupBy, 'tag'> => axis !== 'tag').map((axis) => ({ value: axis, label: AXIS_NAMES[axis] })),
          ...tagged(current.taskBoardLanes, current.taskBoardLanesNamespace),
          ...(current.taskBoardLanes === 'tag' ? [] : [{ value: 'tag-pick', label: 'Tag…', disabled: onBoard }]),
        ],
        kept: KEPT_BY_BOARD,
      },
      sort: {
        current: current.taskSortMode ?? 'rank',
        options: TASK_SORT_MODES.map((mode) => ({ value: mode, label: TASK_SORT_LABELS[mode] })),
        kept: 'Not a setting: the board keeps your choice, and the search pages and Home sort by it too.',
      },
      layout: {
        current: current.taskBoardLayout ?? 'board',
        options: [{ value: 'board', label: 'Board' }, { value: 'table', label: 'Table' }],
        kept: KEPT_BY_BOARD,
      },
      available: {
        current: boardOpen && port.taskBoard.isAvailableOnly() ? 'on' : 'off',
        options: [
          { value: 'off', label: 'Every open task', ...(boardOpen ? {} : { disabled: 'Open the Task board first' }) },
          { value: 'on', label: 'Can start now', ...(boardOpen ? {} : { disabled: 'Open the Task board first' }) },
        ],
        kept: 'Part of the board\u2019s search: is:available.',
      },
    };
  }

  /** Changes one of the board's own choices, as its controls do. */
  private async choose(choice: string | undefined, value: string | undefined): Promise<void> {
    const port = this.help.thisPage;
    if (!port || !value) {
      return;
    }
    const writer = CHOICE_WRITERS[choice as PageHelpChoice];
    await writer?.(port, value);
  }

  /** Turns Point at something on or off on the page This page explains. */
  private setExploring(on: boolean): void {
    if (this.exploring === on) {
      return;
    }
    this.exploring = on;
    const map = this.currentMap();
    if (map) {
      pageRegistry.broadcast({ type: 'explore', on }, map.page);
    }
  }

  /** What a page picked in Point at something: its entry, shown on This page. */
  private async picked(pick: PagePick, page: PageContext): Promise<void> {
    const map = this.currentMap();
    if (!map || pick.page !== map.page) {
      return;
    }
    if (pick.id === undefined) {
      this.exploring = false;
    } else {
      this.selected = entryForPick(map, pick.id)?.id ?? this.selected;
    }
    if (this.tab !== 'page') {
      this.tab = 'page';
      const reveal: HelpRevealMessage = { type: 'reveal', page: 'README', tab: 'page' };
      page.post(reveal);
    }
    await this.repaint(page);
  }

  /**
   * Acts on a control of This page or the Tour. This page's own are redrawn
   * after; the Tour says itself when it changed.
   */
  private async act(message: HelpActionMessage, page: PageContext): Promise<void> {
    const tourAction = TOUR_ACTIONS[message.action];
    if (tourAction) {
      if (this.tourPort) {
        await tourAction(this.tourPort, message);
      }
      return;
    }
    const redraw = await this.actOnPage(message);
    if (redraw) {
      await this.repaint(page);
    }
  }

  /** Acts on a control of This page, or a command it runs; says whether This page is drawn again. */
  private async actOnPage(message: HelpActionMessage): Promise<boolean> {
    const map = this.currentMap();
    const command = PAGE_COMMANDS[message.action];
    if (command) {
      await vscode.commands.executeCommand(command);
      return message.action === 'open-board';
    }
    if (message.action === 'show-me' || message.action === 'open-setting') {
      await this.pointOrOpen(message, map);
      return false;
    }
    if (message.action === 'select') {
      this.selected = map && message.id && findHelpEntry(map, message.id) ? message.id : undefined;
    } else if (message.action === 'back') {
      this.selected = undefined;
    } else if (message.action === 'explore') {
      this.setExploring(!this.exploring);
    } else if (message.action === 'choose') {
      await this.choose(message.choice, message.value);
    }
    return true;
  }

  /** Show me, which rings an entry on its page, or Open in Settings, which opens a setting This page lists. */
  private async pointOrOpen(message: HelpActionMessage, map: PageHelpMap | undefined): Promise<void> {
    if (message.action === 'show-me') {
      const entry = map && message.id ? findHelpEntry(map, message.id) : undefined;
      if (map && entry) {
        pageRegistry.broadcast({ type: 'spotlight', id: ringOf(entry) }, map.page);
      }
      return;
    }
    if (message.key && map?.settings.includes(message.key)) {
      await vscode.commands.executeCommand('workbench.action.openSettings', `deckard.${message.key}`);
    }
  }

  /**
   * Writes a setting This page lists, checked against its schema, where it
   * is set already: the workspace's settings when the workspace sets it,
   * else the user's. Zen goes through Zen's own switch, as the page's ⋯ does.
   */
  private async writeSetting(message: HelpSettingMessage, page: PageContext): Promise<void> {
    const map = this.currentMap();
    if (!map?.settings.includes(message.key)) {
      return;
    }
    const schema: SettingSchema | undefined = listSettingSchemas(this.help.manifest).get(`deckard.${message.key}`);
    if (!schema) {
      return;
    }
    const configuration = vscode.workspace.getConfiguration('deckard');
    const view = describeSetting(message.key, schema, configuration.inspect(message.key));
    const write = readSettingWrite(view, schema, message.value);
    if (!write) {
      await this.repaint(page);
      return;
    }
    if (message.key === 'display.zen') {
      await setZenMode(write.value === true);
    } else {
      await writeSetting(message.key, write.value, settingTarget(message.key, configuration), configuration);
    }
  }

  /** Help's HTML, at the place asked for while one is. */
  public html(webview: vscode.Webview, chrome: PageChrome): string {
    const newSince = this.help.whatsNew?.newSince();
    return getHelpHtml(webview, this.help.extensionUri, {
      releases: this.releases,
      ...(newSince ? { newSince } : {}),
      ...(this.place ? { place: this.place } : {}),
      tab: this.tab,
      chrome,
    });
  }

  /** Help is drawn whole in its HTML, so there is never a snapshot to send. */
  public buildSnapshot(): undefined {
    return undefined;
  }

  /**
   * Starts VS Code's Markdown extension as Help opens, made new or
   * restored, so the first guide page it shows does not wait on it.
   */
  public onDidAttach(): void {
    warmGuideRenderer();
  }

  /**
   * Shows a guide page in the panel, read from the copy the VSIX ships and
   * rendered by VS Code's Markdown extension, each command it names that
   * Help may run made a button. A page that cannot be read, or rendered,
   * says so where the page would be.
   */
  private async showGuide(page: PageContext, name: string, anchor?: string): Promise<void> {
    if (!page.surface || !isGuidePage(name)) {
      return;
    }
    const html = await this.guideHtml(name);
    const message: HelpGuideMessage = {
      type: 'guide',
      page: name,
      title: GUIDE_PAGES[name],
      html,
      ...(anchor ? { anchor } : {}),
    };
    // The panel is looked up again once the page is rendered, so a Help
    // opened again meanwhile is the one sent the page, and one closed
    // meanwhile, with none opened since, is sent nothing.
    const surface = page.surface;
    if (!surface) {
      return;
    }
    void surface.webview.postMessage(message);
  }

  /**
   * A guide page's HTML for the panel: the page rendered, or a sentence
   * saying it could not be read, with the page on GitHub, or could not be
   * rendered, with the page on the guide's site.
   */
  private async guideHtml(name: string): Promise<string> {
    let source: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(this.help.extensionUri, 'docs', 'guide', `${name}.md`),
      );
      source = Buffer.from(bytes).toString('utf8');
    } catch {
      return '<p>Deckard could not read this page of the guide. It is also on GitHub, at <a href="https://github.com/doctorallen/deckard/blob/master/docs/guide/' + name + '.md">docs/guide/' + name + '.md</a>.</p>';
    }
    try {
      return linkCommandNames(await renderGuidePage(source), describeHelpCommands(this.help.manifest));
    } catch {
      return guideUnavailableHtml(name);
    }
  }
}
