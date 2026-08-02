import { describe, expect, it } from 'vitest';
import { CreativeAssessmentValidationError, parseCreativeAssessment } from '../creativeAssessment';

const valid = {
  schemaVersion: 1,
  factualDescription: 'A product-led square ad with a short headline.',
  structuredTags: ['product-led', 'square'],
  brandFitObservations: ['The concise copy matches the configured direct tone.'],
  accessibilityIssues: ['Text contrast cannot be confirmed from metadata alone.'],
  compositionTraits: ['Single focal product'],
  formatTraits: ['Static square placement'],
  uncertainties: ['No image pixels were available.'],
  confidence: 0.62,
};

describe('parseCreativeAssessment', () => {
  it('accepts the bounded versioned assessment contract', () => {
    expect(parseCreativeAssessment(valid)).toEqual(valid);
  });

  it('rejects malformed, unbounded, or extra model output', () => {
    expect(() => parseCreativeAssessment({ ...valid, confidence: 2, extra: 'ignored?' }))
      .toThrow(CreativeAssessmentValidationError);
  });

  it('rejects unsupported protected-trait classifications', () => {
    expect(() => parseCreativeAssessment({ ...valid, structuredTags: ['ethnicity: inferred'] }))
      .toThrow('must not infer or classify protected traits');
    expect(() => parseCreativeAssessment({ ...valid, structuredTags: ['pregnant audience'] }))
      .toThrow('must not infer or classify protected traits');
  });

  it('requires arrays instead of trusting string-shaped model fields', () => {
    expect(() => parseCreativeAssessment({ ...valid, structuredTags: 'product-led, square' }))
      .toThrow('assessment.structuredTags must be an array');
  });
});
