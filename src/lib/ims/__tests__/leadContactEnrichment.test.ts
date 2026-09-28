import { describe, expect, it } from 'vitest';

import {
  classifyMxRecords,
  generateProfessionalEmailHypotheses,
  normalizeLeadDomain,
  publishedBusinessMailboxes,
} from '../leadContactEnrichment';

describe('lead contact enrichment', () => {
  it('normalizes an official website to its email domain', () => {
    expect(normalizeLeadDomain('https://www.Example.com.au/contact')).toBe('example.com.au');
  });

  it('generates a small deterministic set of professional hypotheses', () => {
    expect(generateProfessionalEmailHypotheses({
      firstName: 'Renée',
      lastName: "O'Connor",
      domain: 'example.com.au',
    })).toEqual([
      'renee.oconnor@example.com.au',
      'reneeoconnor@example.com.au',
      'roconnor@example.com.au',
      'r.oconnor@example.com.au',
      'renee@example.com.au',
    ]);
  });

  it('does not invent person addresses without both a public name and official domain', () => {
    expect(generateProfessionalEmailHypotheses({ firstName: 'Jane', lastName: '', domain: 'example.com' })).toEqual([]);
  });

  it('builds role mailbox candidates without claiming they are published', () => {
    expect(publishedBusinessMailboxes('example.com')).toContain('info@example.com');
  });

  it('treats a null MX record as an explicit no-mail domain', () => {
    expect(classifyMxRecords([{ exchange: '' }])).toBe('domain_no_mail');
    expect(classifyMxRecords([{ exchange: '.' }])).toBe('domain_no_mail');
    expect(classifyMxRecords([{ exchange: 'mail.example.com' }])).toBe('domain_accepts_mail');
  });
});