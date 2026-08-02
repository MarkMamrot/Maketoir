import { getPool, query } from '@/services/MySQLService';

export interface MetaExperimentLaunchPackageConfirmationRow {
  id: number;
  business_id: string;
  thread_id: number;
  experiment_version_id: number;
  experiment_hash: string;
  meta_account_id: string;
  control_campaign_id: string;
  treatment_campaign_id: string;
  package_fingerprint: string;
  confirmed_by: number;
  created_at: string;
}

export const ForesightMetaExperimentLaunchPackageRepository = {
  async getForThread(businessId: string, threadId: number): Promise<MetaExperimentLaunchPackageConfirmationRow | null> {
    const rows = await query<MetaExperimentLaunchPackageConfirmationRow>(
      `SELECT * FROM foresight_meta_experiment_launch_package_confirmations
       WHERE business_id = ? AND thread_id = ? ORDER BY id DESC LIMIT 1`,
      [businessId, threadId],
    );
    return rows[0] ?? null;
  },

  async create(businessId: string, threadId: number, input: {
    experimentVersionId: number;
    experimentHash: string;
    metaAccountId: string;
    controlCampaignId: string;
    treatmentCampaignId: string;
    packageFingerprint: string;
    confirmedBy: number;
  }): Promise<MetaExperimentLaunchPackageConfirmationRow> {
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute(
        `INSERT INTO foresight_meta_experiment_launch_package_confirmations
         (business_id, thread_id, experiment_version_id, experiment_hash, meta_account_id, control_campaign_id,
          treatment_campaign_id, package_fingerprint, confirmed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [businessId, threadId, input.experimentVersionId, input.experimentHash, input.metaAccountId,
          input.controlCampaignId, input.treatmentCampaignId, input.packageFingerprint, input.confirmedBy],
      );
      await connection.commit();
      return {
        id: (result as { insertId: number }).insertId, business_id: businessId, thread_id: threadId,
        experiment_version_id: input.experimentVersionId, experiment_hash: input.experimentHash,
        meta_account_id: input.metaAccountId, control_campaign_id: input.controlCampaignId,
        treatment_campaign_id: input.treatmentCampaignId, package_fingerprint: input.packageFingerprint,
        confirmed_by: input.confirmedBy, created_at: new Date().toISOString(),
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
};
