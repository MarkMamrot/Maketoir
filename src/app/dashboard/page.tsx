"use client";

import React, { useState, useEffect, useRef, Fragment, forwardRef, useImperativeHandle } from 'react';
import Link from 'next/link';
import { SpaceAnalysisView } from './SpaceAnalysisView';
import { StockTurnoverView } from './StockTurnoverView';
import { CustomerServiceView } from './CustomerServiceView';
import { AppearanceTab, BusinessInfoTab, BrandProfileTab, ConnectionsTab, DataSourceTab } from '../setup/page';
import { AI_DATA_SOURCES } from '@/lib/aiDataSources';

// ── Nav structure ────────────────────────────────────────────────────────────
type NavChild = { id: string; label: string };
type NavItem  = { id: string; label: string; icon: string; children: NavChild[] };

// Monotone SVG icons (24×24, stroke-based, currentColor)
const NAV_ICONS: Record<string, string> = {
  home: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7m-14 0v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9m-14 0h14"/></svg>`,
  'ai-helper': `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 3.75a6.75 6.75 0 110 13.5 6.75 6.75 0 010-13.5zm6.75 9l3.75 3.75M12 9v3m0 0v3m0-3h3m-3 0H9"/></svg>`,
  inventory: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7H4a1 1 0 00-1 1v10a1 1 0 001 1h16a1 1 0 001-1V8a1 1 0 00-1-1zM16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>`,
  marketing: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M3 17l4-8 4 4 4-6 4 10M3 21h18"/></svg>`,
  website: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" stroke-linejoin="round" d="M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/></svg>`,
  'customer-service': `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>`,
  settings: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>`,
  ims: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>`,
  'brand-assets': `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75"><rect x="3" y="3" width="18" height="18" rx="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8.5" cy="8.5" r="1.5"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 15l-5-5L5 21"/></svg>`,
};

const NAV: NavItem[] = [
  { id: 'home',      label: 'Dashboard',            icon: 'home', children: [] },
  { id: 'ai-helper', label: 'AI Helper',             icon: 'ai-helper', children: [] },
  {
    id: 'business-intelligence', label: 'Business Intelligence', icon: 'ai-helper',
    children: [
      { id: 'business-info', label: 'Business/Brand Key Information' },
      { id: 'brand-profile', label: 'Brand Profile' },
      { id: 'sync-data', label: 'Sync Data' },
      { id: 'calculated-data', label: 'Reports' },
    ],
  },
  {
    id: 'inventory', label: 'Inventory', icon: 'inventory',
    children: [
      { id: 'inactive-candidates',   label: 'Inactive Candidates' },
      { id: 'lost-candidates',       label: 'Possible Losses'     },
      { id: 'space-analysis',        label: 'Space Efficiency'    },
      { id: 'stock-turnover',         label: 'Stock Turnover'      },
    ],
  },
  {
    id: 'marketing', label: 'Marketing Activities', icon: 'marketing',
    children: [
      { id: 'marketing-assistant', label: 'Marketing Assistant' },
      { id: 'campaign-audit',      label: 'Campaign Audit'      },
    ],
  },
  {
    id: 'brand-assets', label: 'Brand Assets', icon: 'brand-assets',
    children: [
      { id: 'brand-assets-models',    label: 'Models'    },
      { id: 'brand-assets-backdrops', label: 'Backdrops' },
      { id: 'brand-assets-templates', label: 'Templates' },
    ],
  },
  {
    id: 'website', label: 'Website', icon: 'website',
    children: [
      { id: 'pending-online',               label: 'Load Products To Website' },
      { id: 'product-description-template', label: 'Web Field Templates'      },
      { id: 'bulk-edit-listings',           label: 'Bulk Edit Listings'       },
    ],
  },
  {
    id: 'customer-service', label: 'Customer Service', icon: 'customer-service',
    children: [
      { id: 'cs-inbox',      label: 'Inbox'            },
      { id: 'cs-compose',    label: 'Compose Email'    },
      { id: 'cs-templates',  label: 'Email Templates'  },
    ],
  },
];

const SETTINGS_NAV: NavItem = {
  id: 'settings', label: 'Settings', icon: 'settings',
  children: [
    { id: 'appearance',         label: 'Appearance' },
    { id: 'connections',        label: 'Connections' },
    { id: 'marketing-settings', label: 'Marketing Settings' },
    { id: 'data-source',        label: 'Data Source' },
  ],
};

// ── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    inventory: false, marketing: false, website: false, 'ai-helper': false, 'business-intelligence': false, 'brand-assets': false, settings: false,
  });
  const [collapsed, setCollapsed] = useState(false);

  const toggle = (id: string) => setExpanded(p => {
    const isOpening = !p[id];
    if (isOpening) {
      // Collapse all other top-level items when opening one
      const next: Record<string, boolean> = {};
      for (const key of Object.keys(p)) next[key] = false;
      next[id] = true;
      return next;
    }
    return { ...p, [id]: false };
  });

  const renderItem = (item: NavItem) => (
    <div key={item.id}>
      <button
        onClick={() => {
          if (item.children.length > 0 && !collapsed) toggle(item.id);
          else onSelect(item.id);
        }}
        title={collapsed ? item.label : undefined}
        className={`solv-nav-item w-full flex items-center ${collapsed ? 'justify-center' : 'justify-between'} gap-2 ${collapsed ? 'px-0' : 'px-3'} py-2 rounded-lg text-sm transition-colors
          ${active === item.id && item.children.length === 0
            ? 'bg-blue-50 text-blue-700 font-semibold'
            : 'text-gray-700 hover:bg-gray-100 font-semibold'}`}
        style={collapsed ? { height: 36, marginBottom: 4 } : {}}
      >
        <span className="flex items-center gap-2">
          <span className={`shrink-0 opacity-60 flex items-center justify-center ${collapsed ? 'text-gray-500' : ''}`} dangerouslySetInnerHTML={{ __html: NAV_ICONS[item.icon] ?? '' }} />
          {!collapsed && <span>{item.label}</span>}
        </span>
        {!collapsed && item.children.length > 0 && (
          <span className="text-xs text-gray-400">{expanded[item.id] ? '▾' : '▸'}</span>
        )}
      </button>

      {!collapsed && item.children.length > 0 && expanded[item.id] && (
        <div className="mt-0.5 ml-4 pl-2 border-l-2 border-gray-200 space-y-0.5">
          {item.children.map(child =>
            <button
              key={child.id}
              onClick={() => onSelect(child.id)}
              className={`solv-nav-child w-full text-left px-3 py-1.5 rounded-lg text-sm font-light transition-colors
                ${active === child.id
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {child.label}
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <aside style={{ width: collapsed ? 52 : 224, flexShrink: 0, transition: 'width .2s ease' }} className="flex flex-col solvantis-sidebar overflow-hidden border-r border-gray-200 bg-white">
      {/* Header row: Foresight label + collapse toggle */}
      <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} border-b border-gray-200 mb-2 py-4 px-2`}>
        {!collapsed && <div className="text-xs font-bold tracking-widest text-gray-400 uppercase whitespace-nowrap ml-2">Foresight</div>}
        <button
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="bg-transparent border-none cursor-pointer text-gray-400 p-1 rounded hover:bg-gray-100 hover:text-gray-600 flex items-center justify-center shrink-0"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d={collapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'} />
          </svg>
        </button>
      </div>

      <nav className="solv-nav flex-1 space-y-0.5 px-2 font-nav overflow-y-auto overflow-x-hidden">
        {NAV.map(item => renderItem(item))}
      </nav>
    </aside>
  );
}

// ── Inventory Sync Tile ──────────────────────────────────────────────────────
// ORDER MATTERS: Sales must run before Products because the Products sync
// reads branch revenue directly from the Sales sheet.
const SYNC_OPTIONS = [
  { id: 'branches',        label: 'Branch List',      icon: '🏬', description: 'Cin7 branch records'                 },
  { id: 'suppliers',       label: 'Suppliers List',   icon: '🏭', description: 'Supplier contact records'           },
  { id: 'sales',           label: 'Sales',            icon: '💰', description: 'Sales invoices & line items'        },
  { id: 'products',        label: 'Product Data',     icon: '🛍️', description: 'Products, variants & stock levels'  },
  { id: 'sales-by-branch', label: 'Sales by Branch',  icon: '📊', description: 'Sales & stock aggregated per branch — also writes Online Sales sheet' },
];

// Maps sync option id → route handler.
interface SyncFilterOptions { activeProductsOnly: boolean; activeBranchesOnly: boolean; fullSync?: boolean; }

async function callSyncRoute(
  id: string,
  databaseId: string,
  filters: SyncFilterOptions,
  signal?: AbortSignal,
): Promise<{ success: boolean; message?: string; error?: string }> {
  const routes: Record<string, string> = {
    'products':        '/api/sync/products',
    'branches':        '/api/sync/branches',
    'suppliers':       '/api/sync/suppliers',
    'sales':           '/api/sync/sales',
    'sales-by-branch': '/api/sync/sales-by-branch',
  };
  const route = routes[id];
  if (!route) return { success: false, error: `No route for "${id}"` };
  const body: Record<string, unknown> = { databaseId, ...filters };
  if (id === 'sales') body.fullSync = filters.fullSync ?? false;
  const res = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return res.json();
}

type SyncLogEntry = { text: string; type: 'info' | 'ok' | 'error' };

function InventorySyncTile({ databaseId }: { databaseId: string }): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(['products', 'branches', 'suppliers', 'sales', 'sales-by-branch'])
  );
  const [activeProductsOnly, setActiveProductsOnly] = useState(true);
  const [activeBranchesOnly, setActiveBranchesOnly] = useState(true);
  const [fullSyncSales, setFullSyncSales] = useState(false);
  const [lastSync, setLastSync] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<SyncLogEntry[]>([]);
  const [inventorySource, setInventorySource] = useState<string>('cin7');
  const abortControllerRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    if (!databaseId) return;
    fetch('/api/settings/inventory-source')
      .then(r => r.json())
      .then(d => { if (d.success) setInventorySource(d.source); })
      .catch(() => {});
  }, [databaseId]);

  // Load last-sync dates — localStorage first (fast), then hydrate sales
  // timestamp from the server (source of truth: Config tab in Google Sheets).
  useEffect(() => {
    const stored = localStorage.getItem('marketoir_last_sync');
    if (stored) {
      try { setLastSync(JSON.parse(stored)); } catch {}
    }
  }, []);

  useEffect(() => {
    if (!databaseId) return;
    fetch(`/api/sync/sales?databaseId=${encodeURIComponent(databaseId)}`)
      .then(r => r.json())
      .then(d => {
        if (d.lastSalesSync) {
          const formatted = new Date(d.lastSalesSync).toLocaleString();
          setLastSync(prev => {
            const next = { ...prev, sales: formatted };
            localStorage.setItem('marketoir_last_sync', JSON.stringify(next));
            return next;
          });
        }
      })
      .catch(() => { /* non-fatal — localStorage value remains */ });
  }, [databaseId]);

  const toggleOption = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleStop = () => {
    stopRequestedRef.current = true;
    abortControllerRef.current?.abort();
  };

  const handleRunSync = async () => {
    if (!databaseId) { setLog([{ text: '❌ No business selected.', type: 'error' }]); return; }
    if (selected.size === 0) { setLog([{ text: '❌ Select at least one data source to sync.', type: 'error' }]); return; }

    stopRequestedRef.current = false;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setRunning(true);
    setLog([{ text: `Starting sync of ${selected.size} data source${selected.size !== 1 ? 's' : ''}…`, type: 'info' }]);

    const toRun = SYNC_OPTIONS.filter(o => selected.has(o.id));
    const updatedDates = { ...lastSync };

    try { for (const option of toRun) {
      if (stopRequestedRef.current) {
        setLog(p => [...p, { text: '⏹ Sync stopped by user.', type: 'info' }]);
        break;
      }
      setLog(p => [...p, { text: `⏳ Syncing ${option.label}…`, type: 'info' }]);
      try {
        const result = await callSyncRoute(option.id, databaseId, { activeProductsOnly, activeBranchesOnly, fullSync: fullSyncSales }, controller.signal);
        const now = new Date().toLocaleString();
        if (result.success) {
          updatedDates[option.id] = now;
          setLastSync({ ...updatedDates });
          localStorage.setItem('marketoir_last_sync', JSON.stringify(updatedDates));
          setLog(p => [...p, { text: `✅ ${option.label}: ${result.message ?? 'Done'}`, type: 'ok' }]);
          // Automatically run sales-by-branch right after products sync completes
          // (products writes the Stock sheet first, which sales-by-branch depends on)
          // Skip if sales-by-branch is already queued as an explicit sync option.
          if (option.id === 'products' && !selected.has('sales-by-branch')) {
            setLog(p => [...p, { text: `⏳ Syncing Sales by Branch…`, type: 'info' }]);
            try {
              const sbbResult = await callSyncRoute('sales-by-branch', databaseId, { activeProductsOnly, activeBranchesOnly }, controller.signal);
              if (sbbResult.success) {
                setLog(p => [...p, { text: `✅ Sales by Branch: ${sbbResult.message ?? 'Done'}`, type: 'ok' }]);
              } else {
                setLog(p => [...p, { text: `❌ Sales by Branch: ${sbbResult.error || 'Failed'}`, type: 'error' }]);
              }
            } catch (e) {
              if ((e as any)?.name === 'AbortError') throw e;
              setLog(p => [...p, { text: `❌ Sales by Branch crashed`, type: 'error' }]);
            }
          }
        } else {
          setLog(p => [...p, { text: `❌ ${option.label}: ${result.error ?? 'Failed'}`, type: 'error' }]);
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          setLog(p => [...p, { text: '⏹ Sync stopped by user.', type: 'info' }]);
          break;
        }
        setLog(p => [...p, { text: `❌ ${option.label}: ${e.message}`, type: 'error' }]);
      }
    } } finally {
      if (!stopRequestedRef.current) {
        setLog(p => [...p, { text: 'Sync complete.', type: 'info' }]);
      }
      abortControllerRef.current = null;
      setRunning(false);
    }
  };

  if (inventorySource === 'solvantis') {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-xl">🏭</div>
          <div>
            <h2 className="font-bold text-gray-800 text-lg leading-tight">Solvantis IMS</h2>
            <p className="text-xs text-gray-500">Inventory source: Solvantis IMS</p>
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Inventory data is sourced from Solvantis IMS — Cin7 sync is not applicable.
          Use the Refresh Cache button to keep sales aggregates up to date.
        </p>
        <a href="/setup?tab=data-source" className="text-sm text-blue-600 hover:underline">
          Manage data source →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header + controls */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-xl">📦</div>
          <div>
            <h2 className="font-bold text-gray-800 text-lg leading-tight">Sync Inventory</h2>
            <p className="text-xs text-gray-500">Choose data sources then run sync</p>
          </div>
        </div>

        {/* Toggle chips */}
        <p className="text-sm font-semibold text-gray-700 mb-2">Data sources to sync</p>
        <div className="flex flex-wrap gap-2 mb-5">
          {SYNC_OPTIONS.map(opt => (
            <ToggleChip
              key={opt.id}
              label={opt.label}
              icon={opt.icon}
              active={selected.has(opt.id)}
              disabled={running}
              onClick={() => toggleOption(opt.id)}
            />
          ))}
        </div>

        {/* Filter options */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 mb-5">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={activeProductsOnly}
              onChange={e => setActiveProductsOnly(e.target.checked)}
              disabled={running}
              className="w-4 h-4 accent-blue-600"
            />
            <span className="text-sm text-gray-700">Sync only Active Products</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={activeBranchesOnly}
              onChange={e => setActiveBranchesOnly(e.target.checked)}
              disabled={running}
              className="w-4 h-4 accent-blue-600"
            />
            <span className="text-sm text-gray-700">Sync only Active Branches</span>
          </label>
          {selected.has('sales') && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={fullSyncSales}
                onChange={e => setFullSyncSales(e.target.checked)}
                disabled={running}
                className="w-4 h-4 accent-orange-500"
              />
              <span className="text-sm text-gray-700">
                Full Sales Sync <span className="text-orange-600 font-medium">(rewrites entire Sales sheet)</span>
              </span>
            </label>
          )}
        </div>

        {/* Last sync dates */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-5">
          {SYNC_OPTIONS.map(opt => (
            <div key={opt.id} className="flex items-center gap-1.5">
              <span className="text-sm">{opt.icon}</span>
              <span className="text-xs text-gray-500">
                <span className="font-medium text-gray-600">{opt.label}:</span>{' '}
                {lastSync[opt.id] ?? 'Never synced'}
              </span>
            </div>
          ))}
        </div>

        {/* Run / Stop buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleRunSync}
            disabled={running || selected.size === 0}
            className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {running ? 'Syncing…' : `Sync Selected (${selected.size})`}
          </button>
          {running && (
            <button
              onClick={handleStop}
              className="px-5 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-colors"
            >
              Stop Sync
            </button>
          )}
        </div>

        {/* Info panel */}
        <div className="border-t border-gray-100 pt-5 mt-5">
          <div className="grid md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">What gets synced?</p>
              <p className="text-sm text-gray-700">Data is pulled from Cin7 and written into your connected Google Sheet. Each sync overwrites the relevant sheet tab with the latest data.</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">How often should I sync?</p>
              <p className="text-sm text-gray-700">Run a full sync whenever you need up-to-date data for analysis. For daily use, syncing Products and Sales is usually enough.</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">After syncing</p>
              <p className="text-sm text-gray-700">Use the <strong>Order Planner</strong>, <strong>Inactive Candidates</strong>, and <strong>Space Efficiency</strong> tools — they all read from the synced data.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Progress log */}
      {log.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Sync Log</p>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {log.map((entry, i) => (
              <p key={i} className={`text-xs font-mono ${
                entry.type === 'ok'    ? 'text-green-700' :
                entry.type === 'error' ? 'text-red-600'   : 'text-gray-500'
              }`}>{entry.text}</p>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

type SyncDataSection = 'inventory' | 'website' | 'ads';
type WebsiteSyncSection = 'products' | 'collections' | 'orders';

interface WebsiteSyncResult {
  success: boolean;
  error?: string;
  lastSync?: string | null;
  spreadsheetUrl?: string | null;
  count?: number;
  totalFetched?: number | null;
}

interface WebsiteSyncSummary {
  success: boolean;
  hasData?: boolean;
  error?: string;
  lastSync?: string | null;
  spreadsheetUrl?: string | null;
  count?: number;
}

interface WebsiteSyncHandle {
  sync: () => Promise<WebsiteSyncResult>;
}

function SyncWebsiteDataView({ databaseId, initialSection = 'products' }: { databaseId: string; initialSection?: WebsiteSyncSection }) {
  const [selectedSources, setSelectedSources] = useState<Set<WebsiteSyncSection>>(
    () => new Set<WebsiteSyncSection>(['products', 'collections', 'orders'])
  );
  const [inStockOnly, setInStockOnly] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [productLastSync, setProductLastSync] = useState<string | null>(null);
  const [productCount, setProductCount] = useState<number | null>(null);
  const [productTotalFetched, setProductTotalFetched] = useState<number | null>(null);
  const [productSpreadsheetUrl, setProductSpreadsheetUrl] = useState<string | null>(null);
  const [collectionsLastSync, setCollectionsLastSync] = useState<string | null>(null);
  const [collectionsCount, setCollectionsCount] = useState<number | null>(null);
  const [collectionsSpreadsheetUrl, setCollectionsSpreadsheetUrl] = useState<string | null>(null);
  const [ordersLastSync, setOrdersLastSync] = useState<string | null>(null);
  const [ordersCount, setOrdersCount] = useState<number | null>(null);
  const [ordersSpreadsheetUrl, setOrdersSpreadsheetUrl] = useState<string | null>(null);
  const productsRef = useRef<WebsiteSyncHandle>(null);
  const collectionsRef = useRef<WebsiteSyncHandle>(null);
  const ordersRef = useRef<WebsiteSyncHandle>(null);

  useEffect(() => {
    let ignore = false;

    const loadSummary = async () => {
      if (!databaseId) return;

      try {
        const [productsRes, collectionsRes, ordersRes] = await Promise.all([
          fetch(`/api/sync/shopify?databaseId=${encodeURIComponent(databaseId)}`),
          fetch(`/api/sync/shopify/collections?databaseId=${encodeURIComponent(databaseId)}`),
          fetch(`/api/sync/shopify/orders?databaseId=${encodeURIComponent(databaseId)}`),
        ]);

        const [productsData, collectionsData, ordersData] = await Promise.all([
          productsRes.json() as Promise<WebsiteSyncSummary>,
          collectionsRes.json() as Promise<WebsiteSyncSummary>,
          ordersRes.json() as Promise<WebsiteSyncSummary>,
        ]);

        if (ignore) return;

        if (productsData.success) {
          setProductCount(typeof productsData.count === 'number' ? productsData.count : null);
          setProductSpreadsheetUrl(productsData.spreadsheetUrl ?? null);
          setProductLastSync(productsData.lastSync ?? (productsData.hasData ? 'Synced' : null));
        }

        if (collectionsData.success) {
          setCollectionsCount(typeof collectionsData.count === 'number' ? collectionsData.count : null);
          setCollectionsSpreadsheetUrl(collectionsData.spreadsheetUrl ?? null);
          setCollectionsLastSync(collectionsData.lastSync ?? (collectionsData.hasData ? 'Synced' : null));
        }

        if (ordersData.success) {
          setOrdersCount(typeof ordersData.count === 'number' ? ordersData.count : null);
          setOrdersSpreadsheetUrl(ordersData.spreadsheetUrl ?? null);
          setOrdersLastSync(ordersData.lastSync ?? (ordersData.hasData ? 'Synced' : null));
        }
      } catch {
        const productsSync = localStorage.getItem('marketoir_last_sync_shopify');
        const collectionsSync = localStorage.getItem('marketoir_last_sync_shopify_collections');
        const ordersSync = localStorage.getItem('marketoir_last_sync_shopify_orders');
        if (!ignore) {
          if (productsSync) setProductLastSync(productsSync);
          if (collectionsSync) setCollectionsLastSync(collectionsSync);
          if (ordersSync) setOrdersLastSync(ordersSync);
        }
      }
    };

    loadSummary();

    return () => {
      ignore = true;
    };
  }, [databaseId]);

  const toggleSource = (source: WebsiteSyncSection) => {
    setSelectedSources(prev => {
      if (prev.has(source) && prev.size === 1) return prev;
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  const handleSync = async () => {
    if (!databaseId) {
      setError('No business selected.');
      return;
    }

    if (selectedSources.size === 0) {
      setError('Select at least one website data source.');
      return;
    }

    setSyncing(true);
    setError('');
    const errors: string[] = [];

    if (selectedSources.has('products')) {
      const result = await productsRef.current?.sync();
      if (result) {
        setProductLastSync(result.lastSync ?? null);
        setProductCount(typeof result.count === 'number' ? result.count : null);
        setProductTotalFetched(result.totalFetched ?? null);
        setProductSpreadsheetUrl(result.spreadsheetUrl ?? null);
        if (!result.success && result.error) errors.push(result.error);
      }
    }

    if (selectedSources.has('collections')) {
      const result = await collectionsRef.current?.sync();
      if (result) {
        setCollectionsLastSync(result.lastSync ?? null);
        setCollectionsCount(typeof result.count === 'number' ? result.count : null);
        setCollectionsSpreadsheetUrl(result.spreadsheetUrl ?? null);
        if (!result.success && result.error) errors.push(result.error);
      }
    }

    if (selectedSources.has('orders')) {
      const result = await ordersRef.current?.sync();
      if (result) {
        setOrdersLastSync(result.lastSync ?? null);
        setOrdersCount(typeof result.count === 'number' ? result.count : null);
        setOrdersSpreadsheetUrl(result.spreadsheetUrl ?? null);
        if (!result.success && result.error) errors.push(result.error);
      }
    }

    if (errors.length) {
      setError(errors.join(' '));
    }

    setSyncing(false);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-xl">🛒</div>
          <div>
            <h2 className="font-bold text-gray-800 text-lg leading-tight">Sync Website Data</h2>
            <p className="text-xs text-gray-500">Choose one or both website data sources, then sync them in one run.</p>
          </div>
        </div>

        <p className="text-sm font-semibold text-gray-700 mb-2">Data sources to sync</p>
        <div className="flex flex-wrap gap-2 mb-5">
          <ToggleChip
            label="Product Listings"
            icon="🛒"
            active={selectedSources.has('products')}
            disabled={syncing}
            onClick={() => toggleSource('products')}
          />
          <ToggleChip
            label="Website Collections"
            icon="📂"
            active={selectedSources.has('collections')}
            disabled={syncing}
            onClick={() => toggleSource('collections')}
          />
          <ToggleChip
            label="Sales Orders (24 months)"
            icon="🧾"
            active={selectedSources.has('orders')}
            disabled={syncing}
            onClick={() => toggleSource('orders')}
          />
        </div>

        {selectedSources.has('products') && (
          <div className="flex flex-wrap gap-x-6 gap-y-2 mb-5">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={e => setInStockOnly(e.target.checked)}
                disabled={syncing}
                className="w-4 h-4 accent-blue-600"
              />
              <span className="text-sm text-gray-700">Sync only In-Stock Products</span>
            </label>
          </div>
        )}

        <div className="grid grid-cols-1 gap-x-6 gap-y-1 mb-5">
          {selectedSources.has('products') && (
            <div className="flex items-center gap-1.5">
              <span className="text-sm">🛒</span>
              <span className="text-xs text-gray-500">
                <span className="font-medium text-gray-600">Product Listings:</span>{' '}
                {productLastSync ?? 'Never synced'}
                {productCount !== null && (
                  <span>
                    {' — '}
                    <strong>{productCount}</strong> synced
                    {productTotalFetched !== null && productTotalFetched !== productCount && <span className="text-gray-400"> (of {productTotalFetched} total)</span>}
                  </span>
                )}
                {productSpreadsheetUrl && (
                  <a href={productSpreadsheetUrl} target="_blank" rel="noopener noreferrer" className="ml-2 font-semibold text-blue-600 hover:text-blue-700 underline">
                    📄 Open Product Spreadsheet
                  </a>
                )}
              </span>
            </div>
          )}
          {selectedSources.has('collections') && (
            <div className="flex items-center gap-1.5">
              <span className="text-sm">📂</span>
              <span className="text-xs text-gray-500">
                <span className="font-medium text-gray-600">Website Collections:</span>{' '}
                {collectionsLastSync ?? 'Never synced'}
                {collectionsCount !== null && <span>{' — '}<strong>{collectionsCount}</strong> synced</span>}
                {collectionsSpreadsheetUrl && (
                  <a href={collectionsSpreadsheetUrl} target="_blank" rel="noopener noreferrer" className="ml-2 font-semibold text-blue-600 hover:text-blue-700 underline">
                    📄 Open Collections Spreadsheet
                  </a>
                )}
              </span>
            </div>
          )}
          {selectedSources.has('orders') && (
            <div className="flex items-center gap-1.5">
              <span className="text-sm">🧾</span>
              <span className="text-xs text-gray-500">
                <span className="font-medium text-gray-600">Sales Orders:</span>{' '}
                {ordersLastSync ?? 'Never synced'}
                {ordersCount !== null && <span>{' — '}<strong>{ordersCount.toLocaleString()}</strong> orders synced</span>}
                {ordersSpreadsheetUrl && (
                  <a href={ordersSpreadsheetUrl} target="_blank" rel="noopener noreferrer" className="ml-2 font-semibold text-blue-600 hover:text-blue-700 underline">
                    📄 Open Orders Spreadsheet
                  </a>
                )}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleSync}
            disabled={syncing || selectedSources.size === 0}
            className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>

        {error && <p className="text-sm text-red-600 mt-4">❌ {error}</p>}
      </div>

      {selectedSources.has('products') && (
        <ShopifyProductsView ref={productsRef} databaseId={databaseId} inStockOnly={inStockOnly} />
      )}
      {selectedSources.has('collections') && (
        <ShopifyCollectionsSync ref={collectionsRef} databaseId={databaseId} />
      )}
      {selectedSources.has('orders') && (
        <ShopifyOrdersSync ref={ordersRef} databaseId={databaseId} />
      )}
    </div>
  );
}

function SyncDataView({ databaseId, initialSection = 'inventory' }: { databaseId: string; initialSection?: SyncDataSection }) {
  const [section, setSection] = useState<SyncDataSection>(initialSection);

  const sections: { key: SyncDataSection; label: string; description: string }[] = [
    { key: 'inventory', label: 'Sync Inventory Data', description: 'Cin7 products, branches, suppliers, sales, and purchase orders.' },
    { key: 'website', label: 'Sync Website Data', description: 'Shopify products and collections for website operations.' },
    { key: 'ads', label: 'Sync Ads Data', description: 'Google Ads, Meta Ads, and GA4 performance data.' },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-800">Sync Data</p>
            <p className="text-sm text-gray-500">Choose which synced data surface you want to manage.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {sections.map(item => (
              <button
                key={item.key}
                onClick={() => setSection(item.key)}
                className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  section === item.key
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-3">{sections.find(item => item.key === section)?.description}</p>
      </div>

      {section === 'inventory' && <InventorySyncTile databaseId={databaseId} />}
      {section === 'ads' && <SyncAdsView databaseId={databaseId} />}
      {section === 'website' && <SyncWebsiteDataView databaseId={databaseId} />}
    </div>
  );
}

// ── Inactive Candidates View ────────────────────────────────────────────────
interface InactiveCandidate {
  id: string; styleCode: string; name: string; brand: string; category: string;
  optionId: string; code: string; cost: string; retailPrice: string;
  createdDate: string; totalSOH: number; total12mQty: number;
}

function InactiveCandidatesView({ databaseId }: { databaseId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState<InactiveCandidate[] | null>(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Bulk inactivate state
  const [inactivating, setInactivating] = useState(false);
  const [inactivateResult, setInactivateResult] = useState<{
    inactivated: string[]; skipped: string[]; errors: string[];
  } | null>(null);

  // Live progress dialog
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressIndex, setProgressIndex] = useState(0);
  const [progressCurrent, setProgressCurrent] = useState('');
  const [progressDone, setProgressDone] = useState(false);
  const [progressLog, setProgressLog] = useState<{ icon: string; text: string; cls: string }[]>([]);
  const [progressStopped, setProgressStopped] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Manual inactivate from a previous analysis sheet
  const [manualSheetInput, setManualSheetInput] = useState('');
  const [manualInactivating, setManualInactivating] = useState(false);
  const [manualError, setManualError] = useState('');

  const extractSheetId = (val: string): string => {
    const m = val.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : val.trim();
  };

  /** Shared SSE runner — opens the dialog and streams progress from the API.
   *  Accepts either a productIds array (preferred) or a legacy spreadsheetId string. */
  const runInactivateStream = async (
    source: string[] | string,
    onStart?: () => void,
  ) => {
    if (!databaseId) {
      setError('No business database loaded yet — please wait a moment and try again.');
      return;
    }
    // Reset + open dialog
    setProgressLog([]);
    setProgressTotal(0);
    setProgressIndex(0);
    setProgressCurrent('');
    setProgressDone(false);
    setProgressStopped(false);
    setProgressOpen(true);
    setInactivateResult(null);
    onStart?.();

    const abort = new AbortController();
    abortRef.current = abort;

    const body = Array.isArray(source)
      ? { databaseId, productIds: source }
      : { databaseId, spreadsheetId: source };

    let res: Response;
    try {
      res = await fetch('/api/inventory/bulk-inactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setProgressLog(l => [...l, { icon: '🛑', text: 'Stopped by user.', cls: 'text-orange-600 font-semibold' }]);
      } else {
        setProgressLog(l => [...l, { icon: '❌', text: `Request failed: ${e.message}`, cls: 'text-red-600' }]);
      }
      setProgressDone(true);
      setInactivating(false);
      setManualInactivating(false);
      return;
    }

    if (!res.body) {
      setProgressLog([{ icon: '❌', text: 'No response from server.', cls: 'text-red-600' }]);
      setProgressDone(true);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const inactivated: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    while (!abort.signal.aborted) {
      let done: boolean, value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (e: any) {
        if (e?.name === 'AbortError') break; // Stop button cancels the stream
        throw e;
      }
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.type === 'start') {
            setProgressTotal(evt.total);
            setProgressLog(l => [...l, { icon: '🚀', text: `Starting — ${evt.total} products to process`, cls: 'text-gray-500' }]);
          } else if (evt.type === 'processing') {
            setProgressIndex(evt.index);
            setProgressCurrent(evt.label);
            setProgressLog(l => [...l, { icon: '⏳', text: `[${evt.index}/${evt.total}] ${evt.label}`, cls: 'text-blue-600' }]);
          } else if (evt.type === 'inactivated') {
            inactivated.push(evt.label);
            setProgressLog(l => [...l, { icon: '✅', text: `Inactivated: ${evt.label}`, cls: 'text-green-700' }]);
          } else if (evt.type === 'skipped') {
            skipped.push(`${evt.label}: ${evt.reason}`);
            setProgressLog(l => [...l, { icon: '⏭', text: `Skipped: ${evt.label} — ${evt.reason}`, cls: 'text-gray-500' }]);
          } else if (evt.type === 'retrying') {
            setProgressLog(l => [...l, { icon: '⏱', text: `Rate limited — waiting ${evt.seconds}s before retry ${evt.attempt} | ${evt.detail}`, cls: 'text-orange-500' }]);
          } else if (evt.type === 'batchError') {
            (evt.labels as string[]).forEach((label: string) => errors.push(`${label}: ${evt.message}`));
            setProgressLog(l => [...l, { icon: '❌', text: `Batch error: ${evt.message}`, cls: 'text-red-600' }]);
          } else if (evt.type === 'error') {
            errors.push(`${evt.label}: ${evt.message}`);
            setProgressLog(l => [...l, { icon: '❌', text: `Error: ${evt.label} — ${evt.message}`, cls: 'text-red-600' }]);
          } else if (evt.type === 'done') {
            setProgressDone(true);
            setProgressCurrent('');
            setProgressLog(l => [...l, {
              icon: '🏁',
              text: `Done — ${inactivated.length} inactivated, ${skipped.length} skipped, ${errors.length} errors`,
              cls: 'font-semibold text-gray-800',
            }]);
            setInactivateResult({ inactivated, skipped, errors });
          } else if (evt.type === 'fatal') {
            setProgressLog(l => [...l, { icon: '❌', text: `Fatal: ${evt.error}`, cls: 'text-red-600 font-semibold' }]);
            setProgressDone(true);
            reader.cancel();
          }
        } catch { /* malformed line, ignore */ }
      }
    }
    if (abort.signal.aborted) {
      setProgressStopped(true);
      setProgressLog(l => [...l, { icon: '🛑', text: 'Stopped by user.', cls: 'text-orange-600 font-semibold' }]);
    }
    setProgressDone(true);
    setInactivating(false);
    setManualInactivating(false);
  };

  const runManualInactivate = async () => {
    const sheetId = extractSheetId(manualSheetInput);
    if (!sheetId) { setManualError('Please enter a spreadsheet ID or URL.'); return; }
    if (!databaseId) { setManualError('No business database loaded — please wait a moment and try again.'); return; }
    if (!confirm('This will inactivate every product remaining in that spreadsheet. Are you sure?')) return;
    setManualError('');
    setManualInactivating(true);
    await runInactivateStream(sheetId);
    setManualInactivating(false);
  };

  const runAnalysis = async () => {
    if (!databaseId) { setError('No business selected.'); return; }
    setLoading(true);
    setError('');
    setCandidates(null);
    setSelected(new Set());
    setInactivateResult(null);
    try {
      const res = await fetch('/api/inventory/inactive-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'Unknown error');
      setCandidates(data.candidates);
      // Select all by default
      setSelected(new Set((data.candidates as InactiveCandidate[]).map(c => c.id)));
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  const filtered = candidates?.filter(c => {
    const q = filter.toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) ||
      c.brand.toLowerCase().includes(q) || c.category.toLowerCase().includes(q);
  }) ?? [];

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center text-xl">🗂️</div>
          <div>
            <h2 className="font-bold text-gray-800 text-lg leading-tight">Inactive Candidates</h2>
            <p className="text-xs text-gray-500">Products with zero stock, no sales in 12 months, and created over 2 years ago</p>
          </div>
        </div>
        <button
          onClick={runAnalysis}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shrink-0"
        >
          {loading ? 'Analysing…' : 'Run Analysis'}
        </button>
      </div>

      <p className="text-sm font-semibold text-gray-700 mb-2">Data sources to sync</p>

      {error && <p className="text-sm text-red-600 mb-4">❌ {error}</p>}

      {candidates !== null && (
        <>
          <div className="flex items-center justify-between mb-3 gap-3">
            <div className="flex items-center gap-3">
              <p className="text-sm text-gray-600">
                Found <span className="font-bold text-blue-600">{candidates.length}</span> candidate{candidates.length !== 1 ? 's' : ''}
              </p>
            </div>
            {candidates.length > 0 && (
              <input
                type="text"
                placeholder="Filter by name, code, brand…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-60 focus:outline-none focus:ring-2 focus:ring-orange-300"
              />
            )}
          </div>

          <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 uppercase text-left">
                    <th className="px-2 py-2 border-b border-gray-200">
                      <input type="checkbox"
                        checked={selected.size === candidates.length && candidates.length > 0}
                        onChange={e => setSelected(e.target.checked ? new Set(candidates.map(c => c.id)) : new Set())}
                        className="cursor-pointer"
                      />
                    </th>
                    <th className="px-3 py-2 font-semibold border-b border-gray-200">Code</th>
                    <th className="px-3 py-2 font-semibold border-b border-gray-200">Name</th>
                    <th className="px-3 py-2 font-semibold border-b border-gray-200">Brand</th>
                    <th className="px-3 py-2 font-semibold border-b border-gray-200 text-right">Cost</th>
                    <th className="px-3 py-2 font-semibold border-b border-gray-200 text-right">RRP</th>
                    <th className="px-3 py-2 font-semibold border-b border-gray-200">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((c, i) => (
                    <tr key={`${c.optionId}-${i}`}
                      className={`hover:bg-orange-50 transition-colors ${selected.has(c.id) ? '' : 'opacity-40'}`}
                      onClick={() => setSelected(s => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                    >
                      <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(c.id)}
                          onChange={e => setSelected(s => { const n = new Set(s); e.target.checked ? n.add(c.id) : n.delete(c.id); return n; })}
                          className="cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-700">{c.code}</td>
                      <td className="px-3 py-2 text-gray-800 font-medium max-w-xs truncate">{c.name}</td>
                      <td className="px-3 py-2 text-gray-600">{c.brand}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{c.cost ? `$${parseFloat(c.cost).toFixed(2)}` : '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{c.retailPrice ? `$${parseFloat(c.retailPrice).toFixed(2)}` : '—'}</td>
                      <td className="px-3 py-2 text-gray-500">{c.createdDate.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          {/* ── Bulk Inactivate section ─────────────────────────────────── */}
          {candidates.length > 0 && selected.size > 0 && (
            <div className="mt-6 pt-5 border-t border-gray-200">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                <p className="text-sm font-semibold text-amber-800 mb-1">⚠️ Before you inactivate</p>
                <p className="text-xs text-amber-700">
                  Uncheck any rows you want to <strong>keep active</strong>. The button below will inactivate only the
                  checked products ({selected.size} of {candidates.length} selected).
                  This action cannot be undone in bulk — products must be re-activated manually in Cin7.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={async () => {
                    const ids = Array.from(selected);
                    if (!confirm(`This will inactivate ${ids.length} product${ids.length !== 1 ? 's' : ''} in Cin7. Are you sure?`)) return;
                    setInactivating(true);
                    await runInactivateStream(ids);
                  }}
                  disabled={inactivating}
                  className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {inactivating ? 'Inactivating…' : `🚫 Bulk Inactivate ${selected.size} Product${selected.size !== 1 ? 's' : ''} in Cin7`}
                </button>
                {inactivating && (
                  <button
                    onClick={() => setProgressOpen(true)}
                    className="text-xs text-blue-600 underline"
                  >View progress</button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Inactivate from a previous analysis ──────────────────────── */}
      <div className="mt-6 pt-5 border-t border-gray-200">
        <h3 className="text-sm font-bold text-gray-700 mb-1">Inactivate from a Previous Analysis</h3>
        <p className="text-xs text-gray-500 mb-3">
          Paste the Google Sheets URL or ID from an analysis run a few days ago.
          Delete any rows you want to keep first, then click Inactivate.
        </p>
        <div className="flex gap-2 items-center mb-3">
          <input
            type="text"
            value={manualSheetInput}
            onChange={e => { setManualSheetInput(e.target.value); setManualError(''); }}
            placeholder="Paste spreadsheet URL or ID…"
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-300"
          />
          <button
            onClick={runManualInactivate}
            disabled={manualInactivating || !manualSheetInput.trim() || !databaseId}
            className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors shrink-0"
          >
            {manualInactivating ? 'Inactivating…' : '🚫 Inactivate'}
          </button>
        </div>
        {manualError && <p className="text-xs text-red-600 mb-2">❌ {manualError}</p>}
        {manualInactivating && (
          <button onClick={() => setProgressOpen(true)} className="text-xs text-blue-600 underline mb-2">View live progress</button>
        )}
      </div>

      {/* ── Live Progress Dialog ───────────────────────────────────────── */}
      {progressOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (progressDone && e.target === e.currentTarget) setProgressOpen(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[80vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-sm font-bold text-gray-800">Bulk Inactivate Progress</h3>
                {!progressDone && progressTotal > 0 && (
                  <p className="text-xs text-gray-500 mt-0.5">{progressIndex} / {progressTotal} processed</p>
                )}
                {progressDone && !progressStopped && (
                  <p className="text-xs text-green-600 font-semibold mt-0.5">Complete</p>
                )}
                {progressDone && progressStopped && (
                  <p className="text-xs text-orange-600 font-semibold mt-0.5">Stopped</p>
                )}
              </div>
              {!progressDone && (
                <button
                  onClick={() => { abortRef.current?.abort(); }}
                  className="text-xs px-3 py-1.5 bg-red-100 hover:bg-red-200 rounded-lg font-semibold text-red-700 transition-colors"
                >Stop</button>
              )}
              {progressDone && (
                <button
                  onClick={() => setProgressOpen(false)}
                  className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg font-semibold text-gray-600 transition-colors"
                >Close</button>
              )}
            </div>

            {/* Progress bar */}
            {progressTotal > 0 && (
              <div className="px-5 pt-3">
                <progress className="w-full h-2 rounded-full overflow-hidden [&::-webkit-progress-bar]:bg-gray-100 [&::-webkit-progress-value]:bg-blue-600 [&::-moz-progress-bar]:bg-blue-600" value={progressIndex} max={progressTotal} />
              </div>
            )}

            {/* Currently processing */}
            {!progressDone && progressCurrent && (
              <div className="px-5 pt-2">
                <p className="text-xs text-blue-700 font-medium truncate">⏳ {progressCurrent}</p>
              </div>
            )}

            {/* Scrolling log */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-1">
              {progressLog.map((entry, i) => (
                <p key={i} className={`text-xs font-mono ${entry.cls}`}>
                  {entry.icon} {entry.text}
                </p>
              ))}
            </div>

            {/* Summary footer (after done) */}
            {progressDone && (
              <div className="px-5 pb-4 pt-2 border-t border-gray-100">
                {inactivateResult && (
                  <div className="flex gap-4 text-xs mb-3">
                    <span className="text-green-700 font-semibold">✅ {inactivateResult.inactivated.length} inactivated</span>
                    <span className="text-gray-500">⏭ {inactivateResult.skipped.length} skipped</span>
                    <span className="text-red-600">❌ {inactivateResult.errors.length} errors</span>
                  </div>
                )}
                <button
                  onClick={() => setProgressOpen(false)}
                  className="w-full py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm font-semibold text-gray-700 transition-colors"
                >Close</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Info panel */}
      <div className="border-t border-gray-100 pt-5 mt-5">
        <div className="grid md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">What is this?</p>
            <p className="text-sm text-gray-700">Products with zero stock, no sales in the past 12 months, and created more than 2 years ago — likely safe to mark inactive in Cin7.</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Before inactivating</p>
            <p className="text-sm text-gray-700">Review the exported list in Google Sheets first. Check for any products you still intend to restock before applying bulk changes.</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Syncing first</p>
            <p className="text-sm text-gray-700">For accurate results, run a <strong>Products</strong> and <strong>Sales</strong> sync in Sync Inventory before running this analysis.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Lost / Possible Losses View ─────────────────────────────────────────────────
interface LostCandidate {
  id: string; styleCode: string; name: string; brand: string; category: string;
  code: string; cost: string; retailPrice: string;
  branch: string; soh: number; qty180: number; lastSold: string;
}

function LostCandidatesView({ databaseId }: { databaseId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState<LostCandidate[] | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchFilter, setBranchFilter] = useState('all');
  const [textFilter, setTextFilter] = useState('');
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string | null>(null);

  const runAnalysis = async () => {
    if (!databaseId) { setError('No business selected.'); return; }
    setLoading(true);
    setError('');
    setCandidates(null);
    setBranches([]);
    setBranchFilter('all');
    setSpreadsheetUrl(null);
    try {
      const res = await fetch('/api/inventory/lost-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'Unknown error');
      setCandidates(data.candidates);
      setBranches(data.branches ?? []);
      setSpreadsheetUrl(data.spreadsheetUrl ?? null);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  const filtered = candidates?.filter(c => {
    if (branchFilter !== 'all' && c.branch !== branchFilter) return false;
    const q = textFilter.toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) ||
      c.brand.toLowerCase().includes(q) || c.styleCode.toLowerCase().includes(q);
  }) ?? [];

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center text-xl">🔍</div>
          <div>
            <h2 className="font-bold text-gray-800 text-lg leading-tight">Possible Losses</h2>
            <p className="text-xs text-gray-500">Stock on hand at a branch with zero sales in the last 6 months — likely lost, stolen, or broken</p>
          </div>
        </div>
        <button
          onClick={runAnalysis}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shrink-0"
        >
          {loading ? 'Analysing…' : 'Run Analysis'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-4">❌ {error}</p>}

      {candidates !== null && (
        <>
          <div className="flex flex-wrap items-center justify-between mb-3 gap-3">
            <div className="flex items-center gap-3">
              <p className="text-sm text-gray-600">
                Found <span className="font-bold text-blue-600">{candidates.length}</span> line{candidates.length !== 1 ? 's' : ''}
                {branchFilter !== 'all' && (
                  <span className="text-gray-400"> ({filtered.length} shown)</span>
                )}
              </p>
              {spreadsheetUrl && (
                <a href={spreadsheetUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs font-semibold text-green-600 hover:text-green-700 underline">
                  📄 Open in Google Sheets
                </a>
              )}
            </div>
            {candidates.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  value={branchFilter}
                  onChange={e => setBranchFilter(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-300"
                >
                  <option value="all">All branches</option>
                  {branches.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <input
                  type="text"
                  placeholder="Filter by name, code…"
                  value={textFilter}
                  onChange={e => setTextFilter(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-44 focus:outline-none focus:ring-2 focus:ring-red-300"
                />
              </div>
            )}
          </div>

          {filtered.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 uppercase text-left">
                    <th className="px-3 py-2 font-semibold border-b border-gray-200">Branch</th>
                    <th className="px-3 py-2 font-semibold border-b border-gray-200">Code</th>
                    <th className="px-3 py-2 font-semibold border-b border-gray-200">Name</th>
                    <th className="px-3 py-2 font-semibold border-b border-gray-200">Brand</th>
                    <th className="px-3 py-2 font-semibold border-b border-gray-200 text-right">SOH</th>
                    <th className="px-3 py-2 font-semibold border-b border-gray-200 text-right">Cost</th>
                    <th className="px-3 py-2 font-semibold border-b border-gray-200 text-right">RRP</th>
                    <th className="px-3 py-2 font-semibold border-b border-gray-200">Last Sold</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((c, i) => (
                    <tr key={`${c.id}-${c.branch}-${i}`} className="hover:bg-red-50 transition-colors">
                      <td className="px-3 py-2">
                        <span className="inline-block bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">{c.branch}</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-700">{c.code}</td>
                      <td className="px-3 py-2 text-gray-800 font-medium max-w-xs truncate">{c.name}</td>
                      <td className="px-3 py-2 text-gray-600">{c.brand}</td>
                      <td className="px-3 py-2 text-right font-semibold text-red-700">{c.soh}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{c.cost ? `$${parseFloat(c.cost).toFixed(2)}` : '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{c.retailPrice ? `$${parseFloat(c.retailPrice).toFixed(2)}` : '—'}</td>
                      <td className="px-3 py-2 text-gray-500">{c.lastSold ? c.lastSold.slice(0, 10) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-8">
              {textFilter || branchFilter !== 'all' ? 'No results match your filters.' : '🎉 No possible losses found.'}
            </p>
          )}
        </>
      )}

      {/* Info panel */}
      <div className="border-t border-gray-100 pt-5 mt-5">
        <div className="grid md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">What is this?</p>
            <p className="text-sm text-gray-700">Stock sitting at a branch with zero sales in the last 6 months — items that may have been lost, stolen, damaged, or miscounted.</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">What to do</p>
            <p className="text-sm text-gray-700">Investigate each line with your team. If confirmed lost or broken, write off or adjust the stock in Cin7 to keep inventory accurate.</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Syncing first</p>
            <p className="text-sm text-gray-700">For accurate results, run a <strong>Products</strong>, <strong>Sales</strong>, and <strong>Branches</strong> sync in Sync Inventory before running this analysis.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Marketing Settings View ───────────────────────────────────────────────────
function MarketingSettingsView({ databaseId }: { databaseId: string }) {
  const [highMin, setHighMin] = useState('65');
  const [midMin,  setMidMin]  = useState('40');
  const [status,  setStatus]  = useState<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [error,   setError]   = useState('');

  // Derived preview tiers from current input values
  const high = parseFloat(highMin) || 65;
  const mid  = parseFloat(midMin)  || 40;

  useEffect(() => {
    if (!databaseId) { setStatus('idle'); return; }
    setStatus('loading');
    fetch(`/api/user/marketing-settings?databaseId=${encodeURIComponent(databaseId)}`)
      .then(r => r.json())
      .then(d => {
        if (d.thresholds) {
          setHighMin(String(d.thresholds.high));
          setMidMin(String(d.thresholds.mid));
        }
        setStatus('idle');
      })
      .catch(() => setStatus('idle'));
  }, [databaseId]);

  const save = async () => {
    const h = parseFloat(highMin);
    const m = parseFloat(midMin);
    if (!Number.isFinite(h) || h <= 0 || h > 100) { setError('High threshold must be 1–100.'); return; }
    if (!Number.isFinite(m) || m <= 0 || m >= h)   { setError(`Mid threshold must be > 0 and < ${h}.`); return; }
    setError('');
    setStatus('saving');
    try {
      const res = await fetch('/api/user/marketing-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, highMin: h, midMin: m }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'Save failed');
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (e: any) {
      setError(e.message);
      setStatus('error');
    }
  };

  if (status === 'loading') {
    return <div className="p-6 text-gray-400 text-sm">Loading settings…</div>;
  }

  const TIER_BANDS = [
    { label: 'High',    color: 'bg-emerald-500', text: 'text-emerald-300', range: `≥ ${high}%`,       desc: 'Premium margin — low break-even ROAS required' },
    { label: 'Mid',     color: 'bg-amber-500',   text: 'text-amber-300',   range: `${mid}% – ${high - 0.1}%`, desc: 'Moderate margin — needs efficient targeting' },
    { label: 'Low',     color: 'bg-red-500',      text: 'text-red-300',    range: `< ${mid}%`,         desc: 'Thin margin — high ROAS required to be profitable' },
    { label: 'No Data', color: 'bg-gray-600',     text: 'text-gray-400',   range: 'N/A',               desc: 'Margin data unavailable' },
  ];

  return (
    <div className="p-6 max-w-2xl space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">Marketing Settings</h2>
        <p className="text-sm text-gray-400">Configure how brands are classified into margin tiers. Tiers affect break-even ROAS targets and campaign audit scores.</p>
      </div>

      {/* Threshold inputs */}
      <div className="bg-gray-800 rounded-xl p-5 space-y-5">
        <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Margin Tier Thresholds</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">High Margin ≥ (%)</label>
            <input
              type="number" min="1" max="99" step="1"
              value={highMin}
              onChange={e => setHighMin(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Mid Margin ≥ (%)</label>
            <input
              type="number" min="1" max="99" step="1"
              value={midMin}
              onChange={e => setMidMin(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>
        <p className="text-xs text-gray-500">Defaults: High ≥ 65%, Mid ≥ 40%. Anything below Mid threshold is classified as Low. Re-run Calculated Reports after changing thresholds to update tier data.</p>
      </div>

      {/* Tier preview */}
      <div className="bg-gray-800 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">Tier Preview</h3>
        <div className="space-y-2">
          {TIER_BANDS.map(t => (
            <div key={t.label} className="flex items-center gap-3">
              <span className={`w-2 h-8 rounded-full ${t.color} shrink-0`} />
              <div className="flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={`text-sm font-medium ${t.text}`}>{t.label}</span>
                  <span className="text-xs text-gray-400">{t.range}</span>
                </div>
                <p className="text-xs text-gray-500">{t.desc}</p>
              </div>
              {t.label !== 'No Data' && (
                <span className="text-xs text-gray-400 font-mono">
                  {t.label === 'High' ? `BE ROAS: ${(100 / Math.max(high, 1)).toFixed(2)}x` :
                   t.label === 'Mid'  ? `BE ROAS: ${(100 / Math.max((high + mid) / 2, 1)).toFixed(2)}x` :
                                        `BE ROAS: ${(100 / Math.max(mid * 0.7, 1)).toFixed(2)}x`}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        onClick={save}
        disabled={status === 'saving'}
        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
      >
        {status === 'saving' ? 'Saving…' : status === 'saved' ? '✓ Saved' : 'Save Settings'}
      </button>
    </div>
  );
}

// ── Campaign Architecture Audit View ─────────────────────────────────────────
type AuditPhase = 'idle' | 'loading_data' | 'analyzing' | 'complete' | 'error';
interface CampaignChannelScore {
  score: number;
  status: 'healthy' | 'at_risk' | 'critical' | 'not_configured';
  headline: string;
}
interface CampaignAuditReport {
  executiveSummary: string;
  overallHealthScore: number;
  generatedAt: string;
  channelScores: Record<'googleAds' | 'metaAds' | 'ga4' | 'klaviyo', CampaignChannelScore>;
  coverageGaps: Array<{ category: string; topProducts: string[]; estimatedRevenueLost: string; priority: string; suggestedAction: string }>;
  underperformers: Array<{ channel: string; campaignName: string; issue: string; metric: string; recommendation: string; urgency: string }>;
  missingCampaignTypes: Array<{ type: string; channel: string; rationale: string; estimatedImpact: string; effort: string }>;
  emailAutomationGaps: Array<{ flowType: string; industryBenchmark: string; potentialRevenue: string; priority: string }>;
  quickWins: Array<{ title: string; description: string; channel: string; effort: string; impact: string; timeToImplement: string }>;
  recommendations: Array<{ id: number; title: string; description: string; channel: string; effort: string; impact: string; priority: number }>;
}

function CampaignAuditView({ databaseId }: { databaseId: string }) {
  const [phase, setPhase] = useState<AuditPhase>('idle');
  const [message, setMessage] = useState('');
  const [audit, setAudit] = useState<CampaignAuditReport | null>(null);
  const [auditError, setAuditError] = useState('');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    executive: true, channels: true, coverage: true, underperformers: true,
    missing: true, email: true, quickWins: true, recommendations: false,
  });
  const toggleSection = (id: string) => setOpenSections(p => ({ ...p, [id]: !p[id] }));

  const runAudit = async () => {
    if (!databaseId) return;
    setPhase('loading_data');
    setMessage('Starting audit…');
    setAudit(null);
    setAuditError('');
    try {
      const res = await fetch('/api/ai/campaign-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId }),
      });
      if (!res.body) throw new Error('No stream returned');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.phase === 'loading_data' || evt.phase === 'analyzing') {
              setPhase(evt.phase);
              setMessage(evt.message ?? '');
            }
            if (evt.phase === 'complete') { setAudit(evt.audit); setPhase('complete'); }
            if (evt.phase === 'error') { setAuditError(evt.error ?? 'Unknown error'); setPhase('error'); }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (e: any) { setAuditError(e.message); setPhase('error'); }
  };

  const priorityBadge = (p: string) =>
    p === 'high' ? 'bg-red-100 text-red-700' : p === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500';
  const effortBadge = (e: string) =>
    e === 'low' ? 'bg-green-100 text-green-700' : e === 'medium' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700';
  const impactBadge = (i: string) =>
    i === 'high' ? 'bg-purple-100 text-purple-700' : i === 'medium' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500';
  const channelStatusBorder = (s: string) =>
    s === 'healthy' ? 'border-green-300 bg-green-50 text-green-800' :
    s === 'at_risk'  ? 'border-yellow-300 bg-yellow-50 text-yellow-800' :
    s === 'critical' ? 'border-red-300 bg-red-50 text-red-800' :
    'border-gray-200 bg-gray-50 text-gray-500';
  const scoreColor = (n: number) => n >= 70 ? 'text-green-600' : n >= 40 ? 'text-yellow-500' : 'text-red-600';
  const scoreBarColor = (n: number) => n >= 70 ? 'bg-green-500' : n >= 40 ? 'bg-yellow-400' : 'bg-red-500';

  const SectionHeader = ({ id, title, count }: { id: string; title: string; count?: number }) => (
    <button onClick={() => toggleSection(id)}
      className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-t-xl transition text-left">
      <span className="font-semibold text-sm text-gray-800">{title}{count != null ? ` (${count})` : ''}</span>
      <span className="text-gray-400 text-xs">{openSections[id] ? '▲' : '▼'}</span>
    </button>
  );

  const channelLabels: Record<string, string> = {
    googleAds: 'Google Ads', metaAds: 'Meta Ads', ga4: 'GA4', klaviyo: 'Klaviyo',
  };
  const isRunning = phase === 'loading_data' || phase === 'analyzing';

  return (
    <div className="p-6 flex flex-col gap-5 max-w-5xl mx-auto w-full">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Campaign Architecture Audit</h1>
          <p className="text-sm text-gray-500 mt-0.5">Structural gaps, underperformers &amp; quick wins across all marketing channels</p>
        </div>
        <button onClick={runAudit} disabled={isRunning || !databaseId}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition disabled:opacity-50 shrink-0">
          {isRunning ? (
            <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"/></svg>{phase === 'loading_data' ? 'Loading Data…' : 'Analysing…'}</>
          ) : (
            <><svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>{audit ? 'Re-run Audit' : 'Run Audit'}</>
          )}
        </button>
      </div>

      {isRunning && (
        <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
          <svg className="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z"/></svg>
          {message}
        </div>
      )}

      {phase === 'error' && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <span className="font-semibold">Audit failed: </span>{auditError}
        </div>
      )}

      {audit && (
        <>
          {/* Health scorecard */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="md:col-span-1 flex flex-col items-center justify-center bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <div className={`text-4xl font-black ${scoreColor(audit.overallHealthScore)}`}>{audit.overallHealthScore}</div>
              <div className="text-xs text-gray-500 mt-1 font-medium text-center">Overall Score</div>
              <div className="h-1.5 w-full bg-gray-200 rounded-full mt-2">
                <div className={`h-1.5 rounded-full ${scoreBarColor(audit.overallHealthScore)}`} style={{ width: `${audit.overallHealthScore}%` }} />
              </div>
            </div>
            {Object.entries(audit.channelScores ?? {}).map(([ch, cs]: [string, any]) => (
              <div key={ch} className={`flex flex-col gap-1 border rounded-xl p-3 shadow-sm ${channelStatusBorder(cs.status)}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide opacity-80">{channelLabels[ch] ?? ch}</span>
                  <span className="text-xl font-black">{cs.score}</span>
                </div>
                <div className="h-1 w-full bg-white/50 rounded-full">
                  <div className={`h-1 rounded-full ${scoreBarColor(cs.score)}`} style={{ width: `${cs.score}%` }} />
                </div>
                <p className="text-xs mt-1 leading-snug opacity-90">{cs.headline}</p>
              </div>
            ))}
          </div>

          {/* Executive Summary */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <SectionHeader id="executive" title="Executive Summary" />
            {openSections.executive && (
              <div className="px-4 py-3 text-sm text-gray-700 whitespace-pre-line leading-relaxed">{audit.executiveSummary}</div>
            )}
          </div>

          {/* Coverage Gaps */}
          {audit.coverageGaps?.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <SectionHeader id="coverage" title="Coverage Gaps" count={audit.coverageGaps.length} />
              {openSections.coverage && (
                <div className="divide-y divide-gray-100">
                  {audit.coverageGaps.map((g, i) => (
                    <div key={i} className="px-4 py-3 flex flex-col gap-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{g.category}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityBadge(g.priority)}`}>{g.priority}</span>
                        <span className="text-xs text-gray-400">{g.estimatedRevenueLost}</span>
                      </div>
                      {g.topProducts?.length > 0 && <p className="text-xs text-gray-500">Products: {g.topProducts.slice(0, 4).join(', ')}</p>}
                      <p className="text-xs text-blue-700">→ {g.suggestedAction}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Underperformers */}
          {audit.underperformers?.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <SectionHeader id="underperformers" title="Underperforming Campaigns" count={audit.underperformers.length} />
              {openSections.underperformers && (
                <div className="divide-y divide-gray-100">
                  {audit.underperformers.map((u, i) => (
                    <div key={i} className="px-4 py-3 flex flex-col gap-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{u.campaignName}</span>
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{u.channel}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityBadge(u.urgency)}`}>{u.urgency}</span>
                      </div>
                      <p className="text-xs text-gray-600"><span className="font-medium">Issue:</span> {u.issue}</p>
                      <p className="text-xs text-gray-500"><span className="font-medium">Metric:</span> {u.metric}</p>
                      <p className="text-xs text-blue-700">→ {u.recommendation}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Missing Campaign Types */}
          {audit.missingCampaignTypes?.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <SectionHeader id="missing" title="Missing Campaign Types" count={audit.missingCampaignTypes.length} />
              {openSections.missing && (
                <div className="divide-y divide-gray-100">
                  {audit.missingCampaignTypes.map((m, i) => (
                    <div key={i} className="px-4 py-3 flex flex-col gap-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{m.type}</span>
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{m.channel}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${effortBadge(m.effort)}`}>effort: {m.effort}</span>
                      </div>
                      <p className="text-xs text-gray-600">{m.rationale}</p>
                      <p className="text-xs text-purple-700">Expected impact: {m.estimatedImpact}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Email Automation Gaps */}
          {audit.emailAutomationGaps?.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <SectionHeader id="email" title="Email Automation Gaps" count={audit.emailAutomationGaps.length} />
              {openSections.email && (
                <div className="divide-y divide-gray-100">
                  {audit.emailAutomationGaps.map((e, i) => (
                    <div key={i} className="px-4 py-3 flex flex-col gap-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{e.flowType}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityBadge(e.priority)}`}>{e.priority}</span>
                      </div>
                      <p className="text-xs text-gray-500">Industry benchmark: {e.industryBenchmark}</p>
                      <p className="text-xs text-violet-700">Potential revenue: {e.potentialRevenue}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Quick Wins */}
          {audit.quickWins?.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <SectionHeader id="quickWins" title="Quick Wins" count={audit.quickWins.length} />
              {openSections.quickWins && (
                <div className="divide-y divide-gray-100">
                  {audit.quickWins.map((w, i) => (
                    <div key={i} className="px-4 py-3 flex flex-col gap-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{w.title}</span>
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{w.channel}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${effortBadge(w.effort)}`}>effort: {w.effort}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${impactBadge(w.impact)}`}>impact: {w.impact}</span>
                        <span className="text-xs text-gray-400">~{w.timeToImplement}</span>
                      </div>
                      <p className="text-xs text-gray-600">{w.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Full Recommendations */}
          {audit.recommendations?.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <SectionHeader id="recommendations" title="Full Action Plan" count={audit.recommendations.length} />
              {openSections.recommendations && (
                <div className="divide-y divide-gray-100">
                  {[...audit.recommendations].sort((a, b) => a.priority - b.priority).map((r, i) => (
                    <div key={i} className="px-4 py-3 flex gap-3">
                      <div className="shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">{r.priority}</div>
                      <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{r.title}</span>
                          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{r.channel}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${effortBadge(r.effort)}`}>effort: {r.effort}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${impactBadge(r.impact)}`}>impact: {r.impact}</span>
                        </div>
                        <p className="text-xs text-gray-600">{r.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-gray-400 text-right">Audit generated: {new Date(audit.generatedAt).toLocaleString('en-AU')}</p>
        </>
      )}

      {phase === 'idle' && !audit && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
          <p className="text-gray-400 text-sm max-w-sm">Run the audit to identify structural gaps, coverage holes, underperformers, and quick wins across all your marketing channels.</p>
          <p className="text-xs text-gray-300">Sync marketing data first for best results.</p>
        </div>
      )}
    </div>
  );
}

// ── Marketing Assistant View ────────────────────────────────────────────────
interface MarketingMission {
  // 5-pillar format
  primaryMarketingAim?: string;
  marketingMix?: { brandBuildingPercent: number; salesActivationPercent: number; reasoning: string };
  qualityCreativeStandards?: { visualTone: string; copywritingTone: string; emotionalResonance: string };
  channelDiversity?: { topOfFunnelStrategy: string; bottomOfFunnelStrategy: string; diversificationPhilosophy?: string };
  nextStepsQuestions?: string[];
  // Comprehensive format
  document_title?: string;
  executive_summary?: string;
  brand_identity?: { mission?: string; unique_value_proposition?: string; brand_voice?: string; positioning?: string };
  target_audience?: {
    primary_demographic?: string;
    secondary_demographic?: string;
    core_desires?: string;
    key_objections_and_mitigations?: Array<{ objection: string; mitigation: string }>;
  };
  strategic_objectives?: Array<{ goal: string; target: string }>;
  marketing_channels_and_tactics?: Record<string, { strategy: string; execution: string }>;
  team_and_operations?: { structure?: string; workflow?: string };
}

const MM_DATA_SOURCE_OPTIONS = [
  { id: 'reports',   label: 'Calculated Reports', desc: 'Brand summary, revenue by branch & slow sellers' },
  { id: 'products',  label: 'Product Catalogue',  desc: 'Products with SOH & sales data (up to 200 rows)' },
  { id: 'sales',     label: 'Sales History',      desc: 'Recent transactions (up to 150 rows)' },
  { id: 'googleAds', label: 'Google Ads',         desc: 'Last 30 days campaign performance' },
  { id: 'metaAds',   label: 'Meta Ads',           desc: 'Last 90 days campaign insights' },
  { id: 'analytics', label: 'Website Analytics',  desc: 'GA4 sessions, conversions & revenue' },
  { id: 'website',   label: 'Website Products',   desc: 'Shopify product listings (up to 100 rows)' },
  { id: 'klaviyo',   label: 'Klaviyo Email',       desc: 'Email campaigns & automation flows' },
] as const;
type MMDataSourceId = (typeof MM_DATA_SOURCE_OPTIONS)[number]['id'];
const MM_DEFAULT_SOURCES: Record<MMDataSourceId, boolean> = {
  reports: true, products: false, sales: false,
  googleAds: false, metaAds: false, analytics: false, website: false, klaviyo: false,
};

function MarketingAssistantView({ databaseId }: { databaseId: string }) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ strategic: true });
  const [missionModalOpen, setMissionModalOpen] = useState(false);
  const [mission, setMission] = useState<MarketingMission | null>(null);

  // Chat interface state (like AI Helper)
  const [messages, setMessages] = useState<{ role: 'user' | 'cmo'; text: string }[]>([
    {
      role: 'cmo',
      text: 'Greetings. I am your Chief Marketing Officer. I\'m here to help you build a strategic marketing mission and philosophy that will guide your brand\'s direction. Let me review what I know about your business and identify what additional information I need from you.',
    },
  ]);
  const [missionPrompt, setMissionPrompt] = useState('');
  const [missionLoading, setMissionLoading] = useState(false);
  const [missionError, setMissionError] = useState('');
  const [missionSaving, setMissionSaving] = useState(false);
  const [savingMessage, setSavingMessage] = useState('');
  const [mmSettingsOpen, setMmSettingsOpen] = useState(false);
  const [mmDataSources, setMmDataSources] = useState<Record<MMDataSourceId, boolean>>(MM_DEFAULT_SOURCES);
  const [mmPreviewOpen, setMmPreviewOpen] = useState(false);
  const [mmPreviewText, setMmPreviewText] = useState('');
  const [mmPreviewAttachments, setMmPreviewAttachments] = useState<{label: string; filename: string; rowCount: number; mode: string; csvContent: string}[]>([]);
  const [mmPreviewLoading, setMmPreviewLoading] = useState(false);
  const [mmCopied, setMmCopied] = useState(false);

  // Load saved mission on mount
  useEffect(() => {
    if (!databaseId) return;
    const loadMission = async () => {
      try {
        const res = await fetch(`/api/user/marketing-mission?databaseId=${encodeURIComponent(databaseId)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.mission) {
            setMission(data.mission);
          }
        }
      } catch (e) { /* silent fail */ }
    };
    loadMission();
  }, [databaseId]);

  // Load + persist data source settings
  useEffect(() => {
    if (!databaseId) return;
    try {
      const stored = localStorage.getItem(`marketoir_mm_sources_${databaseId}`);
      if (stored) setMmDataSources(prev => ({ ...prev, ...JSON.parse(stored) }));
    } catch {}
  }, [databaseId]);
  useEffect(() => {
    if (!databaseId) return;
    try { localStorage.setItem(`marketoir_mm_sources_${databaseId}`, JSON.stringify(mmDataSources)); } catch {}
  }, [mmDataSources, databaseId]);

  // Start the mission session manually (called when user clicks the start button)
  const startMission = async () => {
    if (!databaseId || missionLoading) return;
    setMissionLoading(true);
    try {
      const res = await fetch('/api/ai/marketing-mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId,
          prompt: 'Analyze the business profile I have on file. Based on what you know about my brand, business model, and market position, what key questions do you need answered from me before you can build a comprehensive marketing mission and strategy document? List out these questions so I can provide answers.',
          history: [],
          dataSources: Object.entries(mmDataSources).filter(([, v]) => v).map(([k]) => k),
        }),
      });
      const data = await res.json();
      if (data.response) {
        setMessages(prev => [...prev, { role: 'cmo', text: data.response }]);
      }
    } catch (e) {
      console.error('Failed to start mission session', e);
    }
    setMissionLoading(false);
  };

  const toggleSection = (id: string) => {
    setExpandedSections(p => ({ ...p, [id]: !p[id] }));
  };

  const sendMissionMessage = async () => {
    if (!missionPrompt.trim() || !databaseId) return;
    
    missionError && setMissionError('');
    const userMsg = { role: 'user' as const, text: missionPrompt.trim() };
    setMessages(prev => [...prev, userMsg]);
    setMissionPrompt('');
    setMissionLoading(true);

    try {
      const historyForApi = messages
        .filter(m => m.text.trim())
        .map(m => ({ role: m.role === 'cmo' ? 'assistant' : 'user', content: m.text }));

      const res = await fetch('/api/ai/marketing-mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId,
          prompt: userMsg.text,
          history: historyForApi,
          dataSources: Object.entries(mmDataSources).filter(([, v]) => v).map(([k]) => k),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Unknown error');

      if (data.mission) {
        setMission(data.mission);
        const m = data.mission;
        const missionSummary = m.executive_summary
          ? `I've generated your **${m.document_title || 'Marketing Mission & Strategy Document'}**. The full document is now showing in the right panel — review each section and let me know if you'd like to refine anything, or click **Save Mission** when you're happy with it.\n\n**Summary:** ${m.executive_summary.substring(0, 200)}…`
          : `I've generated a strategic marketing mission & philosophy document for you.\n\n**Primary Marketing Aim:** ${m.primaryMarketingAim ?? ''}\n\n**Marketing Mix:** ${m.marketingMix?.brandBuildingPercent ?? '?'}% Brand Building / ${m.marketingMix?.salesActivationPercent ?? '?'}% Sales Activation\n\n${(m.nextStepsQuestions ?? []).length > 0 ? '**Next Steps:**\n' + (m.nextStepsQuestions ?? []).map((q: string) => `• ${q}`).join('\n') + '\n\n' : ''}Would you like me to refine any section, or shall we save this mission?`;
        setMessages(prev => [...prev, { role: 'cmo', text: missionSummary }]);
      } else if (data.response) {
        setMessages(prev => [...prev, { role: 'cmo', text: data.response }]);
      }
    } catch (e: any) {
      setMissionError(e.message);
      setMessages(prev => [...prev, { role: 'cmo', text: `I encountered an issue: ${e.message}` }]);
    }
    setMissionLoading(false);
  };

  const saveMissionToSheet = async () => {
    if (!mission || !databaseId) return;
    setMissionSaving(true);
    setSavingMessage('');
    try {
      const res = await fetch('/api/user/marketing-mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, mission }),
      });
      const data = await res.json();
      if (data.success) {
        setSavingMessage('✅ Marketing Mission saved to your sheet');
        setTimeout(() => setMissionModalOpen(false), 1500);
      } else {
        setSavingMessage(`❌ ${data.error || 'Save failed'}`);
      }
    } catch (e: any) {
      setSavingMessage(`❌ ${e.message}`);
    }
    setMissionSaving(false);
  };

  const MM_START_PROMPT = 'Analyze the business profile I have on file. Based on what you know about my brand, business model, and market position, what key questions do you need answered from me before you can build a comprehensive marketing mission and strategy document? List out these questions so I can provide answers.';

  const previewMissionPrompt = async () => {
    if (!databaseId) return;
    // Before the session starts, preview the initial start prompt; otherwise preview the typed message.
    const promptToPreview = messages.length === 1 ? MM_START_PROMPT : missionPrompt.trim();
    if (!promptToPreview) return;
    setMmPreviewLoading(true);
    try {
      const historyForApi = messages
        .filter(m => m.text.trim())
        .map(m => ({ role: m.role === 'cmo' ? 'assistant' : 'user', content: m.text }));
      const res = await fetch('/api/ai/marketing-mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId,
          prompt: promptToPreview,
          history: historyForApi,
          dataSources: Object.entries(mmDataSources).filter(([, v]) => v).map(([k]) => k),
          preview: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Unknown error');
      setMmPreviewText(data.fullPrompt ?? '');
      setMmPreviewAttachments(data.csvAttachments ?? []);
      setMmPreviewOpen(true);
    } catch (e: any) {
      setMissionError(e.message);
    }
    setMmPreviewLoading(false);
  };

  return (
    <div className="max-w-6xl space-y-6">
      {/* Strategic Layer Section */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <button
          onClick={() => toggleSection('strategic')}
          className="w-full flex items-center justify-between gap-3 px-6 py-4 hover:bg-gray-50 transition-colors border-b border-gray-100"
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">🎯</span>
            <div className="text-left">
              <h2 className="font-bold text-gray-800 text-lg">Strategic Layer</h2>
              <p className="text-xs text-gray-500">High-level philosophy & direction for marketing</p>
            </div>
          </div>
          <span className={`text-gray-400 transition-transform ${expandedSections['strategic'] ? 'rotate-180' : ''}`}>▼</span>
        </button>

        {expandedSections['strategic'] && (
          <div className="p-6 space-y-4">
            {/* Marketing Mission Tile */}
            <div
              onClick={() => setMissionModalOpen(true)}
              className="border border-gray-200 rounded-xl p-6 hover:border-indigo-300 hover:bg-indigo-50 transition-all cursor-pointer group"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold text-gray-800 text-base group-hover:text-indigo-700 transition-colors mb-2">
                    📋 Marketing Mission
                  </h3>
                  <p className="text-sm text-gray-600">
                    {mission
                      ? 'Click to refine your marketing mission & philosophy'
                      : 'Create your marketing mission & philosophy with AI guidance'}
                  </p>
                </div>
                <span className="text-xl group-hover:scale-110 transition-transform">→</span>
              </div>
              {mission && (
                <div className="mt-4 pt-4 border-t border-gray-200 space-y-2 text-xs text-gray-700">
                  {mission.document_title && <p className="font-semibold text-gray-800">{mission.document_title}</p>}
                  {mission.executive_summary && <p className="italic">{mission.executive_summary.substring(0, 120)}…</p>}
                  {mission.primaryMarketingAim && !mission.executive_summary && <p><span className="font-semibold">Primary Aim:</span> {mission.primaryMarketingAim.substring(0, 80)}…</p>}
                </div>
              )}
            </div>

            {/* Future tiles placeholder */}
            <div className="text-sm text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-lg">
              More strategic elements coming soon (Brand Positioning, Market Segmentation, etc.)
            </div>
          </div>
        )}
      </div>

      {/* Marketing Mission Chat Dialog */}
      {missionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200 shrink-0">
              <div>
                <h3 className="font-bold text-gray-800 text-lg">📋 Marketing Mission Builder</h3>
                <p className="text-xs text-gray-500">Chat with CMO to refine, then save your mission</p>
              </div>
              <div className="flex items-center gap-2 relative">
                {/* Settings cog */}
                <button
                  onClick={() => setMmSettingsOpen(p => !p)}
                  title="Data sources"
                  className={`p-1.5 rounded-lg transition-colors ${mmSettingsOpen ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                  </svg>
                </button>
                {/* Settings dropdown */}
                {mmSettingsOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMmSettingsOpen(false)} />
                    <div className="absolute right-10 top-full mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-20 p-4">
                      <p className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-3">CMO Data Sources</p>
                      {/* Always-on sources */}
                      <div className="mb-3 pb-3 border-b border-gray-100 space-y-1.5">
                        <p className="text-xs text-gray-400 mb-1">Always included</p>
                        {['Business Information', 'Brand Profile'].map(label => (
                          <div key={label} className="flex items-center gap-2 text-sm text-gray-500">
                            <div className="w-4 h-4 rounded flex items-center justify-center bg-indigo-100 text-indigo-600 text-xs shrink-0">✓</div>
                            <span>{label}</span>
                          </div>
                        ))}
                      </div>
                      {/* Optional sources */}
                      <div className="space-y-2.5">
                        <p className="text-xs text-gray-400 mb-1">Optional</p>
                        {MM_DATA_SOURCE_OPTIONS.map(opt => (
                          <label key={opt.id} className="flex items-start gap-2.5 cursor-pointer group">
                            <input
                              type="checkbox"
                              checked={!!mmDataSources[opt.id]}
                              onChange={e => setMmDataSources(prev => ({ ...prev, [opt.id]: e.target.checked }))}
                              className="mt-0.5 accent-indigo-600 shrink-0"
                            />
                            <div>
                              <p className="text-sm font-medium text-gray-700 group-hover:text-indigo-700 leading-tight">{opt.label}</p>
                              <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                <button
                  onClick={() => setMissionModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                >✕</button>
              </div>
            </div>

            {/* Main content - two columns */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left: Chat */}
              <div className="flex-1 flex flex-col border-r border-gray-200">
                {/* Chat history */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-xs rounded-lg px-4 py-3 ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 text-gray-800 border border-gray-200'
                      }`}>
                        <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                      </div>
                    </div>
                  ))}
                  {/* Start button — shown only before the session has been kicked off */}
                  {messages.length === 1 && !missionLoading && (
                    <div className="flex justify-center pt-4">
                      <button
                        onClick={startMission}
                        className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-md transition-colors"
                      >
                        🚀 Start Building my Personalised Marketing Mission
                      </button>
                    </div>
                  )}
                  {missionLoading && (
                    <div className="flex justify-start">
                      <div className="bg-gray-100 text-gray-600 rounded-lg px-4 py-3 text-sm italic">
                        CMO is thinking…
                      </div>
                    </div>
                  )}
                </div>

                {/* Status messages */}
                {missionError && (
                  <div className="px-6 py-2 bg-red-50 border-t border-red-200 text-sm text-red-700">❌ {missionError}</div>
                )}

                {/* Input area */}
                <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 shrink-0">
                  <textarea
                    value={missionPrompt}
                    onChange={e => setMissionPrompt(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && e.ctrlKey) {
                        sendMissionMessage();
                      }
                    }}
                    placeholder={messages.length === 1 ? 'Click the Start button above to begin…' : 'Ask the CMO to generate, refine, or revise your mission…'}
                    rows={2}
                    disabled={missionLoading || missionSaving || messages.length === 1}
                    className="w-full text-sm p-3 border border-gray-300 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 bg-white resize-none disabled:opacity-50"
                  />
                  <div className="flex justify-end gap-3 mt-3">
                    <button
                      onClick={previewMissionPrompt}
                      disabled={missionLoading || mmPreviewLoading || missionSaving || (messages.length > 1 && !missionPrompt.trim())}
                      className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
                    >
                      {mmPreviewLoading ? 'Building…' : 'Preview Prompt'}
                    </button>
                    <button
                      onClick={sendMissionMessage}
                      disabled={!missionPrompt.trim() || missionLoading || missionSaving}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
                    >
                      {missionLoading ? 'Thinking…' : 'Send'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Right: Mission Preview/Editor */}
              <div className="w-96 flex flex-col border-l border-gray-200 bg-gray-50">
                <div className="px-6 py-4 border-b border-gray-200 shrink-0">
                  <h4 className="font-bold text-gray-800 text-base">Marketing Mission</h4>
                  <p className="text-xs text-gray-500">Live preview & editor</p>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4">
                  {mission ? (
                    <div className="space-y-4 text-sm">
                      {mission.executive_summary ? (
                        // ── Comprehensive format ──────────────────────────────
                        <>
                          {mission.document_title && (
                            <p className="font-bold text-gray-800 text-base leading-snug">{mission.document_title}</p>
                          )}
                          {mission.executive_summary && (
                            <div>
                              <label className="block font-semibold text-gray-700 mb-1">Executive Summary</label>
                              <p className="text-gray-700 bg-white p-3 rounded border border-gray-200 text-xs leading-relaxed">{mission.executive_summary}</p>
                            </div>
                          )}
                          {mission.brand_identity && (
                            <div>
                              <label className="block font-semibold text-gray-700 mb-1">Brand Identity</label>
                              <div className="bg-white p-3 rounded border border-gray-200 space-y-1 text-xs text-gray-700">
                                {mission.brand_identity.mission && <p><span className="font-semibold">Mission:</span> {mission.brand_identity.mission}</p>}
                                {mission.brand_identity.unique_value_proposition && <p><span className="font-semibold">UVP:</span> {mission.brand_identity.unique_value_proposition}</p>}
                                {mission.brand_identity.brand_voice && <p><span className="font-semibold">Voice:</span> {mission.brand_identity.brand_voice}</p>}
                                {mission.brand_identity.positioning && <p><span className="font-semibold">Positioning:</span> {mission.brand_identity.positioning}</p>}
                              </div>
                            </div>
                          )}
                          {mission.target_audience && (
                            <div>
                              <label className="block font-semibold text-gray-700 mb-1">Target Audience</label>
                              <div className="bg-white p-3 rounded border border-gray-200 space-y-1.5 text-xs text-gray-700">
                                {mission.target_audience.primary_demographic && <p><span className="font-semibold">Primary:</span> {mission.target_audience.primary_demographic}</p>}
                                {mission.target_audience.secondary_demographic && <p><span className="font-semibold">Secondary:</span> {mission.target_audience.secondary_demographic}</p>}
                                {mission.target_audience.core_desires && <p><span className="font-semibold">Core Desires:</span> {mission.target_audience.core_desires}</p>}
                                {(mission.target_audience.key_objections_and_mitigations ?? []).length > 0 && (
                                  <div className="pt-1">
                                    <p className="font-semibold mb-1">Objections & Mitigations</p>
                                    <div className="space-y-1.5">
                                      {(mission.target_audience.key_objections_and_mitigations ?? []).map((item, i) => (
                                        <div key={i} className="pl-2 border-l-2 border-blue-200">
                                          <p className="text-gray-500 italic">"{item.objection}"</p>
                                          <p>→ {item.mitigation}</p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          {(mission.strategic_objectives ?? []).length > 0 && (
                            <div>
                              <label className="block font-semibold text-gray-700 mb-1">Strategic Objectives</label>
                              <div className="space-y-1">
                                {(mission.strategic_objectives ?? []).map((obj, i) => (
                                  <div key={i} className="bg-white p-2 rounded border border-gray-200 text-xs text-gray-700">
                                    <p className="font-semibold">{obj.goal}</p>
                                    <p className="text-gray-600">{obj.target}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {mission.marketing_channels_and_tactics && (
                            <div>
                              <label className="block font-semibold text-gray-700 mb-1">Marketing Channels</label>
                              <div className="space-y-1">
                                {Object.entries(mission.marketing_channels_and_tactics).map(([key, val]) => (
                                  <div key={key} className="bg-white p-2 rounded border border-gray-200 text-xs text-gray-700">
                                    <p className="font-semibold capitalize">{key.replace(/_/g, ' ')}</p>
                                    <p><span className="text-gray-500">Strategy:</span> {val.strategy}</p>
                                    <p><span className="text-gray-500">Execution:</span> {val.execution}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {mission.team_and_operations && (
                            <div>
                              <label className="block font-semibold text-gray-700 mb-1">Team & Operations</label>
                              <div className="bg-white p-3 rounded border border-gray-200 space-y-1 text-xs text-gray-700">
                                {mission.team_and_operations.structure && <p><span className="font-semibold">Structure:</span> {mission.team_and_operations.structure}</p>}
                                {mission.team_and_operations.workflow && <p><span className="font-semibold">Workflow:</span> {mission.team_and_operations.workflow}</p>}
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        // ── Original 5-pillar format ─────────────────────────
                        <>
                          {mission.primaryMarketingAim && (
                            <div>
                              <label className="block font-semibold text-gray-700 mb-2">Primary Marketing Aim</label>
                              <p className="text-gray-700 bg-white p-3 rounded border border-gray-200 text-xs leading-relaxed">{mission.primaryMarketingAim}</p>
                            </div>
                          )}
                          {mission.marketingMix && (
                            <div>
                              <label className="block font-semibold text-gray-700 mb-2">Marketing Mix</label>
                              <div className="bg-white p-3 rounded border border-gray-200 space-y-2 text-gray-700">
                                <p><span className="font-semibold">{mission.marketingMix.brandBuildingPercent}%</span> Brand Building</p>
                                <p><span className="font-semibold">{mission.marketingMix.salesActivationPercent}%</span> Sales Activation</p>
                                <p className="text-xs text-gray-600 italic">{mission.marketingMix.reasoning}</p>
                              </div>
                            </div>
                          )}
                          {mission.qualityCreativeStandards && (
                            <div>
                              <label className="block font-semibold text-gray-700 mb-2">Quality Standards</label>
                              <div className="bg-white p-3 rounded border border-gray-200 space-y-1 text-gray-700 text-xs">
                                <p><span className="font-semibold">Visual Tone:</span> {mission.qualityCreativeStandards.visualTone}</p>
                                <p><span className="font-semibold">Copy Tone:</span> {mission.qualityCreativeStandards.copywritingTone}</p>
                                <p><span className="font-semibold">Emotional:</span> {mission.qualityCreativeStandards.emotionalResonance}</p>
                              </div>
                            </div>
                          )}
                          {mission.channelDiversity && (
                            <div>
                              <label className="block font-semibold text-gray-700 mb-2">Channel Strategy</label>
                              <div className="bg-white p-3 rounded border border-gray-200 space-y-1 text-gray-700 text-xs">
                                <p><span className="font-semibold">Top-of-Funnel:</span> {mission.channelDiversity.topOfFunnelStrategy}</p>
                                <p><span className="font-semibold">Bottom-of-Funnel:</span> {mission.channelDiversity.bottomOfFunnelStrategy}</p>
                              </div>
                            </div>
                          )}
                          {(mission.nextStepsQuestions ?? []).length > 0 && (
                            <div>
                              <label className="block font-semibold text-gray-700 mb-2">Next Steps</label>
                              <ul className="bg-white p-3 rounded border border-gray-200 space-y-1 text-gray-700 text-xs list-disc list-inside">
                                {(mission.nextStepsQuestions ?? []).map((q: string, i: number) => (
                                  <li key={i} className="text-gray-600">{q}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="text-center text-gray-500 text-sm py-8">
                      <p>💬 Start chatting with the CMO</p>
                      <p className="text-xs mt-2">Ask them to generate your marketing mission</p>
                    </div>
                  )}
                </div>

                {/* Save button */}
                {savingMessage && (
                  <div className={`px-6 py-2 border-t ${savingMessage.includes('✅') ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'} text-sm`}>
                    {savingMessage}
                  </div>
                )}
                <div className="px-6 py-4 border-t border-gray-200 bg-white shrink-0">
                  <button
                    onClick={saveMissionToSheet}
                    disabled={!mission || missionLoading || missionSaving}
                    className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
                  >
                    {missionSaving ? 'Saving…' : '💾 Save Mission'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Prompt Preview Modal */}
      {mmPreviewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={e => { if (e.target === e.currentTarget) setMmPreviewOpen(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-sm font-bold text-gray-800">Full Prompt Preview</h3>
                <p className="text-xs text-gray-500 mt-0.5">This is exactly what will be sent to the CMO AI</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(mmPreviewText);
                    setMmCopied(true);
                    setTimeout(() => setMmCopied(false), 2000);
                  }}
                  className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg font-semibold text-gray-600 transition-colors"
                >
                  {mmCopied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={() => setMmPreviewOpen(false)}
                  className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg font-semibold text-gray-600 transition-colors"
                >Close</button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">{mmPreviewText}</pre>
              {mmPreviewAttachments.length > 0 && (
                <div className="mt-5 pt-4 border-t border-gray-200">
                  <p className="text-xs font-bold text-gray-600 mb-2">📎 Data Attachments</p>
                  <div className="flex flex-col gap-1.5">
                    {mmPreviewAttachments.map(att => (
                      <div key={att.filename} className="flex items-center gap-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          att.mode === 'empty'
                            ? 'bg-gray-100 text-gray-600 border border-gray-200'
                            : att.mode === 'file'
                            ? 'bg-orange-50 text-orange-700 border border-orange-200'
                            : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}>
                          {att.mode === 'empty' ? '∅ Empty' : att.mode === 'file' ? '☁️ File API' : '📝 Inline'}
                        </span>
                        <span className="text-xs text-gray-700 font-medium">{att.label}</span>
                        <span className="text-xs text-gray-400">{att.rowCount.toLocaleString()} rows</span>
                        <button
                          onClick={() => {
                            const blob = new Blob([att.csvContent], { type: 'text/csv' });
                            const url  = URL.createObjectURL(blob);
                            const a    = document.createElement('a');
                            a.href     = url;
                            a.download = att.filename;
                            a.click();
                            setTimeout(() => URL.revokeObjectURL(url), 5000);
                          }}
                          className="text-xs text-purple-600 hover:text-purple-800 hover:underline font-medium"
                        >
                          ↓ {att.filename}
                        </button>
                        <button
                          onClick={() => {
                            const blob = new Blob([att.csvContent], { type: 'text/csv' });
                            const url  = URL.createObjectURL(blob);
                            window.open(url, '_blank');
                            setTimeout(() => URL.revokeObjectURL(url), 10000);
                          }}
                          className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
                        >
                          View ↗
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sync Ads Data View ────────────────────────────────────────────────────────
// ── Marketing tab definitions ──────────────────────────────────────────────────
const MARKETING_TABS = [
  // Google Ads
  { key: 'GAds_Campaigns',    source: 'google-ads', label: 'Campaigns',          desc: 'Budget, channel, bidding, ROAS & impression share' },
  { key: 'GAds_AdGroups',     source: 'google-ads', label: 'Ad Groups',          desc: 'Per-group performance and target CPA/ROAS' },
  { key: 'GAds_Keywords',     source: 'google-ads', label: 'Keywords',           desc: 'Quality score, match type, spend & conversions' },
  { key: 'GAds_SearchTerms',  source: 'google-ads', label: 'Search Terms',       desc: 'Actual user queries — for negative keyword mining' },
  { key: 'GAds_Ads',          source: 'google-ads', label: 'Ads',                desc: 'Creative text, ad strength & approval status' },
  { key: 'GAds_Assets',       source: 'google-ads', label: 'RSA Assets',         desc: 'Individual headline/description ratings (BEST/GOOD/LOW)' },
  { key: 'GAds_Shopping',     source: 'google-ads', label: 'Shopping',           desc: 'Per-product ad performance (cross-ref with inventory)' },
  { key: 'GAds_WeeklyTrend',  source: 'google-ads', label: 'Weekly Trend',       desc: 'Campaign metrics by ISO week — seasonality & trend' },
  { key: 'GAds_Daypart',      source: 'google-ads', label: 'Dayparting',         desc: 'Performance by hour & day of week' },
  { key: 'GAds_ByDevice',     source: 'google-ads', label: 'By Device',          desc: 'Mobile / desktop / tablet split — bid modifier decisions' },
  { key: 'GAds_ByGeo',        source: 'google-ads', label: 'By Geography',       desc: 'Country / region / city spend & ROAS' },
  { key: 'GAds_Audiences',    source: 'google-ads', label: 'Audiences',          desc: 'Remarketing & in-market audience performance' },
  { key: 'GAds_ConvActions',  source: 'google-ads', label: 'Conversion Actions', desc: 'Which conversion events fired and their values' },
  { key: 'GAds_Competitors',  source: 'google-ads', label: 'Competitors',        desc: 'Auction insights: impression share, overlap, outranking' },
  { key: 'GAds_LandingPages', source: 'google-ads', label: 'Landing Pages',      desc: 'Per-URL performance — diagnose quality score issues' },
  { key: 'GAds_YearlyTrend',  source: 'google-ads', label: 'Yearly Trend',       desc: '12 months of monthly campaign data — spot seasonal peaks & valleys' },
  { key: 'GAds_YoY',          source: 'google-ads', label: 'Year-on-Year',       desc: 'Same 90-day window one year ago — measure growth or decline' },
  // Meta Ads
  { key: 'Meta_Campaigns',    source: 'meta',       label: 'Campaigns',          desc: 'Meta campaign-level performance — spend, ROAS, reach' },
  { key: 'Meta_AdSets',       source: 'meta',       label: 'Ad Sets',            desc: 'Meta ad set targeting, budget & delivery' },
  { key: 'Meta_Ads',          source: 'meta',       label: 'Ads',                desc: 'Meta ad creative performance including video metrics' },
  { key: 'Meta_Placements',   source: 'meta',       label: 'Placements',         desc: 'Feed vs Reels vs Stories — identify creative fatigue by placement' },
  { key: 'Meta_Demographics', source: 'meta',       label: 'Demographics',       desc: 'Age & gender breakdown — guide creative targeting decisions' },
  // GA4
  { key: 'GA4_Channels',      source: 'ga4',        label: 'Channels',           desc: 'Session & revenue by channel / source / medium' },
  { key: 'GA4_LandingPages',  source: 'ga4',        label: 'Landing Pages',      desc: 'Entry page performance — engagement & conversions' },
  { key: 'GA4_Ecommerce',     source: 'ga4',        label: 'E-commerce',         desc: 'Product revenue, views-to-cart, purchase rates' },
  { key: 'GA4_Devices',       source: 'ga4',        label: 'Devices',            desc: 'Session breakdown by device, OS & browser' },
  { key: 'GA4_Geography',     source: 'ga4',        label: 'Geography',          desc: 'Sessions & revenue by country / region / city' },
  { key: 'GA4_YearlyChannels',source: 'ga4',        label: 'Yearly Channels',    desc: '12 months of monthly channel revenue — seasonal trend for each channel' },
  // Klaviyo
  { key: 'Klaviyo_Campaigns',  source: 'klaviyo',    label: 'Campaigns',          desc: 'Email campaign status, send times and send counts' },
  { key: 'Klaviyo_Flows',      source: 'klaviyo',    label: 'Flows',              desc: 'Automation flow status and trigger types' },
  { key: 'Klaviyo_Lists',      source: 'klaviyo',    label: 'Lists',              desc: 'Subscriber lists and their sizes' },
];

const SOURCE_OPTIONS = [
  { key: 'google-ads', label: 'Google Ads', icon: '🔵' },
  { key: 'meta',       label: 'Meta Ads',   icon: '🔷' },
  { key: 'ga4',        label: 'Analytics',  icon: '📈' },
  { key: 'klaviyo',    label: 'Klaviyo',    icon: '🟣' },
];

type TabStatus = { status: 'pending' | 'syncing' | 'done' | 'error'; rows?: number; error?: string };

function SyncAdsView({ databaseId }: { databaseId: string }) {
  const [sources, setSources] = useState<Set<string>>(new Set(['google-ads', 'meta', 'ga4']));
  const [syncing, setSyncing] = useState(false);
  const [tabState, setTabState] = useState<Record<string, TabStatus>>({});
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState('');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<{ label: string; error: string } | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('marketoir_last_sync_marketing');
    if (stored) setLastSync(stored);
  }, []);

  const toggleSource = (key: string) => {
    setSources(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleSync = async () => {
    if (!databaseId) { setGlobalError('No business selected.'); return; }
    if (!sources.size) { setGlobalError('Select at least one source.'); return; }

    setSyncing(true);
    setGlobalError('');
    setSpreadsheetUrl(null);

    // Prime all selected tabs to 'pending'
    const initial: Record<string, TabStatus> = {};
    for (const t of MARKETING_TABS) {
      if (sources.has(t.source)) initial[t.key] = { status: 'pending' };
    }
    setTabState(initial);

    try {
      const res = await fetch('/api/sync/marketing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, sources: Array.from(sources) }),
      });

      if (!res.body) throw new Error('No stream returned');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.tab) {
              setTabState(prev => ({
                ...prev,
                [evt.tab]: {
                  status: evt.status === 'start' ? 'syncing' : evt.status === 'done' ? 'done' : 'error',
                  rows: evt.rows,
                  error: evt.error,
                },
              }));
            }
            if (evt.status === 'complete') {
              const now = new Date().toLocaleString();
              setLastSync(now);
              localStorage.setItem('marketoir_last_sync_marketing', now);
              if (evt.spreadsheetUrl) setSpreadsheetUrl(evt.spreadsheetUrl);
            }
            if (evt.status === 'error' && !evt.tab) {
              setGlobalError(evt.error ?? 'Unknown error');
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (e: any) {
      setGlobalError(e.message);
    }
    setSyncing(false);
  };

  const visibleTabs = MARKETING_TABS.filter(t => sources.has(t.source));

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-xl">📊</div>
          <div>
            <h2 className="font-bold text-gray-800 text-lg leading-tight">Sync Marketing Data</h2>
            <p className="text-xs text-gray-500">Last sync: {lastSync ?? 'Never'}</p>
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing || !sources.size}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shrink-0"
        >
          {syncing ? 'Syncing…' : 'Sync Now'}
        </button>
      </div>

      <p className="text-sm font-semibold text-gray-700 mb-2">Data sources to sync</p>

      {/* Source selection */}
      <div className="flex gap-2 mb-5">
        {SOURCE_OPTIONS.map(s => (
          <button
            key={s.key}
            onClick={() => !syncing && toggleSource(s.key)}
            disabled={syncing}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
              sources.has(s.key)
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-500 border-gray-300 hover:border-blue-400'
            }`}
          >
            <span>{s.icon}</span> {s.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-500 mb-4">
        Pulls the last <strong>90 days</strong> of data from selected platforms into your Marketing Data spreadsheet.
      </p>

      {/* Tab progress list */}
      {visibleTabs.length > 0 && (
        <div className="space-y-1.5 mb-5">
          {visibleTabs.map(tab => {
            const ts = tabState[tab.key];
            return (
              <div key={tab.key} className="flex items-center justify-between gap-3 p-2.5 bg-gray-50 rounded-lg border border-gray-100">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-700 truncate">
                    <span className="text-gray-400 text-xs mr-1.5">{SOURCE_OPTIONS.find(s=>s.key===tab.source)?.icon}</span>
                    {tab.label}
                  </p>
                  <p className="text-xs text-gray-400 truncate">{tab.desc}</p>
                </div>
                <div className="shrink-0">
                  {!ts && <span className="text-xs text-gray-300">—</span>}
                  {ts?.status === 'pending' && <span className="text-xs text-gray-400">Pending…</span>}
                  {ts?.status === 'syncing' && (
                    <span className="flex items-center gap-1 text-xs text-blue-500">
                      <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                      </svg>
                      Syncing
                    </span>
                  )}
                  {ts?.status === 'done' && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                      ✓ {ts.rows} rows
                    </span>
                  )}
                  {ts?.status === 'error' && (
                    <button
                      onClick={() => setErrorModal({ label: tab.label, error: ts.error ?? 'Unknown error' })}
                      className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600 hover:bg-red-200 transition-colors cursor-pointer"
                    >
                      ✕ Error
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {spreadsheetUrl && (
        <a href={spreadsheetUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-600 hover:text-green-700 underline mb-2">
          📄 Open Marketing Spreadsheet
        </a>
      )}
      {globalError && <p className="text-sm text-red-600 mt-2">❌ {globalError}</p>}

      {/* Error detail modal */}
      {errorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setErrorModal(null)}>
          <div className="bg-white rounded-xl shadow-xl p-5 max-w-lg w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-800 text-sm">Error — {errorModal.label}</h3>
              <button onClick={() => setErrorModal(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>
            <pre className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 whitespace-pre-wrap break-all max-h-64 overflow-y-auto font-mono">
              {errorModal.error}
            </pre>
            <button
              onClick={() => navigator.clipboard.writeText(errorModal.error)}
              className="mt-3 px-3 py-1.5 text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
            >
              Copy to clipboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shopify Product Listings (Website) ────────────────────────────────────────
interface ShopifyProduct {
  id: number;
  variantId: number;
  handle: string;
  title: string;
  status: 'active' | 'draft' | 'archived';
  product_type: string;
  vendor: string;
  tags: string;
  description_html: string;
  price: string;
  compare_at_price: string;
  sku: string;
  barcode: string;
  inventory_qty: number;
  image_url: string;
  variant_count: number;
  image_count: number;
  published_at: string;
  updated_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  active:   'bg-green-100 text-green-700',
  draft:    'bg-yellow-100 text-yellow-700',
  archived: 'bg-gray-100 text-gray-500',
};

const ShopifyProductsView = forwardRef<WebsiteSyncHandle, {
  databaseId: string;
  inStockOnly: boolean;
}>(function ShopifyProductsView({
  databaseId,
  inStockOnly,
}, ref) {
  const [syncing, setSyncing]       = useState(false);
  const [products, setProducts]     = useState<ShopifyProduct[] | null>(null);
  const [totalFetched, setTotalFetched] = useState<number | null>(null);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string | null>(null);
  const [error, setError]           = useState('');
  const [lastSync, setLastSync]     = useState<string | null>(null);
  const [filter, setFilter]         = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editingId, setEditingId]   = useState<number | null>(null);
  const [editDraft, setEditDraft]   = useState<Partial<ShopifyProduct>>({});
  const [saving, setSaving]         = useState(false);
  const [saveMsgs, setSaveMsgs]     = useState<Record<number, string>>({});

  useEffect(() => {
    const s = localStorage.getItem('marketoir_last_sync_shopify');
    if (s) setLastSync(s);
  }, []);

  const handleSync = async (): Promise<WebsiteSyncResult> => {
    if (!databaseId) {
      const message = 'No business selected.';
      setError(message);
      return { success: false, error: message };
    }

    setSyncing(true);
    setError('');
    try {
      const res = await fetch('/api/sync/shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, inStockOnly }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'Unknown error');
      setProducts(data.products);
      setTotalFetched(data.totalFetched ?? data.products.length);
      setSpreadsheetUrl(data.spreadsheetUrl ?? null);
      const now = new Date().toLocaleString();
      setLastSync(now);
      localStorage.setItem('marketoir_last_sync_shopify', now);
      return {
        success: true,
        lastSync: now,
        spreadsheetUrl: data.spreadsheetUrl ?? null,
        count: data.products.length,
        totalFetched: data.totalFetched ?? data.products.length,
      };
    } catch (e: any) {
      const message = e.message;
      setError(message);
      return { success: false, error: message };
    } finally {
      setSyncing(false);
    }
  };

  useImperativeHandle(ref, () => ({
    sync: handleSync,
  }), [databaseId, inStockOnly]);

  const startEdit = (p: ShopifyProduct) => {
    setEditingId(p.id);
    setEditDraft({
      title: p.title, product_type: p.product_type, vendor: p.vendor,
      tags: p.tags, status: p.status, description_html: p.description_html,
      price: p.price, compare_at_price: p.compare_at_price,
    });
  };

  const cancelEdit = () => { setEditingId(null); setEditDraft({}); };

  const saveEdit = async (p: ShopifyProduct) => {
    setSaving(true);
    setSaveMsgs(m => ({ ...m, [p.id]: '' }));
    try {
      const productUpdates: Record<string, string> = {};
      const variantUpdates: Record<string, string> = {};
      if (editDraft.title !== p.title)                   productUpdates.title         = editDraft.title!;
      if (editDraft.product_type !== p.product_type)     productUpdates.product_type  = editDraft.product_type!;
      if (editDraft.vendor !== p.vendor)                 productUpdates.vendor        = editDraft.vendor!;
      if (editDraft.tags !== p.tags)                     productUpdates.tags          = editDraft.tags!;
      if (editDraft.status !== p.status)                 productUpdates.status        = editDraft.status!;
      if (editDraft.description_html !== p.description_html) productUpdates.body_html = editDraft.description_html!;
      if (editDraft.price !== p.price)                   variantUpdates.price         = editDraft.price!;
      if (editDraft.compare_at_price !== p.compare_at_price) variantUpdates.compare_at_price = editDraft.compare_at_price ?? '';

      const res = await fetch('/api/website/update-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, productId: p.id, variantId: p.variantId, productUpdates, variantUpdates }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'Unknown error');

      // Reflect changes locally
      setProducts(prev => prev?.map(pr => pr.id !== p.id ? pr : {
        ...pr, ...editDraft,
        description_html: editDraft.description_html ?? pr.description_html,
        status: (editDraft.status ?? pr.status) as ShopifyProduct['status'],
      }) ?? null);
      setSaveMsgs(m => ({ ...m, [p.id]: '✅ Saved' }));
      setEditingId(null);
    } catch (e: any) {
      setSaveMsgs(m => ({ ...m, [p.id]: `❌ ${e.message}` }));
    }
    setSaving(false);
  };

  const filtered = products?.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    const q = filter.toLowerCase();
    return !q || p.title.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) ||
      p.vendor.toLowerCase().includes(q) || p.product_type.toLowerCase().includes(q) ||
      p.tags.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q);
  }) ?? [];

  if (!products && !syncing && !error) {
    return null;
  }

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        {syncing && (
          <div className="text-center py-14 text-gray-400">
            <p className="text-sm">Fetching products from Shopify…</p>
            <p className="text-xs mt-1">Large catalogues may take 20–30 seconds</p>
          </div>
        )}

        {error && <p className="text-sm text-red-600 mb-4">❌ {error}</p>}

        {products && !syncing && (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-300"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
            <input
              type="text"
              placeholder="Filter by title, SKU, vendor, type, tags…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 flex-1 min-w-52 focus:outline-none focus:ring-2 focus:ring-emerald-300"
            />
            <span className="text-xs text-gray-400 shrink-0">{filtered.length} of {products.length}</span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-500 uppercase text-left">
                  <th className="px-2 py-2 w-10 border-b border-gray-200"></th>
                  <th className="px-3 py-2 font-semibold border-b border-gray-200">Title / URL</th>
                  <th className="px-3 py-2 font-semibold border-b border-gray-200">Type / Vendor</th>
                  <th className="px-3 py-2 font-semibold border-b border-gray-200">SKU</th>
                  <th className="px-3 py-2 font-semibold border-b border-gray-200 text-right">Price</th>
                  <th className="px-3 py-2 font-semibold border-b border-gray-200 text-right">Stock</th>
                  <th className="px-3 py-2 font-semibold border-b border-gray-200">Status</th>
                  <th className="px-3 py-2 font-semibold border-b border-gray-200 w-28"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <Fragment key={p.id}>
                    {/* Product row */}
                    <tr className={`border-b border-gray-100 hover:bg-emerald-50/40 transition-colors ${editingId === p.id ? 'bg-emerald-50/60' : ''}`}>
                      <td className="px-2 py-2">
                        {p.image_url
                          ? <img src={p.image_url} alt="" className="w-8 h-8 object-cover rounded" />
                          : <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center text-gray-300 text-base">📷</div>
                        }
                      </td>
                      <td className="px-3 py-2 max-w-xs">
                        <p className="font-medium text-gray-800 truncate">{p.title}</p>
                        <p className="text-gray-400 font-mono truncate">{p.handle}</p>
                      </td>
                      <td className="px-3 py-2">
                        <p className="text-gray-700">{p.product_type || <span className="text-gray-300">—</span>}</p>
                        <p className="text-gray-400">{p.vendor}</p>
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-600">{p.sku || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <p className="font-semibold text-gray-800">${p.price}</p>
                        {p.compare_at_price && <p className="text-gray-400 line-through">${p.compare_at_price}</p>}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-700">{p.inventory_qty}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[p.status] ?? 'bg-gray-100 text-gray-500'}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 justify-end">
                          {saveMsgs[p.id] && <span className="text-xs">{saveMsgs[p.id]}</span>}
                          <button
                            onClick={() => editingId === p.id ? cancelEdit() : startEdit(p)}
                            className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                              editingId === p.id
                                ? 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                                : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                            }`}
                          >
                            {editingId === p.id ? 'Cancel' : 'Edit'}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Inline edit panel */}
                    {editingId === p.id && (
                      <tr>
                        <td colSpan={8} className="bg-emerald-50/70 border-b border-emerald-200 px-5 py-4">
                          <div className="grid grid-cols-2 gap-4 mb-3">
                            <div>
                              <label className="block text-xs font-semibold text-gray-600 mb-1">Title</label>
                              <input type="text" value={editDraft.title ?? ''}
                                onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">Product Type</label>
                                <input type="text" value={editDraft.product_type ?? ''}
                                  onChange={e => setEditDraft(d => ({ ...d, product_type: e.target.value }))}
                                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">Vendor</label>
                                <input type="text" value={editDraft.vendor ?? ''}
                                  onChange={e => setEditDraft(d => ({ ...d, vendor: e.target.value }))}
                                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4 mb-3">
                            <div>
                              <label className="block text-xs font-semibold text-gray-600 mb-1">Tags (comma-separated)</label>
                              <input type="text" value={editDraft.tags ?? ''}
                                onChange={e => setEditDraft(d => ({ ...d, tags: e.target.value }))}
                                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                              <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">Status</label>
                                <select value={editDraft.status ?? 'active'}
                                  onChange={e => setEditDraft(d => ({ ...d, status: e.target.value as ShopifyProduct['status'] }))}
                                  className="w-full text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-300">
                                  <option value="active">Active</option>
                                  <option value="draft">Draft</option>
                                  <option value="archived">Archived</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">Price ($)</label>
                                <input type="text" value={editDraft.price ?? ''}
                                  onChange={e => setEditDraft(d => ({ ...d, price: e.target.value }))}
                                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-gray-600 mb-1">Compare At ($)</label>
                                <input type="text" value={editDraft.compare_at_price ?? ''}
                                  onChange={e => setEditDraft(d => ({ ...d, compare_at_price: e.target.value }))}
                                  placeholder="Leave blank to clear"
                                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                              </div>
                            </div>
                          </div>

                          <div className="mb-4">
                            <label className="block text-xs font-semibold text-gray-600 mb-1">
                              Description <span className="font-normal text-gray-400">(HTML accepted)</span>
                            </label>
                            <textarea rows={5} value={editDraft.description_html ?? ''}
                              onChange={e => setEditDraft(d => ({ ...d, description_html: e.target.value }))}
                              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                          </div>

                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => saveEdit(p)}
                              disabled={saving}
                              className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                            >
                              {saving ? 'Saving…' : 'Save to Shopify'}
                            </button>
                            <button onClick={cancelEdit}
                              className="px-4 py-2 text-sm font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                              Cancel
                            </button>
                            {saveMsgs[p.id] && <span className="text-xs">{saveMsgs[p.id]}</span>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>

            {filtered.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-8">
                {filter || statusFilter !== 'all' ? 'No products match your filters.' : 'No products found.'}
              </p>
            )}
          </div>
        </>
      )}
      </div>
    </div>
  );
});

// ── Home overview ────────────────────────────────────────────────────────────
function HomeView({
  setupComplete, setSetupComplete,
  connectionsDone, setConnectionsDone,
  businessInfoDone, setBusinessInfoDone,
  databaseId,
}: any) {
  // ── Top 10 brands (90d sales bar chart) ───────────────────────────────────
  const [brandChartData, setBrandChartData] = useState<{ name: string; sales90: number }[]>([]);
  const [brandChartLoading, setBrandChartLoading] = useState(false);

  useEffect(() => {
    if (!databaseId) return;
    setBrandChartLoading(true);
    fetch(`/api/calculated/brand-summary?databaseId=${encodeURIComponent(databaseId)}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && Array.isArray(d.brands)) {
          const top10 = [...d.brands]
            .sort((a: any, b: any) => b.sales90 - a.sales90)
            .slice(0, 10)
            .map((b: any) => ({ name: b.name, sales90: b.sales90 }));
          setBrandChartData(top10);
        }
      })
      .catch(() => {})
      .finally(() => setBrandChartLoading(false));
  }, [databaseId]);

  // ── Top 10 sellers this week ───────────────────────────────────────────────
  const [topSellers, setTopSellers] = useState<{ name: string; code: string; brand: string; rev: number }[]>([]);
  const [topSellersLoading, setTopSellersLoading] = useState(false);
  const [topSellersRevLabel, setTopSellersRevLabel] = useState('7d');

  useEffect(() => {
    if (!databaseId) return;
    setTopSellersLoading(true);
    fetch(`/api/calculated/top-sellers?databaseId=${encodeURIComponent(databaseId)}&limit=10`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setTopSellers(d.products ?? []);
          setTopSellersRevLabel(d.revLabel ?? '7d');
        }
      })
      .catch(() => {})
      .finally(() => setTopSellersLoading(false));
  }, [databaseId]);

  // Bar chart max for scaling
  const brandMax = brandChartData.reduce((m, b) => Math.max(m, b.sales90), 0);

  // Interpolate indigo from dark (#4338ca) to light (#e0e7ff) across all bars
  const barColor = (i: number, total: number) => {
    const t = total <= 1 ? 0 : i / (total - 1);
    const r = Math.round(67  + t * (224 - 67));
    const g = Math.round(56  + t * (231 - 56));
    const b = Math.round(202 + t * (255 - 202));
    return `rgb(${r},${g},${b})`;
  };

  return (
    <>
      {!setupComplete && (
        <div className="bg-white shadow-sm rounded-xl p-6 mb-6 setup-todo-panel">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-800">Set up to-do</h2>
              <p className="text-sm text-gray-500 mt-0.5">Complete these steps to fully activate your workspace.</p>
            </div>
            <button onClick={() => setSetupComplete(true)} className="text-xs px-3 py-1 font-semibold text-gray-500 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded transition-colors">
              Dismiss
            </button>
          </div>
          <ul className="space-y-3">
            <li className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${connectionsDone ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-100'}`}>
              <div onClick={() => setConnectionsDone((p: boolean) => !p)} className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center font-bold cursor-pointer">
                {connectionsDone ? <span className="bg-green-500 text-white w-full h-full rounded-full flex items-center justify-center text-sm">✓</span> : <span className="bg-blue-100 text-blue-700 w-full h-full rounded-full flex items-center justify-center text-sm">1</span>}
              </div>
              <Link href={connectionsDone ? '#' : '/setup?tab=connections'} className={`font-semibold ${connectionsDone ? 'text-green-700 line-through opacity-70' : 'text-blue-600 hover:underline'}`}>
                Set up Connections
              </Link>
            </li>
            <li className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${businessInfoDone ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-100'}`}>
              <div onClick={() => setBusinessInfoDone((p: boolean) => !p)} className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center font-bold cursor-pointer">
                {businessInfoDone ? <span className="bg-green-500 text-white w-full h-full rounded-full flex items-center justify-center text-sm">✓</span> : <span className="bg-blue-100 text-blue-700 w-full h-full rounded-full flex items-center justify-center text-sm">2</span>}
              </div>
              <Link href={businessInfoDone ? '#' : '/setup?tab=business'} className={`font-semibold ${businessInfoDone ? 'text-green-700 line-through opacity-70 pointer-events-none' : 'text-blue-600 hover:underline'}`}>
                Enter Business Key Information
              </Link>
            </li>
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Top 10 Brands – 90d Sales Bar Chart */}
        <div className="bg-white shadow-sm rounded-xl p-6 border border-gray-200">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-lg">🏆</div>
            <div>
              <h3 className="font-bold text-gray-800 text-sm leading-tight">Top 10 Brands</h3>
              <p className="text-xs text-gray-400">Last 90 days sales</p>
            </div>
          </div>
          {brandChartLoading && <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>}
          {!brandChartLoading && brandChartData.length === 0 && (
            <p className="text-sm text-gray-400 py-8 text-center">No brand data yet. Sync your products first.</p>
          )}
          {!brandChartLoading && brandChartData.length > 0 && (
            <div className="space-y-3">
              {brandChartData.map((b, i) => {
                const pct = brandMax > 0 ? (b.sales90 / brandMax) * 100 : 0;
                return (
                  <div key={b.name}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-medium text-gray-700 truncate max-w-[60%]">{b.name}</span>
                      <span className="text-xs text-gray-500 font-mono">
                        ${b.sales90.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="h-5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: barColor(i, brandChartData.length) }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top 10 Sellers This Week */}
        <div className="bg-white shadow-sm rounded-xl p-6 border border-gray-200">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center text-lg">🔥</div>
            <div>
              <h3 className="font-bold text-gray-800 text-sm leading-tight">Top Sellers This Week</h3>
              <p className="text-xs text-gray-400">Last {topSellersRevLabel} by revenue</p>
            </div>
          </div>
          {topSellersLoading && <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>}
          {!topSellersLoading && topSellers.length === 0 && (
            <p className="text-sm text-gray-400 py-8 text-center">No sales data yet. Sync your products first.</p>
          )}
          {!topSellersLoading && topSellers.length > 0 && (
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-1.5 pr-2 font-semibold text-gray-500">#</th>
                    <th className="text-left py-1.5 pr-2 font-semibold text-gray-500">Product</th>
                    <th className="text-right py-1.5 font-semibold text-gray-500">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topSellers.map((p, i) => (
                    <tr key={p.code || i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-1.5 pr-2 text-gray-400 font-mono">{i + 1}</td>
                      <td className="py-1.5 pr-2">
                        <div className="font-medium text-gray-800 truncate max-w-[180px]">{p.name || p.code}</div>
                        {p.brand && <div className="text-gray-400 truncate max-w-[180px]">{p.brand}</div>}
                      </td>
                      <td className="py-1.5 text-right font-mono text-gray-700">
                        ${p.rev.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </>
  );
}

// ── Product Description Template View ───────────────────────────────────────

/** Strip HTML tags from a string */
function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
}

/** Render a string that may contain **bold** markdown into React spans */
function MarkdownText({ text }: { text: string }) {
  const cleaned = stripHtml(text);
  const parts = cleaned.split(/\*\*(.+?)\*\*/g);
  return (
    <span>
      {parts.map((p, i) => i % 2 === 1 ? <strong key={i}>{p}</strong> : p)}
    </span>
  );
}

interface TemplateField {
  name: string;
  label: string;
  description: string;
  format: string;
  maxLength?: number;
  count?: number;
  example: string | string[];
}

interface ProductDescriptionTemplate {
  toneGuide: string;
  writingRules: string[];
  fields: TemplateField[];
  exampleProduct: { name: string; [key: string]: string | string[] };
  headingTag?: string;    // e.g. 'h2' | 'h3' | 'h4'
  headingColour?: string; // e.g. '#0F3A50'
  bulletChar?: string;    // e.g. '✓' | '✅' | '•' — leave blank for AI default
  bulletColour?: string;  // e.g. '#E63946' — colour for the bullet character
}

function ProductDescriptionView({ databaseId }: { databaseId: string }) {
  const [template, setTemplate] = useState<ProductDescriptionTemplate | null>(null);
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [refineComments, setRefineComments] = useState('');
  const [showRefine, setShowRefine] = useState(false);
  const [brandName, setBrandName] = useState('');
  const [colours, setColours] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [mockupGenerating, setMockupGenerating] = useState(false);

  // Load saved template + brand info on mount
  useEffect(() => {
    if (!databaseId) return;
    fetch(`/api/user/product-schema?databaseId=${encodeURIComponent(databaseId)}`)
      .then(r => r.ok ? r.json() : {})
      .then((d: any) => { if (d.description) setTemplate(d.description); })
      .catch(() => {});
    fetch(`/api/user/business-info?databaseId=${encodeURIComponent(databaseId)}`)
      .then(r => r.ok ? r.json() : {})
      .then((d: any) => { if (d.brandName) setBrandName(d.brandName); })
      .catch(() => {});
    fetch(`/api/user/brand-profile?databaseId=${encodeURIComponent(databaseId)}`)
      .then(r => r.ok ? r.json() : {})
      .then((d: any) => {
        if (d.brandColours) {
          try {
            const parsed = JSON.parse(d.brandColours);
            if (typeof parsed === 'object' && !Array.isArray(parsed)) setColours(parsed);
          } catch { /* no colours */ }
        }
      })
      .catch(() => {});
  }, [databaseId]);

  const applyResult = (data: { template?: ProductDescriptionTemplate; error?: string }) => {
    if (data.template) {
      setTemplate(data.template);
      setSuccess('');
      setError('');
    } else {
      setError(data.error || 'Unexpected response from AI.');
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/ai/build-product-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId }),
      });
      applyResult(await res.json());
    } catch { setError('Failed to generate template.'); }
    finally { setGenerating(false); }
  };

  const handleRefine = async () => {
    if (!refineComments.trim() || !template) return;
    setRefining(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/ai/build-product-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, brandName, mode: 'refine', existingSchema: template, userComments: refineComments }),
      });
      const data = await res.json();
      applyResult(data);
      if (data.template) setRefineComments('');
    } catch { setError('Failed to refine template.'); }
    finally { setRefining(false); }
  };

  const handleRegenerateMockup = async () => {
    if (!template) return;
    setMockupGenerating(true);
    setError('');
    try {
      const res = await fetch('/api/ai/build-product-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, brandName, mode: 'regen-example', existingSchema: template }),
      });
      const data = await res.json();
      if (data.exampleProduct) {
        setTemplate({ ...template, exampleProduct: data.exampleProduct });
      } else {
        setError(data.error || 'Failed to regenerate mockup example.');
      }
    } catch { setError('Failed to regenerate mockup.'); }
    finally { setMockupGenerating(false); }
  };

  const handleSave = async () => {
    if (!template) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/user/product-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, key: 'description', schema: template }),
      });
      const data = await res.json();
      if (data.success) setSuccess('Template saved to your database.');
      else setError(data.error || 'Save failed.');
    } catch { setError('Save failed.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-gray-800 mb-1">Description Schema</h2>
            <p className="text-sm text-gray-500">
              AI-generated template tailored to your brand, products, and customers. Every product listing on your website follows this structure.
            </p>
          </div>
          <div className="flex gap-2 shrink-0 items-center">
            {template && (
              <button
                onClick={editing
                  ? async () => { await handleSave(); setEditing(false); }
                  : () => setEditing(true)
                }
                disabled={generating || saving}
                className={`px-4 py-2 rounded-lg font-bold text-sm shadow-sm flex items-center gap-2 transition-colors ${
                  editing
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-white border border-gray-300 text-gray-700 hover:border-indigo-400 hover:text-indigo-600'
                }`}
              >
                <span>{editing ? '💾' : '✏️'}</span>
                {saving && editing ? 'Saving…' : editing ? 'Save' : 'Edit Template'}
              </button>
            )}
            <button
              onClick={handleGenerate}
              disabled={generating}
              className={`px-4 py-2 rounded-lg font-bold text-white text-sm shadow-sm flex items-center gap-2 ${
                generating ? 'bg-indigo-300 cursor-not-allowed' : 'bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700'
              }`}
            >
              <span>✨</span>
              {generating ? 'Generating…' : template ? 'Regenerate' : 'Generate with AI'}
            </button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        {success && <p className="mt-3 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">{success}</p>}
      </div>

      {template && (
        <>
          {/* Tone guide */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <h3 className="font-bold text-gray-700 text-sm uppercase tracking-wide mb-2">Tone & Voice Guide</h3>
            {editing ? (
              <textarea
                value={template.toneGuide}
                onChange={e => setTemplate({ ...template, toneGuide: e.target.value })}
                rows={4}
                className="w-full text-sm p-3 border border-gray-300 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 bg-white resize-none"
              />
            ) : (
              <p className="text-sm text-gray-700 leading-relaxed">{template.toneGuide}</p>
            )}
            <div className="mt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Writing Rules</p>
              {editing ? (
                <div className="space-y-2">
                  {template.writingRules.map((rule, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        value={rule}
                        onChange={e => {
                          const rules = [...template.writingRules];
                          rules[i] = e.target.value;
                          setTemplate({ ...template, writingRules: rules });
                        }}
                        className="flex-1 text-sm px-3 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                      />
                      <button
                        onClick={() => setTemplate({ ...template, writingRules: template.writingRules.filter((_, j) => j !== i) })}
                        className="px-2 py-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg text-sm transition-colors"
                      >✕</button>
                    </div>
                  ))}
                  <button
                    onClick={() => setTemplate({ ...template, writingRules: [...template.writingRules, ''] })}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-50 transition-colors"
                  >+ Add Rule</button>
                </div>
              ) : (
                template.writingRules?.length > 0 && (
                  <ul className="space-y-1">
                    {template.writingRules.map((rule, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <span className="text-indigo-400 font-bold shrink-0 mt-0.5">›</span>
                        {rule}
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>
          </div>

          {/* HTML Formatting */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <h3 className="font-bold text-gray-700 text-sm uppercase tracking-wide mb-1">HTML Formatting</h3>
            <p className="text-xs text-gray-400 mb-4">Controls the exact HTML used for headings and bullet lists in generated descriptions. Leave any field blank to let the AI decide freely.</p>
            {editing ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-0.5 block">Heading tag</label>
                  <select
                    value={template.headingTag ?? ''}
                    onChange={e => setTemplate({ ...template, headingTag: e.target.value || undefined })}
                    className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 bg-white"
                  >
                    <option value="">AI decides</option>
                    <option value="h2">h2</option>
                    <option value="h3">h3</option>
                    <option value="h4">h4</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-0.5 block">Heading colour</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      value={template.headingColour ?? '#000000'}
                      onChange={e => setTemplate({ ...template, headingColour: e.target.value })}
                      className="h-9 w-12 p-0.5 border border-gray-300 rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      value={template.headingColour ?? ''}
                      onChange={e => setTemplate({ ...template, headingColour: e.target.value || undefined })}
                      placeholder="AI decides"
                      className="flex-1 text-sm font-mono px-2 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                    />
                    {template.headingColour && (
                      <button onClick={() => setTemplate({ ...template, headingColour: undefined })} className="text-xs text-red-400 hover:text-red-600 px-1">✕</button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-0.5 block">Bullet character</label>
                  <input
                    type="text"
                    value={template.bulletChar ?? ''}
                    onChange={e => setTemplate({ ...template, bulletChar: e.target.value || undefined })}
                    placeholder="AI decides (e.g. ✓ ✅ • -)"
                    className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-0.5 block">Bullet colour</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      value={template.bulletColour ?? '#000000'}
                      onChange={e => setTemplate({ ...template, bulletColour: e.target.value })}
                      className="h-9 w-12 p-0.5 border border-gray-300 rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      value={template.bulletColour ?? ''}
                      onChange={e => setTemplate({ ...template, bulletColour: e.target.value || undefined })}
                      placeholder="AI decides"
                      className="flex-1 text-sm font-mono px-2 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                    />
                    {template.bulletColour && (
                      <button onClick={() => setTemplate({ ...template, bulletColour: undefined })} className="text-xs text-red-400 hover:text-red-600 px-1">✕</button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm text-gray-700">
                <span><span className="font-semibold text-gray-500">Heading tag: </span>{template.headingTag ?? <em className="text-gray-400">AI decides</em>}</span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-gray-500">Heading colour: </span>
                  {template.headingColour
                    ? <><span className="inline-block w-4 h-4 rounded border border-gray-200 shrink-0" style={{ background: template.headingColour }} />{template.headingColour}</>
                    : <em className="text-gray-400">AI decides</em>}
                </span>
                <span><span className="font-semibold text-gray-500">Bullet character: </span>{template.bulletChar ? <strong>{template.bulletChar}</strong> : <em className="text-gray-400">AI decides</em>}</span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-gray-500">Bullet colour: </span>
                  {template.bulletColour
                    ? <><span className="inline-block w-4 h-4 rounded border border-gray-200 shrink-0" style={{ background: template.bulletColour }} />{template.bulletColour}</>
                    : <em className="text-gray-400">AI decides</em>}
                </span>
              </div>
            )}
          </div>

          {/* Fields */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-700 text-sm uppercase tracking-wide">Template Fields</h3>
              {editing && (
                <button
                  onClick={() => setTemplate({ ...template, fields: [...template.fields, { name: 'newField', label: 'New Field', description: '', format: '', example: '' }] })}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 px-3 py-1 rounded-lg border border-indigo-200 hover:bg-indigo-50 transition-colors"
                >+ Add Field</button>
              )}
            </div>
            <div className="space-y-4">
              {template.fields?.map((field, i) => (
                <div key={i} className={`p-4 rounded-lg border ${editing ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50 border-gray-100'}`}>
                  {editing ? (
                    <div className="space-y-2">
                      <div className="flex gap-2 items-end">
                        <div className="flex-1 grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs font-semibold text-gray-500 mb-0.5 block">Label</label>
                            <input value={field.label} onChange={e => { const fields = [...template.fields]; fields[i] = { ...fields[i], label: e.target.value }; setTemplate({ ...template, fields }); }} className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 bg-white" />
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-gray-500 mb-0.5 block">Key name</label>
                            <input value={field.name} onChange={e => { const fields = [...template.fields]; fields[i] = { ...fields[i], name: e.target.value }; setTemplate({ ...template, fields }); }} className="w-full text-sm font-mono px-2 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 bg-white" />
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-gray-500 mb-0.5 block">Max length</label>
                            <input type="number" value={field.maxLength ?? ''} onChange={e => { const fields = [...template.fields]; fields[i] = { ...fields[i], maxLength: e.target.value ? Number(e.target.value) : undefined }; setTemplate({ ...template, fields }); }} placeholder="none" className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 bg-white" />
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-gray-500 mb-0.5 block">Item count</label>
                            <input type="number" value={field.count ?? ''} onChange={e => { const fields = [...template.fields]; fields[i] = { ...fields[i], count: e.target.value ? Number(e.target.value) : undefined }; setTemplate({ ...template, fields }); }} placeholder="1" className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 bg-white" />
                          </div>
                        </div>
                        <button onClick={() => { const fields = template.fields.filter((_, j) => j !== i); setTemplate({ ...template, fields }); }} className="px-2 py-1.5 mb-0.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg text-sm transition-colors shrink-0">✕</button>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-500 mb-0.5 block">Description</label>
                        <input value={field.description} onChange={e => { const fields = [...template.fields]; fields[i] = { ...fields[i], description: e.target.value }; setTemplate({ ...template, fields }); }} className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 bg-white" />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-500 mb-0.5 block">AI format instruction</label>
                        <textarea value={field.format} onChange={e => { const fields = [...template.fields]; fields[i] = { ...fields[i], format: e.target.value }; setTemplate({ ...template, fields }); }} rows={2} className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 bg-white resize-none" />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 mb-1 flex-wrap">
                        <span className="font-bold text-gray-800 text-sm">{field.label}</span>
                        <span className="text-xs font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{field.name}</span>
                        {field.maxLength && (
                          <span className="text-xs text-gray-400">max {field.maxLength} chars</span>
                        )}
                        {field.count && (
                          <span className="text-xs text-gray-400">{field.count} items</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mb-1">{field.description}</p>
                      <p className="text-xs text-indigo-700 italic mb-2">{field.format}</p>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Editable Example Product — only shown in edit mode */}
          {editing && (
            <div className="bg-white border border-indigo-200 rounded-xl p-6 shadow-sm">
              <h3 className="font-bold text-gray-700 text-sm uppercase tracking-wide mb-4">Example Product</h3>
              <p className="text-xs text-gray-400 mb-4">Edit the example product values used in the mockup preview below.</p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-0.5 block">Product Name</label>
                  <input
                    value={template.exampleProduct?.name ?? ''}
                    onChange={e => setTemplate({ ...template, exampleProduct: { ...template.exampleProduct, name: e.target.value } })}
                    className="w-full text-sm px-3 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                  />
                </div>
                {template.fields?.map((field, i) => {
                  const val = template.exampleProduct?.[field.name];
                  const isList = Array.isArray(val);
                  return (
                    <div key={i}>
                      <label className="text-xs font-semibold text-gray-500 mb-0.5 block">{field.label} <span className="font-mono font-normal text-gray-400">({field.name})</span></label>
                      {isList ? (
                        <div className="space-y-1.5">
                          {(val as string[]).map((item, j) => (
                            <div key={j} className="flex gap-2">
                              <input
                                value={item}
                                onChange={e => {
                                  const arr = [...(val as string[])];
                                  arr[j] = e.target.value;
                                  setTemplate({ ...template, exampleProduct: { ...template.exampleProduct, [field.name]: arr } });
                                }}
                                className="flex-1 text-sm px-2 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                              />
                              <button onClick={() => { const arr = (val as string[]).filter((_, k) => k !== j); setTemplate({ ...template, exampleProduct: { ...template.exampleProduct, [field.name]: arr } }); }} className="px-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg text-sm transition-colors">✕</button>
                            </div>
                          ))}
                          <button onClick={() => setTemplate({ ...template, exampleProduct: { ...template.exampleProduct, [field.name]: [...(val as string[]), ''] } })} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 px-2 py-0.5 rounded hover:bg-indigo-50 transition-colors">+ Add item</button>
                        </div>
                      ) : (
                        <textarea
                          value={(val as string) ?? ''}
                          onChange={e => setTemplate({ ...template, exampleProduct: { ...template.exampleProduct, [field.name]: e.target.value } })}
                          rows={2}
                          className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 resize-none"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Template Blueprint + Example Mockup — shared colour context */}
          {(() => {
            /** Determine visual type from field metadata */
            const fieldType = (field: TemplateField) => {
              const n = field.name.toLowerCase();
              if (n === 'headline' || n === 'title' || n === 'heading') return 'headline';
              if (n === 'calloutbadge' || n === 'badge' || n === 'callout' || n === 'tag') return 'badge';
              const exIsArray = Array.isArray(field.example);
              if (exIsArray || (field.count && field.count > 1)) return 'list';
              return 'text';
            };

            return (
              <>
              {/* ── Blueprint ── */}
              <div className="rounded-xl overflow-hidden shadow-sm border border-gray-200">
                <div className="px-6 py-3 flex items-center justify-between bg-gray-100">
                  <div>
                    <h3 className="font-bold text-sm uppercase tracking-wide text-gray-800">Template Blueprint</h3>
                    <p className="text-xs opacity-80 mt-0.5 text-gray-500">AI follows this layout for every product</p>
                  </div>
                  <span className="text-xs font-mono px-2 py-1 rounded bg-gray-200 text-gray-500">
                    {template.fields?.length || 0} fields
                  </span>
                </div>
                <div className="p-6 space-y-6 bg-white">
                  {template.fields?.map((field, i) => {
                    const type = fieldType(field);
                    const itemCount = field.count || (Array.isArray(field.example) ? (field.example as string[]).length : 3);
                    return (
                      <div key={i} className="space-y-1.5">
                        {/* Field label + meta badges */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold uppercase tracking-wide text-gray-500">{field.label}</span>
                          <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">{field.name}</span>
                          {field.maxLength && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">max {field.maxLength} chars</span>
                          )}
                          {type === 'list' && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">{itemCount} items</span>
                          )}
                        </div>
                        {/* Visual slot */}
                        {type === 'headline' && (
                          <div className="rounded-md h-8 w-3/4 bg-blue-50" />
                        )}
                        {type === 'badge' && (
                          <div className="inline-flex items-center h-6 w-28 rounded-full bg-amber-100" />
                        )}
                        {type === 'list' && (
                          <div className="space-y-1.5 pl-1">
                            {Array.from({ length: itemCount }).map((_, j) => (
                              <div key={j} className="flex items-center gap-2">
                                <span className="text-sm shrink-0 text-amber-600">✓</span>
                                <div className={`h-2.5 rounded bg-gray-200 ${j % 4 === 0 ? 'w-4/5' : j % 4 === 1 ? 'w-3/4' : j % 4 === 2 ? 'w-2/3' : 'w-3/5'}`} />
                              </div>
                            ))}
                          </div>
                        )}
                        {type === 'text' && (
                          <div className="space-y-1.5">
                            <div className="h-2.5 rounded bg-gray-200 w-full" />
                            <div className="h-2.5 rounded bg-gray-200 w-4/5" />
                            {(field.maxLength || 0) > 150 && <div className="h-2.5 rounded bg-gray-200 w-2/3" />}
                          </div>
                        )}
                        {/* Format instruction — what AI writes */}
                        <p className="text-xs italic leading-snug text-gray-500">{field.format}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Example Product Mockup ── */}
              <div className="rounded-xl overflow-hidden shadow-sm border border-gray-200">
                {/* Mockup header bar — uses brand primary colour if available */}
                <div
                  className="px-6 py-3 flex items-center justify-between"
                  style={{ backgroundColor: colours.primary ?? '#2563EB' }}
                >
                  <div>
                    <h3 className="font-bold text-sm uppercase tracking-wide text-white">Example Product Mockup</h3>
                    <span className="text-xs opacity-70 text-white">{template.exampleProduct?.name}</span>
                  </div>
                  <button
                    onClick={handleRegenerateMockup}
                    disabled={mockupGenerating}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/20 hover:bg-white/30 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {mockupGenerating ? (
                      <><span className="animate-spin">⟳</span> Generating…</>
                    ) : (
                      <><span>⟳</span> Regenerate</>
                    )}
                  </button>
                </div>
                <div className="p-6 space-y-5 bg-white">
                  {template.fields?.map((field, i) => {
                    const raw = template.exampleProduct?.[field.name];
                    if (raw === undefined || raw === '') return null;
                    const isList = Array.isArray(raw);
                    // Match any field whose name contains 'heading', 'headline', or is exactly 'title'
                    const isHeadline = /heading|headline/i.test(field.name) || field.name === 'title';
                    const isBadge = field.name === 'calloutBadge' || field.name === 'badge' || field.name === 'callout';

                    // Dynamic heading tag + colour from template settings
                    const HeadingTag = (template.headingTag ?? 'p') as keyof JSX.IntrinsicElements;
                    const headingStyle: React.CSSProperties = template.headingColour ? { color: template.headingColour, fontWeight: 'bold', marginBottom: '4px' } : { fontWeight: 'bold', marginBottom: '4px', color: '#1d4ed8' };
                    const bulletChar = template.bulletChar ?? '•';
                    const bulletStyle: React.CSSProperties = template.bulletColour
                      ? { color: template.bulletColour, fontWeight: 'bold', flexShrink: 0, marginTop: '2px', fontSize: '0.875rem', lineHeight: '1.25rem' }
                      : { color: '#9ca3af', flexShrink: 0, marginTop: '2px', fontSize: '0.875rem', lineHeight: '1.25rem' };

                    return (
                      <div key={i}>
                        {!isHeadline && !isBadge && field.label && (
                          <HeadingTag style={headingStyle} className="text-sm">{field.label}</HeadingTag>
                        )}
                        {isHeadline ? (
                          // Render the value itself as a heading using the template's tag + colour
                          <HeadingTag style={headingStyle} className="text-sm">{stripHtml(raw as string)}</HeadingTag>
                        ) : isBadge ? (
                          <span
                            className="inline-block text-xs font-bold px-3 py-1 rounded-full"
                            style={{ backgroundColor: colours.accent ? `${colours.accent}22` : '#fef3c7', color: colours.accent ?? '#b45309' }}
                          >{stripHtml(raw as string)}</span>
                        ) : isList ? (
                          <ul className="space-y-2">
                            {(raw as string[]).map((v, j) => (
                              <li key={j} className="flex items-start gap-2 text-sm">
                                <span style={bulletStyle}>{bulletChar}</span>
                                <MarkdownText text={v} />
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm leading-relaxed text-gray-600">
                            <MarkdownText text={raw as string} />
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                {Object.values(colours).some(Boolean) && (
                  <div className="px-6 py-3 flex items-center gap-3 bg-white border-t border-gray-100">
                    <span className="text-xs text-gray-400">Brand colours:</span>
                    {(['primary','secondary','accent','neutral','background'] as const).map(role => colours[role] ? (
                      <div key={role} className="flex items-center gap-1">
                        <div className="w-4 h-4 rounded-full border border-gray-200 shrink-0" style={{ backgroundColor: colours[role] }} title={role} />
                        <span className="text-xs text-gray-400 capitalize">{role}</span>
                      </div>
                    ) : null)}
                  </div>
                )}
              </div>
              </>
            );
          })()}

          {/* Refine + Save */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-6 shadow-sm">
            <button
              onClick={() => setShowRefine(v => !v)}
              className="flex items-center gap-2 text-sm font-semibold text-indigo-700 mb-1"
            >
              <span>✨</span> Refine with AI
              <span className="text-indigo-400 text-xs ml-1">{showRefine ? '▲' : '▼'}</span>
            </button>
            <p className="text-xs text-indigo-600 mb-3">
              Describe any changes — adjust tone, add/remove fields, correct field instructions, update the example, etc.
            </p>
            {showRefine && (
              <>
                <textarea
                  value={refineComments}
                  onChange={e => setRefineComments(e.target.value)}
                  rows={4}
                  placeholder={`e.g. "Add a 'materials' field between short description and bullet points. Make the tone less formal. The example product should use our Bamboo Tote instead."`}
                  className="w-full text-sm p-3 border border-indigo-300 rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white resize-none"
                />
                <div className="flex justify-end mt-2">
                  <button
                    onClick={handleRefine}
                    disabled={refining || !refineComments.trim()}
                    className={`px-5 py-2 rounded-lg font-bold text-white text-sm flex items-center gap-2 ${
                      refining || !refineComments.trim() ? 'bg-indigo-300 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
                    }`}
                  >
                    <span>✨</span> {refining ? 'Refining…' : 'Refine Template'}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end pb-6">
            <button
              onClick={handleSave}
              disabled={saving}
              className={`px-8 py-3 rounded-lg font-bold text-white shadow-sm ${
                saving ? 'bg-blue-300' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {saving ? 'Saving…' : 'Save Template to Database'}
            </button>
          </div>
        </>
      )}

      {!template && !generating && (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">📝</div>
          <p className="text-gray-700 font-semibold mb-1">No template yet</p>
          <p className="text-sm text-gray-400 mb-4">
            Click "Generate with AI" to build a product description template from your brand profile, Shopify products, and website.
          </p>
          <p className="text-xs text-gray-400">
            Make sure you've synced your Shopify products and saved a brand profile first for best results.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Web Field Templates — Title + Tags schemas ────────────────────────────────

interface TitleSchema {
  toneGuide: string;
  maxLength: number;
  formatRules: string[];
  formulaExamples: string[];
}

interface TagsSchema {
  instructions: string;
  requiredTags: string[];
  excludedTerms: string[];
}

function TitleSchemaTab({ databaseId }: { databaseId: string }) {
  const [schema, setSchema] = useState<TitleSchema | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!databaseId) return;
    fetch(`/api/user/product-schema?databaseId=${encodeURIComponent(databaseId)}`)
      .then(r => r.ok ? r.json() : {})
      .then((d: any) => { if (d.title) setSchema(d.title); })
      .catch(() => {});
  }, [databaseId]);

  const handleGenerate = async () => {
    setGenerating(true); setError(''); setSuccess('');
    try {
      const res = await fetch('/api/ai/build-product-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, type: 'title' }),
      });
      const data = await res.json();
      if (data.titleSchema) { setSchema(data.titleSchema); setEditing(false); }
      else setError(data.error || 'Unexpected response from AI.');
    } catch { setError('Failed to generate title schema.'); }
    finally { setGenerating(false); }
  };

  const handleSave = async () => {
    if (!schema) return;
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/user/product-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, key: 'title', schema }),
      });
      const data = await res.json();
      if (data.success) setSuccess('Title schema saved.');
      else setError(data.error || 'Save failed.');
    } catch { setError('Save failed.'); }
    finally { setSaving(false); }
  };

  const updateRule = (idx: number, val: string, field: 'formatRules' | 'formulaExamples') => {
    if (!schema) return;
    const arr = [...schema[field]];
    arr[idx] = val;
    setSchema({ ...schema, [field]: arr });
  };
  const addItem = (field: 'formatRules' | 'formulaExamples') => {
    if (!schema) return;
    setSchema({ ...schema, [field]: [...schema[field], ''] });
  };
  const removeItem = (idx: number, field: 'formatRules' | 'formulaExamples') => {
    if (!schema) return;
    setSchema({ ...schema, [field]: schema[field].filter((_, i) => i !== idx) });
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-gray-800 mb-1">Title Schema</h2>
            <p className="text-sm text-gray-500">Rules the AI follows every time it writes or rewrites a product title.</p>
          </div>
          <div className="flex gap-2 shrink-0 items-center">
            {schema && (
              <button
                onClick={() => { setEditing(v => !v); setSuccess(''); }}
                disabled={generating || saving}
                className={`px-4 py-2 rounded-lg font-bold text-sm shadow-sm transition-colors ${editing ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:border-indigo-400 hover:text-indigo-600'}`}
              >
                {editing ? '✓ Done Editing' : '✏️ Edit'}
              </button>
            )}
            <button
              onClick={handleGenerate}
              disabled={generating || saving}
              className="px-4 py-2 rounded-lg font-bold text-sm bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {generating ? <><span className="animate-spin">⟳</span> Generating…</> : schema ? '🔄 Regenerate' : '✨ Generate with AI'}
            </button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        {success && <p className="mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{success}</p>}
      </div>

      {schema && (
        <>
          {/* Tone guide */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-3">
            <h3 className="font-semibold text-gray-800">Tone Guide</h3>
            {editing ? (
              <textarea
                value={schema.toneGuide}
                onChange={e => setSchema({ ...schema, toneGuide: e.target.value })}
                rows={3}
                className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            ) : (
              <p className="text-sm text-gray-700 leading-relaxed">{schema.toneGuide}</p>
            )}
          </div>

          {/* Max length */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-3">
            <h3 className="font-semibold text-gray-800">Max Title Length</h3>
            {editing ? (
              <input
                type="number"
                value={schema.maxLength}
                onChange={e => setSchema({ ...schema, maxLength: Number(e.target.value) })}
                className="w-32 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            ) : (
              <p className="text-sm text-gray-700"><span className="font-mono bg-gray-100 px-2 py-1 rounded">{schema.maxLength}</span> characters</p>
            )}
          </div>

          {/* Format rules */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-3">
            <h3 className="font-semibold text-gray-800">Format Rules</h3>
            <div className="space-y-2">
              {schema.formatRules.map((rule, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <span className="text-xs text-gray-400 mt-2 w-5 shrink-0">{i + 1}.</span>
                  {editing ? (
                    <>
                      <input
                        value={rule}
                        onChange={e => updateRule(i, e.target.value, 'formatRules')}
                        className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                      <button onClick={() => removeItem(i, 'formatRules')} className="text-red-400 hover:text-red-600 text-sm mt-1">✕</button>
                    </>
                  ) : (
                    <p className="text-sm text-gray-700 flex-1">{rule}</p>
                  )}
                </div>
              ))}
              {editing && (
                <button onClick={() => addItem('formatRules')} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium mt-1">+ Add rule</button>
              )}
            </div>
          </div>

          {/* Formula examples */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-3">
            <h3 className="font-semibold text-gray-800">Formula Examples</h3>
            <div className="space-y-2">
              {schema.formulaExamples.map((ex, i) => (
                <div key={i} className="flex gap-2 items-start">
                  {editing ? (
                    <>
                      <input
                        value={ex}
                        onChange={e => updateRule(i, e.target.value, 'formulaExamples')}
                        className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                      <button onClick={() => removeItem(i, 'formulaExamples')} className="text-red-400 hover:text-red-600 text-sm mt-1">✕</button>
                    </>
                  ) : (
                    <p className="text-sm font-mono text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-3 py-1.5 flex-1">{ex}</p>
                  )}
                </div>
              ))}
              {editing && (
                <button onClick={() => addItem('formulaExamples')} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium mt-1">+ Add formula</button>
              )}
            </div>
          </div>

          {/* Save */}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving || generating}
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-sm shadow-sm transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : '💾 Save Title Schema'}
            </button>
          </div>
        </>
      )}

      {!schema && !generating && (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">🏷️</div>
          <p className="text-gray-700 font-semibold mb-1">No title schema yet</p>
          <p className="text-sm text-gray-400">Click "Generate with AI" to build a title schema from your brand profile and products.</p>
        </div>
      )}
    </div>
  );
}

function TagsSchemaTab({ databaseId }: { databaseId: string }) {
  const [schema, setSchema] = useState<TagsSchema | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [newRequiredTag, setNewRequiredTag] = useState('');
  const [newExcludedTerm, setNewExcludedTerm] = useState('');

  useEffect(() => {
    if (!databaseId) return;
    fetch(`/api/user/product-schema?databaseId=${encodeURIComponent(databaseId)}`)
      .then(r => r.ok ? r.json() : {})
      .then((d: any) => { if (d.tags) setSchema(d.tags); })
      .catch(() => {});
  }, [databaseId]);

  const handleGenerate = async () => {
    setGenerating(true); setError(''); setSuccess('');
    try {
      const res = await fetch('/api/ai/build-product-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, type: 'tags' }),
      });
      const data = await res.json();
      if (data.tagsSchema) { setSchema(data.tagsSchema); setEditing(false); }
      else setError(data.error || 'Unexpected response from AI.');
    } catch { setError('Failed to generate tags schema.'); }
    finally { setGenerating(false); }
  };

  const handleSave = async () => {
    if (!schema) return;
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/user/product-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, key: 'tags', schema }),
      });
      const data = await res.json();
      if (data.success) setSuccess('Tags schema saved.');
      else setError(data.error || 'Save failed.');
    } catch { setError('Save failed.'); }
    finally { setSaving(false); }
  };

  const addTag = (field: 'requiredTags' | 'excludedTerms', value: string, reset: () => void) => {
    if (!schema || !value.trim()) return;
    setSchema({ ...schema, [field]: [...schema[field], value.trim()] });
    reset();
  };
  const removeTag = (field: 'requiredTags' | 'excludedTerms', idx: number) => {
    if (!schema) return;
    setSchema({ ...schema, [field]: schema[field].filter((_, i) => i !== idx) });
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-gray-800 mb-1">Tags Schema</h2>
            <p className="text-sm text-gray-500">Tagging strategy the AI follows when generating product tags.</p>
          </div>
          <div className="flex gap-2 shrink-0 items-center">
            {schema && (
              <button
                onClick={() => { setEditing(v => !v); setSuccess(''); }}
                disabled={generating || saving}
                className={`px-4 py-2 rounded-lg font-bold text-sm shadow-sm transition-colors ${editing ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:border-indigo-400 hover:text-indigo-600'}`}
              >
                {editing ? '✓ Done Editing' : '✏️ Edit'}
              </button>
            )}
            <button
              onClick={handleGenerate}
              disabled={generating || saving}
              className="px-4 py-2 rounded-lg font-bold text-sm bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {generating ? <><span className="animate-spin">⟳</span> Generating…</> : schema ? '🔄 Regenerate' : '✨ Generate with AI'}
            </button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        {success && <p className="mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{success}</p>}
      </div>

      {schema && (
        <>
          {/* Instructions */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-3">
            <h3 className="font-semibold text-gray-800">Tagging Instructions</h3>
            {editing ? (
              <textarea
                value={schema.instructions}
                onChange={e => setSchema({ ...schema, instructions: e.target.value })}
                rows={5}
                className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            ) : (
              <p className="text-sm text-gray-700 leading-relaxed">{schema.instructions}</p>
            )}
          </div>

          {/* Required tags */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-3">
            <h3 className="font-semibold text-gray-800">Required Tags <span className="text-xs font-normal text-gray-400">(always included)</span></h3>
            <div className="flex flex-wrap gap-2">
              {schema.requiredTags.map((tag, i) => (
                <span key={i} className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium px-3 py-1 rounded-full">
                  {tag}
                  {editing && <button onClick={() => removeTag('requiredTags', i)} className="text-emerald-400 hover:text-red-500 ml-1">✕</button>}
                </span>
              ))}
            </div>
            {editing && (
              <div className="flex gap-2 mt-2">
                <input
                  value={newRequiredTag}
                  onChange={e => setNewRequiredTag(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag('requiredTags', newRequiredTag, () => setNewRequiredTag('')); } }}
                  placeholder="Add required tag…"
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button onClick={() => addTag('requiredTags', newRequiredTag, () => setNewRequiredTag(''))} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">+ Add</button>
              </div>
            )}
          </div>

          {/* Excluded terms */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-3">
            <h3 className="font-semibold text-gray-800">Excluded Terms <span className="text-xs font-normal text-gray-400">(never used)</span></h3>
            <div className="flex flex-wrap gap-2">
              {schema.excludedTerms.map((term, i) => (
                <span key={i} className="inline-flex items-center gap-1 bg-red-50 border border-red-200 text-red-700 text-xs font-medium px-3 py-1 rounded-full">
                  {term}
                  {editing && <button onClick={() => removeTag('excludedTerms', i)} className="text-red-300 hover:text-red-600 ml-1">✕</button>}
                </span>
              ))}
            </div>
            {editing && (
              <div className="flex gap-2 mt-2">
                <input
                  value={newExcludedTerm}
                  onChange={e => setNewExcludedTerm(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag('excludedTerms', newExcludedTerm, () => setNewExcludedTerm('')); } }}
                  placeholder="Add excluded term…"
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button onClick={() => addTag('excludedTerms', newExcludedTerm, () => setNewExcludedTerm(''))} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">+ Add</button>
              </div>
            )}
          </div>

          {/* Save */}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving || generating}
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-sm shadow-sm transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : '💾 Save Tags Schema'}
            </button>
          </div>
        </>
      )}

      {!schema && !generating && (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">🏷️</div>
          <p className="text-gray-700 font-semibold mb-1">No tags schema yet</p>
          <p className="text-sm text-gray-400">Click "Generate with AI" to build a tagging strategy from your brand profile and products.</p>
        </div>
      )}
    </div>
  );
}

// ── Shopify Collections Sync ──────────────────────────────────────────────────
interface ShopifyCollection {
  id: string;
  type: string;
  handle: string;
  title: string;
  published: string;
  products_count: string;
  sort_order: string;
  updated_at: string;
  url: string;
}

const ShopifyCollectionsSync = forwardRef<WebsiteSyncHandle, {
  databaseId: string;
}>(function ShopifyCollectionsSync({
  databaseId,
}, ref) {
  const [syncing, setSyncing] = useState(false);
  const [collections, setCollections] = useState<ShopifyCollection[] | null>(null);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const s = localStorage.getItem('marketoir_last_sync_shopify_collections');
    if (s) setLastSync(s);
  }, []);

  const handleSync = async (): Promise<WebsiteSyncResult> => {
    if (!databaseId) {
      const message = 'No business selected.';
      setError(message);
      return { success: false, error: message };
    }

    setSyncing(true);
    setError('');
    try {
      const res = await fetch('/api/sync/shopify/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'Unknown error');
      setCollections(data.collections);
      setSpreadsheetUrl(data.spreadsheetUrl ?? null);
      const now = new Date().toLocaleString();
      setLastSync(now);
      localStorage.setItem('marketoir_last_sync_shopify_collections', now);
      return {
        success: true,
        lastSync: now,
        spreadsheetUrl: data.spreadsheetUrl ?? null,
        count: data.collections.length,
      };
    } catch (e: any) {
      const message = e.message;
      setError(message);
      return { success: false, error: message };
    } finally {
      setSyncing(false);
    }
  };

  useImperativeHandle(ref, () => ({
    sync: handleSync,
  }), [databaseId]);

  const filtered = (collections ?? []).filter(c => {
    const q = filter.toLowerCase();
    return !q || c.title.toLowerCase().includes(q) || c.handle.toLowerCase().includes(q) || c.type.toLowerCase().includes(q);
  });

  if (!collections && !syncing && !error) {
    return null;
  }

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        {collections && (
          <>
            <div className="mb-3">
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter by title, handle or type…"
              className="w-full max-w-sm px-3 py-2 text-sm border border-gray-300 rounded-lg"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-600">
                  {['Title', 'Type', 'Handle', 'Products', 'Sort Order', 'Published', 'URL', 'Updated'].map(h => (
                    <th key={h} className="text-left font-semibold px-3 py-2 border-b border-gray-200 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">No collections match.</td></tr>
                ) : filtered.map(c => (
                  <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50/70">
                    <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{c.title}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${c.type === 'smart' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>{c.type}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-500">{c.handle}</td>
                    <td className="px-3 py-2 text-center">{c.products_count || '—'}</td>
                    <td className="px-3 py-2 text-gray-500">{c.sort_order || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${c.published === 'true' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {c.published === 'true' ? 'Published' : 'Hidden'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <a href={c.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-mono">{c.url}</a>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-400">{c.updated_at ? c.updated_at.slice(0, 10) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {syncing && !collections && (
        <div className="text-center py-8 text-gray-400">
          <p className="text-sm">Fetching collections from Shopify…</p>
        </div>
      )}
      </div>
    </div>
  );
});

const ShopifyOrdersSync = forwardRef<WebsiteSyncHandle, {
  databaseId: string;
}>(function ShopifyOrdersSync({ databaseId }, ref) {
  const [syncing, setSyncing] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    const s = localStorage.getItem('marketoir_last_sync_shopify_orders');
    if (s) setLastSync(s);
  }, []);

  const handleSync = async (): Promise<WebsiteSyncResult> => {
    if (!databaseId) {
      const message = 'No business selected.';
      setError(message);
      return { success: false, error: message };
    }

    setSyncing(true);
    setError('');
    try {
      const res = await fetch('/api/sync/shopify/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, monthsBack: 24 }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'Unknown error');
      setCount(data.count);
      setSpreadsheetUrl(data.spreadsheetUrl ?? null);
      const now = new Date().toLocaleString();
      setLastSync(now);
      localStorage.setItem('marketoir_last_sync_shopify_orders', now);
      return {
        success: true,
        lastSync: now,
        spreadsheetUrl: data.spreadsheetUrl ?? null,
        count: data.count,
      };
    } catch (e: any) {
      const message = e.message;
      setError(message);
      return { success: false, error: message };
    } finally {
      setSyncing(false);
    }
  };

  useImperativeHandle(ref, () => ({ sync: handleSync }), [databaseId]);

  if (!count && !syncing && !error) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      {syncing && !count && (
        <div className="text-center py-8 text-gray-400">
          <p className="text-sm">Fetching orders from Shopify (last 24 months)…</p>
          <p className="text-xs mt-1 text-gray-300">This may take a minute for large stores.</p>
        </div>
      )}
      {count !== null && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🧾</span>
            <div>
              <p className="font-semibold text-gray-800">Sales Orders synced</p>
              <p className="text-sm text-gray-500">
                <strong>{count.toLocaleString()}</strong> orders from the last 24 months written to{' '}
                <code className="text-xs bg-gray-100 px-1 rounded">Shopify_Orders</code>
                {lastSync && <span className="text-gray-400"> · {lastSync}</span>}
              </p>
            </div>
          </div>
          <p className="text-xs text-gray-400">
            Columns: order ID, order number, date, financial status, fulfillment status, totals (price / subtotal / tax / discounts), currency, source, customer name &amp; email, customer lifetime order count, line item count.
          </p>
          {spreadsheetUrl && (
            <a href={spreadsheetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 underline">
              📄 Open Orders Spreadsheet
            </a>
          )}
        </div>
      )}
    </div>
  );
});

// ── Pending Online View ──────────────────────────────────────────────────────
interface PendingOnlineProduct {
  id: string; styleCode: string; name: string; brand: string;
  optionId: string; code: string; cost: string; retailPrice: string; soh: string; barcode: string;
}

interface ProductContent {
  title: string;
  websiteDescription: string;
  tags: string;
  cin7Description: string;
  cin7Online: string;
  cin7Channels: string;
  images: string[];
  scrapedUrls?: string[];
}

type PushStatus = 'idle' | 'pushing' | 'done' | 'error';

// ── Content Editor for a single product ───────────────────────────────────────

function ProductContentEditor({
  product,
  content,
  cin7Status,
  shopifyStatus,
  onContentChange,
  onReformulate,
  onPushToCin7,
  onPushToShopify,
}: {
  product: PendingOnlineProduct;
  content: ProductContent;
  cin7Status: PushStatus;
  shopifyStatus: PushStatus;
  onContentChange: (field: keyof ProductContent, value: any) => void;
  onReformulate: (field: string, note: string) => void;
  onPushToCin7: () => void;
  onPushToShopify: () => void;
}) {
  const [reformulatingField, setReformulatingField] = useState<string | null>(null);
  const [descPreview, setDescPreview] = useState(false);
  const [reformulateNote, setReformulateNote] = useState('');
  const [imageErrors, setImageErrors] = useState<Record<number, boolean>>({});

  const startReformulate = (field: string) => {
    setReformulatingField(field);
    setReformulateNote('');
  };

  const submitReformulate = () => {
    if (!reformulatingField) return;
    onReformulate(reformulatingField, reformulateNote);
    setReformulatingField(null);
    setReformulateNote('');
  };

  const fieldRow = (label: string, field: keyof ProductContent, type: 'input' | 'textarea' | 'readonly' = 'input', maxLen?: number) => (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{label}</label>
        <div className="flex items-center gap-3">
          {field === 'websiteDescription' && (
            <button
              onClick={() => setDescPreview(p => !p)}
              className="text-xs text-gray-500 hover:text-gray-700 font-medium border border-gray-300 rounded px-2 py-0.5"
            >
              {descPreview ? '✎ Source' : '👁 Preview'}
            </button>
          )}
          {type !== 'readonly' && (
            <button
              onClick={() => startReformulate(field)}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              ✨ Ask AI to reformulate
            </button>
          )}
        </div>
      </div>
      {type === 'textarea' ? (
        <div className="relative">
          {field === 'websiteDescription' && descPreview ? (
            <div
              className="w-full min-h-[12rem] px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white overflow-auto prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: String(content[field] ?? '') }}
            />
          ) : (
            <textarea
              value={String(content[field] ?? '')}
              onChange={e => onContentChange(field, e.target.value)}
              rows={field === 'websiteDescription' ? 8 : 3}
              maxLength={maxLen}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
            />
          )}
          {maxLen && (
            <span className={`absolute bottom-2 right-3 text-xs ${String(content[field] ?? '').length > maxLen * 0.9 ? 'text-red-500' : 'text-gray-400'}`}>
              {String(content[field] ?? '').length}/{maxLen}
            </span>
          )}
        </div>
      ) : type === 'readonly' ? (
        <input
          value={String(content[field] ?? '')}
          readOnly
          className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500"
        />
      ) : (
        <input
          value={String(content[field] ?? '')}
          onChange={e => onContentChange(field, e.target.value)}
          className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      )}
      {reformulatingField === field && (
        <div className="mt-2 flex gap-2 items-center bg-indigo-50 border border-indigo-200 rounded-lg p-3">
          <input
            type="text"
            placeholder="Optional note for the AI (e.g. make it more playful)"
            value={reformulateNote}
            onChange={e => setReformulateNote(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submitReformulate()}
            autoFocus
            className="flex-1 px-3 py-1.5 text-sm border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <button
            onClick={submitReformulate}
            className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700"
          >
            Reformulate
          </button>
          <button
            onClick={() => setReformulatingField(null)}
            className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );

  const statusBadge = (status: PushStatus, label: string) => {
    const cfg: Record<PushStatus, { cls: string; icon: string }> = {
      idle:    { cls: 'bg-gray-100 text-gray-600',   icon: '' },
      pushing: { cls: 'bg-amber-100 text-amber-700', icon: '⏳ ' },
      done:    { cls: 'bg-green-100 text-green-700', icon: '✅ ' },
      error:   { cls: 'bg-red-100 text-red-700',     icon: '❌ ' },
    };
    const { cls, icon } = cfg[status];
    return status !== 'idle' ? (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{icon}{label}</span>
    ) : null;
  };

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 mt-2 mb-4">
      <h3 className="font-bold text-gray-800 text-sm mb-4">
        Content Editor — <span className="text-indigo-700">{product.name}</span>
        <span className="ml-2 font-mono text-xs text-gray-500">({product.code})</span>
      </h3>

      {/* Image Previews */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Images (up to 10)</label>
          <button
            onClick={() => startReformulate('images')}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
          >
            ✨ Ask AI to find better images
          </button>
        </div>
        <div className="flex flex-wrap gap-3 mb-2">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => (
            <div key={i} className="flex flex-col gap-1">
              <div className="relative w-28 h-28 rounded-lg border border-gray-200 bg-gray-100 overflow-hidden flex items-center justify-center">
                {content.images[i] && !imageErrors[i] ? (
                  <img
                    src={content.images[i]}
                    alt={`Image ${i + 1}`}
                    className="w-full h-full object-contain"
                    referrerPolicy="no-referrer"
                    onError={() => setImageErrors(prev => ({ ...prev, [i]: true }))}
                  />
                ) : (
                  <span className="text-gray-400 text-xs text-center px-1">{imageErrors[i] ? 'Load error' : 'No image'}</span>
                )}
                {content.images[i] && (
                  <button
                    onClick={() => {
                      const newImages = [...content.images];
                      newImages.splice(i, 1);
                      while (newImages.length < 10) newImages.push('');
                      setImageErrors(prev => {
                        const next: Record<number, boolean> = {};
                        Object.entries(prev).forEach(([k, v]) => {
                          const idx = parseInt(k);
                          if (idx < i) next[idx] = v;
                          else if (idx > i) next[idx - 1] = v;
                        });
                        return next;
                      });
                      onContentChange('images', newImages);
                    }}
                    title="Remove image"
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center hover:bg-red-600 leading-none"
                  >
                    ×
                  </button>
                )}
              </div>
              <input
                value={content.images[i] ?? ''}
                onChange={e => {
                  const newImages = [...content.images];
                  newImages[i] = e.target.value;
                  setImageErrors(prev => ({ ...prev, [i]: false }));
                  onContentChange('images', newImages);
                }}
                placeholder={`Image ${i + 1} URL`}
                className="w-28 px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          ))}
        </div>
        {reformulatingField === 'images' && (
          <div className="flex gap-2 items-center bg-indigo-100 border border-indigo-300 rounded-lg p-3">
            <input
              type="text"
              placeholder="Optional note (e.g. lifestyle photos only)"
              value={reformulateNote}
              onChange={e => setReformulateNote(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitReformulate()}
              autoFocus
              className="flex-1 px-3 py-1.5 text-sm border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button
              onClick={submitReformulate}
              className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700"
            >
              Find Images
            </button>
            <button
              onClick={() => setReformulatingField(null)}
              className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {content.scrapedUrls && content.scrapedUrls.length > 0 && (
        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">URLs scraped for images ({content.scrapedUrls.length})</p>
          <ul className="text-xs text-blue-600 space-y-1">
            {content.scrapedUrls.map((url, i) => (
              <li key={i}>
                <a href={url} target="_blank" rel="noopener noreferrer" className="hover:underline break-all">{url}</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6">
        <div>
          {fieldRow('Title', 'title', 'input')}
          {fieldRow('Tags', 'tags', 'input')}
          {fieldRow('Cin7 Description (max 220 chars)', 'cin7Description', 'textarea', 220)}
          {fieldRow('Cin7 Online Field', 'cin7Online', 'input')}
          {fieldRow('Cin7 Channels', 'cin7Channels', 'input')}
        </div>
        <div>
          {fieldRow('Website Description (HTML)', 'websiteDescription', 'textarea')}
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-indigo-200">
        <div className="flex items-center gap-2">
          <button
            onClick={onPushToCin7}
            disabled={cin7Status === 'pushing'}
            className="px-4 py-2 bg-orange-600 text-white text-sm font-semibold rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-colors"
          >
            {cin7Status === 'pushing' ? '⏳ Pushing…' : '1. Push to Cin7'}
          </button>
          {statusBadge(cin7Status, cin7Status === 'done' ? 'Pushed to Cin7' : 'Cin7 error')}
        </div>

        {cin7Status === 'done' && (
          <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
            💡 Step 2: Go to Cin7 and sync the product to Shopify, then come back here.
          </span>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={onPushToShopify}
            disabled={shopifyStatus === 'pushing'}
            className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {shopifyStatus === 'pushing' ? '⏳ Pushing…' : '3. Push to Shopify'}
          </button>
          {statusBadge(shopifyStatus, shopifyStatus === 'done' ? 'Pushed to Shopify' : 'Shopify error')}
        </div>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

function PendingOnlineView({ databaseId }: { databaseId: string }) {
  const [batchSize, setBatchSize]           = useState(50);
  const [settingsOpen, setSettingsOpen]     = useState(false);
  const [showPreflightDialog, setShowPreflightDialog] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const [products, setProducts]         = useState<PendingOnlineProduct[] | null>(null);
  const [totalOnline, setTotalOnline]   = useState<number | null>(null);
  const [totalPending, setTotalPending] = useState<number | null>(null);
  const [hasWebsiteSheet, setHasWebsiteSheet] = useState(true);
  const [filter, setFilter] = useState('');
  const [brandExclude, setBrandExclude] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Content state
  const [contentMap, setContentMap]     = useState<Record<string, ProductContent>>({});
  const [generatingSet, setGeneratingSet] = useState<Set<string>>(new Set());
  const [reformulatingSet, setReformulatingSet] = useState<Set<string>>(new Set());
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<Record<string, string>>({});

  // Push status
  const [cin7Status, setCin7Status]     = useState<Record<string, PushStatus>>({});
  const [cin7Message, setCin7Message]   = useState<Record<string, string>>({});
  const [shopifyStatus, setShopifyStatus]   = useState<Record<string, PushStatus>>({});
  const [shopifyMessage, setShopifyMessage] = useState<Record<string, string>>({});

  // Tavily preflight state — Step 1 before full generation
  type PreflightData = { answer: string; urls: string[] };
  const [preflightMap, setPreflightMap]     = useState<Record<string, PreflightData>>({});
  const [preflightingSet, setPreflightingSet] = useState<Set<string>>(new Set());
  const [preflightError, setPreflightError]   = useState<Record<string, string>>({});

  // Per-product user inputs passed to AI generation
  type ProductInputs = { urls: [string, string, string]; photos: string[]; notes: string };
  const [productInputs, setProductInputs] = useState<Record<string, ProductInputs>>({});
  const getInputs = (k: string): ProductInputs =>
    productInputs[k] ?? { urls: ['', '', ''], photos: [], notes: '' };
  const patchInputs = (k: string, patch: Partial<ProductInputs>) =>
    setProductInputs(prev => ({ ...prev, [k]: { ...getInputs(k), ...patch } }));

  // Scraped photos from reference page URLs
  const [scrapedPhotosMap, setScrapedPhotosMap] = useState<Record<string, string[]>>({});
  const [tavilyPhotosMap, setTavilyPhotosMap]   = useState<Record<string, string[]>>({});
  const [scrapingSet, setScrapingSet]           = useState<Set<string>>(new Set());
  const [serperSearchingSet, setSerperSearchingSet] = useState<Set<string>>(new Set());
  // Per-URL Tavily photos [productKey][urlSlot 0-2] and automated retrieval state
  const [urlPhotosMap, setUrlPhotosMap]   = useState<Record<string, string[][]>>({});
  const [automatingSet, setAutomatingSet] = useState<Set<string>>(new Set());
  const [autoStepMap, setAutoStepMap]     = useState<Record<string, string>>({});

  // Products marked "Remove from Website List" — skipped in Research/Images/Generate/Shopify
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());

  // Per-product Cin7 push state
  const getCin7Tags = (_k: string) => '';

  // Website description HTML preview toggle
  const [descPreviewKeys, setDescPreviewKeys] = useState<Set<string>>(new Set());
  const toggleDescPreview = (k: string) => setDescPreviewKeys(prev => {
    const next = new Set(prev);
    next.has(k) ? next.delete(k) : next.add(k);
    return next;
  });

  // Channel list modal
  const [channelListOpen, setChannelListOpen] = useState(false);
  const [channelListCopied, setChannelListCopied] = useState(false);

  // Scraper results panel (replaces per-product pop-up dialog)
  type TavilyEntry = { productName: string; payload: Record<string, any>; response?: Record<string, any>; timestamp: number };
  const [tavilyLog, setTavilyLog]           = useState<TavilyEntry[]>([]);
  const [tavilyPanelOpen, setTavilyPanelOpen] = useState(true);
  const [tavilySearch, setTavilySearch]     = useState('');

  const handleFind = async () => {
    if (!databaseId) { setError('No business selected.'); return; }
    setLoading(true);
    setError('');
    setProducts(null);
    setContentMap({});
    setExpandedCode(null);
    try {
      const res = await fetch(
        `/api/website/pending-online?databaseId=${encodeURIComponent(databaseId)}&batchSize=${batchSize}`
      );
      const data = await res.json();
      if (!data.success) { setError(data.error ?? 'Unknown error'); return; }
      setProducts(data.products ?? []);
      setTotalOnline(data.totalOnline ?? null);
      setTotalPending(data.totalPending ?? null);
      setHasWebsiteSheet(data.hasWebsiteSheet ?? true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Step 1a: Find URLs via Serper (Google Search)
  const handleFindUrls = async (product: PendingOnlineProduct) => {
    const key = product.code;
    if (removedKeys.has(key)) return;
    setSerperSearchingSet(prev => new Set(prev).add(key));
    setExpandedCode(key);
    try {
      const res = await fetch('/api/website/serper-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        console.warn('[find-urls]', data.error);
        return;
      }
      const urls: string[] = data.urls ?? [];
      setProductInputs(prev => {
        const existing = prev[key] ?? { urls: ['', '', ''], photos: [], notes: '' };
        const newUrls: [string, string, string] = [urls[0] ?? '', urls[1] ?? '', urls[2] ?? ''];
        return { ...prev, [key]: { ...existing, urls: newUrls } };
      });
    } catch (e: any) {
      console.warn('[find-urls]', e.message);
    } finally {
      setSerperSearchingSet(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  // Step 1b: Run Tavily research using the first URL found by serper (or fallback name query)
  const handleRunPreflight = async (product: PendingOnlineProduct) => {
    const key = product.code;
    if (removedKeys.has(key)) return;
    const urlsSnapshot = getInputs(key).urls; // capture before any awaits
    setPreflightingSet(prev => new Set(prev).add(key));
    setPreflightError(prev => ({ ...prev, [key]: '' }));
    setExpandedCode(key);
    // Clear any previous preflight result so the new one shows fresh
    setPreflightMap(prev => { const n = { ...prev }; delete n[key]; return n; });
    try {
      const res = await fetch('/api/website/tavily-preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product, firstUrl: getInputs(key).urls[0]?.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setPreflightError(prev => ({ ...prev, [key]: data.error ?? 'Tavily search failed' }));
        return;
      }
      setPreflightMap(prev => ({ ...prev, [key]: { answer: data.answer ?? '', urls: data.urls ?? [] } }));
      if (showPreflightDialog && data.tavilyRequest) setTavilyLog(prev => [{ productName: product.name, payload: data.tavilyRequest, response: data.tavilyResponse, timestamp: Date.now() }, ...prev]);
      // Store Tavily images in tavilyPhotosMap (labelled separately from manual scrape)
      if (data.images?.length) {
        setTavilyPhotosMap(prev => ({ ...prev, [key]: data.images }));
      }
      // Fetch Tavily photos for URL slots 1 & 2 (if already filled) so they display under each link
      const _noise = /thumb|icon|swatch|logo|favicon|width=[0-9]{1,2}(?![0-9])/i;
      const _ok = (u: string) => !_noise.test(u);
      const _fetchSlot = async (url: string): Promise<string[]> => {
        try {
          const r = await fetch('/api/website/tavily-preflight', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product, firstUrl: url }),
          });
          const d = await r.json();
          return (d.images ?? []).filter(_ok);
        } catch { return []; }
      };
      const [_s1, _s2] = await Promise.all([
        urlsSnapshot[1]?.trim() ? _fetchSlot(urlsSnapshot[1].trim()) : Promise.resolve([]),
        urlsSnapshot[2]?.trim() ? _fetchSlot(urlsSnapshot[2].trim()) : Promise.resolve([]),
      ]);
      setUrlPhotosMap(prev => ({ ...prev, [key]: [(data.images ?? []).filter(_ok), _s1, _s2] }));
      // Only auto-populate URL slots if no URLs already set (i.e. Find URLs hasn't been run)
      const alreadyHasUrls = getInputs(key).urls.some(u => u.trim());
      if (!alreadyHasUrls) {
        const tavilyUrls: string[] = data.urls ?? [];
        setProductInputs(prev => {
          const existing = prev[key] ?? { urls: ['', '', ''], photos: [], notes: '' };
          const newUrls: [string, string, string] = [...existing.urls] as [string, string, string];
          tavilyUrls.slice(0, 3).forEach((u, i) => { if (!newUrls[i]) newUrls[i] = u; });
          const notes = existing.notes?.trim() ? existing.notes : (data.answer ?? '');
          return { ...prev, [key]: { ...existing, urls: newUrls, notes } };
        });
      } else {
        // Just update the notes from the answer
        setProductInputs(prev => {
          const existing = prev[key] ?? { urls: ['', '', ''], photos: [], notes: '' };
          const notes = existing.notes?.trim() ? existing.notes : (data.answer ?? '');
          return { ...prev, [key]: { ...existing, notes } };
        });
      }
    } catch (e: any) {
      setPreflightError(prev => ({ ...prev, [key]: e.message }));
    } finally {
      setPreflightingSet(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  // Scrape photos manually from the top URL only (Manual Scrape source)
  const handleScrapePhotos = async (product: PendingOnlineProduct) => {
    const key = product.code;
    if (removedKeys.has(key)) return;
    const topUrl = getInputs(key).urls[0]?.trim();
    if (!topUrl) return;
    setScrapingSet(prev => new Set(prev).add(key));
    try {
      const res = await fetch('/api/website/scrape-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [topUrl] }),
      });
      const data = await res.json();
      if (data.images?.length) {
        setScrapedPhotosMap(prev => ({ ...prev, [key]: data.images }));
      }
    } catch (e: any) {
      console.warn('[scrape-photos]', e.message);
    } finally {
      setScrapingSet(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  // 🤖 Full automated pipeline: Find URLs → Tavily per-URL → AI judge → Scrape → Generate
  const handleAutomatedRetrieval = async (product: PendingOnlineProduct) => {
    const key = product.code;
    if (removedKeys.has(key) || automatingSet.has(key)) return;
    const step = (msg: string) => setAutoStepMap(prev => ({ ...prev, [key]: msg }));
    const noise = /thumb|icon|swatch|logo|favicon|width=[0-9]{1,2}(?![0-9])/i;
    const noiseOk = (u: string) => !noise.test(u);
    setAutomatingSet(prev => new Set(prev).add(key));
    setExpandedCode(key);
    try {
      // Step 1: Find URLs
      step('Step 1/5: Finding URLs…');
      const serperRes = await fetch('/api/website/serper-search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product }),
      });
      const serperData = await serperRes.json();
      if (!serperRes.ok || serperData.error) { step(`❌ Find URLs failed: ${serperData.error ?? 'error'}`); return; }
      const foundUrls: string[] = (serperData.urls ?? []).filter(Boolean).slice(0, 3);
      if (foundUrls.length === 0) { step('❌ No URLs found'); return; }
      setProductInputs(prev => {
        const existing = prev[key] ?? { urls: ['', '', ''], photos: [], notes: '' };
        const newUrls: [string, string, string] = [foundUrls[0] ?? '', foundUrls[1] ?? '', foundUrls[2] ?? ''];
        return { ...prev, [key]: { ...existing, urls: newUrls } };
      });

      // Step 2: Fetch photos from each URL via Tavily (photos only — no summaries)
      step('Step 2/5: Fetching photos from each URL…');
      const tavilyResults = await Promise.allSettled(
        foundUrls.map(url => fetch('/api/website/tavily-preflight', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product, firstUrl: url, photosOnly: true }),
        }).then(r => r.json())),
      );
      const perUrlPhotos = foundUrls.map((_, i) => {
        const res = tavilyResults[i];
        if (res.status === 'fulfilled' && !res.value?.error) {
          return (res.value.images ?? []).filter(noiseOk) as string[];
        }
        return [] as string[];
      });
      while (perUrlPhotos.length < 3) perUrlPhotos.push([]);
      setUrlPhotosMap(prev => ({ ...prev, [key]: perUrlPhotos }));
      const allTavilyPhotos = [...new Set(perUrlPhotos.flat())];
      if (allTavilyPhotos.length > 0) setTavilyPhotosMap(prev => ({ ...prev, [key]: allTavilyPhotos }));

      // Step 3: AI judges URLs (via Google Search) AND generates content — no summaries passed
      step('Step 3/5: AI researching & generating content…');
      let finalUrls = foundUrls.slice();
      let finalPerUrl = [...perUrlPhotos];
      let judgeGeneratedContent: any = null;
      try {
        const judgeRes = await fetch('/api/website/judge-urls', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product,
            urls: foundUrls,
            databaseId,
          }),
        });
        const judgeData = await judgeRes.json();
        const ranked: { url: string; keep: boolean }[] = judgeData.rankedUrls ?? [];
        // Reorder all slots by Gemini's full ranked order, keeping only keep=true URLs (best first).
        // Fall back to full ranked order if Gemini didn't mark any as keep=true.
        const orderedAll = ranked.map(r => r.url).filter(u => foundUrls.includes(u));
        const kept = ranked.filter(r => r.keep).map(r => r.url).filter(Boolean);
        const reorderedUrls = kept.length > 0 ? kept : orderedAll;
        if (reorderedUrls.length > 0) {
          finalUrls = reorderedUrls;
          finalPerUrl = reorderedUrls.map(url => { const i = foundUrls.indexOf(url); return i >= 0 ? (perUrlPhotos[i] ?? []) : []; });
          while (finalPerUrl.length < 3) finalPerUrl.push([]);
          setUrlPhotosMap(prev => ({ ...prev, [key]: finalPerUrl }));
        }
        if (judgeData.generatedContent) judgeGeneratedContent = judgeData.generatedContent;
      } catch { /* judge failed, keep original order */ }
      const paddedFinal: [string, string, string] = [finalUrls[0] ?? '', finalUrls[1] ?? '', finalUrls[2] ?? ''];
      setProductInputs(prev => {
        const existing = prev[key] ?? { urls: ['', '', ''], photos: [], notes: '' };
        return { ...prev, [key]: { ...existing, urls: paddedFinal } };
      });

      // Step 4: Scrape images from ranked URLs (runs while content is already ready)
      step('Step 4/5: Scraping images…');
      const urlsToScrape = finalUrls.filter(u => u?.trim());
      if (urlsToScrape.length > 0) {
        try {
          const scrapeRes = await fetch('/api/website/scrape-photos', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: urlsToScrape }),
          });
          const scrapeData = await scrapeRes.json();
          if (scrapeData.images?.length) setScrapedPhotosMap(prev => ({ ...prev, [key]: scrapeData.images }));
        } catch { /* scrape failed */ }
      }

      // Step 5: Apply generated content (already done in Step 3) or fall back to generate-content
      if (judgeGeneratedContent) {
        step('Step 5/5: Applying generated content…');
        setGenerateError(prev => ({ ...prev, [key]: '' }));
        setContentMap(prev => ({ ...prev, [key]: judgeGeneratedContent }));
        setPreflightMap(prev => { const n = { ...prev }; delete n[key]; return n; });
        step('✅ Done — review content below, then Push to Cin7 & Shopify');
        return;
      }
      // Fallback: call generate-content if judge-urls didn't return content
      step('Step 5/5: Generating content…');
      setGeneratingSet(prev => new Set(prev).add(key));
      setGenerateError(prev => ({ ...prev, [key]: '' }));
      try {
        const genRes = await fetch('/api/website/generate-content', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ databaseId, product, tavilyInfo: '', userPhotos: [], userNotes: '' }),
        });
        const genData = await genRes.json();
        if (!genData.success) {
          setGenerateError(prev => ({ ...prev, [key]: genData.error ?? 'Generation failed' }));
          step('❌ Content generation failed');
        } else {
          setContentMap(prev => ({ ...prev, [key]: genData.content }));
          setPreflightMap(prev => { const n = { ...prev }; delete n[key]; return n; });
          step('✅ Done — review content below, then Push to Cin7 & Shopify');
          return;
        }
      } catch (e: any) {
        setGenerateError(prev => ({ ...prev, [key]: e.message }));
        step(`❌ Content generation failed: ${e.message}`);
      } finally {
        setGeneratingSet(prev => { const s = new Set(prev); s.delete(key); return s; });
      }
    } catch (e: any) {
      step(`❌ Error: ${e.message}`);
    } finally {
      setAutomatingSet(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  // Step 2: Continue with AI generation using Tavily context
  const handleGenerateContent = async (product: PendingOnlineProduct, preflight?: { answer: string; urls: string[] }) => {
    const key = product.code;
    if (removedKeys.has(key)) return;
    const inputs = getInputs(key);
    setGeneratingSet(prev => new Set(prev).add(key));
    setGenerateError(prev => ({ ...prev, [key]: '' }));
    setExpandedCode(key);
    try {
      const res = await fetch('/api/website/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId,
          product,
          tavilyInfo: inputs.notes,
          userPhotos: inputs.photos,
          userNotes: inputs.notes,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setGenerateError(prev => ({ ...prev, [key]: data.error ?? 'Generation failed' }));
        return;
      }
      setContentMap(prev => ({ ...prev, [key]: data.content }));
      // Clear preflight once content is generated
      setPreflightMap(prev => { const n = { ...prev }; delete n[key]; return n; });
    } catch (e: any) {
      setGenerateError(prev => ({ ...prev, [key]: e.message }));
    } finally {
      setGeneratingSet(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  const handleReformulate = async (product: PendingOnlineProduct, field: string, note: string) => {
    const key = product.code;
    const reformKey = `${key}:${field}`;
    setReformulatingSet(prev => new Set(prev).add(reformKey));
    try {
      const res = await fetch('/api/website/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId,
          product,
          mode: 'reformulate',
          field,
          currentContent: contentMap[key],
          userNote: note,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setGenerateError(prev => ({ ...prev, [key]: data.error ?? 'Reformulation failed' }));
        return;
      }
      setContentMap(prev => {
        const current = { ...prev[key] };
        if (field === 'images') {
          current.images = Array.isArray(data.value) ? data.value : current.images;
        } else {
          (current as any)[field] = data.value ?? (data.raw?.[field] ?? '');
        }
        return { ...prev, [key]: current };
      });
    } catch (e: any) {
      setGenerateError(prev => ({ ...prev, [key]: e.message }));
    } finally {
      setReformulatingSet(prev => { const s = new Set(prev); s.delete(reformKey); return s; });
    }
  };

  const handleContentChange = (code: string, field: keyof ProductContent, value: any) => {
    setContentMap(prev => ({
      ...prev,
      [code]: { ...prev[code], [field]: value },
    }));
  };

  const handlePushToCin7 = async (product: PendingOnlineProduct) => {
    const key = product.code;
    const content = contentMap[key];
    setCin7Status(prev => ({ ...prev, [key]: 'pushing' }));
    setCin7Message(prev => ({ ...prev, [key]: '' }));
    const cin7Controller = new AbortController();
    const cin7Timer = setTimeout(() => cin7Controller.abort(), 90_000);
    try {
      const res = await fetch('/api/website/push-to-cin7', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: cin7Controller.signal,
        body: JSON.stringify({
          databaseId,
          productId: product.id,
          styleCode: product.styleCode,
          title: content?.title,
          cin7Description: content?.cin7Description,
          images: [...(tavilyPhotosMap[key] ?? []), ...(scrapedPhotosMap[key] ?? [])],
        }),
      });
      clearTimeout(cin7Timer);
      const data = await res.json();
      if (!data.success) {
        setCin7Status(prev => ({ ...prev, [key]: 'error' }));
        setCin7Message(prev => ({ ...prev, [key]: data.error ?? 'Unknown error' }));
      } else {
        setCin7Status(prev => ({ ...prev, [key]: 'done' }));
        setCin7Message(prev => ({ ...prev, [key]: data.message ?? 'Done' }));
      }
    } catch (e: any) {
      clearTimeout(cin7Timer);
      setCin7Status(prev => ({ ...prev, [key]: 'error' }));
      setCin7Message(prev => ({ ...prev, [key]: e.name === 'AbortError' ? 'Timed out — try again' : e.message }));
    }
  };

  const handlePushToShopify = async (product: PendingOnlineProduct) => {
    const key = product.code;
    if (removedKeys.has(key)) return;
    const content = contentMap[key];
    if (!content) return;
    setShopifyStatus(prev => ({ ...prev, [key]: 'pushing' }));
    setShopifyMessage(prev => ({ ...prev, [key]: '' }));
    try {
      const res = await fetch('/api/website/push-to-shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId,
          sku: product.code,
          title: content.title,
          websiteDescription: content.websiteDescription,
          tags: content.tags,
          images: [
            ...new Set([
              ...(urlPhotosMap[key]?.flat() ?? []),
              ...(tavilyPhotosMap[key] ?? []),
              ...(scrapedPhotosMap[key] ?? []),
            ].filter(u => u?.trim())),
          ],
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setShopifyStatus(prev => ({ ...prev, [key]: 'error' }));
        setShopifyMessage(prev => ({ ...prev, [key]: data.error ?? 'Unknown error' }));
      } else {
        setShopifyStatus(prev => ({ ...prev, [key]: 'done' }));
        setShopifyMessage(prev => ({ ...prev, [key]: data.message ?? 'Done' }));
      }
    } catch (e: any) {
      setShopifyStatus(prev => ({ ...prev, [key]: 'error' }));
      setShopifyMessage(prev => ({ ...prev, [key]: e.message }));
    }
  };

  const filtered = products?.filter(p => {
    const q = filter.toLowerCase();
    if (q && !p.name.toLowerCase().includes(q) && !p.code.toLowerCase().includes(q) &&
        !p.brand.toLowerCase().includes(q) && !p.styleCode.toLowerCase().includes(q)) return false;
    if (brandExclude.trim()) {
      const exc = brandExclude.toLowerCase();
      if (p.brand.toLowerCase().includes(exc)) return false;
    }
    return true;
  }) ?? [];

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="relative flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center text-xl">🌐</div>
          <div className="flex-1">
            <h2 className="font-bold text-gray-800 text-lg leading-tight">Load Products To Website</h2>
            <p className="text-xs text-gray-500">Find Cin7 products marked online=1 that haven&apos;t yet been added to Shopify. Generate AI content, then push to Cin7 and Shopify.</p>
          </div>
          {/* Settings cog */}
          <button
            onClick={() => setSettingsOpen(p => !p)}
            title="Settings"
            className={`p-1.5 rounded-lg transition-colors ${settingsOpen ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          {/* Settings dropdown */}
          {settingsOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setSettingsOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-xl z-20 p-4">
                <p className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-3">Settings</p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Batch size</label>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={batchSize}
                      onChange={e => setBatchSize(Math.max(1, Math.min(500, parseInt(e.target.value) || 50)))}
                      className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <p className="text-xs text-gray-400 mt-1">Max products loaded at once (1–500).</p>
                  </div>
                  <label className="flex items-start gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={showPreflightDialog}
                      onChange={e => setShowPreflightDialog(e.target.checked)}
                      className="mt-0.5 accent-blue-600 shrink-0"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-700 group-hover:text-blue-700 leading-tight">Show Scraper Results Dialog</p>
                      <p className="text-xs text-gray-400 mt-0.5">Display the raw Tavily search payload and response after each product research run.</p>
                    </div>
                  </label>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-4 mb-5">
          <button
            onClick={handleFind}
            disabled={loading}
            className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Searching…' : 'Find Products Not Listed on Web'}
          </button>
        </div>

        {error && <p className="text-sm text-red-600 mb-3">❌ {error}</p>}

        {!hasWebsiteSheet && products !== null && (
          <p className="text-sm text-amber-600 mb-3">
            ⚠️ No Shopify Products sheet found — run a Shopify sync first to get accurate results. Showing all online=1 products.
          </p>
        )}

        {products !== null && (
          <div className="text-xs text-gray-500 mb-3 flex flex-wrap gap-x-4 gap-y-1">
            {totalOnline !== null && <span><strong>{totalOnline}</strong> total products with online=1</span>}
            {totalPending !== null && <span><strong>{totalPending}</strong> not yet in Shopify</span>}
            {totalPending !== null && totalPending > batchSize && (
              <span className="text-amber-600">Showing first {batchSize} — increase batch size to see more.</span>
            )}
          </div>
        )}

        {products !== null && products.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center text-gray-400">
            <span className="text-4xl mb-3">✅</span>
            <p className="text-base font-semibold text-gray-500">All online products are already in Shopify</p>
            <p className="text-sm mt-1">No pending uploads found.</p>
          </div>
        )}

        {products !== null && products.length > 0 && (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              <input
                type="text"
                placeholder="Filter by name, SKU, brand or style code…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="flex-1 min-w-[180px] max-w-sm px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <input
                type="text"
                placeholder="Brand excludes…"
                value={brandExclude}
                onChange={e => setBrandExclude(e.target.value)}
                className="w-44 px-3 py-1.5 border border-red-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                title="Hide products whose brand contains this text"
              />
            </div>

            <div className="space-y-1">
              {/* 🤖 Auto Retrieve row — above individual step buttons */}
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <button
                  disabled={selectedKeys.size === 0}
                  onClick={async () => {
                    const targets = filtered.filter(p => selectedKeys.has(p.code || '') && !removedKeys.has(p.code || ''));
                    for (const p of targets) await handleAutomatedRetrieval(p);
                  }}
                  className="px-4 py-2 bg-amber-600 text-white text-xs font-bold rounded-lg hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
                  title="Find URLs → Tavily research per URL → AI judge URLs → Scrape images → Generate content"
                >
                  🤖 Auto Retrieve
                </button>
                <span className="text-xs text-gray-400 italic">Runs full pipeline on selected products (Find URLs → Research → AI judge → Scrape → Generate)</span>
              </div>
              {/* Bulk actions bar */}
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every(p => selectedKeys.has(p.code || ''))}
                    ref={el => {
                      if (el) el.indeterminate = filtered.some(p => selectedKeys.has(p.code || '')) && !filtered.every(p => selectedKeys.has(p.code || ''));
                    }}
                    onChange={e => {
                      if (e.target.checked) {
                        setSelectedKeys(new Set(filtered.map(p => p.code || '')));
                      } else {
                        setSelectedKeys(new Set());
                      }
                    }}
                    className="w-4 h-4 rounded accent-indigo-600"
                  />
                  <span className="text-xs text-gray-500">
                    {selectedKeys.size > 0 ? `${selectedKeys.size} selected` : 'Select all'}
                  </span>
                </label>
                <button
                  disabled={selectedKeys.size === 0}
                  onClick={async () => {
                    const targets = filtered.filter(p => selectedKeys.has(p.code || '') && !removedKeys.has(p.code || ''));
                    for (const p of targets) await handleFindUrls(p);
                  }}
                  className="px-3 py-1.5 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  🔍 Find URLs
                </button>
                <button
                  disabled={selectedKeys.size === 0}
                  onClick={async () => {
                    const targets = filtered.filter(p => selectedKeys.has(p.code || '') && !removedKeys.has(p.code || ''));
                    for (const p of targets) await handleRunPreflight(p);
                  }}
                  className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  🔍 Research Products
                </button>
                <button
                  disabled={selectedKeys.size === 0}
                  onClick={async () => {
                    const targets = filtered.filter(p => selectedKeys.has(p.code || '') && !removedKeys.has(p.code || ''));
                    for (const p of targets) await handleScrapePhotos(p);
                  }}
                  className="px-3 py-1.5 bg-sky-600 text-white text-xs font-semibold rounded-lg hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  📸 Pull Images
                </button>
                <button
                  disabled={selectedKeys.size === 0}
                  onClick={async () => {
                    const targets = filtered.filter(p => selectedKeys.has(p.code || '') && !removedKeys.has(p.code || ''));
                    for (const p of targets) {
                      const key = p.code || '';
                      const preflight = preflightMap[key];
                      await handleGenerateContent(p, preflight);
                    }
                  }}
                  className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ✨ Generate Content
                </button>
                <button
                  disabled={selectedKeys.size === 0}
                  onClick={async () => {
                    const targets = filtered.filter(p => selectedKeys.has(p.code || ''));
                    for (const p of targets) await handlePushToCin7(p);
                    setChannelListCopied(false);
                    setChannelListOpen(true);
                  }}
                  className="px-3 py-1.5 bg-emerald-700 text-white text-xs font-semibold rounded-lg hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Push selected products to Cin7"
                >
                  🚀 Push to Cin7
                </button>
                <button
                  disabled={selectedKeys.size === 0}
                  onClick={async () => {
                    const targets = filtered.filter(p => selectedKeys.has(p.code || '') && !removedKeys.has(p.code || '') && !!contentMap[p.code || '']);
                    for (const p of targets) await handlePushToShopify(p);
                  }}
                  className="px-3 py-1.5 bg-violet-600 text-white text-xs font-semibold rounded-lg hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Push description + scraped photos to Shopify for all selected products that have generated content"
                >
                  🛍️ Push to Shopify
                </button>
              </div>

              {/* Table header */}
              <div className="hidden md:grid grid-cols-[auto_1fr_1fr_2fr_1fr_auto_auto_auto] gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600">
                <span></span>
                <span>SKU</span>
                <span>Style Code</span>
                <span>Name / Brand</span>
                <span>SOH</span>
                <span>Status</span>
                <span></span>
                <span></span>
              </div>

              {filtered.map((p, i) => {
                const key = p.code || String(i);
                const isGenerating = generatingSet.has(key);
                const isPreflight = preflightingSet.has(key);
                const hasPreflight = !!preflightMap[key];
                const hasContent = !!contentMap[key];
                const isExpanded = expandedCode === key;
                const isReformulating = [...reformulatingSet].some(k => k.startsWith(key + ':'));
                const genErr = generateError[key];
                const pfErr = preflightError[key];
                const c7s = cin7Status[key] ?? 'idle';
                const shs = shopifyStatus[key] ?? 'idle';
                const isBusy = isGenerating || isPreflight || isReformulating || automatingSet.has(key);

                const overallStatus = (() => {
                  if (shs === 'done') return { icon: '✅', label: 'In Shopify', cls: 'text-green-700 bg-green-50' };
                  if (c7s === 'done') return { icon: '🔄', label: 'In Cin7', cls: 'text-orange-700 bg-orange-50' };
                  if (hasContent) return { icon: '✏️', label: 'Content ready', cls: 'text-indigo-700 bg-indigo-50' };
                  return { icon: '⏳', label: 'Pending', cls: 'text-gray-600 bg-gray-100' };
                })();

                const buttonLabel = (() => {
                  if (isPreflight) return '⏳ Researching…';
                  if (isGenerating) return '⏳ Generating…';
                  if (isReformulating) return '⏳ Reformulating…';
                  if (hasContent) return '🔄 Regenerate';
                  return '✨ Generate Content';
                })();

                return (
                  <div key={key}>
                    <div
                      className={`grid grid-cols-[auto_1fr_1fr_2fr_1fr_auto_auto_auto_auto] gap-2 px-3 py-2.5 rounded-lg border items-center text-sm cursor-pointer transition-colors ${
                        isExpanded ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50'
                      }`}
                      onClick={() => setExpandedCode(isExpanded ? null : key)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(key)}
                        onChange={e => {
                          e.stopPropagation();
                          setSelectedKeys(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(key); else next.delete(key);
                            return next;
                          });
                        }}
                        onClick={e => e.stopPropagation()}
                        className="w-4 h-4 rounded accent-indigo-600"
                      />
                      <span className="font-mono text-xs text-gray-700 truncate">{p.code || '—'}</span>
                      <span className="text-xs text-gray-600 truncate">{p.styleCode || '—'}</span>
                      <div className="min-w-0">
                        <div className="font-medium text-gray-800 truncate text-xs">{p.name || '—'}</div>
                        <div className="text-xs text-gray-500 truncate">{p.brand || '—'}</div>
                      </div>
                      <span className="text-xs text-gray-700 font-medium">
                        {p.soh ? `${parseFloat(p.soh).toFixed(0)} units` : '—'}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${overallStatus.cls}`}>
                        {overallStatus.icon} {overallStatus.label}
                      </span>
                      <button
                        onClick={e => { e.stopPropagation(); handleFindUrls(p); }}
                        disabled={isBusy || serperSearchingSet.has(key)}
                        className="px-3 py-1.5 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 whitespace-nowrap transition-colors"
                      >
                        {serperSearchingSet.has(key) ? '⏳ Finding…' : '🔍 Find URLs'}
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleRunPreflight(p); }}
                        disabled={isBusy}
                        className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap transition-colors"
                      >
                        {buttonLabel}
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); setExpandedCode(isExpanded ? null : key); }}
                        className="text-gray-400 hover:text-gray-600 text-xs px-1"
                      >
                        {isExpanded ? '▲' : '▼'}
                      </button>
                    </div>

                    {(genErr || pfErr) && (
                      <p className="text-xs text-red-600 px-3 py-1">❌ {genErr || pfErr}</p>
                    )}
                    {(cin7Message[key] || shopifyMessage[key]) && (
                      <div className="px-3 py-1 flex gap-4">
                        {cin7Message[key] && (
                          <p className={`text-xs ${c7s === 'error' ? 'text-red-600' : 'text-green-700'}`}>
                            Cin7: {cin7Message[key]}
                          </p>
                        )}
                        {shopifyMessage[key] && (
                          <p className={`text-xs ${shs === 'error' ? 'text-red-600' : 'text-green-700'}`}>
                            Shopify: {shopifyMessage[key]}
                          </p>
                        )}
                      </div>
                    )}

                    {autoStepMap[key] && (
                      <p className={`text-xs px-3 py-0.5 font-medium ${
                        autoStepMap[key].startsWith('❌') ? 'text-red-600' :
                        autoStepMap[key].startsWith('✅') ? 'text-green-700' : 'text-amber-600'
                      }`}>
                        🤖 {autoStepMap[key]}
                      </p>
                    )}

                    {/* ── Persistent AI Input Panel ─────────────────────── */}
                    {isExpanded && (
                      <div className="border border-gray-200 rounded-xl p-4 mt-2 mb-2 bg-gray-50 space-y-3">
                        {/* Auto Retrieve button */}
                        <div className="flex items-center gap-3 pb-3 border-b border-gray-200">
                          <button
                            onClick={e => { e.stopPropagation(); handleAutomatedRetrieval(p); }}
                            disabled={isBusy}
                            className="flex-1 px-4 py-2.5 bg-amber-600 text-white text-sm font-bold rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
                            title="Find URLs → Tavily research per URL → AI judge URLs → Scrape images → Generate content"
                          >
                            {automatingSet.has(key)
                              ? `⏳ ${autoStepMap[key] ?? 'Running…'}`
                              : '🤖 Auto Retrieve — Full Pipeline'}
                          </button>
                        </div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">AI Generation Inputs</p>

                        {/* Reference Pages */}
                        <div>
                          <p className="text-xs font-medium text-gray-700 mb-1.5">🔗 Reference Pages</p>
                          <div className="space-y-1.5">
                            {([0, 1, 2] as const).map(idx => (
                              <div key={idx} className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400 w-4 shrink-0">{idx + 1}.</span>
                                  <input
                                    type="text"
                                    value={getInputs(key).urls[idx] ?? ''}
                                    onChange={e => {
                                      const urls = [...getInputs(key).urls] as [string, string, string];
                                      urls[idx] = e.target.value;
                                      patchInputs(key, { urls });
                                    }}
                                    onClick={e => e.stopPropagation()}
                                    placeholder="https://…"
                                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs font-mono bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                                  />
                                  {getInputs(key).urls[idx] && (
                                    <a href={getInputs(key).urls[idx]} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-xs text-blue-500 hover:underline shrink-0">↗</a>
                                  )}
                                </div>
                                {/* Per-URL Tavily photos */}
                                {(urlPhotosMap[key]?.[idx]?.length ?? 0) > 0 && (
                                  <div className="flex flex-wrap gap-1 pl-6" onClick={e => e.stopPropagation()}>
                                    {urlPhotosMap[key][idx].map((photoUrl, pi) => (
                                      <div key={pi} className="relative w-10 h-10">
                                        <a href={photoUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                                          <img src={photoUrl} alt="" className="w-10 h-10 object-cover rounded border border-blue-200 hover:border-blue-400 transition-colors" onError={e => { (e.target as HTMLImageElement).parentElement!.parentElement!.style.display = 'none'; }} />
                                        </a>
                                        <button
                                          onClick={e => { e.stopPropagation(); setUrlPhotosMap(prev => { const updated = [...(prev[key] ?? [[], [], []])]; updated[idx] = updated[idx].filter((_, i) => i !== pi); return { ...prev, [key]: updated }; }); }}
                                          className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 hover:bg-red-600 text-white rounded-full text-[10px] flex items-center justify-center leading-none shadow"
                                        >×</button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Photos — Tavily + Manual Scrape */}
                        <div>
                          <div className="flex items-center gap-2 mb-1.5">
                            <p className="text-xs font-medium text-gray-700">🖼️ Photos</p>
                            <button
                              onClick={e => { e.stopPropagation(); handleScrapePhotos(p); }}
                              disabled={scrapingSet.has(key) || !getInputs(key).urls[0]?.trim()}
                              className="px-2 py-0.5 bg-sky-600 text-white text-xs font-semibold rounded hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                              title="Manually scrape up to 6 images from the top URL"
                            >
                              {scrapingSet.has(key) ? 'Scraping…' : '📸 Pull Images'}
                            </button>
                          </div>
                          {scrapingSet.has(key) && <p className="text-xs text-gray-400 italic">Scraping top URL…</p>}

                          {/* Tavily images */}
                          {tavilyPhotosMap[key]?.length > 0 && (
                            <div className="mb-2">
                              <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wide mb-1">Tavily ({tavilyPhotosMap[key].length})</p>
                              <div className="flex flex-wrap gap-2" onClick={e => e.stopPropagation()}>
                                {(tavilyPhotosMap[key] ?? []).map((url, idx) => (
                                  <div key={idx} className="relative w-16 h-16">
                                    <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                                      <img src={url} alt="" className="w-16 h-16 object-cover rounded border border-emerald-200 hover:border-emerald-400 transition-colors" onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }} />
                                    </a>
                                    <button
                                      onClick={e => { e.stopPropagation(); setTavilyPhotosMap(prev => ({ ...prev, [key]: (prev[key] ?? []).filter((_, i) => i !== idx) })); }}
                                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full text-xs flex items-center justify-center leading-none shadow"
                                    >×</button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Manual scrape images */}
                          {scrapedPhotosMap[key]?.length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold text-sky-700 uppercase tracking-wide mb-1">Manual Scrape ({scrapedPhotosMap[key].length})</p>
                              <div className="flex flex-wrap gap-2" onClick={e => e.stopPropagation()}>
                                {(scrapedPhotosMap[key] ?? []).map((url, idx) => (
                                  <div key={idx} className="relative w-16 h-16">
                                    <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                                      <img src={url} alt="" className="w-16 h-16 object-cover rounded border border-sky-200 hover:border-sky-400 transition-colors" onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }} />
                                    </a>
                                    <button
                                      onClick={e => { e.stopPropagation(); setScrapedPhotosMap(prev => ({ ...prev, [key]: (prev[key] ?? []).filter((_, i) => i !== idx) })); }}
                                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full text-xs flex items-center justify-center leading-none shadow"
                                    >×</button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {!tavilyPhotosMap[key]?.length && !scrapedPhotosMap[key]?.length && !scrapingSet.has(key) && (
                            <p className="text-xs text-gray-400 italic">No photos yet — Research for Tavily images, or Pull Images for manual scrape from top URL.</p>
                          )}
                        </div>

                        {/* Product Summary */}
                        <div>
                          <p className="text-xs font-medium text-gray-700 mb-1.5">📝 Product Summary</p>
                          <textarea
                            value={getInputs(key).notes}
                            onChange={e => patchInputs(key, { notes: e.target.value })}
                            onClick={e => e.stopPropagation()}
                            rows={4}
                            placeholder="Key features, special notes, or context for the AI…"
                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                          />
                          {/* Remove from website list */}
                          <label
                            className="flex items-center gap-2 mt-2 cursor-pointer select-none w-fit"
                            onClick={e => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={removedKeys.has(key)}
                              onChange={e => {
                                setRemovedKeys(prev => {
                                  const next = new Set(prev);
                                  e.target.checked ? next.add(key) : next.delete(key);
                                  return next;
                                });
                              }}
                              className="w-3.5 h-3.5 rounded accent-red-600"
                            />
                            <span className="text-xs text-red-700 font-medium">🚫 Remove Product from Website List</span>
                          </label>
                        </div>

                        {/* Your Photos */}
                        <div>
                          <p className="text-xs font-medium text-gray-700 mb-1.5">📷 Your Photos</p>
                          <div className="flex flex-wrap gap-2 items-center" onClick={e => e.stopPropagation()}>
                            {getInputs(key).photos.map((photo, idx) => (
                              <div key={idx} className="relative">
                                <img src={photo} alt="" className="w-16 h-16 object-cover rounded border border-gray-300" />
                                <button
                                  onClick={() => patchInputs(key, { photos: getInputs(key).photos.filter((_, i) => i !== idx) })}
                                  className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center leading-none"
                                >×</button>
                              </div>
                            ))}
                            <label className="w-16 h-16 border-2 border-dashed border-gray-300 rounded flex items-center justify-center cursor-pointer hover:border-blue-400 text-gray-400 hover:text-blue-400 text-2xl leading-none">
                              +
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={async e => {
                                  const files = Array.from(e.target.files ?? []);
                                  const b64s = await Promise.all(files.map(f => new Promise<string>((res, rej) => {
                                    const reader = new FileReader();
                                    reader.onload = () => res(reader.result as string);
                                    reader.onerror = rej;
                                    reader.readAsDataURL(f);
                                  })));
                                  patchInputs(key, { photos: [...getInputs(key).photos, ...b64s] });
                                  e.target.value = '';
                                }}
                              />
                            </label>
                          </div>
                        </div>

                        <button
                          onClick={e => { e.stopPropagation(); handleGenerateContent(p); }}
                          disabled={isBusy}
                          className="px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                          {isGenerating ? '⏳ Generating…' : hasContent ? '🔄 Regenerate' : '✨ Generate Content'}
                        </button>
                      </div>
                    )}

                    {/* Step 2: AI generation loading */}
                    {isExpanded && isGenerating && (
                      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-8 mt-2 mb-4 flex flex-col items-center gap-3">
                        <div className="animate-spin w-8 h-8 border-4 border-indigo-300 border-t-indigo-600 rounded-full" />
                        <p className="text-sm font-medium text-indigo-800">Generating content for <strong>{p.name}</strong>…</p>
                        <p className="text-xs text-gray-400">AI is writing descriptions and gathering images</p>
                      </div>
                    )}

                    {/* Step 2 result: generated content + push to Cin7 */}
                    {isExpanded && !isGenerating && hasContent && (
                      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 mt-2 mb-4 space-y-4" onClick={e => e.stopPropagation()}>
                        <h3 className="font-bold text-gray-800 text-sm">Generated Content — <span className="text-indigo-700">{p.name}</span></h3>

                        {/* Title */}
                        <div>
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Title</label>
                          <input
                            value={contentMap[key]?.title ?? ''}
                            onChange={e => handleContentChange(key, 'title', e.target.value)}
                            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                          />
                        </div>

                        {/* Cin7 Description */}
                        <div>
                          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Cin7 Description</label>
                          <textarea
                            value={contentMap[key]?.cin7Description ?? ''}
                            onChange={e => handleContentChange(key, 'cin7Description', e.target.value)}
                            rows={3}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-y"
                          />
                        </div>

                        {/* Website Description */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Website Description</label>
                            <button
                              onClick={() => toggleDescPreview(key)}
                              className="text-xs border border-gray-300 rounded px-2 py-0.5 text-gray-500 hover:text-gray-700 hover:border-gray-400 transition-colors"
                            >
                              {descPreviewKeys.has(key) ? '✎ Source' : '👁 Preview'}
                            </button>
                          </div>
                          {descPreviewKeys.has(key) ? (
                            <div
                              key={`desc-preview-${key}`}
                              contentEditable
                              suppressContentEditableWarning
                              className="w-full min-h-[8rem] px-3 py-2 border border-indigo-300 rounded-lg text-sm bg-white overflow-auto prose prose-sm max-w-none focus:outline-none focus:ring-2 focus:ring-indigo-400 cursor-text"
                              dangerouslySetInnerHTML={{ __html: contentMap[key]?.websiteDescription ?? '' }}
                              onBlur={e => handleContentChange(key, 'websiteDescription', e.currentTarget.innerHTML)}
                            />
                          ) : (
                            <textarea
                              value={contentMap[key]?.websiteDescription ?? ''}
                              onChange={e => handleContentChange(key, 'websiteDescription', e.target.value)}
                              rows={6}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-y font-mono text-xs"
                            />
                          )}
                        </div>

                        {/* Images with delete */}
                        {(contentMap[key]?.images ?? []).some(Boolean) && (
                          <div>
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">Images</label>
                            <div className="flex flex-wrap gap-3">
                              {(contentMap[key]?.images ?? []).map((url, idx) => url ? (
                                <div key={idx} className="relative w-20 h-20">
                                  <img src={url} alt="" className="w-20 h-20 object-cover rounded-lg border border-gray-200" referrerPolicy="no-referrer"
                                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                  <button
                                    onClick={() => {
                                      const imgs = [...(contentMap[key]?.images ?? [])];
                                      imgs.splice(idx, 1);
                                      handleContentChange(key, 'images', imgs);
                                    }}
                                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full text-xs flex items-center justify-center leading-none shadow"
                                  >×</button>
                                </div>
                              ) : null)}
                            </div>
                          </div>
                        )}

                        {/* Push to Cin7 */}
                        <div className="flex items-center gap-3 flex-wrap pt-1">
                          <button
                            onClick={() => handlePushToCin7(p)}
                            disabled={c7s === 'pushing'}
                            className="px-5 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                          >
                            {c7s === 'pushing' ? '⏳ Pushing to Cin7…' : c7s === 'done' ? '✅ Pushed to Cin7' : '🚀 Push to Cin7'}
                          </button>
                          {cin7Message[key] && (
                            <span className={`text-xs ${c7s === 'error' ? 'text-red-600' : 'text-green-700'}`}>{cin7Message[key]}</span>
                          )}
                        </div>

                        {/* Push description + photos to Shopify */}
                        <div className="flex items-center gap-3 flex-wrap pt-1">
                          <button
                            onClick={() => handlePushToShopify(p)}
                            disabled={removedKeys.has(key) || !contentMap[key] || shopifyStatus[key] === 'pushing'}
                            className="px-5 py-2 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
                          >
                            {shopifyStatus[key] === 'pushing'
                              ? '⏳ Pushing to Shopify…'
                              : shopifyStatus[key] === 'done'
                              ? '✅ Pushed to Shopify'
                              : `🛍️ Push Description + Photos to Shopify (${(scrapedPhotosMap[key] ?? []).length} photos)`}
                          </button>
                          {shopifyMessage[key] && (
                            <span className={`text-xs ${shopifyStatus[key] === 'error' ? 'text-red-600' : 'text-green-700'}`}>{shopifyMessage[key]}</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Step 1: Tavily preflight loading */}
                    {isExpanded && isPreflight && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-8 mt-2 mb-4 flex flex-col items-center gap-3 text-gray-500">
                        <div className="animate-spin w-8 h-8 border-4 border-emerald-300 border-t-emerald-600 rounded-full" />
                        <p className="text-sm font-medium text-emerald-800">Researching <strong>{p.name}</strong> via Tavily…</p>
                        <p className="text-xs text-gray-400">Gathering product information and URLs</p>
                      </div>
                    )}




                  </div>
                );
              })}
            </div>

            {filtered.length === 0 && filter && (
              <p className="text-xs text-gray-400 text-center py-4">No results match &ldquo;{filter}&rdquo;</p>
            )}
          </>
        )}
      </div>

      {/* Scraper Results Panel — fixed bottom, visible when setting is on and log has entries */}
      {showPreflightDialog && tavilyLog.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-30 flex flex-col bg-white border-t-2 border-emerald-400 shadow-[0_-4px_24px_rgba(0,0,0,0.12)]" style={{ maxHeight: tavilyPanelOpen ? '340px' : undefined }}>
          {/* Panel header */}
          <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border-b border-emerald-200 shrink-0">
            <span className="text-xs font-bold text-emerald-800 uppercase tracking-wide">Scraper Results</span>
            <span className="text-xs text-emerald-600 font-medium">({tavilyLog.length} product{tavilyLog.length !== 1 ? 's' : ''})</span>
            {tavilyPanelOpen && (
              <input
                type="text"
                placeholder="Search results…"
                value={tavilySearch}
                onChange={e => setTavilySearch(e.target.value)}
                className="ml-2 w-52 px-2 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-400"
              />
            )}
            <div className="ml-auto flex items-center gap-3">
              <button onClick={() => setTavilyLog([])} className="text-xs text-red-400 hover:text-red-600">Clear</button>
              <button
                onClick={() => setTavilyPanelOpen(p => !p)}
                className="text-xs font-medium text-gray-500 hover:text-gray-800 flex items-center gap-1"
              >
                {tavilyPanelOpen ? <>▼ Collapse</> : <>▲ Expand</>}
              </button>
            </div>
          </div>
          {/* Panel body */}
          {tavilyPanelOpen && (
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
              {tavilyLog
                .filter(e => {
                  if (!tavilySearch) return true;
                  const q = tavilySearch.toLowerCase();
                  return e.productName.toLowerCase().includes(q)
                    || JSON.stringify(e.payload).toLowerCase().includes(q)
                    || JSON.stringify(e.response ?? {}).toLowerCase().includes(q);
                })
                .map((entry, i) => (
                  <div key={i}>
                    {/* Product header row */}
                    <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 sticky top-0 z-10 border-b border-gray-200">
                      <span className="text-xs font-bold text-gray-800">{entry.productName}</span>
                      <span className="text-xs text-gray-400">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                    </div>
                    {/* Request */}
                    <div className="px-4 pt-2 pb-1">
                      <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider mb-1">Query sent to Tavily</p>
                      <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap bg-emerald-50 rounded p-2 select-all">{JSON.stringify(entry.payload, null, 2)}</pre>
                    </div>
                    {/* Response */}
                    {entry.response && (
                      <div className="px-4 pt-1 pb-3">
                        <p className="text-[10px] font-semibold text-blue-700 uppercase tracking-wider mb-1">Tavily Response</p>
                        <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap bg-blue-50 rounded p-2 select-all">{JSON.stringify(entry.response, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Channel list modal */}
      {channelListOpen && (() => {
        const pushed = filtered.filter(p => selectedKeys.has(p.code || ''));
        const tsv = ['Code\tOnline\tChannels', ...pushed.map(p => removedKeys.has(p.code || '') ? `${p.styleCode}\t-4\t` : `${p.styleCode}\t-4\tShopify https://monsterthreads.myshopify.com/`)].join('\n');
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setChannelListOpen(false)}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                <div>
                  <h3 className="font-bold text-gray-800">Channel List</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{pushed.length} product{pushed.length !== 1 ? 's' : ''} — tab-delimited, ready to paste into a spreadsheet</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { navigator.clipboard.writeText(tsv).then(() => { setChannelListCopied(true); setTimeout(() => setChannelListCopied(false), 2000); }); }}
                    className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    {channelListCopied ? '✅ Copied!' : '📋 Copy'}
                  </button>
                  <button onClick={() => setChannelListOpen(false)} className="text-gray-400 hover:text-gray-700 text-xl leading-none px-1">✕</button>
                </div>
              </div>
              <pre className="flex-1 overflow-auto px-5 py-4 text-xs font-mono text-gray-800 whitespace-pre select-all bg-gray-50 rounded-b-xl">{tsv}</pre>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function WebContentTemplatesView({ databaseId }: { databaseId: string }) {
  const [activeTab, setActiveTab] = useState<'description' | 'title' | 'tags'>('description');

  const tabs: { id: 'description' | 'title' | 'tags'; label: string; icon: string }[] = [
    { id: 'description', label: 'Descriptions', icon: '📝' },
    { id: 'title',       label: 'Titles',        icon: '🏷️' },
    { id: 'tags',        label: 'Tags',           icon: '🔖' },
  ];

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 ${
              activeTab === tab.id
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'description' && <ProductDescriptionView databaseId={databaseId} />}
      {activeTab === 'title'       && <TitleSchemaTab        databaseId={databaseId} />}
      {activeTab === 'tags'        && <TagsSchemaTab         databaseId={databaseId} />}
    </div>
  );
}

// ── Shared toggle chip ────────────────────────────────────────────────────────
function ToggleChip({
  label,
  icon,
  active,
  disabled = false,
  onClick,
}: {
  label: string;
  icon?: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        active
          ? 'bg-blue-600 text-white border-blue-600'
          : 'bg-white text-gray-500 border-gray-300 hover:border-blue-400'
      }`}
    >
      {icon && <span>{icon}</span>}
      {label}
    </button>
  );
}

// ── Bulk Edit Website Listings ────────────────────────────────────────────────
type BulkLogEntry = { text: string; type: 'info' | 'ok' | 'warn' | 'error' };

function BulkEditListingsView({ databaseId }: { databaseId: string }) {
  const FIELD_OPTIONS = [
    { key: 'title',       label: 'Title',               icon: '✏️' },
    { key: 'description', label: 'Product Description', icon: '📝' },
    { key: 'tags',        label: 'Tags',                icon: '🏷️' },
  ];

  const [fields,       setFields]       = useState<Set<string>>(new Set(['title', 'description', 'tags']));
  const [batchSize,    setBatchSize]    = useState(10);
  const [extraContext, setExtraContext] = useState('');
  const [useExisting,  setUseExisting]  = useState(true);
  const [useCompetitor,setUseCompetitor]= useState(true);
  const [useImages,    setUseImages]    = useState(true);
  const [useTemplates, setUseTemplates] = useState(true);
  const [addOptimisedTag, setAddOptimisedTag] = useState(true);
  const [previewing,   setPreviewing]   = useState(false);
  const [committing,   setCommitting]   = useState(false);
  const [previewLog,   setPreviewLog]   = useState<BulkLogEntry[]>([]);
  const [commitLog,    setCommitLog]    = useState<BulkLogEntry[]>([]);
  const [reviewUrl,    setReviewUrl]    = useState<string | null>(null);
  const [previewDone,  setPreviewDone]  = useState(false);
  const [commitDone,   setCommitDone]   = useState(false);
  const [history,      setHistory]      = useState<any[] | null>(null);
  const [showHistory,  setShowHistory]  = useState(false);
  const [globalError,  setGlobalError]  = useState('');

  const toggleField = (key: string) => {
    setFields(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const readStream = async (
    res: Response,
    onEvent: (evt: any) => void,
  ) => {
    if (!res.body) throw new Error('No stream returned');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.replace(/^data: /, '').trim();
        if (!line) continue;
        try { onEvent(JSON.parse(line)); } catch { /* ignore parse errors */ }
      }
    }
  };

  const handlePreview = async () => {
    if (!fields.size) { setGlobalError('Select at least one field to update.'); return; }
    if (!databaseId)  { setGlobalError('No business selected.'); return; }

    setPreviewing(true); setPreviewDone(false); setReviewUrl(null);
    setPreviewLog([]); setGlobalError('');

    try {
      const res = await fetch('/api/website/bulk-edit/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId,
          fields: Array.from(fields),
          batchSize,
          extraContext,
          useExisting,
          useCompetitor,
          useImages,
          useTemplates,
        }),
      });
      await readStream(res, evt => {
        if (evt.status === 'loading') {
          setPreviewLog(p => [...p, { text: evt.message, type: 'info' }]);
        } else if (evt.status === 'progress') {
          setPreviewLog(p => [...p, { text: `[${evt.processed}/${evt.total}] ${evt.title}`, type: 'info' }]);
        } else if (evt.status === 'product_error') {
          setPreviewLog(p => [...p, { text: `✗ ${evt.title}: ${evt.error}`, type: 'error' }]);
        } else if (evt.status === 'done') {
          if (evt.allDone) {
            setPreviewLog(p => [...p, { text: `✓ All ${evt.total} products have been processed.`, type: 'ok' }]);
          } else if (evt.processed === 0) {
            setPreviewLog(p => [...p, { text: `All products already processed. Open the sheet to review.`, type: 'ok' }]);
          } else {
            setPreviewLog(p => [...p, {
              text: `✓ ${evt.processed} products added to review sheet. ${evt.remaining} still to go — click Generate again to continue.${evt.errors ? ` (${evt.errors} error${evt.errors > 1 ? 's' : ''})` : ''}`,
              type: evt.errors > 0 ? 'warn' : 'ok',
            }]);
          }
          setReviewUrl(evt.reviewUrl);
          setPreviewDone(true);
        } else if (evt.status === 'error') {
          setPreviewLog(p => [...p, { text: evt.error, type: 'error' }]);
          setGlobalError(evt.error);
        }
      });
    } catch (e: any) {
      setGlobalError(e.message);
    }
    setPreviewing(false);
  };

  const handleCommit = async () => {
    if (!databaseId) return;
    setCommitting(true); setCommitDone(false);
    setCommitLog([]); setGlobalError('');

    try {
      const res = await fetch('/api/website/bulk-edit/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, addOptimisedTag }),
      });
      await readStream(res, evt => {
        if (evt.status === 'start') {
          setCommitLog(p => [...p, { text: `Committing ${evt.total} changes to Shopify…`, type: 'info' }]);
        } else if (evt.status === 'progress') {
          setCommitLog(p => [...p, {
            text: evt.result === 'success' ? `✓ ${evt.product}` : `✗ ${evt.product}: ${evt.error}`,
            type: evt.result === 'success' ? 'ok' : 'error',
          }]);
        } else if (evt.status === 'done') {
          setCommitLog(p => [...p, {
            text: `Complete — ${evt.succeeded} succeeded, ${evt.failed} failed.`,
            type: evt.failed > 0 ? 'warn' : 'ok',
          }]);
          if (evt.reviewUrl) setReviewUrl(evt.reviewUrl);
          setCommitDone(true);
        } else if (evt.status === 'error') {
          setCommitLog(p => [...p, { text: evt.error, type: 'error' }]);
          setGlobalError(evt.error);
        }
      });
    } catch (e: any) {
      setGlobalError(e.message);
    }
    setCommitting(false);
  };

  const loadHistory = async () => {
    try {
      const res = await fetch(`/api/website/bulk-edit/history?databaseId=${encodeURIComponent(databaseId)}`);
      const data = await res.json();
      setHistory(data.history ?? []);
      setShowHistory(true);
    } catch (e: any) {
      setGlobalError(e.message);
    }
  };

  const logCls = (type: BulkLogEntry['type']) => {
    if (type === 'ok')    return 'text-green-700';
    if (type === 'error') return 'text-red-600';
    if (type === 'warn')  return 'text-amber-600';
    return 'text-gray-600';
  };

  return (
    <div className="max-w-3xl space-y-5">

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-gray-800 mb-1">Bulk Edit Website Listings</h2>
            <p className="text-sm text-gray-500">
              AI-rewrite descriptions and tags for all products in batches. Preview changes in a spreadsheet, review them, then commit to Shopify when ready.
            </p>
          </div>
          <button
            onClick={loadHistory}
            className="shrink-0 px-3 py-1.5 text-xs font-semibold text-gray-600 border border-gray-300 rounded-lg hover:border-gray-400 transition-colors"
          >
            📋 Commit History
          </button>
        </div>
        {globalError && (
          <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{globalError}</p>
        )}
      </div>

      {/* Configuration */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-5">

        {/* Fields */}
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-2">Fields to update</p>
          <div className="flex flex-wrap gap-2">
            {FIELD_OPTIONS.map(f => (
              <ToggleChip
                key={f.key}
                label={f.label}
                icon={f.icon}
                active={fields.has(f.key)}
                disabled={previewing || committing}
                onClick={() => toggleField(f.key)}
              />
            ))}
          </div>
        </div>

        {/* AI context options — always shown */}
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-2">AI context to use:</p>
          <div className="flex flex-wrap gap-2">
            <ToggleChip
              label="Web Field Templates"
              icon="📐"
              active={useTemplates}
              disabled={previewing || committing}
              onClick={() => setUseTemplates(v => !v)}
            />
            <ToggleChip
              label="Existing field data"
              icon="📄"
              active={useExisting}
              disabled={previewing || committing}
              onClick={() => setUseExisting(v => !v)}
            />
            <ToggleChip
              label="Product images"
              icon="🖼️"
              active={useImages}
              disabled={previewing || committing}
              onClick={() => setUseImages(v => !v)}
            />
          </div>
        </div>

        {/* Description-specific context options */}
        {fields.has('description') && (
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">When building new descriptions, also consider:</p>
            <div className="flex flex-wrap gap-2">
              <ToggleChip
                label="Competitor listings for missing details"
                icon="🔍"
                active={useCompetitor}
                disabled={previewing || committing}
                onClick={() => setUseCompetitor(v => !v)}
              />
            </div>
            {useCompetitor && (
              <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                ⚠ Competitor data is used only to fill confirmed gaps in your product information. The AI will never include details it cannot verify match your specific product and variants — when in doubt, it sticks to your own data.
              </p>
            )}
          </div>
        )}

        {/* Extra instructions */}
        <div>
          <label className="text-sm font-semibold text-gray-700 mb-1 block">
            Extra instructions for the AI <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <textarea
            value={extraContext}
            onChange={e => setExtraContext(e.target.value)}
            rows={3}
            disabled={previewing || committing}
            placeholder={`e.g. "Highlight our 30-day returns policy in every description. Avoid using the word 'innovative'."`}
            className="w-full text-sm p-3 border border-gray-300 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 resize-none disabled:bg-gray-50"
          />
        </div>

        {/* Batch size + generate button */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <label className="text-sm font-semibold text-gray-700 whitespace-nowrap">Batch size</label>
            <input
              type="number"
              min={1}
              max={100}
              value={batchSize}
              onChange={e => setBatchSize(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
              disabled={previewing || committing}
              className="w-20 text-sm px-3 py-1.5 border border-gray-300 rounded-lg focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 disabled:bg-gray-50"
            />
            <span className="text-xs text-gray-400">products per AI call (max 100)</span>
          </div>
          <button
            onClick={handlePreview}
            disabled={previewing || committing || !fields.size}
            className={`px-5 py-2 rounded-lg font-bold text-white text-sm flex items-center gap-2 shadow-sm transition-colors ${
              previewing || !fields.size
                ? 'bg-indigo-300 cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700'
            }`}
          >
            <span>✨</span> {previewing ? 'Generating…' : 'Generate Previews'}
          </button>
        </div>
      </div>

      {/* Preview progress */}
      {previewLog.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h3 className="font-bold text-gray-700 text-sm uppercase tracking-wide mb-3">Preview Progress</h3>
          <div className="bg-gray-50 rounded-lg p-4 space-y-1 max-h-56 overflow-y-auto font-mono text-xs">
            {previewLog.map((e, i) => (
              <p key={i} className={logCls(e.type)}>{e.text}</p>
            ))}
            {previewing && <p className="text-indigo-500 animate-pulse">Processing…</p>}
          </div>
          {reviewUrl && (
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <a
                href={reviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
              >
                📊 Review in Google Sheets
              </a>
              <p className="text-xs text-gray-400">Check the old vs new columns in the BulkEdit_Review tab before committing.</p>
            </div>
          )}
        </div>
      )}

      {/* Commit section */}
      {previewDone && !previewing && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-6 shadow-sm">
          <h3 className="font-bold text-indigo-800 text-sm mb-1">Ready to commit?</h3>
          <p className="text-xs text-indigo-600 mb-4">
            Open the spreadsheet above, review the proposed changes, then click below to push all <strong>pending</strong> rows to Shopify. Already-committed or failed rows are skipped.
          </p>
          <div className="flex items-center gap-4 flex-wrap">
            <button
              onClick={handleCommit}
              disabled={committing || previewing}
              className={`px-5 py-2 rounded-lg font-bold text-white text-sm flex items-center gap-2 shadow-sm transition-colors ${
                committing ? 'bg-indigo-300 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              <span>🚀</span> {committing ? 'Committing…' : 'Commit to Shopify'}
            </button>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={addOptimisedTag}
                onChange={e => setAddOptimisedTag(e.target.checked)}
                disabled={committing}
                className="w-4 h-4 rounded accent-indigo-600"
              />
              <span className="text-xs text-indigo-700 font-medium">Add <code className="bg-indigo-100 px-1 rounded">BulkOptimised</code> tag</span>
            </label>
          </div>
        </div>
      )}

      {/* Commit progress */}
      {commitLog.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h3 className="font-bold text-gray-700 text-sm uppercase tracking-wide mb-3">Commit Progress</h3>
          <div className="bg-gray-50 rounded-lg p-4 space-y-1 max-h-72 overflow-y-auto font-mono text-xs">
            {commitLog.map((e, i) => (
              <p key={i} className={logCls(e.type)}>{e.text}</p>
            ))}
            {committing && <p className="text-indigo-500 animate-pulse">Updating Shopify…</p>}
          </div>
          {reviewUrl && commitDone && (
            <div className="mt-3">
              <a
                href={reviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
              >
                📊 View updated sheet
              </a>
            </div>
          )}
        </div>
      )}

      {/* History modal */}
      {showHistory && history !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowHistory(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
              <h3 className="font-bold text-gray-800">Commit History</h3>
              <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="overflow-y-auto flex-1 p-6 space-y-4">
              {history.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No commit history yet.</p>
              ) : history.map((entry, i) => (
                <div key={i} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        {(() => { try { return new Date(entry.run_at).toLocaleString(); } catch { return entry.run_at; } })()}
                      </p>
                      <p className="text-xs text-gray-500">Fields: {entry.fields || 'N/A'} · {entry.total} products</p>
                    </div>
                    <div className="flex gap-2 text-xs font-semibold">
                      <span className="text-green-700 bg-green-50 border border-green-100 px-2 py-1 rounded-full">✓ {entry.succeeded}</span>
                      {entry.failed > 0 && (
                        <span className="text-red-600 bg-red-50 border border-red-100 px-2 py-1 rounded-full">✗ {entry.failed}</span>
                      )}
                    </div>
                  </div>
                  {entry.details?.filter((d: any) => d.status === 'failed').length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs font-semibold text-red-600 mb-1">Failures:</p>
                      {entry.details.filter((d: any) => d.status === 'failed').map((d: any, j: number) => (
                        <p key={j} className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">
                          <span className="font-semibold">{d.title}</span>: {d.error}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI Helper View ───────────────────────────────────────────────────────────

function AiHelperView({ databaseId }: { databaseId: string }) {
  const defaultSources = Object.fromEntries(AI_DATA_SOURCES.map(s => [s.id, s.id === 'businessInfo' || s.id === 'brandProfile']));
  const [selected, setSelected] = useState<Record<string, boolean>>(defaultSources);
  const [rememberPreviousChats, setRememberPreviousChats] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState('');
  const [previewAttachments, setPreviewAttachments] = useState<{label: string; filename: string; rowCount: number; mode: string; csvContent: string}[]>([]);
  const [copied, setCopied] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [savingSummary, setSavingSummary] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [activeModel, setActiveModel] = useState('');

  // Load the configured Gemini model from Connections on mount so it shows before the first message
  useEffect(() => {
    if (!databaseId) return;
    fetch(`/api/user/business-connections?databaseId=${encodeURIComponent(databaseId)}`)
      .then(r => r.json())
      .then(data => {
        const model = data?.connections?.GeminiModel;
        if (model) setActiveModel(model);
        else setActiveModel('gemini-2.5-flash-preview-04-17'); // default
      })
      .catch(() => setActiveModel('gemini-2.5-flash-preview-04-17'));
  }, [databaseId]);

  const [messages, setMessages] = useState<{ role: 'business' | 'professor'; text: string }[]>([
    {
      role: 'professor',
      text: 'Greetings. I am Professor KnowItAll. Ask me anything about your business and I will help with clear, practical advice grounded in your selected data sources.',
    },
  ]);

  const activeSources = AI_DATA_SOURCES.filter(s => selected[s.id]).map(s => s.id);

  const historyForApi = messages
    .filter(m => m.text.trim())
    .map(m => ({ role: m.role === 'professor' ? 'assistant' : 'user', content: m.text }));

  const callApi = async (previewOnly: boolean) => {
    if (!prompt.trim()) { setError('Please enter a question or request.'); return; }
    if (!databaseId)    { setError('No business selected.'); return; }
    setError('');

    const nextBusinessMessage = { role: 'business' as const, text: prompt.trim() };

    if (previewOnly) {
      setPreviewLoading(true);
    } else {
      setLoading(true);
      setMessages(prev => [...prev, nextBusinessMessage]);
    }

    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId,
          prompt,
          dataSources: activeSources,
          preview: previewOnly,
          history: previewOnly ? historyForApi : [...historyForApi, { role: 'user', content: nextBusinessMessage.text }],
          rememberPreviousChats,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Unknown error');
      if (previewOnly) {
        setPreviewText(data.fullPrompt);
        setPreviewAttachments(data.csvAttachments ?? []);
        setPreviewOpen(true);
      } else {
        setMessages(prev => [...prev, { role: 'professor', text: data.response ?? '' }]);
        if (data.model) setActiveModel(data.model);
        setPrompt('');
      }
    } catch (e: any) {
      setError(e.message);
      if (!previewOnly) {
        setMessages(prev => [
          ...prev,
          { role: 'professor', text: `I hit a technical issue while responding: ${e.message}` },
        ]);
      }
    }
    setLoading(false);
    setPreviewLoading(false);
  };

  const endChat = () => {
    if (messages.length <= 1) {
      setError('Start a conversation first, then end and save it.');
      return;
    }
    setEndOpen(true);
    setSaveMessage('');
  };

  const resetChat = () => {
    setMessages([
      {
        role: 'professor',
        text: 'New chat started. I am Professor KnowItAll and ready to help your business again.',
      },
    ]);
    setPrompt('');
    setError('');
    setEndOpen(false);
  };

  const saveSummary = async () => {
    if (!databaseId) {
      setSaveMessage('❌ No business selected.');
      return;
    }

    setSavingSummary(true);
    setSaveMessage('');
    try {
      const res = await fetch('/api/ai/chat-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId,
          history: messages.map(m => ({ role: m.role === 'professor' ? 'assistant' : 'user', content: m.text })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to save chat summary');

      const s = data.summary;
      setSaveMessage(
        `✅ Saved. Categories: Inventory=${s.inventoryManagement ? 'TRUE' : 'FALSE'}, Marketing=${s.marketing ? 'TRUE' : 'FALSE'}, Business Strategy=${s.businessStrategy ? 'TRUE' : 'FALSE'}, Website Management=${s.websiteManagement ? 'TRUE' : 'FALSE'}`
      );

      setTimeout(() => resetChat(), 1200);
    } catch (e: any) {
      setSaveMessage(`❌ ${e.message}`);
    }
    setSavingSummary(false);
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(previewText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl space-y-5">
      {/* Data Sources */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
        <p className="text-sm font-semibold text-gray-700 mb-2">Include business data</p>
        <div className="flex flex-wrap gap-2">
          <ToggleChip
            label="Previous Chats"
            icon="🧠"
            active={rememberPreviousChats}
            onClick={() => setRememberPreviousChats(v => !v)}
          />
          {AI_DATA_SOURCES.map(source => (
            <ToggleChip
              key={source.id}
              label={source.label}
              icon={source.icon}
              active={!!selected[source.id]}
              onClick={() => setSelected(p => ({ ...p, [source.id]: !p[source.id] }))}
            />
          ))}
        </div>
      </div>

      {/* Chat window */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-bold text-gray-700 mb-1">Live Session Chat</h3>
            <p className="text-xs text-gray-500">Running dialog: Professor KnowItAll and The Business{activeModel ? ` (Model: ${activeModel})` : ''}</p>
          </div>

        </div>

        <div className="border border-gray-200 rounded-xl p-3 bg-gray-50 max-h-96 overflow-y-auto space-y-3 mb-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'business' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-xl px-3 py-2 border ${
                m.role === 'business'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-800 border-gray-200'
              }`}>
                <p className={`text-[11px] font-bold mb-1 ${m.role === 'business' ? 'text-blue-100' : 'text-gray-500'}`}>
                  {m.role === 'business' ? 'The Business' : 'Professor KnowItAll'}
                </p>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.text}</p>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-xl px-3 py-2 border bg-white text-gray-800 border-gray-200">
                <p className="text-[11px] font-bold mb-1 text-gray-500">Professor KnowItAll</p>
                <p className="text-sm">Thinking...</p>
              </div>
            </div>
          )}
        </div>

        <textarea
          value={prompt}
          onChange={e => { setPrompt(e.target.value); setError(''); }}
          placeholder="Ask your next question..."
          rows={4}
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-300 resize-y"
        />
        {error && <p className="text-xs text-red-600 mt-2">❌ {error}</p>}
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={() => callApi(false)}
            disabled={loading || !prompt.trim()}
            className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors"
          >
            {loading ? '⏳ Thinking…' : 'Send Message'}
          </button>
          <button
            onClick={() => callApi(true)}
            disabled={previewLoading || !prompt.trim()}
            className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors"
          >
            {previewLoading ? 'Building…' : 'Preview Full Prompt'}
          </button>
          <div className="ml-auto flex items-center gap-2">
            {saveMessage && <p className="text-xs text-gray-600 max-w-xs truncate">{saveMessage}</p>}
            <button
              onClick={endChat}
              disabled={loading || messages.length <= 1}
              className="px-3 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors"
            >
              End Chat
            </button>
            <button
              onClick={() => { if (messages.length > 1) saveSummary(); }}
              disabled={loading || savingSummary || messages.length <= 1}
              className="px-3 py-2.5 bg-purple-100 hover:bg-purple-200 text-purple-700 text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors"
            >
              {savingSummary ? 'Saving…' : 'End Chat & Remember'}
            </button>
          </div>
        </div>
      </div>

      {/* Preview Dialog */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={e => { if (e.target === e.currentTarget) setPreviewOpen(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-sm font-bold text-gray-800">Full Prompt Preview</h3>
                <p className="text-xs text-gray-500 mt-0.5">This is exactly what will be sent to the AI</p>
              </div>
              <button
                onClick={() => setPreviewOpen(false)}
                className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg font-semibold text-gray-600 transition-colors"
              >Close</button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">{previewText}</pre>
              {previewAttachments.length > 0 && (
                <div className="mt-5 pt-4 border-t border-gray-200">
                  <p className="text-xs font-bold text-gray-600 mb-2">📎 Data Attachments</p>
                  <div className="flex flex-col gap-1.5">
                    {previewAttachments.map(att => (
                      <div key={att.filename} className="flex items-center gap-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          att.mode === 'empty'
                            ? 'bg-gray-100 text-gray-600 border border-gray-200'
                            :
                          att.mode === 'file'
                            ? 'bg-orange-50 text-orange-700 border border-orange-200'
                            : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}>
                          {att.mode === 'empty' ? '∅ Empty' : att.mode === 'file' ? '☁️ File API' : '📝 Inline'}
                        </span>
                        <span className="text-xs text-gray-700 font-medium">{att.label}</span>
                        <span className="text-xs text-gray-400">{att.rowCount.toLocaleString()} rows</span>
                        <button
                          onClick={() => {
                            const blob = new Blob([att.csvContent], { type: 'text/csv' });
                            const url  = URL.createObjectURL(blob);
                            const a    = document.createElement('a');
                            a.href     = url;
                            a.download = att.filename;
                            a.click();
                            setTimeout(() => URL.revokeObjectURL(url), 5000);
                          }}
                          className="text-xs text-purple-600 hover:text-purple-800 hover:underline font-medium"
                        >
                          ↓ {att.filename}
                        </button>
                        <button
                          onClick={() => {
                            const blob = new Blob([att.csvContent], { type: 'text/csv' });
                            const url  = URL.createObjectURL(blob);
                            window.open(url, '_blank');
                            setTimeout(() => URL.revokeObjectURL(url), 10000);
                          }}
                          className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
                        >
                          View ↗
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-3 border-t border-gray-100 flex justify-between items-center">
              <span className="text-xs text-gray-400">{previewText.length.toLocaleString()} characters</span>
              <button
                onClick={copyToClipboard}
                className="text-xs px-3 py-1.5 bg-purple-100 hover:bg-purple-200 text-purple-700 font-semibold rounded-lg transition-colors"
              >
                {copied ? '✅ Copied!' : '📋 Copy to Clipboard'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* End Chat Modal */}
      {endOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={e => { if (e.target === e.currentTarget) setEndOpen(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <h3 className="text-base font-bold text-gray-800">Save Chat Summary?</h3>
            <p className="text-sm text-gray-600 mt-1">
              Save a brief AI summary of this session for future reference in the BusinessChats spreadsheet.
            </p>
            <p className="text-xs text-gray-500 mt-3">
              The summary will also classify this chat as TRUE/FALSE across:
              Inventory management, Marketing, Business strategy, and Website management.
            </p>

            {saveMessage && <p className="text-xs mt-3 text-gray-700">{saveMessage}</p>}

            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                onClick={resetChat}
                disabled={savingSummary}
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-lg"
              >
                End Without Saving
              </button>
              <button
                onClick={saveSummary}
                disabled={savingSummary}
                className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >
                {savingSummary ? 'Saving...' : 'Save Summary'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
// ── Calculated Data View ──────────────────────────────────────────────────
interface BranchRevenue {
  name: string;
  revenue90: number;
  revenue180: number;
  revenue365: number;
}

function CalculatedDataView({ databaseId }: { databaseId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [branches, setBranches] = useState<BranchRevenue[]>([]);
  const [totals, setTotals] = useState<{ revenue90: number; revenue180: number; revenue365: number } | null>(null);
  const [yearlyInputs, setYearlyInputs] = useState<Record<string, Record<string, string>>>({});
  const [savingYearly, setSavingYearly] = useState(false);
  const [yearlyStatus, setYearlyStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Brand summary state
  const [brandRows, setBrandRows] = useState<{ name: string; skuCount: number; totalQty: number; totalCost: number; sales90: number; sales180: number; sales365: number; avgMargin: number | null }[]>([]);
  const [brandTotals, setBrandTotals] = useState<{ skuCount: number; totalQty: number; totalCost: number; sales90: number; sales180: number; sales365: number } | null>(null);
  const [brandSort, setBrandSort] = useState<{ key: 'name' | 'skuCount' | 'totalQty' | 'totalCost' | 'avgMargin' | 'sales90' | 'sales180' | 'sales365'; dir: 'asc' | 'desc' }>({ key: 'sales365', dir: 'desc' });
  const [brandShowAll, setBrandShowAll] = useState(false);
  const [slowShowAll, setSlowShowAll] = useState(false);

  // Slowest sellers state
  const [slowSellers, setSlowSellers] = useState<{ name: string; code: string; brand: string; soh: number; sales90: number; createdDate: string }[]>([]);

  // Sales by month state
  const [salesByMonth, setSalesByMonth] = useState<{ month: string; revenue: number }[]>([]);
  const [onlineSalesByMonth, setOnlineSalesByMonth] = useState<{ month: string; revenue: number; yoyRevenue: number | null; yoyChange: number | null }[]>([]);
  const [onlineTopBrands, setOnlineTopBrands] = useState<{ brand: string; revenue: number; qty: number; orders: number }[]>([]);
  const [onlinePerformance, setOnlinePerformance] = useState<{
    conversionRate: number | null;
    totalSessions: number;
    totalConversions: number;
  } | null>(null);
  const [monthlyRetention, setMonthlyRetention] = useState<{
    month: string;
    totalOrders: number;
    repeatOrders: number;
    retentionRate: number;
    yoyRetentionRate: number | null;
  }[]>([]);

  const currentYear = new Date().getFullYear();
  const yearPeriods = [String(currentYear - 1), String(currentYear - 2), String(currentYear - 3)];

  // Load yearly inputs: API first, fall back to localStorage
  useEffect(() => {
    if (!databaseId) return;
    const lsKey = `marketoir_yearly_revenue_${databaseId}`;
    // Seed from localStorage immediately so UI isn't blank
    try {
      const stored = localStorage.getItem(lsKey);
      if (stored) setYearlyInputs(JSON.parse(stored));
      else setYearlyInputs({});
    } catch { setYearlyInputs({}); }
    // Then fetch from Sheets and merge (Sheets is source of truth)
    fetch(`/api/calculated/yearly-revenue?databaseId=${encodeURIComponent(databaseId)}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data && Object.keys(d.data).length > 0) {
          setYearlyInputs(d.data);
          try { localStorage.setItem(lsKey, JSON.stringify(d.data)); } catch {}
        }
      })
      .catch(() => {});
  }, [databaseId]);

  // Load all panel data from the saved CalcReport sheets
  const loadSavedReports = async () => {
    if (!databaseId) return;
    setLoading(true);
    setReportsLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/calculated/reports?databaseId=${encodeURIComponent(databaseId)}`);
      const d = await res.json();
      if (d.success) {
        setBranches(d.branches ?? []);
        setTotals(d.revTotals ?? null);
        setBrandRows(d.brands ?? []);
        setBrandTotals(d.brandTotals ?? null);
        setSlowSellers(d.slowSellers ?? []);
        setSalesByMonth(d.salesByMonth ?? []);
        setOnlineSalesByMonth(d.onlineSalesByMonth ?? []);
        setOnlineTopBrands(d.onlineTopBrands ?? []);
        setOnlinePerformance(d.onlinePerformance ?? null);
        setMonthlyRetention(d.monthlyRetention ?? []);
        if (d.savedAt) {
          setReportsSavedAt(d.savedAt);
          setLastUpdated(new Date(d.savedAt).toLocaleString());
        }
      } else {
        setError(d.error || 'Failed to load saved reports.');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setReportsLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadSavedReports(); }, [databaseId]);

  const updateYearlyInput = (branch: string, period: string, value: string) => {
    setYearlyStatus('idle');
    setYearlyInputs(prev => {
      const next = { ...prev, [branch]: { ...(prev[branch] ?? {}), [period]: value } };
      try { localStorage.setItem(`marketoir_yearly_revenue_${databaseId}`, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const saveYearlyData = async () => {
    setSavingYearly(true);
    setYearlyStatus('idle');
    try {
      const res = await fetch('/api/calculated/yearly-revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, data: yearlyInputs }),
      });
      const json = await res.json();
      setYearlyStatus(json.success ? 'saved' : 'error');
    } catch {
      setYearlyStatus('error');
    } finally {
      setSavingYearly(false);
    }
  };

  const yearlyTotals = yearPeriods.reduce((acc, p) => {
    acc[p] = branches.reduce((sum, b) => {
      const raw = yearlyInputs[b.name]?.[p] ?? '';
      return sum + (parseFloat(raw.replace(/[^0-9.-]/g, '')) || 0);
    }, 0);
    return acc;
  }, {} as Record<string, number>);

  const [savingReports, setSavingReports] = useState(false);
  const [reportsStatus, setReportsStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [reportsSavedAt, setReportsSavedAt] = useState<string | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);

  const [reportsError, setReportsError] = useState('');

  const resyncReports = async () => {
    if (!databaseId) { setReportsStatus('error'); setReportsError('No business ID — please reload the page.'); return; }
    setSavingReports(true);
    setReportsStatus('idle');
    setReportsError('');
    try {
      const res = await fetch(`/api/calculated/reports?databaseId=${encodeURIComponent(databaseId)}`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setReportsStatus('saved');
        // Reload all panels from the freshly saved data
        await loadSavedReports();
      } else {
        setReportsStatus('error');
        setReportsError(json.error ?? 'Unknown error');
      }
    } catch (e: any) {
      setReportsStatus('error');
      setReportsError(e.message ?? 'Network error');
    } finally {
      setSavingReports(false);
    }
  };

  return (
    <div className="space-y-4">

      {/* Resync Reports banner */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-5 py-3 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-indigo-800">Calculated Reports</p>
          <p className="text-xs text-indigo-600 mt-0.5">
            {reportsLoading
              ? 'Loading saved reports…'
              : reportsSavedAt
                ? `Last saved: ${new Date(reportsSavedAt).toLocaleString()} — resync to update from latest data.`
                : 'No saved reports yet. Click Resync to generate from the latest synced data.'}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {reportsStatus === 'saved' && <span className="text-xs text-green-600 font-medium">✓ Synced</span>}
          {reportsStatus === 'error' && <span className="text-xs text-red-600 font-medium" title={reportsError}>✗ Error{reportsError ? `: ${reportsError}` : ''}</span>}
          <button
            onClick={resyncReports}
            disabled={savingReports || reportsLoading}
            className="text-sm font-medium px-4 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {savingReports ? 'Syncing…' : 'Resync Reports'}
          </button>
        </div>
      </div>
      {/* ── Jump nav ─────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex flex-wrap gap-2">
        {[
          { href: '#report-revenue-branch',   label: '📊 Revenue by Branch' },
          { href: '#report-brand-summary',     label: '🏷️ Brand Summary' },
          { href: '#report-slow-sellers',      label: '🐢 Slowest Sellers' },
          { href: '#report-sales-by-month',    label: '📅 Sales by Month' },
          { href: '#report-online-perf',       label: '🌐 Online Performance' },
          { href: '#report-online-retention',  label: '🔁 Customer Retention' },
          { href: '#report-online-sales',      label: '🛒 Online Sales by Month' },
          { href: '#report-online-brands',     label: '🏆 Online Top Brands' },
        ].map(({ href, label }) => (
          <a
            key={href}
            href={href}
            className="text-xs font-medium px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 hover:bg-indigo-100 hover:text-indigo-700 transition-colors"
          >
            {label}
          </a>
        ))}
      </div>

      <div id="report-revenue-branch" className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-xl">📊</div>
            <div>
              <h2 className="font-bold text-gray-800 text-lg leading-tight">Revenue per Branch <span className="font-normal text-gray-500 text-sm">All Sales Channels, GST exc.</span></h2>
              <p className="text-xs text-gray-500">Last updated: {lastUpdated ?? 'Never'}</p>
            </div>
          </div>

        </div>

        {error && <p className="text-sm text-red-600 mb-4">❌ {error}</p>}
        {loading && <p className="text-sm text-gray-500">Loading…</p>}

        {!loading && branches.length === 0 && !error && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-sm text-gray-500">No saved report data yet. Click <strong>Resync Reports</strong> to generate from the latest synced data.</p>
          </div>
        )}

        {!loading && branches.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-left">
                  <th className="px-4 py-3 font-semibold border-b border-gray-200">Branch</th>
                  <th className="px-4 py-3 font-semibold border-b border-gray-200 text-right">Last 90 Days</th>
                  <th className="px-4 py-3 font-semibold border-b border-gray-200 text-right">Last 180 Days</th>
                  <th className="px-4 py-3 font-semibold border-b border-gray-200 text-right">Last 365 Days</th>
                </tr>
              </thead>
              <tbody>
                {branches.map(branch => (
                  <tr key={branch.name} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">{branch.name}</td>
                    <td className="px-4 py-3 text-right text-gray-700">${branch.revenue90.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 text-right text-gray-700">${branch.revenue180.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 text-right text-gray-700">${branch.revenue365.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
                {totals && (
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-gray-800">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">${totals.revenue90.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 text-right">${totals.revenue180.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 text-right">${totals.revenue365.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!loading && branches.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-700 text-base">Revenue by Calendar Year <span className="font-normal text-gray-400 text-sm">All Sales Channels, GST exc.</span></h3>
              <div className="flex items-center gap-2">
                {yearlyStatus === 'saved' && <span className="text-xs text-green-600">✓ Saved</span>}
                {yearlyStatus === 'error' && <span className="text-xs text-red-500">Save failed</span>}
                <button
                  onClick={saveYearlyData}
                  disabled={savingYearly}
                  className="text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
                  {savingYearly ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-600 text-left">
                    <th className="px-4 py-3 font-semibold border-b border-gray-200">Branch</th>
                    {yearPeriods.map(p => (
                      <th key={p} className="px-4 py-3 font-semibold border-b border-gray-200 text-right">{p}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {branches.map(b => (
                    <tr key={b.name} className="border-b border-gray-100">
                      <td className="px-4 py-3 font-medium text-gray-800">{b.name}</td>
                      {yearPeriods.map(p => (
                        <td key={p} className="px-2 py-1.5 text-right">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={yearlyInputs[b.name]?.[p] ?? ''}
                            onChange={e => updateYearlyInput(b.name, p, e.target.value)}
                            placeholder="0"
                            className="w-full text-right text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-gray-800">
                    <td className="px-4 py-3">Total</td>
                    {yearPeriods.map(p => (
                      <td key={p} className="px-4 py-3 text-right">
                        {yearlyTotals[p] ? `$${yearlyTotals[p].toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Brand Summary panel */}
      <div id="report-brand-summary" className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center text-xl">🏷️</div>
          <div>
            <h2 className="font-bold text-gray-800 text-lg leading-tight">Brand Summary <span className="font-normal text-gray-500 text-sm">All Sales Channels, GST exc.</span></h2>
            <p className="text-xs text-gray-500">SKUs, stock &amp; sales by brand</p>
          </div>
        </div>

        {loading && <p className="text-sm text-gray-500">Loading…</p>}

        {!loading && brandRows.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No saved brand data yet. Click <strong>Resync Reports</strong> to generate from the latest synced data.</p>
        )}

        {!loading && brandRows.length > 0 && (() => {
          const sortedBrands = [...brandRows].sort((a, b) => {
            const av = a[brandSort.key], bv = b[brandSort.key];
            const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
            return brandSort.dir === 'asc' ? cmp : -cmp;
          });
          const toggleSort = (key: typeof brandSort.key) =>
            setBrandSort(prev => prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'name' ? 'asc' : 'desc' });
          const SortIcon = ({ col }: { col: typeof brandSort.key }) =>
            brandSort.key !== col ? <span className="ml-1 text-gray-300">⇅</span>
            : brandSort.dir === 'desc' ? <span className="ml-1">↓</span> : <span className="ml-1">↑</span>;
          const thBase = 'px-4 py-3 font-semibold border-b border-gray-200 cursor-pointer select-none hover:bg-gray-100 transition-colors whitespace-nowrap';
          return (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-left">
                  <th className={thBase} onClick={() => toggleSort('name')}>Brand<SortIcon col="name" /></th>
                  <th className={`${thBase} text-right`} onClick={() => toggleSort('skuCount')}># SKUs<SortIcon col="skuCount" /></th>
                  <th className={`${thBase} text-right`} onClick={() => toggleSort('totalQty')}>Total Qty<SortIcon col="totalQty" /></th>
                  <th className={`${thBase} text-right`} onClick={() => toggleSort('totalCost')}>Total Cost<SortIcon col="totalCost" /></th>
                  <th className={`${thBase} text-right`} onClick={() => toggleSort('avgMargin')}>Avg Margin<SortIcon col="avgMargin" /></th>
                  <th className={`${thBase} text-right`} onClick={() => toggleSort('sales90')}>Sales 90 Days<SortIcon col="sales90" /></th>
                  <th className={`${thBase} text-right`} onClick={() => toggleSort('sales180')}>Sales 180 Days<SortIcon col="sales180" /></th>
                  <th className={`${thBase} text-right`} onClick={() => toggleSort('sales365')}>Sales 365 Days<SortIcon col="sales365" /></th>
                </tr>
              </thead>
              <tbody>
                {(brandShowAll ? sortedBrands : sortedBrands.slice(0, 10)).map(b => (
                  <tr key={b.name} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">{b.name}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{b.skuCount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{b.totalQty.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-700">${b.totalCost.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{b.avgMargin != null ? `${b.avgMargin.toFixed(1)}%` : '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-700">${b.sales90.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-3 text-right text-gray-700">${b.sales180.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-3 text-right text-gray-700">${b.sales365.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                  </tr>
                ))}
                {brandTotals && (
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-gray-800">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">{brandTotals.skuCount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">{brandTotals.totalQty.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">${brandTotals.totalCost.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-3 text-right">—</td>
                    <td className="px-4 py-3 text-right">${brandTotals.sales90.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-3 text-right">${brandTotals.sales180.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-3 text-right">${brandTotals.sales365.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {sortedBrands.length > 10 && (
              <button
                onClick={() => setBrandShowAll(v => !v)}
                className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 py-2 border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <span>{brandShowAll ? '↑ Show less' : `↓ Show all ${sortedBrands.length} brands`}</span>
              </button>
            )}
          </div>
          );
        })()}
      </div>

      {/* ── Slowest Sellers ─────────────────────────────────────────────── */}
      <div id="report-slow-sellers" className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-4">Slowest Sellers <span className="font-normal text-gray-500 text-sm">All Sales Channels, GST exc.</span></h2>
        <p className="text-xs text-gray-400 mb-4">Products created more than 90 days ago with SOH &gt; 2 and the lowest 90-day global revenue. Top 100 synced.</p>

        {loading && <p className="text-sm text-gray-500">Loading…</p>}

        {!loading && slowSellers.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No saved slow-seller data yet. Click <strong>Resync Reports</strong> to generate from the latest synced data.</p>
        )}

        {!loading && slowSellers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-600 text-left">
                  <th className="px-4 py-3 font-semibold border-b border-gray-200">#</th>
                  <th className="px-4 py-3 font-semibold border-b border-gray-200">Product</th>
                  <th className="px-4 py-3 font-semibold border-b border-gray-200">Code</th>
                  <th className="px-4 py-3 font-semibold border-b border-gray-200">Brand</th>
                  <th className="px-4 py-3 font-semibold border-b border-gray-200 text-right">SOH</th>
                  <th className="px-4 py-3 font-semibold border-b border-gray-200 text-right">Sales 90d</th>
                  <th className="px-4 py-3 font-semibold border-b border-gray-200">Created</th>
                </tr>
              </thead>
              <tbody>
                {(slowShowAll ? slowSellers : slowSellers.slice(0, 10)).map((p, i) => (
                  <tr key={p.code || p.name} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-400 text-xs">{i + 1}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{p.name}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{p.code}</td>
                    <td className="px-4 py-3 text-gray-600">{p.brand}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{p.soh.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-700">${p.sales90.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{p.createdDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {slowSellers.length > 10 && (
              <button
                onClick={() => setSlowShowAll(v => !v)}
                className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 py-2 border border-gray-100 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <span>{slowShowAll ? '↑ Show less' : `↓ Show all ${slowSellers.length} products`}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Sales by Month ──────────────────────────────────────────────── */}
      <div id="report-sales-by-month" className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-1">Sales by Month <span className="font-normal text-gray-500 text-sm">All Sales Channels, GST exc.</span></h2>
        <p className="text-xs text-gray-400 mb-4">Overall monthly revenue totals across all branches.</p>

        {loading && <p className="text-sm text-gray-500">Loading…</p>}

        {!loading && salesByMonth.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No saved data yet. Click <strong>Resync Reports</strong> to generate from the latest synced data.</p>
        )}

        {!loading && salesByMonth.length > 0 && (() => {
          const maxRev = Math.max(...salesByMonth.map(r => r.revenue), 1);
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-600 text-left">
                    <th className="px-4 py-3 font-semibold border-b border-gray-200">Month</th>
                    <th className="px-4 py-3 font-semibold border-b border-gray-200 text-right">Revenue</th>
                    <th className="px-4 py-3 font-semibold border-b border-gray-200 w-48">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {salesByMonth.map((r) => {
                    const [year, month] = r.month.split('-');
                    const label = new Date(Number(year), Number(month) - 1).toLocaleString('default', { month: 'short', year: 'numeric' });
                    const pct = Math.round((r.revenue / maxRev) * 100);
                    return (
                      <tr key={r.month} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-700 font-medium">{label}</td>
                        <td className="px-4 py-3 text-right text-gray-800 font-mono">${r.revenue.toLocaleString('en-AU', { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-100 rounded-full h-2">
                              <div className="bg-indigo-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      {/* ── Online Performance: Conversion Rate ────────────────────── */}
      <div id="report-online-perf" className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-1">Online Performance</h2>
        <p className="text-xs text-gray-400 mb-4">Conversion rate from GA4 (last 90 days).</p>
        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {!loading && !onlinePerformance && (
          <p className="text-sm text-gray-400 text-center py-4">No saved data yet. Click <strong>Resync Reports</strong> to generate.</p>
        )}
        {!loading && onlinePerformance && (
          <div className="bg-emerald-50 rounded-xl p-4 flex flex-col gap-1 max-w-xs">
            <span className="text-xs text-emerald-600 font-semibold uppercase tracking-wide">Conversion Rate</span>
            {onlinePerformance.conversionRate != null ? (
              <>
                <span className="text-3xl font-bold text-emerald-700">{onlinePerformance.conversionRate.toFixed(2)}%</span>
                <span className="text-xs text-gray-500 mt-1">
                  {Math.round(onlinePerformance.totalConversions).toLocaleString()} purchases from{' '}
                  {onlinePerformance.totalSessions.toLocaleString()} sessions (last 90 days)
                </span>
              </>
            ) : (
              <>
                <span className="text-2xl font-bold text-gray-400">N/A</span>
                <span className="text-xs text-gray-400 mt-1">GA4 not connected or no session data</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Customer Retention by Month ──────────────────────────────── */}
      <div id="report-online-retention" className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-1">Customer Retention by Month <span className="font-normal text-gray-500 text-sm">Online Sales Channel Only</span></h2>
        <p className="text-xs text-gray-400 mb-4">% of orders placed by returning customers (orders_count &gt; 1), sourced from synced Shopify orders. Prior year shown below each month in grey.</p>
        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {!loading && monthlyRetention.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No saved data yet. Sync your Shopify orders first, then click <strong>Resync Reports</strong> to generate.</p>
        )}
        {!loading && monthlyRetention.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left text-xs font-semibold">
                  <th className="px-4 py-2 border-b border-gray-200">Month</th>
                  <th className="px-4 py-2 border-b border-gray-200 text-right">Retention Rate</th>
                  <th className="px-4 py-2 border-b border-gray-200 text-right">Returning / Total</th>
                  <th className="px-4 py-2 border-b border-gray-200 text-right">YoY</th>
                </tr>
              </thead>
              <tbody>
                {monthlyRetention.slice(-12).reverse().map((r) => {
                  const [yr, mo] = r.month.split('-');
                  const label     = new Date(Number(yr),     Number(mo) - 1).toLocaleString('default', { month: 'short', year: 'numeric' });
                  const prevLabel = new Date(Number(yr) - 1, Number(mo) - 1).toLocaleString('default', { month: 'short', year: 'numeric' });
                  const yoyPp = r.yoyRetentionRate != null ? r.retentionRate - r.yoyRetentionRate : null;
                  const isUp   = yoyPp != null && yoyPp > 0;
                  const isDown = yoyPp != null && yoyPp < 0;
                  return (
                    <tr key={r.month} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-800">{label}</div>
                        <div className="text-xs text-gray-300 mt-0.5">{prevLabel}</div>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="font-bold text-amber-600">{r.retentionRate.toFixed(1)}%</div>
                        <div className="text-xs text-gray-300 mt-0.5">{r.yoyRetentionRate != null ? `${r.yoyRetentionRate.toFixed(1)}%` : '—'}</div>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="text-gray-700">{r.repeatOrders.toLocaleString()} / {r.totalOrders.toLocaleString()}</div>
                        <div className="text-xs text-gray-300 mt-0.5">&nbsp;</div>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className={`text-sm font-semibold ${isUp ? 'text-emerald-600' : isDown ? 'text-red-500' : 'text-gray-400'}`}>
                          {yoyPp != null ? `${yoyPp >= 0 ? '+' : ''}${yoyPp.toFixed(1)}pp` : '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Online Sales by Month ────────────────────────────────────── */}
      <div id="report-online-sales" className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-1">Online Sales by Month <span className="font-normal text-gray-500 text-sm">Online Sales Channel Only</span></h2>
        <p className="text-xs text-gray-400 mb-4">Monthly revenue from synced Shopify orders. Prior year shown below each month in grey.</p>

        {loading && <p className="text-sm text-gray-500">Loading…</p>}

        {!loading && onlineSalesByMonth.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No saved data yet. Sync your Shopify orders first, then click <strong>Resync Reports</strong> to generate.</p>
        )}

        {!loading && onlineSalesByMonth.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left text-xs font-semibold">
                  <th className="px-4 py-2 border-b border-gray-200">Month</th>
                  <th className="px-4 py-2 border-b border-gray-200 text-right">Revenue</th>
                  <th className="px-4 py-2 border-b border-gray-200 text-right">YoY</th>
                </tr>
              </thead>
              <tbody>
                {onlineSalesByMonth.slice(-12).reverse().map((r) => {
                  const [yr, mo] = r.month.split('-');
                  const label     = new Date(Number(yr),     Number(mo) - 1).toLocaleString('default', { month: 'short', year: 'numeric' });
                  const prevLabel = new Date(Number(yr) - 1, Number(mo) - 1).toLocaleString('default', { month: 'short', year: 'numeric' });
                  const isUp   = r.yoyChange != null && r.yoyChange > 0;
                  const isDown = r.yoyChange != null && r.yoyChange < 0;
                  return (
                    <tr key={r.month} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-800">{label}</div>
                        <div className="text-xs text-gray-300 mt-0.5">{prevLabel}</div>
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        <div className="font-bold text-emerald-600">${r.revenue.toLocaleString('en-AU', { minimumFractionDigits: 2 })}</div>
                        <div className="text-xs text-gray-300 mt-0.5">
                          {r.yoyRevenue != null ? `$${r.yoyRevenue.toLocaleString('en-AU', { minimumFractionDigits: 2 })}` : '—'}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className={`text-sm font-semibold ${isUp ? 'text-emerald-600' : isDown ? 'text-red-500' : 'text-gray-400'}`}>
                          {r.yoyChange != null ? `${r.yoyChange >= 0 ? '+' : ''}${r.yoyChange.toFixed(1)}%` : '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Online Sales Top 20 Brands ──────────────────────────────── */}
      <div id="report-online-brands" className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-1">Online Sales — Top 20 Brands <span className="font-normal text-gray-500 text-sm">Online Sales Channel Only</span></h2>
        <p className="text-xs text-gray-400 mb-4">Revenue, units sold, and order count per brand from the Shopify (online) channel.</p>

        {loading && <p className="text-sm text-gray-500">Loading…</p>}

        {!loading && onlineTopBrands.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No saved data yet. Click <strong>Resync Reports</strong> to generate from the latest synced data.</p>
        )}

        {!loading && onlineTopBrands.length > 0 && (() => {
          const maxRev = Math.max(...onlineTopBrands.map(b => b.revenue), 1);
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-600 text-left">
                    <th className="px-4 py-3 font-semibold border-b border-gray-200 w-6 text-center">#</th>
                    <th className="px-4 py-3 font-semibold border-b border-gray-200">Brand</th>
                    <th className="px-4 py-3 font-semibold border-b border-gray-200 text-right">Revenue</th>
                    <th className="px-4 py-3 font-semibold border-b border-gray-200 text-right">Units</th>
                    <th className="px-4 py-3 font-semibold border-b border-gray-200 text-right">Orders</th>
                    <th className="px-4 py-3 font-semibold border-b border-gray-200 w-40">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {onlineTopBrands.map((b, idx) => {
                    const pct = Math.round((b.revenue / maxRev) * 100);
                    return (
                      <tr key={b.brand} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-400 text-center text-xs">{idx + 1}</td>
                        <td className="px-4 py-3 text-gray-800 font-medium">{b.brand}</td>
                        <td className="px-4 py-3 text-right text-gray-800 font-mono">${b.revenue.toLocaleString('en-AU', { minimumFractionDigits: 2 })}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{b.qty.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{b.orders.toLocaleString()}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-100 rounded-full h-2">
                              <div className="bg-teal-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

    </div>
  );
}

// ── Brand Assets ─────────────────────────────────────────────────────────────
type BrandAssetCategory = {
  id: string;
  label: string;
  description: string;
  icon: string;
  accentColor: string;
};

const BRAND_ASSET_CATEGORIES: BrandAssetCategory[] = [
  {
    id: 'models',
    label: 'Models',
    description: 'Manage model images and profiles used across visual content and campaigns.',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>`,
    accentColor: '#0ea5e9',
  },
  {
    id: 'backdrops',
    label: 'Backdrops',
    description: 'Organise backdrop and background images for product and promotional photography.',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 15l-5-5L5 21"/></svg>`,
    accentColor: '#8b5cf6',
  },
  {
    id: 'templates',
    label: 'Templates',
    description: 'Store and reuse design and content templates across your brand communications.',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`,
    accentColor: '#f59e0b',
  },
];

type BrandAsset = { id: number; category: string; name: string; content: string; notes?: string | null; created_at: string };
type AssetChatMsg = { role: 'user' | 'assistant'; text: string };

function BrandAssetsView({ activeCategory, databaseId }: { activeCategory?: string; databaseId: string }): React.JSX.Element {
  const filteredCategories = activeCategory
    ? BRAND_ASSET_CATEGORIES.filter(c => c.id === activeCategory)
    : BRAND_ASSET_CATEGORIES;

  const [assetsByCategory, setAssetsByCategory] = useState<Record<string, BrandAsset[]>>({ models: [], backdrops: [], templates: [] });
  const [assetsLoading, setAssetsLoading] = useState(false);

  // AI panel
  const [aiOpen, setAiOpen] = useState(false);
  const [aiCategory, setAiCategory] = useState('');
  const [chatMsgs, setChatMsgs] = useState<AssetChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');

  // Context toggles
  const [useBrandProfile, setUseBrandProfile] = useState(true);
  const [useBusinessInfo, setUseBusinessInfo] = useState(true);
  const [useExisting, setUseExisting] = useState(false);

  // Target image model
  const [imageModel, setImageModel] = useState('gemini-3.1-flash-image');

  // Creative Intelligence Brief
  const [useCreativeHistory, setUseCreativeHistory] = useState(false);
  const [creativeSummary, setCreativeSummary] = useState('');
  const [pendingWords, setPendingWords] = useState(0);
  const [showContextPreview, setShowContextPreview] = useState(false);
  const [contextPreviewText, setContextPreviewText] = useState('');
  const [contextPreviewLoading, setContextPreviewLoading] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);
  const [editSummaryText, setEditSummaryText] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);

  // Save flow
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [saveName, setSaveName] = useState('');
  const [savedIdx, setSavedIdx] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  // Image generation
  const [generatingImageIdx, setGeneratingImageIdx] = useState<number | null>(null);
  const [generatedImages, setGeneratedImages] = useState<Record<number, { data: string; mimeType: string }>>({});
  const [imageErrors, setImageErrors] = useState<Record<number, string>>({});

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMsgs, chatLoading]);

  useEffect(() => {
    if (!databaseId) return;
    loadAssets();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [databaseId]);

  const loadAssets = async () => {
    setAssetsLoading(true);
    try {
      const res = await fetch('/api/dashboard/brand-assets');
      const data = await res.json();
      if (data.success) {
        const grouped: Record<string, BrandAsset[]> = { models: [], backdrops: [], templates: [] };
        for (const a of (data.assets as BrandAsset[])) {
          if (grouped[a.category]) grouped[a.category].push(a);
        }
        setAssetsByCategory(grouped);
      }
    } catch { /* silent */ }
    setAssetsLoading(false);
  };

  const openAiPanel = (category: string) => {
    setAiCategory(category);
    setChatMsgs([]);
    setChatInput('');
    setChatError('');
    setSavingIdx(null);
    setSaveName('');
    setSavedIdx(null);
    setShowContextPreview(false);
    setContextPreviewText('');
    setEditingSummary(false);
    setAiOpen(true);
    // Fetch creative brief in background
    if (databaseId) {
      fetch(`/api/dashboard/creative-summary?databaseId=${encodeURIComponent(databaseId)}`)
        .then(r => r.json())
        .then(d => {
          setCreativeSummary(d.summary ?? '');
          setPendingWords(d.pendingWords ?? 0);
          setUseCreativeHistory(!!(d.summary?.trim()));
        })
        .catch(() => {});
    }
  };

  const refreshContextPreview = async () => {
    if (!showContextPreview) return;
    setContextPreviewLoading(true);
    try {
      const res = await fetch('/api/ai/brand-asset-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId,
          prompt: '(preview)',
          category: aiCategory,
          imageModel,
          includeBrandProfile: useBrandProfile,
          includeBusinessInfo: useBusinessInfo,
          includeExistingAssets: useExisting,
          includeCreativeHistory: useCreativeHistory,
          previewOnly: true,
          history: [],
        }),
      });
      const data = await res.json();
      if (data.contextBlock) setContextPreviewText(data.contextBlock);
    } catch {}
    setContextPreviewLoading(false);
  };

  const saveBriefEdit = async () => {
    setSavingSummary(true);
    try {
      await fetch('/api/dashboard/creative-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, summary: editSummaryText }),
      });
      setCreativeSummary(editSummaryText);
      setEditingSummary(false);
    } catch {}
    setSavingSummary(false);
  };

  const sendChat = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput('');
    setChatError('');
    const nextMsgs: AssetChatMsg[] = [...chatMsgs, { role: 'user', text: msg }];
    setChatMsgs(nextMsgs);
    setChatLoading(true);
    try {
      const res = await fetch('/api/ai/brand-asset-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId,
          prompt: msg,
          category: aiCategory,
          imageModel,
          includeBrandProfile: useBrandProfile,
          includeBusinessInfo: useBusinessInfo,
          includeExistingAssets: useExisting,
          includeCreativeHistory: useCreativeHistory,
          history: nextMsgs.slice(0, -1).map(m => ({ role: m.role, content: m.text })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'AI error');
      setChatMsgs(prev => [...prev, { role: 'assistant', text: data.response }]);
    } catch (e: any) {
      setChatError(e.message);
    }
    setChatLoading(false);
  };

  const deleteAsset = async (id: number, category: string) => {
    await fetch(`/api/dashboard/brand-assets/${id}`, { method: 'DELETE' });
    setAssetsByCategory(prev => ({ ...prev, [category]: (prev[category] ?? []).filter(a => a.id !== id) }));
  };

  const generateImage = async (msgIdx: number) => {
    const prompt = chatMsgs[msgIdx].text;
    setGeneratingImageIdx(msgIdx);
    setImageErrors(prev => { const n = { ...prev }; delete n[msgIdx]; return n; });
    try {
      const res = await fetch('/api/ai/brand-asset-generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, imageModel }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Image generation failed');
      setGeneratedImages(prev => ({ ...prev, [msgIdx]: { data: data.imageData, mimeType: data.mimeType } }));
    } catch (e: any) {
      setImageErrors(prev => ({ ...prev, [msgIdx]: e.message }));
    }
    setGeneratingImageIdx(null);
  };

  const confirmSave = async (msgIdx: number) => {
    if (!saveName.trim()) return;
    const res = await fetch('/api/dashboard/brand-assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: aiCategory, name: saveName.trim(), content: chatMsgs[msgIdx].text }),
    });
    const data = await res.json();
    if (data.success) {
      await loadAssets();
      setSavedIdx(msgIdx);
      setSavingIdx(null);
      setSaveName('');
      setTimeout(() => setSavedIdx(null), 4000);
    }
  };

  const catInfo = BRAND_ASSET_CATEGORIES.find(c => c.id === aiCategory);

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      {/* Left: category sections */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        {filteredCategories.map(cat => {
          const catAssets = assetsByCategory[cat.id] ?? [];
          return (
            <div key={cat.id} style={{ background: 'var(--sv-bg-2, #fff)', border: '1px solid var(--sv-etch, #e5e7eb)', borderRadius: 14, overflow: 'hidden' }}>
              {/* Category header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px', borderBottom: catAssets.length > 0 ? '1px solid var(--sv-etch, #e5e7eb)' : 'none' }}>
                <div style={{ width: 40, height: 40, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: cat.accentColor + '18', color: cat.accentColor, flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: cat.icon }} />
                <div style={{ flex: 1 }}>
                  <h3 style={{ fontWeight: 700, fontSize: 15, color: 'var(--sv-text-strong, #111827)', margin: 0 }}>{cat.label}</h3>
                  <p style={{ fontSize: 12, color: 'var(--sv-text-dim, #6b7280)', margin: '3px 0 0', lineHeight: 1.4 }}>{cat.description}</p>
                </div>
                <button
                  onClick={() => openAiPanel(cat.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 8, background: cat.accentColor + '12', border: `1px solid ${cat.accentColor}44`, color: cat.accentColor, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  <span>✨</span> Create with AI
                </button>
              </div>

              {/* Asset cards */}
              {catAssets.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12, padding: 16 }}>
                  {catAssets.map(asset => (
                    <div key={asset.id} style={{ background: 'var(--sv-bg-1, #f9fafb)', border: '1px solid var(--sv-etch, #e5e7eb)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--sv-text-strong, #111827)', lineHeight: 1.3 }}>{asset.name}</span>
                        <button
                          onClick={() => deleteAsset(asset.id, cat.id)}
                          title="Remove asset"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px 4px', borderRadius: 4, fontSize: 15, lineHeight: 1, flexShrink: 0 }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}
                        >×</button>
                      </div>
                      <p style={{ fontSize: 11, color: 'var(--sv-text-dim, #6b7280)', lineHeight: 1.5, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' } as any}>{asset.content}</p>
                      <span style={{ fontSize: 10, color: '#9ca3af' }}>{new Date(asset.created_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}

              {catAssets.length === 0 && !assetsLoading && (
                <div style={{ padding: '14px 20px' }}>
                  <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>No {cat.label.toLowerCase()} prompts yet — use AI to create your first.</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Right: AI chat panel */}
      {aiOpen && catInfo && (
        <div style={{ width: 420, flexShrink: 0, background: 'var(--sv-bg-2, #fff)', border: '1px solid var(--sv-etch, #e5e7eb)', borderRadius: 14, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 180px)', position: 'sticky', top: 20 }}>
          {/* Panel header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--sv-etch, #e5e7eb)', flexShrink: 0 }}>
            <span style={{ color: catInfo.accentColor, fontSize: 18 }}>✨</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 700, fontSize: 14, margin: 0, color: 'var(--sv-text-strong, #111827)' }}>Create {catInfo.label} Asset</p>
              <p style={{ fontSize: 11, margin: 0, color: '#9ca3af' }}>Generates image generation prompts</p>
            </div>
            <button
              onClick={() => {
                setAiOpen(false);
                // Fire-and-forget: append conversation to pending buffer
                if (chatMsgs.length >= 2 && databaseId) {
                  fetch('/api/ai/brand-asset-update-summary', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ databaseId, conversation: chatMsgs.map(m => ({ role: m.role, text: m.text })) }),
                  }).catch(() => {});
                }
              }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 18, lineHeight: 1, padding: '2px 6px' }}
            >×</button>
          </div>

          {/* Context toggles + image model */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--sv-etch, #e5e7eb)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', margin: '0 0 7px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pass brand context</p>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {[
                  { label: 'Brand Profile', value: useBrandProfile, toggle: () => setUseBrandProfile(p => !p), color: '#8b5cf6' },
                  { label: 'Business Info', value: useBusinessInfo, toggle: () => setUseBusinessInfo(p => !p), color: '#0ea5e9' },
                  { label: `Existing ${catInfo.label}`, value: useExisting, toggle: () => setUseExisting(p => !p), color: catInfo.accentColor },
                  { label: 'Creative History', value: useCreativeHistory, toggle: () => setUseCreativeHistory(p => !p), color: '#10b981' },
                ].map(item => (
                  <button key={item.label} onClick={item.toggle} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, border: `1px solid ${item.value ? item.color : '#d1d5db'}`, background: item.value ? item.color + '15' : 'transparent', color: item.value ? item.color : '#6b7280', cursor: 'pointer', transition: 'all .15s' }}>
                    {item.value ? '✓ ' : ''}{item.label}
                  </button>
                ))}
              </div>
              {/* Pending words indicator */}
              {pendingWords > 0 && (
                <p style={{ fontSize: 10, color: '#f59e0b', margin: '5px 0 0' }}>⏳ {pendingWords} words queued — brief updates at 500</p>
              )}
              {useCreativeHistory && creativeSummary && (
                <div style={{ marginTop: 8 }}>
                  {editingSummary ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <textarea
                        value={editSummaryText}
                        onChange={e => setEditSummaryText(e.target.value)}
                        rows={6}
                        style={{ fontSize: 11, padding: '8px 10px', borderRadius: 7, border: '1px solid #86efac', background: 'var(--sv-bg-1,#f9fafb)', color: 'var(--sv-text-strong,#111827)', resize: 'vertical', outline: 'none', lineHeight: 1.5 }}
                      />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={saveBriefEdit} disabled={savingSummary} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, background: '#10b981', color: '#fff', border: 'none', cursor: 'pointer', opacity: savingSummary ? 0.6 : 1 }}>{savingSummary ? 'Saving…' : 'Save Brief'}</button>
                        <button onClick={() => setEditingSummary(false)} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, background: 'none', border: '1px solid #e5e7eb', cursor: 'pointer', color: '#6b7280' }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 7, padding: '8px 10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#16a34a' }}>📚 Creative Brief</span>
                        <button onClick={() => { setEditSummaryText(creativeSummary); setEditingSummary(true); }} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'none', border: '1px solid #86efac', cursor: 'pointer', color: '#16a34a' }}>✎ Edit</button>
                      </div>
                      <p style={{ fontSize: 11, color: '#166534', margin: 0, lineHeight: 1.5, maxHeight: 80, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' } as any}>{creativeSummary}</p>
                    </div>
                  )}
                </div>
              )}
              {useCreativeHistory && !creativeSummary && (
                <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 5 }}>No brief yet — will be generated after ~500 words of creative conversations.</p>
              )}
            </div>
            {/* View Context expandable */}
            <div>
              <button
                onClick={async () => {
                  const next = !showContextPreview;
                  setShowContextPreview(next);
                  if (next && !contextPreviewText) {
                    setContextPreviewLoading(true);
                    try {
                      const res = await fetch('/api/ai/brand-asset-chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ databaseId, prompt: '(preview)', category: aiCategory, imageModel, includeBrandProfile: useBrandProfile, includeBusinessInfo: useBusinessInfo, includeExistingAssets: useExisting, includeCreativeHistory: useCreativeHistory, previewOnly: true, history: [] }),
                      });
                      const d = await res.json();
                      if (d.contextBlock) setContextPreviewText(d.contextBlock);
                    } catch {}
                    setContextPreviewLoading(false);
                  }
                }}
                style={{ fontSize: 10, fontWeight: 600, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <span style={{ transition: 'transform .15s', display: 'inline-block', transform: showContextPreview ? 'rotate(90deg)' : 'rotate(0)' }}>▶</span>
                View full context being sent to AI
              </button>
              {showContextPreview && (
                <div style={{ marginTop: 6, position: 'relative' }}>
                  {contextPreviewLoading ? (
                    <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>Loading…</p>
                  ) : (
                    <pre style={{ fontSize: 10, lineHeight: 1.55, background: '#1e293b', color: '#94a3b8', borderRadius: 8, padding: '10px 12px', maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{contextPreviewText || '(no context selected)'}</pre>
                  )}
                  <button onClick={refreshContextPreview} style={{ marginTop: 4, fontSize: 10, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>↻ Refresh</button>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>Target model</p>
              <select
                value={imageModel}
                onChange={e => setImageModel(e.target.value)}
                style={{ flex: 1, fontSize: 11, padding: '4px 8px', borderRadius: 7, border: '1px solid var(--sv-etch, #e5e7eb)', background: 'var(--sv-bg-1, #f9fafb)', color: 'var(--sv-text-strong, #111827)', cursor: 'pointer', outline: 'none' }}
              >
                <optgroup label="Nano Banana (recommended)">
                  <option value="gemini-3.1-flash-image">Nano Banana 2 — Gemini 3.1 Flash Image</option>
                  <option value="gemini-3-pro-image">Nano Banana Pro — Gemini 3 Pro Image</option>
                  <option value="gemini-3.1-flash-lite-image">Nano Banana 2 Lite — Gemini 3.1 Flash Lite Image</option>
                  <option value="gemini-2.5-flash-image">Nano Banana (legacy) — Gemini 2.5 Flash Image</option>
                </optgroup>
                <optgroup label="Imagen 4 (deprecated Aug 2026)">
                  <option value="imagen-4.0-generate-001">Imagen 4 Standard ⚠️</option>
                  <option value="imagen-4.0-ultra-generate-001">Imagen 4 Ultra ⚠️</option>
                  <option value="imagen-4.0-fast-generate-001">Imagen 4 Fast ⚠️</option>
                </optgroup>
                <optgroup label="Other">
                  <option value="other">Other / Generic</option>
                </optgroup>
              </select>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {chatMsgs.length === 0 && (
              <div style={{ textAlign: 'center', padding: '28px 10px' }}>
                <p style={{ fontSize: 22, margin: '0 0 10px' }}>✨</p>
                <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 8px', lineHeight: 1.6 }}>
                  Describe what you need and the AI will write a ready-to-use image generation prompt tailored to your brand.
                </p>
                <p style={{ fontSize: 11, color: '#9ca3af', margin: 0, lineHeight: 1.5 }}>
                  Copy the result into <strong>Nano Banana 2</strong>, Midjourney, DALL-E or any other image generator.
                </p>
              </div>
            )}

            {chatMsgs.map((msg, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth: '93%', borderRadius: 12, padding: '10px 14px', background: msg.role === 'user' ? catInfo.accentColor : 'var(--sv-bg-1, #f9fafb)', border: `1px solid ${msg.role === 'user' ? catInfo.accentColor : 'var(--sv-etch, #e5e7eb)'}`, color: msg.role === 'user' ? '#fff' : 'var(--sv-text, #1f2937)' }}>
                  <p style={{ fontSize: 10, fontWeight: 700, margin: '0 0 5px', opacity: 0.65 }}>{msg.role === 'user' ? 'You' : 'AI Creative Director'}</p>
                  <div style={{ fontSize: 12, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.text}</div>
                </div>

                {/* Generated image */}
                {msg.role === 'assistant' && generatedImages[i] && (
                  <div style={{ marginTop: 8, maxWidth: '93%' }}>
                    <img
                      src={`data:${generatedImages[i].mimeType};base64,${generatedImages[i].data}`}
                      alt="AI generated"
                      style={{ width: '100%', borderRadius: 10, border: '1px solid var(--sv-etch, #e5e7eb)', display: 'block' }}
                    />
                    <button
                      onClick={() => {
                        const a = document.createElement('a');
                        a.href = `data:${generatedImages[i].mimeType};base64,${generatedImages[i].data}`;
                        a.download = `brand-asset-${Date.now()}.png`;
                        a.click();
                      }}
                      style={{ marginTop: 6, fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #d1d5db', background: 'none', color: '#6b7280', cursor: 'pointer' }}
                    >⤓ Download
                    </button>
                  </div>
                )}
                {msg.role === 'assistant' && imageErrors[i] && (
                  <p style={{ marginTop: 6, fontSize: 11, color: '#ef4444', maxWidth: '93%' }}>⚠️ {imageErrors[i]}</p>
                )}

                {/* Save flow for AI responses */}
                {msg.role === 'assistant' && (
                  <div style={{ marginTop: 6, maxWidth: '93%' }}>
                    {savedIdx === i ? (
                      <span style={{ fontSize: 11, color: '#10b981', fontWeight: 600 }}>✓ Saved to {catInfo.label}</span>
                    ) : savingIdx === i ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="text"
                          value={saveName}
                          onChange={e => setSaveName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') confirmSave(i); if (e.key === 'Escape') setSavingIdx(null); }}
                          placeholder="Asset name…"
                          // eslint-disable-next-line jsx-a11y/no-autofocus
                          autoFocus
                          style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, border: `1px solid ${catInfo.accentColor}66`, background: 'var(--sv-bg-2, #fff)', color: 'var(--sv-text-strong, #111827)', outline: 'none', flex: 1 }}
                        />
                        <button onClick={() => confirmSave(i)} disabled={!saveName.trim()} style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 6, background: catInfo.accentColor, color: '#fff', border: 'none', cursor: 'pointer', opacity: saveName.trim() ? 1 : 0.45 }}>Save</button>
                        <button onClick={() => setSavingIdx(null)} style={{ fontSize: 11, padding: '5px 8px', borderRadius: 6, background: 'none', border: '1px solid #e5e7eb', cursor: 'pointer', color: '#6b7280' }}>✕</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(msg.text).then(() => {
                              setCopiedIdx(i);
                              setTimeout(() => setCopiedIdx(null), 2000);
                            });
                          }}
                          style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, background: copiedIdx === i ? '#f0fdf4' : 'none', border: `1px solid ${copiedIdx === i ? '#86efac' : '#d1d5db'}`, color: copiedIdx === i ? '#16a34a' : '#6b7280', cursor: 'pointer', transition: 'all .15s' }}
                        >
                          {copiedIdx === i ? '✓ Copied' : '📋 Copy prompt'}
                        </button>
                        <button
                          onClick={() => generateImage(i)}
                          disabled={generatingImageIdx === i}
                          style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, background: generatingImageIdx === i ? '#f3f4f6' : catInfo.accentColor + '15', border: `1px solid ${catInfo.accentColor}44`, color: generatingImageIdx === i ? '#9ca3af' : catInfo.accentColor, cursor: generatingImageIdx === i ? 'not-allowed' : 'pointer', transition: 'all .15s' }}
                        >
                          {generatingImageIdx === i ? '⏳ Generating…' : '🎨 Generate Image'}
                        </button>
                        <button onClick={() => { setSavingIdx(i); setSaveName(''); }} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, background: 'none', border: `1px solid ${catInfo.accentColor}44`, color: catInfo.accentColor, cursor: 'pointer' }}>
                          + Save as Asset
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {chatLoading && (
              <div style={{ display: 'flex' }}>
                <div style={{ borderRadius: 12, padding: '10px 14px', background: 'var(--sv-bg-1, #f9fafb)', border: '1px solid var(--sv-etch, #e5e7eb)' }}>
                  <p style={{ fontSize: 10, fontWeight: 700, margin: '0 0 4px', color: '#9ca3af' }}>AI Creative Director</p>
                  <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>Creating your prompt…</p>
                </div>
              </div>
            )}

            {chatError && (
              <p style={{ fontSize: 11, color: '#ef4444', padding: '6px 10px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fecaca', margin: 0 }}>⚠️ {chatError}</p>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--sv-etch, #e5e7eb)', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                placeholder={`Describe the ${catInfo.label.toLowerCase()} prompt you need…`}
                rows={2}
                style={{ flex: 1, fontSize: 12, padding: '8px 12px', borderRadius: 9, border: '1px solid var(--sv-etch, #e5e7eb)', background: 'var(--sv-bg-1, #f9fafb)', color: 'var(--sv-text-strong, #111827)', outline: 'none', resize: 'none', lineHeight: 1.5 }}
              />
              <button
                onClick={sendChat}
                disabled={!chatInput.trim() || chatLoading}
                style={{ padding: '8px 14px', borderRadius: 9, border: 'none', background: chatInput.trim() && !chatLoading ? catInfo.accentColor : '#e5e7eb', color: chatInput.trim() && !chatLoading ? '#fff' : '#9ca3af', fontWeight: 700, fontSize: 14, cursor: chatInput.trim() && !chatLoading ? 'pointer' : 'not-allowed', transition: 'all .15s', flexShrink: 0 }}
              >↑</button>
            </div>
            <p style={{ fontSize: 10, color: '#9ca3af', margin: '5px 0 0' }}>Enter to send · Shift+Enter for new line</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [activeView, setActiveView] = useState('home');
  const [setupComplete, setSetupComplete] = useState(false);
  const [connectionsDone, setConnectionsDone] = useState(false);
  const [businessInfoDone, setBusinessInfoDone] = useState(false);
  const [databaseId, setDatabaseId] = useState('');
  const [userName, setUserName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSettingView, setActiveSettingView] = useState('appearance');

  // Load first business and current user on mount; redirect to /login if session expired
  useEffect(() => {
    fetch('/api/user/businesses')
      .then(r => {
        if (r.status === 401) { window.location.href = '/login'; return null; }
        return r.json();
      })
      .then(d => {
        if (!d) return;
        if (d.success && d.businesses?.length > 0) {
          setDatabaseId(d.businesses[0].databaseId);
          setBusinessName(d.businesses[0].name);
        }
      })
      .catch(() => {});
    fetch('/api/user/me')
      .then(r => {
        if (r.status === 401) { window.location.href = '/login'; return null; }
        return r.json();
      })
      .then(d => { if (d?.name) setUserName(d.name); })
      .catch(() => {});
  }, []);

  // Persist checklist state in localStorage
  useEffect(() => {
    const stored = localStorage.getItem('marketoir_setup_checklist');
    if (stored) {
      try {
        const { setupComplete, connectionsDone, businessInfoDone } = JSON.parse(stored);
        setSetupComplete(!!setupComplete);
        setConnectionsDone(!!connectionsDone);
        setBusinessInfoDone(!!businessInfoDone);
      } catch {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      'marketoir_setup_checklist',
      JSON.stringify({ setupComplete, connectionsDone, businessInfoDone })
    );
  }, [setupComplete, connectionsDone, businessInfoDone]);

  const titles: Record<string, string> = {
    home: 'Reports',
    'ai-helper': 'AI Business Helper',
    'inactive-candidates': 'Inactive Candidates',
    'lost-candidates': 'Possible Losses',
    'marketing-assistant': 'Marketing Assistant',
    'campaign-audit':       'Campaign Architecture Audit',
    'product-description-template': 'Web Field Templates',
    'bulk-edit-listings':           'Bulk Edit Website Listings',
    'cs-inbox':     'Customer Service — Inbox',
    'cs-compose':   'Customer Service — Compose Email',
    'cs-templates': 'Customer Service — Email Templates',
    appearance: 'Appearance',
    connections: 'Connections',
    'marketing-settings': 'Marketing Settings',
    'business-info': 'Business Info',
    'brand-profile': 'Brand Profile',
    'sync-data': 'Sync Data',
    'brand-assets': 'Brand Assets',
    'brand-assets-models': 'Brand Assets — Models',
    'brand-assets-backdrops': 'Brand Assets — Backdrops',
    'brand-assets-templates': 'Brand Assets — Templates',
  };

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  return (
    <div className="h-screen overflow-hidden flex flex-col solvantis-shell">
      {/* Top bar */}
      <header className="h-14 flex items-center justify-between px-6 shrink-0 sticky top-0 z-30 backdrop-blur-md solvantis-topbar">
        <div className="flex items-center gap-0 shrink-0">
          {/* Brand icon */}
          <svg width="24" height="24" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0 mr-2">
            <path d="M14 2L24 7.5V20.5L14 26L4 20.5V7.5L14 2Z" fill="#1ea8c2" fillOpacity="0.15" stroke="#1ea8c2" strokeWidth="1.5"/>
            <path d="M16.5 8H12L10.5 14H13.5L11.5 20L19 12.5H15L16.5 8Z" fill="#1ea8c2"/>
          </svg>
          {/* App switcher */}
          <span style={{ color: '#1ea8c2', fontWeight: 700, fontSize: 16, letterSpacing: -.3 }}>Solvantis</span>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: -.3, color: 'var(--sv-topbar-text, white)', marginLeft: 4 }}>Foresight</span>
          <span style={{ color: 'rgba(255,255,255,.25)', margin: '0 8px', fontSize: 13 }}>|</span>
          <a href="/ims" style={{ fontSize: 13, color: 'rgba(255,255,255,.45)', textDecoration: 'none', fontWeight: 500, transition: 'color .15s' }} onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,.85)')} onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,.45)')}>IMS</a>
          <span style={{ color: 'rgba(255,255,255,.25)', margin: '0 8px', fontSize: 13 }}>|</span>
          <a href="/pos" target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'rgba(255,255,255,.45)', textDecoration: 'none', fontWeight: 500, transition: 'color .15s' }} onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,.85)')} onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,.45)')}>POS</a>
        </div>
        <div className="relative flex items-center gap-2">
          {businessName && (
            <span className="hidden sm:inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full shrink-0 topbar-badge">
              {businessName}
            </span>
          )}
          <button
            onClick={() => window.open('/help', '_blank')}
            title="Help"
            className="flex items-center justify-center w-8 h-8 rounded-lg outline-none hover:bg-white/10 transition-colors topbar-meta"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17" strokeLinecap="round" strokeWidth="2.5"/></svg>
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            className="flex items-center justify-center w-8 h-8 rounded-lg outline-none hover:bg-white/10 transition-colors topbar-meta"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          </button>
          <span className="hidden sm:inline-block h-6 w-px topbar-divider" />
          <button
            onClick={() => setUserMenuOpen(p => !p)}
            className="flex items-center gap-2 text-sm font-semibold px-2.5 py-1.5 rounded-lg transition-colors topbar-user"
          >
            <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 topbar-avatar">
              {userName ? userName[0].toUpperCase() : '?'}
            </span>
            <span className="topbar-meta">{userName || 'User'}</span>
            <span className="text-xs topbar-chevron">▾</span>
          </button>
          {userMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-2 w-48 z-50 user-dropdown">
                {businessName && (
                  <div className="px-4 py-3 user-dropdown-header">
                    <p className="text-xs font-semibold truncate user-dropdown-name">{businessName}</p>
                    <p className="text-xs user-dropdown-sub">Active business</p>
                  </div>
                )}
                <button
                  onClick={handleSignOut}
                  className="w-full text-left px-4 py-2.5 text-sm transition-colors user-dropdown-signout"
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <Sidebar active={activeView} onSelect={setActiveView} />

        {/* Content */}
        <main className="flex-1 p-6 overflow-y-auto">
          {activeView !== 'cs-inbox' && (
            <h1 className="text-xl font-bold text-gray-900 mb-5">{titles[activeView] ?? 'Reports'}</h1>
          )}
          {activeView === 'home' && (
            <HomeView
              setupComplete={setupComplete}
              setSetupComplete={setSetupComplete}
              connectionsDone={connectionsDone}
              setConnectionsDone={setConnectionsDone}
              businessInfoDone={businessInfoDone}
              setBusinessInfoDone={setBusinessInfoDone}
              databaseId={databaseId}
            />
          )}
          {activeView === 'ai-helper' && <AiHelperView databaseId={databaseId} />}
          {activeView === 'business-info' && (
            <BusinessInfoTab business={databaseId ? { name: businessName, userId: '', databaseId } : null} />
          )}
          {(activeView === 'sync-data' || activeView === 'inventory-sync' || activeView === 'sync-ads' || activeView === 'website-products') && (
            <SyncDataView
              databaseId={databaseId}
              initialSection={
                activeView === 'sync-ads'
                  ? 'ads'
                  : activeView === 'website-products'
                    ? 'website'
                    : 'inventory'
              }
            />
          )}
          {activeView === 'pending-online' && <PendingOnlineView databaseId={databaseId} />}
          {activeView === 'space-analysis' && <SpaceAnalysisView databaseId={databaseId} />}
          {activeView === 'stock-turnover' && <StockTurnoverView databaseId={databaseId} />}
          {activeView === 'inactive-candidates' && <InactiveCandidatesView databaseId={databaseId} />}
          {activeView === 'lost-candidates' && <LostCandidatesView databaseId={databaseId} />}
          {activeView === 'marketing-assistant' && <MarketingAssistantView databaseId={databaseId} />}
          {activeView === 'campaign-audit' && <CampaignAuditView databaseId={databaseId} />}
          {activeView === 'product-description-template' && <WebContentTemplatesView databaseId={databaseId} />}
          {activeView === 'bulk-edit-listings' && <BulkEditListingsView databaseId={databaseId} />}
          {activeView === 'cs-inbox' && <CustomerServiceView databaseId={databaseId} />}
          {(activeView === 'cs-compose' || activeView === 'cs-templates') && (
            <div className="flex flex-col items-center justify-center py-24 text-center text-gray-400">
              <span className="text-5xl mb-4">💬</span>
              <p className="text-lg font-semibold text-gray-500">Coming Soon</p>
              <p className="text-sm mt-1">Customer Service features are under construction.</p>
            </div>
          )}
          {activeView === 'brand-profile' && (
            <BrandProfileTab business={databaseId ? { name: businessName, userId: '', databaseId } : null} />
          )}
          {(activeView === 'brand-assets' || activeView === 'brand-assets-models' || activeView === 'brand-assets-backdrops' || activeView === 'brand-assets-templates') && (
            <BrandAssetsView
              databaseId={databaseId}
              activeCategory={
                activeView === 'brand-assets' ? undefined
                  : activeView === 'brand-assets-models' ? 'models'
                  : activeView === 'brand-assets-backdrops' ? 'backdrops'
                  : 'templates'
              }
            />
          )}
          {activeView === 'calculated-data' && (
            <CalculatedDataView databaseId={databaseId} />
          )}
        </main>
      </div>

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 h-screen" style={{ zIndex: 100 }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl flex flex-col overflow-hidden" style={{ height: '85vh' }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50/80 shrink-0">
              <h2 className="text-lg font-bold text-gray-800 tracking-tight">Settings</h2>
              <button onClick={() => setSettingsOpen(false)} className="p-1.5 hover:bg-gray-200 text-gray-500 hover:text-gray-800 rounded-lg transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="flex flex-1 min-h-0">
              {/* Settings Sidebar */}
              <div className="w-64 border-r border-gray-200 bg-gray-50 p-4 space-y-1 overflow-y-auto shrink-0">
                {SETTINGS_NAV.children.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveSettingView(tab.id)}
                    className={`w-full text-left px-4 py-2.5 rounded-lg text-sm transition-colors ${activeSettingView === tab.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900 font-medium'}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {/* Settings Content */}
              <div className="flex-1 overflow-y-auto p-6 bg-white">
                <h1 className="text-xl font-bold text-gray-900 mb-5">{titles[activeSettingView] ?? 'Settings'}</h1>
                {activeSettingView === 'appearance' && <AppearanceTab />}
                {activeSettingView === 'connections' && (
                  <ConnectionsTab business={databaseId ? { name: businessName, userId: '', databaseId } : null} />
                )}
                {activeSettingView === 'marketing-settings' && (
                  <MarketingSettingsView databaseId={databaseId} />
                )}
                {activeSettingView === 'data-source' && (
                  <DataSourceTab business={null} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
