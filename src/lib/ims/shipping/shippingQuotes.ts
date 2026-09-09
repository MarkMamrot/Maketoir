import { AusPostEparcelClient } from './carriers/auspostEparcel/client';
import type { CarrierRate } from './carriers/types';
import { prepareShippingRequest, type ShippingRequestInput } from './shippingDrafts';
import { ShippingSettingsRepository } from './shippingSettingsRepository';

export type ShippingQuote = Pick<CarrierRate, 'serviceCode' | 'serviceName' | 'total' | 'totalExGst' | 'gst'>;

export async function quoteShippingRequest(input: ShippingRequestInput): Promise<Array<{ soId: number; rates: ShippingQuote[] }>> {
  const prepared = await prepareShippingRequest(input);
  if (prepared.account.provider !== 'auspost_eparcel') throw new Error('Shipping quotes are not supported for this carrier.');
  const credentials = await ShippingSettingsRepository.getAccountCredentials(input.businessId, input.carrierAccountId);
  if (!credentials) throw new Error('Carrier account credentials are incomplete.');
  const client = new AusPostEparcelClient(credentials);

  const quotes = [];
  for (const entry of prepared.entries) {
    const parcelRates = await client.getRates({
      from: entry.sender,
      to: entry.recipient,
      parcels: entry.requested.parcels.map(parcel => ({
        reference: `${entry.order.so_number}-P${parcel.parcelNumber}`,
        lengthMm: parcel.lengthMm,
        widthMm: parcel.widthMm,
        heightMm: parcel.heightMm,
        weightKg: parcel.weightKg,
      })),
    });
    quotes.push({ soId: Number(entry.order.id), rates: aggregateCarrierRates(parcelRates) });
  }
  return quotes;
}

export function aggregateCarrierRates(parcelRates: CarrierRate[][]): ShippingQuote[] {
  if (!parcelRates.length) return [];
  const firstParcelServices = new Map(parcelRates[0].map(rate => [rate.serviceCode, rate]));
  const totals: ShippingQuote[] = [];
  for (const [serviceCode, firstRate] of firstParcelServices) {
    const matching = parcelRates.map(rates => rates.find(rate => rate.serviceCode === serviceCode));
    if (matching.some(rate => !rate)) continue;
    totals.push({
      serviceCode,
      serviceName: firstRate.serviceName,
      total: money(matching.reduce((sum, rate) => sum + (rate?.total ?? 0), 0)),
      totalExGst: money(matching.reduce((sum, rate) => sum + (rate?.totalExGst ?? 0), 0)),
      gst: money(matching.reduce((sum, rate) => sum + (rate?.gst ?? 0), 0)),
    });
  }
  return totals.sort((left, right) => left.total - right.total || left.serviceName.localeCompare(right.serviceName));
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}