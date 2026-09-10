import { describe, expect, it } from 'vitest';

import {
  aggregateBuildComponentDemand,
  assertAcyclicBuildRecipes,
  calculateBuildUnitCost,
  calculateReversalComponents,
  hashProductBuildRequest,
  planBuildableOutputQuantities,
  ProductBuildValidationError,
  validateBuildRecipe,
} from '../builds/domain';
import {
  calculateBuildFromSaleShortfall,
  isBuildFromSaleEnabled,
  planBuildFromSaleShortfalls,
  parseBuildFromSaleOverride,
  validateBuildFromSaleSetting,
} from '../builds/buildFromSalePolicy';
import { planOrderBuildRequirements } from '../builds/buildRequirementService';

const recipe = {
  outputVariantId: 'gift-set',
  revision: 3,
  overheadPerOutput: 1.25,
  components: [
    { variantId: 'mug', quantityPerOutput: 2, averageCost: 4 },
    { variantId: 'box', quantityPerOutput: 1, averageCost: 0.75 },
  ],
};

describe('product build domain', () => {
  it('validates recipes and calculates tax-exclusive unit cost with overhead', () => {
    expect(validateBuildRecipe(recipe)).toEqual(recipe);
    expect(calculateBuildUnitCost(recipe)).toBe(10);
    expect(calculateBuildUnitCost(recipe, 2)).toBe(10.75);
  });

  it('rejects duplicate, self-referencing, over-precision, and cyclic recipes', () => {
    expect(() => validateBuildRecipe({ ...recipe, components: [recipe.components[0], recipe.components[0]] }))
      .toThrow(/duplicated/);
    expect(() => validateBuildRecipe({ ...recipe, components: [{ variantId: 'gift-set', quantityPerOutput: 1 }] }))
      .toThrow(/cannot consume itself/);
    expect(() => validateBuildRecipe({ ...recipe, components: [{ variantId: 'mug', quantityPerOutput: 1.00001 }] }))
      .toThrow(/four decimal/);
    expect(() => assertAcyclicBuildRecipes([
      { outputVariantId: 'a', revision: 1, components: [{ variantId: 'b', quantityPerOutput: 1 }] },
      { outputVariantId: 'b', revision: 1, components: [{ variantId: 'a', quantityPerOutput: 1 }] },
    ])).toThrow(/cycle/);
  });

  it('aggregates shared component demand at four-decimal precision', () => {
    const recipes = new Map([
      ['gift-set', recipe],
      ['double-set', { outputVariantId: 'double-set', revision: 1, components: [{ variantId: 'mug', quantityPerOutput: 0.3333 }] }],
    ]);
    expect(Object.fromEntries(aggregateBuildComponentDemand([
      { outputVariantId: 'gift-set', quantity: 1.5, recipeRevision: 3 },
      { outputVariantId: 'double-set', quantity: 3 },
    ], recipes))).toEqual({ mug: 3.9999, box: 1.5 });
  });

  it('allocates shared component capacity across build outputs without double counting', () => {
    const recipes = new Map<string, typeof recipe>([
      ['gift-set', recipe],
      ['second-set', { ...recipe, outputVariantId: 'second-set' }],
    ]);
    expect(planBuildableOutputQuantities([
      { outputVariantId: 'gift-set', quantity: 2 },
      { outputVariantId: 'second-set', quantity: 2 },
    ], recipes, new Map([['mug', 5], ['box', 3]]))).toEqual([
      { outputVariantId: 'gift-set', requestedQuantity: 2, buildableQuantity: 2, unavailableQuantity: 0 },
      { outputVariantId: 'second-set', requestedQuantity: 2, buildableQuantity: 0.5, unavailableQuantity: 1.5 },
    ]);
  });

  it('rejects stale recipes and same-batch output/component chaining', () => {
    const recipes = new Map([['gift-set', recipe]]);
    expect(() => aggregateBuildComponentDemand([
      { outputVariantId: 'gift-set', quantity: 1, recipeRevision: 2 },
    ], recipes)).toThrow(/changed/);
    expect(() => aggregateBuildComponentDemand([
      { outputVariantId: 'gift-set', quantity: 1 },
      { outputVariantId: 'mug', quantity: 1 },
    ], new Map([...recipes, ['mug', { outputVariantId: 'mug', revision: 1, components: [{ variantId: 'clay', quantityPerOutput: 1 }] }]])))
      .toThrow(/both an output and a component/);
  });

  it('calculates exact partial reversal proportions and caps cumulative reversal', () => {
    expect(calculateReversalComponents(1.25, 4, 1.5, recipe.components)).toEqual([
      { variantId: 'mug', quantity: 2.5 },
      { variantId: 'box', quantity: 1.25 },
    ]);
    expect(() => calculateReversalComponents(2.5001, 4, 1.5, recipe.components))
      .toThrow(ProductBuildValidationError);
  });

  it('hashes equivalent request objects identically regardless of key order', () => {
    expect(hashProductBuildRequest({ locationId: 2, builds: [{ quantity: 1, variantId: 'x' }] }))
      .toBe(hashProductBuildRequest({ builds: [{ variantId: 'x', quantity: 1 }], locationId: 2 }));
  });
});

