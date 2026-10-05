import { GUIDE_PAGES, HELP_READ_MORE } from './guide';
import { createNonce, type PageChrome } from './components';
import { buildPageShell, joinUnder, type ShellUri, type ShellWebview } from './host/pageShell';
import { compareVersions, Release, releasesWithHighlights, renderHighlightHtml } from '../../core/changelog';
import { escapeHtml } from '../../shared/html';
import { GUIDE_IMAGE_BASE } from './pages/help/guideLinks';
import { describeHelpCommands, type HelpManifest, linkCommandNames, renderCommandName } from './pages/help/helpManifest';

/** A short line for what a command is for, beyond the name it goes by. */
const COMMAND_NOTES: Readonly<Record<string, string>> = {
  'deckard.quickFind.openBeside':
    'Opens the highlighted result beside the editor, keeping Find open.',
  'deckard.quickFind.insertLink': 'Links the highlighted result where the cursor was.',
  'deckard.quickFind.actions': 'Lists everything the highlighted result can do.',
  'deckard.showDashboard': 'What is overdue, due today, and open, Home, and every tag.',
  'deckard.showNotesGraph':
    'The whole workspace as a map, or one note’s neighborhood.',
  'deckard.showNotesGraphAroundNote': 'The graph around the note in the editor, one hop out.',
  'deckard.showTaskBoard': 'Tasks as columns, or as a ranked list.',
  'deckard.showStats':
    'Index totals, notes nothing links to, and tags that look alike.',
  'deckard.showHelp': 'This guide.',
  'deckard.openWalkthrough': 'Opens the walkthrough: six steps, each checked off as you do it.',
  'deckard.openWhatsNew': 'Opens the highlights of recent releases in Help.',
  'deckard.showLog': 'What Deckard did, and how long each step took.',
  'deckard.reindexWorkspace': 'Reads every note again.',
  'deckard.createDailyNote':
    'Creates or opens today’s note, carrying yesterday’s unfinished tasks in when asked to.',
  'deckard.pinNote': 'Pins the note the cursor is in to Home.',
  'deckard.unpinNote': 'Lets that pin go.',
  'deckard.previousDailyNote': 'The nearest daily note before this one.',
  'deckard.nextDailyNote': 'The nearest daily note after this one.',
  'deckard.noteActions':
    'Lists what can be done with this note from where the cursor is: the Deckard button in a note’s title bar.',
  'deckard.openDailyNoteForDate':
    'Opens the daily note for a day you name in plain words, creating it when there is none.',
  'deckard.openWeeklyNote': 'This week’s note, with its review written in.',
  'deckard.openMonthlyNote': 'This month’s note, with its review written in.',
  'deckard.writeReview':
    'Writes, or brings up to date, the review in this week’s or this month’s note.',
  'deckard.rollTasksForward':
    'Carries unfinished tasks from earlier daily notes into today’s.',
  'deckard.capture': 'Adds a task to today’s note from anywhere.',
  'deckard.captureUnderHeading': 'Adds a task under a heading you choose.',
  'deckard.editTask': 'Opens the task on the cursor’s line, field by field.',
  'deckard.breakIntoSteps': 'Writes steps under the task on the cursor’s line, one for each you type.',
  'deckard.addTask': 'The same editor, where there is no task yet.',
  'deckard.toggleTaskDone':
    'Completes or reopens the tasks under the cursors, starting the next one of a repeating task.',
  'deckard.newNoteFromTemplate': 'A new note from one of your templates.',
  'deckard.newNoteFromTemplateHere': 'The same, in the folder right-clicked in the Explorer.',
  'deckard.excludeFromIndex': 'Leaves the folder right-clicked in the Explorer out of the index.',
  'deckard.includeInIndex': 'Brings a folder left out by name back into the index.',
  'deckard.parkNote': 'Parks this note: still searchable, left out of the lists of things to do.',
  'deckard.unparkNote': 'Takes the parked tag out of this note.',
  'deckard.parkFolder': 'Parks a folder and every note in it.',
  'deckard.unparkFolder': 'Takes a folder out of the parked folders.',
  'deckard.parkTag': 'Parks everything a tag finds.',
  'deckard.unparkTag': 'Takes a tag out of the parked tags.',
  'deckard.copyMcpSetup': 'Copies the command that adds Deckard to Claude Code.',
  'deckard.resetMcpToken': 'Makes a new token, so old setups stop working.',
  'deckard.moveTo': 'Moves this line, task, or selection under another heading, leaving a link.',
  'deckard.agenda.moveTo': 'Moves the task under another heading.',
  'deckard.openNotePage': 'Opens the note in the editor on a page of its own, its links, tags, tasks, and query blocks working.',
  'deckard.copyAsPlainMarkdown':
    'Copies the note, or the selection, with its embeds, query results, and links written out for elsewhere.',
  'deckard.exportTaskCalendar': 'Writes your dated tasks to a calendar file for a calendar app.',
  'deckard.extractHeading':
    'Moves a heading and everything under it into a note of its own, leaving a link behind.',
  'deckard.showTagOverview': 'Opens a tag’s search page.',
  'deckard.search': 'A search page, ready for a search.',
  'deckard.insertQueryBlock': 'A live query block of a saved or recent search, or one you type, at the cursor.',
  'deckard.searchWorkspace': 'Finds notes, tasks, and tags as you type.',
  'deckard.searchNotes': 'Opens a search page on a search you write, or on every note.',
  'deckard.linkCurrentHeading': 'Adds a person or project tag to this heading.',
  'deckard.moveTagsToFrontmatter': 'Moves a note’s inline tags into its front matter.',
  'deckard.renameTag': 'Renames a tag everywhere it is written.',
  'deckard.mergeTag': 'Merges one tag into another, after saying what that costs.',
  'deckard.renameHeading':
    'Renames the heading the cursor is in and carries its links along.',
  'deckard.undoLastChange': 'Puts the notes back as they were before the last write.',
  'deckard.agenda.editQuery':
    'Opens the Task Board on what the Tasks view lists, to change it and keep it with Save to Tasks view.',
  'deckard.clearAgendaQuery': 'Lets the Tasks view list every open task again.',
  'deckard.agenda.setGrouping': 'What the Tasks view’s groups are.',
  'deckard.outline.enableFollowCursor': 'Selects the heading the cursor is in.',
  'deckard.outline.disableFollowCursor': 'Leaves the Outline where you put it.',
  'deckard.focusSection': 'Folds the rest of the note away from the section the cursor is in.',
  'deckard.unfoldAllSections': 'Unfolds the note again after Focus Section.',
  'deckard.outline.filterByTag': 'Shows only the Outline headings that carry a tag, or a tag under it.',
  'deckard.outline.clearTagFilter': 'Shows every heading in the Outline again.',
  'deckard.chooseTheme': 'Previews each theme on the open pages as you move through the list.',
};

/**
 * A setting's description as words: a `[link](command:…)` as its text, a
 * `#setting#` link as the setting, and code marks dropped.
 */
