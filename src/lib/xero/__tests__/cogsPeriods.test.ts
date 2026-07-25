import { describe, expect, it } from 'vitest';
import { buildCogsJournalLines, getCogsPeriodStartingAt, getLastCompletedCogsPeriod, getMonthlyCogsPeriod } from '../cogsPeriods';

describe('getLastCompletedCogsPeriod', () => {
  it('uses yesterday in the business timezone for daily periods', () => {
    const period = getLastCompletedCogsPeriod(
      'daily',
      new Date('2026-07-25T14:30:00.000Z'),
      'Australia/Sydney',
    );
    expect(period).toMatchObject({
      startDate: '2026-07-25',
      endDateExclusive: '2026-07-26',
      journalDate: '2026-07-25',
    });
  });

  it('uses the previous Monday through Sunday for weekly periods', () => {
    const period = getLastCompletedCogsPeriod('weekly', new Date('2026-07-22T02:00:00Z'));
    expect(period).toMatchObject({
      startDate: '2026-07-13',
      endDateExclusive: '2026-07-20',
      journalDate: '2026-07-19',
    });
  });

  it('handles leap-year monthly boundaries', () => {
    const period = getLastCompletedCogsPeriod('monthly', new Date('2024-03-15T00:00:00Z'));
    expect(period).toMatchObject({
      startDate: '2024-02-01',
      endDateExclusive: '2024-03-01',
      journalDate: '2024-02-29',
      label: 'February 2024',
    });
  });

  it('handles quarter and year boundaries', () => {
    const period = getLastCompletedCogsPeriod('quarterly', new Date('2026-01-20T00:00:00Z'));
    expect(period).toMatchObject({
      startDate: '2025-10-01',
      endDateExclusive: '2026-01-01',
      journalDate: '2025-12-31',
      label: 'Q4 2025',
    });
  });

  it('uses calendar dates rather than elapsed hours across daylight saving changes', () => {
    const beforeChange = getLastCompletedCogsPeriod('daily', new Date('2026-10-04T14:30:00Z'));
    const afterChange = getLastCompletedCogsPeriod('daily', new Date('2026-10-05T13:30:00Z'));
    expect(beforeChange.startDate).toBe('2026-10-04');
    expect(afterChange.startDate).toBe('2026-10-05');
  });
});

describe('getMonthlyCogsPeriod', () => {
  it('builds a strict calendar month with a period-end journal date', () => {
    expect(getMonthlyCogsPeriod('2024-02')).toMatchObject({
      startDate: '2024-02-01',
      endDateExclusive: '2024-03-01',
      journalDate: '2024-02-29',
      label: 'February 2024',
    });
  });

  it('rejects invalid month numbers', () => {
    expect(() => getMonthlyCogsPeriod('2026-13')).toThrow('YYYY-MM');
  });
});

describe('getCogsPeriodStartingAt', () => {
  it('builds contiguous daily and weekly catch-up periods', () => {
    const day = getCogsPeriodStartingAt('daily', '2026-07-20');
    expect(day.endDateExclusive).toBe('2026-07-21');
    expect(getCogsPeriodStartingAt('daily', day.endDateExclusive).startDate).toBe('2026-07-21');

    const week = getCogsPeriodStartingAt('weekly', '2026-07-13');
    expect(week).toMatchObject({ endDateExclusive: '2026-07-20', journalDate: '2026-07-19' });
  });

  it('advances month and quarter cursors across year boundaries', () => {
    expect(getCogsPeriodStartingAt('monthly', '2025-12-01').endDateExclusive).toBe('2026-01-01');
    expect(getCogsPeriodStartingAt('quarterly', '2025-10-01').endDateExclusive).toBe('2026-01-01');
  });
});

describe('buildCogsJournalLines', () => {
  it('debits COGS and credits inventory with no tax', () => {
    expect(buildCogsJournalLines({
      amount: 123.456,
      cogsAccountCode: '500',
      inventoryAccountCode: '630',
      description: 'COGS July 2026',
    })).toEqual([
      { AccountCode: '500', Description: 'COGS July 2026', TaxType: 'NONE', DebitAmount: 123.46 },
      { AccountCode: '630', Description: 'COGS July 2026', TaxType: 'NONE', CreditAmount: 123.46 },
    ]);
  });

  it('reverses the accounts for negative adjustments', () => {
    expect(buildCogsJournalLines({
      amount: -25,
      cogsAccountCode: '500',
      inventoryAccountCode: '630',
      description: 'COGS adjustment',
    })).toEqual([
      { AccountCode: '500', Description: 'COGS adjustment', TaxType: 'NONE', CreditAmount: 25 },
      { AccountCode: '630', Description: 'COGS adjustment', TaxType: 'NONE', DebitAmount: 25 },
    ]);
  });

  it('does not create zero-value journal lines', () => {
    expect(buildCogsJournalLines({
      amount: 0.004,
      cogsAccountCode: '500',
      inventoryAccountCode: '630',
      description: 'COGS adjustment',
    })).toEqual([]);
  });
});