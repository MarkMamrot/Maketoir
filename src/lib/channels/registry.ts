import type { SalesChannelAdapter, SalesChannelProvider } from './types';

export class SalesChannelRegistry {
  private readonly adapters = new Map<SalesChannelProvider, SalesChannelAdapter>();

  register(adapter: SalesChannelAdapter): void {
    if (this.adapters.has(adapter.provider)) {
      throw new Error(`Sales channel adapter already registered for ${adapter.provider}.`);
    }
    this.adapters.set(adapter.provider, adapter);
  }

  get(provider: SalesChannelProvider): SalesChannelAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new Error(`Sales channel adapter is not registered for ${provider}.`);
    return adapter;
  }

  has(provider: SalesChannelProvider): boolean {
    return this.adapters.has(provider);
  }

  list(): SalesChannelAdapter[] {
    return Array.from(this.adapters.values());
  }
}
