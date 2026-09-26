import { evaluateChannelProducts } from '@/lib/channels/channelProductAssignmentRepository';
import { runImsForBusiness } from '@/lib/db/BusinessRegistry';

export async function runChannelProductAssignmentAutomation(input: {
  businessId: string;
  channelInstanceId: string;
  mode: 'add_matches';
  batchSize?: number;
}): Promise<{ evaluated: number; batches: number }> {
  const batchSize = Math.max(1, Math.min(500, Math.floor(input.batchSize ?? 500)));
  return runImsForBusiness(input.businessId, async () => {
    let evaluated = 0;
    let batches = 0;
    for (let offset = 0; ; offset += batchSize) {
      const result = await evaluateChannelProducts({
        businessId: input.businessId,
        channelInstanceId: input.channelInstanceId,
        assignmentMode: input.mode,
        apply: true,
        limit: batchSize,
        offset,
      });
      evaluated += result.applied;
      batches += 1;
      if (result.products.length < batchSize) break;
    }
    return { evaluated, batches };
  });
}