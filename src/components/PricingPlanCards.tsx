'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, X } from 'lucide-react';

type PlanFeature = {
  label: string;
  href?: string;
};

type PlanFeatureGroup = {
  title: string;
  features: PlanFeature[];
};

export type PricingPlan = {
  id: 'basic' | 'growth' | 'enterprise';
  name: string;
  audience: string;
  price: string;
  priceSuffix?: string;
  pricingNote: string;
  featured?: boolean;
  summaryFeatures: string[];
  featureGroups: PlanFeatureGroup[];
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
    featureGroups: [
      {
        title: 'Business scale',
        features: [
          { label: '1-3 retail locations' },
          { label: 'Up to 5 users' },
        ],
      },
      {
        title: 'Retail operations',
        features: [
          { label: 'Core inventory management, excluding backordering and multi-currency' },
          { label: 'Sales orders and purchase orders' },
          { label: 'Point of Sale' },
          { label: 'Customer loyalty' },
        ],
      },
      {
        title: 'Automation and integrations',
        features: [
          { label: 'AI workflow automation tools' },
          { label: 'Shopify integration' },
          { label: 'Xero integration' },
        ],
      },
      {
        title: 'Getting started and support',
        features: [
          { label: 'Free data migration' },
          { label: 'Local phone and email support' },
        ],
      },
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
      'Shopify and Xero integrations',
    ],
    featureGroups: [
      {
        title: 'Business scale',
        features: [
          { label: '2-10 retail locations' },
          { label: 'Up to 50 users' },
        ],
      },
      {
        title: 'Advanced retail operations',
        features: [
          { label: 'Advanced inventory management' },
          { label: 'Backordering workflows' },
          { label: 'Multi-currency purchasing and costing' },
          { label: 'Sales orders and purchase orders' },
          { label: 'Point of Sale' },
          { label: 'Customer loyalty and CRM tools' },
        ],
      },
      {
        title: 'Automation and integrations',
        features: [
          { label: 'AI workflow automation tools' },
          { label: 'Shopify integration' },
          { label: 'Xero integration' },
        ],
      },
      {
        title: 'Planning and analytics',
        features: [
          { label: 'Order Planner', href: '/ims#order-planner' },
          { label: 'Stock Turnover analysis', href: '/dashboard#stock-turnover' },
          { label: 'Space Analysis', href: '/dashboard#space-analysis' },
          { label: 'Advanced analytics and forecasting' },
        ],
      },
      {
        title: 'Getting started and support',
        features: [
          { label: 'Free data migration' },
          { label: 'Priority phone support' },
        ],
      },
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
      'Custom integrations',
      'Dedicated account manager',
    ],
    featureGroups: [
      {
        title: 'Platform access',
        features: [
          { label: 'Everything included in Growth' },
          { label: '10+ retail locations' },
          { label: 'Unlimited users' },
          { label: 'Shopify integration' },
          { label: 'Xero integration' },
        ],
      },
      {
        title: 'Enterprise services',
        features: [
          { label: 'Priority 24/7 support' },
          { label: 'Free data migration and team training' },
          { label: 'Custom integrations' },
          { label: 'Dedicated account manager' },
          { label: 'Service-level agreement guarantees' },
        ],
      },
    ],
  },
];

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
                Show full feature list
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
            className="relative max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-6 py-5 md:px-8">
              <div className="pr-12">
                <p className="text-xs font-bold uppercase tracking-widest text-blue-600">{selectedPlan.name} plan</p>
                <h3 id="plan-feature-title" className="mt-1 text-2xl font-black text-slate-900">
                  Full feature list
                </h3>
                <p className="mt-1 text-sm text-slate-500">{selectedPlan.pricingNote}</p>
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

            <div className="grid gap-7 p-6 md:grid-cols-2 md:p-8">
              {selectedPlan.featureGroups.map((group) => (
                <section key={group.title}>
                  <h4 className="text-sm font-black uppercase tracking-wide text-slate-900">{group.title}</h4>
                  <ul className="mt-3 space-y-3">
                    {group.features.map((feature) => (
                      <li key={feature.label} className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-700">
                        <Check className="mt-0.5 h-4 w-4 flex-none text-blue-600" aria-hidden="true" />
                        {feature.href ? (
                          <Link href={feature.href} className="font-semibold text-blue-700 underline decoration-blue-200 underline-offset-4 hover:text-blue-900">
                            {feature.label}
                          </Link>
                        ) : (
                          <span>{feature.label}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
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
