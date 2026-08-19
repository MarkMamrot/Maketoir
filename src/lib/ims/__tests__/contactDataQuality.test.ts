import { describe, expect, it } from 'vitest';

import {
  isValidEmail,
  isValidPhone,
  normalizeEmail,
  normalizePhone,
  scoreDuplicateContacts,
  validateContactChannels,
} from '../contactDataQuality';

describe('contact data quality', () => {
  it('normalizes and validates email addresses', () => {
    expect(normalizeEmail('  Jane.Smith@Example.COM ')).toBe('jane.smith@example.com');
    expect(isValidEmail('jane.smith@example.com')).toBe(true);
    expect(isValidEmail('jane@example')).toBe(false);
    expect(isValidEmail('jane..smith@example.com')).toBe(false);
  });

  it('normalizes Australian and international phone numbers', () => {
    expect(normalizePhone('0400 123 456')).toBe('+61400123456');
    expect(normalizePhone('(03) 9000 0000')).toBe('+61390000000');
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(isValidPhone('0400 123 456')).toBe(true);
    expect(isValidPhone('123')).toBe(false);
  });

  it('validates and canonicalizes supplied contact channels without requiring blank ones', () => {
    expect(validateContactChannels({ email: ' Jane@Example.com ', phone: '', mobile: '0400 123 456' })).toEqual({
      normalized: { email: 'jane@example.com', phone: null, mobile: '+61400123456' },
      errors: [],
    });
    expect(validateContactChannels({ email: 'not-an-email', mobile: '123' }).errors).toHaveLength(2);
  });

  it('marks exact valid channel matches as high confidence', () => {
    expect(scoreDuplicateContacts(
      { name: 'Jane Smith', email: 'JANE@example.com' },
      { name: 'Jane Smith', email: 'jane@example.com' },
    )).toEqual({ score: 90, confidence: 'high', reasons: ['Same email', 'Same name'] });
  });

  it('keeps name-only matches below the review threshold', () => {
    expect(scoreDuplicateContacts(
      { name: 'Jane Smith', address: '12 High Street' },
      { name: 'Jane Smith', address: '99 Other Road' },
    ).confidence).toBe('none');
  });

  it('suggests matching name and address as possible without claiming certainty', () => {
    expect(scoreDuplicateContacts(
      { name: 'Jane Smith', address: '12 High Street', suburb: 'Richmond', postcode: '3121' },
      { name: 'JANE SMITH', address: '12 High St.', suburb: 'Richmond', postcode: '3121' },
    )).toMatchObject({ confidence: 'possible', score: 40 });
  });
});