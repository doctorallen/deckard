import { ActiveSource } from './host/activeSource';

/** A widget Home can add, as its + Add widget list names it. */
export interface HomeWidgetChoice {
  value: string;
  label: string;
  description?: string;
}

/** Home, whose widgets the Related Notes sidebar can add while it is in front. */
export interface HomeSource {
  /** The widgets + Add widget offers, as the page last listed them. */
  getWidgetChoices(): HomeWidgetChoice[];
  /** Adds a widget, putting Home into customizing first. */
  addWidget(value: string): void;
  /** Asks, then puts back the widgets Home starts with. */
  resetWidgets(): Promise<void>;
}

/**
 * Knows whether Home is the active editor, so Related Notes can offer its
 * widgets while it is: the `ActiveSource` of Home, under the name the
 * sidebar and the composition root know it by. Nothing tells it whether the
 * sidebar is open, so it never moves Home's part between the two.
 */
export class ActiveHome extends ActiveSource<HomeSource> {}
