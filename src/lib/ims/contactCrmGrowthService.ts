import { ImsContactsRepo } from '@/lib/ims/ImsRepository';
import { ContactCrmNotFoundError, ContactCrmValidationError, type ContactCrmActor } from '@/lib/ims/contactCrmService';
import { imsExecute, imsQuery } from '@/services/IMSMySQLService';

export const CRM_STAGE_CATEGORIES = ['open', 'won', 'lost'] as const;
export const CRM_CUSTOMER_TYPES = ['retail_customer', 'b2b_customer', 'both'] as const;
export const CRM_REVENUE_SOURCES = ['combined', 'pos', 'sales_orders'] as const;

type StageCategory = typeof CRM_STAGE_CATEGORIES[number];
type RevenueSource = typeof CRM_REVENUE_SOURCES[number];

export interface ContactCrmSegmentRules {
  contactTypes: string[];
  tagIds: number[];
  revenueSource: RevenueSource;
  minimumRevenue: number | null;
  maximumRevenue: number | null;
  activeWithinDays: number | null;
  inactiveForDays: number | null;
  locationIds: number[];
  loyaltyStatus: 'all' | 'member' | 'not_member';
}

const DEFAULT_STAGES = [
  ['New', 'new', 10, 'open', 10, '#64748b'],
  ['Contacted', 'contacted', 20, 'open', 25, '#2563eb'],
  ['Qualified', 'qualified', 30, 'open', 50, '#0891b2'],
  ['Quoted', 'quoted', 40, 'open', 75, '#d97706'],
  ['Won', 'won', 50, 'won', 100, '#15803d'],
  ['Lost', 'lost', 60, 'lost', 0, '#b91c1c'],
] as const;

function cleanText(value: unknown, field: string, max: number, required = true) {
  const cleaned = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (required && !cleaned) throw new ContactCrmValidationError(`${field} is required.`);
  if (cleaned.length > max) throw new ContactCrmValidationError(`${field} must be ${max} characters or fewer.`);
  return cleaned || null;
}

function finiteNumber(value: unknown, field: string, minimum: number, maximum: number, nullable = false) {
  if (nullable && (value === '' || value === null || value === undefined)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new ContactCrmValidationError(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function positiveIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter(id => Number.isInteger(id) && id > 0))].slice(0, 100);
}

export function normalizeContactCrmSegmentRules(value: unknown): ContactCrmSegmentRules {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const contactTypes = Array.isArray(input.contactTypes)
    ? input.contactTypes.map(String).filter(type => (CRM_CUSTOMER_TYPES as readonly string[]).includes(type))
    : [];
  const revenueSource = (CRM_REVENUE_SOURCES as readonly string[]).includes(String(input.revenueSource))
    ? String(input.revenueSource) as RevenueSource
    : 'combined';
  const loyaltyStatus = ['all', 'member', 'not_member'].includes(String(input.loyaltyStatus))
    ? String(input.loyaltyStatus) as ContactCrmSegmentRules['loyaltyStatus']
    : 'all';
  const minimumRevenue = finiteNumber(input.minimumRevenue, 'Minimum revenue', 0, 999999999.99, true);
  const maximumRevenue = finiteNumber(input.maximumRevenue, 'Maximum revenue', 0, 999999999.99, true);
  if (minimumRevenue !== null && maximumRevenue !== null && minimumRevenue > maximumRevenue) {
    throw new ContactCrmValidationError('Minimum revenue cannot exceed maximum revenue.');
  }
  const activeWithinDays = finiteNumber(input.activeWithinDays, 'Active-within days', 1, 3650, true);
  const inactiveForDays = finiteNumber(input.inactiveForDays, 'Inactive-for days', 1, 3650, true);
  if (activeWithinDays !== null && inactiveForDays !== null) {
    throw new ContactCrmValidationError('Choose either active within or inactive for, not both.');
  }
  return {
    contactTypes: [...new Set(contactTypes)],
    tagIds: positiveIds(input.tagIds),
    revenueSource,
    minimumRevenue,
    maximumRevenue,
    activeWithinDays,
    inactiveForDays,
    locationIds: positiveIds(input.locationIds),
    loyaltyStatus,
  };
}

function parseRules(value: unknown) {
  try {
    return normalizeContactCrmSegmentRules(typeof value === 'string' ? JSON.parse(value) : value);
  } catch (error) {
    if (error instanceof ContactCrmValidationError) throw error;
    throw new ContactCrmValidationError('Segment rules are invalid.');
  }
}

