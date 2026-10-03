/** A namespaced tag's namespace, slash and all, and the value after it. */
const NAMESPACED = /^([#@][^/]+\/)(.*)$/;

/**
 * A tag, its namespace drawn as a prefix of its value: `#project/` dimmed
 * before `atlas`. With `svg`, the parts are `tspan`s, for a label inside an
 * SVG node.
 */
export function TagLabel({ label, svg }: { readonly label: string; readonly svg?: boolean }) {
  const value = String(label);
  const match = NAMESPACED.exec(value);
  if (svg) {
    return match
      ? <><tspan class="tag-namespace">{match[1]}</tspan><tspan class="tag-value">{match[2]}</tspan></>
      : <tspan class="tag-value">{value}</tspan>;
  }
  // The slash sits outside the part that shortens, so a namespace cut short
  // still reads as one: #pro…/atlas.
  return match
    ? (
      <span class="tag-label">
        <span class="tag-namespace"><span class="tag-namespace-text">{match[1].slice(0, -1)}</span>/</span>
        <span class="tag-value">{match[2]}</span>
      </span>
    )
    : <span class="tag-label"><span class="tag-value">{value}</span></span>;
}
