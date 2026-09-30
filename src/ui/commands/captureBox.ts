import { formatCaptureLine, formatNoteLine } from '../../domain/capture/captureLines';
import type { TagInfo } from '../../domain/model';
import type { CaptureDraft, CaptureTarget } from '../../services/captureService';

/**
 * What the Capture box shows and does as it is typed into, apart from the
 * Quick Pick that shows it: the title, the buttons, the rows, and what each
 * press, choice, and close means. The prompt in capture.ts only forwards the
 * box's events here and draws what it answers, as `StepList` is for steps.
 */

/** A row of the box, and what choosing it does. */
export interface CaptureRow {
  label: string;
  description?: string;
  detail?: string;
  alwaysShow: true;
  action: 'add' | 'note' | 'tag' | 'restore';
}

/** A title-bar button of the box, by what it does. */
export type CaptureButton = 'link' | 'unlink' | 'literal' | 'reading' | 'heading' | 'today';

/** What was typed, and how it is to be written. */
export interface CaptureAnswer {
  text: string;
  target: CaptureTarget;
  /** A plain list item rather than a task. */
  asNote: boolean;
  /** The words kept as typed, with no date or priority read from them. */
  literal: boolean;
  /** A link back to where the words were selected, written after them. */
  link?: string;
}

/** What Capture starts from: the selected words, and a link back to them. */
export interface CaptureStart {
  text: string;
  link?: string;
}

/** What a box is opened with. */
export interface CaptureBoxOptions {
  initialTarget: CaptureTarget;
  /** The draft kept from the last Capture of the same kind. */
  draft?: CaptureDraft;
  /** The words selected in the editor, which win over the draft. */
  seed?: CaptureStart;
  /** The tags to complete a `#` or person word from, most used first. */
  tags: readonly Pick<TagInfo, 'label' | 'count'>[];
  personMarker: string;
  /**
   * The line the words will be written as, with `link` after them, read at
   * the moment it is asked; shown under the first row when it differs from
   * the words as typed.
   */
  preview(text: string, literal: boolean, link: string | undefined): string;
}

/** What choosing a row, or pressing Enter, comes to. */
export type CaptureAcceptance =
  /** The box's words become `value`, and it stays open. */
  | { kind: 'replace'; value: string }
  /** The words are to be written, and kept as a draft until they are. */
  | { kind: 'answer'; answer: CaptureAnswer; draft: CaptureDraft }
  /** Nothing is typed, so there is nothing to write. */
  | { kind: 'none' };

/** What closing the box does with the words left in it. */
export type CaptureLeaving =
  | { kind: 'save'; draft: CaptureDraft }
  | { kind: 'clear' }
  /** Nothing: the words were accepted, or are the selection as it was. */
  | { kind: 'leave' };

