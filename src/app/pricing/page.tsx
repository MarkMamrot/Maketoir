'use client';
import { useState } from 'react';
import Link from 'next/link';
import PricingPlanCards from '@/components/PricingPlanCards';
import Nav from '../_nav';

interface DemoForm { name: string; email: string; company: string; message: string; }

function CheckIcon({ color = 'text-blue-600' }: { color?: string }) {
  return (
    <svg className={`w-4 h-4 flex-shrink-0 ${color}`} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0 text-slate-300" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  );
}

type CellVal = true | false | string;

const tableFeatures: { label: string; basic: CellVal; growth: CellVal; enterprise: CellVal }[] = [
  { label: 'Locations',                    basic: '1-3',                   growth: '2-10',            enterprise: '10+' },
  { label: 'Users',                        basic: 'Up to 5',               growth: 'Up to 50',        enterprise: 'Unlimited' },
  { label: 'Core Inventory Management',    basic: true,                    growth: true,              enterprise: true },
  { label: 'Backordering',                 basic: false,                   growth: true,              enterprise: true },
  { label: 'Multi-currency',               basic: false,                   growth: true,              enterprise: true },
  { label: 'POS System',                   basic: true,                    growth: true,              enterprise: true },
  { label: 'Purchase & Sales Orders',      basic: true,                    growth: true,              enterprise: true },
  { label: 'Branch Transfers',             basic: true,                    growth: true,              enterprise: true },
  { label: 'Stocktake',                    basic: true,                    growth: true,              enterprise: true },
  { label: 'Loyalty System',               basic: true,                    growth: true,              enterprise: true },
  { label: 'CRM Tools',                    basic: false,                   growth: true,              enterprise: true },
  { label: 'AI Workflow Automation',       basic: true,                    growth: true,              enterprise: true },
  { label: 'Order Planner',                basic: false,                   growth: true,              enterprise: true },
  { label: 'Stock Turnover Analysis',      basic: false,                   growth: true,              enterprise: true },
  { label: 'Space Analysis',               basic: false,                   growth: true,              enterprise: true },
  { label: 'Advanced Analytics & Forecasting', basic: false,               growth: true,              enterprise: true },
  { label: 'Xero Integration',             basic: true,                    growth: true,              enterprise: true },
  { label: 'Shopify Integration',          basic: true,                    growth: true,              enterprise: true },
  { label: 'Support',                      basic: 'Local phone & email',   growth: 'Priority phone',  enterprise: 'Priority 24/7' },
  { label: 'Data Migration',               basic: 'Free',                  growth: 'Free',             enterprise: 'Free + training' },
  { label: 'Dedicated Account Manager',    basic: false,                   growth: false,             enterprise: true },
  { label: 'Custom Integrations',          basic: false,                   growth: false,             enterprise: true },
];

function Cell({ val }: { val: CellVal }) {
  if (val === true) return <CheckIcon />;
  if (val === false) return <XIcon />;
  return <span className="text-sm text-slate-700 font-medium">{val}</span>;
}

const faqs = [
  {
    q: 'What is included in the "3 months for $1" offer?',
    a: 'You get full access to your chosen plan for 3 months for a one-time $1 payment. No credit card required upfront, no lock-in. After 3 months, normal billing applies — you can cancel any time before.',
  },
  {
    q: 'Can I switch plans as my business grows?',
    a: 'Absolutely. You can upgrade or downgrade your plan at any time. Changes take effect at the start of your next billing cycle. There are no penalties for switching.',
  },
  {
    q: 'Does the Growth plan price increase per location I add?',
    a: 'Yes. Growth has a $200 monthly base, then adds $50 per month for each additional location. Every Growth location receives the same advanced inventory, automation, CRM, analytics, Shopify, and Xero features.',
  },
  {
    q: 'What does "free data migration" include?',
    a: 'Our team will migrate your existing product catalogue, customer data, and historical stock records from your current system. This typically takes 2–5 business days depending on data volume.',
  },
  {
    q: 'Does the POS work offline?',
    a: 'Yes. Solvantis POS is designed to operate fully offline. All transactions are queued locally and automatically synced when your connection is restored.',
  },
  {
    q: 'Are there setup fees or contracts?',
    a: 'No setup fees and no lock-in contracts. All plans are billed monthly. Enterprise plans are negotiated annually but remain flexible.',
  },
];

export default function PricingPage() {
  const [demoOpen, setDemoOpen] = useState(false);
  const [form, setForm] = useState<DemoForm>({ name: '', email: '', company: '', message: '' });

  function handleDemoSubmit(e: React.FormEvent) {
    e.preventDefault();
    const subject = encodeURIComponent(`Demo Request – ${form.company || form.name}`);
    const body = encodeURIComponent(
      `Hi Solvantis Sales,\n\nI'd like to book a product demo.\n\nName: ${form.name}\nEmail: ${form.email}\nCompany: ${form.company}\n\nMessage:\n${form.message}\n\nThanks`
    );
    window.location.href = `mailto:sales@solvantis.com?subject=${subject}&body=${body}`;
    setDemoOpen(false);
  }

  return (
    <div className="bg-white text-slate-900 min-h-screen" style={{ fontFamily: 'Inter, sans-serif' }}>
      <Nav onDemo={() => setDemoOpen(true)} />

      {/* Hero */}
      <section className="bg-slate-50 border-b border-slate-200 py-16 text-center px-6">
        <p className="text-xs uppercase tracking-widest font-semibold text-blue-600 mb-3">Pricing</p>
        <h1 className="text-5xl font-black text-slate-900 tracking-tight mb-4">Simple, transparent pricing</h1>
        <p className="text-slate-500 text-lg max-w-lg mx-auto">
          No hidden fees. Scale up — or down — as your business changes.
        </p>
      </section>

      {/* Promo */}
      <div className="bg-blue-600 py-4 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-white text-sm font-medium text-center sm:text-left">
            🎉 <strong>Limited Offer:</strong> Try Solvantis free for 3 months — just $1. No lock-in, no credit card required.
          </p>
          <Link href="/register" className="flex-shrink-0 bg-white text-blue-600 hover:bg-blue-50 font-semibold text-sm px-5 py-2 rounded-lg transition shadow-sm">
            Claim Offer →
          </Link>
        </div>
      </div>

      {/* Tier cards */}
      <section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <PricingPlanCards onContactSales={() => setDemoOpen(true)} />
        </div>
      </section>

      {/* Feature comparison table */}
      <section className="py-12 px-6 bg-slate-50 border-t border-slate-200">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-black text-slate-900 text-center mb-8">Full feature comparison</h2>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-sm bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left px-6 py-4 text-slate-500 font-semibold text-xs uppercase tracking-wide w-[40%]">Feature</th>
                  <th className="text-center px-4 py-4 text-slate-700 font-bold">Basic</th>
                  <th className="text-center px-4 py-4 text-blue-600 font-bold bg-blue-50">Growth</th>
                  <th className="text-center px-4 py-4 text-slate-700 font-bold">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {tableFeatures.map((row, i) => (
                  <tr key={row.label} className={`border-b border-slate-100 ${i % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
                    <td className="px-6 py-3.5 text-slate-700 font-medium">{row.label}</td>
                    <td className="px-4 py-3.5 text-center">
                      <div className="flex justify-center"><Cell val={row.basic} /></div>
                    </td>
                    <td className="px-4 py-3.5 text-center bg-blue-50/40">
                      <div className="flex justify-center"><Cell val={row.growth} /></div>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <div className="flex justify-center"><Cell val={row.enterprise} /></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 px-6 bg-white border-t border-slate-100">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-black text-slate-900 text-center mb-10">Frequently asked questions</h2>
          <div className="space-y-3">
            {faqs.map((faq) => (
              <details key={faq.q} className="group rounded-xl border border-slate-200 overflow-hidden">
                <summary className="flex items-center justify-between px-5 py-4 cursor-pointer list-none font-semibold text-slate-800 text-sm hover:bg-slate-50 transition">
                  {faq.q}
                  <svg
                    className="w-4 h-4 text-slate-400 flex-shrink-0 ml-4 group-open:rotate-180 transition-transform"
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <div className="px-5 pb-4 text-sm text-slate-600 leading-relaxed border-t border-slate-100 pt-3">
                  {faq.a}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-br from-blue-600 to-cyan-600 py-16 px-6 text-center">
        <h2 className="text-3xl font-black text-white mb-4">Still have questions?</h2>
        <p className="text-blue-100 mb-8 max-w-md mx-auto">
          Talk to one of our retail specialists. We'll match you with the right plan and answer every question.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <button
            onClick={() => setDemoOpen(true)}
            className="bg-white text-blue-600 hover:bg-blue-50 font-bold px-8 py-3.5 rounded-xl transition shadow-lg text-sm"
          >
            Book a Free Demo
          </button>
          <Link href="/register" className="border-2 border-white/60 hover:border-white text-white font-semibold px-8 py-3.5 rounded-xl transition text-sm">
            Start Free Trial
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 py-8 px-6 text-center">
        <p className="text-xl font-black text-blue-400 mb-2">Solvantis</p>
        <p className="text-slate-500 text-xs">© {new Date().getFullYear()} Solvantis. All rights reserved. Built BY retailers, FOR retailers.</p>
        <div className="flex items-center justify-center gap-6 mt-4">
          <Link href="/" className="text-slate-500 hover:text-white text-xs transition">Home</Link>
          <Link href="/#features" className="text-slate-500 hover:text-white text-xs transition">Features</Link>
          <Link href="/login" className="text-slate-500 hover:text-white text-xs transition">Sign In</Link>
          <Link href="/register" className="text-slate-500 hover:text-white text-xs transition">Get Started</Link>
          <a href="mailto:sales@solvantis.com" className="text-slate-500 hover:text-white text-xs transition">Contact</a>
        </div>
      </footer>

      {/* Demo Modal */}
      {demoOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setDemoOpen(false)}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-6">
              <div>
                <h3 className="text-xl font-black text-slate-900">Book a Free Demo</h3>
                <p className="text-slate-500 text-sm mt-0.5">30 minutes · No obligation · Tailored to you</p>
              </div>
              <button onClick={() => setDemoOpen(false)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition -mt-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleDemoSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Full Name *</label>
                <input required type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Smith" className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Work Email *</label>
                <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@yourstore.com" className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Company / Store Name</label>
                <input type="text" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Threads & Co." className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">What would you like to see?</label>
                <textarea rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="e.g. POS, multi-branch inventory, AI tools..." className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none" />
              </div>
              <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition text-sm shadow-sm">
                Send Request →
              </button>
              <p className="text-center text-xs text-slate-400">We&apos;ll reply within 1 business day.</p>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
