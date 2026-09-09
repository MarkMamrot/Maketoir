import { describe, expect, it } from 'vitest';

import { aggregateCarrierRates } from '../shippingQuotes';

const rate = (serviceCode: string, total: number) => ({
  serviceCode,
  serviceName: serviceCode === 'EXP' ? 'Express Post' : 'Parcel Post',
  total,
  totalExGst: total / 1.1,
  gst: total - total / 1.1,
  authorityToLeaveAvailable: true,
  signatureIncluded: false,
});

describe('aggregateCarrierRates', () => {
  it('sums services available for every parcel and sorts by total price', () => {
    expect(aggregateCarrierRates([
      [rate('STD', 10), rate('EXP', 15)],
      [rate('STD', 12), rate('EXP', 18)],
    ])).toEqual([
      { serviceCode: 'STD', serviceName: 'Parcel Post', total: 22, totalExGst: 20, gst: 2 },
      { serviceCode: 'EXP', serviceName: 'Express Post', total: 33, totalExGst: 30, gst: 3 },
    ]);
  });

  it('omits a service that is unavailable for any parcel', () => {
    expect(aggregateCarrierRates([
      [rate('STD', 10), rate('EXP', 15)],
      [rate('STD', 12)],
    ])).toEqual([
      { serviceCode: 'STD', serviceName: 'Parcel Post', total: 22, totalExGst: 20, gst: 2 },
    ]);
  });
});