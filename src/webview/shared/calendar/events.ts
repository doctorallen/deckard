/** The element an event happened on or in, or null when its target is no element, such as the document. */
export function eventElement(event: Event): Element | null {
  const target = event.target as Element | null;
  return target && typeof target.closest === 'function' ? target : null;
}
