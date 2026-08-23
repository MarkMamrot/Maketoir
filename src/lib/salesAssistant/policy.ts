import type { ProspectLeadInput, ProspectPreferredContact } from './types';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{6,24}$/;
const ATTRIBUTION_TEXT_LIMIT = 191;

export interface ProspectAttribution {
  sourcePath: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
}

export interface ValidatedProspectLead extends ProspectLeadInput {
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  sourcePath: string | null;
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function sourcePath(value: unknown): string | null {
  const normalized = optionalText(value, 500);
  if (!normalized || !normalized.startsWith('/') || normalized.startsWith('//')) return null;
  return normalized;
}

function referrer(value: unknown): string | null {
  const normalized = optionalText(value, 500);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString().slice(0, 500) : null;
  } catch {
    return null;
  }
}

export function sanitizeProspectAttribution(input: unknown): ProspectAttribution {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  return {
    sourcePath: sourcePath(value.sourcePath),
    referrer: referrer(value.referrer),
    utmSource: optionalText(value.utmSource, ATTRIBUTION_TEXT_LIMIT),
    utmMedium: optionalText(value.utmMedium, ATTRIBUTION_TEXT_LIMIT),
    utmCampaign: optionalText(value.utmCampaign, ATTRIBUTION_TEXT_LIMIT),
    utmTerm: optionalText(value.utmTerm, ATTRIBUTION_TEXT_LIMIT),
    utmContent: optionalText(value.utmContent, ATTRIBUTION_TEXT_LIMIT),
  };
}

function hasPreferredChannelConsent(input: ProspectLeadInput, channel: ProspectPreferredContact): boolean {
  if (channel === 'email') return input.consentEmail;
  if (channel === 'phone') return input.consentPhone;
  return input.consentSms;
}

export function validateProspectLead(input: ProspectLeadInput): ValidatedProspectLead {
  const name = optionalText(input.name, 255);
  const email = optionalText(input.email, 320)?.toLowerCase() ?? null;
  const phone = optionalText(input.phone, 32);

  if (!name) throw new Error('Name is required.');
  if (email && !EMAIL_PATTERN.test(email)) throw new Error('A valid email address is required.');
  if (phone && !PHONE_PATTERN.test(phone)) throw new Error('A valid phone number is required.');
  if (input.preferredContact === 'email' && !email) throw new Error('Email is required for email contact.');
  if ((input.preferredContact === 'phone' || input.preferredContact === 'sms') && !phone) {
    throw new Error('Phone is required for phone or SMS contact.');
  }
  if (!hasPreferredChannelConsent(input, input.preferredContact)) {
    throw new Error(`Explicit ${input.preferredContact} consent is required.`);
  }

  return {
    ...input,
    name,
    company: optionalText(input.company, 255),
    email,
    phone,
    locations: optionalText(input.locations, 100),
    currentSystems: optionalText(input.currentSystems, 1000),
    timeframe: optionalText(input.timeframe, 100),
    sourcePath: sourcePath(input.sourcePath),
  };
}