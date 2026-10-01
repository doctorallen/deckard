// Compares how note Markdown reads on the pages drawn two ways: through
// src/ui/webview/rendering.ts (markdown-it, then sanitize-html), as the pages
// draw it today, and through the token tree of src/domain/markdown
// (inline.ts and blockExcerpt.ts), which replaces it in Phase 6. For every
// card excerpt and task title the pages would show for the sample
// workspace, the development notes, and the test fixtures, it compares the
// visible text and the elements in order, and sorts each difference under
// the construct that explains it.
//
//   npm run compile-tests && node scripts/compare-card-markdown.js [--all]
//
// The report goes to standard output; --all lists every differing input
// rather than one example of each construct. Nothing is written to disk.
//
// It exits 1 when a difference is not explained by one of the constructs
// listed for decision in Q8 of docs/implementation/20-webviews.md, so a
// change to the tokenizer can be checked against it.
//
// The token side is drawn by a small reference writer below, for this
// comparison only: the pages will draw tokens as elements, never as HTML.
// Both sides are read back with htmlparser2, sanitize-html's own parser, so
// the script lives exactly as long as rendering.ts does and goes with it.
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'out');
if (!fs.existsSync(path.join(OUT, 'domain', 'markdown', 'inline.js'))) {
  console.error('Run "npm run compile-tests" first: out/ is missing or out of date.');
  process.exit(1);
}

// The sample workspace's loader imports vscode for its file writes; the
// e2e suite's stub stands in, since only its pure helpers run here.
const stubPath = path.join(ROOT, 'test', 'e2e', 'vscodeStub.js');
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === 'vscode' ? stubPath : resolveFilename.call(this, request, ...rest);
};

const { Parser } = require('htmlparser2');
const rendering = require(path.join(OUT, 'ui', 'webview', 'rendering.js'));
const { tokenizeInline } = require(path.join(OUT, 'domain', 'markdown', 'inline.js'));
const { buildBlockExcerpt } = require(path.join(OUT, 'domain', 'markdown', 'blockExcerpt.js'));
const { stripTrailingTags } = require(path.join(OUT, 'domain', 'ranking', 'entryLabels.js'));
const { findSnippetStart } = require(path.join(OUT, 'ui', 'state', 'dashboardState.js'));
const corpus = require(path.join(OUT, 'test', 'indexCorpus.js'));

const SHOW_ALL = process.argv.includes('--all');

// ----- The corpora ---------------------------------------------------------

/**
 * The notes to read, by corpus: the sample workspace and the development
 * notes as the index-equivalence suite reads them, and the fixtures that
 * suite and the rendering suite hold.
 */
function readCorpora() {
  return [
    ['sample', corpus.sampleNotes()],
    ['development', corpus.developmentNotes()],
    [
      'fixtures',
      [
        ...corpus.edgeCaseNotes(),
        ...corpus.randomNotes(1, 80),
        ...corpus.randomNotes(7, 80),
        ...corpus.randomNotes(42, 150),
        ['rendering-suite.md', '# Safety\n[bad](javascript:alert(1))\n\n<script>alert(1)</script>\n\n**safe**'],
      ],
    ],
  ];
}

// The three helpers below copy dashboardState.ts's private getSectionBody,
// getFrontmatterBody, and getFilePreamble, which choose what a card shows.

/** A section's card body: its lines after the heading, less one blank line. */
function getSectionBody(rawContent) {
  const lines = rawContent.split(/\r?\n/);
  return lines.length > 1 ? lines.slice(1).join('\n').replace(/^\n/, '') : '';
}

/** A note's text after its front matter. */
function getFrontmatterBody(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return content;
  }
  const endLine = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  return endLine >= 0 ? lines.slice(endLine + 1).join('\n').replace(/^\n/, '') : content;
}

/** What a note's own card shows: its body, or the text above its first heading. */
function getFilePreamble(file) {
  const body = getFrontmatterBody(file.content);
  const firstHeading = file.sections.find((section) => !section.isInline);
  if (file.frontmatterTags.length > 0 || !firstHeading) {
    return body;
  }
  const lines = file.content.split(/\r?\n/).slice(0, firstHeading.startLine - 1);
  return getFrontmatterBody(lines.join('\n')).trim();
}

