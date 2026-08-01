import { assessExperimentResult, type ExperimentObservationPackage, type ExperimentVariantObservation } from './experimentResults';
import type { ForesightCampaignExperimentDocument } from './planning/campaignExperimentDocument';

export class ExperimentEvidenceCsvError extends Error {
  constructor(message: string) { super(message); this.name = 'ExperimentEvidenceCsvError'; }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(cell.trim()); cell = ''; }
    else if (character === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else if (character !== '\r') cell += character;
  }
  if (quoted) throw new ExperimentEvidenceCsvError('CSV contains an unterminated quoted field.');
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows.filter((item) => item.some(Boolean));
}

function nonNegativeNumber(value: string | undefined, column: string, integer = false): number {
  const parsed = Number(value);
  if (value == null || value === '' || !Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed))) {
    throw new ExperimentEvidenceCsvError(`${column} must be a non-negative${integer ? ' integer' : ''}.`);
  }
  return parsed;
}

export function importExperimentEvidenceCsv(input: {
  csv: string;
  design: ForesightCampaignExperimentDocument;
  controlExternalId: string;
  treatmentExternalId: string;
  observedFrom: string;
  observedThrough: string;
  source: string;
}): ExperimentObservationPackage {
  if (input.csv.length > 100_000) throw new ExperimentEvidenceCsvError('CSV must be 100 KB or smaller.');
  const rows = parseCsv(input.csv.replace(/^\uFEFF/, ''));
  if (rows.length !== 3) throw new ExperimentEvidenceCsvError('CSV must contain one header row and exactly two variant rows.');
  const headers = rows[0].map((header) => header.toLowerCase());
  if (new Set(headers).size !== headers.length) throw new ExperimentEvidenceCsvError('CSV headers must be unique.');
  const required = ['variant_id', 'sample_size'];
  if (input.design.primaryMetric === 'conversion_rate') required.push('conversions');
  else required.push('metric_sum', 'metric_sum_squares');
  required.push(...input.design.guardrails.map((guardrail) => `guardrail:${guardrail.metric}`));
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length > 0) throw new ExperimentEvidenceCsvError(`CSV is missing required columns: ${missing.join(', ')}.`);
  const records = rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
  const byId = new Map(records.map((record) => [record.variant_id, record]));
  if (byId.size !== 2 || !byId.has(input.controlExternalId) || !byId.has(input.treatmentExternalId)) {
    throw new ExperimentEvidenceCsvError('Variant rows must exactly match the attested control and treatment external IDs.');
  }
  const variant = (externalId: string): ExperimentVariantObservation => {
    const record = byId.get(externalId) as Record<string, string>;
    const result: ExperimentVariantObservation = {
      sampleSize: nonNegativeNumber(record.sample_size, 'sample_size', true),
      guardrailEvents: Object.fromEntries(input.design.guardrails.map((guardrail) => [guardrail.metric,
        nonNegativeNumber(record[`guardrail:${guardrail.metric}`], `guardrail:${guardrail.metric}`, true)])),
    };
    if (input.design.primaryMetric === 'conversion_rate') result.conversions = nonNegativeNumber(record.conversions, 'conversions', true);
    else {
      result.metricSum = nonNegativeNumber(record.metric_sum, 'metric_sum');
      result.metricSumSquares = nonNegativeNumber(record.metric_sum_squares, 'metric_sum_squares');
    }
    return result;
  };
  const observations: ExperimentObservationPackage = {
    source: input.source,
    observedFrom: input.observedFrom,
    observedThrough: input.observedThrough,
    qualityIssues: [],
    control: variant(input.controlExternalId),
    treatment: variant(input.treatmentExternalId),
  };
  assessExperimentResult(input.design, observations);
  return observations;
}