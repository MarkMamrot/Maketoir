import { createHash } from 'node:crypto';

import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import {
  isValidEmail,
  isValidPhone,
  normalizeEmail,
  normalizePhone,
  scoreDuplicateContacts,
  type ContactIdentityInput,
} from '@/lib/ims/contactDataQuality';
import {
  LEAD_CONTACT_EVIDENCE,
  LEAD_CONTACT_ROLES,
  LEAD_EMAIL_VERIFICATION,
  type LeadContactEvidence,
  type LeadContactRole,
  type LeadEmailVerification,
} from '@/lib/ims/leadContactEnrichment';
import { getIMSPool } from '@/services/IMSMySQLService';

export const SOLVANTIS_LEAD_BUSINESS_ID = 'Solvantis';

const SOURCE_KINDS = ['centre_directory', 'official_website', 'web_search', 'maps', 'other'] as const;
type LeadSourceKind = typeof SOURCE_KINDS[number];

export interface ApprovedLeadSource {
  url: string;
  kind: LeadSourceKind;
  confidence?: number | null;
}

export interface ApprovedLeadContactPoint {
  type: 'email' | 'phone' | 'linkedin';
  value: string;
  evidence: LeadContactEvidence;
  sourceUrl?: string | null;
  verificationStatus?: LeadEmailVerification;
}

export interface ApprovedLeadPerson {
  personKey: string;
  fullName: string;
  role: LeadContactRole;
  roleTitle?: string | null;
  sourceUrl: string;
  contacts?: ApprovedLeadContactPoint[];
}

export interface ApprovedLeadCandidate extends ContactIdentityInput {
  candidateKey: string;
  batchId: string;
  sourceQuery: string;
  website_url?: string | null;
  country?: string | null;
  discoveredAt: string;
  sources: ApprovedLeadSource[];
  people?: ApprovedLeadPerson[];
  businessContacts?: ApprovedLeadContactPoint[];
}

export interface NormalizedLeadCandidate extends Omit<ApprovedLeadCandidate, 'email' | 'phone' | 'mobile' | 'sources'> {
  name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  website_url: string | null;
  country: 'Australia';
  sources: ApprovedLeadSource[];
  people: ApprovedLeadPerson[];
  businessContacts: ApprovedLeadContactPoint[];
}

interface ExistingContact extends ContactIdentityInput {
  id: number;
  type: string;
  website_url?: string | null;
}

export type LeadPreflightResult =
  | { outcome: 'create'; candidate: NormalizedLeadCandidate }
  | { outcome: 'existing'; candidate: NormalizedLeadCandidate; contact: ExistingContact; reason: string }
  | { outcome: 'ambiguous'; candidate: NormalizedLeadCandidate; matches: Array<{ contact: ExistingContact; score: number; reasons: string[] }> };

export class LeadDiscoveryValidationError extends Error {}

function cleanText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned ? cleaned.slice(0, maximum) : null;
}