/**
 * Every snippet a search could show for a body: for each line, the start
 * that findSnippetStart picks when a searched word is on it.
 */
function snippetsOf(body) {
  const lines = body.split(/\r?\n/);
  const snippets = new Set();
  for (const line of lines) {
    const word = line.trim().toLowerCase();
    const start = word ? findSnippetStart(lines, [word]) : undefined;
    if (start !== undefined) {
      snippets.add(lines.slice(start).join('\n'));
    }
  }
  return [...snippets];
}

/**
 * Every input the pages render, once each: excerpts (card bodies, note
 * cards, hub notes, and search snippets, through renderMarkdown) and
 * titles (as the Dashboard, the Task Board, and query blocks pass them to
 * renderMarkdownInline). Empty inputs are left out: both sides draw nothing.
 */
function collectInputs(corpora) {
  const inputs = new Map();
  const add = (kind, text, where) => {
    if (!text.trim()) {
      return;
    }
    const key = `${kind}\u0000${text}`;
    const known = inputs.get(key) ?? { kind, text, where, corpora: new Set() };
    known.corpora.add(where.corpus);
    inputs.set(key, known);
  };
  for (const [name, notes] of corpora) {
    corpus.parseNotes(notes).forEach((file) => addFileInputs(file, name, add));
  }
  return [...inputs.values()];
}

/** Adds one parsed note's excerpts and titles. */
function addFileInputs(file, corpusName, add) {
  const where = (line) => ({ corpus: corpusName, file: file.filePath, line });
  file.sections.forEach((section) => {
    const body = getSectionBody(section.rawContent);
    add('excerpt', body, where(section.startLine));
    snippetsOf(body).forEach((snippet) => add('excerpt', snippet, where(section.startLine)));
  });
  add('excerpt', getFilePreamble(file), where(1));
  if (file.hub) {
    add('excerpt', getFrontmatterBody(file.content), where(1));
  }
  file.tasks.forEach((task) => {
    add('title', task.title, where(task.lineNumber));
    add('title', stripTrailingTags(task.title) || task.title, where(task.lineNumber));
    add('title', stripTrailingTags(task.title) || task.title.trim(), where(task.lineNumber));
  });
}

// ----- The token side's reference writer ----------------------------------

/** Text as HTML text. */
function escapeText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Inline tokens as the HTML markdown-it would have written for them. A wiki
 * link is its literal text, as the pages have always shown one.
 */
function writeInline(tokens) {
  return tokens.map(writeInlineToken).join('');
}

/** One inline token as HTML. */
function writeInlineToken(token) {
  switch (token.kind) {
    case 'text':
    case 'wikiLink':
      return escapeText(token.text);
    case 'code':
      return `<code>${escapeText(token.text)}</code>`;
    case 'break':
      return '<br />\n';
    case 'link':
      return `<a href="${escapeText(token.url)}"${token.title ? ` title="${escapeText(token.title)}"` : ''}>${writeInline(token.children)}</a>`;
    default:
      return `<${token.kind}>${writeInline(token.children)}</${token.kind}>`;
  }
}

/**
 * Blocks as HTML. A tight list's paragraphs are bare text, and a table is
 * its cells' words with no element around them, as the sanitizer left it.
 */
function writeBlocks(blocks, tight) {
  return blocks.map((block) => writeBlock(block, tight)).join('');
}

/** One block as HTML. */
function writeBlock(block, tight) {
  switch (block.kind) {
    case 'paragraph':
      return tight ? writeInline(block.children) : `<p>${writeInline(block.children)}</p>\n`;
    case 'heading':
      return `<h${block.level}>${writeInline(block.children)}</h${block.level}>\n`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = block.items.map((item) => `<li>${writeBlocks(item, block.tight)}</li>\n`).join('');
      return `<${tag}>\n${items}</${tag}>\n`;
    }
    case 'code':
      return `<pre><code>${escapeText(block.text)}</code></pre>\n`;
    case 'quote':
      return `<blockquote>\n${writeBlocks(block.children, false)}</blockquote>\n`;
    case 'rule':
      return '<hr />\n';
    default:
      return block.rows.map((row) => row.map((cell) => `\n${writeInline(cell)}\n`).join('')).join('\n');
  }
}

