import Stripe from 'stripe';

import { execute, query } from '@/services/MySQLService';

export interface OnlineShopStripeConnection {
  businessId: string;
  stripeAccountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

interface StripeConnectionRow {
  business_id: string; stripe_account_id: string; charges_enabled: number; payouts_enabled: number; details_submitted: number;
}

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe is not configured for this deployment.');
  return new Stripe(key);
}

function mapConnection(row: StripeConnectionRow): OnlineShopStripeConnection {
  return { businessId: row.business_id, stripeAccountId: row.stripe_account_id, chargesEnabled: row.charges_enabled === 1,
    payoutsEnabled: row.payouts_enabled === 1, detailsSubmitted: row.details_submitted === 1 };
}

export const OnlineShopStripeConnectionRepository = {
  async get(businessId: string): Promise<OnlineShopStripeConnection | null> {
    const rows = await query<StripeConnectionRow>('SELECT business_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted FROM online_shop_stripe_connections WHERE business_id = ? LIMIT 1', [businessId]);
    return rows[0] ? mapConnection(rows[0]) : null;
  },
  async getReady(businessId: string): Promise<OnlineShopStripeConnection> {
    const connection = await this.get(businessId);
    if (!connection?.chargesEnabled || !connection.detailsSubmitted) throw new Error('This store is not ready to accept Stripe payments.');
    return connection;
  },
  async getByAccountId(accountId: string): Promise<OnlineShopStripeConnection | null> {
    const rows = await query<StripeConnectionRow>('SELECT business_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted FROM online_shop_stripe_connections WHERE stripe_account_id = ? LIMIT 1', [accountId]);
    return rows[0] ? mapConnection(rows[0]) : null;
  },
  async saveAccount(businessId: string, account: Stripe.Account, userId: number): Promise<void> {
    await execute(
      `INSERT INTO online_shop_stripe_connections
         (business_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted, connected_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE stripe_account_id = VALUES(stripe_account_id), charges_enabled = VALUES(charges_enabled),
         payouts_enabled = VALUES(payouts_enabled), details_submitted = VALUES(details_submitted),
         connected_by_user_id = VALUES(connected_by_user_id), connected_at = CURRENT_TIMESTAMP(3)`,
      [businessId, account.id, account.charges_enabled ? 1 : 0, account.payouts_enabled ? 1 : 0, account.details_submitted ? 1 : 0, userId],
    );
  },
  async remove(businessId: string): Promise<void> { await execute('DELETE FROM online_shop_stripe_connections WHERE business_id = ?', [businessId]); },
};

export function stripeConnectConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_CONNECT_CLIENT_ID);
}

export function buildStripeConnectUrl(state: string): string {
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!clientId) throw new Error('Stripe Connect client ID is not configured.');
  const url = new URL('https://connect.stripe.com/oauth/authorize');
  url.searchParams.set('response_type', 'code'); url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', 'read_write'); url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeStripeConnectCode(code: string): Promise<Stripe.Account> {
  const response = await stripeClient().oauth.token({ grant_type: 'authorization_code', code });
  if (!response.stripe_user_id) throw new Error('Stripe did not return a connected account.');
  return stripeClient().accounts.retrieve(response.stripe_user_id);
}

export function getStripeClient(): Stripe { return stripeClient(); }