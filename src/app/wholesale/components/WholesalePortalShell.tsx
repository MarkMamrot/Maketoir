'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  BookOpen,
  Bookmark,
  ChevronDown,
  CircleUserRound,
  HelpCircle,
  House,
  Laptop,
  LogOut,
  PanelsTopLeft,
  MapPin,
  Menu,
  PackageSearch,
  Search,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react';
import type { WholesaleSession } from '@/lib/wholesale/wholesaleSession';
import type { WholesaleSupplierProfile } from '@/lib/wholesale/wholesaleSupplierProfile';
import type { WholesaleLayoutDocument, WholesaleLayoutPageId } from '@/lib/wholesale/layout/types';
import styles from './WholesalePortalShell.module.css';
import { WholesaleLayoutEditor } from './layout/WholesaleLayoutEditor';
import { UnifiedHelpDrawer } from '@/components/help/UnifiedHelpDrawer';
import { resolveWholesaleThemeColors } from '@/lib/wholesale/layout/validation';

export type WholesalePortalView = 'home' | 'catalogue' | 'lists' | 'orders' | 'account' | 'help';

// Shown as direct tabs in the top bar.
const primaryNavigation = [
  { id: 'home' as const, label: 'Home', icon: House },
  { id: 'catalogue' as const, label: 'Shop', icon: PackageSearch },
  { id: 'lists' as const, label: 'Saved', icon: Bookmark },
];

// Tucked under the account dropdown in the top bar.
const accountNavigation = [
  { id: 'orders' as const, label: 'Orders', icon: BookOpen },
  { id: 'account' as const, label: 'Account', icon: CircleUserRound },
  { id: 'help' as const, label: 'Help', icon: HelpCircle },
];

