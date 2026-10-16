import React from 'react';
import { SettingsActions, useSettingsDirty } from './SettingsShell';

export function AccountsEmailSettings({ onHelp }: { onHelp?: () => void }) {
  const [recipients, setRecipients] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [baseline, setBaseline] = React.useState('');
  useSettingsDirty(loaded && recipients !== baseline);
  React.useEffect(() => {
    let active = true;
    fetch('/api/ims/settings/accounts').then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Accounts email settings could not be loaded.');
      if (active) { setRecipients(result.recipients.join(', ')); setBaseline(result.recipients.join(', ')); setLoaded(true); }
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : 'Accounts email settings could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function save() {
    setSaving(true); setError(''); setSaved(false);
    try {
      const response = await fetch('/api/ims/settings/accounts', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipients }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Accounts email settings could not be saved.');
      setRecipients(result.recipients.join(', ')); setBaseline(result.recipients.join(', ')); setSaved(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Accounts email settings could not be saved.');
    } finally { setSaving(false); }
  }
  return <section style={{ padding: 20, background: 'var(--sv-bg-2)', borderRadius: 10, border: '1px solid var(--sv-etch)', maxWidth: 540, marginBottom: 20 }}>
    <h3 style={{ marginTop: 0 }}>Bookkeeping / Accounts email</h3>
    <p style={{ fontSize: 13 }}>Recipients for register float correction notices and accounting reconciliation emails. These are the same accounts recipients used in Xero reconciliation settings.</p>
    <label htmlFor="accounts-email">Email addresses (comma separated)</label>
    <input id="accounts-email" value={recipients} disabled={!loaded || saving} onChange={event => { setRecipients(event.target.value); setSaved(false); }}
      style={{ width: '100%', boxSizing: 'border-box', margin: '8px 0', padding: 8, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', border: '1px solid var(--sv-border)', borderRadius: 6 }} />
    <SettingsActions>
    <button type="button" data-primary onClick={save} disabled={!loaded || saving || recipients === baseline}>{loading ? 'Loading...' : saving ? 'Saving...' : 'Save accounts email'}</button>
    <button type="button" disabled={saving} onClick={() => { setRecipients(baseline); setSaved(false); setError(''); }}>Cancel</button>
    {onHelp && <button type="button" onClick={onHelp} style={{ marginLeft: 8 }}>Help</button>}
    </SettingsActions>
    {saved && <p role="status">Accounts recipients saved.</p>}
    {error && <p role="alert" style={{ color: 'var(--sv-red)' }}>{error}</p>}
  </section>;
}
