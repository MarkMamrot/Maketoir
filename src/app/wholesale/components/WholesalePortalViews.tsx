'use client';

import { ArrowRight, Building2, LifeBuoy, Mail, MapPin, PackageSearch, ShoppingCart, UserRound } from 'lucide-react';
import type { WholesaleSession } from '@/lib/wholesale/wholesaleSession';
import type { WholesaleSupplierProfile } from '@/lib/wholesale/wholesaleSupplierProfile';
import type { WholesalePortalView } from './WholesalePortalShell';
import styles from './WholesalePortalViews.module.css';

export function WholesaleHomeView({
  session,
  productCount,
  cartCount,
  draftActive,
  onNavigate,
  onCartOpen,
}: {
  session: WholesaleSession;
  productCount: number;
  cartCount: number;
  draftActive: boolean;
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
        <div className={styles.metric}><span>Buying location</span><strong>Primary</strong></div>
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
          <div className={styles.contextItem}><MapPin size={18} /><div><span>Buying location</span><strong>Primary location</strong></div></div>
          <div className={styles.contextItem}><UserRound size={18} /><div><span>Signed in as</span><strong>{session.name || session.email}</strong></div></div>
        </aside>
      </div>
    </div>
  );
}

export function WholesaleAccountView({ session }: { session: WholesaleSession }) {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Account</p>
        <h1 className={styles.title}>{session.company || session.name}</h1>
        <p className={styles.lede}>Your current wholesale buying identity and location.</p>
      </section>
      <div className={styles.details}>
        <div className={styles.detailRow}><span>Buyer</span><strong>{session.name || 'Wholesale buyer'}</strong></div>
        <div className={styles.detailRow}><span>Email</span><strong>{session.email}</strong></div>
        <div className={styles.detailRow}><span>Company</span><strong>{session.company || 'Not provided'}</strong></div>
        <div className={styles.detailRow}><span>Buying location</span><strong>Primary location</strong></div>
        <div className={styles.detailRow}><span>Account role</span><strong>{session.memberRole ? session.memberRole.charAt(0).toUpperCase() + session.memberRole.slice(1) : 'Buyer'}</strong></div>
      </div>
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