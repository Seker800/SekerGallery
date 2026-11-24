import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyAssetFiltersToQuery } from './eagle-legacy-filters';

test('legacy named filters compile into one explicit v2 query', () => {
  assert.deepEqual(
    legacyAssetFiltersToQuery({
      formats: ['PNG', 'png', 'webp'],
      manualTagIds: ['tag-a', 'tag-b'],
      tagMatch: 'ANY',
      rating: 4,
      minWidth: 100,
      maxWidth: 200,
      createdFrom: '2026-01-01T00:00:00Z',
      createdTo: '2026-02-01T00:00:00Z',
      color: '#abcdef',
    }),
    {
      version: 2,
      conditions: [
        {
          id: 'legacy-0',
          match: 'ANY',
          result: 'MATCH',
          rules: [
            { id: 'legacy-0-FORMAT', field: 'FORMAT', operator: 'EQUALS', value: 'png' },
            { id: 'legacy-1-FORMAT', field: 'FORMAT', operator: 'EQUALS', value: 'webp' },
          ],
        },
        {
          id: 'legacy-1',
          match: 'ALL',
          result: 'MATCH',
          rules: [
            {
              id: 'legacy-2-MANUAL_TAGS',
              field: 'MANUAL_TAGS',
              operator: 'ANY_OF',
              value: ['tag-a', 'tag-b'],
            },
          ],
        },
        {
          id: 'legacy-2',
          match: 'ALL',
          result: 'MATCH',
          rules: [{ id: 'legacy-3-RATING', field: 'RATING', operator: 'GTE', value: '4' }],
        },
        {
          id: 'legacy-3',
          match: 'ALL',
          result: 'MATCH',
          rules: [{ id: 'legacy-4-WIDTH', field: 'WIDTH', operator: 'BETWEEN', value: [100, 200] }],
        },
        {
          id: 'legacy-4',
          match: 'ALL',
          result: 'MATCH',
          rules: [
            {
              id: 'legacy-5-ADDED_AT',
              field: 'ADDED_AT',
              operator: 'BETWEEN',
              value: ['2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'],
            },
          ],
        },
        {
          id: 'legacy-5',
          match: 'ALL',
          result: 'MATCH',
          rules: [{ id: 'legacy-6-COLOR', field: 'COLOR', operator: 'SIMILAR', value: '#abcdef' }],
        },
      ],
    },
  );
});

test('legacy tag ALL and one-sided dates keep their inclusive boundaries', () => {
  const query = legacyAssetFiltersToQuery({
    manualTagIds: ['tag-a'],
    tagMatch: 'ALL',
    minHeight: 500,
    createdFrom: '2026-01-01T00:00:00Z',
  });
  assert.equal(query?.conditions[0]?.rules[0]?.operator, 'ALL_OF');
  assert.deepEqual(query?.conditions[1]?.rules[0], {
    id: 'legacy-1-HEIGHT',
    field: 'HEIGHT',
    operator: 'GTE',
    value: 500,
  });
  assert.deepEqual(query?.conditions[2]?.rules[0], {
    id: 'legacy-2-ADDED_AT',
    field: 'ADDED_AT',
    operator: 'AFTER',
    value: '2025-12-31T23:59:59.999Z',
  });

  const before = legacyAssetFiltersToQuery({ createdTo: '2026-02-01T00:00:00Z' });
  assert.deepEqual(before?.conditions[0]?.rules[0], {
    id: 'legacy-0-ADDED_AT',
    field: 'ADDED_AT',
    operator: 'BEFORE',
    value: '2026-02-01T00:00:00.001Z',
  });
});

test('empty legacy filters produce no extra query', () => {
  assert.equal(legacyAssetFiltersToQuery({ search: 'hello', privacy: 'PRIVATE' }), null);
});
