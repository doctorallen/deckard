/**
 * Display: how a page is drawn. Zen is one switch (`deckard.display.zen`):
 * on, it takes off each theme's decoration and the lines that teach,
 * tightens the spacing, draws cards flat and tags as text, and quiets the
 * tools under each page's bar until their area is pointed at or tabbed
 * into (shared/reveal.css). It never
 * hides data: every count, and the date beside how far off a task is due,
 * show with Zen on or off. An entry's details, its file and line among
 * them, show on hover either way; `deckard.display.cardDetails` says which.
 */

/** What Zen turns on, each as the page body is marked for it. */
export const ZEN_CHOICES = {
  styling: 'plain',
  help: 'hidden',
  density: 'compact',
  cards: 'flat',
  tags: 'text',
  controls: 'quiet',
} as const;

/**
 * How a page is drawn, each value named only when it isn't the default:
 * plain theme styling, help text hidden, compact density, flat rows rather
 * than raised cards, tags as text rather than chips, and the tools under
 * a page's bar drawn only when their area is pointed at or tabbed into
 * (`quiet`), which Zen turns on together; an entry's details never drawn; and pages as wide as their
 * panel (`full`).
 */
export interface DisplayChoices {
  readonly styling?: 'plain';
  readonly help?: 'hidden';
  readonly density?: 'compact';
  readonly cards?: 'flat';
  readonly tags?: 'text';
  readonly controls?: 'quiet';
  /** `never` when Card details ticks nothing, so an entry's details stay folded on hover too. */
  readonly fileAndLine?: 'never';
  /** The details an entry shows besides, or in place of, its file and line, when not the file and line alone: "fileAndLine created". */
  readonly details?: string;
  readonly width?: 'full';
  /** `deckard.display.dateFormat`, when it isn't `YYYY-MM-DD`. */
  readonly dateFormat?: string;
  /** `deckard.display.shortDateFormat`, when it isn't `ddd, MMM D`. */
  readonly shortDateFormat?: string;
  /** The display language `L` to `llll` follow, when it isn't English. */
  readonly dateLocale?: string;
  /** The day a week starts on, when it isn't Sunday and a format counts weeks by it. */
  readonly weekStart?: number;
}
