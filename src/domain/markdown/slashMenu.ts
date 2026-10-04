/**
 * The `/` menu: what a `/` typed alone at the start of a line offers to
 * write there, as Notion's does, from a task or a heading to a query block
 * or a template. Each choice is a snippet, so the cursor lands where the
 * writing goes on, and a template's questions are its tab stops.
 */
import { fillTemplate } from '../notes/templates';
import { findFrontmatterEnd } from './frontmatter';

/** A `/` alone at a line's start, after any indentation, and the word typed after it. */
const SLASH_AT_LINE_START = /^([ \t]*)\/([\p{L}\p{N}-]*)$/u;

/** Where a `/` menu query starts on its line, and what has been typed after the `/`. */
export interface SlashQuery {
  /** The column of the `/`. */
  start: number;
  word: string;
}

/**
 * The menu's query in the text before the cursor, or undefined when the
 * `/` does not start the line: a `/` inside a sentence, a path, or a date
 * is writing, not a request for the menu.
 */
export function findSlashQuery(before: string): SlashQuery | undefined {
  const match = SLASH_AT_LINE_START.exec(before);
  return match ? { start: match[1].length, word: match[2] } : undefined;
}

/** One choice the menu offers. */
export interface SlashChoice {
  /** What the menu lists. */
  label: string;
  /** What it writes, said beside the label. */
  detail: string;
  /** The words it is found by besides its label. */
  keywords?: readonly string[];
  /** A snippet: `$1` and `${1:text}` are tab stops, `$0` where the cursor ends. */
  snippet: string;
  /** Whether to open suggestions after writing it, as for a link's note. */
  suggestAfter?: boolean;
}

/** What the fixed choices are written with: today's date as YYYY-MM-DD. */
export interface SlashMenuContext {
  today: string;
}

/**
 * The choices every note has, in the order the menu lists them. The query
 * blocks start from a search worth keeping, which the first tab stop holds.
 */
export function listSlashChoices({ today }: SlashMenuContext): SlashChoice[] {
  return [
    { label: 'Task', detail: '- [ ] ', keywords: ['todo', 'checkbox'], snippet: '- [ ] $0' },
    { label: 'Heading 1', detail: '# ', keywords: ['title', 'h1'], snippet: '# $0' },
    { label: 'Heading 2', detail: '## ', keywords: ['h2'], snippet: '## $0' },
    { label: 'Heading 3', detail: '### ', keywords: ['h3'], snippet: '### $0' },
    { label: 'Bulleted list', detail: '- ', keywords: ['bullet'], snippet: '- $0' },
    { label: 'Numbered list', detail: '1. ', keywords: ['ordered'], snippet: '1. $0' },
    { label: 'Quote', detail: '> ', keywords: ['blockquote'], snippet: '> $0' },
    // *** rather than ---, which under a line of text makes it a heading.
    { label: 'Divider', detail: '***', keywords: ['rule', 'line', '---'], snippet: '***\n$0' },
    { label: 'Link to a note', detail: '[[…]]', keywords: ['wiki'], snippet: '[[$0]]', suggestAfter: true },
    { label: 'Embed a note', detail: '![[…]]', keywords: ['transclude', 'include'], snippet: '![[$0]]', suggestAfter: true },
    { label: 'Today’s note', detail: `[[${today}]]`, keywords: ['daily', 'journal'], snippet: `[[${today}]]$0` },
    { label: 'Today’s date', detail: today, keywords: ['now'], snippet: `${today}$0` },
    {
      label: 'Query block',
      detail: 'A live list of what a search finds',
      keywords: ['search', 'deckard'],
      snippet: '```deckard\n${1:is:open}\n```\n$0',
    },
    {
      label: 'Notes table',
      detail: 'A live table of notes, with their links and tasks',
      keywords: ['database', 'deckard', 'projects'],
      snippet: '```deckard view=table noteColumns=updated,links,tasks\n${1:tag = #project/* AND is:note}\n```\n$0',
    },
    {
      label: 'Tasks table',
      detail: 'A live table of tasks, by due date',
      keywords: ['database', 'deckard', 'todo'],
      snippet: '```deckard view=table columns=due,priority,for sort=due\n${1:is:open}\n```\n$0',
    },
  ];
}

/** `$`, `}`, and `\` written as text in a snippet, where each would mean something. */
export function escapeSnippetText(text: string): string {
  return text.replace(/[\\$}]/g, (character) => `\\${character}`);
}

/**
 * A template as a snippet: its front matter left out, since a note keeps
 * one only at its top; its variables filled; its text taken as written;
 * and each `{ask:Question}` a tab stop that starts out reading the
 * question, the same question the same stop wherever it is asked again.
 */
export function templateToSnippet(written: string, variables: Readonly<Record<string, string>>): string {
  const template = withoutFrontmatter(written);
  const stops = new Map<string, number>();
  const asked = /\{ask:([^{}]*)\}/g;
  let snippet = '';
  let from = 0;
  for (const match of template.matchAll(asked)) {
    const at = match.index ?? 0;
    snippet += escapeSnippetText(fillTemplate(template.slice(from, at), variables));
    const question = match[1].trim();
    let stop = stops.get(question);
    if (stop === undefined) {
      stop = stops.size + 1;
      stops.set(question, stop);
    }
    snippet += `\${${stop}:${escapeSnippetText(question)}}`;
    from = at + match[0].length;
  }
  snippet += escapeSnippetText(fillTemplate(template.slice(from), variables));
  return `${snippet}$0`;
}

/** A template's text without the front matter it opens with. */
function withoutFrontmatter(template: string): string {
  const lines = template.split(/\r?\n/);
  const end = findFrontmatterEnd(lines);
  return end === undefined ? template : lines.slice(end + 1).join('\n').replace(/^\n+/, '');
}

/** A list item's marker at the start of a line: `-`, `*`, `+`, or a number with `.` or `)`. */
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/;

/**
 * Whether a line is where the menu writes nothing: inside the note's front
 * matter, or indented as code, four spaces or a tab with no list item above
 * to be nested in.
 */
export function isOutsideProse(lines: readonly string[], line: number): boolean {
  const end = findFrontmatterEnd(lines);
  if (end !== undefined && line <= end) {
    return true;
  }
  if (!/^( {4,}|\t)/.test(lines[line] ?? '')) {
    return false;
  }
  for (let above = line - 1; above >= 0; above -= 1) {
    if (lines[above].trim()) {
      return !LIST_ITEM.test(lines[above]) && !/^( {2,}|\t)\S/.test(lines[above]);
    }
  }
  return true;
}