// ----- Reading both sides back --------------------------------------------

/** Elements that break the text around them, so their edges count as a space. */
const BLOCK_ELEMENTS = new Set(['p', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'hr', 'br']);

/**
 * What a reader sees in some HTML: the text, with white space collapsed
 * outside `<pre>` as a browser collapses it, and the elements in order, with
 * each link's href.
 */
function readHtml(html) {
  const segments = [];
  const elements = [];
  let preDepth = 0;
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        elements.push(name === 'a' ? `a[${attributes.href ?? ''}]` : name);
        preDepth += name === 'pre' ? 1 : 0;
        segments.push({ text: BLOCK_ELEMENTS.has(name) ? ' ' : '', pre: false });
      },
      ontext(text) {
        segments.push({ text, pre: preDepth > 0 });
      },
      onclosetag(name) {
        preDepth -= name === 'pre' ? 1 : 0;
        segments.push({ text: BLOCK_ELEMENTS.has(name) ? ' ' : '', pre: false });
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  const text = segments
    .map((segment) => (segment.pre ? segment.text : segment.text.replace(/\s+/g, ' ')))
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim();
  return { text, elements };
}

/** Element names without link targets, which the comparison counts apart. */
function tagNames(elements) {
  return elements.map((element) => element.replace(/\[.*$/s, ''));
}

/** Both renderings of one input, read back. */
function renderBoth(input) {
  const legacy = input.kind === 'title' ? rendering.renderMarkdownInline(input.text) : rendering.renderMarkdown(input.text);
  const tokens = input.kind === 'title' ? writeInline(tokenizeInline(input.text)) : writeBlocks(buildBlockExcerpt(input.text), false);
  return { legacy: readHtml(legacy), tokens: readHtml(tokens) };
}

/** Whether two readings show the same text and the same elements. */
function sameReading(left, right) {
  return left.text === right.text && tagNames(left.elements).join(' ') === tagNames(right.elements).join(' ');
}

// ----- Explaining a difference --------------------------------------------

const SAFE_HREF = /^(?:https?|mailto):/i;

/**
 * The constructs Q8 of docs/implementation/20-webviews.md lists, each with a
 * test that says whether it explains a difference. Each test undoes its
 * construct's difference on one side; a difference is explained when the
 * constructs it holds, undone together, leave the two sides the same.
 */
const CONSTRUCTS = [
  {
    name: 'strikethrough',
    holds: (input) => /~~/.test(input.text),
    undo: (reading) => ({ ...reading, tokens: { ...reading.tokens, elements: reading.tokens.elements.filter((e) => e !== 'del') } }),
  },
  {
    name: 'link to a target other than http, https, or mailto',
    holds: (input, reading) => reading.legacy.elements.some((e) => e.startsWith('a[') && !SAFE_HREF.test(e.slice(2, -1))),
    undo: (reading) => ({
      ...reading,
      legacy: { ...reading.legacy, elements: reading.legacy.elements.filter((e) => !e.startsWith('a[') || SAFE_HREF.test(e.slice(2, -1))) },
    }),
  },
  {
    name: 'Markdown inside a wiki link',
    holds: (input) => /\[\[[^\]\n]*[*_~`&\\<[][^\]\n]*\]\]/.test(input.text),
    undo: (reading, input) => {
      // markdown-it, shown the wiki links with their punctuation escaped,
      // draws them as the literal text the tokens keep.
      const escaped = input.text.replace(/!?\[\[[^\]\n]*\]\]/g, (link) => link.replace(/[!-/:-@[-`{-~]/g, '\\$&'));
      const legacy = input.kind === 'title' ? rendering.renderMarkdownInline(escaped) : rendering.renderMarkdown(escaped);
      return { ...reading, legacy: readHtml(legacy) };
    },
  },
  {
    name: 'link reference definition',
    holds: (input) => /^ {0,3}\[[^\]]+\]:/m.test(input.text),
    undo: (reading) => reading,
  },
];

