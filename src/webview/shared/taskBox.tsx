/**
 * A task's checkbox, drawn by its status: done checked; in progress half
 * filled, as a checkbox whose state is mixed, which a screen reader says;
 * cancelled checked and dimmed, its row struck through; a character no
 * status names outlined; and an open status's icon beside it. Its label
 * names the status, so the state is never in the drawing alone.
 */
import type { DrawnStatus } from '../../ui/protocol/shared';

/** What a status icon draws as. */
const STATUS_ICONS: Readonly<Record<string, string>> = {
  blocked: '⊘',
  question: '?',
  alert: '!',
  star: '★',
  flag: '⚑',
  clock: '◷',
};

/** Whether a task's box is checked: done, or cancelled, which is closed too. */
export function isBoxChecked(completed: boolean, status: DrawnStatus | undefined): boolean {
  return completed || status?.type === 'cancelled';
}

/** A status as a box's label says it, after what the box does: `, In progress`, or nothing. */
export function speakBoxStatus(status: DrawnStatus | undefined): string {
  if (!status) {
    return '';
  }
  return `, ${status.unknown === undefined ? status.name : `a status Deckard doesn't know, [${status.unknown}]`}`;
}

/** A box's label: what it toggles, and the status, when the box alone does not say it. */
export function describeBox(title: string, status: DrawnStatus | undefined): string {
  return `Toggle ${title}${speakBoxStatus(status)}`;
}

/**
 * What any task box takes from its status: whether it is checked, whether
 * it is half filled, and the marker its styles read.
 */
export function statusBoxProps(completed: boolean, status: DrawnStatus | undefined): Record<string, string | boolean> {
  return {
    ...(status ? { 'data-status': status.unknown === undefined ? status.type : 'unknown' } : {}),
    checked: isBoxChecked(completed, status),
    indeterminate: status?.type === 'inProgress',
  };
}

/** The icon an open status adds beside its box, or nothing. */
export function StatusIcon({ status }: { readonly status: DrawnStatus | undefined }) {
  const icon = status?.icon === undefined ? undefined : STATUS_ICONS[status.icon];
  return icon ? <span class="status-icon" aria-hidden="true">{icon}</span> : null;
}

/** The box, and the icon its status adds. */
export function TaskBox({ taskId, completed, status, title, className }: {
  readonly taskId: string;
  readonly completed: boolean;
  readonly status?: DrawnStatus;
  readonly title: string;
  readonly className?: string;
}) {
  const box = (
    <input
      key="toggle"
      type="checkbox"
      class={className}
      data-action="toggle-task"
      data-task-id={taskId}
      {...statusBoxProps(completed, status)}
      aria-label={describeBox(title, status)}
    />
  );
  if (status?.icon === undefined) {
    return box;
  }
  return (
    <span key="toggle" class="task-box-with-icon">
      {box}
      <StatusIcon status={status} />
    </span>
  );
}
