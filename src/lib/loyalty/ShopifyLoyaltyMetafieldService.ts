import { LoyaltyRepository } from '@/lib/ims/LoyaltyRepository';
import { getShopifyOperationContext } from '@/lib/channels/shopifyOperationContext';
import { listContactChannelMappingsForContact } from '@/lib/ims/contactChannelMappings';
import { LoyaltyService } from '@/lib/loyalty/LoyaltyService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';
import { ShopifyService } from '@/services/ShopifyService';

export interface ShopifyCustomerMetafieldClient {
  setCustomerMetafields(
    shopifyCustomerId: string,
    metafields: Array<{ namespace: string; key: string; type: string; value: string }>,
  ): Promise<void>;
}

export type ShopifyLoyaltyMetafieldSyncResult =
  | { status: 'synced'; contactId: number; shopifyCustomerId: string; balancePoints: number }
  | { status: 'skipped'; contactId: number; reason: 'customer_not_found' | 'shopify_not_linked' | 'shopify_instance_ambiguous' }
  | { status: 'failed'; contactId: number; error: string };

export const ShopifyLoyaltyMetafieldService = {
  async syncConfiguredCustomer(input: {
    businessId: string;
    contactId: number;
    channelInstanceId?: string;
  }): Promise<ShopifyLoyaltyMetafieldSyncResult> {
    try {
      let channelInstanceId = input.channelInstanceId?.trim() || '';
      if (!channelInstanceId) {
        const mappings = await listContactChannelMappingsForContact({
          businessId: input.businessId,
          contactId: input.contactId,
        });
        if (!mappings.length) return { status: 'skipped', contactId: input.contactId, reason: 'shopify_not_linked' };
        if (mappings.length > 1) return { status: 'skipped', contactId: input.contactId, reason: 'shopify_instance_ambiguous' };
        channelInstanceId = mappings[0].channelInstanceId;
      }
      const context = await getShopifyOperationContext({ businessId: input.businessId, channelInstanceId });
      return this.syncCustomer({
        businessId: input.businessId,
        channelInstanceId,
        contactId: input.contactId,
        shopify: new ShopifyService(context.credentials.shopDomain, context.credentials.token),
      });
    } catch (error) {
      await reportRuntimeIssue({
        businessId: input.businessId,
        source: 'shopify_loyalty',
        operation: 'prepare_customer_metafield_sync',
        title: 'Shopify customer loyalty sync could not start',
        error,
        context: { contactId: input.contactId, channelInstanceId: input.channelInstanceId ?? null },
        reference: { type: 'ims_contact', id: input.contactId },
      });
      return {
        status: 'failed',
        contactId: input.contactId,
        error: error instanceof Error ? error.message : 'Shopify loyalty metafield sync could not start.',
      };
    }
  },

  async syncCustomer(input: {
    businessId: string;
    contactId: number;
    channelInstanceId?: string;
    shopify: ShopifyCustomerMetafieldClient;
  }): Promise<ShopifyLoyaltyMetafieldSyncResult> {
    try {
      let exactCustomerId: string | null = null;
      if (input.channelInstanceId) {
        const mappings = await imsQuery<{ external_customer_id: string }>(
          `SELECT external_customer_id FROM ims_contact_channel_mappings
            WHERE business_id = ? AND channel_instance_id = ? AND contact_id = ?
              AND mapping_status = 'linked' LIMIT 1`,
          [input.businessId, input.channelInstanceId, input.contactId],
        );
        exactCustomerId = String(mappings[0]?.external_customer_id ?? '').trim() || null;
        if (!exactCustomerId) {
          return { status: 'skipped', contactId: input.contactId, reason: 'shopify_not_linked' };
        }
      }
      const contacts = await imsQuery<{
        id: number;
        loyalty_member: number;
        shopify_customer_id: string | null;
      }>(
        `SELECT id, loyalty_member, shopify_customer_id
           FROM ims_contacts
          WHERE id = ? AND business_id = ? AND is_active = 1
            AND type IN ('retail_customer','b2b_customer','both')
          LIMIT 1`,
        [input.contactId, input.businessId],
      );
      const contact = contacts[0];
      if (!contact) return { status: 'skipped', contactId: input.contactId, reason: 'customer_not_found' };
      const shopifyCustomerId = exactCustomerId ?? String(contact.shopify_customer_id ?? '').trim();
      if (!shopifyCustomerId) return { status: 'skipped', contactId: input.contactId, reason: 'shopify_not_linked' };

      const member = Boolean(contact.loyalty_member);
      const settings = await LoyaltyService.getSettings(input.businessId);
      const active = settings.enabled && (!settings.startedAt || new Date().toISOString().slice(0, 10) >= settings.startedAt);
      const [account, rewards] = member
        ? await Promise.all([
            LoyaltyRepository.getAccount(input.businessId, input.contactId),
            active ? LoyaltyRepository.listRewards(input.businessId) : Promise.resolve([]),
          ])
        : [null, []];
      const balancePoints = account?.balancePoints ?? 0;
      const rewardPayload = rewards.map(reward => ({
        rewardId: reward.id,
        code: reward.rewardCode,
        name: reward.displayName,
        pointsCost: reward.pointsCost,
        valueAud: reward.valueAud,
      }));

      await input.shopify.setCustomerMetafields(shopifyCustomerId, [
        { namespace: 'solvantis_loyalty', key: 'member', type: 'boolean', value: member ? 'true' : 'false' },
        { namespace: 'solvantis_loyalty', key: 'program_active', type: 'boolean', value: active ? 'true' : 'false' },
        { namespace: 'solvantis_loyalty', key: 'balance_points', type: 'number_integer', value: String(balancePoints) },
        { namespace: 'solvantis_loyalty', key: 'program_name', type: 'single_line_text_field', value: settings.programName },
        { namespace: 'solvantis_loyalty', key: 'points_label', type: 'single_line_text_field', value: settings.pointsLabel },
        { namespace: 'solvantis_loyalty', key: 'rewards', type: 'json', value: JSON.stringify(rewardPayload) },
        { namespace: 'solvantis_loyalty', key: 'updated_at', type: 'date_time', value: new Date().toISOString() },
      ]);
      return { status: 'synced', contactId: input.contactId, shopifyCustomerId, balancePoints };
    } catch (error) {
      await reportRuntimeIssue({
        businessId: input.businessId,
        source: 'shopify_loyalty',
        operation: 'sync_customer_metafields',
        title: 'Shopify customer loyalty metafield sync failed',
        error,
        context: { contactId: input.contactId, channelInstanceId: input.channelInstanceId ?? null },
        reference: { type: 'ims_contact', id: input.contactId },
      });
      return {
        status: 'failed',
        contactId: input.contactId,
        error: error instanceof Error ? error.message : 'Shopify loyalty metafield sync failed.',
      };
    }
  },
};