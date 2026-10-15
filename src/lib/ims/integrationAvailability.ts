import { ConnectionsRepository, type ConnectionsRow } from '@/lib/db/ConnectionsRepository';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

export const OPTIONAL_INTEGRATION_PROVIDERS = [
  'cin7',
  'google',
  'meta',
  'klaviyo',
  'gmail',
] as const;

export type OptionalIntegrationProvider = typeof OPTIONAL_INTEGRATION_PROVIDERS[number];
export type IntegrationAvailabilityStatus = 'configured' | 'not_configured';

export interface IntegrationAvailability {
  enabled: boolean;
  configured: boolean;
  status: IntegrationAvailabilityStatus;
}

export type IntegrationAvailabilityMap = Record<OptionalIntegrationProvider, IntegrationAvailability>;

export const INTEGRATION_AVAILABILITY_SETTING_PREFIX = 'integration_';

export function isOptionalIntegrationProvider(value: unknown): value is OptionalIntegrationProvider {
  return typeof value === 'string'
    && (OPTIONAL_INTEGRATION_PROVIDERS as readonly string[]).includes(value);
}

export function integrationAvailabilitySettingKey(provider: OptionalIntegrationProvider): string {
  return `${INTEGRATION_AVAILABILITY_SETTING_PREFIX}${provider}_enabled`;
}

function hasStoredValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isOptionalIntegrationConfigured(
  provider: OptionalIntegrationProvider,
  connection: ConnectionsRow | null,
): boolean {
  if (!connection) return false;
  switch (provider) {
    case 'cin7':
      return hasStoredValue(connection.cin7_account_id) || hasStoredValue(connection.cin7_api_key);
    case 'google':
      return hasStoredValue(connection.google_ads_refresh_token)
        || hasStoredValue(connection.google_ads_customer_id)
        || hasStoredValue(connection.ga4_property_id);
    case 'meta':
      return hasStoredValue(connection.meta_access_token) || hasStoredValue(connection.meta_ad_account_id);
    case 'klaviyo':
      return hasStoredValue(connection.klaviyo_api_key);
    case 'gmail':
      return hasStoredValue(connection.gmail_refresh_token)
        || hasStoredValue(connection.gmail_email)
        || hasStoredValue(connection.gmail_client_id)
        || hasStoredValue(connection.gmail_client_secret);
  }
}

function explicitSetting(value: string | null | undefined): boolean | undefined {
  if (value == null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  return undefined;
}

export function resolveIntegrationAvailability(
  _provider: OptionalIntegrationProvider,
  flagValue: string | null | undefined,
  configured: boolean,
): IntegrationAvailability {
  const explicit = explicitSetting(flagValue);
  return {
    enabled: explicit ?? configured,
    configured,
    status: configured ? 'configured' : 'not_configured',
  };
}

export class IntegrationDisabledError extends Error {
  readonly status = 423;
  readonly code = 'integration_disabled';

  constructor(readonly provider: OptionalIntegrationProvider) {
    super(`${provider} integration is disabled for this business.`);
    this.name = 'IntegrationDisabledError';
  }
}

export function isIntegrationDisabledError(error: unknown): error is IntegrationDisabledError {
  return error instanceof IntegrationDisabledError;
}

export async function getOptionalIntegrationAvailability(
  businessId: string,
): Promise<IntegrationAvailabilityMap> {
  return runImsForBusiness(businessId, async () => {
    const [settings, connection] = await Promise.all([
      imsQuery<{ key: string; value: string | null }>(
        'SELECT `key`, `value` FROM ims_settings WHERE business_id = ? AND `key` IN (?, ?, ?, ?, ?)',
        [
          businessId,
          ...OPTIONAL_INTEGRATION_PROVIDERS.map(integrationAvailabilitySettingKey),
        ],
      ),
      ConnectionsRepository.get(businessId),
    ]);
    const values = new Map(settings.map(row => [row.key, row.value]));
    return Object.fromEntries(OPTIONAL_INTEGRATION_PROVIDERS.map(provider => {
      const configured = isOptionalIntegrationConfigured(provider, connection);
      return [
        provider,
        resolveIntegrationAvailability(
          provider,
          values.get(integrationAvailabilitySettingKey(provider)),
          configured,
        ),
      ];
    })) as IntegrationAvailabilityMap;
  });
}

export async function isOptionalIntegrationEnabled(
  businessId: string,
  provider: OptionalIntegrationProvider,
): Promise<boolean> {
  return (await getOptionalIntegrationAvailability(businessId))[provider].enabled;
}

export async function assertOptionalIntegrationEnabled(
  businessId: string,
  provider: OptionalIntegrationProvider,
): Promise<void> {
  if (!await isOptionalIntegrationEnabled(businessId, provider)) {
    throw new IntegrationDisabledError(provider);
  }
}

export async function setOptionalIntegrationAvailability(
  businessId: string,
  provider: OptionalIntegrationProvider,
  enabled: boolean,
): Promise<IntegrationAvailability> {
  return runImsForBusiness(businessId, async () => {
    await imsExecute(
      `INSERT INTO ims_settings (business_id, \`key\`, value)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [businessId, integrationAvailabilitySettingKey(provider), enabled ? '1' : '0'],
    );
    const [settings, connection] = await Promise.all([
      imsQuery<{ key: string; value: string | null }>(
        'SELECT `key`, `value` FROM ims_settings WHERE business_id = ? AND `key` = ?',
        [businessId, integrationAvailabilitySettingKey(provider)],
      ),
      ConnectionsRepository.get(businessId),
    ]);
    const configured = isOptionalIntegrationConfigured(provider, connection);
    return resolveIntegrationAvailability(provider, settings[0]?.value, configured);
  });
}

export async function preserveDisabledDefaultBeforeCredentialSave(
  businessId: string,
  provider: OptionalIntegrationProvider,
): Promise<void> {
  await runImsForBusiness(businessId, async () => {
    const settingKey = integrationAvailabilitySettingKey(provider);
    const [settings, connection] = await Promise.all([
      imsQuery<{ value: string | null }>(
        'SELECT `value` FROM ims_settings WHERE business_id = ? AND `key` = ?',
        [businessId, settingKey],
      ),
      ConnectionsRepository.get(businessId),
    ]);
    if (settings.length > 0 || isOptionalIntegrationConfigured(provider, connection)) return;
    await imsExecute(
      'INSERT IGNORE INTO ims_settings (business_id, `key`, value) VALUES (?, ?, ?)',
      [businessId, settingKey, '0'],
    );
  });
}

export function isIntegrationAvailabilityNotReadyError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = String(candidate?.code ?? '');
  const message = String(candidate?.message ?? '');
  return code === 'ER_NO_SUCH_TABLE'
    || code === 'ER_BAD_FIELD_ERROR'
    || /no IMS database mapping|IMS database name not configured|table .*ims_settings.*doesn't exist/i.test(message);
}