describe('build from sale policy', () => {
  it('defaults off and respects inherited location overrides', () => {
    expect(parseBuildFromSaleOverride('unexpected')).toBe('inherit');
    expect(isBuildFromSaleEnabled(undefined)).toBe(false);
    expect(isBuildFromSaleEnabled('yes', 'inherit')).toBe(true);
    expect(isBuildFromSaleEnabled('yes', 'disabled')).toBe(false);
    expect(isBuildFromSaleEnabled('no', 'enabled')).toBe(true);
  });

  it('builds only the current finished-stock shortfall', () => {
    expect(calculateBuildFromSaleShortfall(5, 2)).toBe(3);
    expect(calculateBuildFromSaleShortfall(5, 8)).toBe(0);
  });

  it('validates business and location settings', () => {
    expect(validateBuildFromSaleSetting('build_from_sale_enabled', ' YES ')).toBe('yes');
    expect(validateBuildFromSaleSetting('build_from_sale_location:12', 'disabled')).toBe('disabled');
    expect(validateBuildFromSaleSetting('unrelated', 'anything')).toBeNull();
    expect(() => validateBuildFromSaleSetting('build_from_sale_location:12', 'sometimes')).toThrow(/inherit/);
  });

  it('aggregates duplicate sale lines before planning finished-stock shortfalls', () => {
    expect(planBuildFromSaleShortfalls([
      { variantId: 'gift-set', quantity: 2, sourceLineId: '11' },
      { variantId: 'gift-set', quantity: 3, sourceLineId: '12' },
      { variantId: 'mug', quantity: 1, sourceLineId: '13' },
    ], new Map([['gift-set', 1.5], ['mug', 2]]))).toEqual([{
      outputVariantId: 'gift-set',
      requestedQuantity: 5,
      usableFinishedQuantity: 1.5,
      shortfall: 3.5,
      sourceLineIds: ['11', '12'],
    }]);
  });
});

describe('order build requirements', () => {
  it('does not subtract a confirmed order own commitment twice', () => {
    expect(planOrderBuildRequirements({
      status: 'confirmed',
      lines: [{ itemId: 7, variantId: 'gift-set', orderedQuantity: 5, fulfilledQuantity: 0, recipeRevision: 3 }],
      stockByVariant: new Map([['gift-set', { onHand: 3, committed: 5 }]]),
    })).toEqual([{ salesOrderItemId: 7, outputVariantId: 'gift-set', detectedShortfall: 2, recipeRevision: 3 }]);
  });

  it('allocates shared usable finished stock across duplicate lines once', () => {
    expect(planOrderBuildRequirements({
      status: 'draft',
      lines: [
        { itemId: 7, variantId: 'gift-set', orderedQuantity: 2, fulfilledQuantity: 0, recipeRevision: 3 },
        { itemId: 8, variantId: 'gift-set', orderedQuantity: 3, fulfilledQuantity: 0, recipeRevision: 3 },
      ],
      stockByVariant: new Map([['gift-set', { onHand: 3, committed: 0 }]]),
    })).toEqual([{ salesOrderItemId: 8, outputVariantId: 'gift-set', detectedShortfall: 2, recipeRevision: 3 }]);
  });
});