function plainDescription(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/#(deckard\.[\w.]+)#/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

/** The commands the manifest contributes, as a table of what each is for. */
function renderCommandTable(manifest: HelpManifest, platform: NodeJS.Platform): string {
  const commands = (manifest.commands ?? []).filter(
    (command) => command.category === 'Deckard',
  );
  if (commands.length === 0) {
    return '';
  }
  const described = describeHelpCommands(manifest);
  const rows = commands
    .map((command) => {
      const help = described.get(command.title);
      return `<tr><td>${renderCommandName(
        escapeHtml(command.title),
        help?.command === command.command ? help : { command: command.command, runnable: false },
        platform,
      )}</td><td>${escapeHtml(COMMAND_NOTES[command.command] ?? '')}</td></tr>`;
    })
    .join('');
  return `<div class="table-scroll"><table><caption>Every command Deckard contributes, as the palette lists them under “Deckard:”</caption><thead><tr><th>Command</th><th>What it does</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/**
 * Every setting, grouped as the settings editor groups them — in one table,
 * a heading row per group, so the columns line up from the first group to
 * the last. As a table each, every group sized its columns by its own
 * content, and a reader's eye had to find the default column again at each.
 */
function renderSettingsTables(manifest: HelpManifest): string {
  const groups = (manifest.configuration ?? [])
    .map((group) => {
      const rows = Object.entries(group.properties ?? {})
        .map(([key, property]) => {
          const value =
            property.default === '' || property.default === undefined
              ? 'Empty'
              : JSON.stringify(property.default);
          const description = plainDescription(
            property.description ?? property.markdownDescription ?? '',
          );
          return `<tr><td><code>${escapeHtml(key)}</code></td><td><code>${escapeHtml(
            value,
          )}</code></td><td>${escapeHtml(description)}</td></tr>`;
        })
        .join('');
      return rows
        ? `<tbody><tr class="table-group"><th scope="rowgroup" colspan="3">${escapeHtml(
            group.title ?? 'Settings',
          )}</th></tr>${rows}</tbody>`
        : '';
    })
    .join('');
  return groups
    ? `<div class="table-scroll"><table><caption>Every setting Deckard contributes, as the settings editor groups them</caption><thead><tr><th>Setting</th><th>Default</th><th>What it does</th></tr></thead>${groups}</table></div>`
    : '';
}

/** A Help section's way into the guide page that goes into detail. */
function renderReadMore(section: string): string {
  const target = HELP_READ_MORE[section];
  if (!target) {
    return '';
  }
  return `<p class="read-more"><a href="#" data-guide-page="${target.page}"${target.anchor ? ` data-guide-anchor="${target.anchor}"` : ''}>Read more: ${escapeHtml(GUIDE_PAGES[target.page])} →</a></p>`;
}

/** What a Help page is drawn for, beyond the manifest: the look it is drawn in, and what else it is given. */
export interface HelpOptions {
  /** The platform whose key bindings the command table shows; the running one without. */
  platform?: NodeJS.Platform;
  /** The shipped changelog's releases, for What's new. */
  releases?: readonly Release[];
  /** The version the reader updated from: releases after it are marked New. */
  newSince?: string;
  /** A section to scroll to once the page has loaded. */
  anchor?: string;
  /** The look its host read: the theme, preview and all, and zen. */
  chrome: PageChrome;
}

/**
 * Builds a static, navigable Help page so guidance is available offline:
 * every section is written into the page, and the command names in it are
 * linked to what the manifest says they do.
 */
export function getHelpHtml(
  webview: ShellWebview,
  extensionUri: ShellUri,
  manifest: HelpManifest = {},
  options: HelpOptions,
): string {
  const platform = options.platform ?? process.platform;
  return linkCommandNames(
    buildHelpHtml({ webview, extensionUri, manifest, platform, options }),
    describeHelpCommands(manifest),
    platform,
  );
}

/** How many releases What's new lists. */
const WHATS_NEW_RELEASES = 5;

/** Help's What's new: the Highlights of recent releases, newest first. */
export function renderWhatsNew(releases: readonly Release[], newSince?: string): string {
  const listed = releasesWithHighlights(releases, undefined, '99999.0.0').slice(0, WHATS_NEW_RELEASES);
  const changelog =
    '<p><button type="button" data-action="open-changelog">Full changelog</button></p>';
  if (listed.length === 0) {
    return `<p>This version's changes are listed in the changelog.</p>${changelog}`;
  }
  return `<p>The highlights of recent releases, newest first. The changelog has every change.</p>${listed
    .map(
      (release) =>
        `<h3>${escapeHtml(release.version)}${release.date ? ` · ${escapeHtml(release.date)}` : ''}${
          newSince && compareVersions(release.version, newSince) > 0
            ? ' <span class="whats-new-chip">New</span>'
            : ''
        }</h3><ul>${release.highlights.map((text) => `<li>${renderHighlightHtml(text)}</li>`).join('')}</ul>`,
    )
    .join('')}${changelog}`;
}

/** What buildHelpHtml draws the page from. */
interface HelpPageInputs {
  webview: ShellWebview;
  extensionUri: ShellUri;
  manifest: HelpManifest;
  /** The platform already resolved from the options, so both tables agree on it. */
  platform: NodeJS.Platform;
  options: HelpOptions;
}

/** The Help page's shell around its sections, before command names are linked. */
function buildHelpHtml({ webview, extensionUri, manifest, platform, options }: HelpPageInputs): string {
  const nonce = createNonce();
  const logoUri = webview
    .asWebviewUri(joinUnder(extensionUri, 'resources', 'deckard.svg'))
    .toString();

  return buildPageShell({
    webview,
    extensionUri,
    page: 'help',
    title: 'Deckard Help',
    nonce,
    theme: options.chrome.theme,
    zen: options.chrome.zen,
    display: options.chrome.display,
    csp: { images: [new URL(GUIDE_IMAGE_BASE).origin] },
    bodyAttributes: options.anchor ? ` data-anchor="${escapeHtml(options.anchor)}"` : '',
    // src/webview/help/main.ts: the rail, the guide view, and the way back.
    bundle: true,
    body: `
<main>
${HELP_NAV}  <article>
${HELP_HEADER}${renderStartSections(logoUri, options)}${renderWritingSections()}${renderTaskSections()}${renderFindingSections()}${renderKeepingSections()}${renderReferenceSections(manifest, platform)}    </article>
  <div id="guide-view" hidden></div>
</main>
`,
  });
}

/**
 * The rail of section links down the side of Help, grouped as the sections
 * are. On a window too narrow for a side rail it sits above the guide,
 * folded behind its Contents button.
 */
const HELP_NAV = `  <nav aria-label="Help sections">
    <span class="nav-title">Deckard Help</span>
    <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="help-nav-links">Contents</button>
    <div class="nav-links" id="help-nav-links">
    <a href="#quick-start">Quick start</a>
    <a href="#whats-new">What's new</a>
    <span class="nav-group">Writing</span>
    <a class="nav-sub" href="#tags">Tags and people</a>
    <a class="nav-sub" href="#frontmatter">Front matter</a>
    <a class="nav-sub" href="#links">Links and embeds</a>
    <a class="nav-sub" href="#boundaries">What counts as a note</a>
    <span class="nav-group">Tasks</span>
    <a class="nav-sub" href="#tasks">Writing tasks</a>
    <a class="nav-sub" href="#task-metadata">Task metadata</a>
    <a class="nav-sub" href="#task-views">Tasks view and board</a>
    <span class="nav-group">Finding</span>
    <a class="nav-sub" href="#search">Search</a>
    <a class="nav-sub" href="#query">Query language</a>
    <a class="nav-sub" href="#query-blocks">Query blocks</a>
    <a class="nav-sub" href="#connections">Related notes and the graph</a>
    <span class="nav-group">Keeping notes</span>
    <a class="nav-sub" href="#home">Home and pins</a>
    <a class="nav-sub" href="#tidy">Renaming and tidying</a>
    <a class="nav-sub" href="#periodic">Days, weeks, months</a>
    <span class="nav-group">Reference</span>
    <a class="nav-sub" href="#zen">Display</a>
    <a class="nav-sub" href="#commands">Commands</a>
    <a class="nav-sub" href="#advanced">Settings</a>
    <a class="nav-sub" href="#assistants">AI assistants</a>
    <a class="nav-sub" href="#privacy">Privacy and safety</a>
    </div>
  </nav>
`;

