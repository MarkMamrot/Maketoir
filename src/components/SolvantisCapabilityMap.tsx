'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  Boxes,
  Building2,
  Calculator,
  Check,
  Network,
  ScanLine,
  ShoppingCart,
  Sparkles,
  Store,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';

type Capability = {
  id: string;
  title: string;
  shortTitle: string;
  eyebrow: string;
  summary: string;
  outcome: string;
  icon: LucideIcon;
  x: number;
  y: number;
  size: number;
  groups: Array<{
    title: string;
    features: string[];
  }>;
};

const capabilities: Capability[] = [
  {
    id: 'pos',
    title: 'Point of Sale',
    shortTitle: 'POS',
    eyebrow: 'Sell anywhere',
    summary: 'A fast, dependable checkout built for the realities of Australian retail, from busy counters to temporary internet outages.',
    outcome: 'Keep customers moving while sales, stock, loyalty and accounting stay connected behind the scenes.',
    icon: ShoppingCart,
    x: 21.7,
    y: 23.7,
    size: 17,
    groups: [
      {
        title: 'Fast checkout',
        features: [
          'Quick product search by name, SKU or barcode',
          'Integrated Zeller EFTPOS plus cash and split payments',
          'Park and resume sales without rebuilding the basket',
          'Receipt printing, cash rounding and register controls',
        ],
      },
      {
        title: 'Connected customer service',
        features: [
          'Customer loyalty earning and redemption at checkout',
          'Gift cards, store credit and linked return workflows',
          'Staff PIN access with manager-controlled adjustments',
          'Full offline selling with automatic sync on reconnection',
        ],
      },
    ],
  },
  {
    id: 'inventory',
    title: 'Advanced Inventory',
    shortTitle: 'Inventory',
    eyebrow: 'Know every unit',
    summary: 'Control products, purchasing, stock movement and fulfilment from one accurate operational record.',
    outcome: 'See what you own, where it is, what is committed and what needs attention before it becomes a problem.',
    icon: Boxes,
    x: 50,
    y: 13.2,
    size: 16,
    groups: [
      {
        title: 'Product and stock control',
        features: [
          'Products with variants, brands, categories and supplier details',
          'Stock on hand and reorder settings by location',
          'Bulk product, pricing and catalogue updates',
          'Stocktakes with discrepancy tracking and audit history',
          'Bin and zone information for practical warehouse handling',
        ],
      },
      {
        title: 'Ordering and fulfilment',
        features: [
          'Purchase and sales orders with guided receiving and fulfilment',
          'Branch transfers with sending and receiving confirmation',
          'Live stock availability and demand allocation tools',
          'Backordering and multi-currency purchasing on advanced plans',
        ],
      },
    ],
  },
  {
    id: 'wholesale',
    title: 'Wholesale and Distribution',
    shortTitle: 'Wholesale',
    eyebrow: 'Serve trade customers',
    summary: 'Give wholesale buyers a simpler ordering experience while keeping their pricing, terms and orders inside the same stock system.',
    outcome: 'Grow B2B sales without creating a disconnected catalogue or a second order-management process.',
    icon: Store,
    x: 76.5,
    y: 23.8,
    size: 17,
    groups: [
      {
        title: 'Buyer experience',
        features: [
          'Solvantis self-service wholesale ordering portal',
          'Integration options for external wholesale portals',
          'Wholesale product visibility and customer-specific pricing tiers',
          'Draft baskets, order review and structured submission',
        ],
      },
      {
        title: 'Distribution controls',
        features: [
          'B2B customer profiles, account limits and payment terms',
          'Indent ordering for approved out-of-stock products',
          'Wholesale orders tracked as a distinct sales channel',
          'Supplier and customer contacts managed in one directory',
        ],
      },
    ],
  },
  {
    id: 'channels',
    title: 'Multi Channel Commerce',
    shortTitle: 'Multi Channel',
    eyebrow: 'One operation, every channel',
    summary: 'Bring store, online and wholesale activity together so each channel works from shared product, stock and customer information.',
    outcome: 'Operate multiple routes to market without losing a reliable view of sales, stock movements or returns.',
    icon: Network,
    x: 85.4,
    y: 52.1,
    size: 16,
    groups: [
      {
        title: 'Connected commerce',
        features: [
          'Shopify products, inventory, orders and customer synchronisation',
          'Online returns and refunds linked to stock and credit notes',
          'POS, online and wholesale sales retained as distinct channels',
          'Shared catalogue and stock visibility across selling channels',
        ],
      },
      {
        title: 'Channel insight',
        features: [
          'Sales reporting by branch, channel, product and date range',
          'Shopify loyalty and customer-account support',
          'Commerce activity connected to Xero accounting workflows',
          'Enterprise marketing analysis across paid and lifecycle channels',
        ],
      },
    ],
  },
  {
    id: 'locations',
    title: 'Multi Location Operations',
    shortTitle: 'Multi Location',
    eyebrow: 'Run every location together',
    summary: 'Manage branches, warehouses and registers as one business while preserving the detail each local team needs.',
    outcome: 'Move stock intelligently, compare performance fairly and give every location a consistent way of working.',
    icon: Building2,
    x: 76.8,
    y: 76.2,
    size: 17,
    groups: [
      {
        title: 'Location control',
        features: [
          'Stock visibility and reorder settings by location',
          'Location-specific registers, payment methods and receipt settings',
          'Shared products, customers, suppliers and operational records',
          'User access and operational settings for each branch',
        ],
      },
      {
        title: 'Movement and performance',
        features: [
          'Inter-branch transfers with an auditable receive workflow',
          'Central stock availability across stores and warehouses',
          'Sales, margin and inventory reporting by branch',
          'Business-wide dashboards with location-level drill-down',
        ],
      },
    ],
  },
  {
    id: 'ai',
    title: 'AI Automated Workflows',
    shortTitle: 'AI Workflows',
    eyebrow: 'Turn repetitive work into review',
    summary: 'Use practical AI inside real retail workflows, with people remaining in control of the final decision and output.',
    outcome: 'Start from a useful draft, structured plan or prepared document instead of a blank page and hours of manual handling.',
    icon: Sparkles,
    x: 50.2,
    y: 86,
    size: 16,
    groups: [
      {
        title: 'Everyday automation',
        features: [
          'Automated Product Content Studio for researched listing drafts',
          'AI Creative Studio for branded product imagery and assets',
          'Smart Supplier Document Capture that prepares purchase orders',
          'Context-aware customer reply drafting for human review',
        ],
      },
      {
        title: 'Planning and improvement',
        features: [
          'AI-assisted plans grounded in sales, inventory and inbound orders',
          'Versioned scenarios with evidence and decision history',
          'Business and campaign experiment planning with clear measures',
          'Order planning, stock turnover and space-productivity insight',
        ],
      },
    ],
  },
  {
    id: 'integrations',
    title: 'Accounting and Ecommerce Integrations',
    shortTitle: 'Integrations',
    eyebrow: 'Connect the operational record',
    summary: 'Keep commerce, inventory and accounting aligned through integrations designed around the documents and events retailers actually use.',
    outcome: 'Reduce duplicate entry and make reconciliation easier without giving up control of approvals and mappings.',
    icon: Calculator,
    x: 23,
    y: 76.1,
    size: 17,
    groups: [
      {
        title: 'Xero accounting',
        features: [
          'POS and online sales accounting with payment clearing',
          'Purchase, supplier bill and credit-note workflows',
          'COGS and stocktake journal support where configured',
          'Account, tax and tracking-category mappings',
          'Australian tax-inclusive pricing with GST extracted correctly',
        ],
      },
      {
        title: 'Connected commerce',
        features: [
          'Shopify product, stock, order, customer and return flows',
          'Shopify payout reconciliation into Xero',
          'Visible integration activity and operational issue tracking',
          'Custom platform and 3PL integration services for Enterprise',
        ],
      },
    ],
  },
  {
    id: 'crm',
    title: 'CRM and Loyalty',
    shortTitle: 'CRM & Loyalty',
    eyebrow: 'Recognise every customer',
    summary: 'Connect customer records, loyalty, store credit and returns to the transactions that created them.',
    outcome: 'Give staff a dependable customer view and reward repeat business consistently in-store and online.',
    icon: UsersRound,
    x: 13.1,
    y: 52,
    size: 16,
    groups: [
      {
        title: 'Customer relationships',
        features: [
          'Customer and supplier contact records in the operational platform',
          'Retail and wholesale customer price tiers',
          'Exact Shopify customer linking and synchronisation',
          'Store credit issued and redeemed through an auditable ledger',
        ],
      },
      {
        title: 'Loyalty and returns',
        features: [
          'Configurable loyalty earning on eligible purchases',
          'Points redemption at Point of Sale',
          'Online loyalty support for paid Shopify orders and refunds',
          'Reward claims through Shopify customer accounts',
          'Returns governed by linked customer credit notes',
        ],
      },
    ],
  },
];

