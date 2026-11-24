import type {
  EagleFilterCondition,
  EagleFilterQuery,
  EagleFilterRule,
} from '@sekereagle/eagle-filter-core';
import { BadRequestException } from '@nestjs/common';
import type { ListEagleAssetsDto } from './eagle.dto';

export type LegacyAssetFilters = Partial<ListEagleAssetsDto> & {
  tagMatch?: 'ANY' | 'ALL';
};

/**
 * Older clients send named parameters instead of a v2 rule tree. Compile them
 * through the same query shape so operators and future fields have one owner.
 */
export function legacyAssetFiltersToQuery(filters: LegacyAssetFilters): EagleFilterQuery | null {
  const conditions: EagleFilterCondition[] = [];
  let sequence = 0;
  const add = (rules: EagleFilterRule[], match: 'ALL' | 'ANY' = 'ALL') => {
    if (rules.length)
      conditions.push({ id: `legacy-${conditions.length}`, match, result: 'MATCH', rules });
  };
  const rule = (
    field: EagleFilterRule['field'],
    operator: EagleFilterRule['operator'],
    value?: EagleFilterRule['value'],
  ): EagleFilterRule => ({
    id: `legacy-${sequence++}-${field}`,
    field,
    operator,
    ...(value === undefined ? {} : { value }),
  });

  const formats = [
    ...new Set(
      (filters.formats?.length ? filters.formats : filters.format ? [filters.format] : [])
        .map((value) => value.toLowerCase())
        .filter(Boolean),
    ),
  ];
  add(
    formats.map((value) => rule('FORMAT', 'EQUALS', value)),
    'ANY',
  );

  const tagIds = [...new Set(filters.manualTagIds ?? [])];
  if (tagIds.length)
    add([rule('MANUAL_TAGS', filters.tagMatch === 'ALL' ? 'ALL_OF' : 'ANY_OF', tagIds)]);

  if (filters.rating !== undefined) add([rule('RATING', 'GTE', String(filters.rating))]);

  const width = rangeRule(
    'WIDTH',
    filters.minWidth,
    filters.maxWidth,
    () => `legacy-${sequence++}-WIDTH`,
  );
  if (width) add([width]);
  const height = rangeRule(
    'HEIGHT',
    filters.minHeight,
    filters.maxHeight,
    () => `legacy-${sequence++}-HEIGHT`,
  );
  if (height) add([height]);

  const date = dateRule(filters.createdFrom, filters.createdTo, `legacy-${sequence++}-ADDED_AT`);
  if (date) add([date]);

  if (filters.color) add([rule('COLOR', 'SIMILAR', filters.color)]);

  return conditions.length ? { version: 2, conditions } : null;
}

function rangeRule(
  field: 'WIDTH' | 'HEIGHT',
  minimum: number | undefined,
  maximum: number | undefined,
  id: () => string,
): EagleFilterRule | null {
  if (minimum === undefined && maximum === undefined) return null;
  if (minimum !== undefined && maximum !== undefined)
    return { id: id(), field, operator: 'BETWEEN', value: [minimum, maximum] };
  return {
    id: id(),
    field,
    operator: minimum !== undefined ? 'GTE' : 'LTE',
    value: minimum ?? maximum,
  };
}

function dateRule(
  from: string | undefined,
  to: string | undefined,
  id: string,
): EagleFilterRule | null {
  if (!from && !to) return null;
  const start = from ? parseDate(from) : undefined;
  const end = to ? parseDate(to) : undefined;
  if (start && end)
    return {
      id,
      field: 'ADDED_AT',
      operator: 'BETWEEN',
      value: [start.toISOString(), end.toISOString()],
    };
  return start
    ? {
        id,
        field: 'ADDED_AT',
        operator: 'AFTER',
        value: new Date(start.getTime() - 1).toISOString(),
      }
    : {
        id,
        field: 'ADDED_AT',
        operator: 'BEFORE',
        value: new Date(end!.getTime() + 1).toISOString(),
      };
}

function parseDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('日期筛选无效。');
  return date;
}
