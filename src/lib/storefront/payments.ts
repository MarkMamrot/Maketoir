export type StorefrontPaymentStatus = 'pending' | 'requires_action' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'refunded';

export interface StorefrontPaymentRequest {
  businessId: string;
  checkoutId: string;
  amountMinor: number;
  currency: 'AUD';
  idempotencyKey: string;
  customerEmail: string;
}

export interface StorefrontPaymentSession {
  provider: string;
  providerPaymentId: string;
  status: StorefrontPaymentStatus;
  clientSecret?: string;
}

export interface StorefrontPaymentEvent {
  provider: string;
  eventId: string;
  providerPaymentId: string;
  checkoutId: string;
  status: StorefrontPaymentStatus;
  amountMinor: number;
  currency: 'AUD';
}

export interface StorefrontPaymentProvider {
  readonly id: string;
  createPayment(request: StorefrontPaymentRequest): Promise<StorefrontPaymentSession>;
  parseWebhook(payload: Uint8Array, signature: string): Promise<StorefrontPaymentEvent>;
  refund(providerPaymentId: string, amountMinor: number, idempotencyKey: string): Promise<StorefrontPaymentSession>;
}