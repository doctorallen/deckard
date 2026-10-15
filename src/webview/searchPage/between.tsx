/**
 * Between you (docs/implementation/36-between-you.md): on a person's page,
 * every open line between the reader and them, in the groups a one-to-one
 * goes through. Each row is the board's task row, its box completing it
 * and its title opening the line, or, under To ask, the Questions tab's
 * row, with Answer…; each group's label opens the search the group is.
 * Copy as agenda waits under Zen; the counts and dates stay.
 */
import type { SearchPageBetween, SearchPageBetweenGroup } from '../../ui/protocol/searchPage';
import { TaskListRow } from '../shared/taskRow';
import { QuestionRow } from './questionRow';

/** A group's first lines: its tasks, or its questions, or that it has none. */
function BetweenLines({ group }: { readonly group: SearchPageBetweenGroup }) {
  if (group.questions && group.questions.length) {
    return <ul class="search-questions between-questions">{group.questions.map((question) => <QuestionRow key={question.id} question={question} />)}</ul>;
  }
  return group.tasks.length
    ? <div class="task-list between-tasks">{group.tasks.map((item) => <TaskListRow key={item.task.id} item={item} />)}</div>
    : <p class="between-none">Nothing open.</p>;
}

/** One group: its label, which opens its search, its count, and its first lines. */
function BetweenGroup({ group }: { readonly group: SearchPageBetweenGroup }) {
  const more = group.count - group.tasks.length - (group.questions ? group.questions.length : 0);
  return (
    <div class="between-group" data-group={group.kind}>
      <h3 class="between-group-heading">
        <button type="button" class="between-group-label" data-action="open-between-search" data-group={group.kind} data-tip={`Open these as a search: ${group.query}`}>{group.label}</button>
        <span class="between-count">{String(group.count)}</span>
      </h3>
      <BetweenLines group={group} />
      {more > 0
        ? <p class="between-more"><button type="button" class="between-more-link" data-action="open-between-search" data-group={group.kind}>{`Show all ${group.count}`}</button></p>
        : null}
    </div>
  );
}

/**
 * The card, under the fields and above the tabs; nothing on a page that is
 * no person's, or of someone with no open line between you. While
 * `deckard.me` names nobody it says so, with the setting a click away.
 */
export function BetweenCard({ between }: { readonly between: SearchPageBetween | undefined }) {
  if (!between) {
    return null;
  }
  return (
    <section class="between" aria-labelledby="between-heading" data-zen-region="">
      <div class="between-header">
        <h2 id="between-heading" class="between-title">Between you</h2>
        <button type="button" class="between-copy" data-action="copy-agenda" data-tip="Copy these lines as a Markdown agenda, for a one-to-one note" data-zen-reveal="">Copy as agenda</button>
      </div>
      {between.needsIdentity
        ? (
          <p class="between-identity">
            {'Deckard doesn’t know who you are yet, so only tasks for nobody count as yours. '}
            <button type="button" class="tag-note-action" data-action="set-identity" data-tip={'Open the "Me" setting, and write the tag you use for yourself'}>Set who you are…</button>
          </p>
        )
        : null}
      {between.groups.map((group) => <BetweenGroup key={group.kind} group={group} />)}
    </section>
  );
}
