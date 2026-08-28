import { LoyaltyRepository } from '@/lib/ims/LoyaltyRepository';
import { LoyaltyService } from '@/lib/loyalty/LoyaltyService';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { getShopifyAdminCredentials } from '@/lib/shopifyCredentials';
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
  | { status: 'skipped'; contactId: number; reason: 'customer_not_found' | 'shopify_not_linked' | 'shopify_not_configured' }
  | { status: 'failed'; contactId: number; error: string };

export const ShopifyLoyaltyMetafieldService = {
  async syncConfiguredCustomer(input: {
    businessId: string;
    contactId: number;
  }): Promise<ShopifyLoyaltyMetafieldSyncResult> {
    try {
      const credentials = await getShopifyAdminCredentials(input.businessId);
      if (!credentials) {
        return { status: 'skipped', contactId: input.contactId, reason: 'shopify_not_configured' };
      }
      return this.syncCustomer({
        businessId: input.businessId,
        contactId: input.contactId,
        shopify: new ShopifyService(credentials.shopDomain, credentials.token),
      });
    } catch (error) {
      await reportRuntimeIssue({
        businessId: input.businessId,
        source: 'shopify_loyalty',
        operation: 'prepare_customer_metafield_sync',
        title: 'Shopify customer loyalty sync could not start',
        error,
        context: { contactId: input.contactId },
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
    shopify: ShopifyCustomerMetafieldClient;
  }): Promise<ShopifyLoyaltyMetafieldSyncResult> {
    try {
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
      const shopifyCustomerId = String(contact.shopify_customer_id ?? '').trim();
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
        context: { contactId: input.contactId },
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