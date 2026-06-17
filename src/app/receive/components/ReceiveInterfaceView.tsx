'use client';

import { useState, useRef, useEffect } from 'react';
import BarcodeScanner from './BarcodeScanner';

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

interface ProductMatch {
  variant_id: string;
  product_id?: string | null;
  product_name: string;
  sku: string;
  barcode?: string | null;
  variant_label?: string;
}

interface POItem {
  variant_id: string;
  product_id?: string | null;
  product_name: string;
  sku: string;
  barcode?: string | null;
  variant_label?: string;
  qty_ordered: number;
  qty_received: number;
}

interface ReceiveInterfaceViewProps {
  po: PO;
  cart: ReceivedItem[];
  onBack: () => void;
  onAddToCart: (item: ReceivedItem) => void;
  onRemoveFromCart: (variantId: string) => void;
  onUpdateCartItem: (variantId: string, updates: Partial<ReceivedItem>) => void;
}

export default function ReceiveInterfaceView({
  po,
  cart,
  onBack,
  onAddToCart,
  onRemoveFromCart,
  onUpdateCartItem,
}: ReceiveInterfaceViewProps) {
  const [currentProduct, setCurrentProduct] = useState<ProductMatch | null>(null);
  const [currentQty, setCurrentQty] = useState('1');
  const [showProductMatcher, setShowProductMatcher] = useState(false);
  const [unmatchedBarcode, setUnmatchedBarcode] = useState<string | null>(null);
  const [matcherSearch, setMatcherSearch] = useState('');
  const [showMetaEditor, setShowMetaEditor] = useState(false);
  const [metaData, setMetaData] = useState<Partial<ReceivedItem>>({});
  const [poItems, setPoItems] = useState<POItem[]>([]);
  const [poItemsLoading, setPoItemsLoading] = useState(false);
  const [poItemsError, setPoItemsError] = useState<string | null>(null);
  const [poLocationId, setPoLocationId] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loadPoItems = async () => {
      setPoItemsLoading(true);
      setPoItemsError(null);
      try {
        const res = await fetch(`/api/ims/purchase-orders/${po.id}`);
        if (!res.ok) {
          throw new Error('Failed to load purchase order items');
        }
        const data = await res.json();
        const fullPo = data?.data;
        setPoItems(fullPo?.items || []);
        setPoLocationId(Number(fullPo?.location_id) || 1);
      } catch (err: any) {
        setPoItemsError(err?.message || 'Could not load PO products');
      } finally {
        setPoItemsLoading(false);
      }
    };

    loadPoItems();
  }, [po.id]);

  const getCartQtyForVariant = (variantId: string) =>
    cart.find((i) => i.variant_id === variantId)?.qty_received || 0;

  const itemsWithStatus = poItems.map((item) => {
    const alreadyReceived = Number(item.qty_received || 0);
    const pendingInCart = getCartQtyForVariant(item.variant_id);
    const totalReceived = alreadyReceived + pendingInCart;
    const qtyOrdered = Number(item.qty_ordered || 0);
    return {
      ...item,
      qtyOrdered,
      alreadyReceived,
      pendingInCart,
      totalReceived,
      remaining: Math.max(0, qtyOrdered - totalReceived),
    };
  });

  const filteredItems = itemsWithStatus.filter((item) => {
    const q = matcherSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      item.product_name.toLowerCase().includes(q) ||
      (item.sku || '').toLowerCase().includes(q) ||
      (item.variant_label || '').toLowerCase().includes(q)
    );
  });

  const waitingItems = filteredItems.filter((item) => item.remaining > 0);
  const receivedItems = filteredItems.filter((item) => item.totalReceived > 0);

  const setCurrentFromPoItem = (item: POItem, preserveUnmatchedBarcode = false) => {
    setCurrentProduct({
      variant_id: item.variant_id,
      product_id: item.product_id,
      product_name: item.product_name,
      sku: item.sku,
      barcode: item.barcode,
      variant_label: item.variant_label,
    });
    setCurrentQty('1');
    if (!preserveUnmatchedBarcode) {
      setUnmatchedBarcode(null);
    }
    setShowProductMatcher(false);
  };

  const handleBarcodeScanned = async (barcode: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ims/variants/by-barcode?barcode=${encodeURIComponent(barcode)}`);
      if (res.ok) {
        const data = await res.json();
        setCurrentProduct(data.data);
        setCurrentQty('1');
        setUnmatchedBarcode(null);
      } else {
        setUnmatchedBarcode(barcode);
        setShowProductMatcher(true);
        setCurrentProduct(null);
      }
    } catch (err) {
      console.error('Error scanning barcode:', err);
      alert('Error: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToCart = () => {
    if (!currentProduct) return;

    const qty = parseInt(currentQty) || 1;
    if (qty <= 0) {
      alert('Quantity must be greater than 0');
      return;
    }

    const item: ReceivedItem = {
      variant_id: currentProduct.variant_id,
      product_name: currentProduct.product_name,
      sku: currentProduct.sku,
      qty_received: qty,
      barcode: unmatchedBarcode || currentProduct.barcode,
      ...metaData,
    };

    onAddToCart(item);

    // Reset form
    setCurrentProduct(null);
    setCurrentQty('1');
    setUnmatchedBarcode(null);
    setMetaData({});

    // Show confirmation
    if (navigator.vibrate) {
      navigator.vibrate([30, 20, 30]);
    }
  };

  const handleReceiveAll = async () => {
    if (cart.length === 0) {
      alert('Cart is empty');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        po_id: po.id,
        location_id: poLocationId,
        received_items: cart.map((item) => ({
          variant_id: item.variant_id,
          qty_received: item.qty_received,
          barcode_new: item.barcode,
        })),
        product_updates: [], // Can be expanded later
        stock_updates: cart.map((item) => ({
          variant_id: item.variant_id,
          min_qty: item.min_qty,
          reorder_qty: item.reorder_qty,
        })),
        mark_po_received: true,
      };

      const res = await fetch('/api/ims/receive/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        alert(`Success! Received ${data.items_received} items for PO ${po.po_number}`);
        onBack();
      } else {
        const error = await res.json();
        alert('Error: ' + (error.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('Error saving:', err);
      alert('Error: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleClearCart = () => {
    if (window.confirm('Clear all items from cart?')) {
      // Clear via parent component by removing all items
      cart.forEach((item) => onRemoveFromCart(item.variant_id));
    }
  };

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
          padding: '12px 16px',
          backgroundColor: '#0066cc',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          paddingTop: 'max(12px, env(safe-area-inset-top))',
        }}
      >
        <button
          onClick={onBack}
          style={{
            width: '44px',
            height: '44px',
            border: 'none',
            background: 'rgba(255,255,255,0.2)',
            color: '#fff',
            fontSize: '20px',
            cursor: 'pointer',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ◀
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{po.po_number}</div>
          <div style={{ fontSize: '12px', opacity: 0.8 }}>{po.supplier_name}</div>
        </div>
      </div>

      {/* Scanner & Product Info */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <BarcodeScanner onScanDetected={handleBarcodeScanned} isActive={true} />

        {/* PO Items Section */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #ddd', backgroundColor: '#fafafa' }}>
          <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '8px' }}>
            PO Items ({poItems.length})
          </div>
          <input
            type="text"
            placeholder="Search PO products..."
            value={matcherSearch}
            onChange={(e) => setMatcherSearch(e.target.value)}
            style={{
              width: '100%',
              height: '40px',
              padding: '0 12px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              marginBottom: '8px',
              fontSize: '14px',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ maxHeight: '220px', overflow: 'auto', border: '1px solid #eee', borderRadius: '6px', backgroundColor: '#fff' }}>
            {poItemsLoading && <div style={{ padding: '12px', fontSize: '13px', color: '#666' }}>Loading items...</div>}
            {!poItemsLoading && poItemsError && <div style={{ padding: '12px', fontSize: '13px', color: '#c33' }}>{poItemsError}</div>}
            {!poItemsLoading && !poItemsError && filteredItems.length === 0 && (
              <div style={{ padding: '12px', fontSize: '13px', color: '#666' }}>No matching products.</div>
            )}

            {!poItemsLoading && !poItemsError && waitingItems.length > 0 && (
              <div style={{ padding: '8px 10px', fontSize: '11px', color: '#666', fontWeight: 'bold', borderBottom: '1px solid #f0f0f0' }}>
                Waiting to Receive ({waitingItems.length})
              </div>
            )}
            {!poItemsLoading && !poItemsError && waitingItems.map((item) => (
              <div key={`wait-${item.variant_id}`} style={{ padding: '10px', borderBottom: '1px solid #f4f4f4', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.product_name}</div>
                  <div style={{ fontSize: '12px', color: '#666' }}>{item.sku || 'No SKU'} {item.variant_label ? `• ${item.variant_label}` : ''}</div>
                  <div style={{ fontSize: '12px', color: '#0066cc' }}>Remaining: {item.remaining} (Received {item.totalReceived}/{item.qtyOrdered})</div>
                </div>
                <button
                  onClick={() => setCurrentFromPoItem(item)}
                  style={{
                    height: '36px',
                    padding: '0 10px',
                    border: '1px solid #0066cc',
                    background: '#fff',
                    color: '#0066cc',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  Select
                </button>
              </div>
            ))}

            {!poItemsLoading && !poItemsError && receivedItems.length > 0 && (
              <div style={{ padding: '8px 10px', fontSize: '11px', color: '#666', fontWeight: 'bold', borderTop: '1px solid #f0f0f0', borderBottom: '1px solid #f0f0f0', backgroundColor: '#fcfcfc' }}>
                Received / In Progress ({receivedItems.length})
              </div>
            )}
            {!poItemsLoading && !poItemsError && receivedItems.map((item) => (
              <div key={`done-${item.variant_id}`} style={{ padding: '10px', borderBottom: '1px solid #f4f4f4' }}>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>{item.product_name}</div>
                <div style={{ fontSize: '12px', color: '#666' }}>{item.sku || 'No SKU'} {item.variant_label ? `• ${item.variant_label}` : ''}</div>
                <div style={{ fontSize: '12px', color: item.remaining === 0 ? '#2e7d32' : '#666' }}>
                  Received {item.totalReceived}/{item.qtyOrdered}{item.pendingInCart > 0 ? ` (incl. ${item.pendingInCart} pending)` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Product Info Section */}
        {currentProduct && (
          <div style={{ padding: '16px', backgroundColor: '#f0f8ff', borderBottom: '1px solid #ddd' }}>
            <div style={{ fontWeight: 'bold', fontSize: '16px', marginBottom: '8px' }}>
              {currentProduct.product_name}
            </div>
            {!!(unmatchedBarcode || currentProduct.barcode) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <div style={{ fontSize: '12px', color: '#0b5', backgroundColor: '#e8f8ef', border: '1px solid #b8e7cc', borderRadius: '999px', padding: '4px 10px', flex: 1 }}>
                  Barcode: {unmatchedBarcode || currentProduct.barcode}
                </div>
                <button
                  onClick={() => setUnmatchedBarcode(null)}
                  style={{
                    width: '32px',
                    height: '32px',
                    border: '1px solid #ccc',
                    backgroundColor: '#fff',
                    borderRadius: '999px',
                    cursor: 'pointer',
                    fontSize: '16px',
                    lineHeight: 1,
                  }}
                  title="Dismiss barcode"
                >
                  ×
                </button>
              </div>
            )}
            <div style={{ fontSize: '14px', color: '#666', marginBottom: '4px' }}>
              SKU: {currentProduct.sku}
            </div>
            {currentProduct.variant_label && (
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '8px' }}>
                {currentProduct.variant_label}
              </div>
            )}

            {/* Qty Input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <label style={{ fontSize: '14px', minWidth: '60px' }}>Qty:</label>
              <input
                ref={qtyInputRef}
                type="number"
                value={currentQty}
                onChange={(e) => setCurrentQty(e.target.value)}
                style={{
                  flex: 1,
                  height: '44px',
                  padding: '0 12px',
                  fontSize: '16px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                }}
              />
              <button
                onClick={() => setCurrentQty(Math.max(1, parseInt(currentQty) - 1).toString())}
                style={{
                  width: '44px',
                  height: '44px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '18px',
                  cursor: 'pointer',
                  backgroundColor: '#f5f5f5',
                }}
              >
                −
              </button>
              <button
                onClick={() => setCurrentQty((parseInt(currentQty) + 1).toString())}
                style={{
                  width: '44px',
                  height: '44px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '18px',
                  cursor: 'pointer',
                  backgroundColor: '#f5f5f5',
                }}
              >
                +
              </button>
            </div>

            {/* Meta Editor Toggle */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '12px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              <input
                type="checkbox"
                checked={showMetaEditor}
                onChange={(e) => setShowMetaEditor(e.target.checked)}
                style={{ width: '20px', height: '20px', cursor: 'pointer' }}
              />
              Edit metadata (Min Qty, Zone, Bin)
            </label>

            {/* Meta Editor */}
            {showMetaEditor && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px',
                  marginBottom: '12px',
                }}
              >
                <input
                  type="number"
                  placeholder="Min Qty"
                  value={metaData.min_qty || ''}
                  onChange={(e) =>
                    setMetaData({
                      ...metaData,
                      min_qty: e.target.value ? parseInt(e.target.value) : undefined,
                    })
                  }
                  style={{
                    height: '44px',
                    padding: '0 12px',
                    fontSize: '16px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                  }}
                />
                <input
                  type="number"
                  placeholder="Reorder Qty"
                  value={metaData.reorder_qty || ''}
                  onChange={(e) =>
                    setMetaData({
                      ...metaData,
                      reorder_qty: e.target.value ? parseInt(e.target.value) : undefined,
                    })
                  }
                  style={{
                    height: '44px',
                    padding: '0 12px',
                    fontSize: '16px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                  }}
                />
                <input
                  type="text"
                  placeholder="Zone"
                  value={metaData.zone || ''}
                  onChange={(e) => setMetaData({ ...metaData, zone: e.target.value })}
                  style={{
                    height: '44px',
                    padding: '0 12px',
                    fontSize: '16px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                  }}
                />
                <input
                  type="text"
                  placeholder="Bin"
                  value={metaData.bin || ''}
                  onChange={(e) => setMetaData({ ...metaData, bin: e.target.value })}
                  style={{
                    height: '44px',
                    padding: '0 12px',
                    fontSize: '16px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                  }}
                />
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => {
                  setCurrentProduct(null);
                  setCurrentQty('1');
                  setMetaData({});
                }}
                style={{
                  flex: 1,
                  height: '44px',
                  border: '1px solid #ddd',
                  backgroundColor: '#f5f5f5',
                  fontSize: '16px',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                }}
              >
                Clear
              </button>
              <button
                onClick={handleAddToCart}
                disabled={loading}
                style={{
                  flex: 1,
                  height: '44px',
                  backgroundColor: '#0066cc',
                  color: '#fff',
                  border: 'none',
                  fontSize: '16px',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  opacity: loading ? 0.6 : 1,
                }}
              >
                {loading ? '...' : 'Add to Cart'}
              </button>
            </div>
          </div>
        )}

        {/* Cart Section */}
        {cart.length > 0 && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: '#f9f9f9',
              borderTop: '2px solid #ddd',
              maxHeight: '200px',
              overflow: 'auto',
            }}
          >
            <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>
              Cart ({cart.length} items)
            </div>
            {cart.map((item) => (
              <div
                key={item.variant_id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px',
                  backgroundColor: '#fff',
                  marginBottom: '8px',
                  borderRadius: '6px',
                  fontSize: '14px',
                }}
              >
                <div>
                  <div style={{ fontWeight: 'bold' }}>{item.product_name}</div>
                  <div style={{ fontSize: '12px', color: '#666' }}>Qty: {item.qty_received}</div>
                </div>
                <button
                  onClick={() => onRemoveFromCart(item.variant_id)}
                  style={{
                    width: '32px',
                    height: '32px',
                    border: 'none',
                    backgroundColor: '#fee',
                    color: '#c33',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '16px',
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer - Fixed Buttons */}
      <div
        style={{
          padding: '12px 16px',
          paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
          backgroundColor: '#f5f5f5',
          borderTop: '1px solid #ddd',
          display: 'flex',
          gap: '8px',
        }}
      >
        <button
          onClick={handleClearCart}
          disabled={cart.length === 0 || saving}
          style={{
            flex: 1,
            height: '44px',
            border: '1px solid #ddd',
            backgroundColor: '#fff',
            fontSize: '16px',
            cursor: 'pointer',
            borderRadius: '6px',
            fontWeight: 'bold',
            opacity: cart.length === 0 || saving ? 0.5 : 1,
          }}
        >
          Clear
        </button>
        <button
          onClick={handleReceiveAll}
          disabled={cart.length === 0 || saving}
          style={{
            flex: 1,
            height: '44px',
            backgroundColor: '#4CAF50',
            color: '#fff',
            border: 'none',
            fontSize: '16px',
            cursor: 'pointer',
            borderRadius: '6px',
            fontWeight: 'bold',
            opacity: cart.length === 0 || saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving...' : 'Receive All'}
        </button>
      </div>

      {/* Product Matcher Modal */}
      {showProductMatcher && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 1000,
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: '12px 12px 0 0',
              marginTop: 'auto',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '80vh',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px', borderBottom: '1px solid #ddd' }}>
              <h3 style={{ margin: '0 0 8px 0' }}>Product Not Found</h3>
              <p style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#666' }}>
                Barcode: {unmatchedBarcode}
              </p>
              <p style={{ margin: 0, fontSize: '14px', color: '#666' }}>
                Select a product or enter a new one manually.
              </p>
            </div>

            {/* Modal Content */}
            <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
              <input
                type="text"
                placeholder="Search product..."
                value={matcherSearch}
                onChange={(e) => setMatcherSearch(e.target.value)}
                style={{
                  width: '100%',
                  height: '44px',
                  padding: '0 12px',
                  fontSize: '16px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  marginBottom: '12px',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ border: '1px solid #eee', borderRadius: '8px', overflow: 'hidden' }}>
                {waitingItems.length === 0 && (
                  <div style={{ padding: '12px', fontSize: '13px', color: '#666' }}>
                    No waiting products found in this PO.
                  </div>
                )}
                {waitingItems.map((item) => (
                  <button
                    key={`matcher-${item.variant_id}`}
                    onClick={() => setCurrentFromPoItem(item, true)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      borderBottom: '1px solid #f2f2f2',
                      background: '#fff',
                      padding: '10px 12px',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>{item.product_name}</div>
                    <div style={{ fontSize: '12px', color: '#666' }}>{item.sku || 'No SKU'} {item.variant_label ? `• ${item.variant_label}` : ''}</div>
                    <div style={{ fontSize: '12px', color: '#0066cc' }}>Remaining: {item.remaining}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Modal Actions */}
            <div
              style={{
                padding: '12px 16px',
                paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
                borderTop: '1px solid #ddd',
                display: 'flex',
                gap: '8px',
              }}
            >
              <button
                onClick={() => {
                  setShowProductMatcher(false);
                  setUnmatchedBarcode(null);
                }}
                style={{
                  flex: 1,
                  height: '44px',
                  border: '1px solid #ddd',
                  backgroundColor: '#fff',
                  fontSize: '16px',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  // For now, just allow proceeding with the unmatched barcode
                  setShowProductMatcher(false);
                  // User can manually enter product details
                }}
                style={{
                  flex: 1,
                  height: '44px',
                  backgroundColor: '#0066cc',
                  color: '#fff',
                  border: 'none',
                  fontSize: '16px',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
