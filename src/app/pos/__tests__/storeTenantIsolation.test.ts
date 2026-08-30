import { beforeEach, describe, expect, it } from 'vitest';
import {
  addToOfflineQueue,
  loadCurrentCart,
  loadOfflineQueue,
  saveCurrentCart,
  saveDeviceConfig,
  saveLocalSession,
  loadProductsCache,
  markProductsSynced,
  saveProductsCache,
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

  it('does not block POS login when the catalogue exceeds browser storage quota', () => {
    saveDeviceConfig(alphaDevice);
    saveProductsCache([{ variant_id: 'existing-item' }] as any);
    const storage = globalThis.localStorage;
    const setItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if (key.startsWith('pos_products_cache:')) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      setItem(key, value);
    };

    expect(saveProductsCache([{ variant_id: 'large-catalogue' }] as any)).toBe(false);
    expect(markProductsSynced(Date.now(), true)).toBe(false);
    expect(loadProductsCache()).toEqual([{ variant_id: 'existing-item' }]);
  });

  it('does not block POS login when the local session cannot be cached', () => {
    saveDeviceConfig(alphaDevice);
    const storage = globalThis.localStorage;
    storage.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };

    expect(saveLocalSession({ pos_user_id: 7 })).toBe(false);
  });
});