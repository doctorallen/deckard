/**
 * Text that may hold a progress figure, "Steps 1/3 done (33%)": shown as
 * written, and given to a screen reader as it is spoken, "Steps 1 of 3 done,
 * 33%" (domain/tasks/progressCount.ts). Text with no figure is drawn as is.
 */
import { speakProgressText } from '../../domain/tasks/progressCount';

/** The text, with its spoken form beside it for a screen reader when it holds a figure. */
export function ProgressText({ text }: { readonly text: string }) {
  const spoken = speakProgressText(text);
  if (spoken === text) {
    return <>{text}</>;
  }
  return (
    <>
      <span aria-hidden="true">{text}</span>
      <span class="visually-hidden">{spoken}</span>
    </>
  );
}
