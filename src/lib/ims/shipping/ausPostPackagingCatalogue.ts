import type { PackagePresetInput } from './shippingSettings';

export type AusPostPackagingCategory = 'Parcel satchels' | 'International satchels' | 'Letters and envelopes' | 'Jiffy ShurTuff satchels' | 'Mailing boxes';

export type AusPostPackagingPreset = PackagePresetInput & {
  catalogueId: string;
  category: AusPostPackagingCategory;
};

function preset(
  catalogueId: string,
  category: AusPostPackagingCategory,
  name: string,
  packageType: PackagePresetInput['packageType'],
  dimensionsCm: [number, number, number],
  maxWeightKg: number,
): AusPostPackagingPreset {
  return {
    catalogueId,
    category,
    name,
    packageType,
    lengthMm: dimensionsCm[0] * 10,
    widthMm: dimensionsCm[1] * 10,
    heightMm: dimensionsCm[2] * 10,
    tareWeightKg: 0,
    maxWeightKg,
    allowRotation: true,
    isActive: true,
  };
}

export const AUSPOST_PACKAGING_CATALOGUE: readonly AusPostPackagingPreset[] = [
  preset('satchel-500g-ep-pp', 'Parcel satchels', '500g satchel (EP) (PP)', 'satchel', [22, 35.5, 11], 0.5),
  preset('satchel-1kg-ep-pp', 'Parcel satchels', '1kg satchel (EP) (PP)', 'satchel', [26.5, 38.5, 13], 1),
  preset('satchel-3kg-ep-pp', 'Parcel satchels', '3kg satchel (EP) (PP)', 'satchel', [31, 40.5, 15], 3),
  preset('satchel-5kg-ep-pp', 'Parcel satchels', '5kg satchel (EP) (PP)', 'satchel', [43.5, 51, 20], 5),
  preset('satchel-small-ie-is', 'International satchels', 'Small satchel (IE) (IS)', 'satchel', [22, 35.3, 11], 0.5),
  preset('satchel-medium-ie-is', 'International satchels', 'Medium satchel (IE) (IS)', 'satchel', [26.5, 38, 13], 1),
  preset('satchel-large-ie-is', 'International satchels', 'Large satchel (IE) (IS)', 'satchel', [31, 40.5, 15], 2),
  preset('envelope-dl-ep-wf', 'Letters and envelopes', 'DL Envelope (EP) (WF)', 'custom', [11, 22, 2], 0.5),
  preset('envelope-c5-ep-rp', 'Letters and envelopes', 'C5 Envelope (EP) (RP)', 'custom', [16.2, 22.9, 2], 0.5),
  preset('envelope-b4-ep-rp', 'Letters and envelopes', 'B4 Envelope (EP) (RP)', 'custom', [25, 35.3, 2], 0.5),
  preset('envelope-dl-rwf-r', 'Letters and envelopes', 'DL Envelope (RWF) (R)', 'custom', [11, 22, 0.05], 0.25),
  preset('envelope-c4', 'Letters and envelopes', 'C4 Envelope', 'custom', [32.4, 22.9, 2], 0.5),
  preset('envelope-b4-r', 'Letters and envelopes', 'B4 Envelope (R)', 'custom', [35.3, 25, 2], 0.5),
  preset('postcard-rwf', 'Letters and envelopes', 'Postcard (RWF)', 'custom', [14.5, 10.5, 0.1], 0.1),
  preset('envelope-dl-rp', 'Letters and envelopes', 'DL Envelope (RP)', 'custom', [13, 24, 0.5], 0.25),
  preset('envelope-ie', 'Letters and envelopes', 'Envelope (IE)', 'custom', [29, 39, 0.5], 0.5),
  preset('envelope-dl-ie', 'Letters and envelopes', 'DL Envelope (IE)', 'custom', [11, 22, 0.5], 0.05),
  preset('envelope-c4-ie', 'Letters and envelopes', 'C4 Envelope (IE)', 'custom', [22.9, 32.4, 0.5], 0.25),
  preset('envelope-dl-rpi', 'Letters and envelopes', 'DL Envelope (RPI)', 'custom', [13, 24, 0.5], 0.5),
  preset('envelope-b4-rpi', 'Letters and envelopes', 'B4 Envelope (RPI)', 'custom', [25, 35.3, 0.5], 0.5),
  preset('jiffy-shurtuff-1', 'Jiffy ShurTuff satchels', 'Jiffy ShurTuff Satchel (Size 1)', 'satchel', [19, 26, 10], 0.5),
  preset('jiffy-shurtuff-2', 'Jiffy ShurTuff satchels', 'Jiffy ShurTuff Satchel (Size 2)', 'satchel', [25, 32.5, 10], 0.5),
  preset('jiffy-shurtuff-3', 'Jiffy ShurTuff satchels', 'Jiffy ShurTuff Satchel (Size 3)', 'satchel', [28, 38, 10], 0.5),
  preset('jiffy-shurtuff-4', 'Jiffy ShurTuff satchels', 'Jiffy ShurTuff Satchel (Size 4)', 'satchel', [34, 44, 10], 0.5),
  preset('jiffy-shurtuff-5', 'Jiffy ShurTuff satchels', 'Jiffy ShurTuff Satchel (Size 5)', 'satchel', [42, 45, 10], 0.5),
  preset('jiffy-shurtuff-6', 'Jiffy ShurTuff satchels', 'Jiffy ShurTuff Satchel (Size 6)', 'satchel', [60, 65, 10], 0.5),
  preset('mailing-box-bx1', 'Mailing boxes', 'Mailing box, Bx1', 'box', [22, 16, 7.7], 0.5),
  preset('mailing-box-bx2', 'Mailing boxes', 'Mailing box, Bx2', 'box', [31, 22.5, 10.2], 0.5),
  preset('mailing-box-bx3', 'Mailing boxes', 'Mailing box, Bx3', 'box', [40, 20, 18], 0.5),
  preset('mailing-box-bx4', 'Mailing boxes', 'Mailing box, Bx4', 'box', [43, 30.5, 14], 0.5),
  preset('mailing-box-bx5', 'Mailing boxes', 'Mailing box, Bx5', 'box', [40.5, 30, 25.5], 0.5),
  preset('mailing-box-bx18', 'Mailing boxes', 'Mailing box, Bx18', 'box', [18, 18, 18], 0.5),
  preset('mailing-box-bx19', 'Mailing boxes', 'Mailing box, Bx19', 'box', [38.5, 28, 7], 0.5),
  preset('mailing-box-bx20', 'Mailing boxes', 'Mailing box, Bx20', 'box', [35, 50, 44], 0.5),
  preset('video-dvd-bx6', 'Mailing boxes', 'Video/DVD box, Bx6', 'box', [22, 14.5, 3.5], 0.5),
] as const;

export function getAusPostPackagingPresets(catalogueIds: readonly string[]): AusPostPackagingPreset[] {
  const requested = new Set(catalogueIds);
  return AUSPOST_PACKAGING_CATALOGUE.filter(item => requested.has(item.catalogueId));
}