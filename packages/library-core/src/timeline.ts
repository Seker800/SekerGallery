const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

export function currentTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function dayFormatter(timeZone: string) {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function offsetFormatter(timeZone: string) {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    offsetFormatters.set(timeZone, formatter);
  }
  return formatter;
}

export function localDayKey(
  value: Date | string | number,
  timeZone: string,
): string | undefined {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()) || !isValidTimeZone(timeZone)) return undefined;
  const parts = dayFormatter(timeZone).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : undefined;
}

function calendarDay(dateOnly: string): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!match) return undefined;
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  )
    return undefined;
  return { year, month, day };
}

export function addDaysToDateOnly(dateOnly: string, days: number): string | undefined {
  const calendar = calendarDay(dateOnly);
  if (!calendar) return undefined;
  const date = new Date(Date.UTC(calendar.year, calendar.month - 1, calendar.day + days));
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : undefined;
}

/** UTC instant that starts a calendar day in the requested zone. */
export function zonedDayStart(dateOnly: string, timeZone: string): Date | undefined {
  const calendar = calendarDay(dateOnly);
  if (!calendar || !isValidTimeZone(timeZone)) return undefined;
  const wallClock = Date.UTC(calendar.year, calendar.month - 1, calendar.day);
  let instant = wallClock;
  // Two passes settle zones whose offset changes at the requested midnight.
  for (let pass = 0; pass < 2; pass++) {
    const parts = offsetFormatter(timeZone).formatToParts(new Date(instant));
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const asUtc = Date.UTC(
      value('year'),
      value('month') - 1,
      value('day'),
      value('hour'),
      value('minute'),
      value('second'),
    );
    const offset = asUtc - Math.floor(instant / 1000) * 1000;
    instant = wallClock - offset;
  }
  return Number.isFinite(instant) ? new Date(instant) : undefined;
}

export function zonedDayEnd(dateOnly: string, timeZone: string): Date | undefined {
  const next = addDaysToDateOnly(dateOnly, 1);
  const start = next ? zonedDayStart(next, timeZone) : undefined;
  return start ? new Date(start.getTime() - 1) : undefined;
}

/** UTC instant that starts the month after `YYYY-MM` in the requested zone. */
export function zonedNextMonthStart(month: string, timeZone: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return undefined;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
  return Number.isFinite(date.getTime())
    ? zonedDayStart(date.toISOString().slice(0, 10), timeZone)
    : undefined;
}
