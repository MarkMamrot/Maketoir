import { describe, expect, it } from 'vitest';
import { sanitizeProspectAttribution, validateProspectLead } from '../policy';
import type { ProspectLeadInput } from '../types';

function lead(overrides: Partial<ProspectLeadInput> = {}): ProspectLeadInput {
  return {
    name: '  Ada   Lovelace ',
    email: 'ADA@EXAMPLE.COM',
    preferredContact: 'email',
    consentEmail: true,
    consentPhone: false,
    consentSms: false,
    ...overrides,
  };
}

describe('validateProspectLead', () => {
  it('normalizes a lead with explicit preferred-channel consent', () => {
    expect(validateProspectLead(lead())).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      preferredContact: 'email',
      consentEmail: true,
    });
  });

  it('rejects invalid contact details', () => {
    expect(() => validateProspectLead(lead({ email: 'not-an-email' }))).toThrow('valid email');
    expect(() => validateProspectLead(lead({ preferredContact: 'phone', phone: 'abc', consentPhone: true }))).toThrow('valid phone');
  });

  it('requires explicit consent for the preferred channel', () => {
    expect(() => validateProspectLead(lead({ consentEmail: false }))).toThrow('Explicit email consent');
    expect(() => validateProspectLead(lead({ preferredContact: 'sms', phone: '+61 400 000 000' }))).toThrow('Explicit sms consent');
  });
});

describe('sanitizeProspectAttribution', () => {
  it('keeps only bounded public attribution fields', () => {
    expect(sanitizeProspectAttribution({
      sourcePath: '/pricing\n',
      referrer: 'https://example.com/search?q=retail',
      utmSource: '  google  ',
      internalNotes: 'must not survive',
    })).toEqual({
      sourcePath: '/pricing',
      referrer: 'https://example.com/search?q=retail',
      utmSource: 'google',
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
    });
  });

  it('drops unsafe paths and referrer schemes', () => {
    expect(sanitizeProspectAttribution({ sourcePath: '//evil.example', referrer: 'javascript:alert(1)' }))
      .toMatchObject({ sourcePath: null, referrer: null });
  });
});