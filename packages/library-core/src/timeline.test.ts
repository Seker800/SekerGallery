import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDaysToDateOnly,
  currentTimeZone,
  isValidTimeZone,
  localDayKey,
  zonedDayEnd,
  zonedDayStart,
  zonedNextMonthStart,
} from './timeline';

test('local day keys follow the requested zone around UTC midnight', () => {
  const instant = new Date('2026-03-08T04:30:00Z');
  assert.equal(localDayKey(instant, 'America/New_York'), '2026-03-07');
  assert.equal(localDayKey(instant, 'Asia/Shanghai'), '2026-03-08');
  assert.equal(localDayKey('not-a-date', 'UTC'), undefined);
  assert.equal(localDayKey(instant, 'not/a/zone'), undefined);
});

test('zoned day boundaries use the local calendar, including DST', () => {
  assert.equal(
    zonedDayStart('2026-03-08', 'America/New_York')?.toISOString(),
    '2026-03-08T05:00:00.000Z',
  );
  assert.equal(
    zonedDayStart('2026-03-08', 'Asia/Shanghai')?.toISOString(),
    '2026-03-07T16:00:00.000Z',
  );
  assert.equal(
    zonedDayEnd('2026-03-08', 'America/New_York')?.toISOString(),
    '2026-03-09T03:59:59.999Z',
  );
  assert.equal(zonedDayStart('2026-02-30', 'UTC'), undefined);
  assert.equal(
    zonedNextMonthStart('2026-01', 'Asia/Shanghai')?.toISOString(),
    '2026-01-31T16:00:00.000Z',
  );
  assert.equal(
    zonedNextMonthStart('2026-12', 'Asia/Shanghai')?.toISOString(),
    '2026-12-31T16:00:00.000Z',
  );
});

test('date-only arithmetic stays on the calendar', () => {
  assert.equal(addDaysToDateOnly('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysToDateOnly('2026-03-01', -1), '2026-02-28');
  assert.equal(addDaysToDateOnly('not-a-date', 1), undefined);
});

test('timezone helpers fail closed', () => {
  assert.equal(isValidTimeZone('Asia/Shanghai'), true);
  assert.equal(isValidTimeZone('not/a/zone'), false);
  assert.equal(typeof currentTimeZone(), 'string');
});
