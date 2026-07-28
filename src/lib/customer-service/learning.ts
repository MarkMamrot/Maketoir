import { createHash } from 'crypto';
import { imsExecute } from '@/services/IMSMySQLService';

export function redactCustomerServiceLearningText(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:\+?61|0)(?:[ -]?\d){8,9}\b/g, '[phone]')
    .replace(/\b(?:SO|PO|CN|SCN)-?\d[\w-]*\b/gi, '[reference]')
    .replace(/#\d{4,}\b/g, '[order]')
    .replace(/\b\d{1,5}\s+[A-Za-z][A-Za-z .'-]+\s(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr)\b/gi, '[address]')
    .trim()
    .slice(0, 12000);
}

export async function recordDraftEditLearning(input: {
  businessId: string;
  draftId: number;
  originalBody: string;
  finalBody: string;
}): Promise<void> {
  if (input.originalBody.trim() === input.finalBody.trim()) return;
  const sanitized = redactCustomerServiceLearningText(
    `ORIGINAL AI DRAFT:\n${input.originalBody}\n\nFINAL SENT RESPONSE:\n${input.finalBody}`,
  );
  const hash = createHash('sha256').update(`${input.businessId}:${sanitized}`).digest('hex');
  await imsExecute(
    `INSERT IGNORE INTO ims_cs_learning_evidence
      (business_id, draft_id, evidence_type, sanitized_summary, evidence_hash, is_factual, expires_at)
     VALUES (?, ?, 'draft_edit', ?, ?, 0, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 90 DAY))`,
    [input.businessId, input.draftId, sanitized, hash],
  );
}