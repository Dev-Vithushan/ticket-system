import { DateTime } from 'luxon';

/** Working window for one ISO weekday, in minutes after local midnight. */
export interface DayWindow {
  start: number;
  end: number;
}

export interface BusinessCalendar {
  timezone: string;
  /** ISO weekday (1 = Monday … 7 = Sunday) → window, or null for a non-working day. */
  days: Record<number, DayWindow | null>;
  /** Non-working dates, formatted yyyy-MM-dd in the calendar time zone. */
  holidays: Set<string>;
}

const MAX_DAYS = 3660; // guard against calendars with no working time

function at(day: DateTime, minuteOfDay: number): DateTime {
  if (minuteOfDay >= 1440) return day.plus({ days: 1 }).startOf('day');
  // calendar (not elapsed-time) arithmetic so DST transitions keep 09:00 at 09:00
  return day.set({ hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60, second: 0, millisecond: 0 });
}

function windowFor(day: DateTime, cal: BusinessCalendar): { start: DateTime; end: DateTime } | null {
  if (cal.holidays.has(day.toISODate()!)) return null;
  const w = cal.days[day.weekday];
  if (!w || w.end <= w.start) return null;
  return { start: at(day, w.start), end: at(day, w.end) };
}

function hasWorkingTime(cal: BusinessCalendar) {
  return Object.values(cal.days).some((w) => w && w.end > w.start);
}

/** Adds `minutes` of business time to `start`, skipping nights, non-working days and holidays. */
export function addBusinessMinutes(start: Date, minutes: number, cal: BusinessCalendar): Date {
  if (minutes <= 0) return new Date(start);
  if (!hasWorkingTime(cal)) throw new Error('Business calendar has no working hours configured');
  let cursor: DateTime<boolean> = DateTime.fromJSDate(start, { zone: cal.timezone });
  let remaining = minutes;
  for (let i = 0; i < MAX_DAYS; i++) {
    const day = cursor.startOf('day');
    const win = windowFor(day, cal);
    if (win) {
      if (cursor < win.start) cursor = win.start;
      if (cursor < win.end) {
        const available = win.end.diff(cursor, 'minutes').minutes;
        if (remaining <= available) return cursor.plus({ minutes: remaining }).toJSDate();
        remaining -= available;
      }
    }
    cursor = day.plus({ days: 1 }).startOf('day');
  }
  throw new Error('Unable to compute business deadline within 10 years');
}

/** Business minutes elapsed between two instants (0 if `to` <= `from`). */
export function businessMinutesBetween(from: Date, to: Date, cal: BusinessCalendar): number {
  if (to <= from) return 0;
  const end = DateTime.fromJSDate(to, { zone: cal.timezone });
  let cursor: DateTime<boolean> = DateTime.fromJSDate(from, { zone: cal.timezone });
  let total = 0;
  for (let i = 0; i < MAX_DAYS && cursor < end; i++) {
    const day = cursor.startOf('day');
    const win = windowFor(day, cal);
    if (win) {
      const s = cursor > win.start ? cursor : win.start;
      const e = end < win.end ? end : win.end;
      if (e > s) total += e.diff(s, 'minutes').minutes;
    }
    cursor = day.plus({ days: 1 }).startOf('day');
  }
  return Math.round(total);
}

/** Calendar used for 24×7 SLA policies. */
export function alwaysOpenCalendar(timezone = 'UTC'): BusinessCalendar {
  const days: Record<number, DayWindow> = {};
  for (let d = 1; d <= 7; d++) days[d] = { start: 0, end: 1440 };
  return { timezone, days, holidays: new Set() };
}