// Full list, used for the mobile drawer only.
const navigation = [...primaryNavigation, ...accountNavigation];

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
  onLayoutPreviewChange,
  onLayoutPageChange,
  onLayoutPublished,
  layoutProducts,
  layoutProductId,
  onLayoutProductChange,
  layoutCollectionId,
  layoutCollections,
  onLayoutCollectionChange,
  layoutDocument,
  layoutPage,
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
  onLayoutPreviewChange?: (document: WholesaleLayoutDocument | null) => void;
  onLayoutPageChange?: (page: WholesaleLayoutPageId | null) => void;
  onLayoutPublished?: (document: WholesaleLayoutDocument) => void;
  layoutProducts?: Array<{ product_id: string; name: string }>;
  layoutProductId?: string;
  onLayoutProductChange?: (productId: string) => void;
  layoutCollectionId?: string;
  layoutCollections?: Array<{ id: string; label: string }>;
  onLayoutCollectionChange?: (collectionId: string) => void;
  layoutDocument: WholesaleLayoutDocument;
  layoutPage: WholesaleLayoutPageId;
}) {
  const isPreview = Boolean(session.preview);
  const canTestCheckout = session.preview?.mode === 'ims_draft_test';
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(view === 'help');
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
  const [layoutEditorDirty, setLayoutEditorDirty] = useState(false);
  const [layoutViewport, setLayoutViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [layoutEditorPage, setLayoutEditorPage] = useState<WholesaleLayoutPageId>('home');
  const [online, setOnline] = useState(true);
  const layoutCanvasRef = useRef<HTMLElement>(null);
  const logoUrl = safeLogoUrl(supplier.logoUrl);
  const initials = supplier.displayName.trim().charAt(0).toUpperCase() || 'W';
  const buyingLocation = locationName || 'Buying location';
  const themeColours = resolveWholesaleThemeColors(layoutDocument, layoutEditorOpen ? layoutEditorPage : layoutPage);
  const themeStyle = {
    '--wholesale-primary': themeColours.primary,
    '--wholesale-secondary': themeColours.secondary,
    '--wholesale-accent': themeColours.accent,
    '--wholesale-page-bg': themeColours.pageBackground,
    '--wholesale-surface': themeColours.surface,
    '--wholesale-text': themeColours.text,
    '--wholesale-muted': themeColours.mutedText,
  } as CSSProperties;

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

  useEffect(() => {
    if (layoutCanvasRef.current) layoutCanvasRef.current.inert = layoutEditorOpen;
  }, [layoutEditorOpen]);

  const changeView = (nextView: WholesalePortalView) => {
    setDrawerOpen(false);
    setAccountMenuOpen(false);
    if (nextView === 'help') {
      setHelpOpen(true);
      return;
    }
    onViewChange(nextView);
  };

  const toggleLayoutEditor = () => {
    if (layoutEditorOpen && layoutEditorDirty && !confirm('Discard unsaved layout changes and exit the editor?')) return;
    setLayoutEditorOpen(open => !open);
  };

  const exitPreview = () => {
    if (layoutEditorDirty && !confirm('Discard unsaved layout changes and exit staff preview?')) return;
    onLogout();
  };

  const handleLayoutPageChange = (page: WholesaleLayoutPageId | null) => {
    if (page) setLayoutEditorPage(page);
    onLayoutPageChange?.(page);
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

  const topNav = (
    <nav className={styles.topNav} aria-label="Primary">
      {primaryNavigation.map(item => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            className={`${styles.topNavButton} ${view === item.id ? styles.topNavButtonActive : ''}`}
            onClick={() => changeView(item.id)}
            aria-current={view === item.id ? 'page' : undefined}
          >
            <Icon size={16} aria-hidden="true" />
            {item.label}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className={styles.shell} style={themeStyle}>
      {session.preview && <div role="status" style={{ minHeight: 42, padding: '8px 18px', background: '#fff3cd', borderBottom: '1px solid #e5c66b', color: '#533f03', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
        <strong>Staff preview · Layout editor</strong>
        <span>{session.company} / {session.name} / {buyingLocation}</span>
        <span>Commerce: {canTestCheckout ? 'Test checkout to IMS Draft' : 'Read-only'}</span>
        {layoutEditorOpen && layoutEditorPage === 'product' && layoutProducts?.length && onLayoutProductChange && <label className={styles.sampleControl}>Product sample<select value={layoutProductId || layoutProducts[0].product_id} onChange={event => onLayoutProductChange(event.target.value)}>{layoutProducts.map(product => <option key={product.product_id} value={product.product_id}>{product.name}</option>)}</select></label>}
        {layoutEditorOpen && layoutEditorPage === 'collection' && layoutCollections?.length && onLayoutCollectionChange && <label className={styles.sampleControl}>Collection sample<select value={layoutCollectionId || layoutCollections[0].id} onChange={event => onLayoutCollectionChange(event.target.value)}>{layoutCollections.map(collection => <option key={collection.id} value={collection.id}>{collection.label}</option>)}</select></label>}
        {layoutEditorOpen && <div className={styles.viewportControl} role="group" aria-label="Preview viewport">
          <button onClick={() => setLayoutViewport('desktop')} aria-pressed={layoutViewport === 'desktop'} title="Desktop preview"><Laptop size={14} /> Desktop</button>
          <button onClick={() => setLayoutViewport('mobile')} aria-pressed={layoutViewport === 'mobile'} title="Mobile preview"><Smartphone size={14} /> Mobile</button>
        </div>}
        <button onClick={toggleLayoutEditor} aria-pressed={layoutEditorOpen} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #9b7a1b', borderRadius: 4, background: layoutEditorOpen ? '#533f03' : '#fffaf0', color: layoutEditorOpen ? '#fff' : '#533f03', padding: '4px 9px', fontWeight: 700, cursor: 'pointer' }}><PanelsTopLeft size={14} /> {layoutEditorOpen ? 'Close layout editor' : 'Edit layout'}</button>
        <button onClick={exitPreview} style={{ border: '1px solid #9b7a1b', borderRadius: 4, background: '#fffaf0', color: '#533f03', padding: '4px 9px', fontWeight: 700, cursor: 'pointer' }}>Exit preview</button>
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
        {topNav}
        {search}
        <div className={styles.actions}>
          {(!isPreview || canTestCheckout) && locations && locations.length > 1 && onLocationChange ? (
            <label className={styles.locationSelect}>
              <MapPin size={13} aria-hidden="true" />
              <select value={locationId} disabled={locationSwitching} onChange={event => onLocationChange(Number(event.target.value))} aria-label="Buying location">
                {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
          ) : (!isPreview || canTestCheckout) ? (
            <span className={styles.locationLabel}><MapPin size={13} aria-hidden="true" />{buyingLocation}</span>
          ) : null}
          {(!isPreview || canTestCheckout) && <button className={styles.cartButton} onClick={onCartOpen} aria-label={`Open cart with ${cartCount} items`}>
            <ShoppingCart size={17} aria-hidden="true" />
            <span>{cartCount}</span>
            <span className={styles.cartValue}>${cartValue.toLocaleString('en-AU', { minimumFractionDigits: 2 })}</span>
          </button>}
          <div className={styles.accountMenu}>
            <button
              className={styles.accountTrigger}
              onClick={() => setAccountMenuOpen(open => !open)}
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
            >
              <CircleUserRound size={18} aria-hidden="true" />
              <span className={styles.accountTriggerLabel}>{session.company || session.name}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {accountMenuOpen && (
              <>
                <button className={styles.dropdownBackdrop} onClick={() => setAccountMenuOpen(false)} aria-label="Close account menu" />
                <div className={styles.accountDropdown} role="menu">
                  <div className={styles.accountDropdownHeader}>
                    <strong>{session.company || session.name}</strong>
                    <span>{buyingLocation}</span>
                  </div>
                  {accountNavigation.map(item => {
                    const Icon = item.icon;
                    return (
                      <button key={item.id} role="menuitem" className={styles.accountDropdownItem} onClick={() => changeView(item.id)}>
                        <Icon size={16} aria-hidden="true" /> {item.label}
                      </button>
                    );
                  })}
                  {!isPreview && (
                    <>
                      <div className={styles.accountDropdownDivider} />
                      <button role="menuitem" className={styles.accountDropdownItem} onClick={onLogout}>
                        <LogOut size={16} aria-hidden="true" /> Sign out
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className={`${styles.body} ${layoutEditorOpen ? styles.bodyEditor : ''}`}>
        {layoutEditorOpen && <WholesaleLayoutEditor onPageChange={handleLayoutPageChange} onDocumentChange={onLayoutPreviewChange} onDirtyChange={setLayoutEditorDirty} onPublished={onLayoutPublished} products={layoutProducts} />}
        <div className={layoutEditorOpen ? styles.canvasStage : styles.canvasStageLive} data-viewport={layoutEditorOpen ? layoutViewport : undefined}>
          <main ref={layoutCanvasRef} className={styles.content} aria-label={layoutEditorOpen ? `${layoutViewport === 'mobile' ? 'Mobile' : 'Desktop'} layout preview canvas` : undefined}>{children}</main>
        </div>
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
              {!isPreview && <button className={styles.drawerLogout} onClick={onLogout}><LogOut size={14} aria-hidden="true" /> Sign out</button>}
            </div>
          </aside>
        </>

      )}

      {!online && <div className={styles.offline} role="status"><WifiOff size={16} /> Offline</div>}
      {!isPreview && <UnifiedHelpDrawer
        open={helpOpen}
        onOpenChange={setHelpOpen}
        audience="wholesale"
        product="wholesale"
        currentContext={view}
        chatEndpoint="/api/wholesale/assistant/chat"
        escalationEndpoint="/api/wholesale/assistant/escalate"
        assistantDisabled={!online}
        assistantDisabledLabel="Assistant needs an internet connection"
      />}
    </div>
  );
}