export default function SolvantisCapabilityMap() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = capabilities.find((capability) => capability.id === selectedId) ?? null;

  const openCapability = (capabilityId: string, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setSelectedId(capabilityId);
  };

  const closeCapability = () => setSelectedId(null);

  useEffect(() => {
    if (!selected) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeCapability();
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      requestAnimationFrame(() => triggerRef.current?.focus());
    };
  }, [selected]);

  return (
    <>
      <div className="mx-auto max-w-[920px]">
        <div className="relative aspect-[991/1024] w-full overflow-hidden rounded-lg border border-slate-200 bg-[#f4f6fa] shadow-[0_24px_70px_rgba(15,23,42,0.12)]">
          <Image
            src="/landing/solvantismap.jpg"
            alt="Solvantis platform map showing eight connected retail capabilities"
            fill
            sizes="(max-width: 1024px) 94vw, 920px"
            className="object-contain"
            priority={false}
          />

          {capabilities.map((capability) => (
            <button
              key={capability.id}
              type="button"
              onClick={(event) => openCapability(capability.id, event.currentTarget)}
              className="group absolute hidden -translate-x-1/2 -translate-y-1/2 rounded-full outline-none sm:block"
              style={{ left: `${capability.x}%`, top: `${capability.y}%`, width: `${capability.size}%`, aspectRatio: '1' }}
              aria-label={`Explore ${capability.title} features`}
            >
              <span className="absolute -inset-1 rounded-full border-2 border-transparent bg-cyan-400/0 shadow-[0_0_0_0_rgba(34,211,238,0)] transition duration-300 group-hover:-inset-2 group-hover:border-cyan-400/80 group-hover:bg-cyan-300/10 group-hover:shadow-[0_0_32px_8px_rgba(34,211,238,0.28)] group-focus-visible:-inset-2 group-focus-visible:border-blue-600 group-focus-visible:bg-blue-400/10 group-focus-visible:shadow-[0_0_0_5px_rgba(37,99,235,0.22)]" />
              <span className="absolute inset-1 rounded-full bg-white/0 transition duration-300 group-hover:bg-white/10 group-hover:scale-105 group-focus-visible:scale-105" />
              <span className="sr-only">Open {capability.title} feature summary</span>
            </button>
          ))}
        </div>

        <p className="mt-5 hidden text-center text-sm font-medium text-slate-500 sm:block">
          Select any capability to explore how Solvantis connects the work around it.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:hidden">
          {capabilities.map((capability) => {
            const Icon = capability.icon;
            return (
              <button
                key={capability.id}
                type="button"
                onClick={(event) => openCapability(capability.id, event.currentTarget)}
                className="flex min-h-14 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-xs font-bold text-slate-800 shadow-sm transition active:border-blue-500 active:bg-blue-50"
              >
                <Icon className="h-4 w-4 flex-none text-blue-600" aria-hidden="true" />
                <span>{capability.shortTitle}</span>
              </button>
            );
          })}
        </div>
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-[115] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm md:p-6"
          onClick={closeCapability}
          role="dialog"
          aria-modal="true"
          aria-labelledby="capability-title"
        >
          <div
            className="relative max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="grid lg:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="relative overflow-hidden bg-slate-950 p-7 text-white lg:min-h-[560px] lg:p-9">
                <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
                <div className="relative">
                  <span className="flex h-14 w-14 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-300">
                    <selected.icon className="h-7 w-7" aria-hidden="true" />
                  </span>
                  <p className="mt-7 text-xs font-bold uppercase tracking-widest text-cyan-300">{selected.eyebrow}</p>
                  <h3 id="capability-title" className="mt-3 text-3xl font-black leading-tight text-white">{selected.title}</h3>
                  <p className="mt-5 text-sm leading-relaxed text-slate-300">{selected.summary}</p>
                  <div className="mt-7 border-l-2 border-cyan-400 pl-4">
                    <p className="text-sm font-semibold leading-relaxed text-white">{selected.outcome}</p>
                  </div>
                </div>
              </aside>

              <div className="p-6 md:p-8 lg:p-10">
                <div className="flex items-start justify-between gap-5">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-blue-600">Connected capability</p>
                    <h4 className="mt-2 text-2xl font-black text-slate-900">What your team can do</h4>
                  </div>
                  <button
                    ref={closeButtonRef}
                    type="button"
                    onClick={closeCapability}
                    className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    aria-label="Close capability details"
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>

                <div className="mt-8 grid gap-8 md:grid-cols-2">
                  {selected.groups.map((group) => (
                    <section key={group.title}>
                      <h5 className="border-b border-slate-200 pb-3 text-sm font-black uppercase tracking-wide text-slate-900">{group.title}</h5>
                      <ul className="mt-4 space-y-3.5">
                        {group.features.map((feature) => (
                          <li key={feature} className="flex items-start gap-3 text-sm leading-relaxed text-slate-700">
                            <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-cyan-50 text-cyan-700">
                              <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            </span>
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>

                <div className="mt-9 flex items-center gap-3 border-t border-slate-200 pt-6 text-sm text-slate-500">
                  <ScanLine className="h-5 w-5 flex-none text-blue-600" aria-hidden="true" />
                  <p>Availability varies by plan. Compare tiers in the pricing section below.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
