import { describe, expect, it } from 'vitest';
import {
  createEmptyEagleFilterQuery,
  readEagleSemanticIntent,
} from '@sekereagle/eagle-filter-core';
import { withSemanticIntent, withSearchTextCondition } from './eagle-smart-folder-preset';

describe('eagle smart folder presets', () => {
  it('turns the search term into one name-or-description condition', () => {
    const base = createEmptyEagleFilterQuery();
    const query = withSearchTextCondition(base, '  海边  ');

    expect(query).not.toBe(base);
    expect(query.conditions).toHaveLength(base.conditions.length + 1);
    expect(query.conditions.at(-1)).toMatchObject({
      match: 'ANY',
      rules: [
        { field: 'NAME', operator: 'CONTAINS', value: '海边' },
        { field: 'DESCRIPTION', operator: 'CONTAINS', value: '海边' },
      ],
    });
    expect(withSearchTextCondition(base, '   ')).toBe(base);
  });

  it('keeps existing filters when the search condition is added', () => {
    const base = {
      ...createEmptyEagleFilterQuery(),
      conditions: [
        {
          id: 'rating',
          match: 'ALL' as const,
          result: 'MATCH' as const,
          rules: [
            {
              id: 'rating-rule',
              field: 'RATING' as const,
              operator: 'GTE' as const,
              value: 4,
            },
          ],
        },
      ],
    };
    const query = withSearchTextCondition(base, '星空');
    expect(query.conditions[0]).toEqual(base.conditions[0]);
    expect(query.conditions).toHaveLength(2);
  });

  it('replaces the single visual intent and leaves ordinary rules alone', () => {
    const base = withSearchTextCondition(createEmptyEagleFilterQuery(), '海边');
    const broad = withSemanticIntent(base, { text: '海边', breadth: 'BROAD' });
    expect(readEagleSemanticIntent(broad)).toEqual({ text: '海边', breadth: 'BROAD' });

    const strict = withSemanticIntent(broad, { text: '海边', breadth: 'STRICT' });
    expect(readEagleSemanticIntent(strict)).toEqual({ text: '海边', breadth: 'STRICT' });
    expect(
      strict.conditions
        .flatMap((condition) => condition.rules)
        .filter((rule) => rule.field === 'SEMANTIC'),
    ).toHaveLength(1);
    expect(
      strict.conditions.some((condition) => condition.rules.some((rule) => rule.field === 'NAME')),
    ).toBe(true);

    const withoutVisual = withSemanticIntent(strict, null);
    expect(readEagleSemanticIntent(withoutVisual)).toBeUndefined();
    expect(
      withoutVisual.conditions.some((condition) =>
        condition.rules.some((rule) => rule.field === 'NAME'),
      ),
    ).toBe(true);
  });

  it('leaves an editable blank condition instead of an empty editor when the last visual rule is removed', () => {
    const semanticOnly = withSemanticIntent(createEmptyEagleFilterQuery(), {
      text: '海边',
      breadth: 'BALANCED',
    });
    const withoutVisual = withSemanticIntent(semanticOnly, null);
    expect(readEagleSemanticIntent(withoutVisual)).toBeUndefined();
    expect(withoutVisual.conditions).toHaveLength(1);
    expect(withoutVisual.conditions[0]?.rules).toHaveLength(1);
  });
});
