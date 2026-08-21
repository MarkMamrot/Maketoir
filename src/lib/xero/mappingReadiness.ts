import type { XeroDocumentPolicy } from './documentPolicies';

export type MappingRequirement = 'required' | 'optional';
export type MappingReadinessStatus = 'ready' | 'missing' | 'stale' | 'optional';

export type MappingReadinessItem = {
  category: 'account' | 'payment_method' | 'pos_revenue' | 'pos_clearing' | 'gateway' | 'tracking';
  key: string;
  label: string;
  requirement: MappingRequirement;
  status: MappingReadinessStatus;
  summary: string;
};

export type MappingReadinessInput = {
  policy: XeroDocumentPolicy;
  accounts: Array<{ accountId: string; code: string; status: string; type?: string; enablePaymentsToAccount?: boolean }>;
  accountMappings: Array<{ roleKey: string; accountId: string; accountCode: string }>;
  paymentMethods: Array<{ side: 'po' | 'so'; id: number; name: string; active: boolean; accountCode: string | null }>;
  posRevenue: Array<{ locationId: number; locationName: string; accountId: string | null; accountCode: string | null }>;
  posClearing: Array<{ locationId: number; locationName: string; paymentMethod: string; accountId: string | null; accountCode: string | null }>;
  gateways: Array<{ gatewayName: string; displayName: string; accountCode: string | null; feeEnabled?: boolean; feeAccountCode?: string | null }>;
  tracking: Array<{
    key: string;
    label: string;
    featureEnabled: boolean;
    categoryId: string | null;
    optionId: string | null;
    categoryActive: boolean;
    optionActive: boolean;
  }>;
};

const accountRoles: Array<{ key: string; label: string; required: (policy: XeroDocumentPolicy) => boolean }> = [
  { key: 'inventory_asset', label: 'Inventory Asset', required: policy => policy.poCompletedAction !== 'none' || policy.supplierCreditNoteAction !== 'none' },
  { key: 'inventory_in_transit', label: 'Inventory in Transit', required: policy => policy.poCompletedAction !== 'none' },
  { key: 'sales_revenue', label: 'Sales Revenue', required: policy => policy.soApprovedAction !== 'none' || policy.soCompletedAction !== 'none' || policy.manualCustomerCreditNoteAction !== 'none' || policy.onlineBatchAction !== 'none' },
  { key: 'petty_cash_expense', label: 'Petty Cash Expense', required: policy => policy.posBatchSyncEnabled && policy.posBatchPaymentSyncEnabled },
  { key: 'credit_note', label: 'Customer Returns / Refunds', required: () => false },
  { key: 'supplier_credit_note', label: 'Supplier Credit Notes', required: () => false },
];

function paymentAccount(account: MappingReadinessInput['accounts'][number] | undefined): boolean {
  return !!account && account.status === 'ACTIVE' && (account.type === 'BANK' || account.enablePaymentsToAccount === true);
}

function mappedItem(input: {
  category: MappingReadinessItem['category']; key: string; label: string; required: boolean;
  mapped: boolean; valid: boolean; missingSummary: string; staleSummary: string;
}): MappingReadinessItem {
  const requirement = input.required ? 'required' : 'optional';
  if (!input.mapped) return {
    category: input.category, key: input.key, label: input.label, requirement,
    status: input.required ? 'missing' : 'optional', summary: input.required ? input.missingSummary : 'Optional while this feature is disabled.',
  };
  return {
    category: input.category, key: input.key, label: input.label, requirement,
    status: input.valid ? 'ready' : 'stale', summary: input.valid ? 'Mapped to an active Xero value.' : input.staleSummary,
  };
}

