'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  BookOpen,
  Bookmark,
  Building2,
  CircleUserRound,
  HelpCircle,
  House,
  LogOut,
  PanelsTopLeft,
  MapPin,
  Menu,
  PackageSearch,
  Search,
  ShoppingBag,
  ShoppingCart,
  WifiOff,
  X,
} from 'lucide-react';
import type { WholesaleSession } from '@/lib/wholesale/wholesaleSession';
import type { WholesaleSupplierProfile } from '@/lib/wholesale/wholesaleSupplierProfile';
import styles from './WholesalePortalShell.module.css';
import { WholesaleLayoutEditor } from './layout/WholesaleLayoutEditor';

export type WholesalePortalView = 'home' | 'catalogue' | 'lists' | 'orders' | 'account' | 'help';

const navigation = [
  { id: 'home' as const, label: 'Home', icon: House },
  { id: 'catalogue' as const, label: 'Catalogue', icon: PackageSearch },
  { id: 'lists' as const, label: 'Saved', icon: Bookmark },
  { id: 'orders' as const, label: 'Orders', icon: BookOpen },
  { id: 'account' as const, label: 'Account', icon: CircleUserRound },
  { id: 'help' as const, label: 'Help', icon: HelpCircle },
];

function safeLogoUrl(url: string | null): string | null {
  if (!url || /drive\.google\.com/i.test(url)) return null;
  return url;
}

