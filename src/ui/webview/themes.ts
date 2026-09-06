import * as vscode from 'vscode';

export const deckardThemes = ['replicant', 'oblivion', 'lcars'] as const;

export type DeckardTheme = (typeof deckardThemes)[number];

const contentHoverCss =
  '.entity-row, .tag-row, .tag-open, .note .tag-list button, .card, .note, .task, .task-row { transition: background-color 120ms ease, transform 120ms ease; } .tag-open, .note .tag-list button { display: inline-block; } .entity-row:hover, .tag-row:hover, .tag-open:hover, .note .tag-list button:hover, .card:hover, .note:hover, .task:hover, .task-row:hover { background: var(--panel-raised); transform: translateX(3px); }';

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
${theme === 'lcars' ? 'body { background-image: none; } main { background: var(--panel-deep); border: 0; border-top: 7px solid var(--amber); border-radius: 0 0 26px 0; } header { border-color: var(--line); } button, select, .tag-open { border-color: var(--panel-deep); border-radius: 0 15px 15px 0; background: var(--cyan); color: #050505; font-weight: 700; } .related-notes-sort { background: var(--cyan); color: #050505; } .task-filter-toggle button { border-radius: 0; } .task-filter-toggle button:first-child { border-radius: 0 0 0 15px; } .task-filter-toggle button:last-child { border-radius: 0 15px 15px 0; } .sidebar-toolbar { gap: 0; } .sidebar-toolbar .icon-button { border-radius: 0; } .sidebar-toolbar .icon-button:first-child { border-radius: 0 0 0 15px; } .sidebar-toolbar .icon-button:last-child { border-radius: 0 15px 15px 0; } button svg, button .toolbar-icon, button .task-filter-icon, .control-icon-svg, .tag-filter summary .control-icon-svg, .control-icon select:hover + .control-icon-svg, .related-notes-sort-icon { color: #050505; } .task-filter-toggle button { color: #050505; } button:hover, button.active, select:hover, .tag-open:hover, .related-notes-sort:hover { border-color: var(--panel-deep); background: var(--amber); color: #050505; } .note .tag-list button { color: #050505; } .metrics { gap: 0; } .metric, .card, .note, .task, .tag-row, .task-row, .entity-row, .view-panel { border: 0; border-left: 7px solid var(--amber); border-radius: 0 18px 18px 0; background: var(--panel); clip-path: none; } .metric { border-radius: 0; } .metric:first-child { border-radius: 0 0 0 15px; } .metric:last-child { border-radius: 0 15px 15px 0; } .metric::before { border-bottom-color: var(--amber); } .metric:nth-child(3n + 2), .card:nth-child(3n + 2), .note:nth-child(3n + 2), .tag-row:nth-child(3n + 2), .entity-row:nth-child(3n + 2) { border-left-color: var(--cyan); } .metric:nth-child(3n + 2)::before { border-bottom-color: var(--cyan); } .metric:nth-child(3n), .card:nth-child(3n), .note:nth-child(3n), .tag-row:nth-child(3n), .entity-row:nth-child(3n) { border-left-color: var(--favorite-red); } .metric:nth-child(3n)::before { border-bottom-color: var(--favorite-red); } .card, .note, .task, .tag-row, .task-row, .entity-row { transition: background-color 120ms ease, transform 120ms ease; } .card:hover, .note:hover, .task:hover, .tag-row:hover, .task-row:hover, .entity-row:hover { background: var(--panel-raised); transform: translateX(3px); } .favorite-toggle { border-radius: 14px; background: var(--favorite-red); color: #050505; } .favorite-toggle:hover, .favorite-toggle:focus-visible { background: #f5cc72; color: #050505; } .favorite-toggle.favorite { background: #f5cc72; color: #050505; } .markdown, .rendered pre, .tag-filter-menu, .rank-context-menu, .active-file, .empty { border-color: var(--panel-deep); background: var(--panel-deep); color: #f5cc72; }' : ''}
${theme === 'lcars' ? '.favorite-toggle { background: var(--cyan); color: #7a1f1f; } .favorite-toggle .favorite-heart { color: #7a1f1f; } .favorite-toggle:hover, .favorite-toggle:focus-visible, .favorite-toggle.favorite { background: #f5cc72; color: #7a1f1f; }' : ''}
${theme === 'lcars' ? '.task-row .task-title, .task .task-title { color: var(--cyan); font-family: inherit; font-size: inherit; line-height: inherit; } .task-row .task-title { font-family: var(--vscode-font-family, ui-sans-serif, sans-serif); } .task-row .task-title a, .task .task-title a { color: inherit; } .task-row .task-meta, .task .source { color: var(--muted); font-family: inherit; font-size: inherit; line-height: inherit; } .task-row .task-meta { font-family: var(--vscode-font-family, ui-sans-serif, sans-serif); }' : ''}
${theme === 'lcars' ? '.overview-tabs { gap: 2px; } .overview-tabs button { border-radius: 0; } .overview-tabs button:first-child { border-radius: 15px 0 0 0; } .overview-tabs button:last-child { border-radius: 0 0 15px 0; }' : ''}
${theme === 'lcars' ? '.tag-filter summary, .tag-filter-search { border-color: var(--panel-deep); border-radius: 0 15px 15px 0; background: var(--cyan); color: #050505; } .tag-filter-search::placeholder { color: #050505; opacity: 1; } .tag-filter summary .control-icon-svg, .tag-filter-search-control .control-icon-svg, .tag-filter-clear { color: #050505; } .tag-filter summary:hover, .tag-filter summary:focus-visible, .tag-filter-search:focus { border-color: var(--panel-deep); background: var(--amber); color: #050505; }' : ''}
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