/** The page's title and lead, above the first section. */
const HELP_HEADER = `    <header>
      <p class="eyebrow"><button type="button" class="eyebrow-home" data-go-to="" aria-haspopup="menu" aria-expanded="false" aria-label="Deckard: go to another page">DECKARD ▾</button><span class="eyebrow-trail"> / FIELD GUIDE</span></p>
      <h1>Help</h1>
      <p class="lead">Deckard indexes Markdown notes locally, then connects the people, projects, topics, tasks, and links you already write. Nothing leaves your machine.</p>
      <p class="read-more">This page is the quick glance; each section's <strong>Read more</strong> opens the <a href="#" data-guide-page="README">full guide</a>.</p>
    </header>

`;

/** The sections a first visit reads: Quick start, and What's new from the shipped changelog. */
function renderStartSections(logoUri: string, options: HelpOptions): string {
  return `    <section id="quick-start">
      <h2>Quick start</h2>
      <p><strong>New to Deckard?</strong> <code>Deckard: Get Started</code> opens the walkthrough: six steps, each checked off as you do it.</p>
      <p><strong>Rather see it than read it?</strong> <code>Deckard: Create a Work Sample</code> writes a week of a team lead's notes, dated from the day you make it, and opens it: standups, two 1:1s, a project, and its decisions, with what to try. <code>Deckard: Create the Story Tour</code> writes the longer tour, ten notes, one for each part of Deckard.</p>
      <div class="steps">
        <div class="step"><span class="step-number"></span><div><h3>Open a workspace</h3><p>Deckard indexes saved <code>.md</code> files in every workspace folder. Open a note, then use the Deckard icon <img class="deckard-logo" src="${logoUri}" alt="Deckard"> in the Activity Bar: <strong>Pages</strong> lists every Deckard page, then Context shows related notes and what links to it, then the Outline of the note’s headings, Tasks, and the Calendar. <code>Deckard: Go to…</code>, Cmd/Ctrl+Shift+Alt+P, lists the same pages from anywhere, and <strong>DECKARD ▾</strong> atop any page drops them as a menu.</p></div></div>
        <div class="step"><span class="step-number"></span><div><h3>Write a few tags</h3><p>Plain tags such as <code>#follow-up</code> are enough. Add <code>@mara-vale</code> for people, or namespaced tags such as <code>#project/neon-relay</code>, when that structure earns its keep. Typing <code>#</code> or <code>@</code> suggests the tags you already use.</p></div></div>
        <div class="step"><span class="step-number"></span><div><h3>Follow the connections</h3><p>Cmd/Ctrl-click a tag to open its search page, run <code>Deckard: Open Dashboard</code> for Home and every tag, or open the Notes Graph to see what is attached to what. Hover or Tab to any button to see what it does.</p></div></div>
      </div>
      <p class="note">The first time Deckard reads a workspace it says what it found: how many notes, open tasks, and tags. Deckard only reads saved files. Save a note to see it in the index, and run <code>Deckard: Open Log</code> if anything looks slow: every step over 100&nbsp;ms is listed there. When something fails, its message offers <strong>Open Log</strong>, where the details are.</p>
      ${renderReadMore('quick-start')}
    </section>

    <section id="whats-new">
      <h2>What's new</h2>
      ${renderWhatsNew(options.releases ?? [], options.newSince)}
    </section>

`;
}

/** The Writing group of the rail: tags and people, front matter, links, and what counts as a note. */
function renderWritingSections(): string {
  return `    <section id="tags">
      <h2>Tags and people</h2>
      <div class="cards">
        <div class="card"><h3>Lightweight tags</h3><p>A plain <code>#tag</code> on a heading, a task, or a line of prose is indexed with no setup. Tag names take letters, numbers, <code>_</code>, <code>-</code>, and <code>/</code> namespace segments; a number alone is not a tag, so a date such as <code>#2026</code> stays text.</p></div>
        <div class="card"><h3>People and entities</h3><p><code>@mara-vale</code> names a person. <code>#project/…</code>, <code>#topic/…</code>, <code>#organization/…</code>, and <code>#meeting/…</code> name entities; any other namespace becomes one on first use. <code>deckard.personMarker</code> changes the marker, and <code>deckard.entityNamespaceAliases</code> folds one namespace into another.</p></div>
        <div class="card"><h3>Inheriting tags</h3><p>A task takes the tags of the heading above it, and a heading takes the tags of the headings above that, along with the note’s front matter. A tag written in a body does not travel: not up to the heading, not across to its neighbors.</p></div>
        <div class="card"><h3>Associated tags</h3><p>Tags written together on one heading, task, or line are remembered as related, and tags that meet under a shared heading count more lightly. Related Notes and Refine both rank with that evidence, normalized so a common tag is not promoted for being common.</p></div>
        <div class="card"><h3>Favorites and order</h3><p>The heart <span class="favorite-heart" aria-hidden="true"></span> on a tag keeps it at the top of the Dashboard’s tag list. Favorites always appear before the rest, whatever the sort; a custom sort is dragged, moved one place with Alt+Up and Alt+Down on the focused tag, or moved with <strong>Move to top</strong> and <strong>Move to bottom</strong> on a tag’s context menu. Every context menu opens from the keyboard too, with Shift+F10, the menu key, or Alt+Enter on the focused row or tag.</p></div>
        <div class="card"><h3>On cards</h3><p>On search results, task rows, board cards, and Related Notes a tag is quiet monospace text that opens its page, or its menu with Shift+F10; the editor keeps its box.</p></div>
        <div class="card"><h3>In the editor</h3><p>Tags are clickable, hovering one says how many notes and tasks use it and lists its most recent entries, and a heading shows how many entries share its tags. <code>deckard.editor.hoverPreviews</code> and <code>deckard.editor.referenceCounts</code> turn those off.</p></div>
        <div class="card"><h3>The editor</h3><p>A note’s title bar carries Deckard’s button, which opens <code>Deckard: Note Actions…</code>: what can be done from where the cursor is. A daily note’s title bar also steps to the day before and after. Right-click the title bar to hide either. Right-click in a note for a <strong>Deckard</strong> submenu with the task on the line, the heading, Move to…, and Pin. Links, task dates, repeat rules, and block ids take your theme’s colors; <code>editor.tokenColorCustomizations</code> changes any scope ending in <code>.deckard</code>. A task’s metadata is drawn fainter than its words, and an open task that is overdue or due today says so at the end of its line (<code>deckard.editor.dimTaskMetadata</code>, <code>deckard.editor.taskDueHints</code>). The status bar counts the note’s words, or the selection’s, leaving out code, front matter, and task metadata.</p></div>
      </div>
      ${renderReadMore('tags')}
    </section>

    <section id="frontmatter">
      <h2>Front matter</h2>
      <p>YAML at the top of a note tags the whole note: <code>tags:</code>, and the typed fields <code>people:</code>, <code>projects:</code>, <code>topics:</code>, <code>organizations:</code>, and <code>meetings:</code>, which map to <code>@person</code> and the matching <code>#namespace/…</code> tags. <code>aliases:</code> gives the note other names that <code>[[links]]</code> resolve, <code>describes:</code> makes it a <a href="#tidy">hub note</a>, and <code>created:</code> / <code>updated:</code> are the dates Deckard dates it by.</p>
      <pre><code>---
project: neon-relay
people: [mara-vale, ren-kade]
aliases: [Relay, The Relay]
updated: 2026-09-20
---</code></pre>
      <p><code>Deckard: Move Inline Tags to Front Matter</code> collects a note’s inline tags into these fields. Use it when the context belongs to every heading in the note, since that is what a front-matter tag means.</p>
      ${renderReadMore('frontmatter')}
    </section>

    <section id="links">
      <h2>Links and embeds</h2>
      <div class="cards">
        <div class="card"><h3>Wiki links</h3><p><code>[[Note]]</code> names a note by its file name without <code>.md</code>, or by an alias. <code>[[Note#Heading]]</code> opens a heading and <code>[[Note#^marker]]</code> one line. Typing <code>[[</code> completes titles and aliases; typing <code>#^</code> completes the markers a note carries.</p></div>
        <div class="card"><h3>Embeds</h3><p><code>![[Note]]</code> on a line of its own draws that note in the Markdown preview; <code>![[Note#Heading]]</code> draws the section, <code>![[Note#^id]]</code> the marked line, and <code>![[#Heading]]</code> a heading of the note you are in. An embed inside a sentence stays the text you typed.</p></div>
        <div class="card"><h3>Renaming keeps links</h3><p>Renaming or moving a note rewrites every link that named it, in the same step, so one Undo takes back both. <code>Deckard: Rename Heading</code> does the same for a heading. <code>deckard.updateLinksOnRename</code> turns it off.</p></div>
        <div class="card"><h3>Broken links</h3><p>A link to a note that does not exist is marked in the editor with a <strong>Create note</strong> fix; a name two notes share is a warning, since it opens neither. <code>Deckard: Open Stats</code> lists the notes nothing links to, and every link that opens no note, with <strong>Create</strong> and <strong>Create all</strong>.</p></div>
      </div>
      ${renderReadMore('links')}
    </section>

    <section id="boundaries">
      <h2>What counts as a note</h2>
      <p>A “note” in Deckard is an entry: a heading and what is written under it, a task, or a tagged line. <code>deckard.noteBoundaries</code> decides what a tagged line is:</p>
      <div class="table-scroll"><table><caption>deckard.noteBoundaries</caption><thead><tr><th>Setting</th><th>A tagged line is</th><th>A search for that tag returns</th></tr></thead><tbody>
        <tr><td><code>line</code> <em>(default)</em></td><td>a note of its own</td><td>that line</td></tr>
        <tr><td><code>heading</code></td><td>part of the heading above it</td><td>the heading holding the line</td></tr>
        <tr><td><code>marked</code></td><td>part of the heading above it, unless it carries a <code>^marker</code></td><td>the heading, or the marked line itself</td></tr>
      </tbody></table></div>
      <p>A tag written in prose is never copied onto the heading: it stays where it was written, and the heading answers for it because it contains that line. Tasks are outside all of this — a task is its own entry under every setting. Changing the setting reindexes by itself and writes nothing to your notes.</p>
      <div class="cards">
        <div class="card"><h3>Parking</h3><p>A note, heading, or task is parked when it is in a parked folder, or when a search for a parked tag would find it. It stays searchable with <code>is:parked</code>, and is left out of the Tasks view, the Task board, the calendar, rollover, Related Notes, the Notes Graph, and tag completion. <code>Deckard: Park Note</code> writes <code>parked</code> into a note's front matter; <code>Deckard: Park Folder…</code> and <code>Deckard: Park Tag…</code> add to <code>deckard.parked.folders</code> and <code>deckard.parked.tags</code>. To keep someday tasks out of the Tasks view, park <code>status/someday</code>.</p></div>
      </div>
      ${renderReadMore('boundaries')}
    </section>

`;
}

