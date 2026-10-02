import { describe, expect, it } from 'vitest';
import {
  buildKlaviyoContactIdentity,
  buildKlaviyoPlacedOrderEvents,
  parseKlaviyoIntegrationSettings,
} from '../contracts';

describe('Klaviyo contracts', () => {
  it('defaults every outbound capability to off', () => {
    expect(parseKlaviyoIntegrationSettings(null)).toEqual({
      enabled: false,
      profilesEnabled: false,
      reportingEnabled: false,
      sources: { pos: false, nativeShop: false, wholesale: false, shopify: false },
      shopifyDuplicateRiskAcknowledged: false,
    });
  });

  it('builds a stable consent-neutral customer identity', () => {
    expect(buildKlaviyoContactIdentity({
      businessId: 'business-1',
      contactId: 42,
      contactType: 'retail_customer',
      email: ' Customer@Example.com ',
      mobile: '0412 345 678',
    })).toEqual({
      eligible: true,
      reason: 'eligible',
      profile: {
        externalId: 'solvantis:business-1:contact:42',
        email: 'customer@example.com',
        phoneNumber: '+61412345678',
      },
    });
  });

  it('excludes suppliers and leads from profile synchronization', () => {
    expect(buildKlaviyoContactIdentity({
      businessId: 'business-1', contactId: 42, contactType: 'supplier', email: 'supplier@example.com',
    })).toEqual({ eligible: false, reason: 'unsupported_contact_type', profile: null });
  });

  it('builds deterministic tax-inclusive order and line events', () => {
    const events = buildKlaviyoPlacedOrderEvents({
      profile: { externalId: 'solvantis:business-1:contact:42' },
      source: 'pos',
      orderId: '100',
      occurredAt: '2026-10-02T01:02:03.000Z',
      totalValue: 109.95,
      locationId: 3,
      backfill: false,
      lines: [{
        lineId: '501', productId: '20', variantId: '21', sku: 'SKU-1', productName: 'Example',
        quantity: 2, unitPrice: 54.975, lineValue: 109.95,
      }],
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      metricName: 'Placed Order',
      uniqueId: 'pos:order:100:placed:v1',
      value: 109.95,
      valueCurrency: 'AUD',
      backfill: false,
      properties: { OrderId: '100', Source: 'pos', LocationId: '3', ItemCount: 2 },
    });
    expect(events[1]).toMatchObject({
      metricName: 'Ordered Product',
      uniqueId: 'pos:order:100:line:501:v1',
      value: 109.95,
      properties: { LineId: '501', ProductId: '20', VariantId: '21', SKU: 'SKU-1', Quantity: 2 },
    });
  });
});