import type { ComponentChildren } from 'preact';

import { HelpIcon } from './icons';

/** An icon-only button: what it does, what it shows, and how it says so. */
export interface IconButtonProps {
  /** The `data-action` its click runs. */
  readonly action?: string;
  /** Its accessible name, and its tip unless `tip` says otherwise. */
  readonly label: string;
  readonly icon: ComponentChildren;
  readonly tip?: string;
  /** The key that does the same, which the tip draws as `<kbd>`. */
  readonly tipKey?: string;
  /** Classes after `icon-button`. */
  readonly className?: string;
  /** Any other attributes, such as `data-help-anchor`, by name. */
  readonly attributes?: Readonly<Record<string, string>>;
  /** Whether a toggle is on; a button that is no toggle leaves it out. */
  readonly pressed?: boolean;
  /** Why the button cannot act now, which holds it with `aria-disabled` and says so in its tip. */
  readonly disabledReason?: string;
}

/**
 * An icon-only button: its label is its accessible name and its tip, and it
 * never carries a native title, which no keyboard ever saw.
 */
export function IconButton(props: IconButtonProps) {
  return (
    <button
      type="button"
      class={props.className ? `icon-button ${props.className}` : 'icon-button'}
      data-action={props.action || undefined}
      {...props.attributes}
      aria-label={props.label}
      data-tip={props.tip || props.label}
      data-tip-key={props.tipKey || undefined}
      aria-pressed={props.pressed === undefined ? undefined : props.pressed}
      aria-disabled={props.disabledReason ? 'true' : undefined}
      data-tip-disabled={props.disabledReason || undefined}
    >
      {props.icon}
    </button>
  );
}

/**
 * The way to Help from any page, opened at `anchor` when one is given. Help
 * was reachable only from one icon in the Related Notes sidebar, or the
 * command palette, so the pages a reader gets stuck on offered no route to
 * it.
 */
export function HelpButton({ anchor }: { readonly anchor?: string }) {
  return (
    <IconButton
      action="open-help"
      className="help-button"
      label="Open Help"
      icon={<HelpIcon />}
      attributes={anchor ? { 'data-help-anchor': anchor } : undefined}
    />
  );
}