/** The Tasks group of the rail: writing tasks, their metadata, and the views that list them. */
function renderTaskSections(): string {
  return `    <section id="tasks">
      <h2>Writing tasks</h2>
      <div class="cards">
        <div class="card"><h3>Checklist tasks</h3><p>A task is an unordered checklist item: <code>- [ ] Send the proposal</code>, with <code>-</code>, <code>*</code>, or <code>+</code>, and <code>[x]</code> when it is done. Checking a box anywhere in Deckard writes the same checked edit into the note, including the ✅ date and the next occurrence of a repeating task, from the task editor as well.</p></div>
        <div class="card"><h3>The task editor</h3><p><code>Deckard: Edit Task</code> on a task line — and <code>Deckard: Add Task</code> anywhere else — opens every field at once: description, status, dates, priority, repeat rule, assignee, and a tag. Dates are taken in plain words: <code>friday</code>, <code>oct 3</code>, <code>next week</code> (its Monday), <code>end of month</code>, <code>in 3 days</code>, <code>last friday</code>, and in every other box that asks for a date too; the box says back the day it read and how far off it is. It is on the lightbulb too, as <strong>Edit task…</strong>.</p></div>
        <div class="card"><h3>Steps</h3><p>A checkbox indented under a task is one of its steps. <code>Deckard: Break into Steps…</code> — on the lightbulb, the Tasks view’s menu, and a card’s ⋯ — writes them one per line you type, after anything already under the task, in one change that Undo takes back. The task then reads <strong>2 of 5 steps · next: Draft the email</strong> on its card and row, and opens to its steps in the Tasks view. On the board and in the Tasks view a plain step rides on its task instead of being listed on its own; one with a date, priority, person, or tag keeps its own card. Finishing the last step offers to finish the task, and finishing a task with open steps offers to finish them; nothing is completed for you.</p></div>
        <div class="card"><h3>Suggested steps</h3><p>With a VS Code language model installed, <strong>Suggest steps</strong> in Break into Steps… asks it for a list you edit before anything is written. Only the task’s words are sent, and only when you choose it. <code>deckard.tasks.suggestSteps</code> turns it off.</p></div>
        <div class="card"><h3>Done from the keyboard</h3><p><code>Deckard: Toggle Task Done</code> completes the tasks under every cursor, or reopens them when all of them are done, with the ✅ date and the next occurrence of a repeating task, as one edit that one Undo takes back. A repeat rule Deckard cannot read is underlined on an open task, since completing it would start no next one, and the lightbulb offers the nearest rules it can read.</p></div>
        <div class="card"><h3>The / menu</h3><p>Type <code>/</code> alone at the start of a line for what to write there: a task, a heading, a link or an embed, today’s note, a query block, a table of notes or tasks, or one of your templates, its questions as tab stops. <code>deckard.editor.slashMenu</code> turns it off.</p></div>
        <div class="card"><h3>Typing metadata</h3><p>Type <code>/</code> after a space inside a task to pick a due date, a priority, a repeat rule, or a dependency without remembering the markers. Suggestions use the format the task already uses, or <code>deckard.tasks.metadataFormat</code> for a task with none.</p></div>
        <div class="card"><h3>Who a task is for</h3><p>Write <code>👤 @dana</code> on a task — or <code>[assignee:: @dana]</code> in a Dataview vault — to say who it is for. A name in the words is a mention, not an assignment. Search with <code>assignee = @dana</code>, <code>is:assigned</code>, or <code>is:unassigned</code>, and set <code>deckard.me</code> so <code>is:mine</code> finds yours — a task for nobody in particular is yours too.</p></div>
        <div class="card"><h3>Capture</h3><p><code>Deckard: Capture</code>, or Cmd/Ctrl+Shift+Alt+N, adds a task to today’s note from anywhere, completing tags as you type; <code>Deckard: Capture Under a Heading</code> puts it under a heading you choose in any note, the ones used last first, above that heading’s sub-headings. With words selected, Capture and Find start from them, and a capture from a note links back to it. It stays open when you click away, and brings back what you had typed if you close it.</p></div>
        <div class="card"><h3>Dependencies</h3><p><code>🆔 a1</code> names a task, and <code>⛔ a1</code> waits for it. A task is blocked while something it waits for is still open, which <code>is:blocked</code> and <code>is:blocking</code> search and the Tasks view says beneath the task. <code>is:waiting</code> is for people, not dependencies: a task marked <code>#status/waiting</code>, or for someone else.</p></div>
      </div>
      ${renderReadMore('tasks')}
    </section>

    <section id="task-metadata">
      <h2>Task metadata</h2>
      <p>Deckard reads the <a href="https://publish.obsidian.md/tasks">Obsidian Tasks</a> formats, both the emoji one and Dataview fields, and writes back whichever a task already uses.</p>
      <div class="table-scroll"><table><caption>Markers, in the order Deckard writes them</caption><thead><tr><th>Marker</th><th>Dataview</th><th>Means</th></tr></thead><tbody>
        <tr><td>🔺 ⏫ 🔼 🔽 ⏬</td><td><code>[priority:: high]</code></td><td>Priority, highest to lowest</td></tr>
        <tr><td>🔁 every week</td><td><code>[repeat:: every week]</code></td><td>Repeat rule; completing writes the next occurrence, with the task’s steps unchecked under it</td></tr>
        <tr><td>🛫 2026-09-20</td><td><code>[start:: 2026-09-20]</code></td><td>Not actionable before this day</td></tr>
        <tr><td>⏳ 2026-09-21</td><td><code>[scheduled:: 2026-09-21]</code></td><td>The day you plan to work on it</td></tr>
        <tr><td>📅 2026-09-22</td><td><code>[due:: 2026-09-22]</code></td><td>Due date</td></tr>
        <tr><td>✅ 2026-09-23</td><td><code>[completion:: 2026-09-23]</code></td><td>Written when the task is completed</td></tr>
        <tr><td>🆔 a1 / ⛔ b2</td><td><code>[id:: a1]</code></td><td>This task’s name, and what it waits for</td></tr>
      </tbody></table></div>
      <p>A repeat rule reads as Obsidian Tasks writes it — <code>every week</code>, <code>every Monday</code>, <code>every month on the 15th</code> — and also <code>every other week</code>, <code>every 2 weeks on Monday, Thursday</code>, <code>every month on the second Tuesday</code>, and Deckard’s own <code>every quarter</code> and <code>every weekend</code>, any of them ending in <code>when done</code>.</p>
      <p>A date written in a task’s sentence, such as <em>by Friday</em>, is read as a due date when the note is a daily note, but Deckard will not rewrite it: there is no marker it could safely change.</p>
      ${renderReadMore('task-metadata')}
    </section>

    <section id="task-views">
      <h2>Tasks view and Task board</h2>
      <div class="cards">
        <div class="card"><h3>Tasks view</h3><p>The sidebar’s <strong>Tasks</strong> lists the open tasks that need attention soon. <strong>Group by</strong> in its title chooses the axis: due status, priority, status, person, or any tag namespace, such as #context, counting the tags a task inherits from its headings and front matter. Drag a task onto another to rank it, or onto a group to join it — which writes the priority, the status, the due date, or the name into the task itself. <strong>Overdue</strong> lists the most recently slipped first, five at a time, with <strong>Show N more</strong> for the rest; <strong>Upcoming</strong> has a group for each day, and a task dropped on one is due that day. <strong>Done today</strong>, folded at the end, lists what you finished today; unchecking one reopens it. <strong>Reschedule All…</strong> says how full each day is, and can spread a group over the next five weekdays or keep three for today. Parked tasks are not listed.</p></div>
        <div class="card"><h3>Task board</h3><p><code>Deckard: Open Task Board</code> shows tasks as columns by status, priority, due date, person, or the tags of a namespace you choose, as a list, or as a table whose columns you choose and whose headers sort. Dropping a card rewrites the task in its note; the board opens on <code>is:open</code>, and its search box narrows both the board and the list. Parked tasks stay off the board unless its search says <code>is:parked</code>. While few tasks carry a status, the board says so above the columns and offers the due-date grouping, which needs none. The search icon in the Tasks view’s title opens the board to edit what the view lists: change the search, then select <strong>Save to Tasks view</strong>, which keeps what the box shows even before Enter runs it; <strong>Cancel</strong> leaves the view as it is. <strong>List in Tasks view</strong>, in the gear, makes the Tasks view list the board’s search from any board; selected again, the view lists every open task again.</p></div>
        <div class="card"><h3>The board from the keyboard</h3><p>The board is one Tab stop. Arrow keys move between cards; on a focused card, <kbd>x</kbd> completes it, <kbd>t</kbd> and <kbd>m</kbd> make it due today or tomorrow, <kbd>d</kbd> asks for a date, <kbd>1</kbd> to <kbd>5</kbd> set its priority, <kbd>[</kbd> and <kbd>]</kbd> move it a column, <kbd>e</kbd> opens the task editor, <kbd>s</kbd> breaks it into steps, and <kbd>Enter</kbd> opens its line, beside the board with <kbd>Cmd</kbd> or <kbd>Ctrl</kbd>. <kbd>?</kbd> on any page lists its keys. Each card's ⋯ menu checks what the task is now and shows the key for each choice; the keys work in the menu too.</p></div>
        <div class="card"><h3>Editing many at once</h3><p><strong>Bulk edit</strong>, beside a results pane’s heading on a search page, completes, reopens, dates, or tags everything the search found. Deckard lists the results with every one chosen, so unpicking any leaves it alone, and the whole edit is one write.</p></div>
        <div class="card"><h3>What is due</h3><p>A task's due date is written by its distance from today with the date beside it, <strong>Overdue 15 days · 2026-09-08</strong>, wherever a task is listed. The status bar reads <strong>3 due today</strong> while anything is, <strong>2 overdue, 3 due today</strong> when something has slipped, and opens the Tasks view when selected. <code>deckard.taskReminderTime</code> says the same thing once a day, at the first moment VS Code is open on or after an hour you pick. A task more than 30 days overdue (<code>deckard.tasks.needsNewDateAfterDays</code>) leaves the count and the Overdue group for a folded <strong>Needs a new date</strong> group, until it is given one.</p></div>
      </div>
      ${renderReadMore('task-views')}
    </section>

`;
}

