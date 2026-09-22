import { query, execute } from '@/services/MySQLService';

export type BusinessApplicationFlow = 'new_user' | 'existing_user';
export type BusinessApplicationStatus = 'pending_review' | 'approved' | 'rejected';

export interface BusinessApplicationRow {
  id: number;
  flow_type: BusinessApplicationFlow;
  applicant_user_id: number;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  business_name: string;
  website: string | null;
  business_type: string | null;
  location_count_band: string | null;
  channels: string | null;
  revenue_band: string | null;
  country: string | null;
  abn: string | null;
  notes: string | null;
  status: BusinessApplicationStatus;
  reviewed_by_user_id: number | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  resulting_business_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateBusinessApplicationInput {
  flowType: BusinessApplicationFlow;
  applicantUserId: number;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  businessName: string;
  website?: string | null;
  businessType?: string | null;
  locationCountBand?: string | null;
  channels?: string | null;
  revenueBand?: string | null;
  country?: string | null;
  abn?: string | null;
  notes?: string | null;
}

export const BusinessApplicationsRepository = {
  async create(input: CreateBusinessApplicationInput): Promise<number> {
    const result = await execute(
      `INSERT INTO business_applications
         (flow_type, applicant_user_id, contact_name, contact_email, contact_phone,
          business_name, website, business_type, location_count_band, channels, revenue_band,
          country, abn, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.flowType, input.applicantUserId,
        input.contactName ?? null, input.contactEmail ?? null, input.contactPhone ?? null,
        input.businessName, input.website ?? null, input.businessType ?? null, input.locationCountBand ?? null,
        input.channels ?? null, input.revenueBand ?? null,
        input.country ?? null, input.abn ?? null, input.notes ?? null,
      ],
    );
    await execute(
      `INSERT INTO business_application_events (application_id, event_type, actor_user_id, actor_name)
       VALUES (?, 'submitted', ?, ?)`,
      [result.insertId, input.applicantUserId, input.contactName ?? null],
    );
    return result.insertId;
  },

  async findLatestForUser(userId: number): Promise<BusinessApplicationRow | null> {
    const rows = await query<BusinessApplicationRow>(
      `SELECT * FROM business_applications
        WHERE applicant_user_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  },

  async findById(id: number): Promise<BusinessApplicationRow | null> {
    const rows = await query<BusinessApplicationRow>(
      `SELECT * FROM business_applications WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async list(status?: BusinessApplicationStatus): Promise<BusinessApplicationRow[]> {
    if (status) {
      return query<BusinessApplicationRow>(
        `SELECT * FROM business_applications WHERE status = ? ORDER BY created_at DESC`,
        [status],
      );
    }
    return query<BusinessApplicationRow>(`SELECT * FROM business_applications ORDER BY created_at DESC`);
  },

  async approve(id: number, reviewer: { userId: number; name: string }, resultingBusinessId: string): Promise<void> {
    await execute(
      `UPDATE business_applications
          SET status = 'approved', reviewed_by_user_id = ?, reviewed_by_name = ?,
              reviewed_at = CURRENT_TIMESTAMP(3), resulting_business_id = ?
        WHERE id = ?`,
      [reviewer.userId, reviewer.name, resultingBusinessId, id],
    );
    await execute(
      `INSERT INTO business_application_events (application_id, event_type, actor_user_id, actor_name)
       VALUES (?, 'approved', ?, ?)`,
      [id, reviewer.userId, reviewer.name],
    );
  },

  async reject(id: number, reviewer: { userId: number; name: string }, reason: string): Promise<void> {
    await execute(
      `UPDATE business_applications
          SET status = 'rejected', reviewed_by_user_id = ?, reviewed_by_name = ?,
              reviewed_at = CURRENT_TIMESTAMP(3), review_reason = ?
        WHERE id = ?`,
      [reviewer.userId, reviewer.name, reason, id],
    );
    await execute(
      `INSERT INTO business_application_events (application_id, event_type, actor_user_id, actor_name, reason)
       VALUES (?, 'rejected', ?, ?, ?)`,
      [id, reviewer.userId, reviewer.name, reason],
    );
  },
};
