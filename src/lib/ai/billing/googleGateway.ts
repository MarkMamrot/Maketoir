import { GoogleGenAI } from '@google/genai';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { AiBillingRepository } from './repository';
import { AiUsageService, normalizeUsageMetadata } from './service';
import type { AiBillingContext, AiUsageUnits } from './types';

const EMPTY: AiUsageUnits = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, thinkingTokens: 0, outputImageTokens: 0, outputImages: 0, videoSeconds: 0 };

function estimatedImageOutputTokens(modelId: string): number {
  if (modelId.includes('3.1-flash-lite-image')) return 1120;
  if (modelId.includes('3.1-flash-image')) return 2520;
  if (modelId.includes('3-pro-image')) return 2000;
  if (modelId.includes('2.5-flash-image')) return 1290;
  return 0;
}

function estimateTextUnits(request: any): AiUsageUnits {
  let serialized = '';
  try { serialized = JSON.stringify(request?.contents ?? ''); } catch {}
  const responseModalities = request?.config?.responseModalities ?? request?.generationConfig?.responseModalities ?? [];
  const imageOutput = Array.isArray(responseModalities) && responseModalities.some((value: unknown) => String(value).toLowerCase() === 'image');
  return {
    ...EMPTY,
    inputTokens: Math.max(1, Math.ceil(serialized.length / 4)),
    outputTokens: Number(request?.generationConfig?.maxOutputTokens ?? request?.config?.maxOutputTokens ?? 8192),
    outputImages: imageOutput ? 1 : 0,
  };
}

function countOutputImages(response: any): number {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  return candidates.reduce((total: number, candidate: any) => total + (candidate?.content?.parts ?? []).filter((part: any) => part?.inlineData?.mimeType?.startsWith('image/')).length, 0);
}

function definiteRejection(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error);
  return /INVALID_ARGUMENT|PERMISSION_DENIED|UNAUTHENTICATED|NOT_FOUND|\b400\b|\b401\b|\b403\b|\b404\b/i.test(detail);
}

async function trackedCall<T>(
  context: AiBillingContext,
  modelId: string,
  estimatedUnits: AiUsageUnits,
  transport: () => Promise<T>,
  actualUnits: (response: T) => AiUsageUnits | Promise<AiUsageUnits>,
): Promise<T> {
  const reservation = await AiUsageService.beginCall(context, modelId, estimatedUnits);
  await AiBillingRepository.markSubmitted(reservation.callId);
  try {
    const response = await transport();
    await AiUsageService.settleCall(reservation, await actualUnits(response));
    return response;
  } catch (error) {
    const lifecycle = definiteRejection(error) ? 'released' : 'unknown';
    await AiBillingRepository.release(reservation.callId, lifecycle, error instanceof Error ? error.message : String(error)).catch(releaseError => {
      void reportRuntimeIssue({ businessId: context.businessId, source: 'ai-billing', operation: 'release_reservation', title: 'AI reservation release failed', error: releaseError, context: { callId: reservation.callId, lifecycle }, reference: { type: 'ai_usage_call', id: reservation.callId } });
    });
    void reportRuntimeIssue({ businessId: context.businessId, source: 'ai-provider', operation: context.operation, severity: lifecycle === 'unknown' ? 'error' : 'warning', title: 'AI provider call failed', error, context: { callId: reservation.callId, area: context.area, modelId, lifecycle }, reference: { type: 'ai_usage_call', id: reservation.callId } });
    throw error;
  }
}

export function createTrackedGoogleGenAI(apiKey: string, context: AiBillingContext): GoogleGenAI {
  const client = new GoogleGenAI({ apiKey });
  const models = client.models as any;
  const generateContent = models.generateContent.bind(models);
  const generateImages = typeof models.generateImages === 'function' ? models.generateImages.bind(models) : null;
  const generateVideos = typeof models.generateVideos === 'function' ? models.generateVideos.bind(models) : null;
  const interactions = (client as any).interactions;
  const createInteraction = typeof interactions?.create === 'function' ? interactions.create.bind(interactions) : null;

  models.generateContent = (request: any) => trackedCall(
    context,
    String(request.model),
    { ...estimateTextUnits(request), outputImageTokens: estimatedImageOutputTokens(String(request.model)) },
    () => generateContent(request),
    response => ({ ...normalizeUsageMetadata((response as any)?.usageMetadata), outputImages: countOutputImages(response) }),
  );

  if (generateImages) {
    models.generateImages = (request: any) => trackedCall(
      { ...context, area: 'product_creative_image' },
      String(request.model),
      { ...EMPTY, outputImages: Number(request?.config?.numberOfImages ?? 1) },
      () => generateImages(request),
      response => ({ ...EMPTY, outputImages: Number((response as any)?.generatedImages?.length ?? request?.config?.numberOfImages ?? 1) }),
    );
  }

  if (generateVideos) {
    models.generateVideos = (request: any) => {
      const seconds = Number(request?.config?.durationSeconds ?? 8);
      return trackedCall(
        { ...context, area: 'product_creative_video' },
        String(request.model),
        { ...EMPTY, videoSeconds: seconds },
        () => generateVideos(request),
        () => ({ ...EMPTY, videoSeconds: seconds }),
      );
    };
  }

  if (createInteraction) {
    interactions.create = (request: any) => trackedCall(
      { ...context, area: 'product_creative_image' },
      String(request.model),
      { ...estimateTextUnits({ contents: request.input }), outputImageTokens: estimatedImageOutputTokens(String(request.model)), outputImages: 1 },
      () => createInteraction(request),
      response => {
        const usage = normalizeUsageMetadata((response as any)?.usageMetadata);
        return { ...usage, outputImageTokens: usage.outputImageTokens || estimatedImageOutputTokens(String(request.model)), outputImages: Math.max(1, Number((response as any)?.outputs?.length ?? 1)) };
      },
    );
  }

  return client;
}

export async function trackedGenerateContentRest(
  apiKey: string,
  modelId: string,
  body: unknown,
  context: AiBillingContext,
  signal?: AbortSignal,
): Promise<Response> {
  return trackedCall(
    context,
    modelId,
    estimateTextUnits(body),
    async () => {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
      });
      if (!response.ok) throw new Error(`Gemini REST request failed with HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      return response;
    },
    async response => normalizeUsageMetadata((await response.clone().json())?.usageMetadata),
  );
}

export const AI_PLATFORM_ACCOUNT_ID = '__solvantis_platform__';