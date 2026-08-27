'use client';

import { Award, Check, Copy, ExternalLink, LogOut, ShoppingBag, Store } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import styles from './loyaltyPortal.module.css';

type Account = any;

export function LoyaltyPortalClient({ slug, publicProfile }: { slug: string; publicProfile: { displayName: string; logoUrl: string | null; termsUrl: string; privacyUrl: string } }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [selectedReward, setSelectedReward] = useState<any>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const load = async () => {
    const response = await fetch(`/api/loyalty/${slug}/account`, { cache: 'no-store' });
    if (response.ok) setAccount(await response.json()); else setAccount(null);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const requestCode = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError('');
    const response = await fetch(`/api/loyalty/${slug}/auth/code/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const body = await response.json(); setChallengeToken(body.challengeToken || ''); setWorking(false);
  };
  const verify = async (event: FormEvent) => {
    event.preventDefault(); setWorking(true); setError('');
    const response = await fetch(`/api/loyalty/${slug}/auth/code/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeToken, code }) });
    const body = await response.json();
    if (!response.ok) { setError(body.error || 'Sign in failed.'); setWorking(false); return; }
    await load(); setWorking(false);
  };
  const membership = async (action: 'enrol' | 'opt_out') => {
    setWorking(true); setError('');
    const response = await fetch(`/api/loyalty/${slug}/account`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, acceptedTerms, termsVersion: account.profile.termsVersion }) });
    const body = await response.json();
    if (!response.ok) setError(body.error || 'Membership could not be updated.'); else await load();
    setWorking(false);
  };
  const claim = async () => {
    if (!selectedReward) return;
    setWorking(true); setError('');
    const requestKey = crypto.randomUUID().replace(/-/g, '');
    const response = await fetch(`/api/loyalty/${slug}/rewards`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rewardId: selectedReward.id, idempotencyKey: requestKey }) });
    const body = await response.json();
    if (!response.ok) setError(body.error || 'The Shopify discount could not be created.');
    else { setSelectedReward(null); await load(); }
    setWorking(false);
  };
  const logout = async () => { await fetch(`/api/loyalty/${slug}/auth/logout`, { method: 'POST' }); setAccount(null); };

  if (loading) return <div className={styles.center}>Loading rewards...</div>;
  if (!account) return <div className={styles.authWrap}><header className={styles.brand}>{publicProfile.logoUrl ? <img src={publicProfile.logoUrl} alt="" /> : <Award />}<span>{publicProfile.displayName}</span></header><section className={styles.authPanel}><p className={styles.eyebrow}>Rewards account</p><h1>Sign in with your email</h1>{!challengeToken ? <form onSubmit={requestCode}><label>Email address<input type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label><button disabled={working}>Email sign-in code</button></form> : <form onSubmit={verify}><p>Enter the six-digit code sent to your email.</p><label>Sign-in code<input inputMode="numeric" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} /></label><button disabled={working || code.length !== 6}>Sign in</button><button type="button" className={styles.textButton} onClick={() => { setChallengeToken(''); setCode(''); }}>Use another email</button></form>}{error && <p className={styles.error}>{error}</p>}<footer><a href={publicProfile.termsUrl}>Terms</a><a href={publicProfile.privacyUrl}>Privacy</a></footer></section></div>;

  const loyalty = account.loyalty;
  return <div className={styles.portal}><header className={styles.topbar}><div className={styles.brand}>{account.profile.logoUrl ? <img src={account.profile.logoUrl} alt="" /> : <Award />}<span>{account.profile.displayName}</span></div><button className={styles.iconButton} onClick={logout} title="Sign out"><LogOut size={18} /></button></header>
    <section className={styles.hero}><div><p className={styles.eyebrow}>{loyalty.programName}</p><h1>{loyalty.member ? `${Number(loyalty.balancePoints).toLocaleString()} ${loyalty.pointsLabel}` : `Welcome, ${account.customer.name}`}</h1><p>{loyalty.member ? 'Available to use in store or convert into a Shopify discount.' : 'Join to start earning on future purchases.'}</p></div>{loyalty.member && <div className={styles.totals}><span>Lifetime earned<strong>{Number(loyalty.lifetimeEarned).toLocaleString()}</strong></span><span>Lifetime redeemed<strong>{Number(loyalty.lifetimeRedeemed).toLocaleString()}</strong></span></div>}</section>
    {error && <div className={styles.errorBanner}>{error}</div>}
    {!loyalty.member ? <section className={styles.join}><h2>Join {loyalty.programName}</h2><p>Points start on eligible purchases after you join. Previous purchases are not backdated.</p><label className={styles.consent}><input type="checkbox" checked={acceptedTerms} onChange={event => setAcceptedTerms(event.target.checked)} /><span>I agree to the <a href={account.profile.termsUrl} target="_blank">loyalty terms</a> and acknowledge the <a href={account.profile.privacyUrl} target="_blank">privacy policy</a>.</span></label><button disabled={!acceptedTerms || working} onClick={() => membership('enrol')}><Check size={17} /> Join rewards</button></section> : <>
      <section className={styles.channels}><div><Store /><h2>Use in store</h2><p>Ask staff to link your customer account at the register. Choose a reward there without creating a code.</p></div><div><ShoppingBag /><h2>Use on Shopify</h2><p>Convert points below into a customer-only Shopify discount. Conversion is final and the code expires after 90 days.</p></div></section>
      <section className={styles.section}><div className={styles.sectionHead}><p className={styles.eyebrow}>Rewards</p><h2>Choose where to use your points</h2></div><div className={styles.rewardGrid}>{loyalty.rewards.map((reward: any) => <article key={reward.id}><div><span>{Number(reward.pointsCost).toLocaleString()} {loyalty.pointsLabel}</span><h3>{reward.displayName}</h3><p>{reward.description || `$${Number(reward.valueAud).toFixed(2)} off eligible purchases`}</p></div><button disabled={working || loyalty.balancePoints < reward.pointsCost} onClick={() => setSelectedReward(reward)}>{loyalty.balancePoints < reward.pointsCost ? 'Not enough points' : 'Create Shopify discount'}</button></article>)}</div></section>
      {loyalty.redemptions.length > 0 && <section className={styles.section}><div className={styles.sectionHead}><p className={styles.eyebrow}>Shopify discounts</p><h2>Your converted rewards</h2></div><div className={styles.codes}>{loyalty.redemptions.map((item: any) => <article key={item.id}><div><span>{item.status}</span><strong>{item.display_name}</strong><small>{item.expires_at ? `Expires ${new Date(item.expires_at).toLocaleDateString('en-AU')}` : ''}</small></div>{item.voucher_code && <><code>{item.voucher_code}</code><button className={styles.iconButton} title="Copy discount code" onClick={() => navigator.clipboard.writeText(item.voucher_code)}><Copy size={17} /></button>{item.status === 'issued' && <a href={`${new URL(account.profile.shopifyReturnUrl).origin}/discount/${encodeURIComponent(item.voucher_code)}?redirect=/collections/all`}><ExternalLink size={16} /> Shop now</a>}</>}</article>)}</div></section>}
      <section className={styles.section}><div className={styles.sectionHead}><p className={styles.eyebrow}>Activity</p><h2>Points history</h2></div><div className={styles.history}>{loyalty.history.length ? loyalty.history.map((item: any, index: number) => <div key={`${item.created_at}-${index}`}><span><strong>{item.reason || item.type.replace(/_/g, ' ')}</strong><small>{new Date(item.created_at).toLocaleDateString('en-AU')}</small></span><b data-negative={Number(item.points_delta) < 0}>{Number(item.points_delta) > 0 ? '+' : ''}{item.points_delta}</b></div>) : <p>No points activity yet.</p>}</div></section>
      <footer className={styles.accountFooter}><span>Signed in as {account.customer.email}</span><button className={styles.textButton} onClick={() => membership('opt_out')}>Leave rewards program</button></footer>
    </>}
    {selectedReward && <div className={styles.backdrop} role="presentation"><div className={styles.dialog} role="dialog" aria-modal="true"><p className={styles.eyebrow}>Confirm conversion</p><h2>Create a ${Number(selectedReward.valueAud).toFixed(2)} Shopify discount?</h2><p>This immediately deducts {Number(selectedReward.pointsCost).toLocaleString()} {loyalty.pointsLabel}. The customer-only code expires after 90 days and cannot be changed back into points or used at POS.</p><div><button className={styles.secondary} onClick={() => setSelectedReward(null)}>Keep points</button><button disabled={working} onClick={claim}>Create discount</button></div></div></div>}
  </div>;
}