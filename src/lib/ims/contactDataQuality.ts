export interface ContactIdentityInput {
  id?: number;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  address?: string | null;
  address2?: string | null;
  suburb?: string | null;
  city?: string | null;
  state?: string | null;
  postcode?: string | null;
}

export interface DuplicateContactMatch {
  score: number;
  confidence: 'high' | 'possible' | 'none';
  reasons: string[];
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

export function isValidEmail(value: unknown): boolean {
  const normalized = normalizeEmail(value);
  if (!normalized || normalized.length > 254 || /\s/.test(normalized)) return false;
  const parts = normalized.split('@');
  if (parts.length !== 2 || !parts[0] || parts[0].length > 64) return false;
  const [local, domain] = parts;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  if (domain.length > 253 || !domain.includes('.')) return false;
  return domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

export function normalizePhone(value: unknown, defaultCountry = 'AU'): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const extensionStripped = raw.replace(/(?:ext\.?|extension|x)\s*\d+$/i, '').trim();
  let digits = extensionStripped.replace(/\D/g, '');
  if (!digits) return null;
  if (extensionStripped.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (defaultCountry === 'AU') {
    if (digits.startsWith('0')) return `+61${digits.slice(1)}`;
    if (digits.startsWith('61')) return `+${digits}`;
  }
  return `+${digits}`;
}

export function isValidPhone(value: unknown, defaultCountry = 'AU'): boolean {
  const normalized = normalizePhone(value, defaultCountry);
  if (!normalized || !/^\+[1-9]\d{7,14}$/.test(normalized)) return false;
  if (normalized.startsWith('+61')) return /^\+61[23478]\d{8}$/.test(normalized);
  return true;
}

function normalizeWords(value: unknown): string {
  return typeof value === 'string'
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
    : '';
}

function normalizeAddressWords(value: unknown): string {
  const words = normalizeWords(value).split(' ').filter(Boolean);
  const aliases: Record<string, string> = {
    ave: 'avenue', blvd: 'boulevard', cres: 'crescent', ct: 'court', dr: 'drive',
    hwy: 'highway', ln: 'lane', pde: 'parade', pl: 'place', rd: 'road', st: 'street', tce: 'terrace',
  };
  return words.map(word => aliases[word] ?? word).join(' ');
}

function contactName(contact: ContactIdentityInput): string {
  return normalizeWords(contact.name || [contact.first_name, contact.last_name].filter(Boolean).join(' '));
}

function contactAddress(contact: ContactIdentityInput): string {
  return normalizeAddressWords([
    contact.address, contact.address2, contact.suburb || contact.city, contact.state, contact.postcode,
  ].filter(Boolean).join(' '));
}

export function scoreDuplicateContacts(left: ContactIdentityInput, right: ContactIdentityInput): DuplicateContactMatch {
  const reasons: string[] = [];
  let score = 0;
  const leftEmail = normalizeEmail(left.email);
  const rightEmail = normalizeEmail(right.email);
  if (leftEmail && rightEmail && isValidEmail(leftEmail) && leftEmail === rightEmail) {
    score += 70;
    reasons.push('Same email');
  }

  const leftPhones = new Set([normalizePhone(left.mobile), normalizePhone(left.phone)].filter(Boolean));
  const rightPhones = new Set([normalizePhone(right.mobile), normalizePhone(right.phone)].filter(Boolean));
  if ([...leftPhones].some(phone => rightPhones.has(phone) && isValidPhone(phone))) {
    score += 70;
    reasons.push('Same phone');
  }

  const leftName = contactName(left);
  const rightName = contactName(right);
  if (leftName && leftName === rightName) {
    score += 20;
    reasons.push('Same name');
  }

  const leftCompany = normalizeWords(left.company);
  const rightCompany = normalizeWords(right.company);
  if (leftCompany && leftCompany === rightCompany) {
    score += 10;
    reasons.push('Same company');
  }

  const leftAddress = contactAddress(left);
  const rightAddress = contactAddress(right);
  if (leftAddress && leftAddress === rightAddress) {
    score += 20;
    reasons.push('Same address');
  }

  const boundedScore = Math.min(score, 100);
  return {
    score: boundedScore,
    confidence: boundedScore >= 70 ? 'high' : boundedScore >= 40 ? 'possible' : 'none',
    reasons,
  };
}

export interface ContactChannelValidation {
  normalized: { email?: string | null; phone?: string | null; mobile?: string | null };
  errors: string[];
}

export function validateContactChannels(input: ContactIdentityInput): ContactChannelValidation {
  const normalized: ContactChannelValidation['normalized'] = {};
  const errors: string[] = [];
  if (input.email !== undefined) {
    normalized.email = normalizeEmail(input.email);
    if (normalized.email && !isValidEmail(normalized.email)) errors.push('Enter a valid email address.');
  }
  for (const field of ['phone', 'mobile'] as const) {
    if (input[field] === undefined) continue;
    normalized[field] = normalizePhone(input[field]);
    if (normalized[field] && !isValidPhone(normalized[field])) {
      errors.push(`Enter a valid ${field} number, including the country code for non-Australian numbers.`);
    }
  }
  return { normalized, errors };
}

export function duplicateCandidateKeys(contact: ContactIdentityInput): string[] {
  const keys = new Set<string>();
  const email = normalizeEmail(contact.email);
  if (email && isValidEmail(email)) keys.add(`email:${email}`);
  for (const value of [contact.mobile, contact.phone]) {
    const phone = normalizePhone(value);
    if (phone && isValidPhone(phone)) keys.add(`phone:${phone}`);
  }
  const name = contactName(contact);
  if (name) keys.add(`name:${name}`);
  return [...keys];
}