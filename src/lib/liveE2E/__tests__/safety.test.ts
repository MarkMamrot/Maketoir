import { describe, expect, it } from 'vitest';

import { assertLiveShopifyOwnership, assertPreflightIdentity, LIVE_CONFIRMATION, loadLiveE2EConfig, redactLiveE2EValue } from '../safety';

const validEnv: NodeJS.ProcessEnv = {
  LIVE_E2E_CONFIRM: LIVE_CONFIRMATION,
  LIVE_E2E_ACTION: 'preflight',
  LIVE_E2E_BASE_URL: 'http://localhost:3000',
  LIVE_E2E_EXPECTED_BUSINESS_ID: 'monsterthreads-business',
  LIVE_E2E_EXPECTED_IMS_SCHEMA: 'readyedu_MonsterthreadsIMS',
  LIVE_E2E_EXPECTED_COSTING_METHOD: 'average_cost',
  LIVE_E2E_EXPECTED_SHOPIFY_SHOP: 'monsterthreads.example.myshopify.com',
  LIVE_E2E_EXPECTED_XERO_TENANT_ID: 'xero-tenant',
  LIVE_E2E_ADMIN_EMAIL: 'operator@example.com',
  LIVE_E2E_ADMIN_PASSWORD: 'not-persisted',
  LIVE_E2E_RUN_ID: 'mt-20260812-001',
  LIVE_E2E_FIXTURE_VARIANT_ID: 'variant-1',
  LIVE_E2E_FIXTURE_SKU: 'E2E-MT-ONLY',
  LIVE_E2E_FIXTURE_LOCATION_ID: '91',
  LIVE_E2E_FIXTURE_SUPPLIER_ID: '92',
  LIVE_E2E_FIXTURE_CUSTOMER_ID: '93',
  LIVE_E2E_MAX_DOCUMENT_TOTAL: '1.00',
};

describe('live E2E safety contract', () => {
  it('blocks unless the exact live confirmation is present', () => {
    expect(() => loadLiveE2EConfig({ ...validEnv, LIVE_E2E_CONFIRM: 'yes' })).toThrow('LIVE_E2E_CONFIRM');
  });

  it('blocks CI and non-local browser targets', () => {
    expect(() => loadLiveE2EConfig({ ...validEnv, CI: 'true' })).toThrow('CI execution is forbidden');
    expect(() => loadLiveE2EConfig({ ...validEnv, LIVE_E2E_BASE_URL: 'https://solvantis.com.au' })).toThrow('local application server');
  });

  it('requires every external identity even for read-only preflight', () => {
    expect(() => loadLiveE2EConfig({ ...validEnv, LIVE_E2E_EXPECTED_XERO_TENANT_ID: '' })).toThrow('LIVE_E2E_EXPECTED_XERO_TENANT_ID');
  });

  it('requires an explicit supported costing method', () => {
    expect(loadLiveE2EConfig({ ...validEnv, LIVE_E2E_EXPECTED_COSTING_METHOD: 'fifo' }).expectedCostingMethod).toBe('fifo');
    expect(() => loadLiveE2EConfig({ ...validEnv, LIVE_E2E_EXPECTED_COSTING_METHOD: '' })).toThrow('LIVE_E2E_EXPECTED_COSTING_METHOD');
    expect(() => loadLiveE2EConfig({ ...validEnv, LIVE_E2E_EXPECTED_COSTING_METHOD: 'lifo' })).toThrow('average_cost or fifo');
  });

  it('allows only explicit scenario stages', () => {
    expect(loadLiveE2EConfig({ ...validEnv, LIVE_E2E_ACTION: 'fifo-reconcile-negative' }).action).toBe('fifo-reconcile-negative');
    expect(loadLiveE2EConfig({ ...validEnv, LIVE_E2E_ACTION: 'fifo-activate' }).action).toBe('fifo-activate');
    expect(loadLiveE2EConfig({ ...validEnv, LIVE_E2E_ACTION: 'p9' }).action).toBe('p9');
    expect(loadLiveE2EConfig({ ...validEnv, LIVE_E2E_ACTION: 'p9-compensate' }).action).toBe('p9-compensate');
    expect(loadLiveE2EConfig({ ...validEnv, LIVE_E2E_ACTION: 'p1' }).action).toBe('p1');
    expect(loadLiveE2EConfig({ ...validEnv, LIVE_E2E_ACTION: 'p1-compensate' }).action).toBe('p1-compensate');
    expect(() => loadLiveE2EConfig({ ...validEnv, LIVE_E2E_ACTION: 'run-everything' })).toThrow('unsupported action');
  });

  it('requires safe fixture IDs, run IDs, and a low document cap', () => {
    expect(() => loadLiveE2EConfig({ ...validEnv, LIVE_E2E_RUN_ID: '../unsafe' })).toThrow('safe filename');
    expect(() => loadLiveE2EConfig({ ...validEnv, LIVE_E2E_FIXTURE_LOCATION_ID: '0' })).toThrow('positive number');
    expect(() => loadLiveE2EConfig({ ...validEnv, LIVE_E2E_MAX_DOCUMENT_TOTAL: '5.01' })).toThrow('cannot exceed');
  });

  it('accepts only the expected Admin business identity', () => {
    const config = loadLiveE2EConfig(validEnv);
    expect(() => assertPreflightIdentity(config, { businessId: 'other', tier: 'Admin' })).toThrow('expected business ID');
    expect(() => assertPreflightIdentity(config, { businessId: 'monsterthreads-business', tier: 'Advisor' })).toThrow('Admin or SuperAdmin');
    expect(() => assertPreflightIdentity(config, { businessId: 'monsterthreads-business', tier: 'Admin' })).not.toThrow();
  });

  it('redacts secrets recursively before manifest persistence', () => {
    expect(redactLiveE2EValue({ password: 'p', nested: { accessToken: 't', documentId: 41 } })).toEqual({
      password: '[REDACTED]',
      nested: { accessToken: '[REDACTED]', documentId: 41 },
    });
  });

  it('accepts only consistent canonical and legacy test-store ownership', () => {
    const config = loadLiveE2EConfig(validEnv);
    const instance = {
      business_id: config.expectedBusinessId,
      provider: 'shopify',
      external_account_key: config.expectedShopifyShop,
      is_enabled: 1,
      runtime_status: 'active',
      readiness_status: 'ready',
    };
    expect(() => assertLiveShopifyOwnership(config, config.expectedShopifyShop.toUpperCase(), [instance])).not.toThrow();
    expect(() => assertLiveShopifyOwnership(config, 'other.myshopify.com', [instance])).toThrow('legacy Shopify');
    expect(() => assertLiveShopifyOwnership(config, config.expectedShopifyShop, [])).toThrow('exactly one canonical owner');
    expect(() => assertLiveShopifyOwnership(config, config.expectedShopifyShop, [instance, instance])).toThrow('exactly one canonical owner');
    expect(() => assertLiveShopifyOwnership(config, config.expectedShopifyShop, [{ ...instance, business_id: 'other' }])).toThrow('expected sandbox');
    for (const change of [{ is_enabled: 0 }, { runtime_status: 'paused' }, { readiness_status: 'setup_pending' }]) {
      expect(() => assertLiveShopifyOwnership(config, config.expectedShopifyShop, [{ ...instance, ...change }])).toThrow('enabled, active and ready');
    }
  });
});