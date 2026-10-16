'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { isFeatureEnabled, type FeatureToggleKey } from '@/lib/ims/featureToggles';

const FeatureToggleContext = createContext<{ settings: Readonly<Record<string, string>>; loaded: boolean }>({
  settings: {}, loaded: true,
});

export function FeatureToggleProvider({ settings, loaded, children }: {
  settings: Readonly<Record<string, string>>; loaded: boolean; children: ReactNode;
}) {
  const [tracking, setTracking] = useState<boolean | null>(null);
  useEffect(() => {
    const changed = (event: Event) => setTracking(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener('ims-consignment-tracking-changed', changed);
    return () => window.removeEventListener('ims-consignment-tracking-changed', changed);
  }, []);
  useEffect(() => { setTracking(null); }, [settings.feature_toggle_consignment_tracking]);
  const effective = tracking === null ? settings : { ...settings, feature_toggle_consignment_tracking: tracking ? 'yes' : 'no' };
  return <FeatureToggleContext.Provider value={{ settings: effective, loaded }}>{children}</FeatureToggleContext.Provider>;
}

export function useFeatureEnabled(key: FeatureToggleKey): boolean {
  const { settings, loaded } = useContext(FeatureToggleContext);
  return loaded && isFeatureEnabled(settings, key);
}

export function useFeatureToggles() {
  return useContext(FeatureToggleContext);
}
