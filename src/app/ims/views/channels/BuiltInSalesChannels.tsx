'use client';

import { AlertCircle, Building2, CheckCircle2, Clock3, PauseCircle, Pencil, Store } from 'lucide-react';
import { useEffect, useState } from 'react';

import styles from './SalesChannelRow.module.css';

interface Overview {
  posEnabled: boolean;
  wholesaleEnabled: boolean;
  posLocationCount: number;
}

export default function BuiltInSalesChannels({
  canManage,
  refreshKey,
  onConfigure,
  onManageLocations,
}: {
  canManage: boolean;
  refreshKey: number;
  onConfigure?: (section: 'pos' | 'wholesale') => void;
  onManageLocations?: () => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setOverview(null);
    setError('');
    const load = async () => {
      try {
        const [settingsResponse, locationsResponse] = await Promise.all([
          fetch('/api/ims/settings', { signal: controller.signal }),
          fetch('/api/ims/locations', { signal: controller.signal }),
        ]);
        const [settings, locations] = await Promise.all([settingsResponse.json(), locationsResponse.json()]);
        if (!settingsResponse.ok || !settings.success || !settings.data || typeof settings.data !== 'object') {
          throw new Error(settings.error || 'Built-in channel settings could not be loaded.');
        }
        if (!locationsResponse.ok || !locations.success || !Array.isArray(locations.data)) {
          throw new Error(locations.error || 'POS locations could not be loaded.');
        }
        const posLocations = locations.data.filter((location: { is_active: number; has_pos?: number; pos_location_code?: string | null }) =>
          Number(location.is_active) === 1 && (Number(location.has_pos) === 1 || Boolean(location.pos_location_code?.trim())),
        );
        if (!controller.signal.aborted) {
          setOverview({
            posEnabled: settings.data.business_requires_pos !== 'no',
            wholesaleEnabled: settings.data.sells_wholesale !== 'no',
            posLocationCount: posLocations.length,
          });
        }
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : 'Built-in sales channels could not be loaded.');
      }
    };
    void load();
    return () => controller.abort();
  }, [refreshKey, retryKey]);

  if (error) {
    return (
      <div className={styles.error} role="alert">
        <AlertCircle size={15} aria-hidden="true" /> {error}{' '}
        <button type="button" className={styles.primary} onClick={() => setRetryKey(key => key + 1)}>Retry built-in channels</button>
      </div>
    );
  }
  if (!overview) return <p className={styles.provider} role="status">Loading POS and B2B channels...</p>;

  return (
    <div className={styles.list}>
      {(['pos', 'wholesale'] as const).map(section => {
        const isPos = section === 'pos';
        const enabled = isPos ? overview.posEnabled : overview.wholesaleEnabled;
        const needsSetup = isPos && enabled && overview.posLocationCount === 0;
        const Icon = isPos ? Store : Building2;
        const StatusIcon = !enabled ? PauseCircle : needsSetup ? Clock3 : CheckCircle2;
        return (
          <section key={section} className={`${styles.row}${isPos ? '' : ` ${styles.striped}`}`} aria-label={isPos ? 'Point of Sale' : 'B2B Wholesale Portal'}>
            <div className={styles.identity}>
              <div className={styles.icon}><Icon size={18} aria-hidden="true" /></div>
              <div>
                <div className={styles.name}>{isPos ? 'Point of Sale' : 'B2B Wholesale Portal'}</div>
                <div className={styles.provider}>{isPos ? 'In-store sales' : 'Business-to-business online sales'}</div>
              </div>
            </div>
            <div className={styles.statusCell}>
              <span className={styles.status} style={{
                color: !enabled ? '#92400e' : needsSetup ? '#475569' : '#166534',
                background: !enabled ? '#fef3c7' : needsSetup ? '#e2e8f0' : '#dcfce7',
              }}>
                <StatusIcon size={13} aria-hidden="true" /> {!enabled ? 'Disabled' : needsSetup ? 'Setup pending' : 'Enabled'}
              </span>
              <div className={styles.sync}>Managed in existing {isPos ? 'Point of Sale' : 'Wholesale Portal'} settings</div>
            </div>
            <div className={styles.capabilities}>
              {isPos ? `${overview.posLocationCount} active POS ${overview.posLocationCount === 1 ? 'location' : 'locations'}` : 'Customer accounts and wholesale ordering'}
            </div>
            <div className={styles.actions}>
              {isPos && onManageLocations && <button type="button" className={styles.primary} onClick={onManageLocations}>Manage locations</button>}
              {!isPos && enabled && <a className={styles.primary} href="/wholesale/preview" target="_blank" rel="noopener noreferrer">Preview portal</a>}
              {canManage && onConfigure && (
                <button type="button" className={styles.primary} onClick={() => onConfigure(section)}>
                  <Pencil size={14} aria-hidden="true" /> Configure
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
