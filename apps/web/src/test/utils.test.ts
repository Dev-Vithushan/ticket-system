import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatTarget, hhmmToMinutes, humanize, initials, minutesToHHMM } from '@/lib/utils';
import { passwordRule } from '@/lib/validation';

describe('formatters', () => {
  it('formats durations', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(135)).toBe('2h 15m');
    expect(formatDuration(3000)).toBe('2d 2h');
  });
  it('shows business-hour SLA targets in hours', () => {
    expect(formatTarget(1440, true)).toBe('24h business');
    expect(formatTarget(1440, false)).toBe('1d');
    expect(formatTarget(30, true)).toBe('30m');
  });
  it('formats misc values', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(humanize('PENDING_CUSTOMER')).toBe('Pending customer');
    expect(initials('Morgan  Lee Smith')).toBe('ML');
    expect(minutesToHHMM(545)).toBe('09:05');
    expect(hhmmToMinutes('17:30')).toBe(1050);
  });
  it('mirrors the server password policy', () => {
    expect(passwordRule.safeParse('Password123!').success).toBe(true);
    expect(passwordRule.safeParse('password123').success).toBe(false);
    expect(passwordRule.safeParse('Short1A').success).toBe(false);
  });
});