/**
 * The constructs that explain a difference, or none when undoing all those
 * the input holds still leaves the sides apart: a difference the tokens
 * must fix.
 */
function explain(input, reading) {
  const held = CONSTRUCTS.filter((construct) => construct.holds(input, reading));
  const undone = held.reduce((current, construct) => construct.undo(current, input), reading);
  return sameReading(undone.legacy, undone.tokens) ? held.map((construct) => construct.name) : [];
}

/** Whether every safe link markdown-it drew points where the token's link points. */
function sameHrefs(reading) {
  const safe = (elements) => elements.filter((e) => e.startsWith('a[') && SAFE_HREF.test(e.slice(2, -1)));
  return safe(reading.legacy.elements).join(' ') === safe(reading.tokens.elements).join(' ');
}

// ----- The report ---------------------------------------------------------

/** Compares every input and groups the differences by what explains them. */
function compare(inputs) {
  const counts = { title: { compared: 0, identical: 0 }, excerpt: { compared: 0, identical: 0 } };
  const groups = new Map();
  let hrefDifferences = 0;
  for (const input of inputs) {
    const reading = renderBoth(input);
    counts[input.kind].compared += 1;
    hrefDifferences += sameHrefs(reading) ? 0 : 1;
    if (sameReading(reading.legacy, reading.tokens)) {
      counts[input.kind].identical += 1;
      continue;
    }
    const names = explain(input, reading);
    const key = names.length > 0 ? names.join(' + ') : 'UNEXPLAINED';
    groups.set(key, [...(groups.get(key) ?? []), { input, reading }]);
  }
  return { counts, groups, hrefDifferences };
}

/** One differing input, with what each side shows. */
function describeCase({ input, reading }) {
  const where = `${input.where.corpus}: ${input.where.file}:${input.where.line}`;
  return [
    `    ${input.kind} from ${where}`,
    `      input:       ${JSON.stringify(input.text.length > 300 ? `${input.text.slice(0, 300)}…` : input.text)}`,
    `      markdown-it: ${tagNames(reading.legacy.elements).join(' ') || '(no elements)'} | ${JSON.stringify(reading.legacy.text)}`,
    `      tokens:      ${tagNames(reading.tokens.elements).join(' ') || '(no elements)'} | ${JSON.stringify(reading.tokens.text)}`,
  ].join('\n');
}

/** Prints the counts and each group of differences. */
function printReport(inputs, result) {
  const { counts, groups, hrefDifferences } = result;
  const perCorpus = (name, kind) => inputs.filter((input) => input.kind === kind && input.corpora.has(name)).length;
  console.log('Card Markdown: rendering.ts against the token tree\n');
  console.log('Distinct inputs by corpus (an input in two corpora counts in both):');
  for (const name of ['sample', 'development', 'fixtures']) {
    console.log(`  ${name.padEnd(12)} ${String(perCorpus(name, 'title')).padStart(5)} titles ${String(perCorpus(name, 'excerpt')).padStart(6)} excerpts`);
  }
  console.log(`\nTitles:   ${counts.title.compared} compared, ${counts.title.identical} identical`);
  console.log(`Excerpts: ${counts.excerpt.compared} compared, ${counts.excerpt.identical} identical`);
  console.log(`Inputs whose web and mail links point elsewhere: ${hrefDifferences}\n`);
  if (groups.size === 0) {
    console.log('No differences.');
    return;
  }
  console.log('Differences, by the construct that explains them:\n');
  for (const [name, cases] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    const titles = cases.filter((c) => c.input.kind === 'title').length;
    console.log(`  ${name}: ${cases.length} (${titles} titles, ${cases.length - titles} excerpts)`);
    (SHOW_ALL ? cases : cases.slice(0, 1)).forEach((c) => console.log(describeCase(c)));
    console.log('');
  }
}

const inputs = collectInputs(readCorpora());
const result = compare(inputs);
printReport(inputs, result);
process.exitCode = result.groups.has('UNEXPLAINED') ? 1 : 0;
