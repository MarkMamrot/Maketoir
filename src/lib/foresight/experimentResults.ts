import { jStat } from 'jstat';
import type { ForesightCampaignExperimentDocument } from './planning/campaignExperimentDocument';

export interface ExperimentVariantObservation {
  sampleSize: number;
  conversions?: number;
  metricSum?: number;
  metricSumSquares?: number;
  guardrailEvents: Record<string, number>;
}

export interface ExperimentObservationPackage {
  source: string;
  observedFrom: string;
  observedThrough: string;
  qualityIssues: string[];
  control: ExperimentVariantObservation;
  treatment: ExperimentVariantObservation;
}

export type ExperimentResultStatus = 'treatment_won' | 'control_won' | 'no_significant_difference' | 'guardrail_failed' | 'inconclusive';

export interface ExperimentResultAssessment {
  status: ExperimentResultStatus;
  primaryMetric: ForesightCampaignExperimentDocument['primaryMetric'];
  controlValue: number | null;
  treatmentValue: number | null;
  absoluteDifference: number | null;
  relativeLiftPercent: number | null;
  test: { method: 'two_proportion_z' | 'welch_t' | null; statistic: number | null; degreesOfFreedom: number | null; pValue: number | null; confidenceLevel: 0.95 };
  sample: { control: number; treatment: number; minimumPerVariant: number; sufficient: boolean };
  guardrails: Array<{ metric: string; controlRate: number; treatmentRate: number; adverseChangePercent: number | null; maximumAdverseChangePercent: number; passed: boolean }>;
  qualityIssues: string[];
  explanation: string;
}

export class ExperimentResultValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ExperimentResultValidationError'; }
}

function finite(value: unknown, path: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new ExperimentResultValidationError(`${path} must be finite.`);
  return result;
}

function count(value: unknown, path: string): number {
  const result = finite(value, path);
  if (!Number.isInteger(result) || result < 0) throw new ExperimentResultValidationError(`${path} must be a non-negative integer.`);
  return result;
}

function validateVariant(variant: ExperimentVariantObservation, path: string, metric: ForesightCampaignExperimentDocument['primaryMetric']): ExperimentVariantObservation {
  const sampleSize = count(variant.sampleSize, `${path}.sampleSize`);
  const guardrailEvents = Object.fromEntries(Object.entries(variant.guardrailEvents ?? {}).map(([key, value]) => {
    const events = count(value, `${path}.guardrailEvents.${key}`);
    if (events > sampleSize) throw new ExperimentResultValidationError(`${path}.guardrailEvents.${key} cannot exceed sampleSize.`);
    return [key, events];
  }));
  if (metric === 'conversion_rate') {
    const conversions = count(variant.conversions, `${path}.conversions`);
    if (conversions > sampleSize) throw new ExperimentResultValidationError(`${path}.conversions cannot exceed sampleSize.`);
    return { sampleSize, conversions, guardrailEvents };
  }
  const metricSum = finite(variant.metricSum, `${path}.metricSum`);
  const metricSumSquares = finite(variant.metricSumSquares, `${path}.metricSumSquares`);
  if (metricSumSquares < 0 || (sampleSize > 0 && metricSumSquares + 1e-9 < (metricSum * metricSum) / sampleSize)) {
    throw new ExperimentResultValidationError(`${path}.metricSumSquares is inconsistent with metricSum and sampleSize.`);
  }
  return { sampleSize, metricSum, metricSumSquares, guardrailEvents };
}

function relativeLift(control: number, treatment: number): number | null {
  return Math.abs(control) > 1e-12 ? ((treatment - control) / Math.abs(control)) * 100 : null;
}

function conversionTest(control: ExperimentVariantObservation, treatment: ExperimentVariantObservation) {
  const controlValue = Number(control.conversions) / control.sampleSize;
  const treatmentValue = Number(treatment.conversions) / treatment.sampleSize;
  const pooled = (Number(control.conversions) + Number(treatment.conversions)) / (control.sampleSize + treatment.sampleSize);
  const standardError = Math.sqrt(pooled * (1 - pooled) * ((1 / control.sampleSize) + (1 / treatment.sampleSize)));
  const statistic = standardError > 0 ? (treatmentValue - controlValue) / standardError : 0;
  return { controlValue, treatmentValue, statistic, degreesOfFreedom: null, pValue: standardError > 0 ? 2 * (1 - jStat.normal.cdf(Math.abs(statistic), 0, 1)) : 1, method: 'two_proportion_z' as const };
}

