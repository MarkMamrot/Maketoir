'use client';

import { useEffect, useState } from 'react';

interface PO {
  id: number;
  po_number: string;
  supplier_name: string;
  location_name: string;
  status: string;
  expected_date: string;
  order_date: string;
  item_count: number;
}

interface PoListViewProps {
  onSelectPo: (po: PO) => void;
}

export default function PoListView({ onSelectPo }: PoListViewProps) {
  const [pos, setPos] = useState<PO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const fetchPos = async () => {
      try {
        const res = await fetch('/api/ims/receive/pending-pos');
        if (res.ok) {
          const data = await res.json();
          setPos(data.data || []);
        } else {
          setError('Failed to load POs');
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };

    fetchPos();
  }, []);

  const filteredPos = pos.filter((po) =>
    po.po_number.toLowerCase().includes(search.toLowerCase()) ||
    po.supplier_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: '#fff',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px',
          backgroundColor: '#0066cc',
          color: '#fff',
          fontSize: '18px',
          fontWeight: 'bold',
          paddingTop: '16px',
          paddingBottom: '8px',
        }}
      >
        📍 Receive Inventory
      </div>

      {/* Search Input */}
      <div style={{ padding: '16px', paddingBottom: '12px' }}>
        <input
          type="text"
          placeholder="Search PO# or Supplier"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            height: '44px',
            padding: '0 12px',
            fontSize: '16px',
            border: '1px solid #ddd',
            borderRadius: '8px',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {loading && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '200px',
              color: '#999',
            }}
          >
            Loading...
          </div>
        )}

        {error && (
          <div
            style={{
              padding: '16px',
              backgroundColor: '#fee',
              color: '#c33',
              borderRadius: '8px',
              margin: '16px',
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && filteredPos.length === 0 && (
          <div
            style={{
              padding: '32px 16px',
              textAlign: 'center',
              color: '#999',
            }}
          >
            {search ? 'No POs found' : 'No pending POs'}
          </div>
        )}

        {filteredPos.map((po) => (
          <button
            key={po.id}
            onClick={() => onSelectPo(po)}
            style={{
              width: '100%',
              padding: '16px',
              border: 'none',
              borderBottom: '1px solid #eee',
              backgroundColor: '#fff',
              cursor: 'pointer',
              textAlign: 'left',
              minHeight: '60px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#f5f5f5';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#fff';
            }}
          >
            <div style={{ fontWeight: 'bold', fontSize: '16px', marginBottom: '4px' }}>
              {po.po_number} • {po.supplier_name}
            </div>
            <div
              style={{
                fontSize: '14px',
                color: '#666',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>{po.location_name}</span>
              <span>{po.item_count} items</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
