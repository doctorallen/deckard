import * as vscode from 'vscode';

import {
  createNonce,
  getBaseCss,
  getPageTailCss,
  zenBodyAttribute,
} from './components';
import { getFavoriteHeartAssetUris } from './icons';

/**
 * What the Help page reads from the extension's own manifest.
 *
 * The commands and settings tables are built from what Deckard actually
 * contributes rather than from a copy of it, so a feature cannot ship with
 * the guide still describing the workspace before it.
 */
export interface HelpManifest {
  commands?: { command: string; title: string }[];
  configuration?: {
    title?: string;
    properties?: Record<
      string,
      { default?: unknown; description?: string; markdownDescription?: string }
    >;
  }[];
  keybindings?: { command: string; key?: string; mac?: string; when?: string }[];
}

/** A short line for what a command is for, beyond the name it goes by. */
const COMMAND_NOTES: Readonly<Record<string, string>> = {
  'deckard.showDashboard': 'Workspace totals, Home, and every tag.',
  'deckard.showNotesGraph':
    'The whole workspace as a map, or one note’s neighbourhood.',
  'deckard.showTaskBoard': 'Tasks as columns, or as a ranked list.',
  'deckard.showStats':
    'Index totals, notes nothing links to, and tags that look alike.',
  'deckard.showHelp': 'This guide.',
  'deckard.showLog': 'What Deckard did, and how long each step took.',
  'deckard.reindexWorkspace': 'Reads every note again.',
  'deckard.createDailyNote':
    'Creates or opens today’s note, carrying yesterday’s unfinished tasks in when asked to.',
  'deckard.pinNote': 'Pins the note the cursor is in to Home.',
  'deckard.unpinNote': 'Lets that pin go.',
  'deckard.previousDailyNote': 'The nearest daily note before this one.',
  'deckard.nextDailyNote': 'The nearest daily note after this one.',
  'deckard.openWeeklyNote': 'This week’s note, with its review written in.',
  'deckard.openMonthlyNote': 'This month’s note, with its review written in.',
  'deckard.writeReview':
    'Writes, or brings up to date, the review in this week’s or this month’s note.',
  'deckard.rollTasksForward':
    'Carries unfinished tasks from earlier daily notes into today’s.',
  'deckard.capture': 'Adds a task to today’s note from anywhere.',
  'deckard.captureUnderHeading': 'Adds a task under a heading you choose.',
  'deckard.editTask': 'Opens the task on the cursor’s line, field by field.',
  'deckard.addTask': 'The same editor, where there is no task yet.',
  'deckard.newNoteFromTemplate': 'A new note from one of your templates.',
  'deckard.copyMcpSetup': 'Copies the command that adds Deckard to Claude Code.',
  'deckard.resetMcpToken': 'Makes a new token, so old setups stop working.',
  'deckard.extractHeading':
    'Moves a tagged section into a note of its own, leaving a link behind.',
  'deckard.showTagOverview': 'Opens a tag’s search page.',
  'deckard.search': 'A search page, ready for a search.',
  'deckard.searchWorkspace': 'Finds notes, tasks, and tags as you type.',
  'deckard.searchNotes': 'Opens a search page on a query you write.',
  'deckard.linkCurrentHeading': 'Adds an approved entity tag to this heading.',
  'deckard.moveTagsToFrontmatter': 'Moves a note’s inline tags into its front matter.',
  'deckard.renameTag': 'Renames a tag everywhere it is written.',
  'deckard.mergeTag': 'Merges one tag into another, after saying what that costs.',
  'deckard.renameHeading':
    'Renames the heading the cursor is in and carries its links along.',
  'deckard.undoLastChange': 'Puts the notes back as they were before the last write.',
  'deckard.agenda.editQuery': 'What the Tasks view lists, opened on the Task Board to try and change.',
  'deckard.agenda.setGrouping': 'What the Tasks view’s groups are.',
  'deckard.outline.enableFollowCursor': 'Selects the heading the cursor is in.',
  'deckard.outline.disableFollowCursor': 'Leaves the Outline where you put it.',
};

