import { createHash } from 'crypto';

const QUANTITY_SCALE = 10_000;

export class ProductBuildValidationError extends Error {}

export type BuildRecipeComponent = {
  variantId: string;
  quantityPerOutput: number;
  averageCost?: number;
};

export type BuildRecipe = {
  outputVariantId: string;
  revision: number;
  components: BuildRecipeComponent[];
  overheadPerOutput?: number;
};

export type BuildRequest = {
  outputVariantId: string;
  quantity: number;
  recipeRevision?: number;
  overheadPerOutput?: number;
};

export function scaledBuildQuantity(value: number, label = 'Quantity'): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new ProductBuildValidationError(`${label} must be a finite number.`);
  const scaled = Math.round(numeric * QUANTITY_SCALE);
  if (Math.abs(numeric * QUANTITY_SCALE - scaled) > 0.000001) {
    throw new ProductBuildValidationError(`${label} may have at most four decimal places.`);
  }
  return scaled;
}

export function buildQuantity(value: number, label = 'Quantity'): number {
  return scaledBuildQuantity(value, label) / QUANTITY_SCALE;
}

export function positiveBuildQuantity(value: number, label = 'Quantity'): number {
  const normalized = buildQuantity(value, label);
  if (normalized <= 0) throw new ProductBuildValidationError(`${label} must be greater than zero.`);
  return normalized;
}

export function validateBuildRecipe(recipe: BuildRecipe): BuildRecipe {
  const outputVariantId = String(recipe.outputVariantId ?? '').trim();
  if (!outputVariantId) throw new ProductBuildValidationError('An output variant is required.');
  if (!Number.isInteger(recipe.revision) || recipe.revision <= 0) {
    throw new ProductBuildValidationError('Recipe revision must be a positive integer.');
  }
  if (!Array.isArray(recipe.components) || recipe.components.length === 0) {
    throw new ProductBuildValidationError('At least one component is required.');
  }

  const seen = new Set<string>();
  const components = recipe.components.map((component, index) => {
    const variantId = String(component.variantId ?? '').trim();
    if (!variantId) throw new ProductBuildValidationError(`Component ${index + 1} requires a variant.`);
    if (variantId === outputVariantId) throw new ProductBuildValidationError('An output variant cannot consume itself.');
    if (seen.has(variantId)) throw new ProductBuildValidationError(`Component ${variantId} is duplicated.`);
    seen.add(variantId);
    const averageCost = component.averageCost == null ? undefined : Number(component.averageCost);
    if (averageCost != null && (!Number.isFinite(averageCost) || averageCost < 0)) {
      throw new ProductBuildValidationError(`Component ${variantId} has an invalid average cost.`);
    }
    return {
      variantId,
      quantityPerOutput: positiveBuildQuantity(component.quantityPerOutput, `Component ${variantId} quantity`),
      ...(averageCost == null ? {} : { averageCost }),
    };
  });

  const overheadPerOutput = Number(recipe.overheadPerOutput ?? 0);
  if (!Number.isFinite(overheadPerOutput) || overheadPerOutput < 0) {
    throw new ProductBuildValidationError('Overhead per output must be zero or greater.');
  }
  return { outputVariantId, revision: recipe.revision, components, overheadPerOutput };
}

