import { describe, expect, it } from 'vitest';
import { toCsv } from '../../src/modules/reports/reports.service';
import { formatTicketNumber } from '../../src/modules/tickets/numbering';

describe('toCsv', () => {
  it('quotes separators, quotes and newlines', () => {
    const csv = toCsv([{ a: 'x,y', b: 'say "hi"', c: 'line1\nline2' }]);
    expect(csv).toBe('a,b,c\r\n"x,y","say ""hi""","line1\nline2"\r\n');
  });
  it('neutralises spreadsheet formula injection', () => {
    expect(toCsv([{ a: '=HYPERLINK("http://evil")' }])).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(toCsv([{ a: '+1' }, { a: '@SUM(A1)' }])).toBe("a\r\n'+1\r\n'@SUM(A1)\r\n");
  });
  it('serialises dates and nulls', () => {
    expect(toCsv([{ d: new Date('2026-01-02T03:04:05Z'), n: null }])).toBe('d,n\r\n2026-01-02T03:04:05.000Z,\r\n');
  });
});

describe('formatTicketNumber', () => {
  it('formats with year and padding', () => {
    expect(formatTicketNumber({ ticketNumberPrefix: 'TKT', ticketNumberPadding: 5, ticketNumberIncludeYear: true }, 2026, 1)).toBe('TKT-2026-00001');
  });
  it('formats without year', () => {
    expect(formatTicketNumber({ ticketNumberPrefix: 'HD', ticketNumberPadding: 3, ticketNumberIncludeYear: false }, 2026, 42)).toBe('HD-042');
  });
});
