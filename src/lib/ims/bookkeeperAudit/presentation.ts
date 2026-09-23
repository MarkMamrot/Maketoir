import type { AuditReview } from './repository';
import { compareAuditFindingsNewestFirst, type AuditFinding, type PresentedAuditFinding } from './domain';

export function applyAuditReviews(findings: AuditFinding[], reviews: AuditReview[]): PresentedAuditFinding[] {
  const accepted = new Map(reviews.map(review => [`${review.findingKey}\0${review.fingerprint}`, review]));
  return findings.map(finding => {
    const review = accepted.get(`${finding.key}\0${finding.fingerprint}`);
    return {
      ...finding,
      reviewStatus: review ? 'accepted' : 'open',
      review: review ? { reason: review.reason, actorName: review.actorName, acceptedAt: review.acceptedAt } : null,
    };
  }).sort(compareAuditFindingsNewestFirst);
}