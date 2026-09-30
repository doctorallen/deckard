import { matchTaskLine, TaskLineShape } from './lineShapes';
import { findFencedLines } from './parser';
import {
  findTaskMetadataSpans,
  parseRecurrence,
  suggestRecurrence,
} from './taskMetadata';

/**
 * Which repeat rules on a note's open tasks Deckard cannot read, and what
 * to say about each. The repeat-rule diagnostics in `ui/providers` mark
 * what these find.
 */

/** An open task line; one space or tab after its box belongs to the box. */
const OPEN_TASK: TaskLineShape = { indent: 'whitespace', marks: ' ', after: 'optional-blank' };

/** An open task's repeat rule Deckard cannot read. */
export interface RepeatRuleProblem {
  /** Zero-based line, and the columns of the rule's own text. */
  line: number;
  start: number;
  end: number;
  rule: string;
  suggestions: string[];
}

/**
 * The repeat rules on a note's open tasks that Deckard cannot read, each
 * with the nearest rules it can. Completing such a task would drop the
 * repeat without a word, so the rule is worth marking before then. Code and
 * front matter are left alone, and so are done tasks, which repeat no more.
 */
export function findRepeatRuleProblems(lines: readonly string[]): RepeatRuleProblem[] {
  const fenced = findFencedLines([...lines]);
  let skip = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, at) => at > 0 && /^(---|\.\.\.)\s*$/.test(line));
    skip = end > 0 ? end + 1 : 0;
  }
  const problems: RepeatRuleProblem[] = [];
  lines.forEach((text, line) => {
    const task = matchTaskLine(text, OPEN_TASK);
    if (!task || line < skip || fenced.has(line)) {
      return;
    }
    const offset = task.head.length + task.gap.length;
    const body = text.slice(offset);
    for (const span of findTaskMetadataSpans(body)) {
      if (span.field !== 'repeat' || !span.value || parseRecurrence(span.value)) {
        continue;
      }
      const written = body.slice(span.start, span.end);
      const start = offset + span.start + written.lastIndexOf(span.value);
      problems.push({
        line,
        start,
        end: start + span.value.length,
        rule: span.value,
        suggestions: suggestRecurrence(span.value),
      });
    }
  });
  return problems;
}

/** What the diagnostic says, with the nearest rule or an example of one. */
export function describeRepeatRuleProblem(problem: Pick<RepeatRuleProblem, 'rule' | 'suggestions'>): string {
  const lead = `Deckard cannot read the repeat rule "${problem.rule}", so completing this task will not start the next one.`;
  return problem.suggestions.length > 0
    ? `${lead} Try "${problem.suggestions[0]}".`
    : `${lead} Write a rule such as "every week", "every month on the 15th", or "every weekday".`;
}

