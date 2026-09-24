import * as vscode from 'vscode';

export const deckardThemes = [
  'corpo',
  'replicant',
  'oblivion',
  'lcars',
  'synthwave',
  'tomcat',
  'fellowship',
  'cooper',
] as const;

export type DeckardTheme = (typeof deckardThemes)[number];

// Rows lift onto the raised panel on hover. Tags only slide: they are buttons,
// so each theme's button hover colors them, and a shared dark ground under a
// theme's inverted button text would hide it.
const contentHoverCss =
  '.entity-row, .tag-row, .tag-open, .note .tag-list button, .card, .note, .task, .task-row, .note-row, .saved-filter-row, .stat-row { transition: background-color 120ms ease, transform 120ms ease; } .tag-open, .note .tag-list button { display: inline-block; } .entity-row:hover, .tag-row:hover, .card:hover, .note:hover, .task:hover, .task-row:hover, .note-row:hover, .saved-filter-row:hover, .stat-row:hover { background: var(--panel-raised); transform: translateX(3px); } .tag-open:hover, .note .tag-list button:hover { transform: translateX(3px); } .inline-tag, .inline-tag:hover, .inline-tag:focus-visible { transform: none; }';

const replicantHoverCss = `${contentHoverCss} .note:hover, .note-row:hover { border-color: var(--amber); } .card .tag-open:not(:hover):not(:focus-visible), .note-row .tag-open:not(:hover):not(:focus-visible) { color: var(--text); }`;

/**
 * Corpo, the plain default: every token comes from the VS Code color theme in
 * use, light or dark, and the page drops Deckard's grid, glows, clipped
 * corners, and uppercase monospace labels, so its views read like the rest of
 * the editor. The page itself is transparent, so VS Code's own editor or side
 * bar background shows through.
 */
const corpoCss = `
:root {
  --bg: var(--vscode-editor-background);
  --bg-dark: var(--vscode-editor-background);
  --panel: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  --panel-bg: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  --panel-raised: var(--vscode-list-hoverBackground, var(--vscode-editorWidget-background));
  /* VS Code's own hover pair: its focus blue on its hover grey is about 3:1,
     which is a border color, not a text one. */
  --hover-bg: var(--vscode-list-hoverBackground, var(--vscode-editorWidget-background));
  --hover-fg: var(--vscode-foreground);
  /* A chosen tab or filter takes VS Code's own button colors, so Corpo keeps
     looking like the editor around it. */
  --chosen-bg: var(--vscode-button-background);
  --chosen-fg: var(--vscode-button-foreground);
  --panel-deep: var(--vscode-input-background, var(--vscode-editor-background));
  --text: var(--vscode-foreground);
  --muted: var(--vscode-descriptionForeground);
  --line: var(--vscode-widget-border, var(--vscode-panel-border));
  --slate-border: var(--vscode-widget-border, var(--vscode-panel-border));
  --line-strong: var(--vscode-input-border, var(--vscode-panel-border));
  --cyan: var(--vscode-textLink-foreground);
  --cyan-bright: var(--vscode-textLink-foreground);
  --amber: var(--vscode-focusBorder);
  --amber-bright: var(--vscode-focusBorder);
  --amber-dim: var(--vscode-descriptionForeground);
  --green: var(--vscode-charts-green);
  --toxic-green: var(--vscode-charts-green);
  --favorite-red: var(--vscode-charts-red);
  --favorite: var(--vscode-textLink-foreground);
  --warning-orange: var(--vscode-editorWarning-foreground);
  --slate-olive: var(--vscode-panel-border);
  --grid-line: transparent;
  --font-display: var(--vscode-font-family, system-ui, sans-serif);
  --font-mono: var(--vscode-font-family, system-ui, sans-serif);
  --edge: 1px;
  --control-height: 26px;
}
/* A transparent page shows VS Code's own background only while its color
   scheme matches the editor's; otherwise the browser paints a dark backdrop. */
:root:has(> body.vscode-light), :root:has(> body.vscode-high-contrast-light) { color-scheme: light; }
:root:has(> body.vscode-dark), :root:has(> body.vscode-high-contrast) { color-scheme: dark; }
/* The page paints its own background: VS Code gives some webviews no backdrop
   of their own, where a transparent page composites to nothing. */
body { background: var(--vscode-editor-background); }
body:has(.sidebar-header) { background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
main { border: 0; box-shadow: none; }
header { border-bottom: 1px solid var(--line); }
/* Corpo's eyebrows and titles read as written too; the working labels
   already do in every theme. */
body * { text-transform: none !important; letter-spacing: normal !important; }
h1 { font-size: 20px; font-weight: 600; }
.eyebrow { color: var(--muted); }
code, pre, kbd, .markdown { font-family: var(--vscode-editor-font-family, monospace); }
.metric::before { display: none; }
.metric-value { color: var(--text); font-weight: 600; }
.metric, .card, .note, .task, .tag-row, .task-row, .note-row, .entity-row, .saved-filter-row, .stat-row, .empty, .view-panel, .query-workspace, .query-facets, .search-notice, .selected-task-tags, .board-column { clip-path: none; border-radius: 4px; box-shadow: none; }
.tag-row:hover, .task-row:hover, .note-row:hover, .entity-row:hover, .saved-filter-row:hover, .stat-row:hover { background: var(--vscode-list-hoverBackground); transform: none; }
.tag-filter-menu, .view-options-menu, .rank-context-menu, .tag-context-menu, .relevance-tooltip, .sidebar-association-tooltip, .query-suggestions { clip-path: none; border-radius: 4px; border-color: var(--vscode-widget-border, var(--line)); background: var(--vscode-editorWidget-background); color: var(--vscode-editorWidget-foreground, var(--text)); box-shadow: 0 2px 8px var(--vscode-widget-shadow); }
button, select, input[type="text"], input[type="search"], .tag-filter summary { border-radius: 2px; }
button, .tag-filter summary { border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
button:hover, .tag-filter summary:hover { border-color: var(--vscode-button-border, transparent); background: var(--vscode-button-secondaryHoverBackground); color: var(--vscode-button-secondaryForeground); }
button.active, button.active:hover, button[aria-selected="true"], .dashboard-tabs button[aria-selected="true"], .segmented button[aria-pressed="true"], .pagination .page-number.is-current { border-color: var(--vscode-focusBorder); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); box-shadow: inset 0 -2px 0 var(--vscode-focusBorder); }
.query-bar-row .query-apply, .query-bar-row .query-apply:not(:hover):not(:focus-visible) { border-color: var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
/* A count inside a chosen button follows its text, not the muted color. */
.active .filter-count, .active .query-facet-count, .active .tag-count, [aria-selected="true"] .filter-count, [aria-selected="true"] .tag-count { color: inherit; opacity: .75; }
.query-bar-row .query-apply:hover { background: var(--vscode-button-hoverBackground); color: var(--vscode-button-foreground); }
input[type="text"], input[type="search"], textarea { border: 1px solid var(--vscode-input-border, transparent); background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
input[type="text"]:focus, input[type="search"]:focus { border-color: var(--vscode-focusBorder); background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
input::placeholder, textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
select, select:hover { border: 1px solid var(--vscode-dropdown-border, transparent); background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); }
button:focus-visible, select:focus-visible, input:focus-visible, summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
input[type="checkbox"], .task input { accent-color: var(--vscode-button-background); }
/* Tags read as links, as VS Code shows references, and a tag written inside
   a title keeps a hairline so it stays distinct from the words around it. */
.tag-open, .inline-tag, .task-title .inline-tag { background: transparent; color: var(--vscode-textLink-foreground); }
.tag-open { border-color: transparent; }
.inline-tag, .task-title .inline-tag { border-color: var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 3px; }
.tag-open:hover, .inline-tag:hover, .task-title .inline-tag:hover { border-color: transparent; background: var(--vscode-list-hoverBackground); color: var(--vscode-textLink-activeForeground); }
.query-suggestion:hover, .query-suggestion.active { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
.zoom-controls button, .zoom-readout, .reset-graph-settings { background: var(--vscode-editorWidget-background); }
`;

