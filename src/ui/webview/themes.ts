import * as vscode from 'vscode';

export const deckardThemes = [
  'replicant',
  'oblivion',
  'lcars',
  'synthwave',
  'tomcat',
  'fellowship',
] as const;

export type DeckardTheme = (typeof deckardThemes)[number];

const contentHoverCss =
  '.entity-row, .tag-row, .tag-open, .note .tag-list button, .card, .note, .task, .task-row, .saved-filter-row { transition: background-color 120ms ease, transform 120ms ease; } .tag-open, .note .tag-list button { display: inline-block; } .entity-row:hover, .tag-row:hover, .tag-open:hover, .note .tag-list button:hover, .card:hover, .note:hover, .task:hover, .task-row:hover, .saved-filter-row:hover { background: var(--panel-raised); transform: translateX(3px); }';

const replicantHoverCss = `${contentHoverCss} .note:hover { border-color: var(--amber); } .card .tag-open { color: var(--text); }`;

/** Returns the configured theme, falling back when workspace settings are stale. */
export function getDeckardTheme(): DeckardTheme {
  const configuredTheme = vscode.workspace
    .getConfiguration('deckard')
    .get<string>('theme', 'replicant');

  return isDeckardTheme(configuredTheme) ? configuredTheme : 'replicant';
}

