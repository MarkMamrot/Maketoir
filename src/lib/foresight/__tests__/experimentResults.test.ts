import { describe, expect, it } from 'vitest';
import { assessExperimentResult } from '../experimentResults';
import type { ForesightCampaignExperimentDocument } from '../planning/campaignExperimentDocument';

const design = { primaryMetric: 'conversion_rate', minimumSamplePerVariant: 500,
  guardrails: [{ metric: 'unsubscribe_rate', maximumAdverseChangePercent: 20 }] } as ForesightCampaignExperimentDocument;
const observations = { source: 'klaviyo_export', observedFrom: '2026-08-10', observedThrough: '2026-08-16', qualityIssues: [],
  control: { sampleSize: 1000, conversions: 50, guardrailEvents: { unsubscribe_rate: 10 } },
  treatment: { sampleSize: 1000, conversions: 90, guardrailEvents: { unsubscribe_rate: 11 } } };

describe('experiment results', () => {
  it('finds a significant treatment lift under the predeclared two-sided test', () => {
    const result = assessExperimentResult(design, observations);
    expect(result).toMatchObject({ status: 'treatment_won', primaryMetric: 'conversion_rate', sample: { sufficient: true }, test: { method: 'two_proportion_z', confidenceLevel: 0.95 } });
    expect(Number(result.test.pValue)).toBeLessThan(0.05);
  });
  it('returns no significant difference when the variants are close', () => {
    expect(assessExperimentResult(design, { ...observations, treatment: { ...observations.treatment, conversions: 52 } }).status).toBe('no_significant_difference');
  });
  it('is inconclusive before testing when sample or quality is insufficient', () => {
    const result = assessExperimentResult(design, { ...observations, qualityIssues: ['variant assignment could not be verified'], treatment: { ...observations.treatment, sampleSize: 499 } });
    expect(result).toMatchObject({ status: 'inconclusive', controlValue: null, test: { method: null } });
  });
  it('gives a failed guardrail precedence over a significant treatment lift', () => {
    const result = assessExperimentResult(design, { ...observations, treatment: { ...observations.treatment, guardrailEvents: { unsubscribe_rate: 20 } } });
    expect(result.status).toBe('guardrail_failed');
  });
  it('uses Welch testing for per-session monetary metrics', () => {
    const monetary = { ...design, primaryMetric: 'revenue_per_session' } as ForesightCampaignExperimentDocument;
    const result = assessExperimentResult(monetary, { ...observations,
      control: { sampleSize: 1000, metricSum: 10_000, metricSumSquares: 120_000, guardrailEvents: { unsubscribe_rate: 10 } },
      treatment: { sampleSize: 1000, metricSum: 12_000, metricSumSquares: 164_000, guardrailEvents: { unsubscribe_rate: 11 } } });
    expect(result.test.method).toBe('welch_t'); expect(result.status).toBe('treatment_won');
  });
});