import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { ForesightCampaignExperimentValidationError } from '../planning/campaignExperimentDocument';
import { loadForesightPrompt } from '../prompts/promptManifest';
import { CampaignExperimentTransitionError, ForesightCampaignExperimentRepository, type CampaignExperimentVersionRow } from '../repositories/ForesightCampaignExperimentRepository';
import { ForesightCampaignLessonRepository } from '../repositories/ForesightCampaignLessonRepository';
import type { PlannerModelGateway } from './PlannerModelGateway';

export const ForesightCampaignExperimentService = {
  async generate(input: { businessId: string; threadId: number; actorUserId: number; modelId: string; model: PlannerModelGateway; changeReason?: string | null }): Promise<CampaignExperimentVersionRow> {
    try {
      const [lesson, review, previous, prompt] = await Promise.all([
        ForesightCampaignLessonRepository.latest(input.businessId, input.threadId),
        ForesightCampaignLessonRepository.latestReview(input.businessId, input.threadId),
        ForesightCampaignExperimentRepository.latest(input.businessId, input.threadId),
        loadForesightPrompt('campaign-experiment'),
      ]);
      if (!lesson || review?.lesson_version_id !== lesson.id || review.lesson_hash !== lesson.lesson_hash || review.action !== 'accepted') {
        throw new CampaignExperimentTransitionError('An exact human-accepted campaign lesson is required before drafting an experiment.');
      }
      const lessonFactId = `foresight:campaign-lesson:${lesson.id}:v${lesson.version}`;
      const document = await input.model.generateJson({
        modelId: input.modelId, systemInstruction: prompt.content,
        prompt: JSON.stringify({ task: 'Draft a governed non-executable campaign experiment for human review.', currentDate: new Date().toISOString().slice(0, 10),
          requiredIdentity: { schemaVersion: 1, lessonVersionId: lesson.id, lessonHash: lesson.lesson_hash, lessonFactId },
          acceptedLesson: { factId: lessonFactId, title: lesson.lesson_json.title, observations: lesson.lesson_json.observations,
            limitations: lesson.lesson_json.limitations, hypotheses: lesson.lesson_json.hypotheses, suggestedApplications: lesson.lesson_json.suggestedApplications },
          previousExperiment: previous?.experiment_json ?? null }),
      });
      return await ForesightCampaignExperimentRepository.createVersion(input.businessId, input.threadId, {
        lessonVersionId: lesson.id, lessonHash: lesson.lesson_hash, lessonVersion: lesson.version, document,
        modelId: input.modelId, promptVersion: prompt.version, authoredBy: input.actorUserId,
        changeReason: input.changeReason?.trim() || (previous ? 'AI-assisted campaign experiment revision' : 'Initial AI-assisted campaign experiment'),
      });
    } catch (error) {
      if (error instanceof CampaignExperimentTransitionError || error instanceof ForesightCampaignExperimentValidationError) throw error;
      await reportRuntimeIssue({ businessId: input.businessId, source: 'ForesightPlanner', operation: 'draft_campaign_experiment',
        severity: 'error', title: 'Foresight campaign experiment drafting failed', error,
        reference: { type: 'planning_thread', id: input.threadId }, context: { modelId: input.modelId } }).catch(() => undefined);
      throw error;
    }
  },
};