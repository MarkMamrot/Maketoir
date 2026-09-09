import { describe, expect, it } from 'vitest';

import { AusPostApiError } from '../carriers/auspostEparcel/client';
import { isDefinitiveManifestFailure, manifestExistingOperationAction } from '../shippingManifests';

describe('shipping manifests', () => {
  it('only releases shipments after a definitive carrier rejection', () => {
    expect(isDefinitiveManifestFailure(new AusPostApiError('Invalid shipment.', 400, []))).toBe(true);
    expect(isDefinitiveManifestFailure(new AusPostApiError('Not found.', 404, []))).toBe(true);
    expect(isDefinitiveManifestFailure(new Error('Carrier account credentials are incomplete.'))).toBe(true);
  });

  it('requires reconciliation after ambiguous carrier outcomes', () => {
    expect(isDefinitiveManifestFailure(new Error('fetch failed'))).toBe(false);
    expect(isDefinitiveManifestFailure(new AusPostApiError('Timed out.', 408, []))).toBe(false);
    expect(isDefinitiveManifestFailure(new AusPostApiError('Conflict.', 409, []))).toBe(false);
    expect(isDefinitiveManifestFailure(new AusPostApiError('Throttled.', 429, []))).toBe(false);
    expect(isDefinitiveManifestFailure(new AusPostApiError('Unavailable.', 503, []))).toBe(false);
  });

  it('never repeats an in-progress or unknown carrier booking', () => {
    expect(manifestExistingOperationAction('complete')).toBe('return');
    expect(manifestExistingOperationAction('failed')).toBe('retry');
    expect(manifestExistingOperationAction('submitting')).toBe('block');
    expect(manifestExistingOperationAction('submission_unknown')).toBe('reconcile');
  });
});
