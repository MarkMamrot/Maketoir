import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { MetaAdsReadService } from '@/services/MetaAdsReadService';
import { buildMetaExperimentLaunchPackage, type MetaExperimentLaunchPackage } from './metaExperimentLaunchPackage';
import { ForesightCampaignExperimentRepository } from './repositories/ForesightCampaignExperimentRepository';
import { ForesightMetaExperimentLaunchPackageRepository } from './repositories/ForesightMetaExperimentLaunchPackageRepository';

export class MetaExperimentLaunchPackageValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'MetaExperimentLaunchPackageValidationError'; }
}

export const ForesightMetaExperimentLaunchPackageService = {
  async build(businessId: string, threadId: number, input: {
    experimentVersionId: number;
    experimentHash: string;
    controlCampaignId?: string | null;
    treatmentCampaignId?: string | null;
  }): Promise<MetaExperimentLaunchPackage> {
    const [experiment, review, connection] = await Promise.all([
      ForesightCampaignExperimentRepository.latest(businessId, threadId),
      ForesightCampaignExperimentRepository.latestReview(businessId, threadId),
      ConnectionsRepository.get(businessId),
    ]);
    if (!experiment || experiment.id !== input.experimentVersionId || experiment.experiment_hash !== input.experimentHash) {
      throw new MetaExperimentLaunchPackageValidationError('Only the exact latest campaign experiment can be packaged.');
    }
    if (!review || review.experiment_version_id !== experiment.id || review.experiment_hash !== experiment.experiment_hash || review.action !== 'accepted') {
      throw new MetaExperimentLaunchPackageValidationError('The exact campaign experiment must be human-accepted before packaging.');
    }
    const accountId = connection?.meta_ad_account_id?.trim() ?? '';
    const storedAccessToken = connection?.meta_access_token?.trim() ?? '';
    if (!accountId || !storedAccessToken) {
      throw new MetaExperimentLaunchPackageValidationError('Connect a Meta ad account and tenant access token before packaging this experiment.');
    }
    if (!/^\d+$/.test(accountId.replace(/^act_/i, ''))) {
      throw new MetaExperimentLaunchPackageValidationError('The connected Meta ad account ID is invalid.');
    }
    const campaigns = await new MetaAdsReadService(decrypt(storedAccessToken), accountId).listCampaigns();
    return buildMetaExperimentLaunchPackage({
      experimentVersionId: experiment.id,
      experimentHash: experiment.experiment_hash,
      design: experiment.experiment_json,
      accountId,
      campaigns,
      controlCampaignId: input.controlCampaignId,
      treatmentCampaignId: input.treatmentCampaignId,
      checkedAt: new Date().toISOString(),
    });
  },

  async confirm(businessId: string, threadId: number, input: {
    experimentVersionId: number;
    experimentHash: string;
    controlCampaignId: string;
    treatmentCampaignId: string;
    packageFingerprint: string;
    confirmedBy: number;
  }) {
    const packageResult = await this.build(businessId, threadId, input);
    if (!packageResult.ready || !packageResult.confirmationFingerprint) {
      throw new MetaExperimentLaunchPackageValidationError('The live Meta launch package is not ready for confirmation.');
    }
    if (packageResult.confirmationFingerprint !== input.packageFingerprint) {
      throw new MetaExperimentLaunchPackageValidationError('The live Meta launch package changed; refresh and review it again.');
    }
    const existing = await ForesightMetaExperimentLaunchPackageRepository.getForThread(businessId, threadId);
    if (existing) {
      if (existing.experiment_version_id === input.experimentVersionId && existing.package_fingerprint === input.packageFingerprint) return existing;
      throw new MetaExperimentLaunchPackageValidationError('A different Meta launch package is already confirmed for this experiment.');
    }
    return ForesightMetaExperimentLaunchPackageRepository.create(businessId, threadId, {
      experimentVersionId: input.experimentVersionId, experimentHash: input.experimentHash,
      metaAccountId: packageResult.accountId, controlCampaignId: input.controlCampaignId,
      treatmentCampaignId: input.treatmentCampaignId, packageFingerprint: input.packageFingerprint,
      confirmedBy: input.confirmedBy,
    });
  },
};
