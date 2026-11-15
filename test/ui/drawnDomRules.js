// Rules every page's DOM must keep, read from what a surface draws.
//
// A compiled page leaves no markup to read as text, so these rules read the
// DOM Chrome drew. The layout check captures each surface's body before its
// probe touches anything (test/ui/checkLayout.js) and holds it to these, in
// every pass it draws. They used to read the DOM goldens, which are retired.
// verifyWebviews.js holds the page text of a page whose host builds its body
// (Help and the debug page) to the content-row rule as well, and an ESLint
// rule forbids `title` on a control or an element with `tabIndex` in `.tsx`,
// for the states no surface draws. None of them depends on the theme.

/** Classes that render a row a reader can open. */
const CONTENT_ROWS = [
  'tag-row', 'entity-row', 'note-row', 'task-row', 'saved-filter-row',
  'board-card', 'stat-row',
];

/**
 * Whether a row's classes include the shared surface every content row
 * needs, so it gets the same border, hover and focus as every other one.
 * Layout rows such as .control-row are not content and are not listed in
 * CONTENT_ROWS.
 *
 * @param {string[]} classes The row's classes.
 * @returns {boolean} Whether one of them is a shared surface.
 */
function hasSharedSurface(classes) {
  return classes.includes('row') || classes.includes('card') || classes.includes('task');
}

/**
 * The actions a filled control may take: plan 29, R2 makes `.primary`, the
 * --chosen fill, the page's one primary action, and only an action that
 * commits something. Navigation, a suggestion, or the search box's own
 * controls are never filled.
 */
const COMMITS = new Set(['add-task', 'save-to-tasks-view', 'save', 'create-day', 'open-daily-note']);

/**
 * Cards and rows that show more of themselves on hover: a card's details on
 * its line, a panel its score opens, and a saved search's criteria under its
 * row. The tip keeps off them only where the card says it shows them
 * (data-tip-around).
 */
const OPENING = '.note, .card, .task-row, .home-row, .tag-row, .board-card, .saved-filter-row';

/** Whether an element carries an attribute named title, or ending in -title. */
function titled(element) {
  return [...element.attributes].some((attribute) => /(^|[^\w])title$/.test(attribute.name));
}

/** Whether an element carries a tabindex, under any prefix. */
function tabbable(element) {
  return [...element.attributes].some((attribute) => /(^|[^\w])tabindex$/.test(attribute.name));
}

/** The start of an element, for a problem's line. */
function opening(element) {
  return element.outerHTML.slice(0, 120);
}

/**
 * What a drawn body breaks: a content row with no shared surface, a control
 * with a native title, which never shows on keyboard focus (a control says
 * it with data-tip; non-focusable spans and a select's options may keep
 * one), more than one filled control, or one that commits nothing, or
 * another idiom for the primary action, or a card that opens on hover
 * without saying so to the tip.
 *
 * @param {object} body The body Chrome drew, parsed.
 * @param {string} page The surface's page. Help is the guide's prose:
 *   nothing in it folds a line under itself or holds a tip.
 * @returns {{ problems: string[], filled: number, cards: number }} Each
 *   problem as a line, and how many filled controls and opening cards the
 *   body has, so a run can tell the rules still find some.
 */
function drawnDomProblems(body, page) {
  const problems = [];
  for (const element of body.querySelectorAll('[class]')) {
    const classes = element.getAttribute('class').split(/\s+/);
    if (CONTENT_ROWS.some((rowClass) => classes.includes(rowClass)) && !hasSharedSurface(classes)) {
      problems.push(`a content row is missing a shared surface (.row/.card): "${element.getAttribute('class')}"`);
    }
  }
  const native = [...body.querySelectorAll('*')].find((element) =>
    titled(element) && (/^(button|summary|input|select|textarea|a)$/.test(element.localName) || tabbable(element)));
  if (native) {
    problems.push(`a control carries a native title: ${opening(native)}`);
  }
  const primaries = [...body.querySelectorAll('.primary')];
  if (primaries.length > 1) {
    problems.push(`${primaries.length} filled controls; a page fills at most one`);
  }
  for (const primary of primaries.filter((element) => !COMMITS.has(String(element.getAttribute('data-action'))))) {
    problems.push(`a filled control that commits nothing: ${opening(primary)}`);
  }
  for (const other of body.querySelectorAll('.query-primary, .is-primary, .query-apply')) {
    problems.push(`another idiom for the primary action: ${opening(other)}`);
  }
  const cards = page === 'help' ? [] : [...body.querySelectorAll(OPENING)];
  for (const card of cards.filter((element) => !element.hasAttribute('data-tip-around'))) {
    problems.push(`a card that opens on hover does not say so to the tip (data-tip-around): ${opening(card)}`);
  }
  return { problems, filled: primaries.length, cards: cards.length };
}

module.exports = { CONTENT_ROWS, hasSharedSurface, drawnDomProblems };
