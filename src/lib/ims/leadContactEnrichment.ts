import { isValidEmail, normalizeEmail } from '@/lib/ims/contactDataQuality';

export const LEAD_CONTACT_ROLES = ['owner', 'founder', 'director', 'manager', 'buyer', 'other'] as const;
export const LEAD_CONTACT_EVIDENCE = ['published', 'inferred'] as const;
export const LEAD_EMAIL_VERIFICATION = ['not_checked', 'domain_accepts_mail', 'domain_no_mail', 'provider_valid', 'provider_invalid', 'provider_unknown'] as const;

export type LeadContactRole = typeof LEAD_CONTACT_ROLES[number];
export type LeadContactEvidence = typeof LEAD_CONTACT_EVIDENCE[number];
export type LeadEmailVerification = typeof LEAD_EMAIL_VERIFICATION[number];

function emailPart(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function normalizeLeadDomain(value: unknown): string | null {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`);
    const domain = url.hostname.replace(/^www\./, '');
    return domain.includes('.') && /^[a-z0-9.-]+$/.test(domain) ? domain : null;
  } catch {
    return null;
  }
}

export function generateProfessionalEmailHypotheses(input: {
  firstName: unknown;
  lastName: unknown;
  domain: unknown;
}): string[] {
  const firstName = emailPart(input.firstName);
  const lastName = emailPart(input.lastName);
  const domain = normalizeLeadDomain(input.domain);
  if (!firstName || !lastName || !domain) return [];

  const localParts = [
    `${firstName}.${lastName}`,
    `${firstName}${lastName}`,
    `${firstName[0]}${lastName}`,
    `${firstName[0]}.${lastName}`,
    firstName,
  ];
  return [...new Set(localParts.map(local => normalizeEmail(`${local}@${domain}`)).filter((email): email is string => Boolean(email && isValidEmail(email))))];
}

export function publishedBusinessMailboxes(domain: unknown): string[] {
  const normalizedDomain = normalizeLeadDomain(domain);
  if (!normalizedDomain) return [];
  return ['info', 'hello', 'contact', 'sales', 'admin']
    .map(local => `${local}@${normalizedDomain}`)
    .filter(isValidEmail);
}

export function classifyMxRecords(records: Array<{ exchange?: string | null }>): 'domain_accepts_mail' | 'domain_no_mail' {
  return records.some(record => {
    const exchange = String(record.exchange ?? '').trim();
    return exchange !== '' && exchange !== '.';
  }) ? 'domain_accepts_mail' : 'domain_no_mail';
}