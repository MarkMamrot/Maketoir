import { assessAmazonReadiness, type AmazonReadinessCheck } from '@/lib/channels/amazonReadiness';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import type { SalesChannelInstance } from '@/lib/channels/types';

export class AmazonActivationBlockedError extends Error {
  constructor(public readonly checks: AmazonReadinessCheck[]) {
    super('Complete every Amazon activation-readiness check before activation.');
  }
}

export async function setAmazonActivation(input: {
  businessId: string;
  channelInstanceId: string;
  active: boolean;
  actorUserId?: number | null;
}): Promise<{ instance: SalesChannelInstance; checks: AmazonReadinessCheck[] | null }> {
  let checks: AmazonReadinessCheck[] | null = null;
  if (input.active) {
    const readiness = await assessAmazonReadiness({
      businessId: input.businessId,
      channelInstanceId: input.channelInstanceId,
    });
    checks = readiness.checks;
    if (!readiness.ready) throw new AmazonActivationBlockedError(readiness.checks);
  }

  const instance = await SalesChannelInstanceRepository.setAmazonActivationForBusiness(input);
  if (!instance) {
    if (input.active) throw new AmazonActivationBlockedError(checks ?? []);
    throw new Error('Amazon sales channel not found.');
  }
  return { instance, checks };
}