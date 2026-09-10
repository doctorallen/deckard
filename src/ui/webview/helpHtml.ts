import * as vscode from 'vscode';

import { getDeckardTheme, getDeckardThemeCss } from './themes';

/**
 * Builds a static, navigable Help page so guidance is available offline.
 */
export function getHelpHtml(
  webview: Pick<vscode.Webview, 'cspSource' | 'asWebviewUri'>,
  extensionUri: vscode.Uri,
): string {
  const nonce = createNonce();
  const logoUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'deckard.svg'))
    .toString();
  const csp = `default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'nonce-${nonce}';`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Deckard Help</title>
<style nonce="${nonce}">
:root { color-scheme: dark; --bg: #050608; --panel: #0D1017; --panel-raised: #121620; --text: #D9E0E4; --muted: #7D8792; --line: #212936; --cyan: #00E5FF; --amber: #FFB000; --green: #33FF33; --favorite-red: #D23C28; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; min-width: 280px; background-color: var(--bg); background-image: linear-gradient(rgba(0, 229, 255, .04) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 229, 255, .04) 1px, transparent 1px); background-size: 24px 24px; color: var(--text); font: 14px/1.55 var(--vscode-font-family, ui-sans-serif, sans-serif); }
main { display: grid; grid-template-columns: minmax(180px, 230px) minmax(0, 800px); gap: 32px; max-width: 1120px; margin: 0 auto; padding: 30px 24px 48px; }
nav { position: sticky; top: 20px; align-self: start; border: 1px solid var(--line); background: var(--panel); padding: 12px; }
.nav-title, .eyebrow, code, .step-number { font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
.nav-title { display: block; margin-bottom: 8px; color: var(--green); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
nav a { display: block; padding: 6px 8px; border-left: 2px solid transparent; color: var(--muted); text-decoration: none; }
nav a:hover, nav a:focus-visible { border-left-color: var(--amber); color: var(--text); background: var(--panel-raised); outline: none; }
article { min-width: 0; }
header { padding-bottom: 20px; border-bottom: 2px solid var(--line); }
.eyebrow { margin: 0 0 6px; color: var(--green); font-size: 11px; letter-spacing: .14em; }
h1, h2, h3 { line-height: 1.2; }
h1 { margin: 0; font-size: 28px; text-transform: uppercase; }
h2 { margin: 38px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--line); color: var(--cyan); font-size: 19px; }
h3 { margin: 0 0 6px; color: var(--text); font-size: 14px; }
p { margin: 0 0 12px; }
.lead { margin: 10px 0 0; max-width: 680px; color: var(--muted); }
.steps, .cards { display: grid; gap: 10px; }
.steps { counter-reset: quick-start; }
.step, .card { min-width: 0; border: 1px solid var(--line); background: var(--panel); padding: 14px; }
.step { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; }
.step-number::before { counter-increment: quick-start; content: counter(quick-start); display: grid; width: 24px; height: 24px; place-items: center; border: 1px solid var(--green); color: var(--green); font-size: 11px; }
.cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.card p:last-child, .step p:last-child { margin-bottom: 0; }
code { overflow-wrap: anywhere; padding: 1px 4px; border: 1px solid var(--line); background: var(--panel-raised); color: var(--green); font-size: .9em; }
.inline-icon, .deckard-logo { display: inline-block; width: 16px; height: 16px; margin: 0 2px; vertical-align: -3px; }
.dashboard-icon { fill: var(--green); }
.favorite-heart { display: inline-block; width: 16px; height: 14px; margin: 0 2px; color: var(--favorite-red); vertical-align: -2px; }
.favorite-heart path { fill: none; stroke: currentColor; stroke-width: 1; vector-effect: non-scaling-stroke; }
.favorite-heart.filled path { fill: currentColor; }
pre { overflow-x: auto; margin: 12px 0; border: 1px solid var(--line); background: var(--panel); padding: 12px; color: var(--text); }
pre code { border: 0; padding: 0; color: inherit; background: transparent; }
ul { margin: 8px 0 0; padding-left: 20px; }
li + li { margin-top: 5px; }
.note { border-left: 3px solid var(--amber); background: var(--panel-raised); padding: 10px 12px; color: var(--muted); }
@media (max-width: 720px) { main { grid-template-columns: 1fr; gap: 20px; padding: 20px 16px 36px; } nav { position: static; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px; } .nav-title { grid-column: 1 / -1; } .cards { grid-template-columns: 1fr; } h1 { font-size: 24px; } }
${getDeckardThemeCss(getDeckardTheme())}
</style>
</head>
<body>
<main>
  <nav aria-label="Help sections">
    <span class="nav-title">Deckard Help</span>
    <a href="#quick-start">Quick start</a>
    <a href="#commands">Commands</a>
    <a href="#tags">Tags and people</a>
    <a href="#frontmatter">Front matter</a>
    <a href="#tasks">Tasks and Dashboard</a>
    <a href="#connections">Find connections</a>
    <a href="#advanced">Settings</a>
    <a href="#privacy">Privacy and safety</a>
  </nav>
  <article>
    <header>
      <p class="eyebrow">DECKARD / FIELD GUIDE</p>
      <h1>Help</h1>
      <p class="lead">Deckard indexes Markdown notes locally, then connects the people, projects, topics, tasks, and links you already write.</p>
    </header>

    <section id="quick-start">
      <h2>Quick start</h2>
      <div class="steps">
        <div class="step"><span class="step-number"></span><div><h3>Open a workspace</h3><p>Deckard indexes saved <code>.md</code> files in every workspace folder. Open a note, then use the Deckard Activity Bar icon for Related Notes.</p></div></div>
        <div class="step"><span class="step-number"></span><div><h3>Add a few tags</h3><p>Use simple tags such as <code>#follow-up</code>; entities are optional. Add <code>@mara-vale</code> for people or namespaced tags such as <code>#project/neon-relay</code> and <code>#management/performance</code> when that extra structure is useful. Type a marker for completion suggestions.</p></div></div>
        <div class="step"><span class="step-number"></span><div><h3>Explore the connections</h3><p>Select the Deckard icon <img class="deckard-logo" src="${logoUri}" alt="Deckard"> in the Activity Bar to open Related Notes. While viewing a Markdown note, select the Dashboard icon <svg class="inline-icon dashboard-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 2h5v5H2zm7 0h5v3H9zm0 5h5v7H9zM2 9h5v5H2z"/></svg> in Related Notes, run <code>Deckard: Open Dashboard</code>, or Cmd/Ctrl-click a tag to open its overview.</p></div></div>
      </div>
    </section>

    <section id="commands">
      <h2>Command reference</h2>
      <p>Open the Command Palette and run any of these commands:</p>
      <ul>
        <li><code>Deckard: Open Dashboard</code> opens workspace totals, tags, and tasks.</li>
        <li><code>Deckard: Show Stats</code> shows index totals and local view counts.</li>
        <li><code>Deckard: Open Help</code> opens this guide.</li>
        <li><code>Deckard: Reindex Workspace</code> performs a full scan of the workspace Markdown scope.</li>
        <li><code>Deckard: Create Daily Note</code> creates or opens today&apos;s note.</li>
        <li><code>Deckard: Extract Tagged Heading</code> moves a tagged heading section into a new note.</li>
        <li><code>Deckard: Show Tag Overview</code> opens a tag overview or, when no tag is supplied, a tag picker.</li>
        <li><code>Deckard: Search Workspace Knowledge</code> searches saved notes, entities, sections, and tasks.</li>
        <li><code>Deckard: Link Current Heading to Entity</code> adds an approved canonical tag to the current heading.</li>
        <li><code>Deckard: Move Inline Tags to Front Matter</code> moves explicit active-note tags into merged note-level front matter.</li>
        <li><code>Deckard: Rename Tag</code> searches indexed tags and replaces the selected tag throughout its source notes.</li>
      </ul>
    </section>

    <section id="tags">
      <h2>Tags and people</h2>
      <div class="cards">
        <div class="card"><h3>Built-in and custom entities</h3><p>Use <code>@person</code>, <code>#project/name</code>, <code>#topic/name</code>, <code>#org/name</code>, and <code>#meeting/name</code> for built-in entity types. Any namespaced tag such as <code>#management/performance</code> creates a new entity namespace on the fly and opens as <strong>Management: Performance</strong>. Namespace aliases can map custom names onto either a built-in or another custom namespace.</p></div>
        <div class="card"><h3>Lightweight tags</h3><p>Use unnamespaced tags such as <code>#follow-up</code> for ordinary labels. They remain distinct from namespaced entities and appear in the Dashboard under <strong>Other tags</strong>.</p></div>
        <div class="card"><h3>Tag associations</h3><p><strong>Associated tags</strong> are Deckard's suggestion that two tags belong together. Writing tags together on one heading, task, or tagged line is the strongest signal because you deliberately put them together. Tags in a heading and its nested headings receive a lighter connection, helping Deckard find context without turning your outline into a rigid category tree. The percentage shows the connection's strength: higher means stronger or repeated evidence. Lightweight tag overviews show associations with a namespace-collapsible <strong>Tree</strong> view or a <strong>Graph</strong>; entity overviews keep one expandable list in the Related Notes sidebar. Hover a percentage to see where its connection came from. Selecting an association opens the target tag with the current tag applied as a second filter, showing the exact source entries that supplied it. Active filters are shown in the page title as <strong>[filter tag] AND [focus tag]</strong>. Use <strong>Clear filter</strong> or reopen the focus tag to return to the full overview. Front-matter and inherited tags provide note context but never create synthetic associations.</p></div>
        <div class="card"><h3>Open tag overviews</h3><p>Tags are highlighted in Markdown. Cmd/Ctrl-click opens an overview with related entries and tasks. A tag on a bullet list item includes its indented child bullets in the related note. In the Dashboard, select anywhere on a tag row except its favorite control. Choose <strong>Tabs</strong> to switch between Notes and Tasks, or <strong>Side by side</strong> to show Notes at 60% width and Tasks at 40%. The Tasks pane opens on <strong>Active</strong> tasks and has an <strong>All</strong>/<strong>Active</strong>/<strong>Completed</strong> filter with safe checkboxes that update the original Markdown task. Right-click a tag in the Dashboard, Tag Overview, or Related Notes sidebar to open its tag actions.</p></div>
        <div class="card"><h3>Rename tags</h3><p>Run <code>Deckard: Rename Tag</code> to search indexed tags, select one, and replace it in every matching source occurrence. You can also right-click any tag in the Dashboard, Tag Overview, or Related Notes sidebar and choose <strong>Rename tag</strong>, or use the separate <strong>Rename</strong> action in a Markdown tag hover. Enter a complete replacement such as <code>#management/new-name</code>, or enter only a new name to keep the selected tag&apos;s marker and namespace. Source changes are rejected when a note changed after it was indexed.</p></div>
        <div class="card"><h3>Favorites</h3><p>In the Dashboard, use the red outlined <svg class="favorite-heart" viewBox="-1 -1 18 16" aria-hidden="true" focusable="false" shape-rendering="crispEdges"><path d="M2 1H6V3H10V1H14V3H16V8H14V10H12V12H10V14H6V12H4V10H2V8H0V3H2Z"/></svg> control to favorite a tag; it becomes solid <svg class="favorite-heart filled" viewBox="-1 -1 18 16" aria-hidden="true" focusable="false" shape-rendering="crispEdges"><path d="M2 1H6V3H10V1H14V3H16V8H14V10H12V12H10V14H6V12H4V10H2V8H0V3H2Z"/></svg> and moves into Favorites. Favorites always appear before other tags in every sort. Select it again to remove the favorite.</p></div>
        <div class="card"><h3>Rank tags</h3><p>To manually order tags, choose <strong>Rank</strong> in the tag sort control, then drag a row above or below another row. Right-click a tag or entity row to choose <strong>Rename tag</strong>; in Rank mode, the same menu also offers <strong>Move to top</strong> or <strong>Move to bottom</strong>. Ordering is stored only in Deckard preferences and never reorders Markdown source.</p></div>
      </div>
    </section>

    <section id="frontmatter">
      <h2>Front matter</h2>
      <p>Note-level YAML front matter supplies context to every heading and task without repeating the same tags in the body.</p>
      <pre><code>---
projects: [neon-relay]
people: [mara-vale]
topics: [signal-integrity]
---</code></pre>
      <p>Supported singular and plural keys are <code>person</code>/<code>people</code>, <code>project</code>/<code>projects</code>, <code>topic</code>/<code>topics</code>, <code>organization</code>/<code>organizations</code>, <code>meeting</code>/<code>meetings</code>, and <code>tag</code>/<code>tags</code>. Values are highlighted and Cmd/Ctrl-clickable, and metadata-only notes still create indexed tag overviews even without a heading or task.</p>
      <p class="note">Use <code>Deckard: Move Inline Tags to Front Matter</code> when the tags apply to the whole note. It merges existing metadata and removes explicit source tags.</p>
    </section>

    <section id="tasks">
      <h2>Tasks and Dashboard</h2>
      <div class="cards">
        <div class="card"><h3>Checklist tasks</h3><p>Deckard recognizes <code>- [ ]</code>, <code>* [ ]</code>, and <code>+ [ ]</code>. Tasks inherit their nearest heading's tags and can add their own.</p></div>
        <div class="card"><h3>Due dates</h3><p>Add an ISO date such as <code>2026-09-12</code>, a month/day date, or <code>next Friday</code>. The Dashboard shows upcoming dates in green and overdue dates in red.</p></div>
        <div class="card"><h3>Task controls and ranking</h3><p>In the Dashboard, use the joined <strong>All</strong>/<strong>Active</strong>/<strong>Completed</strong> status filter or filter by tags, sort by rank or file dates, and use checkboxes to update the original Markdown task safely. Tag Overviews have the same joined status filter and checkboxes. With <strong>Rank</strong> selected in the Dashboard, drag a task above or below another task to set its display order, or right-click it to move it to the top or bottom. Creation-date and update-date sorts are fixed automatically, so dragging is disabled in those modes. Task ranking is stored only in Deckard preferences; it never reorders task lines in your notes.</p></div>
      </div>
    </section>

    <section id="connections">
      <h2>Find connections</h2>
      <div class="cards">
        <div class="card"><h3>Related Notes</h3><p>With a Markdown note active, the sidebar suggests notes that seem to be about the same work. Shared tags are the clearest match; associated tags, Wiki links, and meaningful shared words can also help Deckard find useful connections. Each result's percentage is a relevance estimate, not a measure of completeness: a higher percentage means Deckard found more or stronger reasons to suggest it. Hover the percentage to see those reasons. Tagged headings highlight their entire indexed section, while tagged lines and tagged tasks highlight that line; hover one and choose <strong>Show related notes for [entry]</strong> to focus the sidebar on that entry rather than the whole document. Use <strong>Show whole document</strong> in the selected-note header to restore the normal view. Use its sort control to choose <strong>Relevance</strong>, <strong>Newest</strong>, <strong>Oldest</strong>, or <strong>Most accessed</strong>. Date sorts use note modification time; access counts are stored locally. Matching tag chips open their tag overviews. When a Tag Overview is active, the sidebar instead shows its associated tags, while its matching notes omit a redundant 100% score. You can turn off automatic keyword matching in Settings.</p></div>
        <div class="card"><h3>Wiki links</h3><p>Write <code>[[Project Neon Relay]]</code> to link a note by filename. Completion suggests note titles; Cmd/Ctrl-click opens a unique matching note.</p></div>
        <div class="card"><h3>Workspace search</h3><p>Run <code>Deckard: Search Workspace Knowledge</code> for local full-text results, matching entities, sections, and tasks with source links.</p></div>
        <div class="card"><h3>Stats</h3><p>Run <code>Deckard: Show Stats</code> for index totals and local view counts for tags, entities, and note entries.</p></div>
      </div>
    </section>

    <section id="advanced">
      <h2>Settings</h2>
      <div class="cards">
        <div class="card"><h3>Choose a theme</h3><p><code>deckard.theme</code> defaults to <code>replicant</code>. Choose <code>oblivion</code>, <code>lcars</code>, <code>synthwave</code>, <code>tomcat</code>, or <code>fellowship</code> to restyle all Deckard views.</p></div>
        <div class="card"><h3>Control the note scope</h3><p><code>deckard.notesFolder</code> is optional. Leave it empty to index all workspace Markdown, or set a workspace-relative folder to limit the index.</p></div>
        <div class="card"><h3>Set the daily note template</h3><p><code>deckard.dailyNoteTemplate</code> supplies the text for new daily notes. It defaults to <code># {date}\\n\\n</code>; <code>{date}</code> becomes the local <code>YYYY-MM-DD</code> date.</p></div>
        <div class="card"><h3>Limit related-note matching</h3><p><code>deckard.enableKeywordLinks</code> includes significant shared keywords by default. Disable it to use shared tags and intentional Wiki links only.</p></div>
        <div class="card"><h3>Control tag autocomplete</h3><p><code>deckard.enableTagAutocomplete</code> shows indexed tag and people suggestions by default. Disable it without changing tag indexing, highlighting, or Cmd/Ctrl-click navigation.</p></div>
        <div class="card"><h3>Customize entity aliases</h3><p><code>deckard.entityNamespaceAliases</code> maps one namespace to another, including completely custom targets. For example, <code>{ "proj": "project", "leadership": "management" }</code> makes <code>#proj/atlas</code> a project and collapses <code>#leadership/performance</code> into <code>#management/performance</code>.</p></div>
        <div class="card"><h3>Customize people markers</h3><p><code>deckard.personMarker</code> defaults to <code>@</code>. Set it to <code>~</code> to use <code>~mara-vale</code> for people and keep <code>@inbox</code> as a lightweight tag.</p></div>
        <div class="card"><h3>Inline entries</h3><p><code>deckard.parseInlineTags</code> controls whether tagged non-heading, non-task lines become separate note entries. Consecutive tagged prose lines are grouped into one entry so wrapped text does not create truncated duplicate titles. A tagged unordered or numbered list item includes its indented child bullets. Headings and tasks are always indexed.</p></div>
        <div class="card"><h3>Highlight note sections</h3><p><code>deckard.highlightNoteSections</code> defaults to <code>true</code> and gently highlights tagged note sections in Markdown editors. Disable it when you prefer no visual section treatment; moving the cursor through a tagged entry will still focus Related Notes on that entry.</p></div>
        <div class="card"><h3>Follow the cursor</h3><p><code>deckard.autoSelectNoteSections</code> defaults to <code>true</code> and focuses Related Notes on the tagged entry under the cursor. Disable it to keep the sidebar focused on the whole document unless you choose a tagged entry manually.</p></div>
        <div class="card"><h3>Note title tags</h3><p><code>deckard.tagTitleDisplayMode</code> defaults to <code>inline</code>, keeping source tags in related-note and tag-overview titles as clickable buttons. Set it to <code>separate</code> to pull tags out into dedicated controls after each title.</p></div>
        <div class="card"><h3>Tag associations</h3><p><code>deckard.enableHeadingTagRelationships</code> defaults to <code>true</code> and shows <strong>Associated tags</strong>: connections made when tags are written together or appear in nearby heading context. Entity overviews expose associations through the sidebar list instead of the main page. Set the setting to <code>false</code> to hide association views without changing ordinary tag indexing or note content.</p></div>
      </div>
    </section>

    <section id="privacy">
      <h2>Privacy and source safety</h2>
      <p>Your Markdown remains the source of truth. Deckard writes note text only for explicit task toggles, heading extraction, approved entity links, daily notes, or the inline-tag migration command.</p>
      <p>Search uses a workspace-scoped local SQLite cache. Deckard does not send note content to an AI model or external service.</p>
    </section>
  </article>
</main>
</body>
</html>`;
}

function createNonce(): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}