function continuousTest(control: ExperimentVariantObservation, treatment: ExperimentVariantObservation) {
  const controlValue = Number(control.metricSum) / control.sampleSize;
  const treatmentValue = Number(treatment.metricSum) / treatment.sampleSize;
  const controlVariance = Math.max(0, (Number(control.metricSumSquares) - (Number(control.metricSum) ** 2) / control.sampleSize) / (control.sampleSize - 1));
  const treatmentVariance = Math.max(0, (Number(treatment.metricSumSquares) - (Number(treatment.metricSum) ** 2) / treatment.sampleSize) / (treatment.sampleSize - 1));
  const controlTerm = controlVariance / control.sampleSize;
  const treatmentTerm = treatmentVariance / treatment.sampleSize;
  const standardError = Math.sqrt(controlTerm + treatmentTerm);
  const degreesOfFreedom = standardError > 0
    ? ((controlTerm + treatmentTerm) ** 2) / ((controlTerm ** 2) / (control.sampleSize - 1) + (treatmentTerm ** 2) / (treatment.sampleSize - 1))
    : control.sampleSize + treatment.sampleSize - 2;
  const statistic = standardError > 0 ? (treatmentValue - controlValue) / standardError : 0;
  return { controlValue, treatmentValue, statistic, degreesOfFreedom, pValue: standardError > 0 ? 2 * (1 - jStat.studentt.cdf(Math.abs(statistic), degreesOfFreedom)) : 1, method: 'welch_t' as const };
}

export function assessExperimentResult(design: ForesightCampaignExperimentDocument, observations: ExperimentObservationPackage): ExperimentResultAssessment {
  const control = validateVariant(observations.control, 'control', design.primaryMetric);
  const treatment = validateVariant(observations.treatment, 'treatment', design.primaryMetric);
  const sampleSufficient = control.sampleSize >= design.minimumSamplePerVariant && treatment.sampleSize >= design.minimumSamplePerVariant;
  const guardrails = design.guardrails.map((guardrail) => {
    if (!(guardrail.metric in control.guardrailEvents) || !(guardrail.metric in treatment.guardrailEvents)) throw new ExperimentResultValidationError(`Missing guardrail observations for ${guardrail.metric}.`);
    const controlRate = control.guardrailEvents[guardrail.metric] / Math.max(control.sampleSize, 1);
    const treatmentRate = treatment.guardrailEvents[guardrail.metric] / Math.max(treatment.sampleSize, 1);
    const adverseChangePercent = controlRate > 0 ? ((treatmentRate - controlRate) / controlRate) * 100 : treatmentRate > 0 ? null : 0;
    const passed = treatmentRate <= controlRate || (adverseChangePercent != null && adverseChangePercent <= guardrail.maximumAdverseChangePercent);
    return { metric: guardrail.metric, controlRate, treatmentRate, adverseChangePercent, maximumAdverseChangePercent: guardrail.maximumAdverseChangePercent, passed };
  });
  const base = { primaryMetric: design.primaryMetric, sample: { control: control.sampleSize, treatment: treatment.sampleSize, minimumPerVariant: design.minimumSamplePerVariant, sufficient: sampleSufficient }, guardrails, qualityIssues: [...new Set(observations.qualityIssues.map((issue) => issue.trim()).filter(Boolean))] };
  if (!sampleSufficient || base.qualityIssues.length > 0 || control.sampleSize < 2 || treatment.sampleSize < 2) {
    return { ...base, status: 'inconclusive', controlValue: null, treatmentValue: null, absoluteDifference: null, relativeLiftPercent: null,
      test: { method: null, statistic: null, degreesOfFreedom: null, pValue: null, confidenceLevel: 0.95 },
      explanation: base.qualityIssues.length > 0 ? 'The declared experiment evidence has quality issues, so the result is inconclusive.' : 'The predeclared minimum sample was not reached for both variants, so the result is inconclusive.' };
  }
  const result = design.primaryMetric === 'conversion_rate' ? conversionTest(control, treatment) : continuousTest(control, treatment);
  const absoluteDifference = result.treatmentValue - result.controlValue;
  const lift = relativeLift(result.controlValue, result.treatmentValue);
  const guardrailFailed = guardrails.some((guardrail) => !guardrail.passed);
  const significant = result.pValue < 0.05;
  const status: ExperimentResultStatus = guardrailFailed ? 'guardrail_failed' : !significant ? 'no_significant_difference' : absoluteDifference > 0 ? 'treatment_won' : 'control_won';
  const explanation = guardrailFailed
    ? 'At least one predeclared guardrail exceeded its accepted adverse-change limit, so the treatment is not considered a winner.'
    : !significant
      ? 'The exact randomized variants did not differ significantly under the predeclared two-sided 95% test.'
      : `${absoluteDifference > 0 ? 'Treatment' : 'Control'} performed better under the predeclared two-sided 95% test for the attested randomized experiment.`;
  return { ...base, status, controlValue: result.controlValue, treatmentValue: result.treatmentValue, absoluteDifference, relativeLiftPercent: lift,
    test: { method: result.method, statistic: result.statistic, degreesOfFreedom: result.degreesOfFreedom, pValue: result.pValue, confidenceLevel: 0.95 }, explanation };
}