async function requireSegment(businessId: string, segmentId: number) {
  const rows = await imsQuery<any>('SELECT * FROM ims_crm_segments WHERE id = ? AND business_id = ? LIMIT 1', [segmentId, businessId]);
  if (!rows[0]) throw new ContactCrmNotFoundError('Segment not found.');
  return { ...rows[0], rules: parseRules(rows[0].rules_json) };
}

export async function listContactCrmSegments(businessId: string) {
  const rows = await imsQuery<any>(
    'SELECT id, name, description, rules_json, created_by_name, created_at, updated_at FROM ims_crm_segments WHERE business_id = ? ORDER BY name LIMIT 100',
    [businessId],
  );
  return rows.map(row => ({ ...row, rules: parseRules(row.rules_json), rules_json: undefined }));
}

export async function createContactCrmSegment(
  businessId: string,
  input: { name?: unknown; description?: unknown; rules?: unknown },
  actor: ContactCrmActor,
) {
  const name = cleanText(input.name, 'Segment name', 120) as string;
  const description = cleanText(input.description, 'Description', 500, false);
  const rules = normalizeContactCrmSegmentRules(input.rules);
  const result = await imsExecute(
    `INSERT INTO ims_crm_segments
      (business_id, name, normalized_name, description, rules_json, created_by, created_by_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [businessId, name, name.toLocaleLowerCase('en-AU'), description, JSON.stringify(rules), actor.id, actor.name],
  );
  return Number(result.insertId);
}

export async function updateContactCrmSegment(
  businessId: string,
  segmentId: number,
  input: { name?: unknown; description?: unknown; rules?: unknown },
) {
  await requireSegment(businessId, segmentId);
  const name = cleanText(input.name, 'Segment name', 120) as string;
  const description = cleanText(input.description, 'Description', 500, false);
  const rules = normalizeContactCrmSegmentRules(input.rules);
  await imsExecute(
    `UPDATE ims_crm_segments SET name = ?, normalized_name = ?, description = ?, rules_json = ?
      WHERE id = ? AND business_id = ?`,
    [name, name.toLocaleLowerCase('en-AU'), description, JSON.stringify(rules), segmentId, businessId],
  );
}

export async function deleteContactCrmSegment(businessId: string, segmentId: number) {
  const result = await imsExecute('DELETE FROM ims_crm_segments WHERE id = ? AND business_id = ?', [segmentId, businessId]);
  if (!result.affectedRows) throw new ContactCrmNotFoundError('Segment not found.');
}

export async function getContactCrmSegmentMembers(businessId: string, segmentId: number) {
  const segment = await requireSegment(businessId, segmentId);
  const rules: ContactCrmSegmentRules = segment.rules;
  const params: unknown[] = [businessId, businessId, businessId];
  const where = ["c.business_id = ?", "c.type IN ('retail_customer','b2b_customer','both')", 'c.is_active = 1'];
  params.push(businessId);
  if (rules.contactTypes.length) {
    where.push(`c.type IN (${rules.contactTypes.map(() => '?').join(',')})`);
    params.push(...rules.contactTypes);
  }
  if (rules.tagIds.length) {
    where.push(`EXISTS (SELECT 1 FROM ims_crm_contact_tags ct WHERE ct.business_id = c.business_id AND ct.contact_id = c.id AND ct.tag_id IN (${rules.tagIds.map(() => '?').join(',')}))`);
    params.push(...rules.tagIds);
  }
  if (rules.locationIds.length) {
    where.push(`EXISTS (SELECT 1 FROM pos_sales psf JOIN ims_locations lf ON lf.id = psf.location_id AND lf.business_id = c.business_id WHERE psf.customer_id = c.id AND lf.id IN (${rules.locationIds.map(() => '?').join(',')}) AND psf.status NOT IN ('open','parked','voided'))`);
    params.push(...rules.locationIds);
  }
  if (rules.loyaltyStatus === 'member') where.push("c.type = 'retail_customer' AND c.loyalty_member = 1");
  if (rules.loyaltyStatus === 'not_member') where.push("c.type = 'retail_customer' AND c.loyalty_member = 0");
  const revenueExpression = rules.revenueSource === 'pos' ? 'COALESCE(pos.revenue, 0)'
    : rules.revenueSource === 'sales_orders' ? 'COALESCE(so.revenue, 0)'
      : '(COALESCE(pos.revenue, 0) + COALESCE(so.revenue, 0))';
  const activityExpression = rules.revenueSource === 'pos' ? 'pos.last_activity_at'
    : rules.revenueSource === 'sales_orders' ? 'so.last_activity_at'
      : 'CASE WHEN pos.last_activity_at IS NULL THEN so.last_activity_at WHEN so.last_activity_at IS NULL THEN pos.last_activity_at ELSE GREATEST(pos.last_activity_at, so.last_activity_at) END';
  if (rules.minimumRevenue !== null) { where.push(`${revenueExpression} >= ?`); params.push(rules.minimumRevenue); }
  if (rules.maximumRevenue !== null) { where.push(`${revenueExpression} <= ?`); params.push(rules.maximumRevenue); }
  if (rules.activeWithinDays !== null) where.push(`${activityExpression} >= DATE_SUB(CURRENT_DATE, INTERVAL ${Math.floor(rules.activeWithinDays)} DAY)`);
  if (rules.inactiveForDays !== null) where.push(`(${activityExpression} IS NULL OR ${activityExpression} < DATE_SUB(CURRENT_DATE, INTERVAL ${Math.floor(rules.inactiveForDays)} DAY))`);
  const rows = await imsQuery<any>(
    `SELECT c.id, c.name, c.company, c.type, c.email, c.mobile, c.phone, c.loyalty_member,
            ${revenueExpression} AS revenue, ${activityExpression} AS last_activity_at
       FROM ims_contacts c
       LEFT JOIN (
         SELECT ps.customer_id AS contact_id,
                SUM(CASE WHEN ps.sale_type = 'return' THEN -ABS(ps.total) ELSE ps.total END) AS revenue,
                MAX(COALESCE(ps.completed_at, ps.created_at)) AS last_activity_at
           FROM pos_sales ps JOIN ims_locations l ON l.id = ps.location_id AND l.business_id = ?
          WHERE ps.status NOT IN ('open','parked','voided') GROUP BY ps.customer_id
       ) pos ON pos.contact_id = c.id
       LEFT JOIN (
         SELECT customer_id AS contact_id, SUM(CASE WHEN status = 'cancelled' THEN 0 ELSE total_amount END) AS revenue,
                MAX(COALESCE(fulfilled_date, created_at)) AS last_activity_at
           FROM ims_sales_orders WHERE business_id = ? GROUP BY customer_id
       ) so ON so.contact_id = c.id
       LEFT JOIN loyalty_accounts la ON la.business_id = ? AND la.contact_id = c.id
      WHERE ${where.join(' AND ')} ORDER BY revenue DESC, c.name LIMIT 501`,
    params,
  );
  return { segment, members: rows.slice(0, 500), truncated: rows.length > 500 };
}

export async function ensureDefaultCrmPipelineStages(businessId: string) {
  const existing = await imsQuery<{ stage_count: number }>(
    'SELECT COUNT(*) AS stage_count FROM ims_crm_pipeline_stages WHERE business_id = ?',
    [businessId],
  );
  if (Number(existing[0]?.stage_count ?? 0) > 0) return;
  for (const stage of DEFAULT_STAGES) {
    await imsExecute(
      `INSERT INTO ims_crm_pipeline_stages
        (business_id, name, normalized_name, position, category, default_probability, color)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id`,
      [businessId, ...stage],
    );
  }
}

export async function getContactCrmPipeline(businessId: string) {
  await ensureDefaultCrmPipelineStages(businessId);
  const [stages, opportunities] = await Promise.all([
    imsQuery<any>('SELECT * FROM ims_crm_pipeline_stages WHERE business_id = ? AND is_active = 1 ORDER BY position, id', [businessId]),
    imsQuery<any>(
      `SELECT o.*, c.name AS contact_name, c.company AS contact_company, c.type AS contact_type,
              s.name AS stage_name, s.category AS stage_category, s.color AS stage_color
         FROM ims_crm_opportunities o
         JOIN ims_contacts c ON c.id = o.contact_id AND c.business_id = o.business_id
         JOIN ims_crm_pipeline_stages s ON s.id = o.stage_id AND s.business_id = o.business_id
        WHERE o.business_id = ? ORDER BY s.position, o.next_action_date IS NULL, o.next_action_date, o.id DESC LIMIT 1000`,
      [businessId],
    ),
  ]);
  return { stages, opportunities, truncated: opportunities.length >= 1000 };
}

async function requireStage(businessId: string, stageId: number) {
  const rows = await imsQuery<any>('SELECT * FROM ims_crm_pipeline_stages WHERE id = ? AND business_id = ? AND is_active = 1 LIMIT 1', [stageId, businessId]);
  if (!rows[0]) throw new ContactCrmNotFoundError('Pipeline stage not found.');
  return rows[0];
}

export async function saveContactCrmPipelineStage(
  businessId: string,
  stageId: number | null,
  input: Record<string, unknown>,
) {
  const name = cleanText(input.name, 'Stage name', 80) as string;
  const category = String(input.category ?? 'open') as StageCategory;
  if (!(CRM_STAGE_CATEGORIES as readonly string[]).includes(category)) throw new ContactCrmValidationError('Invalid stage category.');
  const position = finiteNumber(input.position, 'Stage position', 0, 10000);
  const probability = Math.round(finiteNumber(input.defaultProbability, 'Default probability', 0, 100));
  const color = cleanText(input.color, 'Color', 32, false);
  if (stageId) {
    await requireStage(businessId, stageId);
    await imsExecute(
      `UPDATE ims_crm_pipeline_stages SET name = ?, normalized_name = ?, position = ?, category = ?, default_probability = ?, color = ?
        WHERE id = ? AND business_id = ?`,
      [name, name.toLocaleLowerCase('en-AU'), position, category, probability, color, stageId, businessId],
    );
    return stageId;
  }
  const result = await imsExecute(
    `INSERT INTO ims_crm_pipeline_stages (business_id, name, normalized_name, position, category, default_probability, color)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [businessId, name, name.toLocaleLowerCase('en-AU'), position, category, probability, color],
  );
  return Number(result.insertId);
}

