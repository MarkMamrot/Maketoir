'use client';

import { useEffect, useState } from 'react';
import { BookOpen, ChevronLeft, MapPin } from 'lucide-react';
import { PosStoreDaybook } from '@/app/pos/components/daybook/PosStoreDaybook';
import type { PosSession } from '@/app/pos/_types';
import styles from './LocationDaybooksView.module.css';

type Location = {
  id: number;
  name: string;
  city?: string | null;
  state?: string | null;
  is_active: number;
  has_pos?: number;
};

type Props = {
  userName: string;
  userTier?: string;
};

export function LocationDaybooksView({ userName, userTier }: Props) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [selected, setSelected] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/ims/locations', { cache: 'no-store' })
      .then(async response => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Locations could not be loaded.');
        setLocations((result.data ?? []).filter((location: Location) => Number(location.is_active) === 1));
      })
      .catch(caught => setError(caught instanceof Error ? caught.message : 'Locations could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);

  if (selected) {
    const session: PosSession = {
      pos_user_id: 0,
      username: userName,
      full_name: userName,
      location_id: selected.id,
      location_name: selected.name,
      register_id: null,
      register_name: null,
      tier: userTier,
    };
    return (
      <div className={styles.daybookFrame}>
        <PosStoreDaybook
          key={selected.id}
          session={session}
          locationOverride={{ id: selected.id, name: selected.name }}
          embedded
          onBack={() => setSelected(null)}
        />
      </div>
    );
  }

  return (
    <section className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span>Locations</span>
          <h1>Location Daybooks</h1>
          <p>Open a store's current checklist, communications, requests and operational records.</p>
        </div>
      </header>

      {loading && <div className={styles.state}>Loading locations...</div>}
      {error && <div className={styles.error}>{error}</div>}
      {!loading && !error && locations.length === 0 && <div className={styles.state}>No active locations are available.</div>}

      <div className={styles.locationList}>
        {locations.map(location => (
          <button type="button" key={location.id} onClick={() => setSelected(location)} className={styles.locationRow}>
            <span className={styles.locationIcon}><MapPin size={18} /></span>
            <span className={styles.locationCopy}>
              <strong>{location.name}</strong>
              <small>{[location.city, location.state].filter(Boolean).join(', ') || 'Store location'}</small>
            </span>
            {Number(location.has_pos) === 1 && <span className={styles.posBadge}>POS</span>}
            <span className={styles.openAction}><BookOpen size={16} /> Open Daybook</span>
          </button>
        ))}
      </div>
    </section>
  );
}
