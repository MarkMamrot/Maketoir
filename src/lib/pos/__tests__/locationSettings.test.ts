import { describe, expect, it } from 'vitest';

import { allowsIncomingTransferSales, posLocationSettingsKey } from '../locationSettings';

describe('POS location settings', () => {
  it('defaults incoming-transfer sales to enabled', () => {
    expect(allowsIncomingTransferSales(undefined)).toBe(true);
    expect(allowsIncomingTransferSales('{}')).toBe(true);
    expect(allowsIncomingTransferSales('not-json')).toBe(true);
  });

  it('honours an explicit disabled setting', () => {
    expect(allowsIncomingTransferSales('{"allowIncomingTransferSales":false}')).toBe(false);
    expect(posLocationSettingsKey(7)).toBe('pos_loc_7_settings');
  });
});