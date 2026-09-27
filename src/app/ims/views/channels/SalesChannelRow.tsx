'use client';

import { AlertCircle, CheckCircle2, Clock3, Ellipsis, PauseCircle, Pencil, Power, Store, TestTube2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import styles from './SalesChannelRow.module.css';

export interface SalesChannelRowInstance {
  channelInstanceId: string;
  providerDisplayName: string;
  displayName: string;
  externalAccountKey: string | null;
  enabled: boolean;
  runtimeStatus: 'draft' | 'active' | 'paused' | 'error';
  readinessStatus: 'not_tested' | 'ready' | 'error';
  lastSyncAt: string | null;
  safeError: string | null;
}

function statusDetails(instance: SalesChannelRowInstance) {
  if (instance.runtimeStatus === 'draft') return { label: 'Setup pending', color: '#475569', background: '#e2e8f0', icon: Clock3 };
  if (!instance.enabled || instance.runtimeStatus === 'paused') return { label: 'Paused', color: '#92400e', background: '#fef3c7', icon: PauseCircle };
  if (instance.runtimeStatus === 'error' || instance.readinessStatus === 'error') return { label: 'Needs attention', color: '#b91c1c', background: '#fee2e2', icon: AlertCircle };
  if (instance.runtimeStatus === 'active' && instance.readinessStatus === 'ready') return { label: 'Active', color: '#166534', background: '#dcfce7', icon: CheckCircle2 };
  return { label: 'Setup pending', color: '#475569', background: '#e2e8f0', icon: Clock3 };
}

function formatLastSync(value: string | null): string {
  if (!value) return 'Not yet synced';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unavailable';
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default function SalesChannelRow({
  instance,
  capabilityCount,
  canManage,
  testing,
  activationChanging,
  onConfigure,
  onTest,
  onChangeActivation,
}: {
  instance: SalesChannelRowInstance;
  capabilityCount: number;
  canManage: boolean;
  testing: boolean;
  activationChanging: boolean;
  onConfigure: () => void;
  onTest?: () => void;
  onChangeActivation?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const status = statusDetails(instance);
  const StatusIcon = status.icon;

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <section className={styles.row} aria-label={instance.displayName}>
      <div className={styles.identity}>
        <div className={styles.icon}><Store size={18} aria-hidden="true" /></div>
        <div>
          <div className={styles.name}>{instance.displayName}</div>
          <div className={styles.provider}>{instance.providerDisplayName}</div>
          {instance.externalAccountKey && <div className={styles.account}>{instance.externalAccountKey}</div>}
        </div>
      </div>

      <div className={styles.statusCell}>
        <span className={styles.status} style={{ color: status.color, background: status.background }}>
          <StatusIcon size={13} aria-hidden="true" /> {status.label}
        </span>
        <div className={styles.sync}><span className={styles.syncLabel}>Last successful sync:</span> {formatLastSync(instance.lastSyncAt)}</div>
      </div>

      <div className={styles.capabilities}>{capabilityCount} supported {capabilityCount === 1 ? 'feature' : 'features'}</div>

      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onConfigure}>
          <Pencil size={14} aria-hidden="true" /> {canManage ? 'Configure' : 'View details'}
        </button>
        {canManage && (onTest || onChangeActivation) && (
          <div className={styles.menuWrap} ref={menuRef}>
            <button
              ref={menuButtonRef}
              type="button"
              className={styles.menuButton}
              aria-label={`More actions for ${instance.displayName}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="More actions"
              onClick={() => setMenuOpen(open => !open)}
            >
              <Ellipsis size={17} aria-hidden="true" />
            </button>
            {menuOpen && (
              <div className={styles.menu} role="menu">
                {onTest && (
                  <button type="button" role="menuitem" className={styles.menuItem} disabled={testing} onClick={() => { setMenuOpen(false); onTest(); }}>
                    <TestTube2 size={14} aria-hidden="true" /> {testing ? 'Testing...' : 'Test connection'}
                  </button>
                )}
                {onChangeActivation && (
                  <button type="button" role="menuitem" className={`${styles.menuItem} ${instance.enabled ? styles.danger : ''}`} disabled={activationChanging} onClick={() => { setMenuOpen(false); onChangeActivation(); }}>
                    {instance.enabled ? <PauseCircle size={14} aria-hidden="true" /> : <Power size={14} aria-hidden="true" />}
                    {activationChanging ? 'Saving...' : instance.enabled ? 'Deactivate' : 'Activate'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {instance.safeError && <div className={styles.error} role="status">{instance.safeError}</div>}
    </section>
  );
}