import type { SlaPolicy, Ticket, TicketPriority } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../../lib/prisma';
import { getSettings } from '../../services/settings';
import { addBusinessMinutes, alwaysOpenCalendar, businessMinutesBetween, type BusinessCalendar } from './businessTime';

let calendarCache: { value: BusinessCalendar; at: number } | null = null;
const TTL = 30_000;

export const DEFAULT_WINDOW = { start: 9 * 60, end: 17 * 60 };

export async function loadCalendar(): Promise<BusinessCalendar> {
  if (calendarCache && Date.now() - calendarCache.at < TTL) return calendarCache.value;
  const [settings, hours, holidays] = await Promise.all([
    getSettings(),
    prisma.businessHours.findMany(),
    prisma.holiday.findMany(),
  ]);
  const days: BusinessCalendar['days'] = {};
  for (let d = 1; d <= 7; d++) days[d] = d <= 5 ? { ...DEFAULT_WINDOW } : null;
  for (const h of hours) days[h.dayOfWeek] = h.isWorkingDay ? { start: h.startMinute, end: h.endMinute } : null;
  const value: BusinessCalendar = {
    timezone: settings.timezone,
    days,
    // Holidays are stored as DATE; interpret the calendar date itself, not an instant.
    holidays: new Set(holidays.map((h) => h.date.toISOString().slice(0, 10))),
  };
  calendarCache = { value, at: Date.now() };
  return value;
}

export function invalidateCalendarCache() {
  calendarCache = null;
}

export async function getPolicy(priority: TicketPriority): Promise<SlaPolicy | null> {
  return prisma.slaPolicy.findFirst({ where: { priority, isActive: true } });
}

export async function calendarFor(policy: Pick<SlaPolicy, 'useBusinessHours'>): Promise<BusinessCalendar> {
  const cal = await loadCalendar();
  return policy.useBusinessHours ? cal : alwaysOpenCalendar(cal.timezone);
}

export async function computeDeadlines(priority: TicketPriority, from: Date) {
  const policy = await getPolicy(priority);
  if (!policy) return { policy: null, firstResponseDueAt: null, resolutionDueAt: null };
  const cal = await calendarFor(policy);
  return {
    policy,
    firstResponseDueAt: addBusinessMinutes(from, policy.firstResponseMinutes, cal),
    resolutionDueAt: addBusinessMinutes(from, policy.resolutionMinutes, cal),
  };
}

/** Shift a deadline forward by the business time a ticket spent paused (waiting on the customer). */
export async function extendForPause(priority: TicketPriority, dueAt: Date, pausedAt: Date, resumedAt: Date) {
  const policy = await getPolicy(priority);
  const cal = policy ? await calendarFor(policy) : await loadCalendar();
  const paused = businessMinutesBetween(pausedAt, resumedAt, cal);
  return paused > 0 ? addBusinessMinutes(dueAt, paused, cal) : dueAt;
}

export type SlaState = 'none' | 'on_track' | 'warning' | 'breached' | 'met' | 'paused';

export interface SlaTarget {
  dueAt: Date | null;
  completedAt: Date | null;
  state: SlaState;
  /** % of the window consumed (wall-clock), capped at 999 */
  percentElapsed: number | null;
}

type SlaTicket = Pick<
  Ticket,
  | 'createdAt'
  | 'status'
  | 'firstResponseDueAt'
  | 'firstResponseAt'
  | 'resolutionDueAt'
  | 'resolvedAt'
  | 'slaPausedAt'
  | 'firstResponseBreachedAt'
  | 'resolutionBreachedAt'
>;

function target(
  start: Date,
  dueAt: Date | null,
  completedAt: Date | null,
  breachedAt: Date | null,
  warnPct: number,
  paused: boolean,
  now: Date,
): SlaTarget {
  if (!dueAt) return { dueAt: null, completedAt, state: 'none', percentElapsed: null };
  const total = Math.max(1, dueAt.getTime() - start.getTime());
  const ref = completedAt ?? now;
  const percentElapsed = Math.min(999, Math.max(0, Math.round(((ref.getTime() - start.getTime()) / total) * 100)));
  if (completedAt) {
    return { dueAt, completedAt, state: completedAt <= dueAt && !breachedAt ? 'met' : 'breached', percentElapsed };
  }
  if (breachedAt || now > dueAt) return { dueAt, completedAt, state: 'breached', percentElapsed };
  if (paused) return { dueAt, completedAt, state: 'paused', percentElapsed };
  return { dueAt, completedAt, state: percentElapsed >= warnPct ? 'warning' : 'on_track', percentElapsed };
}

/** Live SLA view of a ticket, computed from its real timestamps. */
export function evaluateSla(t: SlaTicket, warningThresholdPercent = 80, now = new Date()) {
  const paused = t.status === 'PENDING_CUSTOMER' && !!t.slaPausedAt;
  return {
    firstResponse: target(t.createdAt, t.firstResponseDueAt, t.firstResponseAt, t.firstResponseBreachedAt, warningThresholdPercent, false, now),
    resolution: target(t.createdAt, t.resolutionDueAt, t.resolvedAt, t.resolutionBreachedAt, warningThresholdPercent, paused, now),
  };
}

export const isoDate = (d: Date, tz: string) => DateTime.fromJSDate(d, { zone: tz }).toISODate();
