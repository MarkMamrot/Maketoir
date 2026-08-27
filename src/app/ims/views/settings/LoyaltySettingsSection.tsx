'use client';

import { Award, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

import { DEFAULT_LOYALTY_SETTINGS, LOYALTY_SETTING_KEYS } from '@/lib/loyalty/types';
import { LoyaltyPortalSettings } from './LoyaltyPortalSettings';

interface LoyaltySettingsSectionProps {
  settings: Record<string, string>;
  refetchSettings: () => void;
}

interface LoyaltyDraft {
  enabled: boolean;
  earnRate: string;
  programName: string;
  pointsLabel: string;
  startedAt: string;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 10px',
  background: 'var(--sv-bg-1)',
  border: '1px solid var(--sv-etch)',
  borderRadius: 6,
  color: 'var(--sv-text-main)',
  fontSize: 14,
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 5,
  color: 'var(--sv-text-dim)',
  fontSize: 12,
  fontWeight: 600,
};

function localDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function LoyaltySettingsSection({ settings, refetchSettings }: LoyaltySettingsSectionProps) {
  const [draft, setDraft] = useState<LoyaltyDraft>({
    enabled: false,
    earnRate: String(DEFAULT_LOYALTY_SETTINGS.earnRate),
    programName: DEFAULT_LOYALTY_SETTINGS.programName,
    pointsLabel: DEFAULT_LOYALTY_SETTINGS.pointsLabel,
    startedAt: '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setDraft({
      enabled: settings[LOYALTY_SETTING_KEYS.enabled] === '1',
      earnRate: settings[LOYALTY_SETTING_KEYS.earnRate] || String(DEFAULT_LOYALTY_SETTINGS.earnRate),
      programName: settings[LOYALTY_SETTING_KEYS.programName] || DEFAULT_LOYALTY_SETTINGS.programName,
      pointsLabel: settings[LOYALTY_SETTING_KEYS.pointsLabel] || DEFAULT_LOYALTY_SETTINGS.pointsLabel,
      startedAt: settings[LOYALTY_SETTING_KEYS.startedAt] || '',
    });
  }, [settings]);

  const setEnabled = (enabled: boolean) => {
    setDraft(previous => ({
      ...previous,
      enabled,
      startedAt: enabled && !previous.startedAt ? localDate() : previous.startedAt,
    }));
    setMessage(null);
  };

  const save = async () => {
    const earnRate = Number(draft.earnRate);
    if (!Number.isFinite(earnRate) || earnRate <= 0 || earnRate > 100) {
      setMessage({ tone: 'error', text: 'Earn rate must be greater than 0 and no more than 100.' });
      return;
    }
    if (!draft.programName.trim() || !draft.pointsLabel.trim()) {
      setMessage({ tone: 'error', text: 'Program name and points label are required.' });
      return;
    }
    if (draft.enabled && !draft.startedAt) {
      setMessage({ tone: 'error', text: 'Choose a start date before enabling loyalty.' });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/ims/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            [LOYALTY_SETTING_KEYS.enabled]: draft.enabled ? '1' : '0',
            [LOYALTY_SETTING_KEYS.earnRate]: String(earnRate),
            [LOYALTY_SETTING_KEYS.programName]: draft.programName.trim(),
            [LOYALTY_SETTING_KEYS.pointsLabel]: draft.pointsLabel.trim(),
            [LOYALTY_SETTING_KEYS.startedAt]: draft.startedAt,
          },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to save loyalty settings.');
      refetchSettings();
      setMessage({ tone: 'success', text: 'Loyalty settings saved.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to save loyalty settings.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 32, maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <Award size={20} color="var(--sv-action)" aria-hidden="true" />
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--sv-text-strong)' }}>Loyalty</h2>
      </div>

      <section style={{ padding: 20, background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sv-text-strong)', marginBottom: 3 }}>Loyalty program</div>
            <div style={{ fontSize: 12, color: 'var(--sv-text-dim)' }}>{draft.enabled ? 'Enabled' : 'Off by default'}</div>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--sv-text-main)' }}>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={event => setEnabled(event.target.checked)}
              style={{ width: 18, height: 18, accentColor: 'var(--sv-action)' }}
            />
            {draft.enabled ? 'On' : 'Off'}
          </label>
        </div>
      </section>

      <section style={{ padding: 20, background: 'var(--sv-bg-2)', border: '1px solid var(--sv-etch)', borderRadius: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16 }}>
          <div>
            <label style={labelStyle}>Program name</label>
            <input value={draft.programName} maxLength={100} onChange={event => setDraft(previous => ({ ...previous, programName: event.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Points label</label>
            <input value={draft.pointsLabel} maxLength={30} onChange={event => setDraft(previous => ({ ...previous, pointsLabel: event.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Points earned per $1</label>
            <input type="number" min="0.01" max="100" step="0.01" value={draft.earnRate} onChange={event => setDraft(previous => ({ ...previous, earnRate: event.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Start date</label>
            <input type="date" value={draft.startedAt} onChange={event => setDraft(previous => ({ ...previous, startedAt: event.target.value }))} style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', border: 'none', borderRadius: 6, background: 'var(--sv-action)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.65 : 1 }}
          >
            <Save size={15} aria-hidden="true" />
            {saving ? 'Saving...' : 'Save settings'}
          </button>
          {message && <span style={{ fontSize: 12, color: message.tone === 'success' ? 'var(--sv-mint)' : 'var(--sv-red)' }}>{message.text}</span>}
        </div>
      </section>
      <LoyaltyPortalSettings />
    </div>
  );
}