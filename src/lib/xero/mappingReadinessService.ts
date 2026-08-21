import { ConfigRepository } from '@/lib/db/ConfigRepository';
import { ImsPaymentMethodsRepo } from '@/lib/ims/ImsRepository';
import { imsQuery } from '@/services/IMSMySQLService';
import { query } from '@/services/MySQLService';
import { xeroApiFetch } from '@/services/XeroService';
import { getXeroDocumentPolicy } from './documentPolicyRepository';
import { evaluateXeroMappingReadiness, summarizeXeroMappingReadiness } from './mappingReadiness';

function configuredPosMethods(raw: string | null): string[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.map(item => typeof item === 'string' ? item.trim() : String(item?.name ?? '').trim()).filter(Boolean))];
}

function gatewayNames(rows: Array<{ gateway_allocations: string | null }>, configured: Array<{ gateway_name: string }>): string[] {
  const names = new Set(configured.map(row => row.gateway_name));
  for (const row of rows) {
    try {
      const allocations = JSON.parse(row.gateway_allocations ?? '[]');
      if (Array.isArray(allocations)) for (const allocation of allocations) {
        const name = String(allocation?.gateway ?? '').trim().toLowerCase();
        if (name) names.add(name);
      }
    } catch {}
  }
  return [...names].sort();
}

export async function getXeroMappingReadiness(businessId: string) {
  const [policy, accountRows, trackingRows, posMappingRows, gatewayRows, batchRows, paymentMethods, locations, rawPosMethods, accountResponse, trackingResponse] = await Promise.all([
    getXeroDocumentPolicy(businessId),
    query<any>('SELECT role_key, xero_account_id, xero_account_code FROM xero_account_mappings WHERE business_id = ?', [businessId]),
    query<any>('SELECT ims_location_id, ims_channel, xero_tracking_category_id, xero_tracking_option_id FROM xero_tracking_mappings WHERE business_id = ?', [businessId]),
    query<any>('SELECT ims_location_id, payment_method, xero_account_id, xero_account_code FROM xero_pos_clearing_mappings WHERE business_id = ?', [businessId]),
    query<any>('SELECT gateway_name, display_name, clearing_account_code, fee_account_code, deduct_fee_enabled FROM xero_gateway_mappings WHERE business_id = ?', [businessId]),
    query<{ gateway_allocations: string | null }>('SELECT gateway_allocations FROM xero_online_batches WHERE business_id = ? AND gateway_allocations IS NOT NULL ORDER BY batch_date DESC LIMIT 90', [businessId]),
    ImsPaymentMethodsRepo.listActive(businessId),
    imsQuery<{ id: number; name: string }>('SELECT id, name FROM ims_locations WHERE business_id = ? AND is_active = 1 ORDER BY name', [businessId]),
    ConfigRepository.get(businessId, 'POS_PaymentMethods'),
    xeroApiFetch(businessId, '/Accounts'),
    xeroApiFetch(businessId, '/TrackingCategories'),
  ]);

  const accounts = (accountResponse?.Accounts ?? []).map((account: any) => ({
    accountId: String(account.AccountID ?? ''), code: String(account.Code ?? ''), status: String(account.Status ?? '').toUpperCase(),
    type: account.Type, enablePaymentsToAccount: account.EnablePaymentsToAccount === true,
  }));
  const categories = new Map<string, any>((trackingResponse?.TrackingCategories ?? []).map((category: any) => [String(category.TrackingCategoryID), category]));
  const trackingMapping = (locationId: number | null, channel: string | null) => trackingRows.find(row => Number(row.ims_location_id) === Number(locationId) && (row.ims_channel ?? null) === channel);
  const tracking = [
    ...locations.map(location => ({ key: `location:${location.id}`, label: location.name, locationId: location.id, channel: null, featureEnabled: policy.poApprovedAction !== 'none' || policy.poCompletedAction !== 'none' || policy.soApprovedAction !== 'none' || policy.soCompletedAction !== 'none' })),
    { key: 'channel:pos', label: 'POS Sales', locationId: null, channel: 'pos', featureEnabled: policy.posBatchSyncEnabled },
    { key: 'channel:online', label: 'Online Sales', locationId: null, channel: 'online', featureEnabled: policy.onlineBatchAction !== 'none' },
    { key: 'channel:wholesale', label: 'Wholesale', locationId: null, channel: 'wholesale', featureEnabled: policy.soApprovedAction !== 'none' || policy.soCompletedAction !== 'none' },
  ].map(target => {
    const mapping = trackingMapping(target.locationId, target.channel);
    const category = mapping ? categories.get(String(mapping.xero_tracking_category_id)) : null;
    const option = category?.Options?.find((candidate: any) => String(candidate.TrackingOptionID) === String(mapping?.xero_tracking_option_id));
    return {
      ...target, categoryId: mapping?.xero_tracking_category_id ?? null, optionId: mapping?.xero_tracking_option_id ?? null,
      categoryActive: String(category?.Status ?? '').toUpperCase() === 'ACTIVE', optionActive: String(option?.Status ?? '').toUpperCase() === 'ACTIVE',
    };
  });

  const posMethods = configuredPosMethods(rawPosMethods);
  const posRevenue = locations.map(location => {
    const mapping = accountRows.find(row => row.role_key === `pos_sales_revenue:${location.id}`);
    return { locationId: location.id, locationName: location.name, accountId: mapping?.xero_account_id ?? null, accountCode: mapping?.xero_account_code ?? null };
  });
  const posClearing = locations.flatMap(location => posMethods.map(paymentMethod => {
    const mapping = posMappingRows.find(row => Number(row.ims_location_id) === location.id && String(row.payment_method).trim().toLowerCase() === paymentMethod.toLowerCase());
    return { locationId: location.id, locationName: location.name, paymentMethod, accountId: mapping?.xero_account_id ?? null, accountCode: mapping?.xero_account_code ?? null };
  }));
  const configuredGateways = new Map(gatewayRows.map(row => [String(row.gateway_name), row]));
  const gateways = gatewayNames(batchRows, gatewayRows).map(gatewayName => {
    const mapping = configuredGateways.get(gatewayName);
    return { gatewayName, displayName: mapping?.display_name ?? gatewayName, accountCode: mapping?.clearing_account_code ?? null, feeEnabled: Boolean(mapping?.deduct_fee_enabled), feeAccountCode: mapping?.fee_account_code ?? null };
  });

  const items = evaluateXeroMappingReadiness({
    policy, accounts,
    accountMappings: accountRows.map(row => ({ roleKey: row.role_key, accountId: row.xero_account_id, accountCode: row.xero_account_code })),
    paymentMethods: paymentMethods.map(method => ({ side: method.type, id: method.id, name: method.name, active: Boolean(method.is_active), accountCode: method.xero_account_code || null })),
    posRevenue, posClearing, gateways, tracking,
  });
  return { policy, items, summary: summarizeXeroMappingReadiness(items), checkedAt: new Date().toISOString() };
}