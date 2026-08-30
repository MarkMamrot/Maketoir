'use client';

import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';

interface BusinessOption {
  databaseId: string;
  name: string;
  active?: boolean;
  isSandbox?: boolean;
}

export async function switchBusinessContext(businessId: string, destination: string): Promise<void> {
  const response = await fetch('/api/auth/business-context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessId }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Business could not be selected.');
  window.location.assign(destination);
}

export function BusinessContextSwitcher({ destination, enabled = true }: { destination: string; enabled?: boolean }) {
  const [businesses, setBusinesses] = useState<BusinessOption[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState('');
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return;
    fetch('/api/user/businesses')
      .then(async response => response.ok ? response.json() : null)
      .then(result => {
        if (!result?.success) return;
        setBusinesses(result.businesses ?? []);
        setActiveBusinessId(result.activeBusinessId ?? '');
      })
      .catch(() => {});
  }, [enabled]);

  if (!enabled || businesses.length < 2) return null;

  return (
    <label title={error || 'Active business'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, color: error ? '#fca5a5' : 'rgba(255,255,255,.78)', fontSize: 12 }}>
      <Building2 size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
      <span className="business-context-label" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Business</span>
      <select
        aria-label="Active business"
        value={activeBusinessId}
        disabled={switching}
        onChange={async event => {
          const nextBusinessId = event.target.value;
          if (!nextBusinessId || nextBusinessId === activeBusinessId) return;
          setSwitching(true);
          setError('');
          try {
            await switchBusinessContext(nextBusinessId, destination);
          } catch (switchError) {
            setError(switchError instanceof Error ? switchError.message : 'Business could not be selected.');
            setSwitching(false);
          }
        }}
        style={{ width: 190, maxWidth: '28vw', minWidth: 110, height: 30, border: `1px solid ${error ? '#ef4444' : 'rgba(148,163,184,.35)'}`, borderRadius: 6, background: '#111c2e', color: '#f8fafc', padding: '0 26px 0 8px', fontSize: 12, fontWeight: 600, cursor: switching ? 'wait' : 'pointer', textOverflow: 'ellipsis' }}
      >
        {businesses.map(business => (
          <option key={business.databaseId} value={business.databaseId}>
            {business.name}{business.isSandbox ? ' (Sandbox)' : ''}
          </option>
        ))}
      </select>
      <style jsx>{`@media (max-width: 700px) { .business-context-label { display: none; } }`}</style>
    </label>
  );
}