/**
 * One search box: the query bar and its completions, the builder, the
 * search's removable terms, and the facets that narrow its results. The
 * Task Board, a search page, and Home each draw one.
 *
 * The host owns the applied search. The editor keeps only what is being
 * typed and any builder rows not finished yet, and hands a finished search
 * back through `options.apply`. It is not a component with state of its
 * own: a page makes one with `createQueryEditor`, draws its parts with
 * `bar()` and `facets()` from its own store, and tells it about each draw
 * and each event, as the template script it replaces was told.
 */
import { type ComponentChild, type ComponentChildren, createRef, render } from 'preact';

import type { QueryFacet, QueryTermChip, QueryViewState } from '../../ui/protocol/query';
import { FacetValue, facetValuesShown } from './facets';
import {
  buildQueryFromTree,
  cloneTree,
  combineQuery,
  DEFAULT_OPERATORS,
  type EditorGroup,
  type EditorItem,
  type EditorRow,
  FIELD_PLACEHOLDERS,
  groupAt,
  isGroup,
  itemAt,
  joinTags,
  MAX_SEARCH_LENGTH,
  mergeAlternative,
  OPERATOR_DESCRIPTIONS,
  OPERATOR_LABELS,
  parseConditionText,
  pathOf,
  pathText,
  pendingRow,
  previewWords,
  PRIORITY_OPERATOR_DESCRIPTIONS,
  quoteQueryValue,
  removeItem,
  scanQuery,
  SHORTHAND_FIELDS,
  TEXT_OPERATOR_DESCRIPTIONS,
  valueContext,
} from './queryText';
import { setSearchInFlight } from './status';

/** What a page tells its search box. */
export interface QueryEditorOptions {
  /** The host's view of this search, if it has sent one. */
  readonly getState: () => QueryViewState | undefined;
  /** Draws the page again, which draws the editor's parts. */
  readonly render: () => void;
  /** Runs a search typed, built, or refined here; `record` is false for a step along the way. */
  readonly apply: (text: string, record: boolean) => void;
  /** Empties the search. */
  readonly clear: () => void;
  /** Hears every keystroke, so a page can filter what it shows by the plain words being typed. */
  readonly onDraft?: (text: string) => void;
  /** The empty box's hint. */
  readonly placeholder?: string | (() => string);
  /** What the box searches, for assistive technology. */
  readonly label?: string;
  /**
   * What Clear leaves in the box, such as the page's own tag on a tag
   * overview. Empty unless given; Clear is held while the box holds only this.
   */
  readonly clearedText?: () => string;
  /** What the search can find: notes and tasks unless a page lists only one. */
  readonly resultKinds?: ReadonlyArray<'notes' | 'tasks'>;
  /** True while the sidebar shows this search's Refine, so the page shows a line in its place. */
  readonly refineElsewhere?: () => boolean;
  /** True while the page counts the results elsewhere, so the count is for a screen reader alone. */
  readonly countElsewhere?: () => boolean;
  /**
   * The page's own buttons for the bar, such as Save. A button that needs
   * text carries `data-query-needs-text` and is always drawn, held with
   * `aria-disabled` until there is text, so the bar never shifts under the
   * pointer while a search is typed.
   */
  readonly actions?: (hasText: boolean) => ComponentChildren;
  /**
   * True while one of `actions` is the bar's filled button, marked
   * `query-primary`, so Search is drawn as the others are: one filled
   * control to a page.
   */
  readonly ownPrimary?: () => boolean;
}

/** How a value is added to a search: AND, AND NOT, or OR beside the facet's chosen value. */
export type RefineMode = 'and' | 'exclude' | 'or';

/** The mode a click or Enter adds a value in: Alt leaves it out, Shift allows it as well, plain narrows. */
export function refineModeOf(event: MouseEvent | KeyboardEvent): RefineMode {
  if (event.altKey) {
    return 'exclude';
  }
  return event.shiftKey ? 'or' : 'and';
}

/** A search box, as a page draws and drives it. */
export interface QueryEditor {
  /** The bar, its status line, the search's terms, and the builder; `statusControls` sits in the status line. */
  bar(statusControls?: ComponentChildren): ComponentChild;
  /**
   * What the results could still be narrowed by, with counts; nothing when
   * there is nothing to say. `lead` is a line of the page's own at its top,
   * such as a tag page's entries that write its name without it.
   */
  facets(lead?: ComponentChild): ComponentChild;
  /** The search as the box holds it now: the applied one with what is being typed, or a whole draft. */
  currentText(): string;
  /** The plain words of a search, which a page can match before the host answers. */
  previewWords(text: string): string[];
  /** Reconciles with a fresh host state, before the page draws it. */
  receive(): void;
  /** Told before the page draws, so the caret can be put back where the reader was typing. */
  beforeRender(): void;
  /** Puts back focus, the caret, and any open completion list after the page drew. */
  afterRender(): void;
  /** Puts the caret in the search box, with its recent searches. */
  focus(): void;
  /**
   * Narrows the search by a clause from outside Refine, such as a tag on a
   * card, as a click on Refine's value for it would: added with AND, left
   * out with `exclude`, or with `or` beside the value of the same facet the
   * search already has.
   */
  refineBy(clause: string, mode: RefineMode): void;
  /** Each returns true when the event belonged to the editor. */
  handleMousedown(event: MouseEvent): boolean;
  handleFocusIn(event: FocusEvent): void;
  handleClick(event: MouseEvent): boolean;
  handleKeydown(event: KeyboardEvent): boolean;
  handleInput(event: Event): boolean;
  handleChange(event: Event): boolean;
}

/** One completion as the open list holds it. */
interface SuggestionItem {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
  /** What replaces the word being completed in the bar, or the value set in a builder field. */
  readonly insert?: string;
  /** A whole search, which replaces this one and runs. */
  readonly replaceAll?: boolean;
  readonly apply?: boolean;
  /** A whole term, which becomes a chip at once. */
  readonly term?: boolean;
  /** A new row's condition, as typed. */
  readonly condition?: string;
  /** A new row's field, which becomes an ordinary row to fill in. */
  readonly field?: string;
  /** Kept whatever was typed. */
  readonly always?: boolean;
}

/** Completions for one field: what is being completed, and what is offered. */
interface SuggestionSource {
  readonly token: string;
  readonly items: readonly SuggestionItem[];
  /** Offered whole, rather than filtered by the token. */
  readonly showAll?: boolean;
}

/** Whether a search the editor ran is still out after a second. */
let searchInFlight = false;

/** A term's text, with its AND, OR, and NOT and its parentheses in their own color. */
export function TermText({ text }: { readonly text: string }) {
  const drawn: ComponentChild[] = [];
  let offset = 0;
  for (const piece of scanQuery(text)) {
    if (piece.kind !== 'op' && piece.kind !== 'paren') {
      continue;
    }
    if (piece.start > offset) {
      drawn.push(text.slice(offset, piece.start));
    }
    drawn.push(<span class={piece.kind === 'op' ? 'query-op' : 'query-paren'}>{text.slice(piece.start, piece.end).toUpperCase()}</span>);
    offset = piece.end;
  }
  if (offset < text.length) {
    drawn.push(text.slice(offset));
  }
  return <>{drawn}</>;
}

/** The word between two terms, AND unless the search joins them with OR. */
function ChipJoin({ word }: { readonly word: string }) {
  return <span class="query-chip-join" aria-hidden="true">{word}</span>;
}

/**
 * One term as a chip whose face removes it; a group as a bordered run of
 * its own chips with a remove of its own at the end, nested as the builder
 * has it, so a condition inside a group goes alone and the group goes whole.
 */