/** The Finding group of the rail: search, the query language, query blocks, and the connections between notes. */
function renderFindingSections(): string {
  return `    <section id="search">
      <h2>Search</h2>
      <div class="cards">
        <div class="card"><h3>Find</h3><p><code>Deckard: Find in Notes</code> searches notes, tasks, tags, and saved searches as you type, correcting a misspelled word against the words in your notes. Enter opens the result; a tag row opens its page. With nothing typed it starts with your pinned notes, then the five you opened last. Cmd+Enter opens the highlighted result beside the editor and keeps Find open; Alt+Enter links it where the cursor was; Cmd+. lists everything it can do. A task can be completed or dated without leaving Find. Find learns which result you choose for what you type, and offers it first next time, never above an exact title. When nothing has every word, it offers to capture what you typed to today’s note. A note counts as opened when it stays in the editor a moment, however it was opened, so Find and Recently opened rank what you really read.</p></div>
        <div class="card"><h3>Search pages</h3><p>Opening a tag collects every entry that carries it, with the tags it is most often written with. Any other search opens the same kind of page. Each page has the same search box, with completions and a visual builder that can build anything the box can say: rows and groups, nested, each group matching all or any of its rows, and turned around with <strong>not</strong>.</p></div>
        <div class="card"><h3>Previewing results</h3><p>A result shows three lines of its entry, and <strong>Show all</strong> opens the rest. When the words you searched for are further down, the three lines are the paragraph they are in, after a muted …. The gear’s <strong>Preview</strong> chooses None, 3 lines, or Full, and <strong>Format</strong> chooses rendered or the Markdown source.</p></div>
        <div class="card"><h3>Refine</h3><p>Under the box, <strong>Refine</strong> counts what the results could be narrowed by, five of each kind until <strong>+N more</strong> shows the rest; <strong>Links to</strong> lists the notes they link to. Selecting a value adds it with <strong>AND</strong>; Alt-click adds <strong>AND NOT</strong>, and Shift-click adds <strong>OR</strong>, widening the value chosen before it. Every value writes ordinary query text, so a refined search can be saved or copied into a note.</p></div>
        <div class="card"><h3>Saving a search</h3><p><strong>Save</strong> beside the box keeps a search, which reopens on the page it was saved from and can sit on Home as a widget. Recent searches are kept too. Save stays in place until there is a search to save, and says so when focused. Once saved, <strong>Show Results on Home</strong> adds a widget that lists what it finds, and a saved search’s row on Home offers <strong>Show results</strong> until Home lists it.</p></div>
      </div>
          <p><strong>Taking a result out.</strong> <strong>Export notes</strong> and <strong>Export tasks</strong>, beside Bulk edit over a search page’s notes or tasks and beside Save on the Task Board, takes everything the search found — not only the page on screen — as a Markdown table, a list with a link to each result, or CSV, and copies it or saves it to a file. Its first choice, <strong>Copy as live query block</strong>, copies the search itself as a <code>deckard</code> fence to paste into a note, where it stays up to date. The index itself never leaves the machine.</p>
      ${renderReadMore('search')}
    </section>

    <section id="query">
      <h2>Query language</h2>
      <p>A query is what you type into Find, a search box, a <a href="#query-blocks">query block</a>, or an <a href="#assistants">AI assistant</a>. Terms combine with <code>AND</code>, <code>OR</code>, <code>NOT</code>, and parentheses; <code>AND</code> binds tighter than <code>OR</code>, adjacent terms are joined by an implicit <code>AND</code>, and <code>-</code> or <code>!</code> negates a term. A bare <code>#tag</code> is a tag condition, a bare <code>[[Note]]</code> is a link condition, and a bare word is a text condition.</p>
      <pre><code>(tag = #project/atlas AND tag = @ren-kade) OR (tag = #risk/vendor AND text ~ "elevator")</code></pre>
      <div class="table-scroll"><table><caption>Shorthands, written the way GitHub writes them</caption><thead><tr><th>Shorthand</th><th>Finds</th></tr></thead><tbody>
        <tr><td><code>is:open</code>, <code>is:done</code></td><td>Open or completed tasks.</td></tr>
        <tr><td><code>is:overdue</code>, <code>is:due</code></td><td>Past their due date, or due within seven days.</td></tr>
        <tr><td><code>is:today</code></td><td>What the Tasks view lists under Today: due today, or scheduled for today or earlier and started.</td></tr>
        <tr><td><code>is:needs-date</code></td><td>More than 30 days past their due date, and reading <em>was due …</em>.</td></tr>
        <tr><td><code>is:task</code>, <code>is:note</code></td><td>Every task, or note entries without tasks.</td></tr>
        <tr><td><code>is:blocked</code>, <code>is:blocking</code></td><td>Waiting for an open task, and the tasks they wait for.</td></tr>
        <tr><td><code>is:waiting</code>, <code>is:available</code></td><td>Waiting on someone (<code>#status/waiting</code>, or for someone else), and what can be started now: not blocked, started, not waiting or someday.</td></tr>
        <tr><td><code>is:mine</code></td><td>Tasks for the person <code>deckard.me</code> names, and tasks for nobody in particular.</td></tr>
        <tr><td><code>is:assigned</code>, <code>is:unassigned</code></td><td>Tasks that name a person, and tasks that name nobody.</td></tr>
        <tr><td><code>has:due</code>, <code>no:due</code></td><td>With or without a date. <code>scheduled</code>, <code>start</code>, <code>done</code>, <code>priority</code>, <code>id</code>, and <code>dependsOn</code> work the same way.</td></tr>
        <tr><td><code>in:notes/work</code></td><td>A folder and everything inside it; <code>*</code> and <code>?</code> are wildcards.</td></tr>
        <tr><td><code>is:daily</code>, <code>is:periodic</code></td><td>Written in a daily note, or in a daily, weekly, or monthly note: entries and tasks alike.</td></tr>
        <tr><td><code>is:parked</code></td><td>Parked: in a folder <code>deckard.parked.folders</code> names, or under a tag <code>deckard.parked.tags</code> names. Notes and tasks alike.</td></tr>
        <tr><td><code>is:step</code>, <code>has:steps</code></td><td>Steps of a task, and tasks broken into steps.</td></tr>
      </tbody></table></div>
      <div class="table-scroll"><table><caption>Fields</caption><thead><tr><th>Field</th><th>Matches</th><th>Example</th></tr></thead><tbody>
        <tr><td><code>tag</code></td><td>A tag, including inherited and front-matter tags. <code>*</code> and <code>?</code> are wildcards.</td><td><code>tag = #risk/*</code></td></tr>
        <tr><td><code>link</code></td><td>The entries that link to a note, by its name or an alias. <code>[[Atlas#Decision]]</code> narrows to one heading; a link to a note not written yet counts too.</td><td><code>link = [[Atlas#Decision]]</code></td></tr>
        <tr><td><code>text</code></td><td>Words in a body or a task line. <code>:</code> and <code>~</code> match a substring; <code>=</code> a whole word.</td><td><code>text ~ elevator</code></td></tr>
        <tr><td><code>task</code></td><td><code>open</code>, <code>done</code>, or <code>any</code>. Only tasks satisfy it.</td><td><code>task = open</code></td></tr>
        <tr><td><code>due</code>, <code>scheduled</code>, <code>start</code></td><td>A task date: a day, <code>today</code>, <code>tomorrow</code>, <code>friday</code>, <code>"oct 3"</code> or <code>end-of-month</code>, <code>this-week</code>, <code>next-month</code>, a window such as <code>7d</code>, or <code>none</code>.</td><td><code>due &lt;= friday</code></td></tr>
        <tr><td><code>done</code></td><td>A task’s ✅ date, with windows counted back from today.</td><td><code>done = 7d</code></td></tr>
        <tr><td><code>priority</code></td><td><code>highest</code> to <code>lowest</code>, and <code>none</code>.</td><td><code>priority &gt;= high</code></td></tr>
        <tr><td><code>assignee</code></td><td>Who a task is for, or <code>none</code>. <code>@dana</code> and <code>#person/dana</code> name the same person.</td><td><code>assignee = @dana</code></td></tr>
        <tr><td><code>kind</code></td><td>An entity namespace, <code>person</code> included.</td><td><code>kind = project</code></td></tr>
        <tr><td><code>file</code>, <code>path</code></td><td>A file name or a workspace-relative path, with wildcards.</td><td><code>file = 2026-09-*.md</code></td></tr>
        <tr><td><code>created</code>, <code>updated</code></td><td>A date, a window such as <code>30d</code>, <code>today</code>, <code>friday</code>, <code>this-week</code>, <code>last-month</code>, or a month such as <code>2026-08</code>.</td><td><code>created = last-month</code></td></tr>
      </tbody></table></div>
      <p>Operators are <code>=</code>, <code>!=</code>, <code>~</code> (contains), <code>!~</code>, and <code>&gt;</code> <code>&gt;=</code> <code>&lt;</code> <code>&lt;=</code> for dates and priorities. A window such as <code>7d</code> is compared by its far end, so <code>updated &gt; 7d</code> means within the last seven days and <code>due &lt; 7d</code> means due within the next seven, overdue included. Every operator has an opposite, so any one condition can be negated without <code>NOT</code>.</p>
      <p><code>this-week</code>, <code>last-month</code>, and <code>2026-08</code> name a whole week or month; <code>friday</code> names one day, the next one for task dates and the last one for <code>created</code> and <code>updated</code>.</p>
      ${renderReadMore('query')}
    </section>

    <section id="query-blocks">
      <h2>Query blocks</h2>
      <p>A <code>deckard</code> code fence keeps a live list inside a note. The Markdown preview replaces the fence with what the query matches; the editor shows the totals above it with <strong>Open search page</strong>. <code>Deckard: Insert Query Block…</code> writes one of a saved or recent search at the cursor.</p>
      <pre><code>&#96;&#96;&#96;deckard sort=updated limit=10
tag = #project/atlas AND task = open
&#96;&#96;&#96;</code></pre>
      <p><code>sort=</code> any task column such as <code>due</code> or <code>priority</code>, <code>dir=asc|desc</code>, <code>limit=10</code>, and <code>view=table columns=due,priority,for</code> for the tasks as a table, with <code>noteColumns=links,tasks,#status</code> for the notes as one, follow the language name. Results refresh when any note changes, not only the one holding the block, and the fence stays ordinary Markdown everywhere else. Like any fenced code, a query block is not indexed, so the tags inside it are not counted as uses.</p>
      ${renderReadMore('query-blocks')}
    </section>

    <section id="connections">
      <h2>Related notes and the graph</h2>
      <div class="cards">
        <div class="card"><h3>Related Notes</h3><p>The sidebar ranks the notes most related to the entry your cursor is in: shared tags first, then associated tags, then links and shared wording. Each result explains its own score, and can be linked into the note you are writing. Under them, <strong>Linked from</strong> lists the notes that link here, newest first, each line unfolding onto its section, and <strong>Open as search</strong> opens them all as a search. Each result previews the first line of what it says, with the words it shares with your note marked; the gear sets <strong>Preview</strong> to none, one, or two lines, and <strong>Daily notes</strong> to Hide, which leaves daily, weekly, and monthly notes out of both lists. Parked notes are not suggested unless the note you are in is parked. A note with no tags lists entries with similar wording instead, marked weak, and the tags they use, each with <strong>Add</strong>, which writes it where the cursor is, with Undo.</p></div>
        <div class="card"><h3>Outline</h3><p>A tree of the current note’s headings with the tags on each, and <strong>2/5 · ↩3</strong> for the tasks under a heading that are done and the links that name it. It can follow the cursor, and a heading’s context menu opens or renames its tags. <code>Deckard: Focus Section</code> folds the rest of the note away from one heading, and <code>Deckard: Filter Outline by Tag…</code> keeps only the headings that carry a tag.</p></div>
        <div class="card"><h3>Notes Graph</h3><p>Every note, task, and tag as a map. <strong>Focus → Around this note</strong> draws one note’s neighborhood instead, one to three hops out, following the editor as you move between notes. Reset graph can be undone for a few seconds. Parked notes are hidden until <strong>Show parked</strong> is on. Solid lines are wiki links you wrote; dashed are headings; dotted are shared tags. <strong>Only links I wrote</strong> hides the rest. Zoomed out, each group is named after the tags that set it apart; click a name, or choose it from <strong>Group</strong>, to pick it out.</p></div>
        <div class="card"><h3>Stats</h3><p>What needs attention first: any note Deckard could not read, with why, the links that open no note, the tags that look like one idea spelled twice, and the notes nothing links to (parked notes aside). Then the index totals, each opening what it counts, with how notes, tasks, and open tasks moved over twelve weeks, how much is parked, the tags and notes you open most, how often tags are used, with the tags used once to merge, and which tags are written together.</p></div>
        <div class="card"><h3>Check My Setup</h3><p>When something is not there and you are not sure why, <code>Deckard: Check My Setup</code> writes up what your settings resolve to here: where notes are read from and whether that folder exists, what the last scan found and kept out, which notes could not be read, and whether <code>deckard.me</code> names anyone — each with what to do.</p></div>
      </div>
      ${renderReadMore('connections')}
    </section>

`;
}