/** Returns the configured theme, falling back when workspace settings are stale. */
export function getDeckardTheme(): DeckardTheme {
  const configuredTheme = vscode.workspace
    .getConfiguration('deckard')
    .get<string>('theme', 'corpo');

  return isDeckardTheme(configuredTheme) ? configuredTheme : 'corpo';
}

/** Provides theme-level tokens after a webview's local layout styles. */
export function getDeckardThemeCss(theme: DeckardTheme): string {
  if (theme === 'corpo') {
    return corpoCss;
  }

  if (theme === 'replicant') {
    return replicantHoverCss;
  }

  if (theme === 'synthwave') {
    return `
:root {
  --bg-dark: #090713;
  --bg: #100c20;
  --panel-bg: #15102f;
  --panel: #15102f;
  --panel-raised: #211748;
  --panel-deep: #070611;
  --text: #e7e8ff;
  --muted: #8e8bb3;
  --slate-border: #33295e;
  --line: #4c3d87;
  --line-strong: #8f75ff;
  --cyan-bright: #7ce6f0;
  --cyan: #3fd8ea;
  --amber-bright: #ff8b55;
  --amber: #f25aa9;
  --amber-dim: #8c4d92;
  --green: #7ce3ec;
  --toxic-green: #7ce3ec;
  --favorite-red: #f2559e;
  --warning-orange: #ff8b55;
  --font-display: var(--vscode-font-family, 'Arial Narrow', 'Avenir Next Condensed', sans-serif);
  --font-mono: var(--vscode-editor-font-family, 'Share Tech Mono', 'JetBrains Mono', 'Space Mono', monospace);
}
body {
  background-color: var(--bg-dark);
  background-image: linear-gradient(rgba(0, 229, 255, .11) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 45, 149, .1) 1px, transparent 1px), linear-gradient(135deg, transparent 0 49%, rgba(143, 117, 255, .05) 49.5%, transparent 50%), repeating-linear-gradient(0deg, rgba(255, 255, 255, .028) 0, rgba(255, 255, 255, .028) 1px, transparent 1px, transparent 4px);
  background-size: 32px 32px, 32px 32px, 96px 96px, 100% 4px;
}
main { border: 1px solid rgba(76, 61, 135, .72); border-top: 2px solid var(--cyan); border-bottom-color: var(--favorite-red); background: rgba(9, 7, 19, .38); box-shadow: 0 0 24px rgba(255, 45, 149, .14), inset 0 0 0 1px rgba(0, 229, 255, .08); }
main::before, main::after { content: ''; position: absolute; height: 3px; pointer-events: none; }
main::before { top: -2px; right: 24px; width: 92px; background: var(--favorite-red); box-shadow: -18px 0 0 var(--cyan); clip-path: polygon(0 0, 100% 0, calc(100% - 6px) 100%, 6px 100%); }
main::after { bottom: -2px; left: 24px; width: 72px; background: var(--amber-bright); box-shadow: 84px 0 0 var(--cyan); }
header { position: relative; border-color: var(--line); box-shadow: 0 2px 0 rgba(255, 45, 149, .32), 0 0 16px rgba(0, 229, 255, .12); }
header::after { content: ''; position: absolute; right: 0; bottom: -2px; width: 64px; height: 3px; background: var(--favorite-red); box-shadow: -72px 0 0 var(--cyan); }
h1, h2, h3, .metric-value, .metric-label, .task-count, .section-count { font-family: var(--font-display); letter-spacing: .08em; text-transform: uppercase; text-shadow: 0 0 12px rgba(95, 247, 255, .18); }
h1 { letter-spacing: .12em; }
.eyebrow, .tag-group h3 { color: var(--amber-bright); }
.telemetry-line span:last-child { color: var(--cyan-bright); }
.section-heading { border-bottom: 1px solid rgba(0, 229, 255, .3); padding-bottom: 6px; }
.section-readout { color: var(--cyan); }
button, select, .tag-open, .view-options summary { border-color: var(--cyan); border-radius: 0; background: rgba(7, 6, 17, .94); color: var(--cyan-bright); font-family: var(--font-mono); letter-spacing: .04em; clip-path: polygon(0 5px, 5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%); }
button:hover, button.active, select:hover, .tag-open:hover, .view-options summary:hover { border-color: var(--cyan); background: var(--cyan); color: var(--bg-dark); box-shadow: 0 0 12px rgba(0, 229, 255, .28); }
:root { --hover-bg: var(--cyan); --hover-fg: var(--bg-dark); }
input[type='checkbox'] { accent-color: var(--cyan); }
.metric, .card, .note, .task, .tag-row, .task-row, .note-row, .entity-row, .saved-filter-row, .view-panel { border-color: var(--line); border-radius: 0; background: rgba(21, 16, 47, .92); box-shadow: inset 3px 0 0 var(--favorite-red), 0 0 0 1px rgba(0, 229, 255, .1); clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%); }
.card:hover, .card:focus-within, .note:hover, .note:focus-within { clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% + var(--reach) - 8px), calc(100% - 8px) calc(100% + var(--reach)), 0 calc(100% + var(--reach))); }
.metric:nth-child(3n + 2), .card:nth-child(3n + 2), .note:nth-child(3n + 2), .task:nth-child(3n + 2), .tag-row:nth-child(3n + 2), .task-row:nth-child(3n + 2), .note-row:nth-child(3n + 2), .entity-row:nth-child(3n + 2), .saved-filter-row:nth-child(3n + 2), .view-panel:nth-child(3n + 2) { box-shadow: inset 3px 0 0 var(--cyan), 0 0 0 1px rgba(255, 45, 149, .1); }
.metric::before { border-bottom-color: var(--cyan); color: var(--amber-dim); }
.metric:nth-child(3n + 2)::before { border-bottom-color: var(--favorite-red); }
.metric:nth-child(3n)::before { border-bottom-color: var(--amber-bright); }
.card:hover, .note:hover, .task:hover, .tag-row:hover, .task-row:hover, .note-row:hover, .entity-row:hover, .saved-filter-row:hover { border-color: var(--cyan); background: var(--panel-raised); box-shadow: inset 4px 0 0 var(--cyan), 0 0 14px rgba(0, 229, 255, .2); }
.tag-name, .task-title a { color: var(--cyan-bright); }
.tag-filter summary, .tag-filter-search { border-color: var(--line); background: var(--panel-deep); }
.tag-filter summary:hover, .tag-filter-search:focus { border-color: var(--favorite-red); color: var(--favorite-red); }
.tag-filter-menu, .rank-context-menu { border-color: var(--cyan); background: var(--panel-deep); box-shadow: 0 0 20px rgba(0, 229, 255, .16); }
.drag-ghost { border-color: var(--cyan); background: var(--panel-raised); }
.drag-placeholder { border-color: var(--favorite-red); }
.empty { border-color: var(--line); background: var(--panel-deep); clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%); }
.favorite-toggle { border-color: var(--favorite-red); background: rgba(255, 45, 149, .08); color: var(--favorite-red); }
.favorite-toggle.favorite { border-color: var(--favorite-red); background: var(--favorite-red); color: var(--bg-dark); }
.favorite-toggle:hover, .favorite-toggle:focus-visible { border-color: var(--favorite-red); background: var(--favorite-red); color: var(--bg-dark); }
${contentHoverCss} .card .tag-open:not(:hover):not(:focus-visible), .note-row .tag-open:not(:hover):not(:focus-visible) { color: var(--text); }
`;
  }

  if (theme === 'tomcat') {
    return `
:root {
  --bg-dark: #010401;
  --bg: #030703;
  --panel-bg: #061006;
  --panel: #061006;
  --panel-raised: #0a1a09;
  --panel-deep: #000200;
  --text: #ccfa7b;
  --muted: #82aa51;
  --slate-border: #1e5724;
  --line: #278a31;
  --line-strong: #54db51;
  --cyan-bright: #8ce87c;
  --cyan: #6fd96c;
  --amber-bright: #f0bf47;
  --amber: #d89d31;
  --amber-dim: #896b28;
  --green: #8ce87c;
  --toxic-green: #8ce87c;
  --favorite-red: #e24b26;
  --warning-orange: #e24b26;
  --font-display: var(--vscode-editor-font-family, ui-monospace, monospace);
  --font-mono: var(--vscode-editor-font-family, ui-monospace, monospace);
}
body { background-image: repeating-linear-gradient(0deg, rgba(118, 255, 99, .025) 0, rgba(118, 255, 99, .025) 1px, transparent 1px, transparent 4px); }
main { border-color: var(--line); box-shadow: 0 0 22px rgba(41, 165, 47, .08); }
header { border-color: var(--line-strong); box-shadow: 0 1px 0 rgba(118, 255, 99, .2); }
h1, h2, h3, .metric-value, .metric-label, .task-count, .section-count { font-family: var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
button, select, .tag-open, .view-options summary { border-color: var(--line-strong); border-radius: 0; background: rgba(3, 13, 3, .94); color: var(--green); font-family: var(--font-mono); letter-spacing: .06em; }
button, select { text-transform: uppercase; }
button:hover, button.active, select:hover, .tag-open:hover, .view-options summary:hover { background: var(--green); border-color: var(--green); color: #071006; }
:root { --hover-bg: var(--green); --hover-fg: #071006; }
.metric, .card, .note, .task, .tag-row, .task-row, .note-row, .entity-row, .saved-filter-row, .view-panel { border-color: var(--line); border-radius: 0; background: rgba(3, 12, 3, .9); box-shadow: inset 2px 0 0 var(--green); }
.metric::before { border-bottom-color: var(--green); }
.metric:nth-child(3n)::before { border-bottom-color: var(--favorite-red); }
.card:hover, .note:hover, .task:hover, .tag-row:hover, .task-row:hover, .note-row:hover, .entity-row:hover, .saved-filter-row:hover { border-color: var(--green); background: var(--panel-raised); box-shadow: inset 3px 0 0 var(--green), 0 0 14px rgba(118, 255, 99, .16); }
.favorite-toggle { border-color: var(--favorite-red); background: transparent; color: var(--favorite-red); }
.favorite-toggle.favorite { border-color: var(--favorite-red); background: transparent; color: var(--favorite-red); }
`;
  }

  if (theme === 'fellowship') {
    return `
:root {
  /* The only light palette. Without this it keeps the base sheet's dark
     scheme, so scrollbars and select popups render dark on parchment. */
  color-scheme: light;
  --bg-dark: #d6cda9;
  --bg: #e6deb9;
  --panel-bg: #f1e8c8;
  --panel: #f1e8c8;
  --panel-raised: #faf1d4;
  --panel-deep: #c5b980;
  --text: #29341d;
  --muted: #616a45;
  --slate-border: #7d8750;
  --line: #9c9a5c;
  --line-strong: #55713d;
  --cyan-bright: #55713d;
  --cyan: #6e8748;
  --amber-bright: #c28a32;
  --amber: #9b6b2b;
  --amber-dim: #6f542a;
  --green: #587a3d;
  --toxic-green: #587a3d;
  --favorite-red: #a94d35;
  --favorite: #8a5a14;
  --warning-orange: #a94d35;
  --font-display: Georgia, 'Times New Roman', serif;
  --font-mono: var(--vscode-editor-font-family, ui-monospace, monospace);
}
body { background-image: none; }
main { border-color: var(--slate-border); box-shadow: none; }
header { border-color: var(--line-strong); }
h1, h2, h3 { font-family: var(--font-display); color: #3d4d28; letter-spacing: .04em; }
button, select, .tag-open, .view-options summary { border-color: var(--slate-border); border-radius: 5px; background: #e9dfb7; color: var(--text); }
button:hover, button.active, select:hover, .tag-open:hover, .view-options summary:hover { border-color: var(--green); background: var(--green); color: #fff7db; }
:root { --hover-bg: var(--green); --hover-fg: #fff7db; }
.metric, .card, .note, .task, .tag-row, .task-row, .note-row, .entity-row, .saved-filter-row, .view-panel { border-color: var(--slate-border); border-radius: 5px; background: #f1e8c8; box-shadow: inset 3px 0 0 var(--green); }
.metric::before { border-bottom-color: var(--green); }
.metric:nth-child(3n + 2)::before { border-bottom-color: var(--amber); }
.metric:nth-child(3n)::before { border-bottom-color: var(--favorite-red); }
.card:hover, .note:hover, .task:hover, .tag-row:hover, .task-row:hover, .note-row:hover, .entity-row:hover, .saved-filter-row:hover { border-color: var(--green); background: var(--panel-raised); box-shadow: inset 4px 0 0 var(--green), 0 0 0 1px rgba(85, 113, 61, .2); }
`;
  }

  // Cooper, after Interstellar: the Endurance's spare instrument panels, TARS's
  // white-on-black readouts, and Gargantua's gold at the edge of a starfield.
  if (theme === 'cooper') {
    return `
:root {
  --bg-dark: #030405;
  --bg: #07090b;
  --panel-bg: #0d1013;
  --panel: #0d1013;
  --panel-raised: #171b1f;
  --panel-deep: #020304;
  --text: #ebe8e1;
  --muted: #8f959a;
  --slate-border: #2b3136;
  --line: #3b4248;
  --line-strong: #a7afb4;
  --cyan-bright: #d6e4ee;
  --cyan: #9fbfd4;
  --amber-bright: #f3c46e;
  --amber: #dca24a;
  --amber-dim: #7c6134;
  --green: #b5cfa5;
  --toxic-green: #b5cfa5;
  --favorite-red: #d9673b;
  --warning-orange: #e27d3c;
  --font-display: 'Helvetica Neue', Helvetica, Arial, var(--vscode-font-family, sans-serif);
  --font-mono: var(--vscode-editor-font-family, ui-monospace, monospace);
}
/* The gold glow is drawn once over the whole panel; on a page shorter than
   its panel, such as the sidebar, it would otherwise tile in bands. */
html { min-height: 100%; }
body {
  background-color: var(--bg-dark);
  background-image: radial-gradient(ellipse at 88% -8%, rgba(220, 162, 74, .16), transparent 42%), radial-gradient(circle at 1px 1px, rgba(235, 232, 225, .22) 1px, transparent 1.5px), radial-gradient(circle at 1px 1px, rgba(159, 191, 212, .14) 1px, transparent 1.5px);
  background-size: 100% 100%, 97px 89px, 53px 61px;
  background-position: 0 0, 13px 21px, 37px 7px;
  background-repeat: no-repeat, repeat, repeat;
}
main { border-color: var(--slate-border); border-top-color: var(--line-strong); box-shadow: 0 18px 40px rgba(0, 0, 0, .45); }
header { border-color: var(--line); }
h1, h2, h3, .metric-label, .task-count, .section-count { font-family: var(--font-display); font-weight: 300; letter-spacing: .22em; text-transform: uppercase; }
h1 { font-weight: 200; letter-spacing: .3em; }
.metric-value { font-family: var(--font-display); font-weight: 300; letter-spacing: .04em; }
.eyebrow { color: var(--amber); letter-spacing: .28em; }
/* Controls are squared, and so are the ends of a group of segments. */
:root { --control-radius: 0; }
button, select, .tag-open, .view-options summary { border-color: var(--line); border-radius: 0; background: transparent; color: var(--text); font-family: var(--font-display); letter-spacing: .12em; }
button, select { text-transform: uppercase; }
button:hover, button.active, select:hover, .tag-open:hover, .view-options summary:hover { border-color: var(--text); background: var(--text); color: var(--bg-dark); }
:root { --hover-bg: var(--text); --hover-fg: var(--bg-dark); }
/* A tag's weight reads as a gold instrument, against faint empty steps. */
.tag-weight-rail-segment.filled { background: var(--amber); }
input[type='checkbox'] { accent-color: var(--amber); }
.metric, .card, .note, .task, .tag-row, .task-row, .note-row, .entity-row, .saved-filter-row, .view-panel { border-color: var(--slate-border); border-radius: 0; background: rgba(13, 16, 19, .92); box-shadow: inset 2px 0 0 var(--cyan); }
.metric:nth-child(3n), .card:nth-child(3n), .note-row:nth-child(3n), .task-row:nth-child(3n), .view-panel:nth-child(3n) { box-shadow: inset 2px 0 0 var(--amber); }
.metric::before { border-bottom-color: var(--line-strong); }
.metric:nth-child(3n)::before { border-bottom-color: var(--amber); }
.card:hover, .note:hover, .task:hover, .tag-row:hover, .task-row:hover, .note-row:hover, .entity-row:hover, .saved-filter-row:hover { border-color: var(--line-strong); background: var(--panel-raised); box-shadow: inset 3px 0 0 var(--amber); }
.empty { border-color: var(--slate-border); background: var(--panel-deep); }
.favorite-toggle { border-color: var(--amber); background: transparent; color: var(--amber); }
.favorite-toggle.favorite { border-color: var(--amber); background: var(--amber); color: var(--bg-dark); }
${contentHoverCss} .card .tag-open:not(:hover):not(:focus-visible), .note-row .tag-open:not(:hover):not(:focus-visible) { color: var(--text); }
`;
  }

  // Oblivion, after the film's light table and bubbleship HUDs: a black ground
  // under a faint graph grid, hairline steel frames with bracket corners,
  // thin tracked-out readouts, and one warm orange kept for alerts.
  if (theme === 'oblivion') {
    return `
:root {
  --bg-dark: #04080b;
  --bg: #04080b;
  --panel-bg: #081115;
  --panel: #081115;
  --panel-raised: #0f1d24;
  --panel-deep: #020608;
  --text: #dce6ea;
  --muted: #6f8a95;
  --slate-border: #12262e;
  --line: #1b3a45;
  --line-strong: #3f8296;
  --cyan-bright: #5fd3e4;
  --cyan: #3fb6c9;
  --amber-bright: #ff6a35;
  --amber: #e8562a;
  --amber-dim: #8c4326;
  --green: #cdbe95;
  --toxic-green: #cdbe95;
  --favorite-red: #ff5a30;
  --warning-orange: #ff9a3c;
  --font-display: 'Helvetica Neue', Helvetica, Arial, var(--vscode-font-family, sans-serif);
  --font-mono: var(--vscode-editor-font-family, ui-monospace, monospace);
}
/* Graph paper rather than a dot screen: a fine grid inside a coarser one, both
   faint enough that the black ground still reads as empty space. */
body {
  background-color: var(--bg-dark);
  background-image:
    linear-gradient(rgba(95, 211, 228, .05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(95, 211, 228, .05) 1px, transparent 1px),
    linear-gradient(rgba(95, 211, 228, .025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(95, 211, 228, .025) 1px, transparent 1px);
  background-size: 96px 96px, 96px 96px, 16px 16px, 16px 16px;
}
/* The page is a frame drawn on the grid, marked at two corners the way the
   film's panels are, rather than a filled surface. */
main { border-color: var(--slate-border); border-top-color: var(--line-strong); background: transparent; box-shadow: none; }
main::before, main::after { content: ''; position: absolute; width: 16px; height: 16px; pointer-events: none; }
main::before { top: -1px; left: -1px; border-top: 2px solid var(--line-strong); border-left: 2px solid var(--line-strong); }
main::after { right: 0; bottom: 0; border-right: 2px solid var(--line-strong); border-bottom: 2px solid var(--line-strong); }
header { position: relative; border-color: var(--line); }
header::after { content: ''; position: absolute; right: 0; bottom: -1px; left: 0; height: 4px; background-image: repeating-linear-gradient(90deg, var(--line-strong) 0 1px, transparent 1px 12px); opacity: .45; }
h1, h2, h3, .metric-label, .task-count, .section-count { font-family: var(--font-display); font-weight: 300; letter-spacing: .2em; text-transform: uppercase; }
h1 { font-weight: 200; letter-spacing: .32em; }
.metric-value { font-family: var(--font-display); font-weight: 200; letter-spacing: .02em; }
.eyebrow { color: var(--muted); letter-spacing: .26em; }
.source, .metric-label { color: var(--muted); letter-spacing: .16em; }
.section-heading { border-bottom: 1px solid var(--slate-border); padding-bottom: 6px; }
/* Controls are squared, and so are the ends of a group of segments. */
:root { --control-radius: 0; }
button, select, .tag-open, .view-options summary { border-color: var(--line); border-radius: 0; background: transparent; color: var(--text); font-family: var(--font-display); letter-spacing: .14em; }
button, select { text-transform: uppercase; }
button:hover, select:hover, .tag-open:hover { border-color: var(--line-strong); background: rgba(95, 211, 228, .08); color: var(--cyan-bright); }
/* An orange rule under the live control, in place of a filled button. */
button.active { border-color: var(--line-strong); background: transparent; color: var(--text); box-shadow: inset 0 -2px 0 var(--amber); }
input[type='checkbox'] { accent-color: var(--cyan); }
.metric, .card, .note, .task, .tag-row, .task-row, .note-row, .entity-row, .saved-filter-row, .view-panel { border-color: var(--slate-border); border-radius: 0; background: rgba(8, 17, 21, .55); box-shadow: none; }
.metric::before { border-bottom-color: var(--line-strong); }
.metric:nth-child(3n)::before { border-bottom-color: var(--amber); }
.card:hover, .note:hover, .task:hover, .tag-row:hover, .task-row:hover, .note-row:hover, .entity-row:hover, .saved-filter-row:hover { border-color: var(--line-strong); background: rgba(95, 211, 228, .06); box-shadow: inset 2px 0 0 var(--amber); }
.tag-name, .task-title a { color: var(--cyan-bright); }
.tag-namespace { color: var(--muted); }
.empty { border-color: var(--slate-border); background: transparent; }
.favorite-toggle { border-color: var(--slate-border); background: transparent; color: var(--amber); }
.favorite-toggle.favorite { border-color: var(--amber); background: transparent; color: var(--amber-bright); }
.favorite-toggle:hover, .favorite-toggle:focus-visible { border-color: var(--amber); background: rgba(232, 86, 42, .12); color: var(--amber-bright); }
/* The live tab and filter are marked by an orange rule, the way the film's
   panels mark a selection, rather than by a filled block. */
.dashboard-tabs button[aria-selected="true"] { background: transparent; color: var(--text); box-shadow: inset 0 -2px 0 var(--amber); }
.dashboard-tabs button[aria-selected="true"] .tab-search-mark { color: var(--amber); }
/* Body blocks and hub notes are marked with a thin steel rule; orange stays
   with the alerts. */
.markdown, .note-row .markdown { border-left: 2px solid var(--line-strong); background: rgba(2, 6, 8, .75); }
.hub { border-left: 2px solid var(--line-strong); background: transparent; }
.hub-toggle { border-left-color: var(--line-strong); }
${contentHoverCss} .card .tag-open:not(:hover):not(:focus-visible), .note-row .tag-open:not(:hover):not(:focus-visible) { color: var(--text); }
`;
  }

  return `
:root {
  --bg-dark: ${themeValue(theme, '#080a0b', '#050505')};
  --bg: ${themeValue(theme, '#080a0b', '#050505')};
  --panel-bg: ${themeValue(theme, '#0c1011', '#211b25')};
  --panel: ${themeValue(theme, '#0c1011', '#211b25')};
  --panel-raised: ${themeValue(theme, '#151c1d', '#33273a')};
  --panel-deep: ${themeValue(theme, '#060809', '#050505')};
  --text: ${themeValue(theme, '#e0ebe8', '#f5dcc0')};
  --muted: ${themeValue(theme, '#a2b6b1', '#c9a7a4')};
  --slate-border: ${themeValue(theme, '#285052', '#050505')};
  --line: ${themeValue(theme, '#285052', '#050505')};
  --line-strong: ${themeValue(theme, '#447274', '#89a9d8')};
  --cyan-bright: ${themeValue(theme, '#70e1dc', '#89a9d8')};
  --cyan: ${themeValue(theme, '#70e1dc', '#89a9d8')};
  --amber-bright: ${themeValue(theme, '#ff715b', '#f3a63a')};
  --amber: ${themeValue(theme, '#ff715b', '#f3a63a')};
  --amber-dim: ${themeValue(theme, '#9c574a', '#b681a3')};
  --green: ${themeValue(theme, '#c5e07b', '#f5cc72')};
  --toxic-green: ${themeValue(theme, '#c5e07b', '#f5cc72')};
  --favorite-red: ${themeValue(theme, '#ff715b', '#bd84a7')};
  --warning-orange: ${themeValue(theme, '#ff715b', '#e05b25')};
  --font-display: ${theme === 'lcars' ? "'Arial Narrow', var(--vscode-font-family, sans-serif)" : 'var(--vscode-font-family, sans-serif)'};
  --font-mono: var(--vscode-editor-font-family, ui-monospace, monospace);
}
${theme === 'lcars' ? 'body { background-image: none; } main { background: var(--panel-deep); border: 0; border-top: 7px solid var(--amber); border-radius: 0 0 26px 0; } header { border-color: var(--line); } button, select, .tag-open, .view-options summary { border-color: var(--panel-deep); border-radius: 0 15px 15px 0; background: var(--cyan); color: #050505; font-weight: 700; } select.related-notes-sort { background: var(--cyan); color: #050505; } .sidebar-toolbar { gap: 0; } .sidebar-toolbar .icon-button { border-radius: 0; } .sidebar-toolbar .icon-button:first-child { border-radius: 0 0 0 15px; } .sidebar-toolbar .icon-button:last-child { border-radius: 0 15px 15px 0; } button svg, button .toolbar-icon, .icon-button, .control-icon-svg, .tag-filter summary .control-icon-svg, .control-icon select:hover + .control-icon-svg, .related-notes-sort-icon { color: #050505; } button:hover, button.active, select:hover, .tag-open:hover, .view-options summary:hover, select.related-notes-sort:hover { border-color: var(--panel-deep); background: var(--amber); color: #050505; } :root { --hover-bg: var(--amber); --hover-fg: #050505; } .note .tag-list button, .search-notice button { background: var(--cyan); color: #050505; } .metrics { gap: 0; } .metric, .card, .note, .task, .tag-row, .task-row, .entity-row, .saved-filter-row, .view-panel { border: 0; border-left: 7px solid var(--amber); border-radius: 0 18px 18px 0; background: var(--panel); clip-path: none; } .metric { border-radius: 0; } .metric:first-child { border-radius: 0 0 0 15px; } .metric:last-child { border-radius: 0 15px 15px 0; } .metric::before { border-bottom-color: var(--amber); } .metric:nth-child(3n + 2), .card:nth-child(3n + 2), .note:nth-child(3n + 2), .tag-row:nth-child(3n + 2), .entity-row:nth-child(3n + 2) { border-left-color: var(--cyan); } .metric:nth-child(3n + 2)::before { border-bottom-color: var(--cyan); } .metric:nth-child(3n), .card:nth-child(3n), .note:nth-child(3n), .tag-row:nth-child(3n), .entity-row:nth-child(3n) { border-left-color: var(--favorite-red); } .metric:nth-child(3n)::before { border-bottom-color: var(--favorite-red); } .card, .note, .task, .tag-row, .task-row, .entity-row, .saved-filter-row, .stat-row { transition: background-color 120ms ease, transform 120ms ease; } .card:hover, .note:hover, .task:hover, .tag-row:hover, .task-row:hover, .entity-row:hover, .saved-filter-row:hover, .stat-row:hover { background: var(--panel-raised); transform: translateX(3px); } .favorite-toggle { border-radius: 14px; background: var(--favorite-red); color: #050505; } .favorite-toggle:hover, .favorite-toggle:focus-visible { background: #f5cc72; color: #050505; } .favorite-toggle.favorite { background: #f5cc72; color: #050505; } .markdown, .rendered pre, .tag-filter-menu, .rank-context-menu, .active-file, .empty { border-color: var(--panel-deep); background: var(--panel-deep); color: #f5cc72; }' : ''}
${theme === 'lcars' ? '.active-file .tag-list button { color: #050505; }' : ''}
${theme === 'lcars' ? '.favorite-toggle { background: var(--cyan); color: #7a1f1f; } .favorite-toggle:hover, .favorite-toggle:focus-visible, .favorite-toggle.favorite { background: #f5cc72; color: #7a1f1f; }' : ''}
${theme === 'lcars' ? '.dashboard-column-options button, .dashboard-column-options button:first-child, .dashboard-column-options button:last-child { border-radius: 0; }' : ''}
${theme === 'lcars' ? 'main { border-top: 0; }' : ''}
${theme === 'lcars' ? '.sidebar-relationships { border: 0; border-left: 7px solid var(--amber); border-radius: 0; background: var(--panel); } .relationship-workspace { border-color: var(--line-strong); border-left: 7px solid var(--amber); border-radius: 0 18px 18px 0; background: var(--panel); } .sidebar-relationships-header, .relationship-workspace-header { border-bottom-color: var(--line-strong); } .sidebar-relationship-branch { border-bottom: 2px solid var(--line-strong); } .sidebar-relationship-branch summary { border-left: 5px solid var(--cyan); background: var(--panel); } .sidebar-relationship-namespace { border-top-color: var(--line-strong); } .sidebar-relationship-namespace summary { border-left: 3px solid var(--line-strong); } .sidebar-relationship-items { margin: 0 8px 5px; border-left: 0; } .relationship-tree-root { border-color: var(--cyan); } .relationship-tree-column, .relationship-graph-shell { border-color: var(--line-strong); } .relationship-tree-group { border-top-color: var(--line-strong); } .relationship-tree-group summary { border-left: 4px solid var(--cyan); padding-left: 6px; } .relationship-tree-items { margin-left: 8px; border-left: 3px solid var(--cyan); }' : ''}
${theme === 'lcars' ? '.inline-tag, .note-title .inline-tag, .task-title .inline-tag { color: #050505; }' : ''}
${theme === 'lcars' ? '.active-name .active-filter-tag { color: #050505; }' : ''}
${theme === 'lcars' ? '.task-row .task-title, .task .task-title, .note-row .card-title { color: var(--cyan); font-family: inherit; font-size: inherit; line-height: inherit; } .task-row .task-title { font-family: var(--vscode-font-family, ui-sans-serif, sans-serif); } .task-row .task-title a, .task .task-title a { color: inherit; } .task-row .task-meta, .task .source, .note-row .source { color: var(--muted); font-family: inherit; font-size: inherit; line-height: inherit; } .task-row .task-meta { font-family: var(--vscode-font-family, ui-sans-serif, sans-serif); }' : ''}
${theme === 'lcars' ? '.note-row { border: 0; border-left: 7px solid var(--amber); border-radius: 0 18px 18px 0; background: var(--panel); clip-path: none; } .note-row:nth-child(3n + 2) { border-left-color: var(--cyan); } .note-row:nth-child(3n) { border-left-color: var(--favorite-red); } .note-row:hover { background: var(--panel-raised); transform: translateX(3px); }' : ''}
${theme === 'lcars' ? '.overview-tabs-row { border-bottom-color: var(--line-strong); } .overview-tabs { gap: 0; } .overview-tabs button { border-radius: 0; } .overview-tabs button:first-child { border-radius: 15px 0 0 0; } .overview-tabs button:last-child { border-radius: 0 0 15px 0; }' : ''}
${theme === 'lcars' ? '.tag-filter summary, .tag-filter-search { border-color: var(--panel-deep); border-radius: 0 15px 15px 0; background: var(--cyan); color: #050505; } .tag-filter-search::placeholder { color: #050505; opacity: 1; } .tag-filter summary .control-icon-svg, .tag-filter-search-control .control-icon-svg, .tag-filter-clear { color: #050505; } .tag-filter summary:hover, .tag-filter summary:focus-visible, .tag-filter-search:focus { border-color: var(--panel-deep); background: var(--amber); color: #050505; }' : ''}
${theme === 'lcars' ? '.overview-search, .catalog-search, .task-search, .note-search { border: 2px solid var(--cyan-bright); border-radius: 0 15px 15px 0; background: var(--panel); box-shadow: inset 0 0 0 1px var(--cyan-bright); color: var(--text); } .overview-search::placeholder, .catalog-search::placeholder, .task-search::placeholder, .note-search::placeholder { color: var(--muted); opacity: 1; } .overview-search:focus, .catalog-search:focus, .task-search:focus, .note-search:focus { border-color: var(--amber); box-shadow: inset 0 0 0 1px var(--amber); color: var(--text); background: var(--panel); } .save-filter.save-filter { border-color: var(--panel-deep); color: #050505; }' : ''}
${theme === 'lcars' ? '.dashboard-tabs-row { border-bottom-color: var(--line-strong); } .dashboard-tabs button { border-radius: 0; } .dashboard-tabs button:first-child { border-radius: 15px 0 0 0; } .dashboard-tabs button:last-child { border-radius: 0 0 15px 0; }' : ''}
${theme === 'lcars' ? '.browse-scope button { border-radius: 0; } .browse-scope button:first-child { border-radius: 15px 0 0 0; } .browse-scope button:last-child { border-radius: 0 0 15px 0; }' : ''}
${theme === 'lcars' ? '.saved-filter-remove.saved-filter-remove { color: #050505; } .saved-filter-remove.saved-filter-remove:hover, .saved-filter-remove.saved-filter-remove:focus-visible { color: #050505; }' : ''}
${theme === 'lcars' ? 'input.tag-filter-search { border-color: var(--panel-deep); background: var(--cyan); color: #050505; } input.tag-filter-search::placeholder { color: #050505; opacity: 1; } input.tag-filter-search:focus { border-color: var(--panel-deep); background: var(--amber); color: #050505; } .selected-task-tag { background: var(--cyan); color: #050505; } .selected-task-tag::after { color: #050505; } button.clear-task-filters { border-color: var(--panel-deep); background: var(--cyan); color: #050505; } button.clear-task-filters:hover, button.clear-task-filters:focus-visible { border-color: var(--panel-deep); background: var(--amber); color: #050505; }' : ''}
${theme === 'lcars' ? 'section[aria-labelledby="tags-heading"] .control-row { gap: 2px; } section[aria-labelledby="tags-heading"] .control-row .control-icon select { border-radius: 0; } section[aria-labelledby="tags-heading"] .control-row .control-icon:first-child select { border-radius: 15px 0 0 0; } section[aria-labelledby="tags-heading"] .control-row .control-icon:last-child select { border-radius: 0 0 15px 0; }' : ''}`;
}

function isDeckardTheme(value: string): value is DeckardTheme {
  return (deckardThemes as readonly string[]).includes(value);
}

function themeValue(
  theme: Exclude<DeckardTheme, 'replicant'>,
  oblivion: string,
  lcars: string,
): string {
  return theme === 'oblivion' ? oblivion : lcars;
}