function TermChip({ term }: { readonly term: QueryTermChip }) {
  // Words show as the text condition they run.
  const label = term.label || term.text;
  if (term.items && term.items.length) {
    return <TermGroupChip term={term} items={term.items} label={label} />;
  }
  const pieces = scanQuery(term.text);
  const tag = pieces.length === 1 && pieces[0].kind === 'tag' ? pieces[0] : undefined;
  // A link is one chip, struck through when negated, as a tag is.
  const link = pieces.length === 1 && pieces[0].kind === 'link' ? pieces[0] : undefined;
  let className = tag ? 'query-chip is-tag' : 'query-chip';
  if (term.negated || tag?.negated || link?.negated) {
    className += ' is-negated';
  }
  return (
    <button type="button" class={className} data-action="remove-term" data-without={term.without} aria-label={`Remove ${label}`} data-tip={`Remove ${label}`} data-tip-overflow={label}>
      <span class="query-chip-label"><TermText text={label} /></span>
      <span class="query-chip-remove" aria-hidden="true">×</span>
    </button>
  );
}

/**
 * A group of terms: a bordered run of its own chips. The frame removes the
 * group, as a chip's whole face removes its term; a chip inside is found
 * first by the click, so it goes alone.
 */
function TermGroupChip({ term, items, label }: { readonly term: QueryTermChip; readonly items: readonly QueryTermChip[]; readonly label: string }) {
  return (
    <span class={term.negated ? 'query-chip-group is-negated' : 'query-chip-group'} role="group" aria-label={label} data-action="remove-term" data-without={term.without}>
      {term.negated ? <ChipJoin word="NOT" /> : null}
      <TermChips terms={items} join={term.join} />
      <button type="button" class="query-chip query-chip-group-remove" data-action="remove-term" data-without={term.without} aria-label={`Remove the group ${label}`} data-tip={`Remove the group ${label}`}>
        <span class="query-chip-remove" aria-hidden="true">×</span>
      </button>
    </span>
  );
}

/** Terms as chips, joined by the word between them. */
function TermChips({ terms, join }: { readonly terms: readonly QueryTermChip[]; readonly join?: string }) {
  const word = join === 'or' ? 'OR' : 'AND';
  return <>{terms.map((term, index) => [index > 0 ? <ChipJoin word={word} /> : null, <TermChip term={term} />])}</>;
}

/** The empty, hidden list a field's completions are drawn into, its own render root once open. */
function SuggestionBox({ suggestKey }: { readonly suggestKey: string }) {
  return <div class="query-suggestions popover is-dropdown" id={`suggestions-${suggestKey}`} data-suggestions={suggestKey} hidden role="listbox" aria-label="Suggestions" />;
}

/** The open completion list's options; the highlighted one is named to a screen reader by its id. */
function SuggestionOptions({ items, index, idPrefix }: { readonly items: readonly SuggestionItem[]; readonly index: number; readonly idPrefix: string }) {
  return (
    <>
      {items.map((item, at) => (
        <button
          type="button"
          role="option"
          tabIndex={-1}
          id={`${idPrefix}-${at}`}
          aria-selected={at === index}
          class={at === index ? 'query-suggestion active' : 'query-suggestion'}
          data-action="query-suggestion"
          data-suggestion-index={at}
        >
          <span class="query-suggestion-label"><TermText text={item.label} /></span>
          {item.detail ? <span class="query-suggestion-detail">{item.detail}</span> : null}
        </button>
      ))}
    </>
  );
}

/** `spellcheck="false"`, written as an attribute in every browser: Chrome's property would read the string as true. */
const NO_SPELLCHECK: Readonly<Record<string, string>> = { spellCheck: 'false' };

/** The builder's word before a row or group: where, and, or or. */
function BuilderJoiner({ index, join }: { readonly index: number; readonly join: string }) {
  let word = 'where';
  if (index > 0) {
    word = join === 'or' ? 'or' : 'and';
  }
  return <span class="query-builder-and">{word}</span>;
}

/** A row's Remove. */
function RemoveRow({ at }: { readonly at: string }) {
  return <button class="query-builder-remove" data-action="builder-remove-row" data-path={at} aria-label="Remove this condition">Remove</button>;
}

/** The operator descriptions a field's operators are named by. */
function descriptionsFor(field: string): Readonly<Record<string, string>> {
  if (field === 'text') {
    return { ...OPERATOR_DESCRIPTIONS, ...TEXT_OPERATOR_DESCRIPTIONS };
  }
  return field === 'priority' ? { ...OPERATOR_DESCRIPTIONS, ...PRIORITY_OPERATOR_DESCRIPTIONS } : OPERATOR_DESCRIPTIONS;
}

/** What a builder row draws with, besides the row. */
interface BuilderContext {
  readonly fieldNames: readonly string[];
  readonly operatorsFor: (field: string) => readonly string[];
}

/** A row of the builder: a new row's one field, a row it cannot edit as written, or field, operator, and value. */
function BuilderRow({ row, path, joiner, context }: { readonly row: EditorRow; readonly path: readonly number[]; readonly joiner: ComponentChild; readonly context: BuilderContext }) {
  const at = pathText(path);
  const suggestKey = `p${at ? at.replace(/\./g, '_') : ''}`;
  if (row.pending) {
    return (
      <div class="query-builder-row">
        {joiner}
        <span class="query-input-shell query-builder-value-shell">
          <input
            class="query-builder-value query-builder-pending"
            data-action="builder-set-value"
            data-pending="true"
            data-suggest-key={suggestKey}
            data-path={at}
            value={row.value || ''}
            placeholder="Type a tag, a word, or a value such as open"
            aria-label="New condition"
            role="combobox"
            aria-expanded="false"
            aria-autocomplete="list"
            aria-controls={`suggestions-${suggestKey}`}
            autocomplete="off"
            {...NO_SPELLCHECK}
          />
          <SuggestionBox suggestKey={suggestKey} />
        </span>
        <RemoveRow at={at} />
      </div>
    );
  }
  if (!row.supported) {
    return (
      <div class="query-builder-row">
        {joiner}
        <code class="query-builder-readonly">{row.text}</code>
        <RemoveRow at={at} />
      </div>
    );
  }
  const descriptions = descriptionsFor(row.field);
  const operatorTitle = descriptions[row.operator] || 'Operator';
  return (
    <div class="query-builder-row">
      {joiner}
      <select data-action="builder-set-field" data-path={at} aria-label="Field">
        {context.fieldNames.map((field) => <option value={field} selected={field === row.field}>{field}</option>)}
      </select>
      <select class="query-builder-operator" data-action="builder-set-operator" data-path={at} aria-label={`Operator: ${operatorTitle}`} data-tip={operatorTitle}>
        {context.operatorsFor(row.field).map((operator) => (
          <option value={operator} title={descriptions[operator] || ''} selected={operator === row.operator}>{OPERATOR_LABELS[operator] || operator}</option>
        ))}
      </select>
      <span class="query-input-shell query-builder-value-shell">
        <input
          class="query-builder-value"
          data-action="builder-set-value"
          data-suggest-key={suggestKey}
          data-field={row.field}
          data-path={at}
          value={row.value}
          placeholder={FIELD_PLACEHOLDERS[row.field] || ''}
          aria-label="Value"
          role="combobox"
          aria-expanded="false"
          aria-autocomplete="list"
          aria-controls={`suggestions-${suggestKey}`}
          autocomplete="off"
          {...NO_SPELLCHECK}
        />
        <SuggestionBox suggestKey={suggestKey} />
      </span>
      <RemoveRow at={at} />
    </div>
  );
}

/** A group's head: not, how it joins its rows, and, below the root, its Remove. */
function BuilderGroupHead({ group, at, depth }: { readonly group: EditorGroup; readonly at: string; readonly depth: number }) {
  return (
    <div class="query-builder-group-head">
      <button type="button" class={group.negated ? 'query-builder-not active' : 'query-builder-not'} data-action="builder-toggle-not" data-path={at} aria-pressed={group.negated ? 'true' : 'false'} data-tip="Turn this group around: match what it does not">not</button>
      <span class="query-builder-head-text">match</span>
      <select data-action="builder-set-join" data-path={at} aria-label="How this group combines its rows">
        <option value="and" selected={group.join !== 'or'}>all of</option>
        <option value="or" selected={group.join === 'or'}>any of</option>
      </select>
      {depth > 0 ? <button class="query-builder-remove" data-action="builder-remove-group" data-path={at}>Remove group</button> : null}
    </div>
  );
}

