import { fetchGoogleModels } from './googleModels';
import { fetchGoogleRatePreview } from './googlePricing';
import { AiModelCatalogRepository } from './modelCatalogRepository';

export async function refreshGoogleModelCatalog() {
  const models = await fetchGoogleModels();
  const discovery = await AiModelCatalogRepository.discover(models);
  const mappings = await AiModelCatalogRepository.mappings();
  const preview = await fetchGoogleRatePreview(mappings);
  const observations = await AiModelCatalogRepository.recordObservations(preview.observations);
  return { ...discovery, ...observations, preview };
}