/** Provides theme-level tokens after a webview's local layout styles. */
export function getDeckardThemeCss(theme: DeckardTheme): string {
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
  --cyan-bright: #5ff7ff;
  --cyan: #00e5ff;
  --amber-bright: #ff8b55;
  --amber: #ff3ca6;
  --amber-dim: #8c4d92;
  --green: #62f5ff;
  --toxic-green: #62f5ff;
  --favorite-red: #ff2d95;
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
button, select, .tag-open { border-color: var(--cyan); border-radius: 0; background: rgba(7, 6, 17, .94); color: var(--cyan-bright); font-family: var(--font-mono); letter-spacing: .04em; clip-path: polygon(0 5px, 5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%); }
button:hover, button.active, select:hover, .tag-open:hover { border-color: var(--cyan); background: var(--cyan); color: var(--bg-dark); box-shadow: 0 0 12px rgba(0, 229, 255, .28); }
input[type='checkbox'] { accent-color: var(--cyan); }
.metric, .card, .note, .task, .tag-row, .task-row, .entity-row, .saved-filter-row, .view-panel { border-color: var(--line); border-radius: 0; background: rgba(21, 16, 47, .92); box-shadow: inset 3px 0 0 var(--favorite-red), 0 0 0 1px rgba(0, 229, 255, .1); clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%); }
.metric:nth-child(3n + 2), .card:nth-child(3n + 2), .note:nth-child(3n + 2), .task:nth-child(3n + 2), .tag-row:nth-child(3n + 2), .task-row:nth-child(3n + 2), .entity-row:nth-child(3n + 2), .saved-filter-row:nth-child(3n + 2), .view-panel:nth-child(3n + 2) { box-shadow: inset 3px 0 0 var(--cyan), 0 0 0 1px rgba(255, 45, 149, .1); }
.metric::before { border-bottom-color: var(--cyan); color: var(--amber-dim); }
.metric:nth-child(3n + 2)::before { border-bottom-color: var(--favorite-red); }
.metric:nth-child(3n)::before { border-bottom-color: var(--amber-bright); }
.card:hover, .note:hover, .task:hover, .tag-row:hover, .task-row:hover, .entity-row:hover, .saved-filter-row:hover { border-color: var(--cyan); background: var(--panel-raised); box-shadow: inset 4px 0 0 var(--cyan), 0 0 14px rgba(0, 229, 255, .2); }
.tag-name, .task-title a { color: var(--cyan-bright); }
.task-meta { color: var(--muted); }
.tag-filter summary, .tag-filter-search { border-color: var(--line); background: var(--panel-deep); }
.tag-filter summary:hover, .tag-filter-search:focus { border-color: var(--favorite-red); color: var(--favorite-red); }
.tag-filter-menu, .rank-context-menu { border-color: var(--cyan); background: var(--panel-deep); box-shadow: 0 0 20px rgba(0, 229, 255, .16); }
.drag-ghost { border-color: var(--cyan); background: var(--panel-raised); }
.drag-placeholder { border-color: var(--favorite-red); }
.empty { border-color: var(--line); background: var(--panel-deep); clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%); }
.favorite-toggle { border-color: var(--favorite-red); background: rgba(255, 45, 149, .08); color: var(--favorite-red); }
.favorite-toggle.favorite { border-color: var(--favorite-red); background: var(--favorite-red); color: var(--bg-dark); }
.favorite-toggle .favorite-heart { color: var(--favorite-red); }
.favorite-toggle.favorite .favorite-heart { color: var(--bg-dark); }
.favorite-toggle:hover, .favorite-toggle:focus-visible { border-color: var(--favorite-red); background: var(--favorite-red); color: var(--bg-dark); }
.favorite-toggle:hover .favorite-heart, .favorite-toggle:focus-visible .favorite-heart { color: var(--bg-dark); }
${contentHoverCss} .card .tag-open { color: var(--text); }
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
  --cyan-bright: #76ff63;
  --cyan: #54db51;
  --amber-bright: #f0bf47;
  --amber: #d89d31;
  --amber-dim: #896b28;
  --green: #76ff63;
  --toxic-green: #76ff63;
  --favorite-red: #e24b26;
  --warning-orange: #e24b26;
  --font-display: var(--vscode-editor-font-family, ui-monospace, monospace);
  --font-mono: var(--vscode-editor-font-family, ui-monospace, monospace);
}
body { background-image: repeating-linear-gradient(0deg, rgba(118, 255, 99, .025) 0, rgba(118, 255, 99, .025) 1px, transparent 1px, transparent 4px); }
main { border-color: var(--line); box-shadow: 0 0 22px rgba(41, 165, 47, .08); }
header { border-color: var(--line-strong); box-shadow: 0 1px 0 rgba(118, 255, 99, .2); }
h1, h2, h3, .metric-value, .metric-label, .task-count, .section-count { font-family: var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
button, select, .tag-open { border-color: var(--line-strong); border-radius: 0; background: rgba(3, 13, 3, .94); color: var(--green); font-family: var(--font-mono); letter-spacing: .06em; text-transform: uppercase; }
button:hover, button.active, select:hover, .tag-open:hover { background: var(--green); border-color: var(--green); color: #071006; }
.metric, .card, .note, .task, .tag-row, .task-row, .entity-row, .saved-filter-row, .view-panel { border-color: var(--line); border-radius: 0; background: rgba(3, 12, 3, .9); box-shadow: inset 2px 0 0 var(--green); }
.metric::before { border-bottom-color: var(--green); }
.metric:nth-child(3n)::before { border-bottom-color: var(--favorite-red); }
.card:hover, .note:hover, .task:hover, .tag-row:hover, .task-row:hover, .entity-row:hover, .saved-filter-row:hover { border-color: var(--green); background: var(--panel-raised); box-shadow: inset 3px 0 0 var(--green), 0 0 14px rgba(118, 255, 99, .16); }
.favorite-toggle { border-color: var(--favorite-red); background: transparent; color: var(--favorite-red); }
.favorite-toggle.favorite { border-color: var(--favorite-red); background: transparent; color: var(--favorite-red); }
.favorite-toggle .favorite-heart { color: var(--favorite-red); }
`;
  }

  if (theme === 'fellowship') {
    return `
:root {
  --bg-dark: #d6cda9;
  --bg: #e6deb9;
  --panel-bg: #f1e8c8;
  --panel: #f1e8c8;
  --panel-raised: #faf1d4;
  --panel-deep: #c5b980;
  --text: #29341d;
  --muted: #66704b;
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
  --warning-orange: #a94d35;
  --font-display: Georgia, 'Times New Roman', serif;
  --font-mono: var(--vscode-editor-font-family, ui-monospace, monospace);
}
body { background-image: none; }
main { border-color: var(--slate-border); box-shadow: none; }
header { border-color: var(--line-strong); }
h1, h2, h3 { font-family: var(--font-display); color: #3d4d28; letter-spacing: .04em; }
button, select, .tag-open { border-color: var(--slate-border); border-radius: 5px; background: #e9dfb7; color: var(--text); }
button:hover, button.active, select:hover, .tag-open:hover { border-color: var(--green); background: var(--green); color: #fff7db; }
.metric, .card, .note, .task, .tag-row, .task-row, .entity-row, .saved-filter-row, .view-panel { border-color: var(--slate-border); border-radius: 5px; background: #f1e8c8; box-shadow: inset 3px 0 0 var(--green); }
.metric::before { border-bottom-color: var(--green); }
.metric:nth-child(3n + 2)::before { border-bottom-color: var(--amber); }
.metric:nth-child(3n)::before { border-bottom-color: var(--favorite-red); }
.card:hover, .note:hover, .task:hover, .tag-row:hover, .task-row:hover, .entity-row:hover, .saved-filter-row:hover { border-color: var(--green); background: var(--panel-raised); box-shadow: inset 4px 0 0 var(--green), 0 0 0 1px rgba(85, 113, 61, .2); }
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
${theme === 'oblivion' ? `body { background-image: radial-gradient(circle at 1px 1px, rgba(112, 225, 220, .2) 1px, transparent 0); background-size: 18px 18px; } ${contentHoverCss} .card .tag-open { color: var(--text); }` : ''}
${theme === 'lcars' ? 'body { background-image: none; } main { background: var(--panel-deep); border: 0; border-top: 7px solid var(--amber); border-radius: 0 0 26px 0; } header { border-color: var(--line); } button, select, .tag-open { border-color: var(--panel-deep); border-radius: 0 15px 15px 0; background: var(--cyan); color: #050505; font-weight: 700; } .related-notes-sort { background: var(--cyan); color: #050505; } .task-filter-toggle button { border-radius: 0; } .task-filter-toggle button:first-child { border-radius: 0 0 0 15px; } .task-filter-toggle button:last-child { border-radius: 0 15px 15px 0; } .sidebar-toolbar { gap: 0; } .sidebar-toolbar .icon-button { border-radius: 0; } .sidebar-toolbar .icon-button:first-child { border-radius: 0 0 0 15px; } .sidebar-toolbar .icon-button:last-child { border-radius: 0 15px 15px 0; } button svg, button .toolbar-icon, button .task-filter-icon, .control-icon-svg, .tag-filter summary .control-icon-svg, .control-icon select:hover + .control-icon-svg, .related-notes-sort-icon { color: #050505; } .task-filter-toggle button { color: #050505; } button:hover, button.active, select:hover, .tag-open:hover, .related-notes-sort:hover { border-color: var(--panel-deep); background: var(--amber); color: #050505; } .note .tag-list button { color: #050505; } .metrics { gap: 0; } .metric, .card, .note, .task, .tag-row, .task-row, .entity-row, .saved-filter-row, .view-panel { border: 0; border-left: 7px solid var(--amber); border-radius: 0 18px 18px 0; background: var(--panel); clip-path: none; } .metric { border-radius: 0; } .metric:first-child { border-radius: 0 0 0 15px; } .metric:last-child { border-radius: 0 15px 15px 0; } .metric::before { border-bottom-color: var(--amber); } .metric:nth-child(3n + 2), .card:nth-child(3n + 2), .note:nth-child(3n + 2), .tag-row:nth-child(3n + 2), .entity-row:nth-child(3n + 2) { border-left-color: var(--cyan); } .metric:nth-child(3n + 2)::before { border-bottom-color: var(--cyan); } .metric:nth-child(3n), .card:nth-child(3n), .note:nth-child(3n), .tag-row:nth-child(3n), .entity-row:nth-child(3n) { border-left-color: var(--favorite-red); } .metric:nth-child(3n)::before { border-bottom-color: var(--favorite-red); } .card, .note, .task, .tag-row, .task-row, .entity-row, .saved-filter-row { transition: background-color 120ms ease, transform 120ms ease; } .card:hover, .note:hover, .task:hover, .tag-row:hover, .task-row:hover, .entity-row:hover, .saved-filter-row:hover { background: var(--panel-raised); transform: translateX(3px); } .favorite-toggle { border-radius: 14px; background: var(--favorite-red); color: #050505; } .favorite-toggle:hover, .favorite-toggle:focus-visible { background: #f5cc72; color: #050505; } .favorite-toggle.favorite { background: #f5cc72; color: #050505; } .markdown, .rendered pre, .tag-filter-menu, .rank-context-menu, .active-file, .empty { border-color: var(--panel-deep); background: var(--panel-deep); color: #f5cc72; }' : ''}
${theme === 'lcars' ? '.favorite-toggle { background: var(--cyan); color: #7a1f1f; } .favorite-toggle .favorite-heart { color: #7a1f1f; } .favorite-toggle:hover, .favorite-toggle:focus-visible, .favorite-toggle.favorite { background: #f5cc72; color: #7a1f1f; }' : ''}
${theme === 'lcars' ? 'main { border-top: 0; }' : ''}
${theme === 'lcars' ? '.sidebar-relationships { border: 0; border-left: 7px solid var(--amber); border-radius: 0; background: var(--panel); } .relationship-workspace { border-color: var(--line-strong); border-left: 7px solid var(--amber); border-radius: 0 18px 18px 0; background: var(--panel); } .sidebar-relationships-header, .relationship-workspace-header { border-bottom-color: var(--line-strong); } .sidebar-relationship-branch { border-bottom: 2px solid var(--line-strong); } .sidebar-relationship-branch summary { border-left: 5px solid var(--cyan); background: var(--panel); } .sidebar-relationship-namespace { border-top-color: var(--line-strong); } .sidebar-relationship-namespace summary { border-left: 3px solid var(--line-strong); } .sidebar-relationship-items { margin: 0 8px 5px; border-left: 0; } .relationship-tree-root { border-color: var(--cyan); } .relationship-tree-column, .relationship-graph-shell { border-color: var(--line-strong); } .relationship-tree-group { border-top-color: var(--line-strong); } .relationship-tree-group summary { border-left: 4px solid var(--cyan); padding-left: 6px; } .relationship-tree-items { margin-left: 8px; border-left: 3px solid var(--cyan); }' : ''}
${theme === 'lcars' ? '.inline-tag { color: #050505; }' : ''}
${theme === 'lcars' ? '.active-name .active-filter-tag { color: #050505; }' : ''}
${theme === 'lcars' ? '.task-row .task-title, .task .task-title { color: var(--cyan); font-family: inherit; font-size: inherit; line-height: inherit; } .task-row .task-title { font-family: var(--vscode-font-family, ui-sans-serif, sans-serif); } .task-row .task-title a, .task .task-title a { color: inherit; } .task-row .task-meta, .task .source { color: var(--muted); font-family: inherit; font-size: inherit; line-height: inherit; } .task-row .task-meta { font-family: var(--vscode-font-family, ui-sans-serif, sans-serif); }' : ''}
${theme === 'lcars' ? '.overview-tabs { gap: 2px; } .overview-tabs button { border-radius: 0; } .overview-tabs button:first-child { border-radius: 15px 0 0 0; } .overview-tabs button:last-child { border-radius: 0 0 15px 0; }' : ''}
${theme === 'lcars' ? '.tag-filter summary, .tag-filter-search { border-color: var(--panel-deep); border-radius: 0 15px 15px 0; background: var(--cyan); color: #050505; } .tag-filter-search::placeholder { color: #050505; opacity: 1; } .tag-filter summary .control-icon-svg, .tag-filter-search-control .control-icon-svg, .tag-filter-clear { color: #050505; } .tag-filter summary:hover, .tag-filter summary:focus-visible, .tag-filter-search:focus { border-color: var(--panel-deep); background: var(--amber); color: #050505; }' : ''}
${theme === 'lcars' ? '.overview-search, .catalog-search, .task-search { border: 2px solid var(--cyan-bright); border-radius: 0 15px 15px 0; background: var(--panel); box-shadow: inset 0 0 0 1px var(--cyan-bright); color: var(--text); } .overview-search::placeholder, .catalog-search::placeholder, .task-search::placeholder { color: var(--muted); opacity: 1; } .overview-search:focus, .catalog-search:focus, .task-search:focus { border-color: var(--amber); box-shadow: inset 0 0 0 1px var(--amber); color: var(--text); background: var(--panel); } .save-filter.save-filter { border-color: var(--panel-deep); color: #050505; }' : ''}
${theme === 'lcars' ? '.dashboard-tabs button { border-radius: 0; } .dashboard-tabs button:first-child { border-radius: 15px 0 0 0; } .dashboard-tabs button:last-child { border-radius: 0 0 15px 0; }' : ''}
${theme === 'lcars' ? '.browse-scope button { border-radius: 0; } .browse-scope button:first-child { border-radius: 15px 0 0 0; } .browse-scope button:last-child { border-radius: 0 0 15px 0; }' : ''}
${theme === 'lcars' ? '.saved-filter-remove.saved-filter-remove, .task-filter-toggle .filter-count { color: #050505; } .saved-filter-remove.saved-filter-remove:hover, .saved-filter-remove.saved-filter-remove:focus-visible { color: #050505; }' : ''}
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
