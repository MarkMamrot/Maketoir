'use client';

import { useEffect, useState } from 'react';
import { BookmarkPlus, Heart, ListChecks, ShoppingCart, Trash2 } from 'lucide-react';
import styles from './WholesaleSavedListsView.module.css';

export type WholesaleSavedList = {
  id: number;
  name: string;
  createdByMe: boolean;
  canManage: boolean;
  updatedAt: string;
  items: Array<{ variantId: string; quantity: number }>;
};

export type WholesaleFavouriteDetail = {
  variantId: string;
  productName: string;
  variantLabel: string;
  sku: string | null;
  price: number;
  available: number;
  orderable: boolean;
};

export function WholesaleSavedListsView({
  cartItems,
  favouriteDetails,
  onUseList,
  onAddFavouriteToCart,
  onRemoveFavourite,
  onBrowse,
  onNotice,
  readOnly = false,
}: {
  cartItems: Array<{ variant_id: string; qty: number }>;
  favouriteDetails: WholesaleFavouriteDetail[];
  onUseList: (list: WholesaleSavedList) => void;
  onAddFavouriteToCart: (variantId: string) => void;
  onRemoveFavourite: (variantId: string) => void;
  onBrowse: () => void;
  onNotice: (message: string) => void;
  readOnly?: boolean;
}) {
  const [lists, setLists] = useState<WholesaleSavedList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingUse, setPendingUse] = useState<WholesaleSavedList | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WholesaleSavedList | null>(null);

  const loadLists = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/wholesale/saved-lists');
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Saved orders could not be loaded.');
      setLists(body.lists ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Saved orders could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadLists(); }, []);
  useEffect(() => {
    if (!pendingUse && !pendingDelete) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPendingUse(null);
        setPendingDelete(null);
      }
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [pendingUse, pendingDelete]);

  const saveCurrentCart = async () => {
    if (readOnly) return;
    if (!name.trim() || cartItems.length === 0) return;
    setSaving(true);
    try {
      const response = await fetch('/api/wholesale/saved-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          items: cartItems.map(item => ({ variantId: item.variant_id, quantity: item.qty })),
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Saved order could not be created.');
      setName('');
      await loadLists();
      onNotice('Saved order created.');
    } catch (saveError) {
      onNotice(saveError instanceof Error ? saveError.message : 'Saved order could not be created.');
    } finally {
      setSaving(false);
    }
  };

  const requestUse = (list: WholesaleSavedList) => {
    if (cartItems.length > 0) setPendingUse(list);
    else onUseList(list);
  };

  const deleteList = async (list: WholesaleSavedList) => {
    if (readOnly) return;
    try {
      const response = await fetch(`/api/wholesale/saved-lists/${list.id}`, { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Saved order could not be deleted.');
      setLists(current => current.filter(item => item.id !== list.id));
      setPendingDelete(null);
      onNotice('Saved order deleted.');
    } catch (deleteError) {
      onNotice(deleteError instanceof Error ? deleteError.message : 'Saved order could not be deleted.');
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Repeat buying</p>
          <h1>Saved orders</h1>
          <p>Keep core ranges and seasonal buys ready without freezing old prices or availability.</p>
        </div>
        <button className={styles.browseButton} onClick={onBrowse}>Browse catalogue</button>
      </header>

      {!readOnly && <section className={styles.saveBand}>
        <div><BookmarkPlus size={19} /><span><strong>Save current cart</strong><small>{cartItems.length} variant{cartItems.length === 1 ? '' : 's'} ready</small></span></div>
        <div className={styles.saveControls}>
          <input aria-label="Saved order name" placeholder="e.g. Summer core range" value={name} maxLength={80} onChange={event => setName(event.target.value)} />
          <button onClick={saveCurrentCart} disabled={saving || !name.trim() || cartItems.length === 0}>{saving ? 'Saving…' : 'Save order'}</button>
        </div>
      </section>}

      <div className={styles.columns}>
        <section>
          <div className={styles.sectionHeading}><ListChecks size={18} /><h2>Order templates</h2><span>{lists.length}</span></div>
          {error && <div className={styles.error}>{error}</div>}
          {loading ? <div className={styles.empty}>Loading saved orders…</div> : lists.length === 0 ? (
            <div className={styles.empty}>Build a cart, then save it as a reusable range.</div>
          ) : (
            <div className={styles.list}>
              {lists.map(list => (
                <article className={styles.listRow} key={list.id}>
                  <div><strong>{list.name}</strong><span>{list.items.length} variant{list.items.length === 1 ? '' : 's'} · {list.items.reduce((sum, item) => sum + item.quantity, 0)} units</span></div>
                  <div className={styles.rowActions}>
                    {!readOnly && list.canManage && <button className={styles.iconButton} onClick={() => setPendingDelete(list)} aria-label={`Delete ${list.name}`} title="Delete saved order"><Trash2 size={16} /></button>}
                    <button className={styles.useButton} onClick={() => requestUse(list)}><ShoppingCart size={15} /> Use order</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className={styles.sectionHeading}><Heart size={18} /><h2>Favourites</h2><span>{favouriteDetails.length}</span></div>
          {favouriteDetails.length === 0 ? <div className={styles.empty}>Use the heart beside a catalogue variant to keep it here.</div> : (
            <div className={styles.list}>
              {favouriteDetails.map(item => (
                <article className={styles.favouriteRow} key={item.variantId}>
                  <div><strong>{item.productName}</strong><span>{item.variantLabel}{item.sku ? ` · ${item.sku}` : ''}</span><small>${item.price.toFixed(2)} · {item.available} available</small></div>
                  <div className={styles.rowActions}>
                    {!readOnly && <button className={styles.iconButton} onClick={() => onRemoveFavourite(item.variantId)} aria-label={`Remove ${item.productName} from favourites`} title="Remove favourite"><Heart size={16} fill="currentColor" /></button>}
                    <button className={styles.useButton} disabled={!item.orderable} onClick={() => onAddFavouriteToCart(item.variantId)}>Add to cart</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {pendingUse && (
        <div className={styles.confirm} role="alert">
          <span>Replace the current cart with <strong>{pendingUse.name}</strong>?</span>
          <button onClick={() => setPendingUse(null)}>Keep cart</button>
          <button className={styles.confirmPrimary} onClick={() => { onUseList(pendingUse); setPendingUse(null); }}>Replace cart</button>
        </div>
      )}
      {pendingDelete && (
        <div className={styles.confirm} role="alert">
          <span>Delete <strong>{pendingDelete.name}</strong> for this account?</span>
          <button onClick={() => setPendingDelete(null)}>Cancel</button>
          <button className={styles.danger} onClick={() => void deleteList(pendingDelete)}>Delete</button>
        </div>
      )}
    </div>
  );
}