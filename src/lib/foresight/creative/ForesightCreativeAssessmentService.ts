import { createHash } from 'node:crypto';
import { BrandProfileRepository, type BrandProfileRow } from '@/lib/db/BrandProfileRepository';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { GoogleAdsService } from '@/services/GoogleAdsService';
import { MetaAdsReadService } from '@/services/MetaAdsReadService';
import type { PlannerModelGateway } from '../assistant/PlannerModelGateway';
import { loadForesightPrompt } from '../prompts/promptManifest';
import { ForesightCreativeRepository, type ForesightCreativeAssessmentRow, type ForesightCreativeRow } from '../repositories/ForesightCreativeRepository';
import { parseCreativeAssessment } from './creativeAssessment';

export interface CreativeMediaEvidence { mimeType: string; data: string; mode: 'image' | 'video_frame' }
interface Dependencies {
  getCreative: typeof ForesightCreativeRepository.get;
  getBrandProfile: typeof BrandProfileRepository.get;
  loadPrompt: typeof loadForesightPrompt;
  saveAssessment: typeof ForesightCreativeRepository.saveAssessment;
  resolveMedia: (businessId: string, creative: ForesightCreativeRow) => Promise<{ url: string; mediaType: 'image' | 'video_frame' } | null>;
  fetchMedia: (url: string, mediaType: 'image' | 'video_frame') => Promise<CreativeMediaEvidence>;
  reportIssue: typeof reportRuntimeIssue;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function profileContext(profile: BrandProfileRow | null): Record<string, string | null> {
  if (!profile) return {};
  return {
    mission: profile.mission, uvp: profile.uvp, tone: profile.tone,
    heroProducts: profile.hero_products, pricePositioning: profile.price_positioning,
    brandColours: profile.brand_colours, detailedBrandAesthetic: profile.detailed_brand_aesthetic,
    praises: profile.praises, objections: profile.objections,
  };
}

const ALLOWED_MEDIA_HOSTS = [
  'googleusercontent.com', 'gstatic.com', 'fbcdn.net', 'facebook.com', 'cdninstagram.com',
];
function allowedMediaUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !ALLOWED_MEDIA_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error('Creative media URL is not from an allowed platform host.');
  }
  return url;
}

async function fetchMedia(urlValue: string, mode: 'image' | 'video_frame'): Promise<CreativeMediaEvidence> {
  const url = allowedMediaUrl(urlValue);
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Creative media fetch failed with HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > 8 * 1024 * 1024) throw new Error('Creative media exceeds the 8 MB assessment limit.');
  const mimeType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw new Error('Creative media must be JPEG, PNG, or WebP.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 8 * 1024 * 1024) throw new Error('Creative media has an invalid size.');
  return { mimeType, data: bytes.toString('base64'), mode };
}

async function resolveMedia(businessId: string, creative: ForesightCreativeRow) {
  const connection = await ConnectionsRepository.get(businessId);
  if (creative.source === 'google_ads') {
    if (creative.creative_kind !== 'asset' || !connection?.google_ads_customer_id || !connection.google_ads_refresh_token) return null;
    return new GoogleAdsService(connection.google_ads_customer_id, decrypt(connection.google_ads_refresh_token))
      .getCreativeMediaReference(creative.external_id);
  }
  if (!connection?.meta_ad_account_id || !connection.meta_access_token) return null;
  return new MetaAdsReadService(decrypt(connection.meta_access_token), connection.meta_ad_account_id)
    .getCreativeMediaReference(creative.external_id);
}

export async function loadCreativeMediaEvidence(
  businessId: string,
  creative: ForesightCreativeRow,
): Promise<CreativeMediaEvidence | null> {
  const reference = await resolveMedia(businessId, creative);
  return reference ? fetchMedia(reference.url, reference.mediaType) : null;
}

const defaults: Dependencies = {
  getCreative: ForesightCreativeRepository.get,
  getBrandProfile: BrandProfileRepository.get,
  loadPrompt: loadForesightPrompt,
  saveAssessment: ForesightCreativeRepository.saveAssessment,
  resolveMedia,
  fetchMedia,
  reportIssue: reportRuntimeIssue,
};

export function createForesightCreativeAssessmentService(dependencies: Dependencies = defaults) {
  return {
    async assess(input: {
      businessId: string; creativeId: number; actorUserId: number; modelId: string; model: PlannerModelGateway;
    }): Promise<ForesightCreativeAssessmentRow> {
      const creative = await dependencies.getCreative(input.businessId, input.creativeId);
      if (!creative) throw new Error('Creative not found.');
      try {
        const [profile, prompt] = await Promise.all([
          dependencies.getBrandProfile(input.businessId),
          dependencies.loadPrompt('creative-assessment'),
        ]);
        const brandProfile = profileContext(profile);
        const creativeSnapshot = {
          id: creative.id, source: creative.source, externalId: creative.external_id,
          creativeKind: creative.creative_kind, name: creative.name, format: creative.format,
          copy: creative.copy_json, stableMediaReferences: creative.media_json,
          firstSeenOn: creative.first_seen_on, lastSeenOn: creative.last_seen_on,
        };
        let media: CreativeMediaEvidence | null = null;
        try {
          const reference = await dependencies.resolveMedia(input.businessId, creative);
          if (reference) media = await dependencies.fetchMedia(reference.url, reference.mediaType);
        } catch (error) {
          await dependencies.reportIssue({ businessId: input.businessId, source: 'ForesightCreativeAssessmentService',
            operation: 'resolve_creative_media', severity: 'warning', title: 'Creative media was unavailable for assessment', error,
            reference: { type: 'foresight_creative', id: creative.id }, context: { source: creative.source } }).catch(() => undefined);
          media = null;
        }
        const evidenceMode = media?.mode ?? 'text_only';
        const creativeSnapshotHash = hash(creativeSnapshot);
        const brandProfileHash = hash(brandProfile);
        const assessmentHash = hash({ creativeSnapshotHash, brandProfileHash, evidenceMode, modelId: input.modelId,
          promptVersion: prompt.version, promptHash: prompt.sha256 });
        const raw = await input.model.generateJson({
          modelId: input.modelId,
          systemInstruction: prompt.content,
          media,
          prompt: JSON.stringify({
            task: 'Assess this creative against the supplied Brand Profile and human creative standards.',
            creative: creativeSnapshot,
            brandProfile,
            humanCreativeStandards: ['Accurate product and offer claims', 'Readable hierarchy and accessible presentation',
              'Brand-consistent tone and visual treatment', 'Placement-appropriate format'],
            evidenceMode,
            requiredIdentity: { schemaVersion: 1 },
          }),
        });
        const assessment = parseCreativeAssessment(raw);
        return dependencies.saveAssessment({
          business_id: input.businessId, creative_id: creative.id, assessment_hash: assessmentHash,
          creative_snapshot_hash: creativeSnapshotHash, brand_profile_hash: brandProfileHash,
          evidence_mode: evidenceMode, model_id: input.modelId, prompt_version: prompt.version,
          prompt_hash: prompt.sha256, assessment_json: assessment, assessed_by: input.actorUserId,
        });
      } catch (error) {
        await dependencies.reportIssue({ businessId: input.businessId, source: 'ForesightCreativeAssessmentService',
          operation: 'assess_creative', severity: 'error', title: 'Foresight creative assessment failed', error,
          reference: { type: 'foresight_creative', id: creative.id }, context: { modelId: input.modelId, source: creative.source } }).catch(() => undefined);
        throw error;
      }
    },
  };
}

export const ForesightCreativeAssessmentService = createForesightCreativeAssessmentService();
