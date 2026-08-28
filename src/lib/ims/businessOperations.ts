import { getImsDbNameStrict } from '@/lib/db/BusinessRegistry';
import { imsQuery } from '@/services/IMSMySQLService';

export const ACCOUNTING_CONNECTION_SETTING = 'connect_accounting_software';
export const ACCOUNTING_PLATFORM_SETTING = 'accounting_software';

export function resolveXeroAccountingEnabled(settings: Record<string, string | null | undefined>): boolean {
  return settings[ACCOUNTING_CONNECTION_SETTING] === 'yes'
    && settings[ACCOUNTING_PLATFORM_SETTING] === 'xero';
}

export async function isXeroAccountingEnabled(businessId: string): Promise<boolean> {
  const imsDbName = await getImsDbNameStrict(businessId);
  if (!imsDbName) {
    throw new Error(`Tenant isolation: no IMS database mapping found for business ${businessId}.`);
  }

  const rows = await imsQuery<{ key: string; value: string | null }>(
    'SELECT `key`, `value` FROM ims_settings WHERE business_id = ? AND `key` IN (?, ?)',
    [businessId, ACCOUNTING_CONNECTION_SETTING, ACCOUNTING_PLATFORM_SETTING],
    imsDbName,
  );
  return resolveXeroAccountingEnabled(Object.fromEntries(rows.map(row => [row.key, row.value])));
}

export class XeroAccountingDisabledError extends Error {
  readonly code = 'xero_accounting_disabled';
  readonly status = 423;

  constructor() {
    super('Accounting software is disabled for this business.');
    this.name = 'XeroAccountingDisabledError';
  }
}

export async function assertXeroAccountingEnabled(businessId: string): Promise<void> {
  if (!await isXeroAccountingEnabled(businessId)) throw new XeroAccountingDisabledError();
}

export function isXeroAccountingDisabledError(error: unknown): error is XeroAccountingDisabledError {
  return error instanceof XeroAccountingDisabledError;
}