/** A group, nested to any depth: its head, its rows and groups, and what adds to it. */
function BuilderGroup({ group, path, depth, context }: { readonly group: EditorGroup; readonly path: readonly number[]; readonly depth: number; readonly context: BuilderContext }) {
  const at = pathText(path);
  let className = 'query-builder-group';
  if (depth === 0) {
    className += ' is-root';
  }
  if (group.negated) {
    className += ' is-negated';
  }
  const items = group.items.length
    ? group.items.map((item: EditorItem, index) => {
      const itemPath = [...path, index];
      const joiner = <BuilderJoiner index={index} join={group.join} />;
      return isGroup(item)
        ? <div class="query-builder-item has-group">{joiner}<BuilderGroup group={item} path={itemPath} depth={depth + 1} context={context} /></div>
        : <BuilderRow row={item} path={itemPath} joiner={joiner} context={context} />;
    })
    : <p class="query-builder-note">This group is empty. Add a condition to start it.</p>;
  return (
    <div class={className} data-group-path={at}>
      <BuilderGroupHead group={group} at={at} depth={depth} />
      {items}
      <div class="query-builder-actions">
        <button data-action="builder-add-row" data-path={at}>Add condition</button>
        <button data-action="builder-add-group" data-path={at}>Add group</button>
      </div>
    </div>
  );
}

/** Where the caret sits, defaulting to the end of the value. */
function caretPosition(input: HTMLInputElement): number {
  return typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
}

