export type PackableUnit = {
  soItemId: number;
  reference: string;
  quantity: number;
  weightKg: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
};

export type PackingPreset = {
  id: number;
  name: string;
  packageType: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  tareWeightKg: number;
  maxWeightKg: number | null;
  allowRotation: boolean;
};

export type SuggestedParcel = {
  preset: PackingPreset;
  units: PackableUnit[];
  weightKg: number;
};

export type PackingSuggestion = { parcels: SuggestedParcel[]; unpacked: PackableUnit[] };

export function suggestParcels(units: PackableUnit[], presets: PackingPreset[]): PackingSuggestion {
  const activePresets = presets.filter(preset => validDimensions(preset) && preset.tareWeightKg >= 0)
    .sort((left, right) => volume(left) - volume(right));
  const sortedUnits = [...units].filter(validDimensions).sort((left, right) => volume(right) - volume(left));
  const parcels: SuggestedParcel[] = [];
  const unpacked: PackableUnit[] = units.filter(unit => !validDimensions(unit) || unit.weightKg <= 0);

  for (const unit of sortedUnits) {
    if (unit.weightKg <= 0) continue;
    const existing = parcels.find(parcel => fitsDimensions(unit, parcel.preset)
      && usedVolume(parcel) + volume(unit) <= volume(parcel.preset)
      && withinWeight(parcel.preset, parcel.weightKg + unit.weightKg));
    if (existing) {
      existing.units.push(unit);
      existing.weightKg += unit.weightKg;
      continue;
    }
    const preset = activePresets.find(candidate => fitsDimensions(unit, candidate)
      && volume(unit) <= volume(candidate)
      && withinWeight(candidate, candidate.tareWeightKg + unit.weightKg));
    if (!preset) {
      unpacked.push(unit);
      continue;
    }
    parcels.push({ preset, units: [unit], weightKg: preset.tareWeightKg + unit.weightKg });
  }
  return { parcels, unpacked };
}

function validDimensions(value: { lengthMm: number; widthMm: number; heightMm: number }): boolean {
  return [value.lengthMm, value.widthMm, value.heightMm].every(dimension => Number.isFinite(dimension) && dimension > 0);
}

function volume(value: { lengthMm: number; widthMm: number; heightMm: number }): number {
  return value.lengthMm * value.widthMm * value.heightMm;
}

function usedVolume(parcel: SuggestedParcel): number {
  return parcel.units.reduce((sum, unit) => sum + volume(unit), 0);
}

function withinWeight(preset: PackingPreset, weightKg: number): boolean {
  return preset.maxWeightKg == null || weightKg <= preset.maxWeightKg;
}

function fitsDimensions(unit: PackableUnit, preset: PackingPreset): boolean {
  const itemDimensions = [unit.lengthMm, unit.widthMm, unit.heightMm];
  const parcelDimensions = [preset.lengthMm, preset.widthMm, preset.heightMm];
  if (preset.allowRotation) {
    itemDimensions.sort((left, right) => left - right);
    parcelDimensions.sort((left, right) => left - right);
  }
  return itemDimensions.every((dimension, index) => dimension <= parcelDimensions[index]);
}
