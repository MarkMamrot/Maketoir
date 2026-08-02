import { describe, expect, it } from 'vitest';
import { hashCreativeBrief, parseCreativeBriefDocument, renderCreativeBriefMarkdown } from '../creativeBrief';

const humanContext = { intendedAudience: 'Returning gift buyers', intendedMessage: 'Thoughtful gifts without guesswork',
  offer: 'No discount; free wrapping', offlineContext: 'Window display changes next week' };
const brief = {
  schemaVersion: 1, creativeId: 44, assessmentId: 9, diagnosticsThrough: '2026-08-01', title: 'Gift confidence refresh',
  hypothesis: 'Clear proof and gift context may improve qualified engagement.', audience: 'Returning gift buyers',
  singleMindedProposition: 'A thoughtful gift, chosen confidently.', proofPoints: ['Curated range', 'Free wrapping'], tone: ['Warm', 'Direct'],
  formats: [{ format: '4:5 image', placement: 'Meta feed', adaptationNotes: 'Keep proof above the fold.' }],
  variants: [{ id: 'control', change: 'Current product-led execution', rationale: 'Preserve baseline.' },
    { id: 'proof', change: 'Lead with free wrapping proof', rationale: 'Test confidence cue.' }],
  testMatrix: [{ variantId: 'control', comparison: 'Current execution', primaryMetric: 'platform CTR', guardrails: ['conversion rate'] },
    { variantId: 'proof', comparison: 'Single proof change', primaryMetric: 'platform CTR', guardrails: ['conversion rate'] }],
  exclusions: ['No urgency claim'], successMetric: 'Platform CTR with conversion-rate guardrail',
  stockOfferConstraints: ['Confirm gift range availability before use'], uncertainties: ['No causal result exists yet'], humanContext, publishable: false,
};

describe('creative brief contract', () => {
  it('freezes exact evidence identity and human context', () => {
    const parsed = parseCreativeBriefDocument(brief, { creativeId: 44, assessmentId: 9, diagnosticsThrough: '2026-08-01', humanContext });
    expect(hashCreativeBrief(parsed)).toMatch(/^[a-f0-9]{64}$/);
    expect(renderCreativeBriefMarkdown(parsed)).toContain('not publishable');
  });

  it('rejects publishable output, changed context, and unknown test variants', () => {
    expect(() => parseCreativeBriefDocument({ ...brief, publishable: true }, { creativeId: 44, assessmentId: 9, diagnosticsThrough: '2026-08-01', humanContext }))
      .toThrow('brief.publishable must be false');
    expect(() => parseCreativeBriefDocument({ ...brief, humanContext: { ...humanContext, offer: 'Invented discount' } }, { creativeId: 44, assessmentId: 9, diagnosticsThrough: '2026-08-01', humanContext }))
      .toThrow('must preserve the recorded human context exactly');
    expect(() => parseCreativeBriefDocument({ ...brief, testMatrix: [{ ...brief.testMatrix[0], variantId: 'unknown' }, brief.testMatrix[1]] }, { creativeId: 44, assessmentId: 9, diagnosticsThrough: '2026-08-01', humanContext }))
      .toThrow('must reference a declared variant');
  });
});
