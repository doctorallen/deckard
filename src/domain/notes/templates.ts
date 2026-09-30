import { formatLocalDate } from './periodicNotes';

/**
 * Note templates: the questions a template asks, the variables every
 * template can use, and filling both in.
 */

/** A placeholder: `{ask:Question}`, or a variable such as `{date}`. */
const PLACEHOLDER = /\{(?:ask:([^{}]*)|([a-z]+))\}/g;

/**
 * The questions a template asks with `{ask:Question}`, each once, in the order
 * they first appear.
 */
export function findTemplatePrompts(template: string): string[] {
  const questions = [...template.matchAll(PLACEHOLDER)]
    .map((match) => match[1]?.trim())
    .filter((question): question is string => Boolean(question));
  return [...new Set(questions)];
}

/**
 * Fills a template's placeholders in one pass, so a value that itself holds
 * braces is written as it is. A placeholder without a value is left as written.
 */
export function fillTemplate(
  template: string,
  variables: Readonly<Record<string, string>>,
  answers: ReadonlyMap<string, string> = new Map(),
): string {
  return template.replace(
    PLACEHOLDER,
    (placeholder, question: string | undefined, name: string | undefined) => {
      if (question !== undefined) {
        return answers.get(question.trim()) ?? placeholder;
      }
      return name !== undefined && Object.hasOwn(variables, name)
        ? variables[name]
        : placeholder;
    },
  );
}

/** The variables every template can use: `{title}`, `{date}`, and `{time}`. */
export function getTemplateVariables(
  title: string,
  now: Date,
): Record<string, string> {
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return { title, date: formatLocalDate(now), time: `${hours}:${minutes}` };
}
