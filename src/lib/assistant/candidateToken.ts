import { signAdminSession, verifyAdminSession } from '@/lib/auth/adminSessionToken';

import type { AssistantWorkflowCandidate } from './orchestrator';
import type { AssistantAudience } from './policy';

const CANDIDATE_TOKEN_MAX_AGE_SECONDS = 15 * 60;

export interface AssistantCandidateTokenData {
  businessId: string;
  audience: AssistantAudience;
  actorType: 'ims_user' | 'pos_user' | 'wholesale_member';
  actorId: string;
  currentView: string | null;
  candidate: AssistantWorkflowCandidate;
  promptVersion: string;
  indexVersion: string;
}

export function signAssistantCandidate(data: AssistantCandidateTokenData): string {
  return signAdminSession(data, { maxAgeSeconds: CANDIDATE_TOKEN_MAX_AGE_SECONDS });
}

export function verifyAssistantCandidate(token: string): AssistantCandidateTokenData | null {
  return verifyAdminSession<AssistantCandidateTokenData>(token);
}

export function candidateMatchesIdentity(
  candidate: AssistantCandidateTokenData,
  identity: Pick<AssistantCandidateTokenData, 'businessId' | 'audience' | 'actorType' | 'actorId'>,
): boolean {
  return candidate.businessId === identity.businessId
    && candidate.audience === identity.audience
    && candidate.actorType === identity.actorType
    && candidate.actorId === identity.actorId;
}