/**
 * A question as a search page draws it (docs/implementation/38-questions.md):
 * on its Questions tab, and under To ask on a person's Between you card.
 */
import type { SearchPageQuestion } from '../../ui/protocol/searchPage';

/**
 * One question a search found, or a person's card lists: its mark, its
 * words, which open its line, how long it has been open and its first tag,
 * or its answer, and, while it is open, Answer…, quiet under Zen until the
 * row is pointed at.
 */
export function QuestionRow({ question }: { readonly question: SearchPageQuestion }) {
  return (
    <li class={question.answered ? 'search-question is-answered' : 'search-question'} data-zen-region="">
      <span class="search-question-mark" aria-hidden="true">?</span>
      <button type="button" class="search-question-open" data-action="open-source" data-file-path={question.filePath} data-line={question.line}>
        <span class="search-question-text">{question.text}</span>
        <span class="search-question-detail">{question.answer ? `${question.detail} · Answer: ${question.answer}` : question.detail}</span>
      </button>
      {question.answered
        ? null
        : <button type="button" class="search-question-answer" data-action="answer-question" data-question-id={question.id} data-zen-reveal="" data-tip="Write the answer under the question">Answer…</button>}
    </li>
  );
}
