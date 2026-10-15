import { describe, expect, it } from 'vitest';
import { normalizeAusPostArticleTracking } from '../tracking';

const now = new Date('2026-10-15T00:00:00Z');
function response(description = 'Delivered', date = '2025-09-01T10:00:00+10:00', status = 'Delivered') {
  return { tracking_results: [{ tracking_id: 'ARTICLE1', status: 'Delivered', trackable_items: [{
    article_id: 'ARTICLE1', status, events: [{ description, date, location: 'PRIVATE LOCATION', recipient: 'PRIVATE BUYER' }],
  }] }] };
}

describe('official Australia Post article tracking normalization', () => {
  it.each(['Delivered', 'Delivered - Left in a safe place', 'Item Delivered'])('accepts a matched article and recognized original delivery event (%s)', description => {
    expect(normalizeAusPostArticleTracking(response(description), ['ARTICLE1'], now)).toEqual([{
      articleId: 'ARTICLE1', outcome: 'delivered', deliveredAt: '2025-09-01T00:00:00.000Z', errorCode: null,
    }]);
    expect(JSON.stringify(normalizeAusPostArticleTracking(response(description), ['ARTICLE1'], now))).not.toContain('PRIVATE');
  });
  it('uses the earliest verified delivered event, not array order or observation time', () => {
    const payload = response();
    payload.tracking_results[0].trackable_items[0].events.unshift({
      description: 'Delivered', date: '2025-09-02T10:00:00+10:00', location: 'PRIVATE LOCATION', recipient: 'PRIVATE BUYER',
    });
    expect(normalizeAusPostArticleTracking(payload, ['ARTICLE1'], now)[0].deliveredAt).toBe('2025-09-01T00:00:00.000Z');
  });
  it.each(['With Australia Post for delivery today', 'Awaiting collection', 'Delivered to sender', 'Returned to sender'])('does not mistake an unrecognized event for buyer delivery (%s)', description => {
    expect(normalizeAusPostArticleTracking(response(description), ['ARTICLE1'], now)[0]).toMatchObject({
      outcome: 'error', deliveredAt: null, errorCode: 'delivery_timestamp_unverified',
    });
  });
  it('does not use a consignment-level Delivered summary for a pending article', () => {
    expect(normalizeAusPostArticleTracking(response('Onboard for delivery', '2025-09-01T10:00:00+10:00', 'In Transit'), ['ARTICLE1'], now)[0])
      .toMatchObject({ outcome: 'pending', deliveredAt: null });
  });
  it('matches articles inside the documented nested items format, never the consignment date', () => {
    const article = response().tracking_results[0].trackable_items[0];
    const payload = { tracking_results: [{ tracking_id: 'ARTICLE1',
      trackable_items: [{ consignment_id: 'CONSIGNMENT1', items: [article] }] }] };
    expect(normalizeAusPostArticleTracking(payload, ['ARTICLE1'], now)[0].outcome).toBe('delivered');
  });
  it.each(['2025-09-01T10:00:00', '2025-02-30T10:00:00+10:00', '2027-01-01T00:00:00Z'])('requires valid timezone-aware non-future proof (%s)', date => {
    expect(normalizeAusPostArticleTracking(response('Delivered', date), ['ARTICLE1'], now)[0].outcome).toBe('error');
  });
  it('rejects mismatched, missing and duplicate response identities', () => {
    expect(() => normalizeAusPostArticleTracking(response(), ['OTHER'], now)).toThrow('identity');
    const payload = response();
    payload.tracking_results[0].trackable_items[0].article_id = 'OTHER';
    expect(() => normalizeAusPostArticleTracking(payload, ['ARTICLE1'], now)).toThrow('identity');
    expect(() => normalizeAusPostArticleTracking({ tracking_results: [] }, ['ARTICLE1'], now)).toThrow();
    expect(() => normalizeAusPostArticleTracking(response(), ['ARTICLE1', 'ARTICLE1'], now)).toThrow();
  });
  it('surfaces per-article errors without retaining vendor messages', () => {
    const result = normalizeAusPostArticleTracking({ tracking_results: [{ tracking_id: 'ARTICLE1',
      errors: [{ code: 'ESB-10001', name: 'PRIVATE BUYER', message: 'PRIVATE PAYLOAD' }] }] }, ['ARTICLE1'], now);
    expect(result[0]).toMatchObject({ outcome: 'error', errorCode: 'article_not_found' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
});
