/** A total's last twelve weeks, and what its line counts by, for its tip. */
export interface MetricTrend {
  /** The total as it stood each week, oldest first, the last one now. */
  readonly points: readonly number[];
  /** The last point less the one before. */
  readonly change: number;
  /** What the line counts by, added to the tile's tip. */
  readonly note?: string;
}

/** One figure in a row of `.metrics`. */
export interface MetricProps {
  readonly label: string;
  readonly value: number | string;
  /** The search the figure counts; with one, the tile is a button that opens it. */
  readonly query?: string;
  /** What opening the search does, for the tip and the accessible name. */
  readonly hint?: string;
  /** The theme's decorative caption, such as `TSK.OVR // 01`. */
  readonly code?: string;
  readonly trend?: MetricTrend;
}

/** "+9 in the last 7 days", "−3 in the last 7 days", or no change. */
export function describeChange(change: number): string {
  if (!change) {
    return 'No change in the last 7 days';
  }
  return `${change > 0 ? `+${change}` : `−${Math.abs(change)}`} in the last 7 days`;
}

/** How long ago a point of a twelve-week line is, in words. */
function weeksAgo(ago: number): string {
  if (ago === 0) {
    return 'Now';
  }
  return ago === 1 ? '1 week ago' : `${ago} weeks ago`;
}

/**
 * A total's last twelve weeks as a line: min to max top to bottom, a flat
 * run as a midline, the latest point marked. Each point names itself on
 * hover ("3 weeks ago: 402") through a thin strip under it. Hidden from
 * assistive technology: the tile says the change in words.
 */
export function Sparkline({ points }: { readonly points: readonly number[] }) {
  if (!points || points.length < 2) {
    return null;
  }
  const width = (points.length - 1) * 10;
  const low = Math.min(...points);
  const high = Math.max(...points);
  const y = (value: number): number => (high === low ? 10 : 18 - ((value - low) / (high - low)) * 16);
  const coordinates = points.map((value, index) => `${index * 10},${y(value).toFixed(1)}`);
  const last = points.length - 1;
  const endY = y(points[last]).toFixed(1);
  return (
    <svg class="sparkline" viewBox={`0 0 ${width} 20`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <polyline class="sparkline-line" points={coordinates.join(' ')} />
      <line class="sparkline-end" x1={width} y1={endY} x2={width} y2={endY} />
      {points.map((value, index) => (
        <rect class="sparkline-hit" x={index * 10 - 4} y="0" width="8" height="20">
          <title>{`${weeksAgo(last - index)}: ${value}`}</title>
        </rect>
      ))}
    </svg>
  );
}

/**
 * One figure in a row of `.metrics`: its label, its value, and, with a
 * trend, its line and how it moved. With a query, the tile is a button that
 * opens the search the figure counts.
 */
export function Metric({ label, value, query, hint, code, trend }: MetricProps) {
  const change = trend ? describeChange(trend.change) : '';
  const body = [
    <span class="metric-label">{label}</span>,
    <strong class="metric-value">{value}</strong>,
    trend ? <Sparkline points={trend.points} /> : null,
    trend ? <span class="metric-change">{change}</span> : null,
  ];
  const said = `${label}, ${value}${change ? `, ${change}` : ''}`;
  if (!query) {
    return <article class="metric" data-code={code || undefined} aria-label={trend ? said : undefined}>{body}</article>;
  }
  const tip = `${hint}${trend && trend.note ? `. ${trend.note}` : ''}`;
  return (
    <button
      type="button"
      class="metric metric-open"
      data-code={code || undefined}
      data-action="open-search"
      data-query={query}
      data-tip={tip}
      aria-label={`${said}. ${hint}`}
    >
      {body}
    </button>
  );
}
