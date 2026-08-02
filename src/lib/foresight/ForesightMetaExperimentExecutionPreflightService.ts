import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';
import { DEFAULT_BUSINESS_TIME_ZONE, getBusinessTimeZone } from '@/lib/ims/businessTimeZone';
import { buildMetaExperimentExecutionPreflight } from './metaExperimentExecutionPreflight';
import { ForesightMetaExperimentLaunchPackageService } from './ForesightMetaExperimentLaunchPackageService';
import { ForesightCampaignExperimentRepository } from './repositories/ForesightCampaignExperimentRepository';
import { ForesightMetaExperimentLaunchPackageRepository } from './repositories/ForesightMetaExperimentLaunchPackageRepository';

async function businessDate(businessId: string, now: Date): Promise<string> {
  const timeZone = await runImsForBusiness(businessId, () => getBusinessTimeZone(businessId))
    .catch(() => DEFAULT_BUSINESS_TIME_ZONE);
  return now.toLocaleDateString('sv-SE', { timeZone });
}

export const ForesightMetaExperimentExecutionPreflightService = {
  async preflight(businessId: string, threadId: number, now = new Date()) {
    const [experiment, review, confirmation, connection] = await Promise.all([
      ForesightCampaignExperimentRepository.latest(businessId, threadId),
      ForesightCampaignExperimentRepository.latestReview(businessId, threadId),
      ForesightMetaExperimentLaunchPackageRepository.getForThread(businessId, threadId),
      ConnectionsRepository.get(businessId),
    ]);
    if (!experiment || !review || review.action !== 'accepted' || review.experiment_version_id !== experiment.id
      || review.experiment_hash !== experiment.experiment_hash) throw new Error('The exact latest campaign experiment must be accepted.');
    if (!confirmation || confirmation.experiment_version_id !== experiment.id
      || confirmation.experiment_hash !== experiment.experiment_hash) throw new Error('Confirm the exact Meta launch package before execution preflight.');
    const accountId = connection?.meta_ad_account_id?.trim() ?? '';
    const token = connection?.meta_access_token?.trim() ?? '';
    if (!accountId || !token || accountId.replace(/^act_/i, '') !== confirmation.meta_account_id.replace(/^act_/i, '')) {
      throw new Error('The connected Meta account no longer matches the confirmed launch package.');
    }
    const [livePackage, today] = await Promise.all([
      ForesightMetaExperimentLaunchPackageService.build(businessId, threadId, {
        experimentVersionId: experiment.id, experimentHash: experiment.experiment_hash,
        controlCampaignId: confirmation.control_campaign_id, treatmentCampaignId: confirmation.treatment_campaign_id,
      }),
      businessDate(businessId, now),
    ]);
    if (!livePackage.ready || livePackage.confirmationFingerprint !== confirmation.package_fingerprint) {
      throw new Error('The live Meta launch package changed after confirmation; no execution is authorized.');
    }
    return buildMetaExperimentExecutionPreflight({
      now, businessToday: today, experimentVersionId: experiment.id, experimentHash: experiment.experiment_hash,
      design: experiment.experiment_json, packageConfirmationId: confirmation.id,
      packageFingerprint: confirmation.package_fingerprint, accountId: livePackage.accountId,
      businessManagerId: livePackage.businessManagerId, controlCampaignId: confirmation.control_campaign_id,
      treatmentCampaignId: confirmation.treatment_campaign_id, campaigns: livePackage.candidates,
    });
  },
};
