/**
 * A `[[wiki link]]` as the control that opens the note it names, wherever a
 * page draws one: in a note's words on the Note page, and in a task's title
 * on every page that lists tasks.
 */
import type { OpenWikiLinkMessage } from '../../ui/protocol/shared';
import { openingOf } from './openSource';

/**
 * What a `[[link]]` reads as on the page: the words after its `|` when it
 * has them, or the note it names and the heading or line after "›".
 */
export function wikiLinkWords(written: string): string {
  const inner = written.replace(/^\[\[|\]\]$/g, '');
  const bar = inner.indexOf('|');
  if (bar >= 0) {
    return inner.slice(bar + 1).trim();
  }
  return inner.replace(/#\^?/, ' › ').replace(/^ › /, '');
}

/**
 * The link's button. `from` is the note it is written in when the page
 * says so; otherwise the note of the row or card around it is read when it
 * is followed (`openWikiLinkMessage`).
 */
export function WikiLink({ text, target, from }: { readonly text: string; readonly target: string; readonly from?: string }) {
  return (
    <button type="button" class="note-link" data-action="open-link" data-target={target} data-from={from} data-tip={`Open ${target} · Shift-click: the other way`}>
      {wikiLinkWords(text)}
    </button>
  );
}

/**
 * The openWikiLink message a link's button sends: its target, read from the
 * note it names on the button or, in a task's title, the note of the row or
 * card that holds it, opened as the click asked.
 */
export function openWikiLinkMessage(link: HTMLElement, event?: MouseEvent | KeyboardEvent): OpenWikiLinkMessage {
  const how = openingOf(event);
  const from = link.dataset.from ?? link.closest<HTMLElement>('[data-file-path]')?.dataset.filePath;
  return {
    type: 'openWikiLink',
    target: String(link.dataset.target),
    ...(from ? { from } : {}),
    ...(how.opposite ? { opposite: true } : {}),
    ...(how.beside ? { beside: true } : {}),
  };
}
