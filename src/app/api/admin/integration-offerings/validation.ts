export const OFFERING_DELIVERY_MODES = ['native', 'on_demand', 'beta', 'not_offered'] as const;
export const OFFERING_CATEGORIES = [
  '3pl_wms_fulfilment',
  'ecommerce_marketplaces',
  'accounting_erp',
  'payments',
  'shipping_carriers',
  'supplier_edi',
  'crm_marketing',
  'loyalty_gift_cards',
  'bi_warehouse',
  'identity_customer_service',
  'custom_api_webhook_file',
] as const;

export interface IntegrationOfferingInput {
  slug: string;
  name: string;
  category: typeof OFFERING_CATEGORIES[number];
  deliveryMode: typeof OFFERING_DELIVERY_MODES[number];
  publicSummary: string;
  exampleProviders: string[];
  supportedWorkflows: string[];
  qualificationQuestions: string[];
  internalNotes: string | null;
  isEnabled: boolean;
}

type ValidationResult =
  | { value: IntegrationOfferingInput; error?: never }
  | { value?: never; error: string };

function boundedText(value: unknown, label: string, maximum: number, required = true): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const text = value.trim();
  if (required && !text) throw new Error(`${label} is required.`);
  if (text.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  return text;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a JSON array.`);
  if (value.length > 50) throw new Error(`${label} may contain at most 50 items.`);
  return value.map((item, index) => boundedText(item, `${label}[${index}]`, 500));
}

export function validateIntegrationOfferingInput(input: unknown): ValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'A JSON object is required.' };
  const body = input as Record<string, unknown>;
  try {
    const slug = boundedText(body.slug, 'slug', 100).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return { error: 'slug must contain lowercase letters, numbers, and single hyphens only.' };
    }
    if (!OFFERING_CATEGORIES.includes(body.category as typeof OFFERING_CATEGORIES[number])) {
      return { error: 'category is not supported.' };
    }
    if (!OFFERING_DELIVERY_MODES.includes(body.deliveryMode as typeof OFFERING_DELIVERY_MODES[number])) {
      return { error: 'deliveryMode is not supported.' };
    }
    if (typeof body.isEnabled !== 'boolean') return { error: 'isEnabled must be a boolean.' };
    const internalNotes = boundedText(body.internalNotes ?? '', 'internalNotes', 10_000, false) || null;
    return {
      value: {
        slug,
        name: boundedText(body.name, 'name', 255),
        category: body.category as IntegrationOfferingInput['category'],
        deliveryMode: body.deliveryMode as IntegrationOfferingInput['deliveryMode'],
        publicSummary: boundedText(body.publicSummary, 'publicSummary', 5_000),
        exampleProviders: stringArray(body.exampleProviders, 'exampleProviders'),
        supportedWorkflows: stringArray(body.supportedWorkflows, 'supportedWorkflows'),
        qualificationQuestions: stringArray(body.qualificationQuestions, 'qualificationQuestions'),
        internalNotes,
        isEnabled: body.isEnabled,
      },
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Invalid offering.' };
  }
}