/** The Keeping notes group of the rail: Home and pins, renaming and tidying, and the periodic notes. */
function renderKeepingSections(): string {
  return `    <section id="home">
      <h2>Home and pins</h2>
      <p>Three figures at the top say what is <strong>Overdue</strong>, <strong>Due today</strong>, and <strong>Open</strong>; each opens its search. The Dashboard opens on <strong>Home</strong>, a page of widgets you arrange, with a <strong>Tags</strong> tab beside it — the Home/Tags tabs at the top of the page. Widgets cover today’s note, quick add, your tasks, the Tasks view's list, saved and recent searches, recently opened notes, workspace totals, tag pairs, tags without a hub, new tags, what has gone quiet — people, projects, or any namespace, with a next action for a project with nothing open — and pinned notes. <strong>Customize</strong> in the view options rearranges them; each widget’s gear sets how many entries it lists and whether it pages. While Home is in front, the Context sidebar lists every widget it can add: a click adds it at the top of Home, outlined for a moment. <strong>Reset widgets…</strong> asks before it puts back the widgets Home starts with.</p>
      <p><strong>Pinning happens where the note is</strong>, since a note is an entry rather than a file: <code>Deckard: Pin Note to Home</code> pins the entry the cursor is in, the hover on a tagged entry offers it beside its related notes, and a search result offers it on right-click. Each says what it did with <strong>Undo</strong> beside it.</p>
      ${renderReadMore('home')}
    </section>

    <section id="tidy">
      <h2>Renaming and tidying</h2>
      <div class="cards">
        <div class="card"><h3>Rename and merge tags</h3><p><code>Deckard: Rename Tag</code> rewrites a tag everywhere it is written, leaving prose and fenced code alone. Renaming into a tag that exists is a merge, which says first how many entries each has and how many carry both. The box starts from the old name and says, as you type, whether the new one merges or is new.</p></div>
        <div class="card"><h3>Tags that look alike</h3><p>Stats ranks the pairs that look like one idea spelled twice — a name written with two markers, in two namespaces, punctuated two ways, pluralized, or mistyped — each with <strong>Merge</strong> beside it. A tag’s own page says how else it is written, with <strong>Include in search</strong> and <strong>Merge</strong>.</p></div>
        <div class="card"><h3>Hub notes</h3><p>A note whose front matter says <code>describes: [project/atlas]</code> leads that tag’s page, and its other fields are shown as the tag’s properties. Home lists the frequently used tags that have no hub yet, and a tag’s page without one offers <strong>Create hub note</strong> under its title. The entries that link to the hub are listed on the tag’s page too, marked <em>Links the hub note</em>, and the page counts the entries that write the tag’s name as a plain word, with <strong>Show them</strong>.</p></div>
        <div class="card"><h3>Before and after a write</h3><p>A write that reaches more than one note opens in VS Code’s refactor preview first, where any change can be left out. <code>Deckard: Undo Last Change</code> puts those notes back afterwards, leaving alone any note that changed since.</p></div>
        <div class="card"><h3>Extracting and moving</h3><p><code>Deckard: Extract Heading</code> moves a heading, and everything nested under it, into a note of its own and leaves a <code>[[link]]</code> in its place. <code>Deckard: Move to…</code> moves a line, a task and its steps, or a selection under another heading, into today’s note, or into a new note, leaving a link or a <code>[&gt;]</code> task behind.</p></div>
        <div class="card"><h3>Templates</h3><p><code>Deckard: New Note from Template</code> creates a note from a file in your templates folder, filling in the date, the title, and anything the template asks for. Right-click a folder in the Explorer for <strong>Deckard → New Note from Template Here…</strong>, or to leave the folder out of Deckard and bring it back; both new-note commands are in <strong>File → New File…</strong> too.</p></div>
      </div>
      ${renderReadMore('tidy')}
    </section>

    <section id="periodic">
      <h2>Days, weeks, and months</h2>
      <div class="cards">
        <div class="card"><h3>Daily notes</h3><p><code>Deckard: Create Daily Note</code>, or Cmd/Ctrl+Shift+Alt+D, creates or opens today’s note from your template, and the previous and next commands step between the days that have one.</p></div>
        <div class="card"><h3>Carrying tasks forward</h3><p>Set <code>deckard.dailyNote.rollover</code> to <code>move</code> or <code>migrate</code> and a new daily note takes the unfinished tasks of the last week's daily notes with it, oldest first, under a <strong>Carried over</strong> heading. Migrate marks each line left behind <code>[&gt;]</code> with a link to today. A task’s steps come with it, nested under it; a step whose task stays behind comes on its own, at the top level. <code>Deckard: Roll Unfinished Tasks Forward</code> does it on request, with <strong>Undo</strong> beside what it says.</p></div>
        <div class="card"><h3>Reviews</h3><p>A weekly or monthly note opens with a review written into it: what was completed, what slipped, what is coming up next, the notes written and changed, and the tags first seen, with sections of your own from <code>deckard.periodicNote.reviewSections</code>. It is ordinary Markdown, named by the days it covers, and rewritten in place when you run it again.</p></div>
        <div class="card"><h3>Calendar</h3><p>A month in the sidebar, in weeks from the day <code>deckard.calendar.weekStart</code> names, Sunday unless you change it. A dot marks a day with a note; a number counts what is due, orange once the day has passed and gray after 30 days, and an outlined number what is scheduled. Turn on the day panel from the view’s … menu to see the chosen day’s note, tasks, and new notes below the month, each task with a Tomorrow button; a click then chooses a day, and a double-click or Enter opens it. The week beside a row opens that week’s note. A repeating task shows on each later date its rule lands on, marked ↻; <code>deckard.calendar.showRepeats</code> turns that off.</p></div>
        <div class="card"><h3>The calendar page</h3><p><code>Deckard: Open Calendar</code>, <strong>Calendar</strong> in the Pages view, or the button in the Calendar view’s title bar, opens the calendar across the editor: each day lists its tasks by name, the chosen day’s panel sits beside the month, or in the Context sidebar while it is open, and <strong>Week</strong> shows one week in full. Drag a task to another day to move its date there. <code>deckard.calendar.showWeekends</code> leaves the weekends out, here and in the sidebar.</p></div>
      </div>
      ${renderReadMore('periodic')}
    </section>

`;
}