const TAG_SUGGESTION_LIMIT = 8;
/** The word being typed: everything after the last space or opening bracket. */
const TRAILING_WORD = /[^\s([{]*$/;
const labelCollator = new Intl.Collator();

/**
 * The Capture box's state: where the words go, whether they are read or
 * kept as typed, whether the selection's link goes with them, and the draft
 * it offers or restored.
 */
export class CaptureBox {
  /** The words the box opens with: a restored draft's, or the selection's. */
  public readonly initialValue: string | undefined;
  private target: CaptureTarget;
  private literal: boolean;
  /** The draft offered as a row beside a selection, until it is chosen. */
  private offeredDraft: CaptureDraft | undefined;
  private link: string | undefined;
  private linkBack: boolean;
  /**
   * Said in the title until the first keystroke, so restored words are not
   * mistaken for a stray paste.
   */
  private restoring: boolean;
  private accepted = false;

  /** A box for `options.initialTarget`, starting from the selection or the draft. */
  public constructor(private readonly options: CaptureBoxOptions) {
    const { seed, draft } = options;
    // A selection wins; the draft waits as the second row until it is chosen.
    const restored = seed ? undefined : draft;
    this.offeredDraft = seed ? draft : undefined;
    this.link = seed?.link;
    this.linkBack = this.link !== undefined;
    this.literal = restored?.literal ?? false;
    this.target = options.initialTarget;
    this.restoring = restored !== undefined;
    this.initialValue = restored ? restored.text : seed?.text;
  }

  /** The box's title: which Capture it is, and whether it restored a draft. */
  public title(): string {
    return (
      (this.target === 'today' ? 'Deckard: Capture' : 'Deckard: Capture Under a Heading') +
      (this.restoring ? ' — Restored what you were typing' : '')
    );
  }

  /** The title-bar buttons, each offering the other side of what is set now. */
  public buttons(): CaptureButton[] {
    return [
      ...(this.link ? [this.linkBack ? 'unlink' : 'link'] as const : []),
      this.literal ? 'reading' : 'literal',
      this.target === 'today' ? 'heading' : 'today',
    ];
  }

  /**
   * The rows for what is typed. The first is always the typed text, so
   * Enter adds it as a task, with the line it will be written as under it;
   * the second adds it as a plain line. Tag suggestions follow, and
   * choosing one completes the word instead.
   */
  public items(typed: string): CaptureRow[] {
    const value = typed.trim();
    const suggestions = getTagSuggestions(typed, this.options.tags, this.options.personMarker).map(
      (label): CaptureRow => ({
        label,
        description: 'Complete the tag',
        alwaysShow: true,
        action: 'tag',
      }),
    );
    const restore: CaptureRow[] = this.offeredDraft && this.offeredDraft.text !== value
      ? [
          {
            label: 'Restore what you were typing',
            description: this.offeredDraft.text,
            alwaysShow: true,
            action: 'restore',
          },
        ]
      : [];
    return value
      ? [this.addRow(value), ...restore, noteRow(value), ...suggestions]
      : [...restore, ...suggestions];
  }

  /** Something was typed, so a restored draft is now the reader's own words. */
  public typed(): void {
    this.restoring = false;
  }

  /** A title-bar button was pressed. */
  public press(button: CaptureButton): void {
    if (button === 'link' || button === 'unlink') {
      this.linkBack = !this.linkBack;
      return;
    }
    if (button === 'literal' || button === 'reading') {
      this.literal = !this.literal;
      return;
    }
    this.target = this.target === 'today' ? 'heading' : 'today';
  }

  /** Enter, with `typed` in the box and the row of `action` highlighted. */
  public accept(typed: string, action: CaptureRow['action'] | undefined, label = ''): CaptureAcceptance {
    if (action === 'tag') {
      return { kind: 'replace', value: completeLastWord(typed, label) };
    }
    if (action === 'restore' && this.offeredDraft) {
      // The draft's words replace the selection's, which it had no link to.
      const value = this.offeredDraft.text;
      this.literal = this.offeredDraft.literal;
      this.offeredDraft = undefined;
      this.link = undefined;
      this.linkBack = false;
      return { kind: 'replace', value };
    }
    const text = typed.trim();
    if (!text) {
      return { kind: 'none' };
    }
    this.accepted = true;
    const { target, literal } = this;
    return {
      kind: 'answer',
      answer: {
        text,
        target,
        literal,
        asNote: action === 'note',
        ...(this.linkBack && this.link ? { link: this.link } : {}),
      },
      // Kept until it is written: a heading picker closed, or a note that
      // refuses the edit, would otherwise lose it.
      draft: { text, target, literal },
    };
  }

  /** The box closed with `typed` in it. */
  public hide(typed: string): CaptureLeaving {
    if (this.accepted) {
      return { kind: 'leave' };
    }
    const text = typed.trim();
    // Selected words left as they were are not a draft; the draft kept for
    // the next Capture stays.
    if (this.options.seed && text === this.options.seed.text) {
      return { kind: 'leave' };
    }
    return text
      ? { kind: 'save', draft: { text, target: this.target, literal: this.literal } }
      : { kind: 'clear' };
  }

  /** The first row: the words as a task, where they go, and how they will read. */
  private addRow(value: string): CaptureRow {
    const written = this.options.preview(value, this.literal, this.linkBack ? this.link : undefined);
    return {
      label: value,
      description: this.target === 'today' ? "Add to today's note" : 'Choose a heading next',
      // The line as it will be written, so a date read from the words is
      // seen before it is saved, and the button above keeps them instead.
      detail: written && written !== formatCaptureLine(value) ? written : undefined,
      alwaysShow: true,
      action: 'add',
    };
  }
}

/** The second row: the words as a plain note line. */
function noteRow(value: string): CaptureRow {
  return {
    label: 'Add as a note line',
    description: formatNoteLine(value),
    alwaysShow: true,
    action: 'note',
  };
}

/**
 * The tags that complete the word being typed when it starts with `#` or the
 * person marker: tags starting with it, then tags containing it, most used
 * first within each.
 */
export function getTagSuggestions(
  value: string,
  tags: Iterable<Pick<TagInfo, 'label' | 'count'>>,
  personMarker = '@',
  limit = TAG_SUGGESTION_LIMIT,
): string[] {
  const word = (value.match(TRAILING_WORD)?.[0] ?? '').toLowerCase();
  if (!word.startsWith('#') && !word.startsWith(personMarker)) {
    return [];
  }
  const starting: Pick<TagInfo, 'label' | 'count'>[] = [];
  const containing: Pick<TagInfo, 'label' | 'count'>[] = [];
  for (const tag of tags) {
    const label = tag.label.toLowerCase();
    if (label === word || label[0] !== word[0]) {
      continue;
    }
    if (label.startsWith(word)) {
      starting.push(tag);
    } else if (label.includes(word.slice(1))) {
      containing.push(tag);
    }
  }
  const byUse = (
    left: Pick<TagInfo, 'label' | 'count'>,
    right: Pick<TagInfo, 'label' | 'count'>,
  ) => right.count - left.count || labelCollator.compare(left.label, right.label);
  return [...starting.sort(byUse), ...containing.sort(byUse)]
    .slice(0, limit)
    .map((tag) => tag.label);
}

/** Replaces the word being typed with a chosen tag, ready for the next word. */
export function completeLastWord(value: string, label: string): string {
  return `${value.replace(TRAILING_WORD, '')}${label} `;
}
