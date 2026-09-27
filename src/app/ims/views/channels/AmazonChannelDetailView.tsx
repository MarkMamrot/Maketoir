'use client';

import { AlertCircle, ArrowLeft, CheckCircle2, Download, ListChecks, MapPin, PauseCircle, Power, RefreshCw, RotateCcw, ShieldCheck, ShoppingBag, SlidersHorizontal, TestTube2 } from 'lucide-react';
import { useEffect, useState } from 'react';

interface ReadinessCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

interface AmazonInstance {
  displayName: string;
  externalAccountKey: string | null;
  enabled: boolean;
  readinessStatus: 'not_tested' | 'ready' | 'error';
  settings: Record<string, unknown>;
}

const buttonStyle: React.CSSProperties = {
  minHeight: 36,
  padding: '7px 11px',
  border: '1px solid var(--sv-border)',
  borderRadius: 5,
  background: '#fff',
  color: 'var(--sv-text-strong)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section style={{ padding: '18px 0', borderBottom: '1px solid var(--sv-border)' }}>
    <h2 style={{ margin: 0, color: 'var(--sv-text-strong)', fontSize: 15 }}>{title}</h2>
    <p style={{ margin: '5px 0 13px', color: 'var(--sv-text-dim)', fontSize: 12, lineHeight: 1.5 }}>{description}</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{children}</div>
  </section>;
}