export function evaluateXeroMappingReadiness(input: MappingReadinessInput): MappingReadinessItem[] {
  const accountsById = new Map(input.accounts.map(account => [account.accountId, account]));
  const accountsByCode = new Map(input.accounts.map(account => [account.code, account]));
  const mappingsByRole = new Map(input.accountMappings.map(mapping => [mapping.roleKey, mapping]));
  const items: MappingReadinessItem[] = accountRoles.map(role => {
    const mapping = mappingsByRole.get(role.key);
    const account = mapping ? accountsById.get(mapping.accountId) : undefined;
    return mappedItem({
      category: 'account', key: role.key, label: role.label, required: role.required(input.policy), mapped: !!mapping,
      valid: !!account && account.status === 'ACTIVE' && account.code === mapping?.accountCode,
      missingSummary: `${role.label} is required by the enabled document policy.`,
      staleSummary: `${role.label} points to a missing, archived, or changed Xero account.`,
    });
  });

  for (const mapping of input.posRevenue) {
    const account = mapping.accountId ? accountsById.get(mapping.accountId) : undefined;
    items.push(mappedItem({
      category: 'pos_revenue', key: String(mapping.locationId), label: `${mapping.locationName}: POS Revenue`,
      required: input.policy.posBatchSyncEnabled,
      mapped: !!mapping.accountId && !!mapping.accountCode,
      valid: !!account && account.status === 'ACTIVE' && account.code === mapping.accountCode && account.type === 'REVENUE',
      missingSummary: 'POS EOD posting is blocked until this location has a revenue account.',
      staleSummary: 'The saved revenue account is missing, archived, changed, or is no longer a revenue account.',
    }));
  }

  for (const method of input.paymentMethods.filter(method => method.active)) {
    const required = method.side === 'po' ? input.policy.poPaymentSyncEnabled : input.policy.soPaymentSyncEnabled;
    items.push(mappedItem({
      category: 'payment_method', key: `${method.side}:${method.id}`, label: `${method.side.toUpperCase()} payment: ${method.name}`,
      required, mapped: !!method.accountCode, valid: paymentAccount(method.accountCode ? accountsByCode.get(method.accountCode) : undefined),
      missingSummary: `${method.name} requires an active Xero payment account while ${method.side.toUpperCase()} payment sync is enabled.`,
      staleSummary: `${method.name} points to a missing, archived, or non-payment Xero account.`,
    }));
  }

  for (const mapping of input.posClearing) {
    const required = input.policy.posBatchSyncEnabled && input.policy.posBatchPaymentSyncEnabled;
    items.push(mappedItem({
      category: 'pos_clearing', key: `${mapping.locationId}:${mapping.paymentMethod.toLowerCase()}`,
      label: `${mapping.locationName}: ${mapping.paymentMethod}`, required,
      mapped: !!mapping.accountId && !!mapping.accountCode,
      valid: paymentAccount(mapping.accountId ? accountsById.get(mapping.accountId) : undefined),
      missingSummary: 'This payment method will remain unposted to Xero; POS EOD closure is not blocked.',
      staleSummary: 'The saved clearing account is missing, archived, or no longer accepts payments; POS EOD closure is not blocked.',
    }));
  }

  for (const gateway of input.gateways) {
    const required = input.policy.onlineBatchAction !== 'none' && input.policy.onlineBatchPaymentSyncEnabled;
    const clearingAccount = gateway.accountCode ? accountsByCode.get(gateway.accountCode) : undefined;
    const feeAccount = gateway.feeAccountCode ? accountsByCode.get(gateway.feeAccountCode) : undefined;
    const valid = paymentAccount(clearingAccount)
      && (!gateway.feeEnabled || (!!feeAccount && feeAccount.status === 'ACTIVE'));
    items.push(mappedItem({
      category: 'gateway', key: gateway.gatewayName, label: `Online gateway: ${gateway.displayName}`, required,
      mapped: !!gateway.accountCode && (!gateway.feeEnabled || !!gateway.feeAccountCode), valid,
      missingSummary: `${gateway.displayName} requires clearing${gateway.feeEnabled ? ' and fee' : ''} accounts while online payment sync is enabled.`,
      staleSummary: `${gateway.displayName} points to a missing, archived, or incompatible Xero account.`,
    }));
  }

  for (const tracking of input.tracking) {
    const mapped = !!tracking.categoryId && !!tracking.optionId;
    items.push(mappedItem({
      category: 'tracking', key: tracking.key, label: tracking.label, required: false, mapped,
      valid: tracking.categoryActive && tracking.optionActive,
      missingSummary: '',
      staleSummary: `${tracking.label} points to an archived or missing Xero tracking option.`,
    }));
    const item = items.at(-1)!;
    item.summary = mapped
      ? item.summary
      : tracking.featureEnabled ? 'Optional: enabled transactions will post without this tracking dimension.' : 'Optional while this feature is disabled.';
  }
  return items;
}

export function summarizeXeroMappingReadiness(items: MappingReadinessItem[]) {
  return {
    required: items.filter(item => item.requirement === 'required').length,
    ready: items.filter(item => item.requirement === 'required' && item.status === 'ready').length,
    missing: items.filter(item => item.status === 'missing').length,
    stale: items.filter(item => item.status === 'stale').length,
    optional: items.filter(item => item.status === 'optional').length,
  };
}