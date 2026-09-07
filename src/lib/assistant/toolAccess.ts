import type { UserTier } from '@/lib/tierUtils';

import type { AssistantPrincipal, AssistantToolName } from './tools';

export type AssistantToolOperation =
  | 'ims.catalogue.read'
  | 'ims.stock.read'
  | 'ims.orders.read'
  | 'ims.customers.read'
  | 'ims.reports.read'
  | 'ims.integrations.read'
  | 'foresight.marketing.read'
  | 'pos.catalogue.read'
  | 'pos.register.read'
  | 'wholesale.catalogue.read'
  | 'wholesale.orders.read'
  | 'wholesale.account.read';

export type AssistantToolFeature = 'xero' | 'shopify' | 'foresight.marketing';

interface AssistantToolAccessRule {
  operation: AssistantToolOperation;
  audience: AssistantPrincipal['audience'];
  tiers?: UserTier[];
  wholesaleRoles?: Array<'owner' | 'admin' | 'buyer'>;
  feature?: AssistantToolFeature;
}

const IMS_READ_TIERS: UserTier[] = ['SuperAdmin', 'Admin', 'StandardUser', 'Advisor'];
const IMS_OPERATIONAL_TIERS: UserTier[] = ['SuperAdmin', 'Admin', 'StandardUser'];
const POS_TIERS: UserTier[] = ['SuperAdmin', 'Admin', 'StandardUser', 'PosManager', 'PosUser'];
const WHOLESALE_ROLES: Array<'owner' | 'admin' | 'buyer'> = ['owner', 'admin', 'buyer'];

export const assistantToolAccessManifest: Record<AssistantToolName, AssistantToolAccessRule> = {
  ims_product_lookup: { operation: 'ims.catalogue.read', audience: 'ims', tiers: IMS_READ_TIERS },
  ims_order_summary: { operation: 'ims.orders.read', audience: 'ims', tiers: IMS_READ_TIERS },
  ims_order_search: { operation: 'ims.orders.read', audience: 'ims', tiers: IMS_READ_TIERS },
  ims_stock_alerts: { operation: 'ims.stock.read', audience: 'ims', tiers: IMS_READ_TIERS },
  ims_inventory_position: { operation: 'ims.stock.read', audience: 'ims', tiers: IMS_READ_TIERS },
  ims_stock_movement_history: { operation: 'ims.stock.read', audience: 'ims', tiers: IMS_READ_TIERS },
  ims_stock_allocation_exceptions: { operation: 'ims.orders.read', audience: 'ims', tiers: IMS_READ_TIERS },
  ims_customer_lookup: { operation: 'ims.customers.read', audience: 'ims', tiers: IMS_READ_TIERS },
  ims_customer_activity: { operation: 'ims.customers.read', audience: 'ims', tiers: IMS_READ_TIERS },
  ims_sales_performance: { operation: 'ims.reports.read', audience: 'ims', tiers: IMS_READ_TIERS },
  ims_reorder_forecast: { operation: 'ims.orders.read', audience: 'ims', tiers: IMS_READ_TIERS },
  ims_purchase_order_aging: { operation: 'ims.orders.read', audience: 'ims', tiers: IMS_READ_TIERS },
  ims_xero_sync_diagnostics: { operation: 'ims.integrations.read', audience: 'ims', tiers: IMS_OPERATIONAL_TIERS, feature: 'xero' },
  ims_shopify_sync_diagnostics: { operation: 'ims.integrations.read', audience: 'ims', tiers: IMS_OPERATIONAL_TIERS, feature: 'shopify' },
  ims_marketing_performance: { operation: 'foresight.marketing.read', audience: 'ims', tiers: IMS_OPERATIONAL_TIERS, feature: 'foresight.marketing' },
  ims_marketing_recommendations: { operation: 'foresight.marketing.read', audience: 'ims', tiers: IMS_OPERATIONAL_TIERS, feature: 'foresight.marketing' },
  pos_product_lookup: { operation: 'pos.catalogue.read', audience: 'pos', tiers: POS_TIERS },
  pos_session_context: { operation: 'pos.register.read', audience: 'pos', tiers: POS_TIERS },
  pos_register_status: { operation: 'pos.register.read', audience: 'pos', tiers: POS_TIERS },
  pos_recent_transactions: { operation: 'pos.register.read', audience: 'pos', tiers: POS_TIERS },
  wholesale_catalogue_lookup: { operation: 'wholesale.catalogue.read', audience: 'wholesale', wholesaleRoles: WHOLESALE_ROLES },
  wholesale_order_summary: { operation: 'wholesale.orders.read', audience: 'wholesale', wholesaleRoles: WHOLESALE_ROLES },
  wholesale_account_summary: { operation: 'wholesale.account.read', audience: 'wholesale', wholesaleRoles: WHOLESALE_ROLES },
};

export interface AssistantToolFeatureAvailability {
  xero?: boolean;
  shopify?: boolean;
  'foresight.marketing'?: boolean;
}

export function hasAssistantToolPrincipalAccess(
  principal: AssistantPrincipal,
  toolName: AssistantToolName,
): boolean {
  const rule = assistantToolAccessManifest[toolName];
  if (!rule || rule.audience !== principal.audience) return false;
  if (principal.audience === 'wholesale') {
    return Boolean(rule.wholesaleRoles?.includes(principal.memberRole));
  }
  return Boolean(rule.tiers?.includes(principal.tier));
}

export function isAssistantToolAvailable(
  principal: AssistantPrincipal,
  toolName: AssistantToolName,
  features: AssistantToolFeatureAvailability = {},
): boolean {
  if (!hasAssistantToolPrincipalAccess(principal, toolName)) return false;
  const feature = assistantToolAccessManifest[toolName].feature;
  return !feature || features[feature] === true;
}
