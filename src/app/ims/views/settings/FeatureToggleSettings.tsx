'use client';

import { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { FEATURE_TOGGLES, isFeatureEnabled } from '@/lib/ims/featureToggles';
import { SettingsActions, useSettingsDirty } from './SettingsShell';
import styles from './FeatureToggleSettings.module.css';
import { ConsignmentTrackingSettings } from './ConsignmentTrackingSettings';

export function FeatureToggleSettings({ settings, loaded, loadError, canManage, saveSettings }: {
  settings: Record<string, string>; loaded: boolean; loadError: string; canManage: boolean;
  saveSettings: (updates: Record<string, string>) => Promise<void>;
}) {
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const dirty = Object.keys(changes).length > 0;
  useSettingsDirty(dirty);
  useEffect(() => { setBaseline(settings); }, [settings]);
  const draft = { ...baseline, ...changes };
  const enabledCount = FEATURE_TOGGLES.filter(feature => isFeatureEnabled(draft, feature.key)).length;

  const save = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      await saveSettings(changes);
      setBaseline(previous => ({ ...previous, ...changes }));
      setChanges({}); setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Feature toggles could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return <div className={styles.page}>
    <div className={styles.intro}>
      <span className={styles.icon}><SlidersHorizontal size={23} aria-hidden="true" /></span>
      <div><h2>Shape your workspace</h2><p>Keep the tools your team uses, and hide the rest. These choices apply to everyone in this business.</p></div>
      <span className={styles.count}>{loaded ? `${enabledCount} of ${FEATURE_TOGGLES.length} enabled` : 'Loading...'}</span>
    </div>
    <p className={styles.notice}>Existing workspace switches are on by default. Consignments is off by default; enable it and save to show Consignment Activity in Reports and Consignment Statements in Purchasing. Consignment Tracking is separate, off by default and uses a reviewed operational transition, not Save feature toggles. Reporting does not require tracking.</p>
    {!canManage && <p className={styles.notice}>Only Admins and SuperAdmins can change Feature Toggle settings.</p>}
    {loadError && <p role="alert">{loadError}</p>}
    <div className={styles.groups}>
      {[...new Set(FEATURE_TOGGLES.map(feature => feature.group))].map(group => <section key={group} className={styles.group} aria-label={group}>
        <h3>{group}</h3>
        {FEATURE_TOGGLES.filter(feature => feature.group === group).map(feature => {
          const enabled = isFeatureEnabled(draft, feature.key);
          return <div key={feature.key} className={styles.row}>
            <div className={styles.copy}><label id={`${feature.key}-label`}>{feature.label}</label><p id={`${feature.key}-description`}>{feature.description}</p></div>
            {feature.key === 'feature_toggle_consignment_tracking' ? <ConsignmentTrackingSettings enabled={enabled}
              disabled={!canManage || !loaded || saving}
              onChanged={value => setBaseline(previous => ({ ...previous, feature_toggle_consignment_tracking: value ? 'yes' : 'no' }))} /> :
            <div className={styles.control}><span>{enabled ? 'On' : 'Off'}</span>
              <button type="button" role="switch" aria-labelledby={`${feature.key}-label`} aria-describedby={`${feature.key}-description`}
                aria-checked={enabled} disabled={!canManage || !loaded || saving} className={styles.switch}
                onClick={() => {
                  const value = enabled ? 'no' : 'yes';
                  setChanges(previous => {
                    const next = { ...previous, [feature.key]: value };
                    if (isFeatureEnabled(baseline, feature.key) === (value === 'yes')) delete next[feature.key];
                    return next;
                  });
                  setSaved(false); setError('');
                }}><span /></button>
            </div>}
          </div>;
        })}
      </section>)}
    </div>
    {canManage && <SettingsActions>
      <button type="button" data-primary disabled={!loaded || saving || !dirty} onClick={() => void save()}>{saving ? 'Saving...' : 'Save feature toggles'}</button>
      <button type="button" disabled={saving || !dirty} onClick={() => { setChanges({}); setError(''); setSaved(false); }}>Cancel</button>
      {saved && <span role="status">Feature toggles saved.</span>}
    </SettingsActions>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
