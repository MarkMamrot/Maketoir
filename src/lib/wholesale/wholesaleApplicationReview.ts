import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/services/MySQLService';
import { getIMSPool } from '@/services/IMSMySQLService';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { normalizeWholesaleBrands } from './wholesaleAccess';
import type { WholesaleApplicationStatus } from './wholesaleApplication';

export interface WholesaleApplicationReviewRow {
  id: number;
  companyName: string;
  contactName: string;
  email: string;
  phone: string | null;
  abn: string | null;
  message: string | null;
  status: WholesaleApplicationStatus;
  emailVerifiedAt: string | Date | null;
  linkedContactId: number | null;
  reviewedByName: string | null;
  reviewedAt: string | Date | null;
  reviewReason: string | null;
  createdAt: string | Date;
}

interface ApplicationDbRow extends RowDataPacket {
  id: number;
  business_id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  abn: string | null;
  applicant_message: string | null;
  status: WholesaleApplicationStatus;
  email_verified_at: string | Date | null;
  linked_contact_id: number | null;
  reviewed_by_name: string | null;
  reviewed_at: string | Date | null;
  review_reason: string | null;
  created_at: string | Date;
}

function mapApplication(row: ApplicationDbRow): WholesaleApplicationReviewRow {
  return {
    id: Number(row.id), companyName: row.company_name, contactName: row.contact_name,
    email: row.email, phone: row.phone, abn: row.abn, message: row.applicant_message,
    status: row.status, emailVerifiedAt: row.email_verified_at,
    linkedContactId: row.linked_contact_id == null ? null : Number(row.linked_contact_id),
    reviewedByName: row.reviewed_by_name, reviewedAt: row.reviewed_at,
    reviewReason: row.review_reason, createdAt: row.created_at,
  };
}

export async function listWholesaleApplications(
  businessId: string,
  status?: WholesaleApplicationStatus,
): Promise<WholesaleApplicationReviewRow[]> {
  const params: unknown[] = [businessId];
  const statusClause = status ? ' AND status = ?' : '';
  if (status) params.push(status);
  const [rows] = await getPool().execute<ApplicationDbRow[]>(
    `SELECT id, business_id, company_name, contact_name, email, phone, abn, applicant_message,
            status, email_verified_at, linked_contact_id, reviewed_by_name, reviewed_at,
            review_reason, created_at
       FROM wholesale_signup_requests
      WHERE business_id = ?${statusClause}
      ORDER BY FIELD(status, 'pending_review', 'approving', 'pending_email', 'approved', 'rejected'), created_at DESC
      LIMIT 500`,
    params,
  );
  return rows.map(mapApplication);
}

