/**
 * A search as the pages receive it: the query bar's text and terms, the
 * builder's tree, the facets, and the completions. The shapes are the
 * domain model's; the pages take them from here, since they import the
 * protocol and not the domain.
 */
export type {
  QueryBuilderGroup,
  QueryBuilderItem,
  QueryBuilderJoin,
  QueryBuilderRow,
  QueryDiagnostic,
  QueryFacet,
  QueryFacetValue,
  QueryField,
  QueryOperator,
  QuerySuggestion,
  QuerySuggestions,
  QueryTermChip,
  QueryViewState,
} from '../../domain/model/query';
