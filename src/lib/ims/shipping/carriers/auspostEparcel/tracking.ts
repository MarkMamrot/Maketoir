import { verifiedDeliveryTimestamp } from '@/lib/securityCompliance/amazonDeliveryEvidence';

export type AusPostArticleTracking = {
  articleId: string; outcome: 'pending' | 'delivered' | 'error';
  deliveredAt: string | null; errorCode: string | null;
};

export class AusPostTrackingError extends Error {
  constructor(readonly code: string, readonly status: number | null = null) {
    super(`Australia Post delivery tracking failed (${code}).`);
  }
}

export function validateTrackingArticleIds(ids: readonly string[]): void {
  if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length
    || ids.some(id => id.trim() !== id || !/^[A-Za-z0-9]{1,100}$/.test(id))) throw new AusPostTrackingError('invalid_article_ids');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AusPostTrackingError('invalid_response');
  return value as Record<string, unknown>;
}

// Official Track Items article responses; consignment summaries cannot prove parcel delivery.
export function normalizeAusPostArticleTracking(payload: unknown, ids: readonly string[], now = new Date()): AusPostArticleTracking[] {
  validateTrackingArticleIds(ids);
  const results = record(payload).tracking_results;
  if (!Array.isArray(results) || results.length !== ids.length) throw new AusPostTrackingError('missing_tracking_results');
  const rows = results.map(record);
  if (rows.some(row => typeof row.tracking_id !== 'string' || !ids.includes(row.tracking_id))
    || new Set(rows.map(row => row.tracking_id)).size !== ids.length) throw new AusPostTrackingError('tracking_identity_mismatch');
  return ids.map(articleId => {
    const result = rows.find(row => row.tracking_id === articleId)!;
    if (result.errors !== undefined) {
      if (!Array.isArray(result.errors)) throw new AusPostTrackingError('invalid_response');
      if (result.errors.length) {
        const known = result.errors.map(record).map(error => error.code);
        const errorCode = known.every(code => code === 'ESB-10001') ? 'article_not_found'
          : known.every(code => code === 'ESB-10002') ? 'article_not_trackable' : 'carrier_article_error';
        return { articleId, outcome: 'error', deliveredAt: null, errorCode };
      }
    }
    if (!Array.isArray(result.trackable_items)) throw new AusPostTrackingError('missing_article_events');
    const articles = result.trackable_items.flatMap(value => {
      const item = record(value);
      return Array.isArray(item.items) ? item.items.map(record) : [item];
    }).filter(item => item.article_id === articleId);
    if (articles.length !== 1) throw new AusPostTrackingError('article_identity_mismatch');
    const article = articles[0];
    if (typeof article.status !== 'string' || !Array.isArray(article.events)) throw new AusPostTrackingError('invalid_article');
    if (!['delivered', 'item delivered'].includes(article.status.toLowerCase())) {
      const pending = ['created', 'sealed', 'initiated', 'in transit', 'awaiting collection', 'possible delay', 'held by courier',
        'on board for delivery', 'track items for detailed delivery information'];
      if (!pending.includes(article.status.toLowerCase())) {
        return { articleId, outcome: 'error', deliveredAt: null, errorCode: 'delivery_status_needs_review' };
      }
      return { articleId, outcome: 'pending', deliveredAt: null, errorCode: null };
    }
    const delivered = article.events.map(record).filter(event =>
      typeof event.description === 'string' && /^(Delivered|Delivered - Left in a safe place|Item delivered)$/i.test(event.description));
    if (!delivered.length) return { articleId, outcome: 'error', deliveredAt: null, errorCode: 'delivery_timestamp_unverified' };
    try {
      const dates = delivered.map(event => verifiedDeliveryTimestamp(event.date, now)).sort();
      return { articleId, outcome: 'delivered', deliveredAt: dates[0], errorCode: null };
    } catch {
      return { articleId, outcome: 'error', deliveredAt: null, errorCode: 'delivery_timestamp_unverified' };
    }
  });
}
