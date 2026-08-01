import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { ForesightCampaignLessonValidationError } from '../planning/campaignLessonDocument';
import { loadForesightPrompt } from '../prompts/promptManifest';
import { ForesightCampaignActivationRepository } from '../repositories/ForesightCampaignActivationRepository';
import {
  CampaignLessonTransitionError,
  ForesightCampaignLessonRepository,
  type CampaignLessonVersionRow,
} from '../repositories/ForesightCampaignLessonRepository';
import type { PlannerModelGateway } from './PlannerModelGateway';

export const ForesightCampaignLessonService = {
  async generate(input: {
    businessId: string; threadId: number; actorUserId: number; modelId: string;
    model: PlannerModelGateway; changeReason?: string | null;
  }): Promise<CampaignLessonVersionRow> {
    try {
      const [activation, outcome, prompt, latest] = await Promise.all([
        ForesightCampaignActivationRepository.getForThread(input.businessId, input.threadId),
        ForesightCampaignActivationRepository.getOutcomeForThread(input.businessId, input.threadId),
        loadForesightPrompt('campaign-learning'),
        ForesightCampaignLessonRepository.latest(input.businessId, input.threadId),
      ]);
      if (!activation || !outcome || outcome.activation_id !== activation.id) {
        throw new CampaignLessonTransitionError('A completed campaign activation outcome is required before drafting a lesson.');
      }
      const outcomeFactId = `foresight:campaign-outcome:${outcome.id}:activation:${activation.id}`;
      const document = await input.model.generateJson({
        modelId: input.modelId,
        systemInstruction: prompt.content,
        prompt: JSON.stringify({
          task: 'Draft a governed campaign lesson for human review.',
          currentDate: new Date().toISOString().slice(0, 10),
          requiredIdentity: { schemaVersion: 1, outcomeId: outcome.id, activationId: activation.id, outcomeFactId },
          auditedOutcomeFact: {
            factId: outcomeFactId,
            activatedOn: activation.activated_on,
            channels: activation.channels_json.map((item) => item.channel),
            productsAndOfferUsed: activation.published_details,
            declaredDeviations: activation.deviations_text,
            assessment: outcome.assessment_json,
          },
          previousLesson: latest?.lesson_json ?? null,
        }),
      });
      return await ForesightCampaignLessonRepository.createVersion(input.businessId, input.threadId, {
        outcomeId: outcome.id, activationId: activation.id, document, modelId: input.modelId,
        promptVersion: prompt.version, authoredBy: input.actorUserId,
        changeReason: input.changeReason?.trim() || (latest ? 'AI-assisted campaign lesson revision' : 'Initial AI-assisted campaign lesson'),
      });
    } catch (error) {
      if (error instanceof CampaignLessonTransitionError || error instanceof ForesightCampaignLessonValidationError) throw error;
      await reportRuntimeIssue({
        businessId: input.businessId, source: 'ForesightPlanner', operation: 'draft_campaign_lesson',
        severity: 'error', title: 'Foresight campaign lesson drafting failed', error,
        reference: { type: 'planning_thread', id: input.threadId }, context: { modelId: input.modelId },
      }).catch(() => undefined);
      throw error;
    }
  },
};