export default function AmazonChannelDetailView({
  instance,
  canManage,
  readinessChecks,
  testing,
  syncingListings,
  syncingInventory,
  syncingOrders,
  syncingReturns,
  checkingReadiness,
  changingActivation,
  assignmentAutomatic,
  assignmentWorking,
  publicationEnabled,
  publicationWorking,
  onBack,
  onRename,
  onTest,
  onChangeActivation,
  onProductRules,
  onChangeAssignment,
  onChangePublication,
  onReconcileProducts,
  onSyncListings,
  onManageListings,
  onSyncInventory,
  onOrderSetup,
  onSyncOrders,
  onSyncReturns,
  onResolveRefunds,
  onCheckReadiness,
}: {
  instance: AmazonInstance;
  canManage: boolean;
  readinessChecks: ReadinessCheck[];
  testing: boolean;
  syncingListings: boolean;
  syncingInventory: boolean;
  syncingOrders: boolean;
  syncingReturns: boolean;
  checkingReadiness: boolean;
  changingActivation: boolean;
  assignmentAutomatic: boolean;
  assignmentWorking: boolean;
  publicationEnabled: boolean;
  publicationWorking: boolean;
  onBack: () => void;
  onRename: (displayName: string) => Promise<void> | void;
  onTest: () => void;
  onChangeActivation: () => void;
  onProductRules: () => void;
  onChangeAssignment: (enabled: boolean) => void;
  onChangePublication: (enabled: boolean) => void;
  onReconcileProducts: () => void;
  onSyncListings: () => void;
  onManageListings: () => void;
  onSyncInventory: () => void;
  onOrderSetup: () => void;
  onSyncOrders: () => void;
  onSyncReturns: () => void;
  onResolveRefunds: () => void;
  onCheckReadiness: () => void;
}) {
  const ambiguousRefunds = Number(instance.settings?.refundsAmbiguousCount ?? 0);
  const [displayName, setDisplayName] = useState(instance.displayName);
  const [renaming, setRenaming] = useState(false);
  const actionStyle = (busy = false): React.CSSProperties => ({ ...buttonStyle, cursor: busy ? 'wait' : 'pointer', opacity: busy ? .6 : 1 });

  useEffect(() => setDisplayName(instance.displayName), [instance.displayName]);

  const saveName = async () => {
    const nextName = displayName.trim();
    if (!nextName || nextName === instance.displayName) return;
    setRenaming(true);
    try {
      await onRename(nextName);
    } finally {
      setRenaming(false);
    }
  };

  return <div>
    <button type="button" onClick={onBack} style={{ ...buttonStyle, marginBottom: 16 }}><ArrowLeft size={15} /> Back to Sales Channels</button>
    <header style={{ paddingBottom: 18, borderBottom: '1px solid var(--sv-border)' }}>
      <div style={{ color: 'var(--sv-text-dim)', fontSize: 12, fontWeight: 700 }}>Amazon Australia</div>
      <h1 style={{ margin: '4px 0 0', color: 'var(--sv-text-strong)', fontSize: 22 }}>{instance.displayName}</h1>
      {instance.externalAccountKey && <div style={{ marginTop: 5, color: 'var(--sv-text-dim)', fontSize: 12 }}>{instance.externalAccountKey}</div>}
    </header>

    <Section title="Connection & readiness" description="Validate this seller account and control whether its configured automatic workflows can run.">
      <label style={{ width: 'min(360px, 100%)', color: 'var(--sv-text)', fontSize: 12, fontWeight: 700 }}>Channel name
        <span style={{ display: 'flex', gap: 7, marginTop: 5 }}>
          <input value={displayName} maxLength={120} disabled={!canManage || renaming} onChange={event => setDisplayName(event.target.value)} style={{ minWidth: 0, flex: 1, height: 36, padding: '0 9px', border: '1px solid var(--sv-border)', borderRadius: 5 }} />
          <button type="button" disabled={!canManage || renaming || !displayName.trim() || displayName.trim() === instance.displayName} onClick={() => void saveName()} style={actionStyle(renaming)}>{renaming ? 'Saving...' : 'Save name'}</button>
        </span>
      </label>
      <button type="button" disabled={!canManage || testing} onClick={onTest} style={actionStyle(testing)}><TestTube2 size={15} /> {testing ? 'Testing...' : 'Test connection'}</button>
      <button type="button" disabled={!canManage || checkingReadiness} onClick={onCheckReadiness} style={actionStyle(checkingReadiness)}><ShieldCheck size={15} /> {checkingReadiness ? 'Checking...' : 'Check readiness'}</button>
      {(instance.enabled || instance.readinessStatus === 'ready') && <button type="button" disabled={!canManage || changingActivation} onClick={onChangeActivation} style={{ ...actionStyle(changingActivation), color: instance.enabled ? '#991b1b' : '#166534' }}>
        {instance.enabled ? <PauseCircle size={15} /> : <Power size={15} />} {changingActivation ? 'Saving...' : instance.enabled ? 'Deactivate' : 'Activate'}
      </button>}
    </Section>

    {readinessChecks.length > 0 && <section style={{ padding: '14px', marginTop: 14, border: '1px solid var(--sv-border)', background: '#f8fafc' }}>
      <h2 style={{ margin: '0 0 9px', color: 'var(--sv-text-strong)', fontSize: 13 }}>Activation readiness</h2>
      <div style={{ display: 'grid', gap: 7 }}>{readinessChecks.map(check => <div key={check.key} style={{ display: 'flex', gap: 7, color: check.passed ? '#166534' : '#991b1b', fontSize: 12, lineHeight: 1.45 }}>
        {check.passed ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}<span><strong>{check.label}:</strong> {check.detail}</span>
      </div>)}</div>
    </section>}

    <Section title="Products" description="Control product selection and reconcile confirmed assignment differences for this seller account.">
      <button type="button" disabled={!canManage} onClick={onProductRules} style={buttonStyle}><SlidersHorizontal size={15} /> Product rules</button>
      <label style={buttonStyle}><input type="checkbox" checked={assignmentAutomatic} disabled={!canManage || assignmentWorking} onChange={event => onChangeAssignment(event.target.checked)} /> Automatic assignment</label>
      <label style={buttonStyle}><input type="checkbox" checked={publicationEnabled} disabled={!canManage || publicationWorking} onChange={event => onChangePublication(event.target.checked)} /> Automatic publication</label>
      <button type="button" disabled={!canManage || !publicationEnabled || publicationWorking || !instance.enabled || instance.readinessStatus !== 'ready'} onClick={onReconcileProducts} style={actionStyle(publicationWorking)}><RefreshCw size={15} /> {publicationWorking ? 'Working...' : 'Reconcile products'}</button>
    </Section>

    <Section title="Listings" description="Synchronize the seller catalogue and review exact IMS variant mappings.">
      <button type="button" disabled={!canManage || syncingListings} onClick={onSyncListings} style={actionStyle(syncingListings)}><Download size={15} /> {syncingListings ? 'Syncing...' : 'Sync listings'}</button>
      <button type="button" disabled={!canManage} onClick={onManageListings} style={buttonStyle}><ListChecks size={15} /> Manage listings</button>
    </Section>

    <Section title="Orders & inventory" description="Choose the dispatch location and run immediate seller-order or stock reconciliation when needed.">
      <button type="button" disabled={!canManage} onClick={onOrderSetup} style={buttonStyle}><MapPin size={15} /> Order setup</button>
      <button type="button" disabled={!canManage || syncingOrders} onClick={onSyncOrders} style={actionStyle(syncingOrders)}><ShoppingBag size={15} /> {syncingOrders ? 'Syncing...' : 'Sync orders'}</button>
      <button type="button" disabled={!canManage || syncingInventory} onClick={onSyncInventory} style={actionStyle(syncingInventory)}><RefreshCw size={15} /> {syncingInventory ? 'Syncing...' : 'Sync inventory'}</button>
    </Section>

    <Section title="Returns" description="Read Amazon return and refund evidence and resolve any ambiguous matches before activation.">
      <button type="button" disabled={!canManage || syncingReturns} onClick={onSyncReturns} style={actionStyle(syncingReturns)}><RotateCcw size={15} /> {syncingReturns ? 'Syncing...' : 'Sync returns'}</button>
      {ambiguousRefunds > 0 && <button type="button" disabled={!canManage} onClick={onResolveRefunds} style={{ ...buttonStyle, color: '#991b1b' }}><AlertCircle size={15} /> Resolve refunds ({ambiguousRefunds})</button>}
    </Section>
  </div>;
}