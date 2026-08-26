import { describe, expect, it } from 'vitest';
import {
  parseBranchCommunications,
  parseBranchDailyTasks,
  parseBranchDiscrepancies,
  parseBranchSafeReferences,
  parseBranchStartEndTasks,
  parseCommunications,
  parseCsv,
  parseStorageMap,
  parseWeekly,
  sanitizeImportedText,
} from '../daybookImport';

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

  it('parses QV and QVB start, end, and weekday task layouts', () => {
    const startEnd = parseBranchStartEndTasks(',OPENING,26.08.26,Notes\n,Sign in on DEPUTY!,mj,\n,CLOSING,25.08.26,\n1,Vacuum and mop,mj,\n');
    expect(startEnd.tasks.map(task => [task.phase, task.title, task.signoffs[0]?.initials])).toEqual([
      ['opening', 'Sign in on DEPUTY!', 'MJ'],
      ['closing', 'Vacuum and mop', 'MJ'],
    ]);
    const daily = parseBranchDailyTasks('🍎,Monday,Date,Sign\n,Unpack stock,24.08.26,ll\n🍊,Tuesday,,\n,Dust shelves,25.08.26,mj\n');
    expect(daily.map(task => [task.weekday, task.title, task.signoffs[0]?.date])).toEqual([
      [1, 'Unpack stock', '2026-08-24'],
      [2, 'Dust shelves', '2026-08-25'],
    ]);
  });

  it('parses branch communications and redacts operational credentials', () => {
    const result = parseBranchCommunications('Date,Message,Liz\n23.07.26,"Location: SECRET-123 Pin: 4444",KP\n', 'qvb');
    expect(result.records).toHaveLength(1);
    expect(result.records[0].message).not.toContain('SECRET-123');
    expect(result.records[0].message).not.toContain('4444');
    expect(result.records[0].reads[0].initials).toBe('KP');
    const qv = parseBranchCommunications('123,COMMUNICATION BOOK / NOTICES,Images,Lyn,Emma B\n25/8/26,Current notice,,EB,sz\n', 'qv');
    expect(qv.records[0]).toMatchObject({ message: 'Current notice', reads: [{ name: 'Lyn', initials: 'EB' }, { name: 'Emma B', initials: 'SZ' }] });
  });

  it('maps both discrepancy headings and rejects sensitive reference rows', () => {
    const discrepancies = parseBranchDiscrepancies('Date,SKU,Product Name,Cin 7 Quantity,Actual Quantity,,Staff\n23.08.26,ROND03,Vase,5,3,,Mika\n', 'qvb');
    expect(discrepancies[0].details).toMatchObject({ sku: 'ROND03', system_quantity: 5, physical_quantity: 3, variance: -2 });
    const references = parseBranchSafeReferences(',EMAIL,store@example.com,PW: secret\n,Warehouse,02 8041 7135,orders@example.com\n', 'qvb');
    expect(references.rejectedRows).toBe(1);
    expect(references.references.map(item => item.title)).toEqual(['Warehouse']);
  });

  it('turns QVB storage-map groups into location-specific guide entries', () => {
    const guides = parseStorageMap(',SHELVES IN FRONT OF COUNTER,,,PEG BOARD\n,Music Boxes,,,Kip & Co Jackets\n', 'qvb');
    expect(guides).toEqual(expect.arrayContaining([
      expect.objectContaining({ productName: 'Music Boxes', shelf: 'SHELVES IN FRONT OF COUNTER' }),
      expect.objectContaining({ productName: 'Kip & Co Jackets', shelf: 'PEG BOARD' }),
    ]));
  });
});