export async function createContactCrmOpportunity(
  businessId: string,
  input: Record<string, unknown>,
  actor: ContactCrmActor,
) {
  const contactId = Number(input.contactId);
  const contact = await ImsContactsRepo.get(contactId, businessId);
  if (!contact || !['lead', ...CRM_CUSTOMER_TYPES].includes(contact.type as any)) throw new ContactCrmNotFoundError('Lead or customer not found.');
  const stage = await requireStage(businessId, Number(input.stageId));
  const title = cleanText(input.title, 'Opportunity title', 255) as string;
  const description = cleanText(input.description, 'Description', 5000, false);
  const expectedValue = Math.round(finiteNumber(input.expectedValue, 'Expected value', 0, 999999999.99) * 100) / 100;
  const probability = Math.round(input.probability === '' || input.probability == null
    ? Number(stage.default_probability)
    : finiteNumber(input.probability, 'Probability', 0, 100));
  const nextActionDate = input.nextActionDate ? String(input.nextActionDate) : null;
  if (nextActionDate && !/^\d{4}-\d{2}-\d{2}$/.test(nextActionDate)) throw new ContactCrmValidationError('Next action date must use YYYY-MM-DD format.');
  const ownerUserId = input.ownerUserId == null || input.ownerUserId === '' ? null : Number(input.ownerUserId);
  const ownerName = cleanText(input.ownerName, 'Owner name', 255, false);
  const result = await imsExecute(
    `INSERT INTO ims_crm_opportunities
      (business_id, contact_id, stage_id, title, description, expected_value, probability, owner_user_id, owner_name,
       next_action_date, created_by, created_by_name, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, IF(? IN ('won','lost'), CURRENT_TIMESTAMP, NULL))`,
    [businessId, contactId, stage.id, title, description, expectedValue, probability, ownerUserId, ownerName,
      nextActionDate, actor.id, actor.name, stage.category],
  );
  return Number(result.insertId);
}

