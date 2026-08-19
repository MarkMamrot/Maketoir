import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import {
  duplicateCandidateKeys,
  scoreDuplicateContacts,
  validateContactChannels,
  type ContactIdentityInput,
  type DuplicateContactMatch,
} from '@/lib/ims/contactDataQuality';
import { getIMSPool, imsQuery } from '@/services/IMSMySQLService';

const CUSTOMER_TYPES = ['retail_customer', 'b2b_customer', 'both'] as const;
const CRM_CONTACT_TYPES = ['lead', ...CUSTOMER_TYPES] as const;

export class ContactMergeValidationError extends Error {}
export class ContactMergeNotFoundError extends Error {}

export interface DuplicateContactRow extends ContactIdentityInput {
  id: number;
  type: string;
  customer_code?: string | null;
  shopify_customer_id?: string | null;
  cin7_customer_id?: number | null;
  cin7_contact_id?: number | null;
  store_credit?: number;
  loyalty_account_count?: number;
}

export interface DuplicateContactCandidate extends DuplicateContactMatch {
  left: DuplicateContactRow;
  right: DuplicateContactRow;
  blockers: string[];
}

export interface ContactMergeActor {
  id: number | null;
  name: string;
}

export function isContactMergePairAllowed(leftType: unknown, rightType: unknown): boolean {
  const left = String(leftType);
  const right = String(rightType);
  if (left === 'lead' || right === 'lead') return left === 'lead' && right === 'lead';
  return CUSTOMER_TYPES.includes(left as typeof CUSTOMER_TYPES[number])
    && CUSTOMER_TYPES.includes(right as typeof CUSTOMER_TYPES[number]);
}

function mergeBlockers(left: DuplicateContactRow, right: DuplicateContactRow): string[] {
  const blockers: string[] = [];
  if (!isContactMergePairAllowed(left.type, right.type)) blockers.push('Leads can only be merged with other leads.');
  if (Number(left.store_credit ?? 0) !== 0 && Number(right.store_credit ?? 0) !== 0) blockers.push('Both contacts carry store credit.');
  if (Number(left.loyalty_account_count ?? 0) > 0 && Number(right.loyalty_account_count ?? 0) > 0) blockers.push('Both contacts have loyalty accounts.');
  for (const [label, field] of [
    ['Shopify customer', 'shopify_customer_id'], ['Cin7 customer', 'cin7_customer_id'], ['Cin7 contact', 'cin7_contact_id'],
  ] as const) {
    const a = left[field];
    const b = right[field];
    if (a != null && a !== '' && b != null && b !== '' && String(a) !== String(b)) blockers.push(`${label} IDs conflict.`);
  }
  return blockers;
}

export async function listDuplicateContactCandidates(businessId: string): Promise<{
  candidates: DuplicateContactCandidate[];
  invalidContacts: Array<{ contact: DuplicateContactRow; errors: string[] }>;
  truncated: boolean;
}> {
  const rows = await imsQuery<DuplicateContactRow>(
    `SELECT c.id, c.type, c.name, c.first_name, c.last_name, c.company, c.customer_code,
            c.email, c.phone, c.mobile, c.address, c.address2, c.suburb, c.city, c.state, c.postcode,
            c.shopify_customer_id, c.cin7_customer_id, c.cin7_contact_id, c.store_credit,
            COUNT(la.id) AS loyalty_account_count
       FROM ims_contacts c
       LEFT JOIN loyalty_accounts la ON la.business_id = c.business_id AND la.contact_id = c.id
      WHERE c.business_id = ? AND c.is_active = 1 AND c.type IN ('lead','retail_customer','b2b_customer','both')
      GROUP BY c.id`,
    [businessId],
  );
  const buckets = new Map<string, DuplicateContactRow[]>();
  const invalidContacts = rows.map(contact => ({ contact, errors: validateContactChannels(contact).errors })).filter(item => item.errors.length > 0);
  for (const row of rows) {
    for (const key of duplicateCandidateKeys(row)) {
      const bucket = buckets.get(key) ?? [];
      bucket.push(row);
      buckets.set(key, bucket);
    }
  }
  const seen = new Set<string>();
  const candidates: DuplicateContactCandidate[] = [];
  let truncated = false;
  for (const bucket of buckets.values()) {
    if (bucket.length > 50) continue;
    for (let leftIndex = 0; leftIndex < bucket.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < bucket.length; rightIndex += 1) {
        const left = bucket[leftIndex];
        const right = bucket[rightIndex];
        const pairKey = left.id < right.id ? `${left.id}:${right.id}` : `${right.id}:${left.id}`;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        const match = scoreDuplicateContacts(left, right);
        if (match.confidence === 'none') continue;
        candidates.push({ left, right, ...match, blockers: mergeBlockers(left, right) });
        if (candidates.length >= 500) { truncated = true; break; }
      }
      if (truncated) break;
    }
    if (truncated) break;
  }
  candidates.sort((a, b) => b.score - a.score || a.left.id - b.left.id);
  return { candidates, invalidContacts, truncated };
}