/** The commands the manifest contributes, as a table of what each is for. */
function renderCommandTable(manifest: HelpManifest): string {
  const commands = (manifest.commands ?? []).filter((command) =>
    command.title.startsWith('Deckard:'),
  );
  if (commands.length === 0) {
    return '';
  }
  const keys = new Map(
    (manifest.keybindings ?? [])
      .filter((binding) => binding.key)
      .map((binding) => [binding.command, binding]),
  );
  const rows = commands
    .map((command) => {
      const binding = keys.get(command.command);
      const shortcut = binding
        ? `<br><span class="shortcut">${escapeHtml(
            `${binding.mac ?? binding.key} on macOS, ${binding.key} elsewhere`,
          )}</span>`
        : '';
      return `<tr><td><strong>${escapeHtml(
        command.title.replace(/^Deckard: /, ''),
      )}</strong>${shortcut}</td><td>${escapeHtml(
        COMMAND_NOTES[command.command] ?? '',
      )}</td></tr>`;
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
          const description =
            property.description ?? property.markdownDescription ?? '';
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

/** The escaping the page's own markup uses; nothing here is user content. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds a static, navigable Help page so guidance is available offline.
 */
export function getHelpHtml(
  webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>,
  extensionUri: vscode.Uri,
  manifest: HelpManifest = {},
): string {
  const nonce = createNonce();
  const logoUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'deckard.svg'))
    .toString();
  const favoriteHeartUris = getFavoriteHeartAssetUris(webview, extensionUri);
  const csp = `default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'nonce-${nonce}';`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Deckard Help</title>
<style nonce="${nonce}">${getBaseCss()}
html { scroll-behavior: smooth; }
nav { position: sticky; top: 20px; align-self: start; border: 1px solid var(--line); background: var(--panel); padding: 12px; }
.nav-title, .step-number { font-family: var(--font-mono); }
.nav-title { display: block; margin-bottom: 8px; color: var(--green); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
nav a { display: block; padding: 6px 8px; border-left: 2px solid transparent; color: var(--muted); text-decoration: none; }
nav a:hover, nav a:focus-visible { border-left-color: var(--amber); color: var(--text); background: var(--panel-raised); outline: none; }
/* Prose here is full of inline code chips, each a border and a pixel of padding
   taller than its text; a line box the chips fit inside keeps two on
   neighbouring lines from touching. */
article { min-width: 0; line-height: 1.55; }
h1, h2, h3 { line-height: 1.2; }
p { margin: 0 0 12px; }
.steps, .cards { display: grid; gap: 10px; }
.steps { counter-reset: quick-start; }
.step, .card { min-width: 0; border: 1px solid var(--line); background: var(--panel); padding: 14px; }
.step { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; }
.step-number::before { counter-increment: quick-start; content: counter(quick-start); display: grid; width: 24px; height: 24px; place-items: center; border: 1px solid var(--green); color: var(--green); font-size: 11px; }
.card p:last-child, .step p:last-child { margin-bottom: 0; }
.card:target { border-color: var(--amber); }
/* A card jumped to from the map is not hidden under the sticky navigation. */
.card[id] { scroll-margin-top: 20px; }
code { overflow-wrap: anywhere; padding: 1px 4px; border: 1px solid var(--line); background: var(--panel-raised); color: var(--green); font-size: .9em; }
.inline-icon, .deckard-logo { display: inline-block; width: 16px; height: 16px; margin: 0 2px; vertical-align: -3px; }
.dashboard-icon { fill: var(--green); }
.favorite-heart { display: inline-block; width: 16px; height: 16px; margin: 0 2px; color: var(--favorite-red); background-color: currentColor; -webkit-mask: url("${favoriteHeartUris.outline}") center / contain no-repeat; mask: url("${favoriteHeartUris.outline}") center / contain no-repeat; vertical-align: -3px; }
.favorite-heart.filled { -webkit-mask-image: url("${favoriteHeartUris.filled}"); mask-image: url("${favoriteHeartUris.filled}"); }
pre { overflow-x: auto; margin: 12px 0; border: 1px solid var(--line); background: var(--panel); padding: 12px; color: var(--text); }
pre code { border: 0; padding: 0; color: inherit; background: transparent; }
/* A cell breaks between words, never inside one, so a column is at least as
   wide as its longest word — a setting's name, a command's — and the table
   shares the rest by content. Broken anywhere, a column could be crushed to
   five characters a line, and every column with a long sentence beside it was.
   A table too wide for the page scrolls in .table-scroll instead. */
th, td, table code { overflow-wrap: break-word; }
ul { margin: 8px 0 0; padding-left: 20px; }
li + li { margin-top: 5px; }
.note { border-left: 3px solid var(--amber); background: var(--panel-raised); padding: 10px 12px; color: var(--muted); }
/* Reference tables: commands, markers, query fields, settings. */
table { width: 100%; margin: 12px 0; border-collapse: collapse; font-size: 13px; }
caption { margin-bottom: 6px; color: var(--muted); font: 10px var(--font-mono); letter-spacing: .08em; text-align: left; text-transform: uppercase; }
th, td { border-bottom: 1px solid var(--line); padding: 6px 10px 6px 0; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { color: var(--cyan); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
td:first-child { white-space: normal; }
tbody tr:hover { background: var(--panel); }
/* A group's name inside the settings table: a heading row, ruled under like
   the column header, so a group starts somewhere the eye can find. */
.table-group th { padding: 24px 0 6px; border-bottom: 1px solid var(--line-strong); color: var(--amber); font: 12px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; }
.table-group:hover { background: transparent; }
.table-scroll { overflow-x: auto; }
/* The navigation groups its sections, so a long guide stays scannable. */
.nav-group { display: block; margin: 10px 0 2px; color: var(--muted); font: 10px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; }
nav a.nav-sub { padding-left: 16px; font-size: 12px; }
section { scroll-margin-top: 20px; }
@media (max-width: 720px) { main { grid-template-columns: 1fr; gap: 20px; padding: 20px 16px 36px; } nav { position: static; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px; } .nav-title { grid-column: 1 / -1; } .cards { grid-template-columns: 1fr; } h1 { font-size: 24px; } }

/* Help is a two-column reference: navigation beside the article. */
main {
  display: grid;
  grid-template-columns: minmax(180px, 230px) minmax(0, 800px);
  gap: 32px;
  max-width: 1120px;
  padding: 30px 24px 48px;
}
header { display: block; padding-bottom: 20px; border-bottom: 2px solid var(--line); }
h1 { font-size: 28px; line-height: 1.2; overflow-wrap: normal; }
h2 { margin: 38px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--line); color: var(--cyan); font-size: 19px; line-height: 1.2; }
h3 { margin: 0 0 6px; font-size: 14px; line-height: 1.2; }
.eyebrow { margin: 0 0 6px; }
.cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.card { cursor: default; }
@media (max-width: 900px) {
  main { grid-template-columns: 1fr; gap: 20px; padding: 20px 16px 36px; }
  h1 { font-size: 24px; }
  .cards { grid-template-columns: 1fr; }
}
${getPageTailCss()}
</style>
</head>
<body${zenBodyAttribute()}>
<main>
  <nav aria-label="Help sections">
    <span class="nav-title">Deckard Help</span>
    <a href="#quick-start">Quick start</a>
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
    <a class="nav-sub" href="#zen">Zen mode</a>
    <a class="nav-sub" href="#commands">Commands</a>
    <a class="nav-sub" href="#advanced">Settings</a>
    <a class="nav-sub" href="#assistants">AI assistants</a>
    <a class="nav-sub" href="#privacy">Privacy and safety</a>
  </nav>
  <article>
    <header>
      <p class="eyebrow">DECKARD / FIELD GUIDE</p>
      <h1>Help</h1>
      <p class="lead">Deckard indexes Markdown notes locally, then connects the people, projects, topics, tasks, and links you already write. Nothing leaves your machine.</p>
    </header>

    <section id="quick-start">
      <h2>Quick start</h2>
      <p><strong>Rather see it than read it?</strong> <code>Deckard: Create a Sample Workspace</code> copies seven small notes, written the way Deckard reads them, into a folder you choose and offers to open it. Its README says what each shows and what to try first.</p>
      <div class="steps">
        <div class="step"><span class="step-number"></span><div><h3>Open a workspace</h3><p>Deckard indexes saved <code>.md</code> files in every workspace folder. Open a note, then use the Deckard icon <img class="deckard-logo" src="${logoUri}" alt="Deckard"> in the Activity Bar for Related Notes, the Outline, Tasks, and the Calendar.</p></div></div>
        <div class="step"><span class="step-number"></span><div><h3>Write a few tags</h3><p>Plain tags such as <code>#follow-up</code> are enough. Add <code>@mara-vale</code> for people, or namespaced tags such as <code>#project/neon-relay</code>, when that structure earns its keep. Typing <code>#</code> or <code>@</code> suggests the tags you already use.</p></div></div>
        <div class="step"><span class="step-number"></span><div><h3>Follow the connections</h3><p>Cmd/Ctrl-click a tag to open its search page, run <code>Deckard: Open Dashboard</code> for Home and every tag, or open the Notes Graph to see what is attached to what.</p></div></div>
      </div>
      <p class="note">Deckard only reads saved files. Save a note to see it in the index, and run <code>Deckard: Show Log</code> if anything looks slow: every step over 100&nbsp;ms is listed there.</p>
    </section>

    <section id="tags">
      <h2>Tags and people</h2>
      <div class="cards">
        <div class="card"><h3>Lightweight tags</h3><p>A plain <code>#tag</code> on a heading, a task, or a line of prose is indexed with no setup. Tag names take letters, numbers, <code>_</code>, <code>-</code>, and <code>/</code> namespace segments; a number alone is not a tag, so a date such as <code>#2026</code> stays text.</p></div>
        <div class="card"><h3>People and entities</h3><p><code>@mara-vale</code> names a person. <code>#project/…</code>, <code>#topic/…</code>, <code>#organization/…</code>, and <code>#meeting/…</code> name entities; any other namespace becomes one on first use. <code>deckard.personMarker</code> changes the marker, and <code>deckard.entityNamespaceAliases</code> folds one namespace into another.</p></div>
        <div class="card"><h3>Inheriting tags</h3><p>A task takes the tags of the heading above it, and a heading takes the tags of the headings above that, along with the note’s front matter. A tag written in a body does not travel: not up to the heading, not across to its neighbours.</p></div>
        <div class="card"><h3>Associated tags</h3><p>Tags written together on one heading, task, or line are remembered as related, and tags that meet under a shared heading count more lightly. Related Notes and Refine both rank with that evidence, normalized so a common tag is not promoted for being common.</p></div>
        <div class="card"><h3>Favorites and order</h3><p>The heart <span class="favorite-heart" aria-hidden="true"></span> on a tag keeps it at the top of the Dashboard’s tag list. Favorites always appear before the rest, whatever the sort; a custom sort is dragged, or moved with <strong>Move to top</strong> and <strong>Move to bottom</strong> on a tag’s context menu.</p></div>
        <div class="card"><h3>In the editor</h3><p>Tags are clickable, hovering one says how many notes and tasks use it and lists its most recent entries, and a heading shows how many entries share its tags. <code>deckard.editor.hoverPreviews</code> and <code>deckard.editor.referenceCounts</code> turn those off.</p></div>
      </div>
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
    </section>

    <section id="links">
      <h2>Links and embeds</h2>
      <div class="cards">
        <div class="card"><h3>Wiki links</h3><p><code>[[Note]]</code> names a note by its file name without <code>.md</code>, or by an alias. <code>[[Note#Heading]]</code> opens a heading and <code>[[Note#^marker]]</code> one line. Typing <code>[[</code> completes titles and aliases; typing <code>#^</code> completes the markers a note carries.</p></div>
        <div class="card"><h3>Embeds</h3><p><code>![[Note]]</code> on a line of its own draws that note in the Markdown preview; <code>![[Note#Heading]]</code> draws the section, <code>![[Note#^id]]</code> the marked line, and <code>![[#Heading]]</code> a heading of the note you are in. An embed inside a sentence stays the text you typed.</p></div>
        <div class="card"><h3>Renaming keeps links</h3><p>Renaming or moving a note rewrites every link that named it, in the same step, so one Undo takes back both. <code>Deckard: Rename Heading</code> does the same for a heading. <code>deckard.updateLinksOnRename</code> turns it off.</p></div>
        <div class="card"><h3>Broken links</h3><p>A link to a note that does not exist is marked in the editor with a <strong>Create note</strong> fix; a name two notes share is a warning, since it opens neither. <code>Deckard: Show Stats</code> lists the notes nothing links to.</p></div>
      </div>
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
    </section>

    <section id="tasks">
      <h2>Writing tasks</h2>
      <div class="cards">
        <div class="card"><h3>Checklist tasks</h3><p>A task is an unordered checklist item: <code>- [ ] Send the proposal</code>, with <code>-</code>, <code>*</code>, or <code>+</code>, and <code>[x]</code> when it is done. Checking a box anywhere in Deckard writes the same checked edit into the note, including the ✅ date and the next occurrence of a repeating task.</p></div>
        <div class="card"><h3>The task editor</h3><p><code>Deckard: Edit Task</code> on a task line — and <code>Deckard: Add Task</code> anywhere else — opens every field at once: description, status, dates, priority, repeat rule, assignee, and a tag. Dates are taken in plain words: <code>friday</code>, <code>next monday</code>, <code>in 3 days</code>, <code>+2w</code>. It is on the lightbulb too, as <strong>Edit task…</strong>.</p></div>
        <div class="card"><h3>Typing metadata</h3><p>Type <code>/</code> after a space inside a task to pick a due date, a priority, a repeat rule, or a dependency without remembering the markers. Suggestions use the format the task already uses, or <code>deckard.tasks.metadataFormat</code> for a task with none.</p></div>
        <div class="card"><h3>Who a task is for</h3><p>Write <code>👤 @dana</code> on a task — or <code>[assignee:: @dana]</code> in a Dataview vault — to say who it is for. A name in the words is a mention, not an assignment. Search with <code>assignee = @dana</code>, <code>is:assigned</code>, or <code>is:unassigned</code>, and set <code>deckard.me</code> so <code>is:mine</code> finds yours — a task for nobody in particular is yours too.</p></div>
        <div class="card"><h3>Capture</h3><p><code>Deckard: Capture</code> adds a task to today’s note from anywhere, completing tags as you type; <code>Deckard: Capture Under a Heading</code> puts it under a heading you choose in any note.</p></div>
        <div class="card"><h3>Dependencies</h3><p><code>🆔 a1</code> names a task, and <code>⛔ a1</code> waits for it. A task is blocked while something it waits for is still open, which <code>is:blocked</code> and <code>is:blocking</code> search and the Tasks view says beneath the task.</p></div>
      </div>
    </section>

    <section id="task-metadata">
      <h2>Task metadata</h2>
      <p>Deckard reads the <a href="https://publish.obsidian.md/tasks">Obsidian Tasks</a> formats, both the emoji one and Dataview fields, and writes back whichever a task already uses.</p>
      <div class="table-scroll"><table><caption>Markers, in the order Deckard writes them</caption><thead><tr><th>Marker</th><th>Dataview</th><th>Means</th></tr></thead><tbody>
        <tr><td>🔺 ⏫ 🔼 🔽 ⏬</td><td><code>[priority:: high]</code></td><td>Priority, highest to lowest</td></tr>
        <tr><td>🔁 every week</td><td><code>[repeat:: every week]</code></td><td>Repeat rule; completing writes the next occurrence</td></tr>
        <tr><td>🛫 2026-09-20</td><td><code>[start:: 2026-09-20]</code></td><td>Not actionable before this day</td></tr>
        <tr><td>⏳ 2026-09-21</td><td><code>[scheduled:: 2026-09-21]</code></td><td>The day you plan to work on it</td></tr>
        <tr><td>📅 2026-09-22</td><td><code>[due:: 2026-09-22]</code></td><td>Due date</td></tr>
        <tr><td>✅ 2026-09-23</td><td><code>[completion:: 2026-09-23]</code></td><td>Written when the task is completed</td></tr>
        <tr><td>🆔 a1 / ⛔ b2</td><td><code>[id:: a1]</code></td><td>This task’s name, and what it waits for</td></tr>
      </tbody></table></div>
      <p>A date written in a task’s sentence, such as <em>by Friday</em>, is read as a due date when the note is a daily note, but Deckard will not rewrite it: there is no marker it could safely change.</p>
    </section>

    <section id="task-views">
      <h2>Tasks view and Task board</h2>
      <div class="cards">
        <div class="card"><h3>Tasks view</h3><p>The sidebar’s <strong>Tasks</strong> lists the open tasks that need attention soon. <strong>Group by</strong> in its title chooses the axis: due status, priority, status, or person. Drag a task onto another to rank it, or onto a group to join it — which writes the priority, the status, the due date, or the name into the task itself.</p></div>
        <div class="card"><h3>Task board</h3><p><code>Deckard: Open Task Board</code> shows tasks as columns by status, priority, due date, or person, as a list, or as a table whose columns you choose and whose headers sort. Dropping a card rewrites the task in its note; the board opens on <code>is:open</code>, and its search box narrows both the board and the list.</p></div>
        <div class="card"><h3>Editing many at once</h3><p><strong>Bulk Edit</strong>, beside a results pane’s heading on a search page, completes, reopens, dates, or tags everything the search found. Deckard lists the results with every one chosen, so unpicking any leaves it alone, and the whole edit is one write.</p></div>
        <div class="card"><h3>What is due</h3><p>The status bar reads <strong>3 due today</strong> while anything is, and opens the Tasks view when selected. <code>deckard.taskReminderTime</code> says the same thing once a day at an hour you pick.</p></div>
      </div>
    </section>

    <section id="search">
      <h2>Search</h2>
      <div class="cards">
        <div class="card"><h3>Find</h3><p><code>Deckard: Search Notes</code> searches notes, tasks, tags, and saved searches as you type, correcting a misspelled word against the words in your notes. Enter opens the result; a tag row opens its page.</p></div>
        <div class="card"><h3>Search pages</h3><p>Opening a tag collects every entry that carries it, with the tags it is most often written with. Any other search opens the same kind of page. Each page has the same search box, with completions and a visual builder.</p></div>
        <div class="card"><h3>Refine</h3><p>Under the box, <strong>Refine</strong> counts what the results could be narrowed by. Selecting a value adds it with <strong>AND</strong>; Alt-click adds <strong>AND NOT</strong>, and Shift-click adds <strong>OR</strong>, widening the value chosen before it. Every value writes ordinary query text, so a refined search can be saved or copied into a note.</p></div>
        <div class="card"><h3>Saving a search</h3><p><strong>Save</strong> beside the box keeps a search, which reopens on the page it was saved from and can sit on Home as a widget. Recent searches are kept too.</p></div>
      </div>
          <p><strong>Taking a result out.</strong> <strong>Export</strong>, beside Bulk Edit over a search page’s notes or tasks and beside Save on the Task Board, takes everything the search found — not only the page on screen — as a Markdown table, a list with a link to each result, or CSV, and copies it or saves it to a file. The index itself never leaves the machine.</p>
    </section>

    <section id="query">
      <h2>Query language</h2>
      <p>A query is what you type into Find, a search box, a <a href="#query-blocks">query block</a>, or an <a href="#assistants">AI assistant</a>. Terms combine with <code>AND</code>, <code>OR</code>, <code>NOT</code>, and parentheses; <code>AND</code> binds tighter than <code>OR</code>, adjacent terms are joined by an implicit <code>AND</code>, and <code>-</code> or <code>!</code> negates a term. A bare <code>#tag</code> is a tag condition and a bare word is a text condition.</p>
      <pre><code>(tag = #project/atlas AND tag = @ren-kade) OR (tag = #risk/vendor AND text ~ "elevator")</code></pre>
      <div class="table-scroll"><table><caption>Shorthands, written the way GitHub writes them</caption><thead><tr><th>Shorthand</th><th>Finds</th></tr></thead><tbody>
        <tr><td><code>is:open</code>, <code>is:done</code></td><td>Open or completed tasks.</td></tr>
        <tr><td><code>is:overdue</code>, <code>is:due</code></td><td>Past their due date, or due within seven days.</td></tr>
        <tr><td><code>is:task</code>, <code>is:note</code></td><td>Every task, or note entries without tasks.</td></tr>
        <tr><td><code>is:blocked</code>, <code>is:blocking</code></td><td>Waiting for an open task, and the tasks they wait for.</td></tr>
        <tr><td><code>is:mine</code></td><td>Tasks for the person <code>deckard.me</code> names, and tasks for nobody in particular.</td></tr>
        <tr><td><code>is:assigned</code>, <code>is:unassigned</code></td><td>Tasks that name a person, and tasks that name nobody.</td></tr>
        <tr><td><code>has:due</code>, <code>no:due</code></td><td>With or without a date. <code>scheduled</code>, <code>start</code>, <code>done</code>, <code>priority</code>, <code>id</code>, and <code>dependsOn</code> work the same way.</td></tr>
        <tr><td><code>in:notes/work</code></td><td>A folder and everything inside it; <code>*</code> and <code>?</code> are wildcards.</td></tr>
      </tbody></table></div>
      <div class="table-scroll"><table><caption>Fields</caption><thead><tr><th>Field</th><th>Matches</th><th>Example</th></tr></thead><tbody>
        <tr><td><code>tag</code></td><td>A tag, including inherited and front-matter tags. <code>*</code> and <code>?</code> are wildcards.</td><td><code>tag = #risk/*</code></td></tr>
        <tr><td><code>text</code></td><td>Words in a body or a task line. <code>:</code> and <code>~</code> match a substring; <code>=</code> a whole word.</td><td><code>text ~ elevator</code></td></tr>
        <tr><td><code>task</code></td><td><code>open</code>, <code>done</code>, or <code>any</code>. Only tasks satisfy it.</td><td><code>task = open</code></td></tr>
        <tr><td><code>due</code>, <code>scheduled</code>, <code>start</code></td><td>A task date: a day, <code>today</code>, <code>tomorrow</code>, a window such as <code>7d</code>, or <code>none</code>.</td><td><code>due &lt; today</code></td></tr>
        <tr><td><code>done</code></td><td>A task’s ✅ date, with windows counted back from today.</td><td><code>done = 7d</code></td></tr>
        <tr><td><code>priority</code></td><td><code>highest</code> to <code>lowest</code>, and <code>none</code>.</td><td><code>priority &gt;= high</code></td></tr>
        <tr><td><code>assignee</code></td><td>Who a task is for, or <code>none</code>. <code>@dana</code> and <code>#person/dana</code> name the same person.</td><td><code>assignee = @dana</code></td></tr>
        <tr><td><code>kind</code></td><td>An entity namespace, <code>person</code> included.</td><td><code>kind = project</code></td></tr>
        <tr><td><code>file</code>, <code>path</code></td><td>A file name or a workspace-relative path, with wildcards.</td><td><code>file = 2026-09-*.md</code></td></tr>
        <tr><td><code>created</code>, <code>updated</code></td><td>A date, a window such as <code>30d</code>, or <code>today</code>.</td><td><code>updated &gt; 7d</code></td></tr>
      </tbody></table></div>
      <p>Operators are <code>=</code>, <code>!=</code>, <code>~</code> (contains), <code>!~</code>, and <code>&gt;</code> <code>&gt;=</code> <code>&lt;</code> <code>&lt;=</code> for dates and priorities. A window such as <code>7d</code> is compared by its far end, so <code>updated &gt; 7d</code> means within the last seven days and <code>due &lt; 7d</code> means due within the next seven, overdue included. Every operator has an opposite, so any one condition can be negated without <code>NOT</code>.</p>
    </section>

    <section id="query-blocks">
      <h2>Query blocks</h2>
      <p>A <code>deckard</code> code fence keeps a live list inside a note. The Markdown preview replaces the fence with what the query matches; the editor shows the totals above it with <strong>Open in search</strong>.</p>
      <pre><code>&#96;&#96;&#96;deckard sort=updated limit=10
tag = #project/atlas AND task = open
&#96;&#96;&#96;</code></pre>
      <p><code>sort=</code> any task column such as <code>due</code> or <code>priority</code>, <code>dir=asc|desc</code>, <code>limit=10</code>, and <code>view=table columns=due,priority,for</code> for the tasks as a table follow the language name. Results refresh when any note changes, not only the one holding the block, and the fence stays ordinary Markdown everywhere else. Like any fenced code, a query block is not indexed, so the tags inside it are not counted as uses.</p>
    </section>

    <section id="connections">
      <h2>Related notes and the graph</h2>
      <div class="cards">
        <div class="card"><h3>Related Notes</h3><p>The sidebar ranks the notes most related to the entry your cursor is in: shared tags first, then associated tags, then links and shared wording. Each result explains its own score, and can be linked into the note you are writing.</p></div>
        <div class="card"><h3>Outline</h3><p>A tree of the current note’s headings with the tags on each. It can follow the cursor, and a heading’s context menu opens or renames its tags.</p></div>
        <div class="card"><h3>Notes Graph</h3><p>Every note, task, and tag as a map. <strong>Focus → Around this note</strong> draws one note’s neighbourhood instead, one to three hops out, following the editor as you move between notes.</p></div>
        <div class="card"><h3>Stats</h3><p>Index totals, the notes nothing links to, the tags that look like one idea spelled twice, and the tags and entries you open most. It also lists any note Deckard could not read, with why, so a search that comes back short does not just look like a bad search.</p></div>
        <div class="card"><h3>Check My Setup</h3><p>When something is not there and you are not sure why, <code>Deckard: Check My Setup</code> writes up what your settings resolve to here: where notes are read from and whether that folder exists, what the last scan found and kept out, which notes could not be read, and whether <code>deckard.me</code> names anyone — each with what to do.</p></div>
      </div>
    </section>

    <section id="home">
      <h2>Home and pins</h2>
      <p>The Dashboard opens on <strong>Home</strong>, a page of widgets you arrange, with a <strong>Tags</strong> tab beside it — the Home/Tags tabs at the top of the page. Widgets cover today’s note, quick add, your tasks, the Agenda, saved and recent searches, recently opened notes, workspace totals, tag pairs, tags without a hub, new tags, people gone quiet, and pinned notes. <strong>Customize</strong> in the view options rearranges them; each widget’s gear sets how many entries it lists and whether it pages.</p>
      <p><strong>Pinning happens where the note is</strong>, since a note is an entry rather than a file: <code>Deckard: Pin Note to Home</code> pins the entry the cursor is in, the hover on a tagged entry offers it beside its related notes, and a search result offers it on right-click. Each says what it did with <strong>Undo</strong> beside it.</p>
    </section>

    <section id="tidy">
      <h2>Renaming and tidying</h2>
      <div class="cards">
        <div class="card"><h3>Rename and merge tags</h3><p><code>Deckard: Rename Tag</code> rewrites a tag everywhere it is written, leaving prose and fenced code alone. Renaming into a tag that exists is a merge, which says first how many entries each has and how many carry both.</p></div>
        <div class="card"><h3>Tags that look alike</h3><p>Stats ranks the pairs that look like one idea spelled twice — a name written with two markers, in two namespaces, punctuated two ways, pluralized, or mistyped — each with <strong>Merge</strong> beside it.</p></div>
        <div class="card"><h3>Hub notes</h3><p>A note whose front matter says <code>describes: [project/atlas]</code> leads that tag’s page, and its other fields are shown as the tag’s properties. Home lists the frequently used tags that have no hub yet.</p></div>
        <div class="card"><h3>Before and after a write</h3><p>A write that reaches more than one note opens in VS Code’s refactor preview first, where any change can be left out. <code>Deckard: Undo Last Change</code> puts those notes back afterwards, leaving alone any note that changed since.</p></div>
        <div class="card"><h3>Extracting a section</h3><p><code>Deckard: Extract Tagged Heading</code> moves a tagged section, and everything nested under it, into a note of its own and leaves a <code>[[link]]</code> in its place.</p></div>
        <div class="card"><h3>Templates</h3><p><code>Deckard: New Note from Template</code> creates a note from a file in your templates folder, filling in the date, the title, and anything the template asks for.</p></div>
      </div>
    </section>

    <section id="periodic">
      <h2>Days, weeks, and months</h2>
      <div class="cards">
        <div class="card"><h3>Daily notes</h3><p><code>Deckard: Create Daily Note</code> creates or opens today’s note from your template, and the previous and next commands step between the days that have one.</p></div>
        <div class="card"><h3>Carrying tasks forward</h3><p>Set <code>deckard.dailyNote.rollover</code> to <code>move</code> or <code>copy</code> and a new daily note takes the unfinished tasks of every earlier daily note with it, oldest first. <code>Deckard: Roll Unfinished Tasks Forward</code> does it on request, with <strong>Undo</strong> beside what it says.</p></div>
        <div class="card"><h3>Reviews</h3><p>A weekly or monthly note opens with a review written into it: what was completed, what slipped, the notes written and changed, and the tags first seen. It is ordinary Markdown, named by the days it covers, and rewritten in place when you run it again.</p></div>
        <div class="card"><h3>Calendar</h3><p>A month in the sidebar, Sunday to Saturday. A dot marks a day with a note and a number counts what is due, in orange once the day has passed. The week beside a row opens that week’s note.</p></div>
      </div>
    </section>

    <section id="zen">
      <h2>Zen mode</h2>
      <p><strong>Zen mode turns Deckard’s own chrome down without taking anything away.</strong> The decorative labels and the grid backdrop go, the borders and headings thin out, and each row’s file name and line fold away until you hover or focus the row. Every button, filter, count, and tag stays exactly where it was, and the folded text is still read aloud, still found by find-in-page, and comes back the moment you tab to the row.</p>
      <p>Turn it on from the gear on the Dashboard, a search page, or the Task board, from <code>Deckard: Zen Mode</code> in the Command Palette, or by setting <code>deckard.zenMode</code>. It is one setting for every Deckard view, and it works with whichever theme you use — zen decides how much frame is drawn, a theme decides its colours.</p>
      <p><strong>Two things deliberately stay put.</strong> A task’s due date, priority, and the word <em>overdue</em> are the point of the row rather than chrome, so they never fold; and a search that cannot be parsed still says so. The one thing you give up is the line of query syntax under the search box — the <a href="#query">query language</a> above has all of it.</p>
    </section>

    <section id="commands">
      <h2>Commands</h2>
      <p>Every Deckard command is in the Command Palette under <strong>Deckard:</strong>. A command that acts on “the note” acts on the note in the editor, and one that acts on “the task” acts on the line your cursor is in.</p>
      ${renderCommandTable(manifest)}
    </section>

    <section id="advanced">
      <h2>Settings</h2>
      <p>Every setting below is in VS Code’s settings editor under <strong>Deckard</strong>, and can be set per workspace. This table is built from what Deckard contributes, so it says what your version actually has.</p>
      ${renderSettingsTables(manifest)}
    </section>

    <section id="assistants">
      <h2>AI assistants</h2>
      <p>Deckard gives assistants inside VS Code four tools — <code>deckard_query</code> and <code>deckard_list_tags</code> to read, <code>deckard_add_task</code> and <code>deckard_change_task</code> to write — so Copilot in agent mode, or any other assistant using VS Code’s language model tools, can answer questions from the index Deckard already keeps. You allow the first call in each session. <code>deckard.assistantTools</code> turns them off.</p>
      <p>For Claude Code and other MCP clients, <code>deckard.mcpServer.enabled</code> runs a local server on 127.0.0.1 with the same tools, and <code>Deckard: Copy MCP Server Setup</code> copies the command that adds it, token included. <code>Deckard: Reset MCP Server Token</code> makes a new token, so every copied setup stops working.</p>
      <p><strong>A write is guarded twice.</strong> An assistant asks before adding or changing a task, every time, and nothing is written until you approve the exact line in the refactor preview Deckard’s own writes use. A change is refused if the line is no longer the task the index knows there, and <code>Deckard: Undo Last Change</code> takes any write back.</p>
      <p class="note">Deckard answers with what it has indexed: paths, lines, titles, and tags. It never sends your notes anywhere itself — an assistant reads the answer, and what that assistant does next is between you and it.</p>
    </section>

    <section id="privacy">
      <h2>Privacy and source safety</h2>
      <p>Your Markdown is the source of truth. The index and the search cache are stored locally, under this workspace’s storage, and no note content is sent to any service by Deckard.</p>
      <p>Deckard changes a note only when you use a task checkbox, edit a task, extract a tagged heading, rename a note, tag, or heading, carry tasks forward, write a review, edit a search’s results, or approve an entity tag. Every one of those compares what it is about to change with what was indexed, and refuses when the line has moved on. Writes that reach several notes are shown first and can be taken back with <code>Deckard: Undo Last Change</code>.</p>
      <p>Favorites, sorting, pins, widget layout, and view counts live in VS Code’s own storage, never in your notes.</p>
      <p><strong>What names your notes is kept with the workspace.</strong> Favorite tags and people, pinned notes, saved searches, Home’s widgets, view counts, and your task order belong to the folder they describe, so opening another project cannot disturb them. How Deckard looks — sort modes, column counts, layouts, page sizes — is kept for the machine and is the same everywhere. Upgrading from 1.18 or earlier hands what was stored machine-wide to the first workspace you open.</p>
      <p><strong>Deckard never deletes a favorite, a pin, or a saved search on its own.</strong> If what one pointed at is gone, it stays until you run <code>Deckard: Tidy Favorites, Pins, and Saved Searches</code>, which lists what points nowhere and asks first. Only what Deckard derived for itself — view counts and access order — is cleaned up automatically.</p>
      <p><strong>It is copied, too.</strong> A moment after each change Deckard writes a copy of what this workspace remembers into the workspace’s storage and keeps the last twenty. <code>Deckard: Restore Favorites, Pins, and Searches from a Copy</code> offers them newest first. <code>Deckard: Export</code> writes the same thing to a JSON file of your choosing, and <code>Deckard: Import</code> reads one back; each says what it holds and asks before replacing anything.</p>
    </article>
</main>
</body>
</html>`;
}

