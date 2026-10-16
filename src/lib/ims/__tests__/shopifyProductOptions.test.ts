import { describe, expect, it } from 'vitest';
import {
  buildShopifyProductOptions, isSimpleShopifyProduct, previewShopifyDefaultOptionRepair,
  type ShopifyProductOptionsSnapshot,
} from '../shopifyProductOptions';

describe('Shopify product options', () => {
  it.each([
    {},
    { option1_name: 'Size', option1_value: 'Default', option2_name: 'Colour' },
    { option1_name: 'Size', option1_value: 'Default', option2_name: 'Colour', option2_value: 'Default' },
    { option1_name: 'Title', option1_value: 'Default Title' },
    { option1_name: 'Size', option1_value: ' DEFAULT ', option2_value: ' default title ' },
  ])('uses the hidden Shopify default for a singleton placeholder: %j', variant => {
    expect(isSimpleShopifyProduct([variant])).toBe(true);
    expect(buildShopifyProductOptions([variant])).toEqual({
      options: undefined, variantOptions: [{ option1: 'Default Title' }],
    });
  });

  it('keeps a genuine option even if there is only one variant', () => {
    const variants = [{ option1_name: 'Size', option1_value: 'One Size', option2_name: 'Colour', option2_value: 'Default' }];
    expect(isSimpleShopifyProduct(variants)).toBe(false);
    expect(buildShopifyProductOptions(variants)).toEqual({
      options: [{ name: 'Size' }], variantOptions: [{ option1: 'One Size' }],
    });
  });

  it('preserves real variant combinations and compacts non-contiguous option axes', () => {
    expect(buildShopifyProductOptions(['Red', 'Blue'].map(colour => ({
      option1_name: 'Size', option1_value: 'Default', option2_name: 'Colour', option2_value: colour,
      option3_name: 'Material', option3_value: 'Cotton',
    })))).toEqual({
      options: [{ name: 'Colour' }, { name: 'Material' }],
      variantOptions: [{ option1: 'Red', option2: 'Cotton' }, { option1: 'Blue', option2: 'Cotton' }],
    });
  });

  it('retains Default within a genuine varying option axis', () => {
    expect(buildShopifyProductOptions(['Default', 'Large'].map(size => ({
      option1_name: 'Size', option1_value: size,
    }))).variantOptions).toEqual([{ option1: 'Default' }, { option1: 'Large' }]);
  });

  it('does not collapse multiple placeholder rows into one Shopify variant', () => {
    expect(() => buildShopifyProductOptions([{ option1_value: 'Default' }, { option1_value: 'Default' }]))
      .toThrow('Multiple Solvantis variants');
    expect(isSimpleShopifyProduct([])).toBe(false);
    expect(buildShopifyProductOptions([])).toEqual({ options: undefined, variantOptions: [] });
  });
});

describe('read-only default-option repair classification', () => {
  const local = [{
    variant_id: 'local', sku: '00123', is_active: 1,
    option1_name: 'Size', option1_value: 'Default', option2_name: 'Colour', option2_value: 'Default',
  }];
  const mapping = [{
    variant_id: 'local', external_product_id: '11', external_variant_id: '22', external_inventory_id: '33',
  }];
  const snapshot = (): ShopifyProductOptionsSnapshot => ({
    id: 'gid://shopify/Product/11', title: 'Vase',
    options: [{ id: 'size', name: 'Size', values: ['Default'] }, { id: 'colour', name: 'Colour', values: ['Default'] }],
    variants: {
      nodes: [{ id: 'gid://shopify/ProductVariant/22', sku: '00123', barcode: '0001', price: '59.00',
        inventoryItem: { id: 'gid://shopify/InventoryItem/33' },
        selectedOptions: [{ name: 'Size', value: 'Default' }, { name: 'Colour', value: 'Default' }] }],
      pageInfo: { hasNextPage: false },
    },
  });

  it('identifies the screenshot shape without mutating its identifiers, SKU, barcode or price', () => {
    const remote = snapshot();
    const before = JSON.stringify(remote);
    expect(previewShopifyDefaultOptionRepair(local, mapping, remote).outcome).toBe('candidate');
    expect(JSON.stringify(remote)).toBe(before);
  });

  it('leaves existing hidden-default products alone', () => {
    const remote = snapshot();
    remote.options = [{ id: 'title', name: 'Title', values: ['Default Title'] }];
    remote.variants.nodes[0].selectedOptions = [{ name: 'Title', value: 'Default Title' }];
    expect(previewShopifyDefaultOptionRepair(local, mapping, remote).outcome).toBe('already_simple');
  });

  it('requires exactly one local and remote variant and never collapses real values', () => {
    expect(previewShopifyDefaultOptionRepair([...local, ...local], mapping, snapshot()).outcome).toBe('review');
    expect(previewShopifyDefaultOptionRepair([{ ...local[0], option1_value: 'One Size' }], mapping, snapshot()).outcome).toBe('review');
    const remote = snapshot();
    remote.variants.pageInfo.hasNextPage = true;
    expect(previewShopifyDefaultOptionRepair(local, mapping, remote).outcome).toBe('review');
    remote.variants.pageInfo.hasNextPage = false;
    remote.variants.nodes.push({ ...remote.variants.nodes[0] });
    expect(previewShopifyDefaultOptionRepair(local, mapping, remote).outcome).toBe('review');
    const real = snapshot();
    real.options[0].values = ['Small'];
    expect(previewShopifyDefaultOptionRepair(local, mapping, real).outcome).toBe('review');
  });

  it('refuses ambiguous or changed mappings, SKUs and inventory identities', () => {
    for (const links of [[], [...mapping, ...mapping], [{ ...mapping[0], external_variant_id: '99' }],
      [{ ...mapping[0], external_product_id: '99' }], [{ ...mapping[0], external_inventory_id: null }]]) {
      expect(previewShopifyDefaultOptionRepair(local, links, snapshot()).outcome).toBe('review');
    }
    expect(previewShopifyDefaultOptionRepair([{ ...local[0], sku: 'NEW' }], mapping, snapshot()).outcome).toBe('review');
    expect(previewShopifyDefaultOptionRepair([{ ...local[0], is_active: 0 }], mapping, snapshot()).outcome).toBe('review');
  });
});