async function lockContact(connection: PoolConnection, businessId: string, contactId: number) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT * FROM ims_contacts WHERE id = ? AND business_id = ? FOR UPDATE`,
    [contactId, businessId],
  );
  return rows[0] as (RowDataPacket & DuplicateContactRow) | undefined;
}

function hasValue(value: unknown) {
  return value !== null && value !== undefined && value !== '';
}

export async function mergeCustomerContacts(input: {
  businessId: string;
  sourceContactId: number;
  targetContactId: number;
  actor: ContactMergeActor;
}) {
  if (!Number.isInteger(input.sourceContactId) || !Number.isInteger(input.targetContactId) || input.sourceContactId <= 0 || input.targetContactId <= 0 || input.sourceContactId === input.targetContactId) {
    throw new ContactMergeValidationError('Choose two different customer contacts.');
  }
  const connection = await getIMSPool().getConnection();
  try {
    await connection.beginTransaction();
    const orderedIds = [input.sourceContactId, input.targetContactId].sort((a, b) => a - b);
    const first = await lockContact(connection, input.businessId, orderedIds[0]);
    const second = await lockContact(connection, input.businessId, orderedIds[1]);
    const source = input.sourceContactId === orderedIds[0] ? first : second;
    const target = input.targetContactId === orderedIds[0] ? first : second;
    if (!source || !target) throw new ContactMergeNotFoundError('One or both contacts were not found.');
    if (!CRM_CONTACT_TYPES.includes(source.type as typeof CRM_CONTACT_TYPES[number]) || !CRM_CONTACT_TYPES.includes(target.type as typeof CRM_CONTACT_TYPES[number])) {
      throw new ContactMergeValidationError('Only leads and customer contacts can be merged.');
    }
    if (!isContactMergePairAllowed(source.type, target.type)) {
      throw new ContactMergeValidationError('Leads can only be merged with other leads.');
    }
    if (!Number(source.is_active) || !Number(target.is_active)) throw new ContactMergeValidationError('Both contacts must be active.');

    const blockers = mergeBlockers(source, target);
    if (Number(source.store_credit ?? 0) !== 0) blockers.push('The merged-away contact carries store credit; select it as the surviving contact.');
    const [sourceLoyalty] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM loyalty_accounts WHERE business_id = ? AND contact_id = ? LIMIT 1 FOR UPDATE`,
      [input.businessId, input.sourceContactId],
    );
    if (sourceLoyalty[0]) blockers.push('The merged-away contact owns a loyalty account; select it as the surviving contact.');
    if (blockers.length) throw new ContactMergeValidationError([...new Set(blockers)].join(' '));

    const transferableFields = [
      'first_name', 'last_name', 'company', 'email', 'phone', 'mobile', 'address', 'address2', 'suburb', 'city', 'state', 'postcode', 'country',
      'date_of_birth', 'gender', 'shopify_customer_id', 'cin7_customer_id', 'cin7_contact_id',
    ] as const;
    const assignments: string[] = [];
    const values: unknown[] = [];
    const movedExternalFields: string[] = [];
    for (const field of transferableFields) {
      if (!hasValue(target[field]) && hasValue(source[field])) {
        assignments.push(`${field} = ?`);
        values.push(source[field]);
        if (field === 'shopify_customer_id' || field === 'cin7_customer_id' || field === 'cin7_contact_id') movedExternalFields.push(field);
      }
    }
    if (movedExternalFields.length) {
      await connection.execute(
        `UPDATE ims_contacts SET ${movedExternalFields.map(field => `${field} = NULL`).join(', ')} WHERE id = ? AND business_id = ?`,
        [input.sourceContactId, input.businessId],
      );
    }
    if (assignments.length) {
      await connection.execute(
        `UPDATE ims_contacts SET ${assignments.join(', ')} WHERE id = ? AND business_id = ?`,
        [...values, input.targetContactId, input.businessId],
      );
    }

    await connection.execute(
      `DELETE source_tag FROM ims_crm_contact_tags source_tag
        JOIN ims_crm_contact_tags target_tag
          ON target_tag.business_id = source_tag.business_id AND target_tag.tag_id = source_tag.tag_id AND target_tag.contact_id = ?
       WHERE source_tag.business_id = ? AND source_tag.contact_id = ?`,
      [input.targetContactId, input.businessId, input.sourceContactId],
    );
    for (const table of ['ims_crm_contact_tags', 'ims_crm_interactions', 'ims_crm_tasks', 'ims_crm_opportunities'] as const) {
      await connection.execute(
        `UPDATE ${table} SET contact_id = ? WHERE business_id = ? AND contact_id = ?`,
        [input.targetContactId, input.businessId, input.sourceContactId],
      );
    }
    await connection.execute(
      `UPDATE ims_sales_orders SET customer_id = ? WHERE business_id = ? AND customer_id = ?`,
      [input.targetContactId, input.businessId, input.sourceContactId],
    );
    await connection.execute(
      `UPDATE pos_sales sale JOIN ims_locations location ON location.id = sale.location_id AND location.business_id = ?
          SET sale.customer_id = ? WHERE sale.customer_id = ?`,
      [input.businessId, input.targetContactId, input.sourceContactId],
    );
    await connection.execute(
      `UPDATE ims_credit_notes SET customer_id = ? WHERE business_id = ? AND customer_id = ? AND status = 'draft'`,
      [input.targetContactId, input.businessId, input.sourceContactId],
    );
    await connection.execute(
      `UPDATE ims_contacts
          SET is_active = 0, shopify_customer_id = NULL, cin7_customer_id = NULL, cin7_contact_id = NULL,
              notes = CONCAT_WS('\n', NULLIF(notes, ''), ?)
        WHERE id = ? AND business_id = ?`,
      [`Merged into contact #${input.targetContactId}.`, input.sourceContactId, input.businessId],
    );
    const [audit] = await connection.execute(
      `INSERT INTO ims_crm_contact_merges
        (business_id, source_contact_id, target_contact_id, source_snapshot_json, target_snapshot_json, merged_by, merged_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [input.businessId, input.sourceContactId, input.targetContactId, JSON.stringify(source), JSON.stringify(target), input.actor.id, input.actor.name],
    );
    await connection.commit();
    return { mergeId: Number((audit as { insertId: number }).insertId), sourceContactId: input.sourceContactId, targetContactId: input.targetContactId };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}