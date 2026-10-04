/** How a click or a key on an entry asks the host to open where it is written. */
import type { OpenSourceMessage } from '../../ui/protocol/shared';

/**
 * How a click or key asks for a result: Cmd/Ctrl beside the page, a
 * double-click (the second click of it) keeping the tab, and Shift where
 * `deckard.openNotesIn` does not open notes, the editor or the note page.
 */
export function openingOf(event: MouseEvent | KeyboardEvent | undefined): { beside: boolean; pin: boolean; opposite: boolean } {
  return {
    beside: Boolean(event && (event.metaKey || event.ctrlKey)),
    pin: Boolean(event && (event as MouseEvent).detail >= 2),
    opposite: Boolean(event && event.shiftKey),
  };
}

/** An openSource message for an element's file and line, opened as asked. */
export function openSourceMessage(element: HTMLElement, event?: MouseEvent | KeyboardEvent): OpenSourceMessage {
  const how = openingOf(event);
  return {
    type: 'openSource',
    filePath: element.dataset.filePath as string,
    line: Number(element.dataset.line),
    ...(how.beside ? { beside: true } : {}),
    ...(how.pin ? { pin: true } : {}),
    ...(how.opposite ? { opposite: true } : {}),
  };
}