export function WholesalePortalShell({
  supplier,
  session,
  view,
  searchQuery,
  cartCount,
  cartValue,
  locationName,
  locations,
  locationId,
  locationSwitching,
  onViewChange,
  onSearchChange,
  onCartOpen,
  onLocationChange,
  onLogout,
  children,
}: {
  supplier: WholesaleSupplierProfile;
  session: WholesaleSession;
  view: WholesalePortalView;
  searchQuery: string;
  cartCount: number;
  cartValue: number;
  locationName?: string;
  locations?: Array<{ id: number; name: string; isPrimary: boolean }>;
  locationId?: number;
  locationSwitching?: boolean;
  onViewChange: (view: WholesalePortalView) => void;
  onSearchChange: (value: string) => void;
  onCartOpen: () => void;
  onLocationChange?: (locationId: number) => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const isPreview = Boolean(session.preview);
  const canTestCheckout = session.preview?.mode === 'ims_draft_test';
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const logoUrl = safeLogoUrl(supplier.logoUrl);
  const initials = supplier.displayName.trim().charAt(0).toUpperCase() || 'W';
  const buyingLocation = locationName || 'Buying location';

  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const changeView = (nextView: WholesalePortalView) => {
    setDrawerOpen(false);
    onViewChange(nextView);
  };

  const search = (
    <div className={styles.search}>
      <Search className={styles.searchIcon} size={17} aria-hidden="true" />
      <input
        aria-label="Search catalogue"
        placeholder="Search products, SKU or barcode"
        value={searchQuery}
        onChange={event => onSearchChange(event.target.value)}
        onFocus={() => view !== 'catalogue' && onViewChange('catalogue')}
      />
      {searchQuery && (
        <button className={`${styles.iconButton} ${styles.clearSearch}`} onClick={() => onSearchChange('')} aria-label="Clear search" title="Clear search">
          <X size={16} />
        </button>
      )}
    </div>
  );

  const nav = (
    <nav className={styles.nav} aria-label="Wholesale portal">
      {navigation.map(item => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            className={`${styles.navButton} ${view === item.id ? styles.navButtonActive : ''}`}
            onClick={() => changeView(item.id)}
            aria-current={view === item.id ? 'page' : undefined}
          >
            <Icon size={18} aria-hidden="true" />
            {item.label}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className={styles.shell}>
      {session.preview && <div role="status" style={{ minHeight: 42, padding: '8px 18px', background: '#fff3cd', borderBottom: '1px solid #e5c66b', color: '#533f03', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
        <strong>Staff preview · {canTestCheckout ? 'Test checkout' : 'Read-only'}</strong>
        <span>{session.company} / {session.name} / {buyingLocation}</span>
        <button onClick={() => setLayoutEditorOpen(open => !open)} aria-pressed={layoutEditorOpen} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #9b7a1b', borderRadius: 4, background: layoutEditorOpen ? '#533f03' : '#fffaf0', color: layoutEditorOpen ? '#fff' : '#533f03', padding: '4px 9px', fontWeight: 700, cursor: 'pointer' }}><PanelsTopLeft size={14} /> {layoutEditorOpen ? 'Exit layout editor' : 'Edit layout'}</button>
        <button onClick={onLogout} style={{ border: '1px solid #9b7a1b', borderRadius: 4, background: '#fffaf0', color: '#533f03', padding: '4px 9px', fontWeight: 700, cursor: 'pointer' }}>Exit preview</button>
      </div>}
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <button className={styles.menuButton} onClick={() => setDrawerOpen(true)} aria-label="Open navigation" title="Open navigation">
            <Menu size={19} />
          </button>
          {logoUrl ? <img className={styles.logo} src={logoUrl} alt="" /> : <div className={styles.lettermark}>{initials}</div>}
          <div style={{ minWidth: 0 }}>
            <div className={styles.brandName}>{supplier.displayName}</div>
            <div className={styles.brandLabel}>Wholesale account</div>
          </div>
        </div>
        {search}
        <div className={styles.actions}>
          <div className={styles.accountSummary}>
            <strong>{session.company || session.name}</strong>
            {(!isPreview || canTestCheckout) && locations && locations.length > 1 && onLocationChange ? (
              <label className={styles.locationSelect}>
                <MapPin size={13} aria-hidden="true" />
                <select value={locationId} disabled={locationSwitching} onChange={event => onLocationChange(Number(event.target.value))} aria-label="Buying location">
                  {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
              </label>
            ) : <span>{buyingLocation}</span>}
          </div>
          {(!isPreview || canTestCheckout) && <button className={styles.cartButton} onClick={onCartOpen} aria-label={`Open cart with ${cartCount} items`}>
            <ShoppingCart size={17} aria-hidden="true" />
            <span>{cartCount}</span>
            <span className={styles.cartValue}>${cartValue.toLocaleString('en-AU', { minimumFractionDigits: 2 })}</span>
          </button>}
          {!isPreview && <button className={styles.iconButton} onClick={onLogout} aria-label="Sign out" title="Sign out">
            <LogOut size={18} />
          </button>}
        </div>
      </header>

      <div className={styles.body}>
        {layoutEditorOpen && <WholesaleLayoutEditor />}
        <aside className={styles.sidebar}>
          {nav}
          <div className={styles.sidebarFooter}>
            <div><Building2 size={14} aria-hidden="true" /> {session.company || session.name}</div>
            <div className={styles.location}><MapPin size={14} aria-hidden="true" /> {buyingLocation}</div>
          </div>
        </aside>
        <main className={styles.content} aria-label={layoutEditorOpen ? 'Layout preview canvas' : undefined}>{children}</main>
      </div>

      {drawerOpen && (
        <>
          <button className={styles.backdrop} onClick={() => setDrawerOpen(false)} aria-label="Close navigation" />
          <aside className={styles.drawer} aria-label="Mobile navigation">
            <div className={styles.drawerHead}>
              <div className={styles.brand}>
                <div className={styles.lettermark}>{initials}</div>
                <strong>{supplier.displayName}</strong>
              </div>
              <button className={styles.iconButton} onClick={() => setDrawerOpen(false)} aria-label="Close navigation" title="Close navigation"><X size={18} /></button>
            </div>
            {search}
            {nav}
            <div className={styles.sidebarFooter}>
              <div className={styles.location}><MapPin size={14} aria-hidden="true" /> {buyingLocation}</div>
            </div>
          </aside>
        </>
      )}

      {!online && <div className={styles.offline} role="status"><WifiOff size={16} /> Offline</div>}
    </div>
  );
}