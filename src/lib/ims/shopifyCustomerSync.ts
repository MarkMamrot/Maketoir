import { shopifyInstanceSettings } from '@/lib/channels/shopifyInstanceSettings';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import {
  getContactChannelMappingForContact,
  listContactChannelMappingsForContact,
} from '@/lib/ims/contactChannelMappings';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { ShopifyService } from '@/services/ShopifyService';

type SyncableContact = {
  id: number;
  type?: string;
  is_active?: number;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  shopify_customer_id?: string | null;
};

export type ShopifyCustomerSyncResult =
  | { success: true; action: 'created' | 'updated' | 'linked'; shopifyCustomerId: string }
  | { success: false; action: 'skipped' | 'error'; reason: string; shopifyCustomerId?: string | null };

export function shouldSyncRetailCustomer(contact: Pick<SyncableContact, 'type'>) {
  return contact.type === 'retail_customer';
}

export function buildShopifyCustomerPayload(contact: Pick<SyncableContact, 'name' | 'first_name' | 'last_name' | 'email' | 'phone' | 'mobile'>) {
  const clean = (value: string | null | undefined) => {
    const trimmed = String(value ?? '').trim();
    return trimmed || undefined;
  };

  const payload: Record<string, string> = {};
  const firstName = clean(contact.first_name) ?? clean(contact.name);
  const lastName = clean(contact.last_name);
  const email = clean(contact.email);
  const phone = clean(contact.mobile) ?? clean(contact.phone);

  if (firstName) payload.first_name = firstName;
  if (lastName) payload.last_name = lastName;
  if (email) payload.email = email;
  if (phone) payload.phone = phone;

  return payload;
}

function scopeHint(message: string) {
  return /403|scope|permission|access denied|write_customers|read_customers/i.test(message)
    ? `${message} Check your Shopify app has read_customers and write_customers scopes, then refresh the access token in Setup -> Connections.`
    : message;
}

export async function syncRetailCustomerToShopify(contact: SyncableContact, input: {
  businessId: string;
  channelInstanceId: string;
}): Promise<ShopifyCustomerSyncResult> {
  if (!shouldSyncRetailCustomer(contact)) {
    return { success: false, action: 'skipped', reason: 'Only retail customers sync to Shopify in v1.', shopifyCustomerId: null };
  }

  const businessId = input.businessId.trim();
  const channelInstanceId = input.channelInstanceId.trim();
  if (!businessId || !channelInstanceId) {
    return { success: false, action: 'error', reason: 'Business and Shopify channel instance are required.', shopifyCustomerId: null };
  }

  const mapping = await getContactChannelMappingForContact({ businessId, channelInstanceId, contactId: contact.id });
  if (!mapping || mapping.mappingStatus !== 'linked') {
    return { success: false, action: 'skipped', reason: 'Customer is not linked to this Shopify storefront.', shopifyCustomerId: null };
  }

  try {
    const context = await getShopifyOperationContext({ businessId, channelInstanceId });
    if (!shopifyInstanceSettings(context.instance.settings).customers.outboundEnabled) {
      return { success: false, action: 'skipped', reason: 'Outbound customer sync is disabled for this Shopify storefront.', shopifyCustomerId: mapping.externalCustomerId };
    }
    const shopify = new ShopifyService(context.credentials.shopDomain, context.credentials.token);

    if (Number(contact.is_active ?? 1) === 0) {
      await shopify.disableCustomer(mapping.externalCustomerId);
      return { success: true, action: 'updated', shopifyCustomerId: mapping.externalCustomerId };
    }

    const payload = buildShopifyCustomerPayload(contact);
    if (!Object.keys(payload).length) {
      return { success: false, action: 'skipped', reason: 'Retail customer has no Shopify-syncable fields.', shopifyCustomerId: mapping.externalCustomerId };
    }

    await shopify.enableCustomer(mapping.externalCustomerId).catch(() => {});
    await shopify.updateCustomer(mapping.externalCustomerId, payload);
    return { success: true, action: 'updated', shopifyCustomerId: mapping.externalCustomerId };
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'shopify_customer_sync',
      operation: 'update_mapped_customer',
      title: 'Shopify customer sync failed',
      error,
      context: { channelInstanceId, contactId: contact.id },
      reference: { type: 'ims_contact', id: contact.id },
    }).catch(() => {});
    return {
      success: false,
      action: 'error',
      reason: scopeHint(error instanceof Error ? error.message : 'Shopify customer sync failed.'),
      shopifyCustomerId: mapping.externalCustomerId,
    };
  }
}

export async function syncRetailCustomerToMappedShopifyInstances(
  contact: SyncableContact,
  businessId: string,
): Promise<ShopifyCustomerSyncResult> {
  const mappings = await listContactChannelMappingsForContact({ businessId, contactId: contact.id });
  if (!mappings.length) {
    return { success: false, action: 'skipped', reason: 'Customer has no exact Shopify storefront mappings.', shopifyCustomerId: null };
  }
  const results = await Promise.all(mappings.map(mapping => syncRetailCustomerToShopify(contact, {
    businessId,
    channelInstanceId: mapping.channelInstanceId,
  })));
  const failed = results.filter(result => !result.success && result.action === 'error');
  if (failed.length) {
    return {
      success: false,
      action: 'error',
      reason: `${failed.length} of ${results.length} mapped Shopify storefront updates failed.`,
      shopifyCustomerId: failed[0].shopifyCustomerId,
    };
  }
  const synced = results.find(result => result.success);
  return synced ?? results[0];
}