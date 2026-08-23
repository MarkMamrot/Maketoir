'use client';
import { useState } from 'react';
import Link from 'next/link';
import PricingPlanCards from '@/components/PricingPlanCards';
import { ProspectLeadDialog } from '@/components/assistant/ProspectLeadForm';
import { ProspectSalesAssistant } from '@/components/assistant/ProspectSalesAssistant';
import Nav from '../_nav';

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
          <button type="button" onClick={() => setDemoOpen(true)} className="text-slate-500 hover:text-white text-xs transition">Contact</button>
        </div>
      </footer>

      <ProspectSalesAssistant sourcePath="/pricing" />
      <ProspectLeadDialog open={demoOpen} sourcePath="/pricing" onClose={() => setDemoOpen(false)} />
    </div>
  );
}
