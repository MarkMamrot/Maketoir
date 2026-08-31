import { normalizeGoogleModel } from './modelCatalog';
import type { CanonicalAiModel } from './modelCatalog';

export async function fetchGoogleModels(): Promise<CanonicalAiModel[]> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');
  const models: CanonicalAiModel[] = [];
  let pageToken = '';
  do {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(`Google Models API returned ${response.status}: ${body?.error?.message || 'request failed'}`);
    for (const raw of body.models || []) {
      const model = normalizeGoogleModel(raw);
      if (model) models.push(model);
    }
    pageToken = String(body.nextPageToken || '');
  } while (pageToken);
  if (!models.length) throw new Error('Google Models API returned no models; existing catalog was retained.');
  return models;
}