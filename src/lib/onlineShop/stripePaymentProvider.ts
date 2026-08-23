import type Stripe from 'stripe';

import { getStripeClient } from '@/lib/onlineShop/stripeConnect';
import type { StorefrontPaymentProvider, StorefrontPaymentRequest, StorefrontPaymentSession } from '@/lib/storefront/payments';

export class StripeConnectPaymentProvider implements StorefrontPaymentProvider {
  readonly id = 'stripe';
  constructor(private readonly stripeAccountId: string) {}

  async createPayment(request: StorefrontPaymentRequest): Promise<StorefrontPaymentSession> {
    const intent = await getStripeClient().paymentIntents.create({ amount: request.amountMinor, currency: request.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true }, receipt_email: request.customerEmail,
      metadata: { businessId: request.businessId, checkoutId: request.checkoutId } },
    { stripeAccount: this.stripeAccountId, idempotencyKey: request.idempotencyKey });
    return { provider: this.id, providerPaymentId: intent.id, status: intent.status === 'succeeded' ? 'succeeded' : 'pending',
      clientSecret: intent.client_secret ?? undefined };
  }

  async parseWebhook(payload: Uint8Array, signature: string) {
    const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    if (!secret) throw new Error('Stripe Connect webhook secret is not configured.');
    const event = getStripeClient().webhooks.constructEvent(Buffer.from(payload), signature, secret);
    const intent = event.data.object as Stripe.PaymentIntent;
    const status = intent.status === 'succeeded' ? 'succeeded' : intent.status === 'canceled' ? 'cancelled'
      : intent.status === 'processing' ? 'processing' : intent.last_payment_error ? 'failed' : 'pending';
    return { provider: this.id, eventId: event.id, providerPaymentId: intent.id,
      checkoutId: intent.metadata.checkoutId ?? '', status, amountMinor: intent.amount, currency: intent.currency.toUpperCase() as 'AUD' };
  }

  async refund(providerPaymentId: string, amountMinor: number, idempotencyKey: string): Promise<StorefrontPaymentSession> {
    const refund = await getStripeClient().refunds.create({ payment_intent: providerPaymentId, amount: amountMinor },
      { stripeAccount: this.stripeAccountId, idempotencyKey });
    return { provider: this.id, providerPaymentId, status: refund.status === 'succeeded' ? 'refunded' : 'processing' };
  }
}