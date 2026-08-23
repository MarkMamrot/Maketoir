import { describe, expect, it } from 'vitest';
import { demandInsightsFromMetadata } from '../retention';

describe('prospect retention insights', () => {
  it('aggregates only bounded structured classifications without retaining a prompt', () => {
    const result = demandInsightsFromMetadata(JSON.stringify({
      requestedIntegration: ' 3PL fulfilment ', requestedProvider: 'Acme Logistics',
      unmetNeed: 'Split fulfilment', answer: 'private transcript content',
    }));
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ demandType: 'integration', requestedName: '3PL fulfilment', requestedProvider: 'Acme Logistics' });
    expect(JSON.stringify(result)).not.toContain('private transcript content');
    expect(result[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('ignores malformed and empty metadata', () => {
    expect(demandInsightsFromMetadata('{bad json')).toEqual([]);
    expect(demandInsightsFromMetadata({ requestedIntegration: 42 })).toEqual([]);
  });
});
