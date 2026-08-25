export const CS_CATEGORIES = ['customer_enquiry', 'junk', 'other'] as const;
export type CsCategory = typeof CS_CATEGORIES[number];

export const CS_ENQUIRY_SUBTYPES = [
  'product',
  'stock',
  'order_status',
  'shipping',
  'return_exchange',
  'complaint',
  'store_information',
  'other',
] as const;
export type CsEnquirySubtype = typeof CS_ENQUIRY_SUBTYPES[number];

export const CS_AUTOMATION_MODES = ['draft', 'send'] as const;
export type CsAutomationMode = typeof CS_AUTOMATION_MODES[number];

export const CS_DEFAULT_RUN_TIMES = ['10:00', '16:00'] as const;

export interface CsSettings {
  enabled: boolean;
  timezone: string;
  runTimes: string[];
  mode: CsAutomationMode;
  lookbackDays: number;
  unreadFirst: boolean;
  retentionMode: 'keep_all' | 'limited';
  retentionDays: number;
  lightModelId: string;
  capableModelId: string;
  enabledTools: string[];
  guidelines: string;
  helperEmails: string[];
  learningEnabled: boolean;
}

export interface CsClassification {
  category: CsCategory;
  subtype: CsEnquirySubtype | null;
  confidence: number;
  urgency: 'low' | 'normal' | 'high' | 'urgent';
  sentiment: 'negative' | 'neutral' | 'positive';
  reason: string;
}

export function isCsAutomationMode(value: unknown): value is CsAutomationMode {
  return typeof value === 'string' && CS_AUTOMATION_MODES.includes(value as CsAutomationMode);
}

export function normalizeRunTimes(value: unknown): string[] {
  if (!Array.isArray(value)) return [...CS_DEFAULT_RUN_TIMES];

  const normalized = Array.from(new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(item => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item)),
  )).sort();

  return normalized.length > 0 ? normalized : [...CS_DEFAULT_RUN_TIMES];
}