'use client';

import { useEffect, useState } from 'react';

import { CommunicationsView, type Workspace } from '@/app/pos/components/daybook/PosStoreDaybook';
import daybookStyles from '@/app/pos/components/daybook/PosStoreDaybook.module.css';

type StaffIdentity = { id?: number | null; name: string; initials: string };

function identityKey(locationId: number) {
  return `ims_team_comms_identity_${locationId}`;
}

function defaultInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Warehouse staff post and read communications through the same store-daybook
// backend as POS locations, acting as the business's default warehouse location.
export function WarehouseCommunicationsBoard({ active, onUnreadChange }: { active: boolean; onUnreadChange: (count: number) => void }) {
  const [locationId, setLocationId] = useState<number | null>(null);
  const [staff, setStaff] = useState<StaffIdentity | null>(null);
  const [identityDraft, setIdentityDraft] = useState<{ name: string; initials: string } | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(currentStaff: StaffIdentity | null, currentLocationId: number) {
    try {
      const params = new URLSearchParams({ location_id: String(currentLocationId) });
      if (currentStaff?.initials) params.set('initials', currentStaff.initials);
      const response = await fetch(`/api/pos/daybook?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Team Communications could not load.');
      setWorkspace(data as Workspace);
      setError('');
    } catch (loadError: any) {
      setError(loadError.message ?? 'Team Communications could not load.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/pos/chat?type=meta&surface=ims');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'No warehouse location is configured.');
        if (cancelled) return;
        const warehouseLocationId = Number(data.identity.locationId);
        setLocationId(warehouseLocationId);
        let saved: StaffIdentity | null = null;
        try { saved = JSON.parse(localStorage.getItem(identityKey(warehouseLocationId)) ?? 'null'); } catch { saved = null; }
        if (saved?.initials) {
          setStaff(saved);
          await load(saved, warehouseLocationId);
          return;
        }
        const name = String(data.identity.userName ?? '').trim();
        const initials = defaultInitials(name);
        if (name && initials) {
          // Known session name — save the identity silently instead of blocking on a form.
          await saveIdentity(name, initials, warehouseLocationId);
        } else {
          setIdentityDraft({ name, initials });
          setLoading(false);
        }
      } catch (loadError: any) {
        if (!cancelled) { setError(loadError.message ?? 'Team Communications could not load.'); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onUnreadChange(workspace?.communications.filter(item => !Number(item.my_read)).length ?? 0);
  }, [workspace, onUnreadChange]);

  useEffect(() => {
    if (active && locationId && staff) void load(staff, locationId);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveIdentity(name: string, initials: string, warehouseLocationId: number) {
    setSaving(true);
    try {
      const response = await fetch('/api/pos/daybook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_identity', location_id: warehouseLocationId, name, initials: initials.toUpperCase() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not save your identity.');
      const savedStaff: StaffIdentity = data.staff;
      try { localStorage.setItem(identityKey(warehouseLocationId), JSON.stringify(savedStaff)); } catch {}
      setStaff(savedStaff);
      setIdentityDraft(null);
      await load(savedStaff, warehouseLocationId);
    } catch (saveError: any) {
      // Auto-save failed (or the manual form was used) — fall back to letting the user fix it themselves.
      setError(saveError.message ?? 'Could not save your identity.');
      setIdentityDraft({ name, initials });
      setLoading(false);
    } finally {
      setSaving(false);
    }
  }

  async function confirmIdentity() {
    if (!identityDraft?.name.trim() || !identityDraft.initials.trim() || locationId == null) return;
    await saveIdentity(identityDraft.name.trim(), identityDraft.initials.trim(), locationId);
  }

  async function perform(action: string, payload: Record<string, unknown> = {}) {
    if (!locationId || !staff) return null;
    setSaving(true);
    try {
      // Always keep the warehouse itself as a target so any warehouse staffer can still
      // read, comment on, and edit a communication later — even one broadcast only to POS locations.
      const effectivePayload = action === 'create_communication' && Array.isArray(payload.location_ids)
        ? { ...payload, location_ids: Array.from(new Set([...(payload.location_ids as number[]), locationId])) }
        : payload;
      const response = await fetch('/api/pos/daybook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, location_id: locationId, staff_identity_id: staff.id, staff_name: staff.name, staff_initials: staff.initials, ...effectivePayload }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'That action failed.');
      await load(staff, locationId);
      return data;
    } catch (performError: any) {
      setError(performError.message ?? 'That action failed.');
      return null;
    } finally {
      setSaving(false);
    }
  }

  function attachmentUrl(attachmentId: number) {
    return `/api/pos/daybook/attachments/${attachmentId}?location_id=${locationId}`;
  }

  async function uploadAttachment(communicationId: number, file: File) {
    if (!locationId) return;
    const form = new FormData();
    form.set('communication_id', String(communicationId));
    form.set('file', file);
    form.set('location_id', String(locationId));
    const response = await fetch('/api/pos/daybook/attachments', { method: 'POST', body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `Failed to upload ${file.name}`);
    if (staff) await load(staff, locationId);
  }

  if (loading) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--sv-text-dim)', fontSize: 13 }}>Loading…</div>;
  if (error && !workspace && !identityDraft) return <div style={{ padding: 24, color: 'var(--sv-red)', fontSize: 13 }}>{error}</div>;

  if (identityDraft) {
    return (
      <div style={{ padding: 24, maxWidth: 360 }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 15, color: 'var(--sv-text-strong)' }}>Confirm your name</h3>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--sv-text-dim)' }}>Used to attribute posts and track who has read each communication, the same way Store Daybook does.</p>
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--sv-text-dim)', marginBottom: 3 }}>Name</span>
          <input value={identityDraft.name} onChange={event => setIdentityDraft({ name: event.target.value, initials: identityDraft.initials || defaultInitials(event.target.value) })} style={{ width: '100%', padding: '7px 9px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', fontSize: 13 }} />
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--sv-text-dim)', marginBottom: 3 }}>Initials</span>
          <input value={identityDraft.initials} maxLength={4} onChange={event => setIdentityDraft({ ...identityDraft, initials: event.target.value.toUpperCase() })} style={{ width: 90, padding: '7px 9px', borderRadius: 6, border: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', fontSize: 13 }} />
        </label>
        {error && <div style={{ marginBottom: 10, color: 'var(--sv-red)', fontSize: 12 }}>{error}</div>}
        <button onClick={confirmIdentity} disabled={saving || !identityDraft.name.trim() || !identityDraft.initials.trim()} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--sv-action)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: saving ? .7 : 1 }}>{saving ? 'Saving…' : 'Continue'}</button>
      </div>
    );
  }

  return (
    <div className={(daybookStyles as Record<string, string>)[`theme_${workspace?.preferences.theme ?? 'evergreen'}`]} style={{ padding: '16px 20px' }}>
      {error && <div style={{ marginBottom: 10, color: 'var(--sv-red)', fontSize: 12 }}>{error}</div>}
      <CommunicationsView workspace={workspace} saving={saving} perform={perform} onUploadAttachment={uploadAttachment} attachmentUrl={attachmentUrl} />
    </div>
  );
}