export function assertAcyclicBuildRecipes(recipes: ReadonlyArray<BuildRecipe>): void {
  const graph = new Map<string, string[]>();
  for (const rawRecipe of recipes) {
    const recipe = validateBuildRecipe(rawRecipe);
    graph.set(recipe.outputVariantId, recipe.components.map(component => component.variantId));
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (variantId: string) => {
    if (visiting.has(variantId)) throw new ProductBuildValidationError(`Build recipe cycle detected at ${variantId}.`);
    if (visited.has(variantId)) return;
    visiting.add(variantId);
    for (const componentId of graph.get(variantId) ?? []) {
      if (graph.has(componentId)) visit(componentId);
    }
    visiting.delete(variantId);
    visited.add(variantId);
  };
  for (const outputVariantId of graph.keys()) visit(outputVariantId);
}

export function aggregateBuildComponentDemand(
  requests: ReadonlyArray<BuildRequest>,
  recipes: ReadonlyMap<string, BuildRecipe>,
): Map<string, number> {
  const outputIds = new Set<string>();
  const demandScaled = new Map<string, number>();
  for (const request of requests) {
    const outputVariantId = String(request.outputVariantId ?? '').trim();
    if (!outputVariantId) throw new ProductBuildValidationError('Every build requires an output variant.');
    if (outputIds.has(outputVariantId)) throw new ProductBuildValidationError(`Output ${outputVariantId} is duplicated in the batch.`);
    outputIds.add(outputVariantId);
    const quantity = positiveBuildQuantity(request.quantity, `Output ${outputVariantId} quantity`);
    const recipe = validateBuildRecipe(recipes.get(outputVariantId) as BuildRecipe);
    if (request.recipeRevision != null && request.recipeRevision !== recipe.revision) {
      throw new ProductBuildValidationError(`Recipe for ${outputVariantId} changed. Refresh and try again.`);
    }
    for (const component of recipe.components) {
      const requiredScaled = scaledBuildQuantity(quantity * component.quantityPerOutput, `Component ${component.variantId} requirement`);
      demandScaled.set(component.variantId, (demandScaled.get(component.variantId) ?? 0) + requiredScaled);
    }
  }
  for (const outputId of outputIds) {
    if (demandScaled.has(outputId)) {
      throw new ProductBuildValidationError(`Variant ${outputId} cannot be both an output and a component in one batch.`);
    }
  }
  return new Map([...demandScaled].map(([variantId, scaled]) => [variantId, scaled / QUANTITY_SCALE]));
}

export function planBuildableOutputQuantities(
  requests: ReadonlyArray<BuildRequest>,
  recipes: ReadonlyMap<string, BuildRecipe>,
  availableByComponent: ReadonlyMap<string, number>,
): Array<{ outputVariantId: string; requestedQuantity: number; buildableQuantity: number; unavailableQuantity: number }> {
  const remaining = new Map([...availableByComponent].map(([variantId, available]) => [
    variantId,
    Math.max(0, buildQuantity(available, `Component ${variantId} available quantity`)),
  ]));
  return requests.map(request => {
    const requestedQuantity = positiveBuildQuantity(request.quantity, `Output ${request.outputVariantId} quantity`);
    const recipe = validateBuildRecipe(recipes.get(request.outputVariantId) as BuildRecipe);
    let buildableQuantity = requestedQuantity;
    for (const component of recipe.components) {
      const available = remaining.get(component.variantId) ?? 0;
      const capacity = Math.floor(((available / component.quantityPerOutput) * QUANTITY_SCALE) + 0.000001) / QUANTITY_SCALE;
      buildableQuantity = Math.min(buildableQuantity, capacity);
    }
    buildableQuantity = buildQuantity(Math.max(0, buildableQuantity));
    for (const component of recipe.components) {
      remaining.set(component.variantId, buildQuantity(Math.max(
        0,
        (remaining.get(component.variantId) ?? 0) - (buildableQuantity * component.quantityPerOutput),
      )));
    }
    return {
      outputVariantId: request.outputVariantId,
      requestedQuantity,
      buildableQuantity,
      unavailableQuantity: buildQuantity(requestedQuantity - buildableQuantity),
    };
  });
}

export function calculateBuildUnitCost(recipe: BuildRecipe, overheadOverride?: number): number {
  const valid = validateBuildRecipe(recipe);
  const overhead = overheadOverride == null ? Number(valid.overheadPerOutput ?? 0) : Number(overheadOverride);
  if (!Number.isFinite(overhead) || overhead < 0) throw new ProductBuildValidationError('Overhead per output must be zero or greater.');
  return valid.components.reduce((total, component) => (
    total + component.quantityPerOutput * Number(component.averageCost ?? 0)
  ), overhead);
}

export function calculateReversalComponents(
  quantityToReverse: number,
  quantityBuilt: number,
  quantityAlreadyReversed: number,
  components: ReadonlyArray<BuildRecipeComponent>,
): Array<{ variantId: string; quantity: number }> {
  const reverse = positiveBuildQuantity(quantityToReverse, 'Reversal quantity');
  const built = positiveBuildQuantity(quantityBuilt, 'Built quantity');
  const alreadyReversed = buildQuantity(quantityAlreadyReversed, 'Previously reversed quantity');
  if (alreadyReversed < 0 || scaledBuildQuantity(reverse + alreadyReversed) > scaledBuildQuantity(built)) {
    throw new ProductBuildValidationError('Reversal quantity exceeds the unreversed build quantity.');
  }
  return components.map(component => ({
    variantId: component.variantId,
    quantity: buildQuantity(reverse * positiveBuildQuantity(component.quantityPerOutput, `Component ${component.variantId} quantity`)),
  }));
}

export function hashProductBuildRequest(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]));
    }
    return input;
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}