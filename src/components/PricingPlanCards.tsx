'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, Minus, X } from 'lucide-react';

type PlanId = 'basic' | 'growth' | 'enterprise';
type ComparisonValue = boolean | string;

type ComparisonFeature = {
  label: string;
  note?: string;
  href?: string;
  values: Record<PlanId, ComparisonValue>;
};

type ComparisonSection = {
  title: string;
  features: ComparisonFeature[];
};

export type PricingPlan = {
  id: PlanId;
  name: string;
  audience: string;
  price: string;
  priceSuffix?: string;
  pricingNote: string;
  featured?: boolean;
  summaryFeatures: string[];
};

export const pricingPlans: PricingPlan[] = [
  {
    id: 'basic',
    name: 'Basic',
    audience: 'A complete retail foundation for smaller teams',
    price: '$60',
    priceSuffix: '/month',
    pricingNote: 'One monthly price for up to 3 locations',
    summaryFeatures: [
      '1-3 locations and up to 5 users',
      'Core inventory, sales and purchasing',
      'Point of Sale and loyalty',
      'AI workflow automation',
      'Shopify and Xero integrations',
      'Free data migration',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    audience: 'Advanced control for growing multi-location retailers',
    price: '$200',
    priceSuffix: '/month base',
    pricingNote: '+ $50/month for each additional location',
    featured: true,
    summaryFeatures: [
      '2-10 locations and up to 50 users',
      'Advanced inventory and backordering',
      'Point of Sale, loyalty and CRM',
      'AI workflow automation',
      'Advanced planning and analytics',
      'Wholesale portal integration',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    audience: 'Tailored operations for large chains and retail groups',
    price: 'Custom',
    pricingNote: '10+ locations with commercial terms built around your group',
    summaryFeatures: [
      'Everything in Growth',
      '10+ locations and unlimited users',
      'Priority 24/7 support',
      'Free migration and training',
      'Custom 3PL and platform integrations',
      'Dedicated account manager',
    ],
  },
];

const includedForAll = { basic: true, growth: true, enterprise: true } as const;
const growthAndEnterprise = { basic: false, growth: true, enterprise: true } as const;
const enterpriseOnly = { basic: false, growth: false, enterprise: true } as const;

export const pricingComparisonSections: ComparisonSection[] = [
  {
    title: 'Plan capacity',
    features: [
      { label: 'Retail locations', values: { basic: '1-3', growth: '2-10', enterprise: '10+' } },
      { label: 'Team users', values: { basic: 'Up to 5', growth: 'Up to 50', enterprise: 'Unlimited' } },
    ],
  },
  {
    title: 'Inventory and product management',
    features: [
      { label: 'Products, variants, brands and categories', values: includedForAll },
      { label: 'Stock levels and reorder settings by location', values: includedForAll },
      { label: 'Bulk product and price editing', values: includedForAll },
      { label: 'Stocktakes and discrepancy tracking', values: includedForAll },
      { label: 'Branch transfers and guided receiving', values: includedForAll },
      { label: 'Stock availability and allocation tools', values: includedForAll },
      { label: 'Backordering workflows', values: growthAndEnterprise },
      { label: 'Multi-currency purchasing and costing', values: growthAndEnterprise },
    ],
  },
  {
    title: 'Orders, customers and wholesale',
    features: [
      { label: 'Purchase orders and supplier management', values: includedForAll },
      { label: 'Sales orders and fulfilment tracking', values: includedForAll },
      { label: 'Partial receiving and fulfilment', values: includedForAll },
      { label: 'Customer and supplier credit notes', values: includedForAll },
      { label: 'Customer and supplier contact records', values: includedForAll },
      { label: 'CRM tools, store credit and customer price tiers', values: growthAndEnterprise },
      {
        label: 'Wholesale portal integration',
        note: 'Use the Solvantis wholesale ordering portal or integrate with an external wholesale portal.',
        values: growthAndEnterprise,
      },
    ],
  },
  {
    title: 'Point of Sale and loyalty',
    features: [
      { label: 'Browser-based Point of Sale', values: includedForAll },
      { label: 'Offline selling and automatic sync', values: includedForAll },
      { label: 'Integrated EFTPOS, cash and split payments', values: includedForAll },
      { label: 'Parked sales, receipts and register management', values: includedForAll },
      { label: 'Returns, gift cards and customer store credit', values: includedForAll },
      { label: 'Loyalty earning and redemption', values: includedForAll },
      { label: 'End-of-day reconciliation', values: includedForAll },
    ],
  },
  {
    title: 'AI automation and planning',
    features: [
      { label: 'Automated Product Content Studio', note: 'Research and draft consistent product listings for review.', values: includedForAll },
      { label: 'AI Creative Studio', note: 'Generate branded product imagery and creative assets.', values: includedForAll },
      { label: 'Smart Supplier Document Capture', note: 'Read supplier invoices and prepare purchase orders for review.', values: includedForAll },
      { label: 'AI-assisted customer reply drafting', values: includedForAll },
      {
        label: 'AI-assisted business planning',
        note: 'Build plans using live product sales, inventory, inbound orders, business strategy and brand context.',
        values: growthAndEnterprise,
      },
      {
        label: 'Versioned plans and scenario development',
        note: 'Develop, review and revise structured plans with traceable evidence and decision history.',
        values: growthAndEnterprise,
      },
      {
        label: 'Campaign and business experiment planning',
        note: 'Define objectives, comparison groups, success measures and operational guardrails before launch.',
        values: growthAndEnterprise,
      },
    ],
  },
  {
    title: 'Reports and advanced analytics',
    features: [
      { label: 'Sales summary, detail and search reports', values: includedForAll },
      { label: 'Sales by branch and channel', values: includedForAll },
      { label: 'Inventory valuation and product margin reports', values: includedForAll },
      { label: 'POS register, price change and cash banking reports', values: includedForAll },
      { label: 'Stock availability reporting', values: includedForAll },
      { label: 'Order Planner', href: '/ims#order-planner', values: growthAndEnterprise },
      { label: 'Stock Turnover Analysis', href: '/dashboard#stock-turnover', values: growthAndEnterprise },
      { label: 'Space Analysis', href: '/dashboard#space-analysis', values: growthAndEnterprise },
      { label: 'Advanced analytics and forecasting', values: growthAndEnterprise },
    ],
  },
  {
    title: 'Commerce and accounting integrations',
    features: [
      { label: 'Shopify integration', note: 'Products, inventory, orders, customers, returns and loyalty data.', values: includedForAll },
      { label: 'Xero integration', note: 'Sales, payment clearing, purchasing and accounting workflows.', values: includedForAll },
    ],
  },
  {
    title: 'Enterprise marketing intelligence',
    features: [
      { label: 'Paid media performance analysis', note: 'Analyse Google and Meta performance against authoritative commerce results.', values: enterpriseOnly },
      { label: 'AI marketing recommendations and approval workflow', values: enterpriseOnly },
      { label: 'Campaign measurement and outcome tracking', values: enterpriseOnly },
      { label: 'Klaviyo lifecycle coverage analysis', values: enterpriseOnly },
      { label: 'Creative performance review and governed briefs', values: enterpriseOnly },
      { label: 'Daily operational and weekly marketing digests', values: enterpriseOnly },
    ],
  },
  {
    title: 'Implementation and support',
    features: [
      { label: 'Data migration', values: { basic: 'Included', growth: 'Included', enterprise: 'Included + training' } },
      { label: 'Support', values: { basic: 'Local phone + email', growth: 'Priority phone', enterprise: 'Priority 24/7' } },
      { label: 'Dedicated account manager', values: enterpriseOnly },
      { label: 'Service-level agreement', values: enterpriseOnly },
      { label: 'Custom platform integrations', values: enterpriseOnly },
      { label: 'Custom 3PL integration', note: 'Tailored integration with your third-party logistics provider.', values: enterpriseOnly },
    ],
  },
];

function ComparisonCell({ value }: { value: ComparisonValue }) {
  if (value === true) {
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
        <Check className="h-4 w-4" aria-hidden="true" /> Included
      </span>
    );
  }

  if (value === false) {
    return (
      <span className="inline-flex items-center gap-1.5 text-slate-400">
        <Minus className="h-4 w-4" aria-hidden="true" /> Not included
      </span>
    );
  }

  return <span className="font-medium text-slate-700">{value}</span>;
}

interface PricingPlanCardsProps {
  onContactSales: () => void;
}

export default function PricingPlanCards({ onContactSales }: PricingPlanCardsProps) {
  const [selectedPlanId, setSelectedPlanId] = useState<PricingPlan['id'] | null>(null);
  const selectedPlan = pricingPlans.find((plan) => plan.id === selectedPlanId) ?? null;

  useEffect(() => {
    if (!selectedPlan) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedPlanId(null);
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedPlan]);

  return (
    <>
      <div className="grid grid-cols-1 items-stretch gap-6 md:grid-cols-3">
        {pricingPlans.map((plan) => {
          const isEnterprise = plan.id === 'enterprise';

          return (
            <article
              key={plan.id}
              className={`relative flex flex-col rounded-lg border p-7 transition duration-300 ${
                plan.featured
                  ? 'border-2 border-blue-600 bg-white shadow-xl shadow-blue-100'
                  : isEnterprise
                    ? 'border-slate-800 bg-slate-900 text-white shadow-lg'
                    : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-lg'
              }`}
            >
              {plan.featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">
                  MOST POPULAR
                </span>
              )}

              <h3 className={`text-xl font-black ${isEnterprise ? 'text-white' : 'text-slate-900'}`}>{plan.name}</h3>
              <p className={`mt-1 min-h-10 text-sm leading-relaxed ${isEnterprise ? 'text-slate-400' : 'text-slate-500'}`}>
                {plan.audience}
              </p>

              <div className="mt-6 flex flex-wrap items-end gap-x-1">
                <span className={`text-4xl font-black ${isEnterprise ? 'text-white' : 'text-slate-900'}`}>{plan.price}</span>
                {plan.priceSuffix && (
                  <span className={`mb-1.5 text-sm ${isEnterprise ? 'text-slate-400' : 'text-slate-500'}`}>{plan.priceSuffix}</span>
                )}
              </div>
              <p className={`mt-2 min-h-10 text-xs leading-relaxed ${isEnterprise ? 'text-slate-400' : 'text-slate-500'}`}>
                {plan.pricingNote}
              </p>

              <ul className="mt-6 flex-1 space-y-3 border-t border-slate-200/20 pt-6">
                {plan.summaryFeatures.map((feature) => (
                  <li key={feature} className={`flex items-start gap-2.5 text-sm ${isEnterprise ? 'text-slate-300' : 'text-slate-700'}`}>
                    <Check className={`mt-0.5 h-4 w-4 flex-none ${isEnterprise ? 'text-cyan-400' : 'text-blue-600'}`} aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => setSelectedPlanId(plan.id)}
                className={`mt-7 flex w-full items-center justify-center gap-1.5 rounded-lg border py-2.5 text-sm font-bold transition ${
                  isEnterprise
                    ? 'border-white/25 text-white hover:border-white/50 hover:bg-white/10'
                    : 'border-slate-300 text-slate-700 hover:border-blue-500 hover:text-blue-700'
                }`}
              >
                Compare full feature list
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>

              {isEnterprise ? (
                <button
                  type="button"
                  onClick={onContactSales}
                  className="mt-3 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  Contact Sales
                </button>
              ) : (
                <Link
                  href="/register"
                  className={`mt-3 block w-full rounded-lg py-2.5 text-center text-sm font-semibold transition ${
                    plan.featured
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-slate-900 text-white hover:bg-slate-800'
                  }`}
                >
                  Get Started
                </Link>
              )}
            </article>
          );
        })}
      </div>

      {selectedPlan && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/75 p-3 backdrop-blur-sm md:p-6"
          onClick={() => setSelectedPlanId(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="plan-feature-title"
        >
          <div
            className="relative flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-6 py-5 md:px-8">
              <div className="pr-12">
                <p className="text-xs font-bold uppercase tracking-widest text-blue-600">Plan comparison</p>
                <h3 id="plan-feature-title" className="mt-1 text-2xl font-black text-slate-900">
                  Compare every Solvantis tier
                </h3>
                <p className="mt-1 text-sm text-slate-500">The {selectedPlan.name} column is highlighted.</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPlanId(null)}
                className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close feature list"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <div className="md:hidden">
                {pricingComparisonSections.map((section) => (
                  <section key={section.title}>
                    <h4 className="border-y border-slate-200 bg-slate-100 px-5 py-3 text-xs font-black uppercase tracking-wider text-slate-700">
                      {section.title}
                    </h4>
                    <div className="divide-y divide-slate-100">
                      {section.features.map((feature) => (
                        <div key={feature.label} className="px-5 py-4">
                          <p className="font-semibold text-slate-900">
                            {feature.href ? (
                              <Link href={feature.href} className="text-blue-700 underline decoration-blue-200 underline-offset-4">
                                {feature.label}
                              </Link>
                            ) : feature.label}
                          </p>
                          {feature.note && <p className="mt-1 text-xs leading-relaxed text-slate-500">{feature.note}</p>}
                          <div className="mt-3 grid grid-cols-3 gap-1.5">
                            {pricingPlans.map((plan) => (
                              <div key={plan.id} className={`rounded-md p-2 text-center ${selectedPlan.id === plan.id ? 'bg-blue-50 ring-1 ring-blue-200' : 'bg-slate-50'}`}>
                                <p className={`mb-1.5 text-[10px] font-black uppercase tracking-wide ${selectedPlan.id === plan.id ? 'text-blue-700' : 'text-slate-500'}`}>
                                  {plan.name}
                                </p>
                                <div className="flex min-h-9 items-center justify-center text-[11px] leading-tight">
                                  <ComparisonCell value={feature.values[plan.id]} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              <table className="hidden w-full min-w-[900px] border-collapse text-sm md:table">
                <thead className="sticky top-0 z-10 bg-white shadow-sm">
                  <tr>
                    <th className="w-[40%] px-6 py-4 text-left text-xs font-bold uppercase tracking-wide text-slate-500 md:px-8">Feature</th>
                    {pricingPlans.map((plan) => (
                      <th
                        key={plan.id}
                        className={`w-[20%] px-4 py-4 text-center text-sm font-black ${selectedPlan.id === plan.id ? 'bg-blue-50 text-blue-700' : 'text-slate-800'}`}
                      >
                        {plan.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pricingComparisonSections.map((section) => (
                    <Fragment key={section.title}>
                      <tr>
                        <th colSpan={4} className="border-y border-slate-200 bg-slate-100 px-6 py-3 text-left text-xs font-black uppercase tracking-wider text-slate-700 md:px-8">
                          {section.title}
                        </th>
                      </tr>
                      {section.features.map((feature) => (
                        <tr key={feature.label} className="border-b border-slate-100 align-top hover:bg-slate-50/70">
                          <th className="px-6 py-3.5 text-left font-semibold text-slate-800 md:px-8">
                            {feature.href ? (
                              <Link href={feature.href} className="text-blue-700 underline decoration-blue-200 underline-offset-4 hover:text-blue-900">
                                {feature.label}
                              </Link>
                            ) : feature.label}
                            {feature.note && <span className="mt-1 block text-xs font-normal leading-relaxed text-slate-500">{feature.note}</span>}
                          </th>
                          {pricingPlans.map((plan) => (
                            <td key={plan.id} className={`px-4 py-3.5 text-center ${selectedPlan.id === plan.id ? 'bg-blue-50/70' : ''}`}>
                              <ComparisonCell value={feature.values[plan.id]} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-6 py-5 sm:flex-row sm:items-center sm:justify-between md:px-8">
              <p className="text-sm font-semibold text-slate-700">
                {selectedPlan.price}{selectedPlan.priceSuffix ? ` ${selectedPlan.priceSuffix}` : ' pricing'}
              </p>
              {selectedPlan.id === 'enterprise' ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPlanId(null);
                    onContactSales();
                  }}
                  className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700"
                >
                  Contact Sales
                </button>
              ) : (
                <Link href="/register" className="rounded-lg bg-blue-600 px-6 py-2.5 text-center text-sm font-bold text-white transition hover:bg-blue-700">
                  Get Started
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
