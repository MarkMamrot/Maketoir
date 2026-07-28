import { GoogleGenAI } from '@google/genai';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';
import { getCustomerServiceKnowledge, getCustomerServiceSettings, saveCustomerServiceKnowledge } from './repository';

const LEARNED_START = '<!-- learned:start -->';
const LEARNED_END = '<!-- learned:end -->';
const RISKY_FACT_PATTERN = /\b(price|cost|stock|inventory|refund|return|exchange|shipping|delivery|promise|warranty|legal|privacy|policy|order status|discount)\b/i;

function safeJsonParse<T>(raw: string): T | null {
  try { return JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()) as T; } catch { return null; }
}

function safeRuleKey(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) : '';
}

function wordCount(value: string): number { return value.trim().split(/\s+/).filter(Boolean).length; }

export function compileLearnedMarkdown(existing: string, rules: Array<{ rule_key: string; title: string; proposed_markdown: string }>, maxWords: number): string {
  const start = existing.indexOf(LEARNED_START);
  const end = existing.indexOf(LEARNED_END);
  const base = (start >= 0 && end > start ? `${existing.slice(0, start)}${existing.slice(end + LEARNED_END.length)}` : existing).trimEnd();
  const accepted: string[] = [];
  for (const rule of rules) {
    const line = `- **${rule.title.trim()}** [${rule.rule_key}]: ${rule.proposed_markdown.trim()}`;
    const candidate = `${base}\n\n${LEARNED_START}\n## Learned Patterns\n${[...accepted, line].join('\n')}\n${LEARNED_END}\n`;
    if (wordCount(candidate) > maxWords) break;
    accepted.push(line);
  }
  const compiled = `${base}\n\n${LEARNED_START}\n## Learned Patterns\n${accepted.join('\n')}\n${LEARNED_END}\n`;
  return wordCount(compiled) <= maxWords ? compiled : `${base}\n`;
}