export async function moveContactCrmOpportunity(
  businessId: string,
  opportunityId: number,
  input: { stageId?: unknown; lostReason?: unknown; conversionType?: unknown },
) {
  const stage = await requireStage(businessId, Number(input.stageId));
  const rows = await imsQuery<any>(
    `SELECT o.id, o.contact_id, c.type AS contact_type FROM ims_crm_opportunities o
      JOIN ims_contacts c ON c.id = o.contact_id AND c.business_id = o.business_id
     WHERE o.id = ? AND o.business_id = ? LIMIT 1`,
    [opportunityId, businessId],
  );
  const opportunity = rows[0];
  if (!opportunity) throw new ContactCrmNotFoundError('Opportunity not found.');
  const lostReason = stage.category === 'lost' ? cleanText(input.lostReason, 'Lost reason', 500, false) : null;
  const conversionType = String(input.conversionType ?? '');
  if (stage.category === 'won' && opportunity.contact_type === 'lead') {
    if (!['retail_customer', 'b2b_customer'].includes(conversionType)) {
      throw new ContactCrmValidationError('Choose Retail Customer or B2B Customer when winning a lead.');
    }
    await imsExecute('UPDATE ims_contacts SET type = ? WHERE id = ? AND business_id = ? AND type = ?', [conversionType, opportunity.contact_id, businessId, 'lead']);
  }
  await imsExecute(
    `UPDATE ims_crm_opportunities SET stage_id = ?, probability = ?, lost_reason = ?,
       closed_at = IF(? IN ('won','lost'), COALESCE(closed_at, CURRENT_TIMESTAMP), NULL)
      WHERE id = ? AND business_id = ?`,
    [stage.id, Number(stage.default_probability), lostReason, stage.category, opportunityId, businessId],
  );
}
