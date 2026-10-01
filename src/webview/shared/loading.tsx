/** What a part of a page shows while what it draws is on its way. */
export interface LoadingProps {
  readonly label: string;
  /**
   * Shows the line at once, for a line drawn again on every tick, such as
   * the sidebar's indexing count, whose 400 ms wait would otherwise start
   * over forever.
   */
  readonly immediate?: boolean;
}

/**
 * A loading line, drawn as the shell's own loading line is, which keeps
 * `#app` busy while it is there.
 */
export function Loading({ label, immediate }: LoadingProps) {
  return (
    <div class={immediate ? 'loading is-immediate' : 'loading'} role="status">
      <span>{label}</span>
    </div>
  );
}
