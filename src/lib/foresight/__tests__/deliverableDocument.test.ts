import { describe, expect, it } from 'vitest';
import {
  ForesightDeliverableValidationError,
  hashForesightDeliverable,
  parseForesightDeliverableDocument,
  renderForesightDeliverableMarkdown,
} from '../planning/deliverableDocument';

const input = {
  schemaVersion: 1, title: 'Winter growth campaign', planVersionId: 41, planHash: 'a'.repeat(64),
  objective: 'Grow profitable revenue.', audience: ['Gift buyers'],
  productSelection: [{ name: 'Legami', rationale: 'Strong unit demand.', citationFactIds: ['fact-sales'] }],
  offerConstraints: ['No unapproved discount'], creativeDirection: ['Product-led photography'],
  assets: [{ id: 'meta-1', channel: 'meta', assetType: 'primary_text', title: 'Meta draft',
    content: 'Find a thoughtful gift.', publishable: false,
    claims: [{ text: 'Legami has strong demand.', citationFactIds: ['fact-sales'] }], reviewNotes: ['Confirm product availability'] }],
  trackingRequirements: ['Use campaign UTM parameters'], successMetrics: ['Contribution remains positive'],
  guardrails: ['Human approval and manual publishing required'], reviewDate: '2026-08-08', stopConditions: ['Stock becomes constrained'],
};
const expected = { planVersionId: 41, planHash: 'a'.repeat(64), knownFactIds: ['fact-sales'] };

describe('deliverableDocument', () => {
  it('parses, hashes, and renders a non-publishable cited package', () => {
    const document = parseForesightDeliverableDocument(input, expected);
    expect(hashForesightDeliverable(document)).toMatch(/^[a-f0-9]{64}$/);
    expect(renderForesightDeliverableMarkdown(document)).toContain('not publishable from Foresight');
  });

  it('rejects unknown factual claims and publishable assets', () => {
    expect(() => parseForesightDeliverableDocument({
      ...input,
      assets: [{ ...input.assets[0], publishable: true, claims: [{ text: 'Invented.', citationFactIds: ['invented'] }] }],
    }, expected)).toThrow(ForesightDeliverableValidationError);
  });
});