/**
 * Refine's facets for a type's rows (docs/implementation/30-databases.md
 * § Types as searches): each select field of the type a search lists, its
 * options counted over the rows the search finds, each with the clause
 * that narrows the search to it, `tier = gold`. As every facet does, an
 * option that would keep none of the rows or all of them is left out, and
 * one the search already writes is applied.
 */
import { quoteValue } from '../query/queryFormat';
import type { QueryFacet } from '../model';
import { toFieldQueryName } from '../types/fieldKinds';
import type { TypeIndex } from '../types/typeIndex';
import { isBuiltInFieldName } from '../types/typeRegistry';
import { isWritten } from './facets';

/**
 * The facets of a type's select fields, one per field with an option to
 * offer, counted over `rowIds`, the rows the search finds.
 */
export function buildFieldFacets(types: TypeIndex, typeKey: string, rowIds: readonly string[], queryText: string): QueryFacet[] {
  const type = types.registry.get(typeKey);
  if (!type) {
    return [];
  }
  const total = rowIds.length;
  return type.fields
    .filter((field) => field.kind.name === 'select' && (field.kind.options?.length ?? 0) > 0)
    .map((field): QueryFacet => {
      const name = isBuiltInFieldName(field.name) ? `field.${field.name}` : toFieldQueryName(field.name);
      const counts = new Map<string, number>();
      rowIds.forEach((rowId) => {
        const options = new Set((types.field(rowId, `field.${field.name}`)?.values ?? []).flatMap((value) => value.option ?? []));
        options.forEach((option) => counts.set(option, (counts.get(option) ?? 0) + 1));
      });
      const candidates = (field.kind.options ?? []).map((option) => ({
        label: option,
        clause: `${name} = ${quoteValue(option)}`,
        count: counts.get(option) ?? 0,
      }));
      return {
        id: `field:${field.key}`,
        label: field.name,
        values: candidates.filter((value) => value.count > 0 && value.count < total && !isWritten(queryText, value.clause)),
        applied: candidates.map((value) => value.clause).filter((clause) => isWritten(queryText, clause)),
      };
    })
    .filter((facet) => facet.values.length > 0);
}
