import { describe, expect, it } from 'vitest';
import { parseCommunications, parseCsv, parseWeekly, sanitizeImportedText } from '../daybookImport';

describe('Newtown Daybook import parsing', () => {
  it('parses quoted multiline CSV cells', () => {
    expect(parseCsv('date,"line one\nline two",hg\n')).toEqual([['date', 'line one\nline two', 'hg']]);
  });

  it('redacts credentials embedded in checklist instructions', () => {
    const result = sanitizeImportedText('Log in (password Bebop2071!) then enter PIN number: 2222');
    expect(result.text).not.toContain('Bebop2071');
    expect(result.text).not.toContain('2222');
    expect(result.redactions).toBe(2);
  });

  it('excludes Newtown communications before 2026', () => {
    const result = parseCommunications('DATE,MESSAGE,Holly\n31.12.25,Old,hg\n01.01.26,Current,hg\n');
    expect(result.skippedBefore2026).toBe(1);
    expect(result.records.map(record => record.message)).toEqual(['Current']);
  });

  it('deduplicates KYDS products by SKU', () => {
    const result = parseWeekly(',,1st SHELF (TOP)\n,KYD0001,Koala\n,KYD0001,Koala updated\n');
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0].productName).toBe('Koala updated');
  });
});