async function claimApproval(input: {
  businessId: string;
  applicationId: number;
  actorUserId: number;
  actorName: string;
}): Promise<ApplicationDbRow> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<ApplicationDbRow[]>(
      `SELECT * FROM wholesale_signup_requests
        WHERE id = ? AND business_id = ? LIMIT 1 FOR UPDATE`,
      [input.applicationId, input.businessId],
    );
    const application = rows[0];
    if (!application) throw new Error('Wholesale application not found.');
    if (application.status === 'approved') {
      await connection.commit();
      return application;
    }
    if (!['pending_review', 'approving'].includes(application.status)) {
      throw new Error('Only verified pending applications can be approved.');
    }
    if (application.status === 'pending_review') {
      await connection.execute(
        `UPDATE wholesale_signup_requests
            SET status = 'approving', reviewed_by_user_id = ?, reviewed_by_name = ?, updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ? AND business_id = ?`,
        [input.actorUserId, input.actorName, input.applicationId, input.businessId],
      );
      await connection.execute(
        `INSERT INTO wholesale_signup_review_events
           (application_id, business_id, event_type, actor_user_id, actor_name)
         VALUES (?, ?, 'approval_started', ?, ?)`,
        [input.applicationId, input.businessId, input.actorUserId, input.actorName],
      );
    }
    await connection.commit();
    return application;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function ensureApprovedTenantContact(input: {
  businessId: string;
  application: ApplicationDbRow;
  allowedBrands: string[] | null;
  onAccountLimit: number | null;
}): Promise<number> {
  return runImsForBusiness(input.businessId, async () => {
    const connection = await getIMSPool().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, type FROM ims_contacts
          WHERE business_id = ? AND LOWER(email) = ?
          ORDER BY id LIMIT 1 FOR UPDATE`,
        [input.businessId, input.application.email],
      );
      const existing = rows[0] as { id: number; type: string } | undefined;
      const brandsJson = input.allowedBrands === null ? null : JSON.stringify(input.allowedBrands);
      let contactId: number;
      if (existing) {
        const type = existing.type === 'supplier' || existing.type === 'both' ? 'both' : 'b2b_customer';
        await connection.execute(
          `UPDATE ims_contacts
              SET type = ?, price_tier = 'wholesale', is_active = 1,
                  wholesale_allowed_brands_json = ?, on_account_limit = COALESCE(?, on_account_limit),
                  company = COALESCE(NULLIF(company, ''), ?), name = COALESCE(NULLIF(name, ''), ?),
                  phone = COALESCE(NULLIF(phone, ''), ?)
            WHERE id = ? AND business_id = ?`,
          [type, brandsJson, input.onAccountLimit, input.application.company_name,
            input.application.contact_name, input.application.phone, existing.id, input.businessId],
        );
        contactId = Number(existing.id);
      } else {
        const [result] = await connection.execute(
          `INSERT INTO ims_contacts
             (business_id, type, name, company, email, phone, notes, is_active, price_tier,
              wholesale_allowed_brands_json, on_account_limit, charges_tax, prices_include_tax)
            VALUES (?, 'b2b_customer', ?, ?, ?, ?, ?, 1, 'wholesale', ?, ?, 1, 1)`,
          [input.businessId, input.application.contact_name, input.application.company_name,
            input.application.email, input.application.phone,
            input.application.abn ? `Wholesale application ABN: ${input.application.abn}` : null,
            brandsJson, input.onAccountLimit],
        );
        contactId = Number((result as { insertId: number }).insertId);
        await connection.execute(
          `UPDATE ims_contacts SET customer_code = CONCAT('C-', LPAD(?, 6, '0'))
            WHERE id = ? AND (customer_code IS NULL OR customer_code = '')`,
          [contactId, contactId],
        );
      }
      await connection.commit();
      return contactId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });
}

export async function approveWholesaleApplication(input: {
  businessId: string;
  applicationId: number;
  actorUserId: number;
  actorName: string;
  allowedBrands: unknown;
  onAccountLimit?: unknown;
}): Promise<{ contactId: number; replayed: boolean }> {
  const allowedBrands = normalizeWholesaleBrands(input.allowedBrands);
  const parsedLimit = input.onAccountLimit == null || input.onAccountLimit === '' ? null : Number(input.onAccountLimit);
  if (parsedLimit !== null && (!Number.isFinite(parsedLimit) || parsedLimit < 0 || parsedLimit > 100_000_000)) {
    throw new Error('Account limit must be a non-negative number.');
  }
  const application = await claimApproval(input);
  if (application.status === 'approved' && application.linked_contact_id) {
    return { contactId: Number(application.linked_contact_id), replayed: true };
  }
  const contactId = await ensureApprovedTenantContact({
    businessId: input.businessId, application, allowedBrands, onAccountLimit: parsedLimit,
  });

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<ApplicationDbRow[]>(
      `SELECT status, linked_contact_id FROM wholesale_signup_requests
        WHERE id = ? AND business_id = ? LIMIT 1 FOR UPDATE`,
      [input.applicationId, input.businessId],
    );
    const current = rows[0];
    if (current?.status !== 'approved') {
      await connection.execute(
        `UPDATE wholesale_signup_requests
            SET status = 'approved', linked_contact_id = ?, reviewed_by_user_id = ?,
                reviewed_by_name = ?, reviewed_at = CURRENT_TIMESTAMP(3), review_reason = NULL
          WHERE id = ? AND business_id = ? AND status = 'approving'`,
        [contactId, input.actorUserId, input.actorName, input.applicationId, input.businessId],
      );
      await connection.execute(
        `INSERT INTO wholesale_signup_review_events
           (application_id, business_id, event_type, actor_user_id, actor_name, linked_contact_id)
         VALUES (?, ?, 'approved', ?, ?, ?)`,
        [input.applicationId, input.businessId, input.actorUserId, input.actorName, contactId],
      );
    }
    await connection.commit();
    return { contactId, replayed: current?.status === 'approved' };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function rejectWholesaleApplication(input: {
  businessId: string;
  applicationId: number;
  actorUserId: number;
  actorName: string;
  reason: string;
}): Promise<void> {
  const reason = input.reason.trim();
  if (!reason || reason.length > 1000) throw new Error('A rejection reason of 1000 characters or fewer is required.');
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<ApplicationDbRow[]>(
      `SELECT status FROM wholesale_signup_requests
        WHERE id = ? AND business_id = ? LIMIT 1 FOR UPDATE`,
      [input.applicationId, input.businessId],
    );
    if (!rows[0]) throw new Error('Wholesale application not found.');
    if (rows[0].status === 'rejected') {
      await connection.commit();
      return;
    }
    if (rows[0].status !== 'pending_review') throw new Error('Only verified pending applications can be rejected.');
    await connection.execute(
      `UPDATE wholesale_signup_requests
          SET status = 'rejected', reviewed_by_user_id = ?, reviewed_by_name = ?,
              reviewed_at = CURRENT_TIMESTAMP(3), review_reason = ?
        WHERE id = ? AND business_id = ?`,
      [input.actorUserId, input.actorName, reason, input.applicationId, input.businessId],
    );
    await connection.execute(
      `INSERT INTO wholesale_signup_review_events
         (application_id, business_id, event_type, actor_user_id, actor_name, reason)
       VALUES (?, ?, 'rejected', ?, ?, ?)`,
      [input.applicationId, input.businessId, input.actorUserId, input.actorName, reason],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}