/** Whether an event's target is a field a key types into. */
function isEditable(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

/** The element an event happened on, as an element, if it is one. */
function targetOf(event: Event): HTMLElement | null {
  return event.target instanceof Element ? (event.target as HTMLElement) : null;
}

/**
 * A tag the search already names in the namespace of `tag`, which a tag
 * from outside Refine is put beside with OR when no facet offers it:
 * `#project/atlas` for `#project/zeus`. None for a tag with no namespace.
 */
function namespaceSibling(text: string, tag: string): string | undefined {
  const slash = tag.indexOf('/');
  if (!/^[#@]/.test(tag) || slash < 0) {
    return undefined;
  }
  const prefix = tag.slice(0, slash + 1).toLowerCase();
  return text.split(/[\s()]+/).find((word) => word.toLowerCase().startsWith(prefix) && word.toLowerCase() !== tag.toLowerCase());
}

/** Makes one search box for a page; see `QueryEditor`. */
export function createQueryEditor(options: QueryEditorOptions): QueryEditor {
  return new SearchBox(options);
}

/** The search box `createQueryEditor` makes: the template's closure, as a class. */
class SearchBox implements QueryEditor {
  /**
   * A whole search waiting to be run, such as one the builder wrote or Clear
   * left; undefined means the box shows the applied search and the entry.
   */
  private draft: string | undefined;
  /** The next term, being typed in the field after the chips. */
  private entry = '';
  /** The entry the last search that ran was written with. */
  private lastEntry = '';
  /** The entry to keep once the host answers the search that ran. */
  private entryAfterRun = '';
  /** The applied search the editor last saw. */
  private appliedSeen: string | undefined;
  /** Set between applying a search and seeing the host's answer. */
  private awaitingApply = false;
  /** Refine facets opened past their first five, kept through redraws. */
  private readonly expandedFacets = new Set<string>();
  /** Fires a second into a search that has not come back. */
  private searchingTimer: ReturnType<typeof setTimeout> | undefined;
  private builderOpen = false;
  /**
   * Local builder rows. A row not finished yet contributes nothing to the
   * search text, so the rows cannot come straight from the host's parse;
   * the draft owns them until they turn into text the host can parse.
   */
  private builderDraft: EditorGroup | undefined;
  /** The applied search the rows were last reconciled with. */
  private builderSourceText: string | undefined;
  /** A builder value input to focus once the next draw settles. */
  private pendingBuilderFocus: { path: string } | undefined;
  private restoreFocus = false;
  /**
   * Set while the page draws around the box, so a field the draw takes out
   * of the document is not taken for the reader leaving it.
   */
  private redrawing = false;
  /** Where the caret sat when the draw began, to put it back. */
  private caretAtRedraw: number | null | undefined;
  /** Set while the caret is being put back, so the list stays closed. */
  private suppressFocusSuggestions = false;
  /** Set when the reader asked for the box itself, such as by pressing /. */
  private openSuggestionsOnRestore = false;
  private suggestionItems: readonly SuggestionItem[] = [];
  private suggestionIndex = -1;
  /** Which input the completion list belongs to, if any. */
  private suggestionHostKey: string | undefined;
  /** The partial text the completion list is filtering on. */
  private suggestionToken = '';
  /** Whether the open list is an empty box's recent searches, offered rather than asked for by typing. */
  private suggestionsUnasked = false;
  /** Why the last search was held back as too long, until a search runs or the search changes. */
  private tooLong: string | undefined;
  /** Whether the pointer went down in the search box, so leaving its field for its buttons keeps what was typed. */
  private pointerInWorkspace = false;
  /** The bar's field, where the caret is put back. */
  private readonly barInput = createRef<HTMLInputElement>();

  public constructor(private readonly options: QueryEditorOptions) {
    this.listen();
  }

  /**
   * Text typed and not added as a term is let go when the search box loses
   * focus, as a multi-select does; moving to the box's own buttons keeps it.
   */
  private listen(): void {
    document.addEventListener('mousedown', (event) => {
      const target = targetOf(event);
      this.pointerInWorkspace = Boolean(target && target.closest('.query-workspace'));
    }, true);
    document.addEventListener('mouseup', () => {
      setTimeout(() => {
        this.pointerInWorkspace = false;
      }, 0);
    }, true);
    document.addEventListener('focusout', (event) => {
      const target = event.target as HTMLElement | null;
      if (this.redrawing) {
        return;
      }
      if (!target || !target.dataset || target.dataset.action !== 'query-input' || !this.entry) {
        return;
      }
      const next = event.relatedTarget as Element | null;
      if (this.pointerInWorkspace || (next && next.closest && next.closest('.query-workspace'))) {
        return;
      }
      this.closeSuggestions();
      this.setEntry(target as HTMLInputElement, '');
    }, true);
  }

  private query(): Partial<QueryViewState> {
    return this.options.getState() || {};
  }

  private suggestions(): Partial<QueryViewState['suggestions']> {
    return this.query().suggestions || {};
  }

  private appliedText(): string {
    return this.query().text || '';
  }

  public currentText(): string {
    return this.draft === undefined ? combineQuery(this.appliedText(), this.entry, this.query().canAppend !== false) : this.draft;
  }

  public previewWords(text: string): string[] {
    return previewWords(text);
  }

  private operatorsFor(field: string): readonly string[] {
    const table: Readonly<Record<string, readonly string[]>> = this.suggestions().operators || DEFAULT_OPERATORS;
    return table[field] || DEFAULT_OPERATORS[field] || ['eq'];
  }

  private fieldNames(): string[] {
    const listed = (this.suggestions().fields || []).map((field) => field.value);
    return listed.length ? listed : Object.keys(DEFAULT_OPERATORS);
  }

  private aliases(): Readonly<Record<string, string>> {
    return this.suggestions().aliases || {};
  }

  private clearedText(): string {
    return this.options.clearedText ? String(this.options.clearedText() || '') : '';
  }

  /** Why Clear cannot act: nothing is in the box, or only the page's own tag. */
  private clearReason(): string {
    return this.clearedText().trim() ? "Only this page's own tag is left" : 'The search is already empty';
  }

  /** Whether Clear would change the search. */
  private canClear(text: string): boolean {
    return String(text || '').trim() !== this.clearedText().trim();
  }

  private placeholder(): string {
    const placeholder = this.options.placeholder;
    return typeof placeholder === 'function' ? placeholder() : (placeholder || '');
  }

  /** The applied search as chips, each removing its own term; nothing for no search. */
  private chips(): ComponentChild {
    const text = this.appliedText().trim();
    if (!text) {
      return null;
    }
    const query = this.query();
    const terms = (query.terms || []).length ? (query.terms as QueryTermChip[]) : [{ text, without: '' }];
    return <TermChips terms={terms} join={query.termsJoin || 'and'} />;
  }

  /** Search's class: filled, unless the page's own action is the filled one now. */
  private searchClass(): string | undefined {
    return this.options.ownPrimary?.() ? undefined : 'query-apply';
  }

  public bar(statusControls?: ComponentChildren): ComponentChild {
    const value = this.currentText();
    const hasText = Boolean(String(value).trim());
    const errors = (this.query().diagnostics || []).filter((diagnostic) => diagnostic.severity === 'error');
    const error = this.tooLong ?? (errors.length ? errors[0].message : undefined);
    const terms = this.chips();
    const label = this.options.label || 'Search';
    const invalid = error === undefined ? '' : ' invalid';
    const status = error === undefined
      ? <span key="hint" class="query-hint">Enter searches. Words, #tags, is:open, has:due, in:folder; AND, OR, NOT. Press / to search.</span>
      : <span key="error" class="query-error" role="alert">{error}</span>;
    return (
      <section class={searchInFlight ? 'query-workspace is-searching' : 'query-workspace'} data-has-text={hasText ? '' : undefined} aria-label={label}>
        <div class="query-bar-row">
          <span class={`query-input-shell query-bar-shell${invalid}`} data-query-text={value}>
            {terms}
            <input
              ref={this.barInput}
              class={`query-input${invalid}`}
              type="text"
              data-action="query-input"
              data-suggest-key="query"
              {...NO_SPELLCHECK}
              autocomplete="off"
              role="combobox"
              aria-expanded="false"
              aria-autocomplete="list"
              aria-controls="suggestions-query"
              aria-label={terms ? `${label}: add a term` : label}
              placeholder={terms ? '' : this.placeholder()}
              value={this.entry}
            />
            <SuggestionBox suggestKey="query" />
          </span>
          <button class={this.searchClass()} data-action="apply-query" data-tip="Run this search">Search</button>
          <button data-action="clear-query" data-query-clears="" data-tip="Clear the search" data-tip-disabled={this.clearReason()} aria-disabled={this.canClear(value) ? undefined : 'true'}>Clear</button>
          {this.options.actions ? this.options.actions(hasText) : null}
        </div>
        <div class="query-status">
          <button class="query-builder-toggle" data-action="toggle-builder" aria-expanded={this.builderOpen} data-tip="Build the search one condition at a time">{this.builderOpen ? 'Hide builder' : 'Builder'}</button>
          {status}
          {statusControls}
        </div>
        {this.builder()}
      </section>
    );
  }

  /** The builder, while it is open. */
  private builder(): ComponentChild {
    if (!this.builderOpen) {
      return null;
    }
    const context: BuilderContext = { fieldNames: this.fieldNames(), operatorsFor: (field) => this.operatorsFor(field) };
    return (
      <div class="query-builder">
        <BuilderGroup group={this.builderTree()} path={[]} depth={0} context={context} />
        <p class="query-builder-note">In a new row, type a tag, a word, or a value such as open. Enter adds another row, Backspace in an empty row removes it, and Ctrl or Cmd+Enter adds a group beside the row. A group matches all of its rows or any of them, and not turns it around.</p>
      </div>
    );
  }

  /** Whether the applied search ran and matched nothing of any kind. */
  private matchedNothing(): boolean {
    if (!this.appliedText().trim()) {
      return false;
    }
    const counts = this.query().matchCounts;
    if (!counts) {
      return false;
    }
    return (this.options.resultKinds || ['notes', 'tasks']).every((kind) => !counts[kind]);
  }

  /**
   * Ways out of a search that found nothing. Narrowing is useless here, so
   * the Refine row offers the two ways to widen instead: drop the term that
   * was added last, or go back to what the page opened with.
   */
  private recovery(): ComponentChild {
    const terms = this.query().terms || [];
    const last = terms.length > 1 ? terms[terms.length - 1] : undefined;
    const drop = last
      ? <button key="drop" data-action="remove-term" data-without={last.without} data-tip="Run this search without its last term">{`Drop ${String(last.label || last.text)}`}</button>
      : null;
    const clear = this.canClear(this.currentText())
      ? <button key="clear" data-action="clear-query" data-query-clears="" data-tip="Clear the search">Clear</button>
      : null;
    if (!drop && !clear) {
      return null;
    }
    return <><span class="query-facets-empty">Nothing matched.</span><span class="query-recovery">{drop}{clear}</span></>;
  }

  /** How many of each kind of result the applied search matches. */
  private matchCount(): ComponentChild {
    if (!this.appliedText().trim()) {
      return null;
    }
    const counts = this.query().matchCounts || { notes: 0, tasks: 0 };
    const nouns = { notes: ['note', 'notes'], tasks: ['task', 'tasks'] };
    const elsewhere = this.options.countElsewhere && this.options.countElsewhere();
    const said = (this.options.resultKinds || ['notes', 'tasks']).map((kind) => {
      const count = counts[kind] || 0;
      return `${count} ${nouns[kind][count === 1 ? 0 : 1]}`;
    }).join(' · ');
    return <span class={elsewhere ? 'query-facets-count visually-hidden' : 'query-facets-count'} role="status">{said}</span>;
  }

  /** One facet's values, the first five unless it was opened. */
  private facet(facet: QueryFacet): ComponentChild {
    const shown = facetValuesShown(facet, this.expandedFacets, 'query-facet-more');
    return (
      <div class="query-facet" role="group" aria-label={facet.label}>
        <span class="query-facet-label">{facet.label}</span>
        <span class="query-facet-values">
          {shown.values.map((value) => <FacetValue facet={facet} value={value} />)}
          {shown.more}
        </span>
      </div>
    );
  }

  public facets(lead?: ComponentChild): ComponentChild {
    const facets = this.query().facets || [];
    const count = this.matchCount();
    const recovery = this.matchedNothing() ? this.recovery() : null;
    if (!facets.length && !count) {
      return lead ?? null;
    }
    const top = lead ? <div class="query-facets-lead">{lead}</div> : null;
    const nothingLeft = <span class="query-facets-empty">Nothing left to narrow by.</span>;
    if (this.options.refineElsewhere && this.options.refineElsewhere()) {
      // The sidebar still says where Refine went; a search that matched
      // nothing has nothing to narrow, so it offers the way back instead.
      const note = facets.length ? <span class="query-facets-empty">In the Context sidebar.</span> : (recovery || nothingLeft);
      return (
        <section class="query-facets is-elsewhere" aria-label="Refine these results">
          {top}
          <div class="query-facets-groups"><span class="query-facets-heading">Refine</span>{note}</div>
          {count}
        </section>
      );
    }
    return (
      <section class="query-facets" aria-label="Refine these results">
        {top}
        <div class="query-facets-groups">
          <span class="query-facets-heading">Refine</span>
          {facets.length ? null : (recovery || nothingLeft)}
          {facets.map((facet) => this.facet(facet))}
        </div>
        {count}
      </section>
    );
  }

  /** Sets the entry, in the field and in the editor, without a draw. */
  private setEntry(input: HTMLInputElement | null, text: string): void {
    this.entry = String(text || '');
    this.draft = undefined;
    if (input && input.value !== this.entry) {
      input.value = this.entry;
    }
    this.syncTextButtons(this.currentText());
    this.options.onDraft?.(this.currentText());
  }

  /**
   * Enables the bar's buttons that need text as soon as there is some, in
   * place, rather than drawing the bar again while a search is typed.
   */
  private syncTextButtons(text: string): void {
    const hasText = Boolean(String(text || '').trim());
    // aria-disabled rather than disabled: the button keeps its place in
    // the Tab order, and says why it cannot act when focused.
    const enable = (button: Element, enabled: boolean): void => {
      if (enabled) {
        button.removeAttribute('aria-disabled');
      } else {
        button.setAttribute('aria-disabled', 'true');
      }
      if (button.matches('[data-query-clears]')) {
        button.setAttribute('data-tip-disabled', this.clearReason());
      }
    };
    document.querySelectorAll('[data-query-needs-text]').forEach((button) => enable(button, hasText));
    document.querySelectorAll('[data-query-clears]').forEach((button) => enable(button, this.canClear(text)));
    document.querySelectorAll('.query-bar-shell').forEach((shell) => shell.setAttribute('data-query-text', String(text || '')));
  }

  /**
   * Puts back what the box changed in the page outside a draw, as the draw
   * wrote it: a completion list closed and empty, each field's list said to
   * be closed, and the text buttons and the shell as the text says. The
   * template drew all of these afresh each time; a draw keeps the elements
   * and does not look at what was changed in them.
   */
  private resetDrawnState(): void {
    document.querySelectorAll<HTMLElement>('[data-suggestions]').forEach((container) => {
      render(null, container);
      container.hidden = true;
    });
    document.querySelectorAll('[data-suggest-key]').forEach((input) => {
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    });
    const text = this.currentText();
    const hold = (button: Element, held: boolean): void => {
      if (held) {
        button.setAttribute('aria-disabled', 'true');
      } else {
        button.removeAttribute('aria-disabled');
      }
    };
    document.querySelectorAll('[data-query-needs-text]').forEach((button) => hold(button, !text.trim()));
    document.querySelectorAll('[data-query-clears]').forEach((button) => {
      // The Clear a search that found nothing offers is drawn only when it
      // can act, and without a reason.
      if (button.closest('.query-recovery')) {
        hold(button, false);
        button.removeAttribute('data-tip-disabled');
        return;
      }
      hold(button, !this.canClear(text));
      button.setAttribute('data-tip-disabled', this.clearReason());
    });
    document.querySelectorAll('.query-bar-shell').forEach((shell) => shell.setAttribute('data-query-text', text));
  }

  /**
   * Runs a search. A search that takes in what was typed empties the field;
   * one that only removes or adds a chip, or comes from the builder, keeps
   * it, as keepEntry says.
   */
  private run(text: string, keepEntry?: boolean, incidental?: boolean, focusBar?: boolean): void {
    const search = joinTags(String(text).trim());
    if (this.refuseTooLong(search)) {
      return;
    }
    this.awaitingApply = true;
    // A search still out after a second shows a thin bar under the box.
    clearTimeout(this.searchingTimer);
    // The page's document, held here: the timer can outlive the frame that
    // set it, and must not reach for a global that has since gone.
    const page = document;
    this.searchingTimer = setTimeout(() => {
      if (!this.awaitingApply || !page || !page.querySelectorAll) {
        return;
      }
      searchInFlight = true;
      page.querySelectorAll('.query-workspace').forEach((workspace) => workspace.classList.add('is-searching'));
      setSearchInFlight(true);
    }, 1000);
    this.lastEntry = this.entry;
    this.entryAfterRun = keepEntry ? this.entry : '';
    // The host answers with a fresh snapshot, and the page draws it. Without
    // this the caret would be thrown away on every search. A search built in
    // the builder keeps its own field instead.
    this.restoreFocus = focusBar !== false;
    // A facet click or a dropped chip is a step along the way, not a search
    // worth keeping among the recent ones.
    this.options.apply(search, !incidental);
  }

  /**
   * Holds back a search longer than a host takes, which would otherwise be
   * dropped on the way and leave the box searching for good. What was typed
   * stays where it is, and the status line says why nothing ran; true when
   * the search was held back.
   */
  private refuseTooLong(search: string): boolean {
    if (search.length <= MAX_SEARCH_LENGTH) {
      this.tooLong = undefined;
      return false;
    }
    const count = (value: number): string => value.toLocaleString('en-US');
    this.tooLong = `This search is ${count(search.length)} characters long, and a search can be at most ${count(MAX_SEARCH_LENGTH)}. Shorten it to run it.`;
    this.options.render();
    return true;
  }

  /**
   * Narrows by a facet value: adds it, leaves it out with Alt, or with Shift
   * allows it as well as the value of the same facet already chosen.
   */
  private refine(clause: string, facetId: string, mode: RefineMode): void {
    const text = this.appliedText().trim();
    if (mode === 'or') {
      const facet = (this.query().facets || []).find((candidate) => candidate.id === facetId);
      const existing = facet && facet.applied && facet.applied[0];
      const merged = existing ? mergeAlternative(text, existing, clause) : undefined;
      if (merged !== undefined) {
        this.run(merged, true, true);
        return;
      }
    }
    const term = mode === 'exclude' ? `-${clause}` : clause;
    if (!text) {
      this.run(term, true, true);
    } else if (this.query().canAppend === false) {
      this.run(`(${text}) AND ${term}`, true, true);
    } else {
      this.run(`${text} AND ${term}`, true, true);
    }
  }

  public refineBy(clause: string, mode: RefineMode): void {
    const facet = (this.query().facets || []).find((candidate) => candidate.values.some((value) => value.clause === clause));
    const existing = facet && facet.applied && facet.applied[0];
    const sibling = mode === 'or' && !existing ? namespaceSibling(this.appliedText(), clause) : undefined;
    if (sibling) {
      const merged = mergeAlternative(this.appliedText().trim(), sibling, clause);
      if (merged !== undefined) {
        this.run(merged, true, true);
        return;
      }
    }
    this.refine(clause, facet ? facet.id : '', mode);
  }

  /** Recent searches, for an empty bar: each a whole search, which choosing runs. */
  private recentSuggestions(): SuggestionSource {
    return {
      token: '',
      showAll: true,
      items: (this.suggestions().recent || []).slice(0, 8).map((item) => ({
        value: item.value, label: item.label, detail: item.detail, insert: item.value, replaceAll: true, apply: true,
      })),
    };
  }

  /**
   * Completions for the word under the caret in the bar. After a field and
   * its operator they are that field's values; otherwise conditions, field
   * names, and tags, each of which stands on its own. An empty bar offers
   * recent searches.
   */
  private queryBarSuggestions(input: HTMLInputElement): SuggestionSource {
    const all = this.suggestions();
    if (!input.value.trim()) {
      return this.recentSuggestions();
    }
    const prefix = input.value.slice(0, caretPosition(input));
    const values = all.values || {};
    // After [[ the notes are what is being written, whatever came before.
    const opened = /\[\[[^\]]*$/.exec(prefix);
    if (opened) {
      return {
        token: opened[0],
        items: (values.link || []).map((item) => ({ value: item.label, label: item.label, detail: item.detail, insert: `[[${item.value}]] `, term: true })),
      };
    }
    const context = valueContext(prefix, all.aliases || {});
    if (context) {
      return {
        token: context.token,
        items: (values[context.field as keyof typeof values] || []).map((item) => ({
          value: item.value, label: item.label, detail: item.detail, insert: `${quoteQueryValue(item.value)} `, term: true,
        })),
      };
    }
    const token = (/[^\s()]*$/.exec(prefix) || [''])[0];
    const conditions = (all.conditions || []).map((item) => ({ value: item.value, label: item.label, detail: item.detail, insert: `${item.value} `, term: true }));
    const fields = (all.fields || []).map((item) => {
      const shorthand = SHORTHAND_FIELDS.includes(item.value);
      return { value: item.value, label: item.label + (shorthand ? ':' : ' ='), detail: item.detail, insert: item.value + (shorthand ? ':' : ' = ') };
    });
    const tags = (values.tag || []).map((item) => ({ value: item.value, label: item.label, detail: item.detail, insert: `${item.value} `, term: true }));
    return { token, items: [...conditions, ...fields, ...tags] };
  }

  /** Completions for one builder row's value. */
  private builderValueSuggestions(field: string, token: string): SuggestionSource {
    const values = this.suggestions().values || {};
    return {
      token,
      items: (values[field as keyof typeof values] || []).map((item) => ({ value: item.value, label: item.label, detail: item.detail, insert: item.value })),
    };
  }

  /**
   * Completions for a new row, which starts from a value: a condition, a
   * tag, a field to fill in, or failing those the words themselves.
   */
  private pendingRowSuggestions(token: string): SuggestionSource {
    const all = this.suggestions();
    const values = all.values || {};
    const opened = /^(-?)(\[\[.*)$/.exec(token || '');
    if (opened) {
      // A link, whole: -[[Atlas]] leaves out what links to Atlas.
      return {
        token: opened[2],
        items: (values.link || []).map((item) => ({ value: item.label, label: opened[1] + item.label, detail: item.detail, condition: opened[1] + item.label })),
      };
    }
    const conditions = (all.conditions || []).map((item) => ({ value: item.value, label: item.label, detail: item.detail, condition: item.value }));
    const tags = (values.tag || []).map((item) => ({ value: item.value, label: item.label, detail: item.detail, condition: item.value }));
    const fields = (all.fields || []).map((item) => ({
      value: item.value, label: `${item.label + (SHORTHAND_FIELDS.includes(item.value) ? ':' : ' =')} …`, detail: item.detail, field: item.value,
    }));
    const words = token && !/^-?[#@]/.test(token)
      ? [{ value: token, label: `text ~ ${quoteQueryValue(token)}`, detail: 'Entries containing these words', condition: `text ~ ${quoteQueryValue(token)}`, always: true }]
      : [];
    return { token, items: [...conditions, ...tags, ...fields, ...words] };
  }

  /** Populates and shows the list attached to an input. */
  private openSuggestions(input: HTMLInputElement): void {
    const key = input.dataset.suggestKey;
    if (!key) {
      return;
    }
    let source: SuggestionSource;
    if (key === 'query') {
      source = this.queryBarSuggestions(input);
    } else if (input.dataset.pending) {
      source = this.pendingRowSuggestions(input.value.trim());
    } else {
      source = this.builderValueSuggestions(String(input.dataset.field), input.value);
    }
    const token = String(source.token || '').toLowerCase();
    if (source.showAll) {
      this.suggestionItems = source.items;
    } else {
      this.suggestionItems = token
        ? source.items.filter((item) => item.always
          || String(item.value).toLowerCase().includes(token)
          || String(item.label).toLowerCase().includes(token)).slice(0, 12)
        : [];
    }
    this.suggestionToken = String(source.token || '');
    this.suggestionsUnasked = Boolean(source.showAll);
    this.suggestionHostKey = key;
    // Nothing is highlighted until the author arrows into the list, so Enter
    // runs what they typed instead of silently taking a completion.
    this.suggestionIndex = -1;
    this.renderSuggestions(input);
  }

  private suggestionContainer(key: string | undefined): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-suggestions="${key}"]`);
  }

  /** Draws the open list into its field's box, its own render root, or closes it when it is empty. */
  private renderSuggestions(input: Element | null): void {
    const container = this.suggestionContainer(this.suggestionHostKey);
    if (!container) {
      return;
    }
    if (!this.suggestionItems.length) {
      container.hidden = true;
      render(null, container);
      if (input) {
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
      }
      return;
    }
    // Focus stays in the field, as the ARIA combobox pattern has it; the
    // highlighted option is named to a screen reader by its id instead, so
    // the options are not Tab stops of their own.
    const idPrefix = container.id || 'suggestions';
    render(<SuggestionOptions items={this.suggestionItems} index={this.suggestionIndex} idPrefix={idPrefix} />, container);
    container.hidden = false;
    if (input) {
      input.setAttribute('aria-expanded', 'true');
      if (this.suggestionIndex >= 0) {
        input.setAttribute('aria-activedescendant', `${idPrefix}-${this.suggestionIndex}`);
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }
    const active = container.querySelector('.query-suggestion.active');
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ block: 'nearest' });
    }
  }

  private closeSuggestions(): void {
    this.suggestionItems = [];
    this.suggestionIndex = -1;
    this.suggestionsUnasked = false;
    const container = this.suggestionContainer(this.suggestionHostKey);
    if (container) {
      container.hidden = true;
      render(null, container);
    }
    const host = this.suggestionHostKey ? document.querySelector(`[data-suggest-key="${this.suggestionHostKey}"]`) : null;
    if (host) {
      host.setAttribute('aria-expanded', 'false');
      host.removeAttribute('aria-activedescendant');
    }
    this.suggestionHostKey = undefined;
  }

  /**
   * The builder's tree, seeded from the host's parse on first use, as a copy
   * a caller can change and hand to `applyBuilderTree`.
   */
  private builderTree(): EditorGroup {
    if (!this.builderDraft) {
      this.builderDraft = cloneTree((this.query().builder || { join: 'and', items: [] }) as EditorGroup);
      this.builderSourceText = this.appliedText();
    }
    return cloneTree(this.builderDraft);
  }

  /**
   * Adopts the edited tree, then runs the search it describes. A row still
   * empty changes the tree without changing the search, so that case draws
   * locally instead of making a round trip that would drop it.
   */
  private applyBuilderTree(tree: EditorGroup): void {
    this.builderDraft = tree;
    const text = buildQueryFromTree(tree, 0);
    if (text === this.appliedText()) {
      this.options.render();
      return;
    }
    this.builderSourceText = text;
    this.draft = text;
    this.run(text, true, false, false);
  }

  private rowAt(tree: EditorGroup, input: Element): EditorRow | undefined {
    const item = itemAt(tree, pathOf(input));
    return item && !isGroup(item) ? item : undefined;
  }

  /**
   * Turns a new row into the condition it was given, and opens another new
   * row after it so the next condition can be typed straight away.
   */
  private commitPendingRow(input: Element, conditionText: string | undefined): void {
    const text = String(conditionText).trim();
    if (!text) {
      return;
    }
    const tree = this.builderTree();
    const path = pathOf(input);
    const parent = groupAt(tree, path.slice(0, -1));
    const index = path[path.length - 1];
    if (!parent || !parent.items[index]) {
      return;
    }
    parent.items[index] = parseConditionText(text, this.aliases());
    parent.items.push(pendingRow());
    this.pendingBuilderFocus = { path: pathText([...path.slice(0, -1), parent.items.length - 1]) };
    this.applyBuilderTree(tree);
  }

  /** Takes a completion in the bar: a whole search runs, a term becomes a chip, a field waits for its value. */
  private acceptBarSuggestion(input: HTMLInputElement, item: SuggestionItem): void {
    this.closeSuggestions();
    // A recent search is a whole search, and replaces this one.
    if (item.apply) {
      this.setEntry(input, '');
      this.run(String(item.insert));
      return;
    }
    const caret = caretPosition(input);
    const start = caret - this.suggestionToken.length;
    const insert = String(item.insert);
    const text = input.value.slice(0, start) + insert + input.value.slice(caret);
    // A tag or condition, or a field's value, is a whole term: it becomes a
    // chip at once. A field name waits for its value.
    if (item.term) {
      const search = combineQuery(this.appliedText(), text, this.query().canAppend !== false);
      // Checked before the field is emptied, so a search held back for its
      // length leaves what was typed in it.
      if (this.refuseTooLong(search)) {
        return;
      }
      this.setEntry(input, '');
      this.run(search);
      return;
    }
    this.setEntry(input, text);
    const nextCaret = start + insert.length;
    input.setSelectionRange(nextCaret, nextCaret);
    input.focus();
  }

  /** Takes a completion in a builder row: a new row's field or condition, or a row's value. */
  private acceptBuilderSuggestion(input: HTMLInputElement, item: SuggestionItem): void {
    this.closeSuggestions();
    if (input.dataset.pending) {
      if (item.field) {
        // A field chosen without a value becomes an ordinary row to fill in.
        const tree = this.builderTree();
        const path = pathOf(input);
        const parent = groupAt(tree, path.slice(0, -1));
        if (!parent) {
          return;
        }
        parent.items[path[path.length - 1]] = { field: item.field, operator: this.operatorsFor(item.field)[0], value: '', supported: true, text: '' };
        this.pendingBuilderFocus = { path: pathText(path) };
        this.builderDraft = tree;
        this.options.render();
        return;
      }
      this.commitPendingRow(input, item.condition);
      return;
    }
    // A builder value is committed as soon as it is chosen, so the results
    // update without waiting for the field to lose focus.
    input.value = String(item.insert);
    this.commitBuilderValue(input);
  }

  /** Replaces the word being completed with the chosen suggestion. */
  private acceptSuggestion(index: number): void {
    const item = this.suggestionItems[index];
    if (!item) {
      return;
    }
    const key = this.suggestionHostKey;
    const input = document.querySelector<HTMLInputElement>(`[data-suggest-key="${key}"]`);
    if (!input) {
      return;
    }
    if (key === 'query') {
      this.acceptBarSuggestion(input, item);
    } else {
      this.acceptBuilderSuggestion(input, item);
    }
  }

  private commitBuilderValue(input: HTMLInputElement): void {
    const tree = this.builderTree();
    const row = this.rowAt(tree, input);
    if (!row) {
      return;
    }
    row.value = input.value;
    this.pendingBuilderFocus = { path: String(input.dataset.path || '') };
    this.applyBuilderTree(tree);
  }

  private removeRow(input: Element): void {
    const tree = this.builderTree();
    const removed = removeItem(tree, pathOf(input));
    if (!removed) {
      return;
    }
    const index = removed.path[removed.path.length - 1];
    if (index > 0) {
      this.pendingBuilderFocus = { path: pathText([...removed.path.slice(0, -1), index - 1]) };
    }
    this.applyBuilderTree(tree);
  }

  /** A group inside the group at path, joined the other way, with a row to type in. */
  private addGroup(path: readonly number[]): void {
    const tree = this.builderTree();
    const parent = groupAt(tree, path);
    if (!parent) {
      return;
    }
    parent.items.push({ join: parent.join === 'or' ? 'and' : 'or', items: [pendingRow()] });
    this.pendingBuilderFocus = { path: pathText([...path, parent.items.length - 1, 0]) };
    this.applyBuilderTree(tree);
  }

  /** Clears the timer and the thin bar of a search that has come back. */
  private searchCameBack(): void {
    this.awaitingApply = false;
    clearTimeout(this.searchingTimer);
    if (!searchInFlight) {
      return;
    }
    searchInFlight = false;
    document.querySelectorAll('.query-workspace.is-searching').forEach((workspace) => workspace.classList.remove('is-searching'));
    setSearchInFlight(false);
  }

  public receive(): void {
    const text = this.appliedText();
    // The answer to a search this editor ran replaces what was typed even
    // when the text comes back the same, as when a typed tag moves into the
    // page's title and leaves nothing behind.
    if (text !== this.appliedSeen || this.awaitingApply) {
      const input = document.activeElement as HTMLElement | null;
      const typing = Boolean(input && input.dataset && input.dataset.action === 'query-input');
      // A search this editor ran turns what was typed into chips; one that
      // did not parse keeps it in the field with its error. Any other
      // change, such as a save elsewhere, leaves a term being typed.
      if (this.awaitingApply) {
        this.entry = this.query().pending ? this.lastEntry : this.entryAfterRun;
        this.draft = undefined;
      } else if (!typing) {
        this.entry = '';
        this.draft = undefined;
      }
      this.appliedSeen = text;
      this.tooLong = undefined;
      this.searchCameBack();
    }
    if (text === this.builderSourceText) {
      return;
    }
    this.builderDraft = undefined;
    this.builderSourceText = text;
  }

  public beforeRender(): void {
    const active = document.activeElement as HTMLInputElement | null;
    if (!active || !active.dataset || active.dataset.action !== 'query-input') {
      return;
    }
    this.redrawing = true;
    this.caretAtRedraw = active.selectionStart;
    this.restoreFocus = true;
  }

  /** Puts the caret back in the bar, where the reader was typing. */
  private restoreBarFocus(caretWanted: number | null | undefined): void {
    const bar = this.barInput.current ?? document.querySelector<HTMLInputElement>('[data-suggest-key="query"]');
    if (!bar || !bar.focus) {
      return;
    }
    // Putting the caret back is not the reader asking for the recent
    // searches: only focusing the empty box by hand opens those.
    if (!this.openSuggestionsOnRestore) {
      this.suppressFocusSuggestions = true;
    }
    this.openSuggestionsOnRestore = false;
    bar.focus();
    this.suppressFocusSuggestions = false;
    const typed = bar.value ? bar.value.length : 0;
    // Back where they were typing, not at the end: a draw in the middle of
    // a word would otherwise move the caret under them.
    const caret = caretWanted === undefined || caretWanted === null ? typed : Math.min(caretWanted, typed);
    if (bar.setSelectionRange) {
      bar.setSelectionRange(caret, caret);
    }
  }

  public afterRender(): void {
    this.resetDrawnState();
    const caretWanted = this.caretAtRedraw;
    this.redrawing = false;
    this.caretAtRedraw = undefined;
    if (this.restoreFocus) {
      this.restoreFocus = false;
      this.restoreBarFocus(caretWanted);
    }
    if (this.pendingBuilderFocus) {
      const target = document.querySelector<HTMLElement>(`[data-action="builder-set-value"][data-path="${this.pendingBuilderFocus.path}"]`);
      this.pendingBuilderFocus = undefined;
      if (target && target.focus) {
        target.focus();
      }
    }
    if (this.suggestionHostKey && this.suggestionItems.length) {
      this.renderSuggestions(document.querySelector(`[data-suggest-key="${this.suggestionHostKey}"]`));
    }
  }

  public focus(): void {
    this.restoreFocus = true;
    this.openSuggestionsOnRestore = true;
    this.options.render();
  }

  public handleMousedown(event: MouseEvent): boolean {
    const target = targetOf(event);
    // Pressing on a completion must not move focus out of its field: a
    // builder value commits on blur, which would draw the row again and
    // destroy the completion before its click could land.
    if (target && target.closest('[data-action="query-suggestion"]')) {
      event.preventDefault();
      return true;
    }
    // Pressing the field around the chips puts the caret in it.
    const shell = target && target.classList.contains('query-bar-shell') ? target : undefined;
    const input = shell ? shell.querySelector<HTMLInputElement>('[data-action="query-input"]') : undefined;
    if (input && input.focus) {
      event.preventDefault();
      input.focus();
      return true;
    }
    return false;
  }

  public handleFocusIn(event: FocusEvent): void {
    const target = event.target as HTMLInputElement | null;
    if (this.suppressFocusSuggestions) {
      return;
    }
    if (target && target.dataset && target.dataset.action === 'query-input' && !target.value) {
      this.openSuggestions(target);
    }
  }

  /** Opens or closes the builder; it always opens with an empty row to type in. */
  private toggleBuilder(): void {
    this.builderOpen = !this.builderOpen;
    if (this.builderOpen) {
      // Even when the search already has conditions, such as a page's own tags.
      const tree = this.builderTree();
      if (!tree.items.some((item) => !isGroup(item) && item.pending)) {
        tree.items.push(pendingRow());
      }
      this.builderDraft = tree;
      this.pendingBuilderFocus = { path: pathText([tree.items.length - 1]) };
    }
    this.options.render();
  }

  /** Clear: empties the field and the search, leaving what the page keeps. */
  private clearSearch(): void {
    this.entry = '';
    this.tooLong = undefined;
    this.entryAfterRun = '';
    document.querySelectorAll<HTMLInputElement>('[data-suggest-key="query"]').forEach((bar) => {
      bar.value = '';
    });
    this.draft = this.clearedText();
    this.closeSuggestions();
    this.awaitingApply = true;
    this.syncTextButtons(this.draft);
    this.options.onDraft?.(this.draft);
    this.options.clear();
  }

  /** A builder row or group's head or actions, by its action. */
  private editBuilder(action: string, target: HTMLElement): void {
    const tree = this.builderTree();
    const path = pathOf(target);
    if (action === 'builder-add-group') {
      this.addGroup(path);
      return;
    }
    if (action === 'builder-add-row') {
      const group = groupAt(tree, path);
      if (group) {
        group.items.push(pendingRow());
        this.pendingBuilderFocus = { path: pathText([...path, group.items.length - 1]) };
        this.applyBuilderTree(tree);
      }
      return;
    }
    if (action === 'builder-toggle-not') {
      const group = groupAt(tree, path);
      if (group) {
        group.negated = !group.negated;
        this.applyBuilderTree(tree);
      }
      return;
    }
    // builder-remove-group and builder-remove-row
    if (removeItem(tree, path)) {
      this.applyBuilderTree(tree);
    }
  }

  /** What each of the editor's controls does on a click. */
  private readonly clickActions: Readonly<Record<string, (target: HTMLElement, event: MouseEvent) => void>> = {
    'toggle-builder': () => this.toggleBuilder(),
    'apply-query': () => {
      this.closeSuggestions();
      this.run(this.currentText());
    },
    'clear-query': () => this.clearSearch(),
    'query-suggestion': (target) => this.acceptSuggestion(Number(target.dataset.suggestionIndex)),
    'remove-term': (target) => {
      this.closeSuggestions();
      this.run(target.dataset.without || '', true, true);
      const bar = document.querySelector<HTMLElement>('[data-suggest-key="query"]');
      if (bar && bar.focus) {
        bar.focus();
      }
    },
    facet: (target, event) => this.refine(String(target.dataset.clause), String(target.dataset.facetId), refineModeOf(event)),
    'facet-more': (target) => {
      const id = String(target.dataset.facetId);
      if (this.expandedFacets.has(id)) {
        this.expandedFacets.delete(id);
      } else {
        this.expandedFacets.add(id);
      }
      this.options.render();
    },
    'builder-add-group': (target) => this.editBuilder('builder-add-group', target),
    'builder-add-row': (target) => this.editBuilder('builder-add-row', target),
    'builder-remove-group': (target) => this.editBuilder('builder-remove-group', target),
    'builder-remove-row': (target) => this.editBuilder('builder-remove-row', target),
    'builder-toggle-not': (target) => this.editBuilder('builder-toggle-not', target),
  };

  public handleClick(event: MouseEvent): boolean {
    const element = targetOf(event);
    if (this.suggestionItems.length && !(element && element.closest('.query-input-shell'))) {
      this.closeSuggestions();
    }
    const target = element ? element.closest<HTMLElement>('[data-action]') : null;
    if (!target) {
      return false;
    }
    // A disabled button in the bar is there to hold its place, not to act.
    if ((target as HTMLButtonElement).disabled === true || target.getAttribute('disabled') !== null || target.getAttribute('aria-disabled') === 'true') {
      return true;
    }
    const action = String(target.dataset.action);
    if (!Object.prototype.hasOwnProperty.call(this.clickActions, action)) {
      return false;
    }
    this.clickActions[action](target, event);
    return true;
  }

  /** The arrows, Tab, and Enter while a field's completion list is open; true when one was taken. */
  private handleListKey(event: KeyboardEvent, input: HTMLInputElement): boolean {
    const count = this.suggestionItems.length;
    if (!count || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Tab')) {
      return false;
    }
    if (event.key === 'Tab' && this.suggestionsUnasked && this.suggestionIndex < 0) {
      // An empty box offers its recent searches as soon as it is focused,
      // Tab included, so Tab there is the reader moving on, not choosing
      // one: the list closes and focus leaves the box.
      this.closeSuggestions();
      return false;
    }
    event.preventDefault();
    if (event.key === 'Tab') {
      // Tab means "complete this", so it takes the first entry when the
      // author has not picked one.
      this.acceptSuggestion(this.suggestionIndex >= 0 ? this.suggestionIndex : 0);
      return true;
    }
    this.suggestionIndex = event.key === 'ArrowDown'
      ? (this.suggestionIndex + 1) % count
      : (this.suggestionIndex - 1 + count) % count;
    this.renderSuggestions(input);
    return true;
  }

  /** Enter in a field: a group beside a row with Ctrl or Cmd, the highlighted completion, or what was typed. */
  private handleEnter(event: KeyboardEvent, input: HTMLInputElement, isBar: boolean): void {
    event.preventDefault();
    if (!isBar && (event.metaKey || event.ctrlKey)) {
      this.closeSuggestions();
      this.addGroup(pathOf(input).slice(0, -1));
      return;
    }
    if (this.suggestionItems.length && this.suggestionIndex >= 0) {
      this.acceptSuggestion(this.suggestionIndex);
      return;
    }
    this.closeSuggestions();
    if (isBar) {
      this.run(this.currentText());
    } else if (input.dataset.pending) {
      this.commitPendingRow(input, input.value);
    } else {
      this.commitBuilderValue(input);
    }
  }

  /** Backspace in an empty field: the last chip goes from the bar, an empty row from the builder. */
  private handleBackspace(event: KeyboardEvent, input: HTMLInputElement, isBar: boolean): void {
    if (isBar) {
      const terms = this.query().terms || [];
      if (this.appliedText().trim()) {
        event.preventDefault();
        this.closeSuggestions();
        this.run(terms.length ? terms[terms.length - 1].without : '', false, true);
      }
      return;
    }
    event.preventDefault();
    this.closeSuggestions();
    this.removeRow(input);
  }

  /** / anywhere but a field puts the caret in the search box. */
  private handleSlash(event: KeyboardEvent): boolean {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) {
      return false;
    }
    event.preventDefault();
    this.restoreFocus = true;
    this.options.render();
    return true;
  }

  public handleKeydown(event: KeyboardEvent): boolean {
    const element = targetOf(event);
    const input = element ? element.closest<HTMLInputElement>('[data-suggest-key]') : null;
    if (!input) {
      return this.handleSlash(event);
    }
    const isBar = input.dataset.suggestKey === 'query';
    if (this.handleListKey(event, input)) {
      return true;
    }
    if (event.key === 'Enter') {
      this.handleEnter(event, input, isBar);
      return true;
    }
    if (event.key === 'Backspace' && !input.value && (!isBar || this.draft === undefined)) {
      this.handleBackspace(event, input, isBar);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.suggestionItems.length) {
        this.closeSuggestions();
      } else if (isBar) {
        // Escape with no completions open abandons the term being typed.
        this.setEntry(input, '');
      }
    }
    return true;
  }

  public handleInput(event: Event): boolean {
    const target = event.target as HTMLInputElement;
    if (target.dataset.action === 'query-input') {
      this.setEntry(target, target.value);
      this.openSuggestions(target);
      return true;
    }
    if (target.dataset.action === 'builder-set-value') {
      // The draft keeps what is typed in every row, a new one or not, so a
      // draw before the row is committed, such as an index update's, puts
      // the same text back rather than the value the host last parsed.
      const tree = this.builderTree();
      const row = this.rowAt(tree, target);
      if (row) {
        row.value = target.value;
        this.builderDraft = tree;
      }
      this.openSuggestions(target);
      return true;
    }
    return false;
  }

  public handleChange(event: Event): boolean {
    const target = event.target as HTMLInputElement;
    const action = target.dataset.action;
    if (action === 'builder-set-join') {
      const tree = this.builderTree();
      const group = groupAt(tree, pathOf(target));
      if (group) {
        group.join = target.value === 'or' ? 'or' : 'and';
        this.applyBuilderTree(tree);
      }
      return true;
    }
    if (action !== 'builder-set-field' && action !== 'builder-set-operator' && action !== 'builder-set-value') {
      return false;
    }
    // A new row waits for Enter or a completion; leaving it is not a choice.
    if (target.dataset.pending) {
      return true;
    }
    const tree = this.builderTree();
    const row = this.rowAt(tree, target);
    if (!row) {
      return true;
    }
    if (action === 'builder-set-field') {
      row.field = target.value;
      // Keep the operator valid for the new field.
      const allowed = this.operatorsFor(row.field);
      if (!allowed.includes(row.operator)) {
        row.operator = allowed[0];
      }
    }
    if (action === 'builder-set-operator') {
      row.operator = target.value;
    }
    if (action === 'builder-set-value') {
      row.value = target.value;
    }
    this.applyBuilderTree(tree);
    return true;
  }
}
