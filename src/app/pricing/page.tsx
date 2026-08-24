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
    a: 'The offer applies to Starter self onboarding. You receive Starter access for 3 months for a one-time $1 payment. Normal Starter pricing applies after the offer unless you cancel beforehand.',
  },
  {
    q: 'Can I switch plans as my business grows?',
    a: 'Absolutely. You can upgrade or downgrade your plan at any time. Changes take effect at the start of your next billing cycle. There are no penalties for switching.',
  },
  {
    q: 'What is the difference between Core and Scale?',
    a: 'Core and Scale share the same complete operational feature set. Scale includes more locations, registers, users, integrations and order capacity, plus 3PL workflows, White Glove onboarding, priority support and better AI credit rates.',
  },
  {
    q: 'How does onboarding work?',
    a: 'Starter and Core use self onboarding with guided setup, import templates and Help. Scale and Enterprise include White Glove onboarding with discovery, migration validation, integration setup, training, rollout planning and go-live coordination within the agreed scope.',
  },
  {
    q: 'Does the POS work offline?',
    a: 'Yes. Solvantis POS is designed to operate fully offline. All transactions are queued locally and automatically synced when your connection is restored.',
  },
  {
    q: 'How are AI Automation tools charged?',
    a: 'AI Automation is available on every plan. Generative and agentic actions use separately purchased AI credits. Core receives preferred rates, Scale receives volume-preferred rates and Enterprise receives contracted bulk rates. Standard reports and non-generative calculations do not use credits.',
  },
  {
    q: 'Are there contracts?',
    a: 'Starter is monthly. Core and Scale use 12-month agreements billed monthly. Enterprise is an annual scoped contract. All public prices exclude GST.',
  },
  {
    q: 'What is included with Enterprise?',
    a: 'Enterprise starts from $1,999 per month and includes dedicated app and database instances, White Glove onboarding, contracted capacity, bulk AI credit rates, an SLA and 100 governed customisation hours per contract year. Complex infrastructure, integrations, 3PL requirements or accelerated delivery may increase the quote.',
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
        <p className="text-slate-500 text-lg max-w-2xl mx-auto">
          Start with a complete retail platform, then scale capacity, support and AI Automation as your business grows.
        </p>
      </section>

      {/* Promo */}
      <div className="bg-blue-600 py-4 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-white text-sm font-medium text-center sm:text-left">
            <strong>Starter offer:</strong> Self onboard for $1 for your first 3 months. Normal Starter pricing applies after the offer.
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
