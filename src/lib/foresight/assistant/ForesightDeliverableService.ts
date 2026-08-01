import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import {
  ForesightDeliverableValidationError,
  type DeliverableChannel,
} from '../planning/deliverableDocument';
import { loadForesightPrompt } from '../prompts/promptManifest';
import {
  DeliverableTransitionError,
  ForesightDeliverableRepository,
  type DeliverableVersionRow,
} from '../repositories/ForesightDeliverableRepository';
import { ForesightPlanningRepository } from '../repositories/ForesightPlanningRepository';
import type { PlannerModelGateway } from './PlannerModelGateway';

export const FORESIGHT_DELIVERABLE_CHANNELS: DeliverableChannel[] = [
  'campaign_brief', 'meta', 'google_ads', 'klaviyo',
];

export const ForesightDeliverableService = {
  async generate(input: {
    businessId: string;
    threadId: number;
    actorUserId: number;
    modelId: string;
    model: PlannerModelGateway;
    channels: DeliverableChannel[];
    changeReason?: string | null;
  }): Promise<DeliverableVersionRow> {
    const channels = [...new Set(input.channels)].filter((channel) => FORESIGHT_DELIVERABLE_CHANNELS.includes(channel));
    if (channels.length === 0) throw new DeliverableTransitionError('Select at least one supported deliverable channel.');
    try {
      const [plan, prompt, facts, latestDeliverable] = await Promise.all([
        ForesightDeliverableRepository.acceptedPlan(input.businessId, input.threadId),
        loadForesightPrompt('campaign-deliverables'),
        ForesightPlanningRepository.listThreadFacts(input.businessId, input.threadId),
        ForesightDeliverableRepository.latest(input.businessId, input.threadId),
      ]);
      if (!plan) throw new DeliverableTransitionError('An accepted plan is required before drafting deliverables.');
      const acceptedFactIds = new Set(plan.plan_json.citations.map((citation) => citation.factId));
      const acceptedFacts = facts.filter((fact) => acceptedFactIds.has(fact.factId));
      const rawDocument = await input.model.generateJson({
        modelId: input.modelId,
        systemInstruction: prompt.content,
        prompt: JSON.stringify({
          task: 'Draft a complete non-publishable campaign deliverable document for the requested channels.',
          currentDate: new Date().toISOString().slice(0, 10),
          requestedChannels: channels,
          acceptedPlan: plan.plan_json,
          auditedFacts: acceptedFacts,
          previousDeliverable: latestDeliverable?.document_json ?? null,
          requiredIdentity: { planVersionId: plan.id, planHash: plan.plan_hash, schemaVersion: 1 },
        }),
      });
      return await ForesightDeliverableRepository.createVersion(input.businessId, input.threadId, {
        planVersionId: plan.id,
        planHash: plan.plan_hash,
        knownFactIds: [...acceptedFactIds],
        document: rawDocument,
        modelId: input.modelId,
        promptVersion: prompt.version,
        authoredBy: input.actorUserId,
        changeReason: input.changeReason?.trim() || (latestDeliverable ? 'AI-assisted deliverable revision' : 'Initial AI-assisted deliverable draft'),
      });
    } catch (error) {
      if (error instanceof DeliverableTransitionError || error instanceof ForesightDeliverableValidationError) throw error;
      await reportRuntimeIssue({
        businessId: input.businessId,
        source: 'ForesightPlanner',
        operation: 'draft_campaign_deliverables',
        severity: 'error',
        title: 'Foresight campaign deliverable drafting failed',
        error,
        reference: { type: 'planning_thread', id: input.threadId },
        context: { modelId: input.modelId, channels },
      }).catch(() => undefined);
      throw error;
    }
  },
};