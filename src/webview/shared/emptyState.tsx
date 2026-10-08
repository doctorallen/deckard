/**
 * What an empty place says: the state line, which always shows, then a line
 * that teaches, marked .help-text so Zen's help step puts it away, then at
 * most one next step. Each place keeps its own words and its own class, so
 * a sentence that said both, such as "No tasks. Drag a card here.", is
 * split where the state ends and nothing else about it changes.
 */
import type { ComponentChild } from 'preact';

/** What an empty place says, and the element it is said in. */
export interface EmptyStateProps {
  /** What is there, or is not, such as "No tasks."; always drawn. */
  readonly state: string;
  /** How to fill the place, drawn after the state line. */
  readonly teach?: string;
  /** The one next step, such as a button, drawn last. */
  readonly action?: ComponentChild;
  /** The class the place's sheet styles; `empty` when omitted. */
  readonly class?: string;
  /** The element drawn: a paragraph, or a div where the place draws one. */
  readonly as?: 'p' | 'div';
}

/** An empty place's state line, its teaching line, and its next step. */
export function EmptyState({ state, teach, action, class: className = 'empty', as: Tag = 'p' }: EmptyStateProps) {
  return (
    <Tag class={className}>
      {state}
      {teach ? <span class="help-text">{` ${teach}`}</span> : null}
      {action ? [' ', action] : null}
    </Tag>
  );
}
