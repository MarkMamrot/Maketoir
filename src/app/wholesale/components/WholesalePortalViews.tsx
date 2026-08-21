'use client';

import { ArrowRight, Building2, CreditCard, LifeBuoy, Mail, MapPin, PackageSearch, ReceiptText, ShoppingCart, UserRound } from 'lucide-react';
import type { WholesaleSession } from '@/lib/wholesale/wholesaleSession';
import type { WholesaleSupplierProfile } from '@/lib/wholesale/wholesaleSupplierProfile';
import type { WholesaleAccountProfile, WholesaleAddress } from '@/lib/wholesale/wholesaleAccountProfile';
import type { WholesalePortalView } from './WholesalePortalShell';
import styles from './WholesalePortalViews.module.css';

export function WholesaleHomeView({
  session,
  productCount,
  cartCount,
  draftActive,
  accountProfile,
  onNavigate,
  onCartOpen,
}: {
  session: WholesaleSession;
  productCount: number;
  cartCount: number;
  draftActive: boolean;
  accountProfile: WholesaleAccountProfile | null;
  onNavigate: (view: WholesalePortalView) => void;
  onCartOpen: () => void;
}) {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Buyer workspace</p>
        <h1 className={styles.title}>Welcome back, {session.name || session.company}.</h1>
        <p className={styles.lede}>Browse your approved range, build the next order and keep drafts close at hand.</p>
        <div className={styles.heroActions}>
          <button className={styles.primary} onClick={() => onNavigate('catalogue')}><PackageSearch size={17} /> Browse catalogue <ArrowRight size={16} /></button>
          {(cartCount > 0 || draftActive) && <button className={styles.secondary} onClick={onCartOpen}><ShoppingCart size={17} /> Continue order</button>}
        </div>
      </section>
      <div className={styles.metrics}>
        <div className={styles.metric}><span>Available products</span><strong>{productCount}</strong></div>
        <div className={styles.metric}><span>Items in current order</span><strong>{cartCount}</strong></div>
        <div className={styles.metric}><span>Buying location</span><strong>{accountProfile?.location.name || 'Loading'}</strong></div>
      </div>
      <div className={styles.sections}>
        <section>
          <h2 className={styles.sectionTitle}>Order workspace</h2>
          <div className={styles.activity}>
            <button className={styles.activityRow} onClick={() => onNavigate('catalogue')}><strong>Approved catalogue</strong><span>Browse range</span></button>
            <button className={styles.activityRow} onClick={() => onNavigate('orders')}><strong>Saved drafts</strong><span>Review orders</span></button>
            <button className={styles.activityRow} onClick={onCartOpen}><strong>Current order</strong><span>{cartCount} items</span></button>
          </div>
        </section>
        <aside className={styles.context}>
          <h2 className={styles.sectionTitle}>Account context</h2>
          <div className={styles.contextItem}><Building2 size={18} /><div><span>Company</span><strong>{session.company || session.name}</strong></div></div>
          <div className={styles.contextItem}><MapPin size={18} /><div><span>Buying location</span><strong>{accountProfile?.location.name || 'Loading'}</strong></div></div>
          <div className={styles.contextItem}><UserRound size={18} /><div><span>Signed in as</span><strong>{session.name || session.email}</strong></div></div>
        </aside>
      </div>
    </div>
  );
}

function AddressBlock({ title, address }: { title: string; address: WholesaleAddress }) {
  const lines = [
    address.address,
    address.address2,
    [address.suburb, address.city].filter(Boolean).join(', '),
    [address.state, address.postcode].filter(Boolean).join(' '),
    address.country,
  ].filter(Boolean);
  return (
    <section className={styles.addressBlock}>
      <span>{title}</span>
      {lines.length > 1 ? lines.map((line, index) => <strong key={`${line}-${index}`}>{line}</strong>) : <strong>Not provided</strong>}
    </section>
  );
}

export function WholesaleAccountView({
  session,
  profile,
  loading,
  error,
}: {
  session: WholesaleSession;
  profile: WholesaleAccountProfile | null;
  loading: boolean;
  error: string;
}) {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Account</p>
        <h1 className={styles.title}>{session.company || session.name}</h1>
        <p className={styles.lede}>Your wholesale company, assigned buying location and commercial terms.</p>
      </section>
      {error && <div className={styles.accountError} role="alert">{error}</div>}
      {loading ? <div className={styles.accountLoading}>Loading account details...</div> : profile && (
        <div className={styles.accountGrid}>
          <section className={styles.accountSection}>
            <div className={styles.accountSectionTitle}><Building2 size={18} /><h2>Company</h2></div>
            <div className={styles.details}>
              <div className={styles.detailRow}><span>Company</span><strong>{profile.company.name}</strong></div>
              <div className={styles.detailRow}><span>ABN / tax ID</span><strong>{profile.company.taxId || 'Not provided'}</strong></div>
              <div className={styles.detailRow}><span>Buyer</span><strong>{session.name || 'Wholesale buyer'}</strong></div>
              <div className={styles.detailRow}><span>Email</span><strong>{session.email}</strong></div>
              <div className={styles.detailRow}><span>Account role</span><strong>{profile.member.role.charAt(0).toUpperCase() + profile.member.role.slice(1)}</strong></div>
            </div>
          </section>

          <section className={styles.accountSection}>
            <div className={styles.accountSectionTitle}><ReceiptText size={18} /><h2>Commercial terms</h2></div>
            <div className={styles.termsGrid}>
              <div><span>Payment terms</span><strong>{profile.company.paymentTerms || 'Not set'}</strong></div>
              <div><CreditCard size={17} /><span>Account limit</span><strong>{profile.company.onAccountLimit === null ? 'Not set' : profile.company.onAccountLimit.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })}</strong></div>
            </div>
          </section>

          <section className={`${styles.accountSection} ${styles.locationSection}`}>
            <div className={styles.accountSectionTitle}><MapPin size={18} /><div><h2>{profile.location.name}</h2><span>{profile.location.isPrimary ? 'Primary buying location' : 'Buying location'}</span></div></div>
            <div className={styles.addressGrid}>
              <AddressBlock title="Shipping address" address={profile.location.shippingAddress} />
              <AddressBlock title="Billing address" address={profile.location.billingAddress} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export function WholesaleHelpView({ supplier }: { supplier: WholesaleSupplierProfile }) {
  const email = supplier.supportEmail;
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Support</p>
        <h1 className={styles.title}>Help with your wholesale account.</h1>
        <p className={styles.lede}>Contact {supplier.displayName} for range, order and account assistance.</p>
      </section>
      <div className={styles.helpLinks}>
        {email ? (
          <a className={styles.helpLink} href={`mailto:${email}`}><Mail size={22} /><div><strong>Email support</strong><span>{email}</span></div></a>
        ) : (
          <div className={styles.helpLink}><LifeBuoy size={22} /><div><strong>Account manager</strong><span>Use your existing supplier contact.</span></div></div>
        )}
        <div className={styles.helpLink}><Building2 size={22} /><div><strong>Account</strong><span>{supplier.displayName} wholesale team</span></div></div>
      </div>
    </div>
  );
}