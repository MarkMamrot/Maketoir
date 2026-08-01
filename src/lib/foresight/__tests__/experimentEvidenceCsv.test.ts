import { describe, expect, it } from 'vitest';
import { importExperimentEvidenceCsv } from '../experimentEvidenceCsv';

const design = { primaryMetric: 'conversion_rate', minimumSamplePerVariant: 500,
  guardrails: [{ metric: 'unsubscribe_rate', maximumAdverseChangePercent: 20 }] } as any;

describe('importExperimentEvidenceCsv', () => {
  it('maps quoted exact external IDs into variant observations', () => {
    const result = importExperimentEvidenceCsv({ csv: 'variant_id,sample_size,conversions,guardrail:unsubscribe_rate\n"control, campaign",1000,50,10\ntreatment-campaign,1000,90,11',
      design, controlExternalId: 'control, campaign', treatmentExternalId: 'treatment-campaign', observedFrom: '2026-08-10', observedThrough: '2026-08-16', source: 'verified_csv:results.csv' });
    expect(result).toMatchObject({ source: 'verified_csv:results.csv', control: { sampleSize: 1000, conversions: 50 }, treatment: { conversions: 90 } });
  });

  it('imports monetary sufficient statistics', () => {
    const monetary = { ...design, primaryMetric: 'revenue_per_session' };
    const result = importExperimentEvidenceCsv({ csv: 'variant_id,sample_size,metric_sum,metric_sum_squares,guardrail:unsubscribe_rate\ncontrol,500,25000,1500000,5\ntreatment,500,30000,2000000,6',
      design: monetary, controlExternalId: 'control', treatmentExternalId: 'treatment', observedFrom: '2026-08-10', observedThrough: '2026-08-16', source: 'verified_csv:money.csv' });
    expect(result.treatment).toMatchObject({ sampleSize: 500, metricSum: 30000, metricSumSquares: 2000000 });
  });

  it('rejects unknown variants and missing guardrails', () => {
    expect(() => importExperimentEvidenceCsv({ csv: 'variant_id,sample_size,conversions,guardrail:unsubscribe_rate\nwrong,1000,50,10\ntreatment,1000,90,11', design,
      controlExternalId: 'control', treatmentExternalId: 'treatment', observedFrom: '2026-08-10', observedThrough: '2026-08-16', source: 'verified_csv:file.csv' })).toThrow('exactly match');
    expect(() => importExperimentEvidenceCsv({ csv: 'variant_id,sample_size,conversions\ncontrol,1000,50\ntreatment,1000,90', design,
      controlExternalId: 'control', treatmentExternalId: 'treatment', observedFrom: '2026-08-10', observedThrough: '2026-08-16', source: 'verified_csv:file.csv' })).toThrow('guardrail:unsubscribe_rate');
  });
});