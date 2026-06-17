'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PoListView from './components/PoListView';
import ReceiveInterfaceView from './components/ReceiveInterfaceView';

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

interface ReceivedItem {
  variant_id: string;
  product_name: string;
  sku: string;
  qty_received: number;
  barcode?: string;
  zone?: string;
  bin?: string;
  min_qty?: number;
  reorder_qty?: number;
}

export default function ReceivePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [view, setView] = useState<'list' | 'receive'>('list');
  const [selectedPo, setSelectedPo] = useState<PO | null>(null);
  const [receivingCart, setReceivingCart] = useState<ReceivedItem[]>([]);

  // Check authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/user/me');
        if (res.ok) {
          const data = await res.json();
          if (data.name) {
            setAuthenticated(true);

            // Check if po_id is in query params
            const poId = searchParams.get('po_id');
            if (poId) {
              // Fetch the specific PO and auto-select it
              try {
                const poRes = await fetch('/api/ims/receive/pending-pos');
                if (poRes.ok) {
                  const poData = await poRes.json();
                  const pos = poData.data || [];
                  const po = pos.find((p: PO) => p.id === parseInt(poId));
                  if (po) {
                    setSelectedPo(po);
                    setView('receive');
                    setReceivingCart([]);
                  }
                }
              } catch (err) {
                console.error('Failed to fetch PO:', err);
              }
            }
          } else {
            router.push('/login');
          }
        } else {
          router.push('/login');
        }
      } catch {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [router, searchParams]);

  if (loading) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f5f5f5',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              border: '3px solid #ddd',
              borderTop: '3px solid #0066cc',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 16px',
            }}
          />
          <p>Loading...</p>
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return null;
  }

  const handleSelectPo = (po: PO) => {
    setSelectedPo(po);
    setReceivingCart([]);
    setView('receive');
  };

  const handleBack = () => {
    setView('list');
    setSelectedPo(null);
    setReceivingCart([]);
  };

  const handleAddToCart = (item: ReceivedItem) => {
    // Check if item already in cart
    const existing = receivingCart.find((i) => i.variant_id === item.variant_id);
    if (existing) {
      // Update quantity
      setReceivingCart(
        receivingCart.map((i) =>
          i.variant_id === item.variant_id
            ? { ...i, qty_received: i.qty_received + item.qty_received }
            : i
        )
      );
    } else {
      setReceivingCart([...receivingCart, item]);
    }
  };

  const handleRemoveFromCart = (variantId: string) => {
    setReceivingCart(receivingCart.filter((i) => i.variant_id !== variantId));
  };

  const handleUpdateCartItem = (variantId: string, updates: Partial<ReceivedItem>) => {
    setReceivingCart(
      receivingCart.map((i) =>
        i.variant_id === variantId ? { ...i, ...updates } : i
      )
    );
  };

  // Mobile-optimized layout with safe area support
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#fff',
        overflow: 'hidden',
        paddingTop: 'max(0px, env(safe-area-inset-top))',
        paddingBottom: 'max(0px, env(safe-area-inset-bottom))',
        paddingLeft: 'max(0px, env(safe-area-inset-left))',
        paddingRight: 'max(0px, env(safe-area-inset-right))',
      }}
    >
      {view === 'list' && <PoListView onSelectPo={handleSelectPo} />}

      {view === 'receive' && selectedPo && (
        <ReceiveInterfaceView
          po={selectedPo}
          cart={receivingCart}
          onBack={handleBack}
          onAddToCart={handleAddToCart}
          onRemoveFromCart={handleRemoveFromCart}
          onUpdateCartItem={handleUpdateCartItem}
        />
      )}

      <style jsx>{`
        :global(html) {
          -webkit-user-zoom: fixed;
          -webkit-user-select: none;
          user-select: none;
        }

        :global(input, textarea, select) {
          font-size: 16px;
          -webkit-user-select: text;
          user-select: text;
        }

        :global(body) {
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
          background: #fff;
        }

        :global(*) {
          box-sizing: border-box;
        }
      `}</style>
    </div>
  );
}
