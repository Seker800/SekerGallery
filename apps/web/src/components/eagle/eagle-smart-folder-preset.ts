import {
  createEagleFilterCondition,
  createEagleFilterRule,
  type EagleFilterQuery,
  type EagleSemanticIntent,
} from '@sekereagle/eagle-filter-core';

/** Search terms are bounded by the server's filter text limits. */
const MAX_SEARCH_TERM_LENGTH = 500;

/**
 * The live search also matches original filenames, tag names and visual similarity.
 * A smart folder can only store structured rules, so preserve the stable part:
 * a display name or description containing the same term.
 */
export function withSearchTextCondition(
  query: EagleFilterQuery,
  searchTerm: string,
): EagleFilterQuery {
  const term = searchTerm.normalize('NFKC').trim().slice(0, MAX_SEARCH_TERM_LENGTH);
  if (!term) return query;
  const condition = createEagleFilterCondition();
  condition.match = 'ANY';
  condition.rules = [
    { ...createEagleFilterRule('NAME'), operator: 'CONTAINS', value: term },
    { ...createEagleFilterRule('DESCRIPTION'), operator: 'CONTAINS', value: term },
  ];
  return { ...query, conditions: [...query.conditions, condition] };
}

/** Replace the single optional visual intent without touching ordinary rules. */
export function withSemanticIntent(
  query: EagleFilterQuery,
  intent: EagleSemanticIntent | null,
): EagleFilterQuery {
  const conditions = query.conditions
    .map((condition) => ({
      ...condition,
      rules: condition.rules.filter((rule) => rule.field !== 'SEMANTIC'),
    }))
    .filter((condition) => condition.rules.length > 0);
  const text = intent?.text.normalize('NFKC').trim() ?? '';
  if (!intent || !text)
    return {
      ...query,
      conditions: conditions.length ? conditions : [createEagleFilterCondition()],
    };
  const condition = createEagleFilterCondition();
  condition.match = 'ALL';
  condition.rules = [
    {
      ...createEagleFilterRule('SEMANTIC'),
      operator: 'SIMILAR',
      value: text,
      breadth: intent.breadth,
    },
  ];
  return { ...query, conditions: [...conditions, condition] };
}