/** The Reference group of the rail: Display, the commands and settings tables built from the manifest, assistants, and privacy. */
function renderReferenceSections(manifest: HelpManifest, platform: NodeJS.Platform): string {
  return `    <section id="zen">
      <h2>Display</h2>
      <p><strong>Display turns Deckard’s own chrome down a step at a time without taking anything away.</strong> <strong>Full</strong> is Deckard as it ships. <strong>Quiet</strong> takes off each theme’s decoration and the lines that teach, such as the search box’s line of syntax, and draws tags as text, at the usual spacing. <strong>Zen</strong> also tightens the spacing, draws cards flat, and leaves out counts and each entry’s file and line. Every button, filter, count, and tag stays where it was, and DECKARD ▾ stays at every step.</p>
      <p>Pick a step from <strong>Display</strong> in the gear on any page that has one, from <code>Deckard: Choose Display…</code>, which shows each step on the open pages as you move through them, or with <code>deckard.display.level</code>. The Zen button in the title bar of any Deckard page goes to Zen and back to the step you were on. Every Display setting (Theme styling, Help text, Tags, Density, Cards, Counts, File &amp; line, and Dates) follows the step until you set it yourself; <strong>Customize…</strong> in the gear opens them in Settings. <strong>Page width</strong>, Limited or Full, has its own row in the gear. Display works with whichever theme you use: it decides how much frame is drawn, a theme decides its colors. <code>Deckard: Choose Theme…</code>, or <strong>Theme</strong> at the top of the same gear, shows each of the eight themes on the open pages as you move through them.</p>
      <p><strong>Two things deliberately stay put.</strong> A task’s due date, priority, and the word <em>overdue</em> are the point of the row rather than chrome, so they never fold; and a search that cannot be parsed still says so. The one thing you give up is the line of query syntax under the search box — the <a href="#query">query language</a> above has all of it.</p>
      ${renderReadMore('zen')}
    </section>

    <section id="commands">
      <h2>Commands</h2>
      <p>Every Deckard command is in the Command Palette under <strong>Deckard:</strong>. A command that acts on “the note” acts on the note in the editor, and one that acts on “the task” acts on the line your cursor is in.</p>
      ${renderCommandTable(manifest, platform)}
      ${renderReadMore('commands')}
    </section>

    <section id="advanced">
      <h2>Settings</h2>
      <p>Every setting below is in VS Code’s settings editor under <strong>Deckard</strong>, and can be set per workspace. This table is built from what Deckard contributes, so it says what your version actually has.</p>
      ${renderSettingsTables(manifest)}
      ${renderReadMore('advanced')}
    </section>

    <section id="assistants">
      <h2>AI assistants</h2>
      <p>Deckard gives assistants inside VS Code four tools — <code>deckard_query</code> and <code>deckard_list_tags</code> to read, <code>deckard_add_task</code> and <code>deckard_change_task</code> to write — so Copilot in agent mode, or any other assistant using VS Code’s language model tools, can answer questions from the index Deckard already keeps. You allow the first call in each session. <code>deckard.assistantTools</code> turns them off.</p>
      <p>For Claude Code and other MCP clients, <code>deckard.mcpServer.enabled</code> runs a local server on 127.0.0.1 with the same tools, and <code>Deckard: Copy MCP Server Setup</code> copies the command that adds it, token included. <code>Deckard: Reset MCP Server Token</code> makes a new token, so every copied setup stops working.</p>
      <p><strong>A write is guarded twice.</strong> An assistant asks before adding or changing a task, every time, and nothing is written until you approve the exact line in the refactor preview Deckard’s own writes use. A change is refused if the line is no longer the task the index knows there, and <code>Deckard: Undo Last Change</code> takes any write back.</p>
      <p class="note">Deckard answers with what it has indexed: paths, lines, titles, and tags. It never sends your notes anywhere itself — an assistant reads the answer, and what that assistant does next is between you and it.</p>
      ${renderReadMore('assistants')}
    </section>

    <section id="privacy">
      <h2>Privacy and source safety</h2>
      <p>Your Markdown is the source of truth. The search cache and a copy of each note as Deckard last read it are stored locally, under this workspace’s storage, and no note content is sent to any service by Deckard.</p>
      <p>Deckard changes a note only when you use a task checkbox, edit a task, extract a tagged heading, rename a note, tag, or heading, carry tasks forward, write a review, edit a search’s results, or approve an entity tag. Every one of those compares what it is about to change with what was indexed, and refuses when the line has moved on. Writes that reach several notes are shown first and can be taken back with <code>Deckard: Undo Last Change</code>.</p>
      <p>Favorites, sorting, pins, widget layout, and view counts live in VS Code’s own storage, never in your notes.</p>
      <p><strong>What names your notes is kept with the workspace.</strong> Favorite tags and people, pinned notes, saved searches, Home’s widgets, view counts, and your task order belong to the folder they describe, so opening another project cannot disturb them. How Deckard looks — sort modes, column counts, layouts, page sizes — is kept for the machine and is the same everywhere. Upgrading from 1.18 or earlier hands what was stored machine-wide to the first workspace you open.</p>
      <p><strong>Deckard never deletes a favorite, a pin, or a saved search on its own.</strong> If what one pointed at is gone, it stays until you run <code>Deckard: Tidy Favorites, Pins, and Saved Searches</code>, which lists what points nowhere and asks first. Only what Deckard derived for itself — view counts and access order — is cleaned up automatically.</p>
      <p><strong>It is copied, too.</strong> A moment after each change Deckard writes a copy of what this workspace remembers into the workspace’s storage and keeps the last twenty. <code>Deckard: Restore Favorites, Pins, and Searches from a Copy</code> offers them newest first. <code>Deckard: Export Favorites, Pins, and Searches</code> writes the same thing to a JSON file of your choosing, and <code>Deckard: Import Favorites, Pins, and Searches</code> reads one back; each says what it holds and asks before replacing anything.</p>
      <p><strong>For an approval at work, or a screen reader.</strong> <a href="#" data-guide-page="security">For your security reviewer</a> says what Deckard sends, stores, and runs; <a href="#" data-guide-page="what-deckard-writes">What Deckard writes</a> lists every change it makes to your files and the setting for each; <a href="#" data-guide-page="accessibility">Accessibility and keyboard</a> covers screen readers, keys, high contrast, zoom, and motion.</p>
      ${renderReadMore('privacy')}
    </section>
`;
}