export async function curateCustomerServiceLearnings(businessId: string): Promise<{ processed: number; candidates: number; activated: number }> {
  const settings = await getCustomerServiceSettings(businessId);
  if (!settings.learningEnabled) return { processed: 0, candidates: 0, activated: 0 };
  const evidence = await imsQuery<any>(
    `SELECT id, sanitized_summary FROM ims_cs_learning_evidence
      WHERE business_id = ? AND processed_at IS NULL
        AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
      ORDER BY created_at LIMIT 50`,
    [businessId],
  );
  if (evidence.length < 3) return { processed: 0, candidates: 0, activated: 0 };
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `Curate repeated customer-service reply-edit patterns into compact reusable rules.
Evidence has been PII-redacted. Ignore customer-specific facts and one-off wording.
Return JSON only: {"candidates":[{"ruleKey":"stable-key","ruleType":"style|fact|policy","title":"short title","markdown":"one actionable sentence","evidenceIndexes":[0,1,2],"confidence":0.9}]}.
Use at least 3 independent evidence indexes for a candidate. Facts, policies, prices, stock, returns, shipping, delivery promises, legal and privacy items must be fact or policy, never style.

EVIDENCE:
${JSON.stringify(evidence.map((item, index) => ({ index, text: String(item.sanitized_summary).slice(0, 12000) })))}`;
  let rawCandidates: any[] = [];
  try {
    const response = await ai.models.generateContent({ model: settings.lightModelId, contents: prompt });
    rawCandidates = safeJsonParse<{ candidates?: any[] }>(response.text || '')?.candidates || [];
  } catch { /* mark evidence processed below to prevent an unbounded retry buffer */ }

  let candidateCount = 0;
  let activated = 0;
  for (const raw of rawCandidates.slice(0, 12)) {
    const ruleKey = safeRuleKey(raw?.ruleKey);
    const title = typeof raw?.title === 'string' ? raw.title.trim().slice(0, 255) : '';
    const markdown = typeof raw?.markdown === 'string' ? raw.markdown.trim().slice(0, 1500) : '';
    const indexes = Array.from(new Set(Array.isArray(raw?.evidenceIndexes) ? raw.evidenceIndexes.map(Number).filter((index: number) => Number.isInteger(index) && index >= 0 && index < evidence.length) : []));
    const requestedType = ['style', 'fact', 'policy'].includes(raw?.ruleType) ? raw.ruleType : 'fact';
    const ruleType = requestedType === 'style' && !RISKY_FACT_PATTERN.test(`${title} ${markdown}`) ? 'style' : requestedType === 'policy' ? 'policy' : 'fact';
    const confidence = Math.max(0, Math.min(1, Number(raw?.confidence) || 0));
    if (!ruleKey || !title || !markdown || indexes.length < 3) continue;
    const autoActivate = ruleType === 'style' && confidence >= 0.85;
    await imsExecute(
      `INSERT INTO ims_cs_learning_candidates
        (business_id, rule_key, rule_type, title, proposed_markdown, status, evidence_count, confidence, auto_activated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), proposed_markdown = VALUES(proposed_markdown),
         evidence_count = evidence_count + VALUES(evidence_count), confidence = GREATEST(confidence, VALUES(confidence)),
         status = IF(status = 'rejected', status, VALUES(status)), auto_activated = GREATEST(auto_activated, VALUES(auto_activated))`,
      [businessId, ruleKey, ruleType, title, markdown, autoActivate ? 'active' : 'pending', indexes.length, confidence, autoActivate ? 1 : 0],
    );
    candidateCount++;
    if (autoActivate) activated++;
  }
  const ids = evidence.map(item => item.id);
  if (ids.length) {
    await imsExecute(
      `UPDATE ims_cs_learning_evidence SET processed_at = UTC_TIMESTAMP()
        WHERE business_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
      [businessId, ...ids],
    );
  }
  if (activated) await rebuildLearnedStyleDocument(businessId);
  return { processed: evidence.length, candidates: candidateCount, activated };
}

export async function rebuildLearnedStyleDocument(businessId: string): Promise<void> {
  const [documents, rules] = await Promise.all([
    getCustomerServiceKnowledge(businessId),
    imsQuery<any>(
      `SELECT rule_key, title, proposed_markdown FROM ims_cs_learning_candidates
        WHERE business_id = ? AND rule_type = 'style' AND status = 'active'
        ORDER BY confidence DESC, evidence_count DESC, rule_key LIMIT 40`,
      [businessId],
    ),
  ]);
  const style = documents.find(document => document.documentKey === 'style');
  if (!style) return;
  const markdown = compileLearnedMarkdown(style.markdown, rules, 800);
  await saveCustomerServiceKnowledge({ businessId, documentKey: 'style', markdown, userId: 0, reason: 'Curated repeated reply edits' });
}

export async function listLearningCandidates(businessId: string): Promise<any[]> {
  return imsQuery<any>(
    `SELECT id, rule_key, rule_type, title, proposed_markdown, status, evidence_count,
            confidence, auto_activated, reviewed_at, updated_at
       FROM ims_cs_learning_candidates WHERE business_id = ?
       ORDER BY FIELD(status, 'pending', 'active', 'rejected', 'superseded'), updated_at DESC LIMIT 100`,
    [businessId],
  );
}

export async function reviewLearningCandidate(input: { businessId: string; id: number; status: 'active' | 'rejected'; userId: number; markdown?: string }): Promise<void> {
  await imsExecute(
    `UPDATE ims_cs_learning_candidates SET status = ?, proposed_markdown = COALESCE(?, proposed_markdown),
       reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE business_id = ? AND id = ?`,
    [input.status, input.markdown?.trim().slice(0, 1500) || null, input.userId, input.businessId, input.id],
  );
  await rebuildLearnedStyleDocument(input.businessId);
}