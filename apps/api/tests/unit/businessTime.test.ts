import { describe, expect, it } from 'vitest';
import { addBusinessMinutes, alwaysOpenCalendar, businessMinutesBetween, type BusinessCalendar } from '../../src/modules/sla/businessTime';

const weekdays9to5 = (timezone = 'UTC', holidays: string[] = []): BusinessCalendar => ({
  timezone,
  days: { 1: { start: 540, end: 1020 }, 2: { start: 540, end: 1020 }, 3: { start: 540, end: 1020 }, 4: { start: 540, end: 1020 }, 5: { start: 540, end: 1020 }, 6: null, 7: null },
  holidays: new Set(holidays),
});
const iso = (d: Date) => d.toISOString();

describe('addBusinessMinutes', () => {
  const cal = weekdays9to5();

  it('adds within the same working day', () => {
    // Wednesday 2026-10-07 10:00 UTC + 2h
    expect(iso(addBusinessMinutes(new Date('2026-10-07T10:00:00Z'), 120, cal))).toBe('2026-10-07T12:00:00.000Z');
  });

  it('rolls over to the next working morning', () => {
    // 16:00 + 2h → 1h today, 1h tomorrow → Thu 10:00
    expect(iso(addBusinessMinutes(new Date('2026-10-07T16:00:00Z'), 120, cal))).toBe('2026-10-08T10:00:00.000Z');
  });

  it('starts the clock at opening time when created outside hours', () => {
    expect(iso(addBusinessMinutes(new Date('2026-10-07T06:30:00Z'), 30, cal))).toBe('2026-10-07T09:30:00.000Z');
    expect(iso(addBusinessMinutes(new Date('2026-10-07T20:00:00Z'), 30, cal))).toBe('2026-10-08T09:30:00.000Z');
  });

  it('skips weekends', () => {
    // Friday 2026-10-09 16:00 + 2h → Monday 10:00
    expect(iso(addBusinessMinutes(new Date('2026-10-09T16:00:00Z'), 120, cal))).toBe('2026-10-12T10:00:00.000Z');
  });

  it('skips configured holidays', () => {
    const withHoliday = weekdays9to5('UTC', ['2026-10-12']);
    expect(iso(addBusinessMinutes(new Date('2026-10-09T16:00:00Z'), 120, withHoliday))).toBe('2026-10-13T10:00:00.000Z');
  });

  it('handles multi-day targets (3 business days = 24h ends at close of the third day)', () => {
    expect(iso(addBusinessMinutes(new Date('2026-10-07T09:00:00Z'), 24 * 60, cal))).toBe('2026-10-09T17:00:00.000Z');
    expect(iso(addBusinessMinutes(new Date('2026-10-07T09:00:00Z'), 24 * 60 + 1, cal))).toBe('2026-10-12T09:01:00.000Z');
  });

  it('respects the calendar time zone', () => {
    const ny = weekdays9to5('America/New_York');
    // 2026-10-07 12:00 UTC = 08:00 EDT → clock starts at 09:00 EDT (13:00 UTC); +60 → 14:00 UTC
    expect(iso(addBusinessMinutes(new Date('2026-10-07T12:00:00Z'), 60, ny))).toBe('2026-10-07T14:00:00.000Z');
  });

  it('keeps local opening time across a DST change', () => {
    const ny = weekdays9to5('America/New_York');
    // Fri 2026-10-30 16:30 EDT (20:30Z) + 60 → 30m Fri + 30m Mon 2026-11-02 09:30 EST (14:30Z)
    expect(iso(addBusinessMinutes(new Date('2026-10-30T20:30:00Z'), 60, ny))).toBe('2026-11-02T14:30:00.000Z');
  });

  it('24×7 calendars add wall-clock time', () => {
    expect(iso(addBusinessMinutes(new Date('2026-10-10T23:00:00Z'), 120, alwaysOpenCalendar()))).toBe('2026-10-11T01:00:00.000Z');
  });

  it('throws when no working time is configured', () => {
    const none: BusinessCalendar = { timezone: 'UTC', days: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null }, holidays: new Set() };
    expect(() => addBusinessMinutes(new Date(), 10, none)).toThrow();
  });
});

describe('businessMinutesBetween', () => {
  const cal = weekdays9to5();
  it('counts only working time', () => {
    expect(businessMinutesBetween(new Date('2026-10-07T16:00:00Z'), new Date('2026-10-08T10:00:00Z'), cal)).toBe(120);
  });
  it('is zero over a weekend', () => {
    expect(businessMinutesBetween(new Date('2026-10-10T08:00:00Z'), new Date('2026-10-11T20:00:00Z'), cal)).toBe(0);
  });
  it('is the inverse of addBusinessMinutes', () => {
    const start = new Date('2026-10-07T11:17:00Z');
    const end = addBusinessMinutes(start, 1000, cal);
    expect(businessMinutesBetween(start, end, cal)).toBe(1000);
  });
});
