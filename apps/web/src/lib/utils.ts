import { clsx, type ClassValue } from 'clsx';
import { formatDistanceToNowStrict, format } from 'date-fns';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const humanize = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export function formatDate(d: string | Date | null | undefined, pattern = 'MMM d, yyyy HH:mm') {
  if (!d) return '—';
  return format(new Date(d), pattern);
}

export function relative(d: string | Date | null | undefined) {
  if (!d) return '—';
  const date = new Date(d);
  const s = formatDistanceToNowStrict(date, { addSuffix: true });
  return s;
}

/** 135 → "2h 15m", 3000 → "2d 2h" */
export function formatDuration(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return '—';
  const m = Math.round(minutes);
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return `${d}d${h ? ` ${h}h` : ''}`;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export const minutesToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const hhmmToMinutes = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

/** SLA targets in business time are shown in working hours (a "day" would be misleading). */
export function formatTarget(minutes: number, businessHours: boolean) {
  if (!businessHours || minutes < 60) return formatDuration(minutes);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m ? ` ${m}m` : ''} business`;
}
