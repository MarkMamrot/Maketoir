import { beforeEach, describe, expect, it } from 'vitest';
import {
  addToOfflineQueue,
  loadCurrentCart,
  loadOfflineQueue,
  saveCurrentCart,
  saveDeviceConfig,
} from '../_store';

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

const alphaDevice = { business_id: 'alpha', location_id: 1, location_name: 'Alpha', register_id: 1, register_name: 'A1' };
const betaDevice = { business_id: 'beta', location_id: 2, location_name: 'Beta', register_id: 2, register_name: 'B1' };

describe('POS tenant browser storage', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: createStorage(), configurable: true });
  });

  it('keeps carts and offline queues separate when the configured business changes', () => {
    saveDeviceConfig(alphaDevice);
    saveCurrentCart([{ variant_id: 'alpha-item' }] as any);
    addToOfflineQueue({ local_id: 'alpha-sale' });

    saveDeviceConfig(betaDevice);
    expect(loadCurrentCart()).toEqual([]);
    expect(loadOfflineQueue()).toEqual([]);
    saveCurrentCart([{ variant_id: 'beta-item' }] as any);
    addToOfflineQueue({ local_id: 'beta-sale' });

    saveDeviceConfig(alphaDevice);
    expect(loadCurrentCart()).toEqual([{ variant_id: 'alpha-item' }]);
    expect(loadOfflineQueue()).toHaveLength(1);
    expect(loadOfflineQueue()[0]?.payload).toEqual({ local_id: 'alpha-sale' });
  });
});