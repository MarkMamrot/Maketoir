import { SHIPPING_PROVIDERS, type ShippingProvider } from './types';

export type CarrierAccountInput = {
  id?: number;
  provider: ShippingProvider;
  displayName: string;
  environment: 'test' | 'production';
  baseUrl?: string;
  accountNumber?: string;
  apiKey?: string;
  password?: string;
  dispatchLocationId?: number | null;
  isActive?: boolean;
};

export type PackagePresetInput = {
  id?: number;
  name: string;
  packageType: 'box' | 'satchel' | 'pallet' | 'custom';
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  tareWeightKg: number;
  maxWeightKg?: number | null;
  allowRotation: boolean;
  sortPriority?: number;
  isActive?: boolean;
};

export function validateCarrierAccountInput(input: CarrierAccountInput, credentialsAlreadyStored = false): string[] {
  const errors: string[] = [];
  if (!SHIPPING_PROVIDERS.includes(input.provider)) errors.push('Choose a supported carrier account type.');
  if (!input.displayName.trim() || input.displayName.trim().length > 120) errors.push('Account name is required and must be 120 characters or fewer.');
  if (input.environment !== 'test' && input.environment !== 'production') errors.push('Choose test or production mode.');
  if (input.environment === 'test' && !isHttpsUrl(input.baseUrl)) errors.push('Enter the HTTPS testbed URL supplied by Australia Post.');
  if (input.environment === 'production' && input.baseUrl && !isHttpsUrl(input.baseUrl)) errors.push('Carrier API URL must use HTTPS.');
  if (input.provider === 'mypost_business' && input.isActive !== false) {
    errors.push('MyPost Business requires Australia Post partner access before it can be enabled.');
  }
  if (input.provider === 'auspost_eparcel') {
    if (!/^\d{10}$/.test(String(input.accountNumber ?? '').trim())) errors.push('eParcel account number must contain 10 digits.');
    if (!credentialsAlreadyStored && (!input.apiKey?.trim() || !input.password?.trim())) {
      errors.push('eParcel API key and password are required.');
    }
  }
  if (input.dispatchLocationId != null && (!Number.isInteger(input.dispatchLocationId) || input.dispatchLocationId <= 0)) {
    errors.push('Choose a valid dispatch location.');
  }
  return errors;
}

function isHttpsUrl(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function validatePackagePresetInput(input: PackagePresetInput): string[] {
  const errors: string[] = [];
  if (!input.name.trim() || input.name.trim().length > 120) errors.push('Package name is required and must be 120 characters or fewer.');
  if (!['box', 'satchel', 'pallet', 'custom'].includes(input.packageType)) errors.push('Choose a supported package type.');
  for (const [label, value] of [
    ['Length', input.lengthMm],
    ['Width', input.widthMm],
    ['Height', input.heightMm],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0 || value > 10_000) errors.push(`${label} must be greater than 0 and no more than 10,000 mm.`);
  }
  if (!Number.isFinite(input.tareWeightKg) || input.tareWeightKg < 0 || input.tareWeightKg > 1_000) {
    errors.push('Tare weight must be between 0 and 1,000 kg.');
  }
  if (input.maxWeightKg != null && (!Number.isFinite(input.maxWeightKg) || input.maxWeightKg <= 0 || input.maxWeightKg > 10_000)) {
    errors.push('Maximum weight must be greater than 0 and no more than 10,000 kg.');
  }
  return errors;
}
