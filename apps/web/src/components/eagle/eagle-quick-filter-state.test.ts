import { expect, it } from 'vitest';
import {
  buildEagleQuickFilterQuery,
  createEmptyEagleQuickFilterState,
  clearEagleQuickFilter,
  countActiveEagleQuickFilters,
  summarizeEagleQuickFilter,
} from './eagle-quick-filter-state';
it('keeps capture, added and modified dates independent and clears only the selected date', () => {
  const state = createEmptyEagleQuickFilterState();
  state.dates = {
    CAPTURED_AT: { from: '2016-01-01', to: '2026-06-02' },
    MODIFIED_AT: { from: '', to: '2026-06-02' },
  };
  expect(buildEagleQuickFilterQuery(state).conditions.map((c) => c.rules[0]?.field)).toEqual([
    'MODIFIED_AT',
    'CAPTURED_AT',
  ]);
  expect(summarizeEagleQuickFilter(state, 'CAPTURED_AT')).toBe('2016-01-01–2026-06-02');
  expect(countActiveEagleQuickFilters(state)).toBe(2);
  expect(clearEagleQuickFilter(state, 'CAPTURED_AT').dates).toEqual({
    MODIFIED_AT: state.dates.MODIFIED_AT,
  });
});
it('sends date-only boundaries with the device timezone for one-sided ranges', () => {
  for (const field of ['ADDED_AT', 'MODIFIED_AT', 'CAPTURED_AT'] as const) {
    const state = createEmptyEagleQuickFilterState();
    state.dates[field] = { from: '', to: '2026-06-02' };
    const before = buildEagleQuickFilterQuery(state, 'Asia/Shanghai');
    expect(before.timeZone).toBe('Asia/Shanghai');
    expect(before.conditions[0]?.rules[0]).toMatchObject({
      field,
      operator: 'BEFORE',
      value: '2026-06-02',
    });
    state.dates[field] = { from: '2016-01-01', to: '' };
    expect(buildEagleQuickFilterQuery(state).conditions[0]?.rules[0]).toMatchObject({
      field,
      operator: 'AFTER',
      value: '2016-01-01',
    });
  }
});