function normalizePublicUrl(value: unknown): string | null {
  const text = cleanText(value, 2000);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function websiteDomain(value: unknown): string | null {
  const normalized = normalizePublicUrl(value);
  if (!normalized) return null;
  return new URL(normalized).hostname.toLowerCase().replace(/^www\./, '');
}

function normalizeLeadContactPoint(contact: ApprovedLeadContactPoint, officialDomain: string | null): ApprovedLeadContactPoint {
  if (!['email', 'phone', 'linkedin'].includes(contact.type)) throw new LeadDiscoveryValidationError('Lead contact type is invalid.');
  if (!LEAD_CONTACT_EVIDENCE.includes(contact.evidence)) throw new LeadDiscoveryValidationError('Contact evidence must be published or inferred.');
  if (contact.evidence === 'inferred' && contact.type !== 'email') throw new LeadDiscoveryValidationError('Only email addresses may be stored as inferred contacts.');
  const sourceUrl = contact.sourceUrl == null ? null : normalizePublicUrl(contact.sourceUrl);
  if (contact.sourceUrl && !sourceUrl) throw new LeadDiscoveryValidationError('Contact source URL must use HTTP or HTTPS.');
  if (contact.evidence === 'published' && !sourceUrl) throw new LeadDiscoveryValidationError('Published contact details require a source URL.');

  let value: string | null = cleanText(contact.value, 500);
  if (contact.type === 'email') {
    value = normalizeEmail(value);
    if (!value || !isValidEmail(value)) throw new LeadDiscoveryValidationError('Lead email address is invalid.');
    if (contact.evidence === 'inferred' && (!officialDomain || value.split('@')[1] !== officialDomain)) {
      throw new LeadDiscoveryValidationError('Inferred email addresses must use the official website domain.');
    }
  } else if (contact.type === 'phone') {
    value = normalizePhone(value);
    if (!value || !isValidPhone(value)) throw new LeadDiscoveryValidationError('Lead phone number is invalid.');
  } else {
    value = normalizePublicUrl(value);
    if (!value || !new URL(value).hostname.toLowerCase().endsWith('linkedin.com')) {
      throw new LeadDiscoveryValidationError('LinkedIn contact must use a linkedin.com URL.');
    }
  }
  const verificationStatus = contact.verificationStatus ?? 'not_checked';
  if (!LEAD_EMAIL_VERIFICATION.includes(verificationStatus)) throw new LeadDiscoveryValidationError('Email verification status is invalid.');
  if (contact.type !== 'email' && verificationStatus !== 'not_checked') throw new LeadDiscoveryValidationError('Verification status applies only to email addresses.');
  return { ...contact, value, sourceUrl, verificationStatus };
}

export function normalizeApprovedLeadCandidate(input: ApprovedLeadCandidate): NormalizedLeadCandidate {
  const name = cleanText(input.name, 255);
  const candidateKey = cleanText(input.candidateKey, 100);
  const batchId = cleanText(input.batchId, 100);
  const sourceQuery = cleanText(input.sourceQuery, 255);
  if (!name) throw new LeadDiscoveryValidationError('Business name is required.');
  if (!candidateKey || !batchId || !sourceQuery) throw new LeadDiscoveryValidationError('Candidate key, batch ID, and source query are required.');

  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const mobile = normalizePhone(input.mobile);
  if (email && !isValidEmail(email)) throw new LeadDiscoveryValidationError('Email address is invalid.');
  if (phone && !isValidPhone(phone)) throw new LeadDiscoveryValidationError('Phone number is invalid.');
  if (mobile && !isValidPhone(mobile)) throw new LeadDiscoveryValidationError('Mobile number is invalid.');

  const websiteUrl = input.website_url == null || input.website_url === '' ? null : normalizePublicUrl(input.website_url);
  if (input.website_url && !websiteUrl) throw new LeadDiscoveryValidationError('Website URL must use HTTP or HTTPS.');
  const address = cleanText(input.address, 1000);
  if (!email && !phone && !mobile && !websiteUrl && !address) {
    throw new LeadDiscoveryValidationError('Provide an email, phone, official website, or postal address.');
  }

  const discoveredAt = new Date(input.discoveredAt);
  if (Number.isNaN(discoveredAt.getTime())) throw new LeadDiscoveryValidationError('Discovery date is invalid.');
  if (!Array.isArray(input.sources) || input.sources.length === 0) throw new LeadDiscoveryValidationError('At least one public source is required.');
  const sources = input.sources.map(source => {
    const url = normalizePublicUrl(source.url);
    if (!url) throw new LeadDiscoveryValidationError('Every source URL must use HTTP or HTTPS.');
    if (!SOURCE_KINDS.includes(source.kind)) throw new LeadDiscoveryValidationError('Source kind is invalid.');
    const confidence = source.confidence == null ? null : Number(source.confidence);
    if (confidence != null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
      throw new LeadDiscoveryValidationError('Source confidence must be between 0 and 1.');
    }
    return { url, kind: source.kind, confidence };
  });
  const officialDomain = websiteDomain(websiteUrl);
  const businessContacts = (input.businessContacts ?? []).map(contact => normalizeLeadContactPoint(contact, officialDomain));
  const people = (input.people ?? []).map(person => {
    const personKey = cleanText(person.personKey, 100);
    const fullName = cleanText(person.fullName, 255);
    const roleTitle = cleanText(person.roleTitle, 255);
    const sourceUrl = normalizePublicUrl(person.sourceUrl);
    if (!personKey || !fullName || !sourceUrl) throw new LeadDiscoveryValidationError('Decision-makers require a key, public name, and source URL.');
    if (!LEAD_CONTACT_ROLES.includes(person.role)) throw new LeadDiscoveryValidationError('Decision-maker role is invalid.');
    const contacts = (person.contacts ?? []).map(contact => normalizeLeadContactPoint(contact, officialDomain));
    return { ...person, personKey, fullName, roleTitle, sourceUrl, contacts };
  });

  return {
    ...input,
    name,
    candidateKey,
    batchId,
    sourceQuery,
    company: cleanText(input.company, 255),
    email,
    phone,
    mobile,
    website_url: websiteUrl,
    address,
    address2: cleanText(input.address2, 255),
    suburb: cleanText(input.suburb, 100),
    city: cleanText(input.city, 100),
    state: cleanText(input.state, 100),
    postcode: cleanText(input.postcode, 20),
    country: 'Australia',
    discoveredAt: discoveredAt.toISOString(),
    sources,
    people,
    businessContacts,
  };
}

function evidenceKey(candidate: NormalizedLeadCandidate, source: ApprovedLeadSource): string {
  return createHash('sha256').update([
    SOLVANTIS_LEAD_BUSINESS_ID,
    candidate.batchId,
    candidate.candidateKey,
    source.url,
  ].join('\n')).digest('hex');
}

async function loadContacts(connection: PoolConnection): Promise<ExistingContact[]> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT id, type, name, first_name, last_name, company, email, phone, mobile,
            address, address2, suburb, city, state, postcode, website_url
       FROM ims_contacts
      WHERE business_id = ? AND is_active = 1
        AND type IN ('lead','retail_customer','b2b_customer','both')`,
    [SOLVANTIS_LEAD_BUSINESS_ID],
  );
  return rows as ExistingContact[];
}

export async function preflightLeadCandidate(
  connection: PoolConnection,
  input: ApprovedLeadCandidate,
): Promise<LeadPreflightResult> {
  const candidate = normalizeApprovedLeadCandidate(input);
  const replayKeys = candidate.sources.map(source => evidenceKey(candidate, source));
  const placeholders = replayKeys.map(() => '?').join(',');
  const [replayed] = await connection.execute<RowDataPacket[]>(
    `SELECT c.id, c.type, c.name, c.company, c.email, c.phone, c.mobile, c.address, c.website_url
       FROM ims_crm_lead_discoveries d
       JOIN ims_contacts c ON c.business_id = d.business_id AND c.id = d.contact_id
      WHERE d.business_id = ? AND d.idempotency_key IN (${placeholders})
      LIMIT 1`,
    [SOLVANTIS_LEAD_BUSINESS_ID, ...replayKeys],
  );
  if (replayed[0]) return { outcome: 'existing', candidate, contact: replayed[0] as ExistingContact, reason: 'Previously imported candidate' };

  const contacts = await loadContacts(connection);
  const candidateDomain = websiteDomain(candidate.website_url);
  const exact = contacts.filter(contact => {
    const sameEmail = candidate.email && normalizeEmail(contact.email) === candidate.email;
    const candidatePhones = new Set([candidate.phone, candidate.mobile].filter(Boolean));
    const samePhone = [normalizePhone(contact.phone), normalizePhone(contact.mobile)].some(phone => phone && candidatePhones.has(phone));
    const sameWebsite = candidateDomain && websiteDomain(contact.website_url) === candidateDomain;
    return Boolean(sameEmail || samePhone || sameWebsite);
  });
  if (exact.length === 1) return { outcome: 'existing', candidate, contact: exact[0], reason: 'Matching public contact channel' };
  if (exact.length > 1) return { outcome: 'ambiguous', candidate, matches: exact.map(contact => ({ contact, score: 100, reasons: ['Matching public contact channel'] })) };

  const possible = contacts.map(contact => ({ contact, ...scoreDuplicateContacts(candidate, contact) }))
    .filter(match => match.confidence !== 'none')
    .map(({ contact, score, reasons }) => ({ contact, score, reasons }));
  if (possible.length) return { outcome: 'ambiguous', candidate, matches: possible };
  return { outcome: 'create', candidate };
}

async function insertEvidence(connection: PoolConnection, contactId: number, candidate: NormalizedLeadCandidate) {
  for (const source of candidate.sources) {
    await connection.execute(
      `INSERT IGNORE INTO ims_crm_lead_discoveries
         (business_id, contact_id, idempotency_key, batch_id, source_query, source_url, source_kind, discovered_at, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [SOLVANTIS_LEAD_BUSINESS_ID, contactId, evidenceKey(candidate, source), candidate.batchId,
        candidate.sourceQuery, source.url, source.kind, candidate.discoveredAt.slice(0, 19).replace('T', ' '), source.confidence ?? null],
    );
  }
  for (const person of candidate.people) {
    const personKey = createHash('sha256').update([
      SOLVANTIS_LEAD_BUSINESS_ID, candidate.batchId, candidate.candidateKey, person.personKey,
    ].join('\n')).digest('hex');
    const [personResult] = await connection.execute(
      `INSERT INTO ims_crm_lead_people
         (business_id, contact_id, idempotency_key, full_name, role, role_title, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [SOLVANTIS_LEAD_BUSINESS_ID, contactId, personKey, person.fullName, person.role, person.roleTitle, person.sourceUrl],
    ) as any;
    const personId = Number(personResult.insertId);
    for (const contact of person.contacts ?? []) {
      const contactKey = createHash('sha256').update([
        personKey, contact.type, contact.value, contact.evidence,
      ].join('\n')).digest('hex');
      await connection.execute(
        `INSERT IGNORE INTO ims_crm_lead_contact_points
           (business_id, contact_id, person_id, idempotency_key, channel_type, channel_value,
            evidence_status, source_url, verification_status, verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [SOLVANTIS_LEAD_BUSINESS_ID, contactId, personId, contactKey, contact.type, contact.value,
          contact.evidence, contact.sourceUrl, contact.verificationStatus,
          contact.verificationStatus !== 'not_checked' ? new Date() : null],
      );
    }
  }
  for (const contact of candidate.businessContacts) {
    const contactKey = createHash('sha256').update([
      SOLVANTIS_LEAD_BUSINESS_ID, candidate.batchId, candidate.candidateKey,
      'business', contact.type, contact.value, contact.evidence,
    ].join('\n')).digest('hex');
    await connection.execute(
      `INSERT IGNORE INTO ims_crm_lead_contact_points
         (business_id, contact_id, person_id, idempotency_key, channel_type, channel_value,
          evidence_status, source_url, verification_status, verified_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      [SOLVANTIS_LEAD_BUSINESS_ID, contactId, contactKey, contact.type, contact.value,
        contact.evidence, contact.sourceUrl, contact.verificationStatus,
        contact.verificationStatus !== 'not_checked' ? new Date() : null],
    );
  }
}

export async function importApprovedLeadCandidate(input: ApprovedLeadCandidate) {
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const preflight = await preflightLeadCandidate(connection, input);
    if (preflight.outcome === 'ambiguous') {
      await connection.rollback();
      return preflight;
    }
    if (preflight.outcome === 'existing') {
      await insertEvidence(connection, preflight.contact.id, preflight.candidate);
      await connection.commit();
      return { ...preflight, evidenceAttached: true };
    }

    const candidate = preflight.candidate;
    const [result] = await connection.execute(
      `INSERT INTO ims_contacts
         (business_id, type, name, company, email, phone, mobile, address, address2, suburb, city, state, postcode,
          country, website_url, lead_temperature, is_active)
       VALUES (?, 'lead', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Australia', ?, 'cold', 1)`,
      [SOLVANTIS_LEAD_BUSINESS_ID, candidate.name, candidate.company ?? candidate.name, candidate.email,
        candidate.phone, candidate.mobile, candidate.address, candidate.address2, candidate.suburb, candidate.city,
        candidate.state, candidate.postcode, candidate.website_url],
    ) as any;
    const contactId = Number(result.insertId);
    await connection.execute(
      `UPDATE ims_contacts SET customer_code = CONCAT('C-', LPAD(?, 6, '0'))
        WHERE id = ? AND business_id = ? AND (customer_code IS NULL OR customer_code = '')`,
      [contactId, contactId, SOLVANTIS_LEAD_BUSINESS_ID],
    );
    await insertEvidence(connection, contactId, candidate);
    await connection.commit();
    return { outcome: 'created' as const, candidate, contactId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}